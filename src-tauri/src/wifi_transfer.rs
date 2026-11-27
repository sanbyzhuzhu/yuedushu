//! Temporary LAN upload service. Received books are staged, then claimed by the normal importer.
use axum::{
    body::Body,
    extract::{ConnectInfo, DefaultBodyLimit, Query, Request, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use http_body_util::BodyExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::{HashMap, HashSet},
    io::{Read, Seek, SeekFrom},
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
use tokio::{
    io::AsyncWriteExt,
    net::TcpListener,
    sync::{watch, Mutex as AsyncMutex, Semaphore},
    task::JoinHandle,
};

const MAX_FILE: u64 = 256 * 1024 * 1024;
const MAX_STAGED: u64 = 512 * 1024 * 1024;
const PAGE: &str = include_str!("wifi_upload.html");
type Signal = Arc<dyn Fn() + Send + Sync>;

#[derive(Clone, Serialize)]
pub struct Transfer {
    id: String,
    name: String,
    size: u64,
    received: u64,
    status: String,
    message: String,
    #[serde(skip)]
    path: PathBuf,
    #[serde(skip)]
    session: String,
}
#[derive(Clone, Default, Serialize)]
pub struct Snapshot {
    revision: u64,
    running: bool,
    urls: Vec<String>,
    code: String,
    transfers: Vec<Transfer>,
}
struct Running {
    session: Arc<Session>,
    task: JoinHandle<()>,
}
struct Session {
    id: String,
    token: String,
    code: String,
    hosts: Vec<String>,
    directory: PathBuf,
    service: Arc<Service>,
    stop: watch::Sender<bool>,
    signal: Signal,
    attempts: Mutex<HashMap<IpAddr, (Instant, u32)>>,
    uploads: Arc<Semaphore>,
}
#[derive(Default)]
pub struct Service {
    running: AsyncMutex<Option<Running>>,
    records: Mutex<Vec<Transfer>>,
    revision: AtomicU64,
}
#[derive(Default)]
pub struct WifiState(pub Arc<Service>);

fn random_hex() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| "无法生成传书配对信息")?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
fn lan(ip: Ipv4Addr) -> bool {
    let a = ip.octets();
    ip.is_private()
        || ip.is_link_local()
        || ip.is_loopback()
        || (a[0] == 100 && (64..=127).contains(&a[1]))
}
fn addresses() -> Result<Vec<Ipv4Addr>, String> {
    let mut ips: Vec<_> = if_addrs::get_if_addrs()
        .map_err(|_| "无法读取局域网地址")?
        .into_iter()
        .filter_map(|entry| match entry.addr {
            if_addrs::IfAddr::V4(v) if lan(v.ip) && !v.ip.is_loopback() => Some(v.ip),
            _ => None,
        })
        .collect();
    ips.sort();
    ips.dedup();
    if ips.is_empty() {
        return Err("未找到局域网地址，请先连接 Wi-Fi、网线或热点".into());
    }
    Ok(ips)
}
fn active(status: &str) -> bool {
    matches!(status, "receiving" | "queued" | "importing")
}
fn error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({"error":message}))).into_response()
}
fn equals(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0
}
fn authorized(headers: &HeaderMap, session: &Session) -> bool {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .is_some_and(|v| equals(v, &session.token))
}
fn valid_name(name: &str) -> bool {
    if name.is_empty()
        || name.chars().count() > 200
        || name
            .chars()
            .any(|c| c.is_control() || c == '/' || c == '\\')
    {
        return false;
    }
    let lower = name.to_ascii_lowercase();
    [
        ".epub",
        ".txt",
        ".md",
        ".markdown",
        ".pdf",
        ".docx",
        ".mobi",
        ".azw",
        ".azw3",
        ".prc",
        ".fb2",
        ".fb2.zip",
        ".cbz",
        ".updb",
        ".ofd",
        ".odt",
        ".html",
        ".htm",
        ".xhtml",
    ]
    .iter()
    .any(|ext| lower.ends_with(ext))
}
impl Service {
    fn changed(&self) {
        self.revision.fetch_add(1, Ordering::SeqCst);
    }
    async fn snapshot(&self) -> Snapshot {
        let control = self.running.lock().await;
        let (running, urls, code) = if let Some(server) = control.as_ref() {
            (
                true,
                server
                    .session
                    .hosts
                    .iter()
                    .filter(|h| !h.starts_with("127."))
                    .map(|h| format!("http://{h}/"))
                    .collect(),
                server.session.code.clone(),
            )
        } else {
            (false, vec![], String::new())
        };
        let records = self.records.lock().unwrap();
        Snapshot {
            revision: self.revision.load(Ordering::SeqCst),
            running,
            urls,
            code,
            transfers: records.clone(),
        }
    }
    async fn start(
        self: &Arc<Self>,
        directory: PathBuf,
        ips: Vec<Ipv4Addr>,
        signal: Signal,
    ) -> Result<Snapshot, String> {
        let mut control = self.running.lock().await;
        if control.is_some() {
            return Err("Wi-Fi 传书已经开启".into());
        }
        std::fs::create_dir_all(&directory).map_err(|_| "无法创建接收缓存，请检查存储空间")?;
        let retained: HashSet<_> = self
            .records
            .lock()
            .unwrap()
            .iter()
            .filter(|r| active(&r.status))
            .map(|r| r.path.clone())
            .collect();
        if let Ok(entries) = std::fs::read_dir(&directory) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.len() == 32
                    && name.bytes().all(|b| b.is_ascii_hexdigit())
                    && !retained.contains(&entry.path())
                    && entry.file_type().is_ok_and(|t| t.is_file())
                {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
        let listener = TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0))
            .await
            .map_err(|_| "无法开启局域网接收服务")?;
        let port = listener
            .local_addr()
            .map_err(|_| "无法读取接收端口")?
            .port();
        let mut hosts: Vec<_> = ips.into_iter().map(|ip| format!("{ip}:{port}")).collect();
        hosts.push(format!("127.0.0.1:{port}"));
        hosts.sort();
        hosts.dedup();
        let seed = random_hex()?;
        let code = format!(
            "{:08}",
            u32::from_str_radix(&seed[..8], 16).unwrap() % 100_000_000
        );
        let (stop, _) = watch::channel(false);
        let session = Arc::new(Session {
            id: random_hex()?,
            token: random_hex()? + &random_hex()?,
            code,
            hosts,
            directory,
            service: self.clone(),
            stop,
            signal: signal.clone(),
            attempts: Mutex::new(HashMap::new()),
            uploads: Arc::new(Semaphore::new(2)),
        });
        self.records.lock().unwrap().retain(|r| active(&r.status));
        let router = Router::new()
            .route("/", get(|| async { Html(PAGE) }))
            .route("/pair", post(pair).layer(DefaultBodyLimit::max(1024)))
            .route("/upload", post(upload))
            .route("/status", get(status))
            .layer(middleware::from_fn_with_state(session.clone(), guard))
            .with_state(session.clone());
        let mut shutdown = session.stop.subscribe();
        let task = tokio::spawn(async move {
            let _ = axum::serve(
                listener,
                router.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .with_graceful_shutdown(async move {
                let _ = shutdown.changed().await;
            })
            .await;
        });
        *control = Some(Running { session, task });
        self.changed();
        drop(control);
        signal();
        Ok(self.snapshot().await)
    }
    async fn stop(&self) -> Snapshot {
        let mut control = self.running.lock().await;
        if let Some(mut running) = control.take() {
            self.changed();
            let _ = running.session.stop.send(true);
            if tokio::time::timeout(Duration::from_secs(2), &mut running.task)
                .await
                .is_err()
            {
                running.task.abort();
                let _ = running.task.await;
            }
            (running.session.signal)();
        }
        drop(control);
        self.snapshot().await
    }
    fn take(&self) -> Vec<Transfer> {
        let mut records = self.records.lock().unwrap();
        let mut result = vec![];
        for record in records.iter_mut().filter(|r| r.status == "queued").take(4) {
            record.status = "importing".into();
            result.push(record.clone());
        }
        if !result.is_empty() {
            self.changed();
        }
        result
    }
    fn read_chunk(&self, id: &str, offset: u64) -> Result<Vec<u8>, String> {
        let record = self
            .records
            .lock()
            .unwrap()
            .iter()
            .find(|r| r.id == id && r.status == "importing")
            .cloned()
            .ok_or("接收文件已失效")?;
        if offset > record.size {
            return Err("无效的文件位置".into());
        }
        let mut file = std::fs::File::open(record.path).map_err(|_| "无法读取接收文件")?;
        file.seek(SeekFrom::Start(offset))
            .map_err(|_| "无法定位接收文件")?;
        let mut bytes = vec![0; ((record.size - offset).min(256 * 1024)) as usize];
        file.read_exact(&mut bytes)
            .map_err(|_| "接收文件读取中断")?;
        Ok(bytes)
    }
    fn complete(&self, id: &str, success: bool, message: &str) {
        let mut records = self.records.lock().unwrap();
        if let Some(r) = records
            .iter_mut()
            .find(|r| r.id == id && r.status == "importing")
        {
            r.status = if success { "imported" } else { "failed" }.into();
            r.message = message.chars().take(240).collect();
            let _ = std::fs::remove_file(&r.path);
        }
        while records.len() > 40 {
            if let Some(i) = records.iter().position(|r| !active(&r.status)) {
                records.remove(i);
            } else {
                break;
            }
        }
        self.changed();
    }
}
async fn guard(State(session): State<Arc<Session>>, request: Request, next: Next) -> Response {
    let host = request
        .headers()
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let peer = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|v| v.0.ip());
    let allowed_peer = matches!(peer,Some(IpAddr::V4(ip)) if lan(ip));
    let allowed_origin = request
        .headers()
        .get(header::ORIGIN)
        .map(|v| v.to_str().ok() == Some(format!("http://{host}").as_str()))
        .unwrap_or(true);
    let mut response =
        if !allowed_peer || !session.hosts.iter().any(|h| h == host) || !allowed_origin {
            error(StatusCode::FORBIDDEN, "请从阅读树显示的局域网地址打开页面")
        } else if *session.stop.borrow() {
            error(StatusCode::GONE, "传书已关闭")
        } else {
            next.run(request).await
        };
    for (key,value) in [("cache-control","no-store"),("x-content-type-options","nosniff"),("x-frame-options","DENY"),("referrer-policy","no-referrer"),("content-security-policy","default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")]{response.headers_mut().insert(key,HeaderValue::from_static(value));}
    response
}
#[derive(Deserialize)]
struct PairInput {
    code: String,
}
async fn pair(
    State(session): State<Arc<Session>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Json(input): Json<PairInput>,
) -> Response {
    let mut attempts = session.attempts.lock().unwrap();
    if attempts.len() > 256 {
        attempts.retain(|_, (at, _)| at.elapsed() < Duration::from_secs(60));
    }
    if attempts.len() > 256 && !attempts.contains_key(&peer.ip()) {
        return error(StatusCode::TOO_MANY_REQUESTS, "连接尝试过多，请稍后重试");
    }
    let entry = attempts.entry(peer.ip()).or_insert((Instant::now(), 0));
    if entry.0.elapsed() > Duration::from_secs(60) {
        *entry = (Instant::now(), 0);
    }
    if entry.1 >= 6 {
        return error(
            StatusCode::TOO_MANY_REQUESTS,
            "配对码错误次数过多，请一分钟后重试",
        );
    }
    if !equals(&input.code, &session.code) {
        entry.1 += 1;
        return error(
            StatusCode::UNAUTHORIZED,
            "配对码不正确，请查看接收设备上的阅读树",
        );
    }
    Json(json!({"token":session.token})).into_response()
}
async fn status(State(session): State<Arc<Session>>, headers: HeaderMap) -> Response {
    if !authorized(&headers, &session) {
        return error(StatusCode::UNAUTHORIZED, "请先输入配对码连接阅读树");
    }
    let records: Vec<_> = session
        .service
        .records
        .lock()
        .unwrap()
        .iter()
        .filter(|r| r.session == session.id)
        .cloned()
        .collect();
    Json(json!({"transfers":records})).into_response()
}
#[derive(Deserialize)]
struct UploadName {
    name: String,
}
struct PartialUpload {
    session: Arc<Session>,
    id: String,
    path: PathBuf,
    committed: bool,
}
impl Drop for PartialUpload {
    fn drop(&mut self) {
        if !self.committed {
            let _ = std::fs::remove_file(&self.path);
            if let Some(record) = self
                .session
                .service
                .records
                .lock()
                .unwrap()
                .iter_mut()
                .find(|r| r.id == self.id)
            {
                record.status = "failed".into();
                record.message = "上传中断或传书已关闭，请重新发送".into();
                self.session.service.changed();
            }
            (self.session.signal)();
        }
    }
}
async fn upload(
    State(session): State<Arc<Session>>,
    Query(input): Query<UploadName>,
    headers: HeaderMap,
    mut body: Body,
) -> Response {
    if !authorized(&headers, &session) {
        return error(StatusCode::UNAUTHORIZED, "请先输入配对码连接阅读树");
    }
    if !valid_name(&input.name) {
        return error(StatusCode::BAD_REQUEST, "文件名无效或不是支持的电子书格式");
    }
    let size = match headers
        .get(header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
    {
        Some(n) if n > 0 && n <= MAX_FILE => n,
        Some(_) => {
            return error(
                StatusCode::PAYLOAD_TOO_LARGE,
                "请选择非空且不超过 256 MiB 的电子书",
            )
        }
        None => {
            return error(
                StatusCode::LENGTH_REQUIRED,
                "无法确认文件大小，请重新选择文件上传",
            )
        }
    };
    let _permit = match session.uploads.clone().try_acquire_owned() {
        Ok(p) => p,
        Err(_) => {
            return error(
                StatusCode::TOO_MANY_REQUESTS,
                "正在接收其他书籍，请稍后重试",
            )
        }
    };
    let id = match random_hex() {
        Ok(id) => id,
        Err(e) => return error(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };
    let path = session.directory.join(&id);
    {
        let mut records = session.service.records.lock().unwrap();
        let pending: Vec<_> = records.iter().filter(|r| active(&r.status)).collect();
        if pending.len() >= 8 || pending.iter().map(|r| r.size).sum::<u64>() + size > MAX_STAGED {
            return error(
                StatusCode::TOO_MANY_REQUESTS,
                "待入架文件较多，请等待现有书籍入架后再发送",
            );
        }
        while records.len() >= 40 {
            if let Some(i) = records.iter().position(|r| !active(&r.status)) {
                records.remove(i);
            } else {
                break;
            }
        }
        records.push(Transfer {
            id: id.clone(),
            name: input.name,
            size,
            received: 0,
            status: "receiving".into(),
            message: String::new(),
            path: path.clone(),
            session: session.id.clone(),
        });
        session.service.changed();
    }
    let mut partial = PartialUpload {
        session: session.clone(),
        id: id.clone(),
        path: path.clone(),
        committed: false,
    };
    let mut file = match tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .await
    {
        Ok(f) => f,
        Err(_) => {
            return error(
                StatusCode::INSUFFICIENT_STORAGE,
                "无法写入接收文件，请检查存储空间",
            )
        }
    };
    (session.signal)();
    let mut received = 0u64;
    let mut emitted = Instant::now();
    let mut stopped = session.stop.subscribe();
    loop {
        if *stopped.borrow() {
            return error(StatusCode::GONE, "传书已关闭");
        }
        let frame = tokio::select! {_ = stopped.changed()=>return error(StatusCode::GONE,"传书已关闭"),result=tokio::time::timeout(Duration::from_secs(30),body.frame())=>result};
        match frame {
            Ok(Some(Ok(frame))) => {
                if let Ok(bytes) = frame.into_data() {
                    received += bytes.len() as u64;
                    if received > size || received > MAX_FILE {
                        return error(StatusCode::PAYLOAD_TOO_LARGE, "上传内容超过文件大小限制");
                    }
                    if file.write_all(&bytes).await.is_err() {
                        return error(StatusCode::INSUFFICIENT_STORAGE, "写入失败，请检查存储空间");
                    }
                    if let Some(r) = session
                        .service
                        .records
                        .lock()
                        .unwrap()
                        .iter_mut()
                        .find(|r| r.id == id)
                    {
                        r.received = received;
                        session.service.changed();
                    }
                    if emitted.elapsed() > Duration::from_millis(500) {
                        (session.signal)();
                        emitted = Instant::now();
                    }
                }
            }
            Ok(None) => break,
            _ => return error(StatusCode::REQUEST_TIMEOUT, "上传中断或超时，请重试"),
        }
    }
    if received != size {
        return error(StatusCode::BAD_REQUEST, "文件接收不完整，请重新发送");
    }
    if file.flush().await.is_err() {
        return error(StatusCode::INSUFFICIENT_STORAGE, "无法保存接收文件");
    }
    drop(file);
    if let Some(r) = session
        .service
        .records
        .lock()
        .unwrap()
        .iter_mut()
        .find(|r| r.id == id)
    {
        r.status = "queued".into();
        r.received = received;
        session.service.changed();
    }
    partial.committed = true;
    (session.signal)();
    Json(json!({"id":id,"status":"queued"})).into_response()
}

#[tauri::command]
pub async fn wifi_state(state: tauri::State<'_, WifiState>) -> Result<Snapshot, String> {
    Ok(state.0.snapshot().await)
}
#[tauri::command]
pub async fn wifi_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, WifiState>,
) -> Result<Snapshot, String> {
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|_| "无法读取应用缓存目录")?
        .join("wifi-transfer");
    let handle = app.clone();
    let signal: Signal = Arc::new(move || {
        let _ = handle.emit("wifi-transfer", ());
    });
    state.0.start(directory, addresses()?, signal).await
}
#[tauri::command]
pub async fn wifi_stop(state: tauri::State<'_, WifiState>) -> Result<Snapshot, String> {
    Ok(state.0.stop().await)
}
#[tauri::command]
pub fn wifi_take(state: tauri::State<'_, WifiState>) -> Vec<Transfer> {
    state.0.take()
}
#[tauri::command]
pub async fn wifi_read_chunk(
    state: tauri::State<'_, WifiState>,
    id: String,
    offset: u64,
) -> Result<tauri::ipc::Response, String> {
    let service = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        service
            .read_chunk(&id, offset)
            .map(tauri::ipc::Response::new)
    })
    .await
    .map_err(|_| "接收文件读取失败".to_string())?
}
#[tauri::command]
pub async fn wifi_complete(
    app: tauri::AppHandle,
    state: tauri::State<'_, WifiState>,
    id: String,
    success: bool,
    message: String,
) -> Result<Snapshot, String> {
    state.0.complete(&id, success, &message);
    let _ = app.emit("wifi-transfer", ());
    Ok(state.0.snapshot().await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    async fn fixture() -> (Arc<Service>, Snapshot, PathBuf) {
        let service = Arc::new(Service::default());
        let dir =
            std::env::temp_dir().join(format!("reading-tree-wifi-test-{}", random_hex().unwrap()));
        let snapshot = service
            .start(dir.clone(), vec![Ipv4Addr::LOCALHOST], Arc::new(|| {}))
            .await
            .unwrap();
        (service, snapshot, dir)
    }
    async fn port(service: &Service) -> u16 {
        service.running.lock().await.as_ref().unwrap().session.hosts[0]
            .rsplit(':')
            .next()
            .unwrap()
            .parse()
            .unwrap()
    }
    async fn request(
        port: u16,
        method: &str,
        path: &str,
        extra: &str,
        body: &[u8],
    ) -> (u16, String) {
        let mut stream = tokio::net::TcpStream::connect((Ipv4Addr::LOCALHOST, port))
            .await
            .unwrap();
        let header=format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\nContent-Length: {}\r\n{extra}\r\n",body.len());
        stream.write_all(header.as_bytes()).await.unwrap();
        stream.write_all(body).await.unwrap();
        let mut data = vec![];
        tokio::time::timeout(Duration::from_secs(5), stream.read_to_end(&mut data))
            .await
            .unwrap()
            .unwrap();
        let text = String::from_utf8_lossy(&data);
        let status = text.split_whitespace().nth(1).unwrap().parse().unwrap();
        (status, text.split_once("\r\n\r\n").unwrap().1.to_owned())
    }
    async fn token(service: &Service, p: u16, code: &str) -> String {
        let (status, body) = request(
            p,
            "POST",
            "/pair",
            "Content-Type: application/json\r\n",
            json!({"code":code}).to_string().as_bytes(),
        )
        .await;
        assert_eq!(status, 200);
        let token = serde_json::from_str::<serde_json::Value>(&body).unwrap()["token"]
            .as_str()
            .unwrap()
            .to_owned();
        assert_eq!(token.len(), 64);
        assert_eq!(
            service.running.lock().await.as_ref().unwrap().session.token,
            token
        );
        token
    }
    #[tokio::test]
    async fn authenticated_upload_queue_chunks_and_acknowledgement() {
        let (service, snapshot, dir) = fixture().await;
        let p = port(&service).await;
        assert!(snapshot.running);
        assert_eq!(snapshot.code.len(), 8);
        let (status, page) = request(p, "GET", "/", "", b"").await;
        assert_eq!(status, 200);
        assert!(page.contains("上传并入架"));
        assert!(!page.contains(&snapshot.code));
        assert_eq!(
            request(p, "POST", "/upload?name=book.txt", "", b"book")
                .await
                .0,
            401
        );
        let t = token(&service, p, &snapshot.code).await;
        let auth = format!("Authorization: Bearer {t}\r\n");
        let (status, body) = request(
            p,
            "POST",
            "/upload?name=%E6%B5%8B%E8%AF%95%20%E4%B9%A6.txt",
            &auth,
            "第一章\n正文".as_bytes(),
        )
        .await;
        assert_eq!(status, 200);
        let id = serde_json::from_str::<serde_json::Value>(&body).unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let files = service.take();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "测试 书.txt");
        assert_eq!(files[0].status, "importing");
        assert!(service.take().is_empty());
        assert_eq!(
            String::from_utf8(service.read_chunk(&id, 0).unwrap()).unwrap(),
            "第一章\n正文"
        );
        assert!(service.read_chunk("../secret", 0).is_err());
        service.complete(&id, true, "已入架：测试书");
        assert!(!files[0].path.exists());
        assert!(service.read_chunk(&id, 0).is_err());
        let (status, body) = request(p, "GET", "/status", &auth, b"").await;
        assert_eq!(status, 200);
        assert!(body.contains("imported"));
        assert!(body.contains("已入架"));
        assert!(!body.contains("path"));
        service.stop().await;
        assert!(tokio::net::TcpStream::connect((Ipv4Addr::LOCALHOST, p))
            .await
            .is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
    #[tokio::test]
    async fn bad_names_origins_pairing_and_restarts_are_rejected() {
        let (service, snapshot, dir) = fixture().await;
        let p = port(&service).await;
        let t = token(&service, p, &snapshot.code).await;
        let auth = format!("Authorization: Bearer {t}\r\n");
        for name in ["../book.txt", "app.exe", "book.zip", ""] {
            assert_eq!(
                request(p, "POST", &format!("/upload?name={name}"), &auth, b"x")
                    .await
                    .0,
                400
            );
        }
        assert_eq!(
            request(p, "POST", "/upload?name=empty.txt", &auth, b"")
                .await
                .0,
            413
        );
        assert_eq!(
            request(
                p,
                "GET",
                "/status",
                &format!("{auth}Origin: https://evil.test\r\n"),
                b""
            )
            .await
            .0,
            403
        );
        for _ in 0..6 {
            assert_eq!(
                request(
                    p,
                    "POST",
                    "/pair",
                    "Content-Type: application/json\r\n",
                    br#"{"code":"wrong"}"#
                )
                .await
                .0,
                401
            );
        }
        assert_eq!(
            request(
                p,
                "POST",
                "/pair",
                "Content-Type: application/json\r\n",
                json!({"code":snapshot.code}).to_string().as_bytes()
            )
            .await
            .0,
            429
        );
        assert!(service.records.lock().unwrap().is_empty());
        service.stop().await;
        service
            .start(dir.clone(), vec![Ipv4Addr::LOCALHOST], Arc::new(|| {}))
            .await
            .unwrap();
        let p = port(&service).await;
        assert_eq!(request(p, "GET", "/status", &auth, b"").await.0, 401);
        service.stop().await;
        let _ = std::fs::remove_dir_all(dir);
    }
    #[tokio::test]
    async fn stopping_mid_upload_removes_partial_file_and_does_not_enqueue() {
        let (service, snapshot, dir) = fixture().await;
        let p = port(&service).await;
        let t = token(&service, p, &snapshot.code).await;
        let mut stream = tokio::net::TcpStream::connect((Ipv4Addr::LOCALHOST, p))
            .await
            .unwrap();
        stream.write_all(format!("POST /upload?name=unfinished.txt HTTP/1.1\r\nHost: 127.0.0.1:{p}\r\nAuthorization: Bearer {t}\r\nContent-Length: 1048576\r\n\r\npartial").as_bytes()).await.unwrap();
        for _ in 0..50 {
            if !service.records.lock().unwrap().is_empty() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(!service.records.lock().unwrap().is_empty());
        service.stop().await;
        assert!(service.take().is_empty());
        assert!(tokio::net::TcpStream::connect((Ipv4Addr::LOCALHOST, p))
            .await
            .is_err());
        for _ in 0..50 {
            if std::fs::read_dir(&dir).unwrap().count() == 0 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
        drop(stream);
        let _ = std::fs::remove_dir_all(dir);
    }
    #[tokio::test]
    async fn completed_upload_survives_stop_and_restart_until_import_ack() {
        let (service, snapshot, dir) = fixture().await;
        let p = port(&service).await;
        let t = token(&service, p, &snapshot.code).await;
        assert_eq!(
            request(
                p,
                "POST",
                "/upload?name=queued.txt",
                &format!("Authorization: Bearer {t}\r\n"),
                b"complete book"
            )
            .await
            .0,
            200
        );
        service.stop().await;
        assert!(tokio::net::TcpStream::connect((Ipv4Addr::LOCALHOST, p))
            .await
            .is_err());
        service
            .start(dir.clone(), vec![Ipv4Addr::LOCALHOST], Arc::new(|| {}))
            .await
            .unwrap();
        let files = service.take();
        assert_eq!(files.len(), 1);
        assert_eq!(
            service.read_chunk(&files[0].id, 0).unwrap(),
            b"complete book"
        );
        service.complete(&files[0].id, false, "不支持的书籍内容");
        assert!(!files[0].path.exists());
        assert_eq!(service.snapshot().await.transfers[0].status, "failed");
        service.stop().await;
        let _ = std::fs::remove_dir_all(dir);
    }
    #[tokio::test]
    async fn oversized_declared_body_is_rejected_before_creating_a_file() {
        let (service, snapshot, dir) = fixture().await;
        let p = port(&service).await;
        let t = token(&service, p, &snapshot.code).await;
        let mut stream = tokio::net::TcpStream::connect((Ipv4Addr::LOCALHOST, p))
            .await
            .unwrap();
        stream.write_all(format!("POST /upload?name=oversized.txt HTTP/1.1\r\nHost: 127.0.0.1:{p}\r\nAuthorization: Bearer {t}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",MAX_FILE+1).as_bytes()).await.unwrap();
        let mut bytes = vec![0; 1024];
        let count = tokio::time::timeout(Duration::from_secs(3), stream.read(&mut bytes))
            .await
            .unwrap()
            .unwrap();
        assert!(String::from_utf8_lossy(&bytes[..count]).starts_with("HTTP/1.1 413"));
        assert!(service.records.lock().unwrap().is_empty());
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
        drop(stream);
        service.stop().await;
        let _ = std::fs::remove_dir_all(dir);
    }
    #[test]
    fn file_names_and_lan_boundaries() {
        assert!(valid_name("中文 书.fb2.zip"));
        assert!(!valid_name("../book.txt"));
        assert!(!valid_name("book.txt\n"));
        assert!(!valid_name("book.rar"));
        assert!(lan(Ipv4Addr::new(192, 168, 1, 2)));
        assert!(lan(Ipv4Addr::new(100, 64, 1, 2)));
        assert!(!lan(Ipv4Addr::new(8, 8, 8, 8)));
    }
}
