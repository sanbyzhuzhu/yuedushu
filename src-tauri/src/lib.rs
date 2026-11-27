mod app_updater;
mod wifi_transfer;

#[cfg(desktop)]
mod desktop {
  use tauri::{menu::{Menu, MenuItem}, tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent}, Manager};

  pub struct TrayState(pub bool);

  fn show(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
      let _ = window.show();
      let _ = window.unminimize();
      let _ = window.set_focus();
    }
  }

  pub fn setup(app: &mut tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "show", "打开阅读树", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出阅读树", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut builder = TrayIconBuilder::with_id("reading-tree")
      .tooltip("阅读树 · 单击打开，右键退出")
      .menu(&menu)
      .show_menu_on_left_click(false)
      .on_menu_event(|app, event| match event.id.as_ref() {
        "show" => show(app),
        "quit" => app.exit(0),
        _ => {}
      })
      .on_tray_icon_event(|tray, event| {
        if matches!(event, TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. }) {
          show(tray.app_handle());
        }
      });
    if let Some(icon) = app.default_window_icon() { builder = builder.icon(icon.clone()); }
    // If a desktop has no usable tray, leave the window recoverable in its taskbar.
    let ready = match builder.build(app) { Ok(_) => true, Err(e) => { log::warn!("Tray unavailable: {e}"); false } };
    app.manage(TrayState(ready));
    Ok(())
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![exit_desktop, open_book_website, read_import_file, open_update_url, app_updater::download_app_update, app_updater::cancel_app_update, app_updater::install_app_update, wifi_transfer::wifi_state, wifi_transfer::wifi_start, wifi_transfer::wifi_stop, wifi_transfer::wifi_take, wifi_transfer::wifi_read_chunk, wifi_transfer::wifi_complete])
    .plugin(tauri_plugin_http::init())
    .setup(|app| {
      {
        use tauri::Manager;
        app.manage(wifi_transfer::WifiState::default());
      }
      #[cfg(desktop)]
      app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
      #[cfg(windows)]
      {
        use tauri::Manager;
        app.manage(app_updater::UpdateState::default());
      }
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      #[cfg(desktop)]
      desktop::setup(app)?;
      Ok(())
    })
    .on_window_event(|window, event| {
      #[cfg(desktop)]
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        use tauri::Manager;
        api.prevent_close();
        if window.try_state::<desktop::TrayState>().is_some_and(|state| state.0) {
          if window.hide().is_err() { let _ = window.minimize(); }
        } else {
          let _ = window.minimize();
        }
      }
      #[cfg(mobile)]
      let _ = (window, event);
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[tauri::command]
async fn read_import_file(path: String) -> Result<tauri::ipc::Response, String> {
  tauri::async_runtime::spawn_blocking(move || {
    use std::io::Read;
    let path = std::path::Path::new(&path);
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if !matches!(ext.as_str(), "epub" | "txt" | "md" | "markdown" | "docx" | "pdf" | "mobi" | "azw" | "azw3" | "prc" | "fb2" | "zip" | "cbz" | "updb" | "ofd" | "odt" | "html" | "htm" | "xhtml") {
      return Err("不支持的书籍格式".to_string());
    }
    let file = std::fs::File::open(path).map_err(|_| "无法读取文件，请检查文件权限".to_string())?;
    let meta = file.metadata().map_err(|_| "无法读取文件信息".to_string())?;
    const LIMIT: u64 = 256 * 1024 * 1024;
    if !meta.is_file() || meta.len() > LIMIT { return Err("请选择不超过 256 MiB 的书籍文件".into()); }
    let mut bytes = Vec::new();
    file.take(LIMIT + 1).read_to_end(&mut bytes).map_err(|_| "读取书籍失败".to_string())?;
    if bytes.len() as u64 > LIMIT { return Err("书籍超过 256 MiB".into()); }
    Ok(tauri::ipc::Response::new(bytes))
  }).await.map_err(|_| "读取书籍任务失败".to_string())?
}

#[tauri::command]
fn exit_desktop(app: tauri::AppHandle) {
  #[cfg(desktop)]
  app.exit(0);
  #[cfg(mobile)]
  let _ = app;
}

#[tauri::command]
fn open_book_website(site: String) -> Result<(), String> {
  let url = match site.as_str() {
    "haodoo-net" => "https://haodoo.net/",
    "haodoo-org" => "https://haodoo.org/",
    "standard-ebooks" => "https://standardebooks.org/ebooks",
    "national-library" => "https://www.nlc.cn/",
    "wikisource" => "https://zh.wikisource.org/",
    "ctext" => "https://ctext.org/zh",
    "github" => "https://github.com/",
    "shuge" => "https://shuge.org/",
    "gutenberg-australia" => "https://gutenberg.net.au/",
    "faded-page" => "https://www.fadedpage.com/",
    "gutenberg-canada" => "https://www.gutenberg.ca/",
    "internet-archive" => "https://archive.org/details/texts",
    _ if valid_haodoo_page(&site) => site.as_str(),
    _ => return Err("不支持的书库网站".into()),
  };
  #[cfg(target_os = "windows")]
  {
    use std::os::windows::process::CommandExt;
    std::process::Command::new("rundll32.exe").args(["url.dll,FileProtocolHandler", url])
      .creation_flags(0x08000000).spawn().map_err(|_| "未能打开系统浏览器".to_string())?;
    Ok(())
  }
  #[cfg(not(target_os = "windows"))]
  { let _ = url; Err("请从系统浏览器打开书库网站".into()) }
}

fn valid_haodoo_page(value: &str) -> bool {
  if let Ok(url) = tauri::Url::parse(value) {
    url.scheme() == "https" && url.username().is_empty() && url.password().is_none()
      && matches!(url.host_str(), Some("haodoo.net" | "haodoo.org" | "zh.wikisource.org" | "ctext.org" | "github.com" | "standardebooks.org" | "shuge.org" | "gutenberg.net.au" | "www.fadedpage.com" | "www.gutenberg.ca" | "archive.org" | "www.nlc.cn")) && url.port().is_none()
  } else { false }
}

#[tauri::command]
fn open_update_url(address: String) -> Result<(), String> {
  let url = tauri::Url::parse(&address).map_err(|_| "更新下载地址不正确".to_string())?;
  if url.scheme() != "https" || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() {
    return Err("更新下载地址必须是公开的 HTTPS 链接".into());
  }
  #[cfg(target_os = "windows")]
  {
    use std::os::windows::process::CommandExt;
    std::process::Command::new("rundll32.exe").args(["url.dll,FileProtocolHandler", url.as_str()])
      .creation_flags(0x08000000).spawn().map_err(|_| "未能打开系统浏览器".to_string())?;
    Ok(())
  }
  #[cfg(not(target_os = "windows"))]
  { Err("请使用安卓或 Windows 安装版打开更新地址".into()) }
}
