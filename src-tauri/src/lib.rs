use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
};
#[cfg(target_os = "macos")]
use tauri::menu::{AboutMetadata, Submenu};
use tauri_plugin_notification::NotificationExt;

static ALLOW_EXIT: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppStatePayload {
    pub active_mode: String,
    pub is_running: bool,
    pub breaks_completed: u32,
    pub eye_rests_completed: u32,
    pub posture_streak: u32,
}

#[tauri::command]
fn show_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn hide_to_tray(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn quit_app() {
    ALLOW_EXIT.store(true, Ordering::SeqCst);
    log_debug("Explicit quit_app command invoked -> exiting process");
    std::process::exit(0);
}

#[tauri::command]
fn update_tray_status(app: AppHandle, title: String, tooltip: String) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("main-tray") {
        #[cfg(target_os = "macos")]
        {
            let _ = tray.set_title(Some(&title));
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = &title;
        }
        let _ = tray.set_tooltip(Some(&tooltip));
    }
    Ok(())
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("Only secure HTTP/HTTPS URLs are allowed".to_string());
    }
    log_debug(&format!("Opening external research URL: {}", url));
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(&url).spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("cmd").args(&["/C", "start", "", &url]).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open").arg(&url).spawn();
    }
    Ok(())
}

#[tauri::command]
fn trigger_break_notification(
    _app: AppHandle,
    title: String,
    body: String,
    sound_enabled: Option<bool>,
) -> Result<(), String> {
    let play_sound = sound_enabled.unwrap_or(true);
    log_debug(&format!(
        "trigger_break_notification: '{}' - '{}' (sound: {})",
        title, body, play_sound
    ));

    // Instant audible cue on macOS
    if play_sound {
        #[cfg(target_os = "macos")]
        {
            let _ = std::process::Command::new("afplay")
                .arg("/System/Library/Sounds/Ping.aiff")
                .spawn();
        }
    }

    // macOS native notifications with the new spine/eye logo
    #[cfg(target_os = "macos")]
    {
        // Write the new spine/eye logo to temp dir so macOS Notification Center can load it as content_image
        let icon_path = std::env::temp_dir().join("spine-eye-notification-icon.png");
        let _ = std::fs::write(&icon_path, include_bytes!("../icons/icon.png"));

        let mut mac_notif = notify_rust::Notification::new();
        mac_notif
            .summary(&title)
            .body(&body)
            .image_path(&icon_path.to_string_lossy());
        if play_sound {
            mac_notif.sound_name("Ping");
        }
        let _ = notify_rust::set_application("com.spine-eye.desktop");

        let res = mac_notif.show();
        if let Err(e) = res {
            log_debug(&format!(
                "notify_rust macOS error: {}. Executing AppleScript fallback with Spine and Eye bundle identity.",
                e
            ));
            let clean_title = title.replace('\\', "\\\\").replace('\"', "\\\"");
            let clean_body = body.replace('\\', "\\\\").replace('\"', "\\\"");
            let sound_clause = if play_sound { " sound name \"Ping\"" } else { "" };

            // Target application Spine and Eye to display notification with app bundle icon.icns (new spine/eye logo)
            let app_script = format!(
                "tell application \"Spine and Eye\" to display notification \"{}\" with title \"{}\"{}",
                clean_body, clean_title, sound_clause
            );
            let app_res = std::process::Command::new("osascript")
                .arg("-e")
                .arg(&app_script)
                .status();

            if app_res.map(|s| !s.success()).unwrap_or(true) {
                let fallback_script = format!(
                    "display notification \"{}\" with title \"{}\"{}",
                    clean_body, clean_title, sound_clause
                );
                let _ = std::process::Command::new("osascript")
                    .arg("-e")
                    .arg(fallback_script)
                    .spawn();
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let mut builder = _app.notification().builder();
        builder = builder.title(&title).body(&body).icon("icon".to_string());
        if play_sound {
            builder = builder.sound("default".to_string());
        }
        let _ = builder.show();
    }

    Ok(())
}

#[tauri::command]
fn get_clinical_foundation() -> serde_json::Value {
    serde_json::json!({
        "institutions": [
            {
                "name": "Cornell University Ergonomics Web (CUErgo)",
                "lead": "Prof. Alan Hedge",
                "rules": ["The 20-8-2 Sit-Stand-Move ratio", "Neutral Joint Posture Standards", "Microbreak Capillary Perfusion"]
            },
            {
                "name": "American Academy of Ophthalmology (AAO)",
                "focus": "Computer Vision Syndrome & Digital Eye Strain",
                "rules": ["The 20-20-20 Rule", "Conscious Blink Tear Film Restoration", "Extraocular Muscle Smooth Pursuit"]
            },
            {
                "name": "Ergonomics Research (Macro Ratio)",
                "focus": "Deep Cognitive Work Posture Transitions",
                "rules": ["Macro Ratio (45 min Sit, 15 min Stand)", "Sustained Cognitive Continuity"]
            }
        ]
    })
}

#[tauri::command]
fn get_app_version_string() -> String {
    get_app_version()
}

pub fn get_app_version() -> String {
    let base = env!("CARGO_PKG_VERSION");
    let build_num = option_env!("VITE_BUILD_NUMBER")
        .or(option_env!("APP_BUILD_NUMBER"))
        .or(option_env!("GITHUB_RUN_NUMBER"));
    let commit_sha = option_env!("VITE_COMMIT_SHA")
        .or(option_env!("APP_COMMIT_SHA"))
        .or(option_env!("GITHUB_SHA"));

    let mut version = format!("v{}", base);
    if let Some(b) = build_num {
        if !b.is_empty() {
            version.push_str(&format!(" • Build #{}", b));
            if let Some(sha) = commit_sha {
                if !sha.is_empty() {
                    let short_sha = if sha.len() >= 7 { &sha[..7] } else { sha };
                    version.push_str(&format!(" ({})", short_sha));
                }
            }
        }
    }
    version
}

#[cfg(target_os = "macos")]
fn setup_app_menu(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle();
    let app_name = "Spine and Eye";
    let app_version = get_app_version();

    let about_metadata = AboutMetadata {
        name: Some(app_name.to_string()),
        version: Some(app_version),
        short_version: Some(env!("CARGO_PKG_VERSION").to_string()),
        authors: Some(vec!["Spine and Eye Team".to_string()]),
        comments: Some("Clinical Ergonomics & Ocular Companion".to_string()),
        copyright: Some("Copyright © 2026 Raul E. Blanco".to_string()),
        license: Some("MIT License".to_string()),
        website: Some("https://github.com/rauleblanco/spine-eye-app".to_string()),
        website_label: Some("GitHub Repository".to_string()),
        ..Default::default()
    };

    let about_title = format!("About {}", app_name);
    let hide_title = format!("Hide {}", app_name);
    let quit_title = format!("Quit {}", app_name);

    let item_about = PredefinedMenuItem::about(
        handle,
        Some(&about_title),
        Some(about_metadata),
    )?;

    let app_submenu = Submenu::with_items(
        handle,
        app_name,
        true,
        &[
            &item_about,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::services(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::hide(handle, Some(&hide_title))?,
            &PredefinedMenuItem::hide_others(handle, None)?,
            &PredefinedMenuItem::show_all(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::quit(handle, Some(&quit_title))?,
        ],
    )?;

    let file_submenu = Submenu::with_items(
        handle,
        "File",
        true,
        &[
            &PredefinedMenuItem::close_window(handle, None)?,
        ],
    )?;

    let edit_submenu = Submenu::with_items(
        handle,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(handle, None)?,
            &PredefinedMenuItem::redo(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::cut(handle, None)?,
            &PredefinedMenuItem::copy(handle, None)?,
            &PredefinedMenuItem::paste(handle, None)?,
            &PredefinedMenuItem::select_all(handle, None)?,
        ],
    )?;

    let window_submenu = Submenu::with_items(
        handle,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(handle, None)?,
            &PredefinedMenuItem::fullscreen(handle, None)?,
        ],
    )?;

    let menu = Menu::with_items(handle, &[&app_submenu, &file_submenu, &edit_submenu, &window_submenu])?;
    app.set_menu(menu)?;

    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn setup_app_menu(_app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}

fn log_debug(msg: &str) {
    eprintln!("[Spine & Eye] {}", msg);
    #[cfg(target_os = "macos")]
    {
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open("/tmp/spine-eye-debug.log")
        {
            let _ = writeln!(f, "[Spine & Eye] {}", msg);
        }
    }
}

fn setup_system_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let item_status = MenuItem::with_id(
        app,
        "status_title",
        "Spine and Eye: Active (AAO and CUErgo)",
        false,
        None::<&str>,
    )?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let item_start_both = MenuItem::with_id(
        app,
        "start_both",
        "Start Vision and Posture",
        true,
        None::<&str>,
    )?;
    let item_take_break = MenuItem::with_id(
        app,
        "take_break",
        "Take Clinical Break Now",
        true,
        None::<&str>,
    )?;
    let item_pause_all = MenuItem::with_id(
        app,
        "pause_all",
        "Pause All Timers",
        true,
        None::<&str>,
    )?;
    let item_resume_all = MenuItem::with_id(
        app,
        "resume_all",
        "Resume All Timers",
        true,
        None::<&str>,
    )?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let item_show = MenuItem::with_id(
        app,
        "show_dashboard",
        "Show Dashboard",
        true,
        None::<&str>,
    )?;
    let item_hide = MenuItem::with_id(
        app,
        "hide_tray",
        "Hide to Menu Bar / Taskbar",
        true,
        None::<&str>,
    )?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let item_quit = MenuItem::with_id(
        app,
        "quit_app",
        "Quit Spine and Eye",
        true,
        None::<&str>,
    )?;

    let tray_menu = Menu::with_items(
        app,
        &[
            &item_status,
            &sep1,
            &item_start_both,
            &item_take_break,
            &item_pause_all,
            &item_resume_all,
            &sep2,
            &item_show,
            &item_hide,
            &sep3,
            &item_quit,
        ],
    )?;

    let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))
        .ok()
        .or_else(|| tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png")).ok())
        .or_else(|| app.default_window_icon().cloned());

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("Spine and Eye - Clinical Ergonomics Companion")
        .icon_as_template(true)
        .menu(&tray_menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app_handle, event| {
            let event_id = event.id().as_ref();
            log_debug(&format!("Tray menu event: {}", event_id));
            match event_id {
                "start_both" => {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.emit("tray-start-both", ());
                    }
                }
                "take_break" => {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                        let _ = window.emit("tray-take-break", ());
                    }
                }
                "pause_all" => {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.emit("tray-pause-duration", 30);
                    }
                }
                "resume_all" => {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.emit("tray-resume", ());
                    }
                }
                "show_dashboard" => {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "hide_tray" => {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.hide();
                    }
                }
                "quit_app" => {
                    ALLOW_EXIT.store(true, Ordering::SeqCst);
                    log_debug("Quitting application from tray -> exit(0)");
                    std::process::exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(move |tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app_handle = tray.app_handle();
                if let Some(window) = app_handle.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        });

    if let Some(icon) = tray_icon {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    log_debug("Launching Spine & Eye run()");

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            show_main_window,
            hide_to_tray,
            quit_app,
            update_tray_status,
            open_external_url,
            trigger_break_notification,
            get_clinical_foundation,
            get_app_version_string
        ])
        .setup(|app| {
            log_debug("Tauri setup hook invoked");

            #[cfg(target_os = "macos")]
            {
                log_debug("Setting ActivationPolicy::Regular on macOS");
                let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
            }

            // Window close interception & initial presentation
            log_debug("Configuring main window presentation");
            if let Some(w) = app.get_webview_window("main") {
                let w_clone = w.clone();
                w.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = w_clone.hide();
                    }
                });

                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.center();
                let _ = w.set_focus();
                log_debug("Main window show(), center(), set_focus() completed");
            } else {
                log_debug("Warning: 'main' webview window not found in app setup");
            }

            // Setup System Tray Menu with Quick Actions
            log_debug("Initializing system tray");
            if let Err(e) = setup_system_tray(app) {
                log_debug(&format!("Warning: Could not initialize system tray: {}", e));
            } else {
                log_debug("System tray initialized successfully");
            }

            // Setup macOS Application Menu with dynamically resolved build version
            log_debug("Initializing application menu");
            if let Err(e) = setup_app_menu(app) {
                log_debug(&format!("Warning: Could not initialize app menu: {}", e));
            } else {
                log_debug("Application menu initialized successfully");
            }

            // Spawn background heartbeat tick thread to keep webview active and prevent throttling
            let app_handle_for_tick = app.handle().clone();
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(1));
                    let _ = app_handle_for_tick.emit("rust-heartbeat-tick", ());
                }
            });

            Ok(())
        });

    log_debug("Calling builder.build(context)...");
    let app = match builder.build(tauri::generate_context!()) {
        Ok(a) => {
            log_debug("Tauri application built successfully!");
            a
        }
        Err(e) => {
            let err_msg = format!("FATAL ERROR in tauri::Builder::build: {:#?}", e);
            log_debug(&err_msg);
            eprintln!("{}", err_msg);
            panic!("{}", err_msg);
        }
    };

    log_debug("Starting event loop with ExitRequested interception");
    app.run(|_app_handle, event| {
        match event {
            tauri::RunEvent::ExitRequested { api, .. } => {
                if !ALLOW_EXIT.load(Ordering::SeqCst) {
                    log_debug("ExitRequested intercepted (window close) -> api.prevent_exit()");
                    api.prevent_exit();
                } else {
                    log_debug("ExitRequested allowed -> process exiting cleanly");
                }
            }
            _ => {}
        }
    });
}
