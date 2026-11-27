use tauri::ipc::Channel;
use serde_json::Value;
#[cfg(windows)]
use serde_json::json;

#[cfg(windows)]
use {std::sync::{Mutex, atomic::{AtomicBool, Ordering}}, tauri::Manager, tauri_plugin_updater::UpdaterExt};

#[cfg(windows)]
#[derive(Default)]
pub struct UpdateState {
  running: AtomicBool,
  cancelled: AtomicBool,
  cancel: tokio::sync::Notify,
  ready: Mutex<Option<(tauri_plugin_updater::Update, Vec<u8>)>>,
}

#[tauri::command]
pub async fn download_app_update(app: tauri::AppHandle, source: String, version: String, on_event: Channel<Value>) -> Result<(), String> {
  #[cfg(windows)]
  {
    let endpoint = tauri::Url::parse(&source).map_err(|_| "更新地址不正确")?;
    if endpoint.scheme() != "https" || !endpoint.username().is_empty() || endpoint.password().is_some() { return Err("更新源需使用 HTTPS".into()); }
    let state = app.state::<UpdateState>();
    if state.running.swap(true, Ordering::SeqCst) { return Err("已有更新正在下载".into()); }
    state.cancelled.store(false, Ordering::SeqCst);
    state.ready.lock().map_err(|_| "无法读取更新状态")?.take();
    let task = async {
      let update = app.updater_builder().endpoints(vec![endpoint]).map_err(|e| e.to_string())?
        .timeout(std::time::Duration::from_secs(300))
        .configure_client(|client| client.https_only(true))
        .build().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?
        .ok_or("未找到较新版本，请重新检查更新")?;
      if update.version != version { return Err("版本信息已变化，请重新检查后下载".into()); }
      if update.download_url.scheme() != "https" { return Err("安装包需使用 HTTPS".into()); }
      let mut received = 0u64;
      let bytes = update.download(|count, total| {
        received += count as u64;
        if received > 256 * 1024 * 1024 || total.unwrap_or(0) > 256 * 1024 * 1024 { state.cancelled.store(true, Ordering::SeqCst); state.cancel.notify_one(); }
        let _ = on_event.send(json!({"status":"downloading","version":version,"bytes":received,"total":total.unwrap_or(0)}));
      }, || {}).await.map_err(|e| format!("下载或签名校验失败：{e}"))?;
      if received > 256 * 1024 * 1024 { return Err("安装包超过 256 MiB".into()); }
      *state.ready.lock().map_err(|_| "无法保存更新状态")? = Some((update, bytes));
      Ok(())
    };
    let result = tokio::select! {
      biased;
      _ = async { while !state.cancelled.load(Ordering::SeqCst) { state.cancel.notified().await; } } => Err("已取消下载或安装包超过 256 MiB".to_string()),
      result = task => result,
    };
    state.running.store(false, Ordering::SeqCst);
    result
  }
  #[cfg(not(windows))]
  { let _ = (app, source, version, on_event); Err("本平台请使用安卓应用内下载或浏览器下载".into()) }
}

#[tauri::command]
pub fn cancel_app_update(app: tauri::AppHandle) {
  #[cfg(windows)]
  {
    let state = app.state::<UpdateState>();
    if state.running.load(Ordering::SeqCst) { state.cancelled.store(true, Ordering::SeqCst); state.cancel.notify_one(); }
    if let Ok(mut ready) = state.ready.lock() { ready.take(); };
  }
  #[cfg(not(windows))]
  let _ = app;
}

#[tauri::command]
pub async fn install_app_update(app: tauri::AppHandle, version: String) -> Result<(), String> {
  #[cfg(windows)]
  {
    let state = app.state::<UpdateState>();
    let ready = state.ready.lock().map_err(|_| "无法读取更新状态")?.take().ok_or("请先下载并校验安装包")?;
    if ready.0.version != version { return Err("安装版本与下载版本不一致，请重新下载".into()); }
    // The official updater verifies the signed version before staging, launches
    // NSIS with quiet mode, then exits only after the installer starts successfully.
    if let Err(error) = ready.0.install(&ready.1) {
      *state.ready.lock().map_err(|_| "无法恢复更新状态")? = Some(ready);
      return Err(format!("安装启动失败：{error}"));
    }
    Ok(())
  }
  #[cfg(not(windows))]
  { let _ = (app, version); Err("请使用系统安装确认".into()) }
}
