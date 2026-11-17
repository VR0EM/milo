mod archive;
mod backup;
mod commands;
mod csv_export;
mod db;
mod error;
mod export;
mod history;
mod ics;
mod importer;
mod insights;
mod mcp;
mod menubar;
mod models;
mod reminders;
mod repo;
mod search;
mod series;
mod suggest;

use db::Db;
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};
use tauri_plugin_notification::NotificationExt;

/// One silent system notification. No sound is ever set.
pub(crate) fn notify(app: &AppHandle, title: &str, body: &str) {
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        eprintln!("notification failed: {e}");
    }
}

pub(crate) fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Where the app keeps its data, without the app running: the same folder Tauri gives
/// (`app_data_dir`), or `MILO_DATA_DIR` when set (for tests).
fn data_dir() -> Option<std::path::PathBuf> {
    if let Some(d) = std::env::var_os("MILO_DATA_DIR") {
        return Some(d.into());
    }
    let id = "app.milo.desktop";
    #[cfg(target_os = "macos")]
    let base = std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join("Library/Application Support"));
    #[cfg(windows)]
    let base = std::env::var_os("APPDATA").map(std::path::PathBuf::from);
    #[cfg(not(any(target_os = "macos", windows)))]
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(".local/share")));
    base.map(|b| b.join(id))
}

/// `milo --mcp`: Milo as an MCP server for AI apps, without a window (see mcp.rs).
pub fn run_mcp() -> i32 {
    let Some(dir) = data_dir() else {
        eprintln!("Milo: cannot find the data folder");
        return 1;
    };
    let path = dir.join("milo.sqlite");
    if !path.exists() && std::env::var_os("MILO_DATA_DIR").is_none() {
        eprintln!("Milo: open Milo once before connecting an AI app ({} does not exist)", path.display());
        return 1;
    }
    if let Err(e) = std::fs::create_dir_all(&dir) {
        eprintln!("Milo: {e}");
        return 1;
    }
    match db::open(&path).and_then(|c| mcp::serve(&c)) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("Milo: {e}");
            1
        }
    }
}

/// Windows: Tauri turns WebView2's pinch off together with its zoom keys, and then a pinch on
/// the touchpad never reaches the page. Pinch is turned back on (only pinch: the zoom keys and
/// Ctrl+wheel page zoom stay off). The page turns the pinch into calendar zoom and blocks it
/// everywhere else (appFeel.ts), so the window itself never zooms.
#[cfg(windows)]
fn allow_pinch(window: &tauri::WebviewWindow) {
    let _ = window.with_webview(|wv| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings5;
        use windows::core::Interface;
        let Ok(core) = wv.controller().CoreWebView2() else { return };
        let Ok(settings) = core.Settings() else { return };
        if let Ok(s5) = settings.cast::<ICoreWebView2Settings5>() {
            let _ = s5.SetIsPinchZoomEnabled(true);
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // One key from anywhere opens the small "write it down" window.
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        if let Err(e) = commands::show_capture(app) {
                            eprintln!("quick note window failed: {e}");
                        }
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        // Closing the window hides it; Milo keeps running in the tray so reminders
        // still arrive. Quitting is done from the tray menu.
        .on_window_event(|window, event| {
            // Only the main window hides instead of closing; the small timer really closes.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" || window.label() == commands::CAPTURE {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            // Fit the window on smaller screens (a 1366x768 laptop at 125% has about 1090x610
            // points to work with): never larger than 92% of the screen, and centred.
            if let Some(window) = app.get_webview_window("main") {
                #[cfg(windows)]
                allow_pinch(&window);
                if let (Ok(Some(monitor)), Ok(size)) = (window.current_monitor(), window.outer_size()) {
                    let screen = monitor.size();
                    let (w, h) = ((screen.width as f64 * 0.92) as u32, (screen.height as f64 * 0.92) as u32);
                    if size.width > w || size.height > h {
                        let _ = window.set_size(tauri::PhysicalSize::new(size.width.min(w), size.height.min(h)));
                    }
                    let _ = window.center();
                }
            }

            // Cmd+Shift+Space on a Mac, Ctrl+Shift+Space on Windows. Another app may hold it
            // already; Milo then simply works without it.
            {
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
                let modifier = if cfg!(target_os = "macos") { Modifiers::SUPER } else { Modifiers::CONTROL };
                if let Err(e) = app.global_shortcut().register(Shortcut::new(Some(modifier | Modifiers::SHIFT), Code::Space)) {
                    eprintln!("quick note shortcut not available: {e}");
                }
            }

            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join("milo.sqlite"))?;
            app.manage(Db(Mutex::new(conn)));
            app.manage(suggest::Suggester::new(&dir));

            let open = MenuItem::with_id(app, "open", "Open Milo", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Milo", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("Milo")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            // Daily backup: checked at startup and then once an hour, so a laptop
            // that stays on for days still gets one backup per day.
            let handle = app.handle().clone();
            let backups = dir.join("backups");
            std::thread::spawn(move || loop {
                {
                    let db = handle.state::<Db>();
                    let conn = db.lock();
                    if let Err(e) = backup::run_if_due(&conn, &backups) {
                        eprintln!("backup failed: {e}");
                    } else {
                        // Only after a good backup: archived items older than the chosen time go for good.
                        match conn.unchecked_transaction().map_err(Into::into).and_then(|t| {
                            let n = archive::clean_up(&t, chrono::Utc::now())?;
                            t.commit()?;
                            Ok::<_, error::AppError>(n)
                        }) {
                            Ok(n) if n > 0 => {
                                let _ = handle.emit("data-changed", ());
                            }
                            Ok(_) => {}
                            Err(e) => eprintln!("archive clean-up failed: {e}"),
                        }
                    }
                    // The optional second folder (Settings > Your data) gets a copy as well.
                    if let Ok(Some(to)) = repo::get_setting(&conn, "backup_mirror_dir") {
                        if !to.is_empty() {
                            if let Err(e) = backup::mirror(&backups, std::path::Path::new(&to)) {
                                eprintln!("copying backups to {to} failed: {e}");
                            }
                        }
                    }
                }
                std::thread::sleep(Duration::from_secs(3600));
            });

            // Focus: once a second while a session runs, the time left shows next to the tray
            // icon (macOS menu bar) and in its tooltip (Windows). A session forgotten an hour past
            // its plan is saved by itself, so it always leaves an event in the calendar.
            // Without a session the next event shows there instead ("Lab in 25 min"), and the
            // database is asked only every 30 seconds; starting a session or changing the menu
            // bar setting wakes this up at once (FOCUS_STARTED).
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut showing = false;
                let mut next_up: Option<String> = None;
                // The first look comes after a second, not after half a minute.
                let mut tick: u64 = 29;
                loop {
                    std::thread::sleep(Duration::from_secs(1));
                    tick += 1;
                    let started = commands::FOCUS_STARTED.swap(false, std::sync::atomic::Ordering::Relaxed);
                    if !showing && !started && !tick.is_multiple_of(30) {
                        continue;
                    }
                    let (left, forgotten, coming) = {
                        let db = handle.state::<Db>();
                        let conn = db.lock();
                        let forgotten = repo::close_forgotten_focus(&conn, chrono::Utc::now()).ok().flatten();
                        let left = repo::active_focus(&conn).ok().flatten().and_then(|s| {
                            let start = chrono::DateTime::parse_from_rfc3339(&s.started_at).ok()?;
                            Some(start.timestamp() + s.planned_minutes * 60 - chrono::Utc::now().timestamp())
                        });
                        let coming = if left.is_none() { menubar::text(&conn, chrono::Utc::now()).ok().flatten() } else { None };
                        (left, forgotten, coming)
                    };
                    if let Some(e) = forgotten {
                        notify(&handle, "Focus session saved", &format!("\"{}\" was still running, so it was saved with its planned length.", e.title));
                        let _ = handle.emit("data-changed", ());
                    }
                    let Some(tray) = handle.tray_by_id("main") else { continue };
                    match left {
                        Some(secs) => {
                            let a = secs.abs();
                            let text = format!("{}{}:{:02}", if secs < 0 { "+" } else { "" }, a / 60, a % 60);
                            let _ = tray.set_title(Some(&text));
                            let _ = tray.set_tooltip(Some(&format!("Milo · focus {text}")));
                            showing = true;
                            // Put the next event back as soon as the session ends.
                            next_up = None;
                        }
                        None => {
                            if showing {
                                if let Some(w) = handle.get_webview_window(commands::FOCUS_MINI) {
                                    let _ = w.close();
                                }
                                showing = false;
                                let _ = tray.set_title(None::<&str>);
                                let _ = tray.set_tooltip(Some("Milo"));
                            }
                            if coming != next_up {
                                let _ = tray.set_title(coming.as_deref());
                                let _ = tray.set_tooltip(Some(&coming.as_ref().map_or("Milo".to_string(), |t| format!("Milo · {t}"))));
                                next_up = coming;
                            }
                        }
                    }
                }
            });

            // Reminders: one small query every 30 seconds. The thread sleeps in between,
            // so it costs next to nothing while Milo sits in the tray.
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(30));
                let due = {
                    let db = handle.state::<Db>();
                    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
                    reminders::tick(&conn, chrono::Local::now())
                };
                match due {
                    Ok(list) => list.iter().for_each(|d| notify(&handle, &d.title, &d.body)),
                    Err(e) => eprintln!("reminder check failed: {e}"),
                }
            });
            // Calendar links: shortly after startup, then whenever the last sync is older
            // than LINK_REFRESH_HOURS. Checked every 10 minutes; no network unless one is due.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(10));
                loop {
                    let db = handle.state::<Db>();
                    // Repeating events keep half a year ahead in the calendar.
                    let extended = {
                        let conn = db.lock();
                        conn.unchecked_transaction().map_err(Into::into).and_then(|t| {
                            let n = series::extend(&t, chrono::Utc::now())?;
                            t.commit()?;
                            Ok::<_, error::AppError>(n)
                        })
                    };
                    match extended {
                        Ok(n) if n > 0 => {
                            let _ = handle.emit("data-changed", ());
                        }
                        Ok(_) => {}
                        Err(e) => eprintln!("extending repeats failed: {e}"),
                    }
                    let due = importer::links_due(&db.lock()).unwrap_or_default();
                    let mut changed = false;
                    for id in due {
                        match importer::sync_link(&db, &id) {
                            Ok(r) => changed |= r.added + r.updated + r.removed > 0,
                            Err(e) => eprintln!("calendar sync failed: {e}"),
                        }
                    }
                    if changed {
                        let _ = handle.emit("data-changed", ());
                    }
                    std::thread::sleep(Duration::from_secs(600));
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_groups,
            commands::create_group,
            commands::update_group,
            commands::list_spaces,
            commands::create_space,
            commands::update_space,
            commands::list_activities,
            commands::create_activity,
            commands::update_activity,
            commands::list_events,
            commands::delete_forever,
            commands::empty_archive,
            commands::archive_keep_setting,
            commands::set_archive_keep_setting,
            commands::event_by_id,
            commands::create_event,
            commands::update_event,
            commands::list_task_types,
            commands::create_task_type,
            commands::update_task_type,
            commands::list_tasks,
            commands::set_task_today,
            commands::list_sections,
            commands::suggest_spaces,
            commands::suggest_in_space,
            commands::similar_todos,
            commands::search,
            commands::export_csv,
            commands::ai_setup,
            commands::set_ai_access,
            commands::connect_claude_desktop,
            commands::data_version,
            commands::import_todos,
            commands::read_text_file,
            commands::focus_tasks,
            commands::set_focus_task_done,
            commands::smart_model_status,
            commands::download_smart_model,
            commands::remove_smart_model,
            commands::create_section,
            commands::update_section,
            commands::reorder_sections,
            commands::create_task,
            commands::update_task,
            commands::set_task_completed,
            commands::create_task_part,
            commands::update_task_part,
            commands::set_part_done,
            commands::list_routines,
            commands::create_routine,
            commands::update_routine,
            commands::create_routine_item,
            commands::update_routine_item,
            commands::list_routine_checks,
            commands::set_routine_check,
            commands::active_focus,
            commands::start_focus,
            commands::finish_focus,
            commands::discard_focus,
            commands::list_reminder_rules,
            commands::create_reminder_rule,
            commands::update_reminder_rule,
            commands::send_test_reminder,
            commands::follow_import,
            commands::list_import_sources,
            commands::add_calendar_link,
            commands::update_import_source,
            commands::sync_calendar_link,
            commands::import_ics_file,
            commands::inspect_csv,
            commands::import_csv,
            commands::list_title_mappings,
            commands::create_title_mapping,
            commands::update_title_mapping,
            commands::list_unmapped_titles,
            commands::export_all,
            commands::get_insights,
            commands::list_semesters,
            commands::create_semester,
            commands::update_semester,
            commands::list_archived,
            commands::app_info,
            commands::show_focus_mini,
            commands::size_focus_mini,
            commands::close_focus_mini,
            commands::show_main_window,
            commands::list_confirmations,
            commands::set_confirmed,
            commands::backup_settings,
            commands::set_backup_mirror,
            commands::restore_backup,
            commands::set_archived,
            commands::list_series,
            commands::set_repeat,
            commands::add_inbox,
            commands::list_changes,
            commands::restore_change,
            commands::reorder_spaces,
            commands::move_space,
            commands::reorder_groups,
            commands::open_capture,
            commands::hide_capture,
            commands::menubar_setting,
            commands::set_menubar_setting,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Milo")
        .run(|app, event| {
            // macOS: clicking the Dock icon brings the hidden window back.
            #[cfg(target_os = "macos")]
            if let RunEvent::Reopen { .. } = event {
                show_main(app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event, RunEvent::Ready);
        });
}
