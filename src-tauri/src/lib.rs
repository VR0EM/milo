mod backup;
mod commands;
mod db;
mod error;
mod export;
mod ics;
mod importer;
mod insights;
mod models;
mod reminders;
mod repo;

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

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        // Closing the window hides it; Milo keeps running in the tray so reminders
        // still arrive. Quitting is done from the tray menu.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join("milo.sqlite"))?;
            app.manage(Db(Mutex::new(conn)));

            let open = MenuItem::with_id(app, "open", "Open Milo", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Milo", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            let mut tray = TrayIconBuilder::new()
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
                    }
                }
                std::thread::sleep(Duration::from_secs(3600));
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
            commands::create_event,
            commands::update_event,
            commands::list_task_types,
            commands::create_task_type,
            commands::update_task_type,
            commands::list_tasks,
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
            commands::set_archived,
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
