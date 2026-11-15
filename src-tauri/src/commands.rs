//! Thin Tauri wrappers. Every mutation the UI can make is a named command here.

use crate::db::Db;
use crate::error::Result;
use crate::models::*;
use crate::repo;
use crate::{archive, backup, export, importer, insights, reminders};
use tauri::Emitter;
use tauri::{AppHandle, Manager, State};

/// Runs slow work (network, files) off the main thread, so the window stays responsive.
async fn off_main<T: Send + 'static>(app: AppHandle, f: impl FnOnce(&Db) -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(move || f(&app.state::<Db>()))
        .await
        .map_err(|e| crate::error::AppError::Invalid(e.to_string()))?
}

/// Set when a focus session starts, so the tray clock looks at once instead of at its next
/// slow check. Starts true so a session still running from before a restart is found.
pub static FOCUS_STARTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

macro_rules! conn {
    ($db:expr) => {
        &*$db.0.lock().unwrap_or_else(|e| e.into_inner())
    };
}

/// Runs a change as one transaction: all of it is saved, or none of it (also when a change
/// takes several steps, like a repeat that writes many events).
macro_rules! tx {
    ($db:expr, |$c:ident| $body:expr) => {{
        let guard = $db.0.lock().unwrap_or_else(|e| e.into_inner());
        let t = guard.unchecked_transaction()?;
        let out = {
            let $c: &rusqlite::Connection = &t;
            $body
        }?;
        t.commit()?;
        Ok::<_, crate::error::AppError>(out)
    }};
}

#[tauri::command(async)]
pub fn list_groups(db: State<Db>) -> Result<Vec<Group>> {
    repo::list_groups(conn!(db))
}
#[tauri::command(async)]
pub fn create_group(db: State<Db>, input: GroupInput) -> Result<Group> {
    tx!(db, |c| repo::create_group(c, input))
}
#[tauri::command(async)]
pub fn update_group(db: State<Db>, id: String, input: GroupInput) -> Result<Group> {
    tx!(db, |c| repo::update_group(c, &id, input))
}

#[tauri::command(async)]
pub fn list_spaces(db: State<Db>) -> Result<Vec<Space>> {
    repo::list_spaces(conn!(db))
}
#[tauri::command(async)]
pub fn create_space(db: State<Db>, input: SpaceInput) -> Result<Space> {
    tx!(db, |c| repo::create_space(c, input))
}
#[tauri::command(async)]
pub fn update_space(db: State<Db>, id: String, input: SpaceInput) -> Result<Space> {
    tx!(db, |c| repo::update_space(c, &id, input))
}

#[tauri::command(async)]
pub fn list_activities(db: State<Db>) -> Result<Vec<Activity>> {
    repo::list_activities(conn!(db))
}
#[tauri::command(async)]
pub fn create_activity(db: State<Db>, input: ActivityInput) -> Result<Activity> {
    tx!(db, |c| repo::create_activity(c, input))
}
#[tauri::command(async)]
pub fn update_activity(db: State<Db>, id: String, input: ActivityInput) -> Result<Activity> {
    tx!(db, |c| repo::update_activity(c, &id, input))
}

#[tauri::command(async)]
pub fn list_events(db: State<Db>, from: String, to: String) -> Result<Vec<Event>> {
    repo::list_events(conn!(db), &from, &to)
}
#[tauri::command(async)]
pub fn create_event(db: State<Db>, input: EventInput) -> Result<Event> {
    tx!(db, |c| repo::create_event(c, input, "manual"))
}
#[tauri::command(async)]
pub fn update_event(db: State<Db>, id: String, input: EventInput) -> Result<Event> {
    tx!(db, |c| repo::update_event(c, &id, input))
}

#[tauri::command(async)]
pub fn list_task_types(db: State<Db>) -> Result<Vec<TaskType>> {
    repo::list_task_types(conn!(db))
}
#[tauri::command(async)]
pub fn create_task_type(db: State<Db>, input: TaskTypeInput) -> Result<TaskType> {
    tx!(db, |c| repo::create_task_type(c, input))
}
#[tauri::command(async)]
pub fn update_task_type(db: State<Db>, id: String, input: TaskTypeInput) -> Result<TaskType> {
    tx!(db, |c| repo::update_task_type(c, &id, input))
}

#[tauri::command(async)]
pub fn list_tasks(db: State<Db>) -> Result<Vec<Task>> {
    repo::list_tasks(conn!(db))
}
#[tauri::command(async)]
pub fn create_task(db: State<Db>, input: TaskInput) -> Result<Task> {
    tx!(db, |c| repo::create_task(c, input))
}
#[tauri::command(async)]
pub fn update_task(db: State<Db>, id: String, input: TaskInput) -> Result<Task> {
    tx!(db, |c| repo::update_task(c, &id, input))
}
#[tauri::command(async)]
pub fn set_task_completed(db: State<Db>, id: String, completed: bool) -> Result<Task> {
    tx!(db, |c| repo::set_task_completed(c, &id, completed))
}
#[tauri::command(async)]
pub fn create_task_part(db: State<Db>, task_id: String, input: TaskPartInput) -> Result<Task> {
    tx!(db, |c| repo::create_task_part(c, &task_id, input))
}
#[tauri::command(async)]
pub fn update_task_part(db: State<Db>, id: String, input: TaskPartInput) -> Result<Task> {
    tx!(db, |c| repo::update_task_part(c, &id, input))
}
#[tauri::command(async)]
pub fn set_part_done(db: State<Db>, id: String, done: bool) -> Result<Task> {
    tx!(db, |c| repo::set_part_done(c, &id, done))
}

#[tauri::command(async)]
pub fn list_routines(db: State<Db>) -> Result<Vec<Routine>> {
    repo::list_routines(conn!(db))
}
#[tauri::command(async)]
pub fn create_routine(db: State<Db>, input: RoutineInput) -> Result<Routine> {
    tx!(db, |c| repo::create_routine(c, input))
}
#[tauri::command(async)]
pub fn update_routine(db: State<Db>, id: String, input: RoutineInput) -> Result<Routine> {
    tx!(db, |c| repo::update_routine(c, &id, input))
}
#[tauri::command(async)]
pub fn create_routine_item(db: State<Db>, routine_id: String, title: String) -> Result<Routine> {
    tx!(db, |c| repo::create_routine_item(c, &routine_id, &title))
}
#[tauri::command(async)]
pub fn update_routine_item(db: State<Db>, id: String, title: String) -> Result<Routine> {
    tx!(db, |c| repo::update_routine_item(c, &id, &title))
}
#[tauri::command(async)]
pub fn list_routine_checks(db: State<Db>, day: String) -> Result<Vec<String>> {
    repo::list_routine_checks(conn!(db), &day)
}
#[tauri::command(async)]
pub fn set_routine_check(db: State<Db>, item_id: String, day: String, checked: bool) -> Result<()> {
    tx!(db, |c| repo::set_routine_check(c, &item_id, &day, checked))
}

#[tauri::command(async)]
pub fn active_focus(db: State<Db>) -> Result<Option<FocusSession>> {
    repo::active_focus(conn!(db))
}
#[tauri::command(async)]
pub fn start_focus(app: AppHandle, db: State<Db>, input: FocusInput) -> Result<FocusSession> {
    let s = tx!(db, |c| repo::start_focus(c, input))?;
    FOCUS_STARTED.store(true, std::sync::atomic::Ordering::Relaxed);
    let _ = app.emit("data-changed", ()); // the small timer window follows
    Ok(s)
}
#[tauri::command(async)]
pub fn finish_focus(app: AppHandle, db: State<Db>, id: String) -> Result<Event> {
    let e = tx!(db, |c| repo::finish_focus(c, &id))?;
    let _ = app.emit("data-changed", ());
    Ok(e)
}
#[tauri::command(async)]
pub fn discard_focus(app: AppHandle, db: State<Db>, id: String) -> Result<()> {
    tx!(db, |c| repo::discard_focus(c, &id))?;
    let _ = app.emit("data-changed", ());
    Ok(())
}

#[tauri::command(async)]
pub fn list_reminder_rules(db: State<Db>) -> Result<Vec<ReminderRule>> {
    repo::list_reminder_rules(conn!(db))
}
#[tauri::command(async)]
pub fn create_reminder_rule(db: State<Db>, input: ReminderRuleInput) -> Result<ReminderRule> {
    tx!(db, |c| repo::create_reminder_rule(c, input))
}
#[tauri::command(async)]
pub fn update_reminder_rule(db: State<Db>, id: String, input: ReminderRuleInput) -> Result<ReminderRule> {
    tx!(db, |c| repo::update_reminder_rule(c, &id, input))
}
/// Shows one notification right away, so the user can see what a reminder looks like.
#[tauri::command]
pub fn send_test_reminder(app: tauri::AppHandle) -> Result<()> {
    crate::notify(&app, "Milo", "This is what a reminder looks like.");
    Ok(())
}

#[tauri::command(async)]
pub fn follow_import(db: State<Db>, id: String) -> Result<Event> {
    tx!(db, |c| repo::follow_import(c, &id))
}

#[tauri::command(async)]
pub fn list_import_sources(db: State<Db>) -> Result<Vec<ImportSource>> {
    importer::list_sources(conn!(db))
}
#[tauri::command]
pub async fn add_calendar_link(app: AppHandle, input: ImportSourceInput) -> Result<SyncReport> {
    off_main(app, move |db| {
        let source = importer::create_source(&db.lock(), "ics_url", input)?;
        importer::sync_link(db, &source.id)
    })
    .await
}
#[tauri::command(async)]
pub fn update_import_source(db: State<Db>, id: String, input: ImportSourceInput) -> Result<ImportSource> {
    tx!(db, |c| importer::update_source(c, &id, input))
}
#[tauri::command]
pub async fn sync_calendar_link(app: AppHandle, id: String) -> Result<SyncReport> {
    off_main(app, move |db| importer::sync_link(db, &id)).await
}
#[tauri::command]
pub async fn import_ics_file(app: AppHandle, path: String, space_id: String) -> Result<SyncReport> {
    off_main(app, move |db| importer::import_ics_file(&db.lock(), &path, &space_id)).await
}
#[tauri::command]
pub async fn inspect_csv(app: AppHandle, path: String) -> Result<CsvPreview> {
    off_main(app, move |_| importer::inspect_csv(&path)).await
}
#[tauri::command]
pub async fn import_csv(app: AppHandle, path: String, title_column: usize, date_column: usize, space_id: String) -> Result<SyncReport> {
    off_main(app, move |db| importer::import_csv(&db.lock(), &path, title_column, date_column, &space_id)).await
}

#[tauri::command(async)]
pub fn list_title_mappings(db: State<Db>) -> Result<Vec<TitleMapping>> {
    importer::list_mappings(conn!(db))
}
#[tauri::command(async)]
pub fn create_title_mapping(db: State<Db>, input: TitleMappingInput) -> Result<TitleMapping> {
    tx!(db, |c| importer::create_mapping(c, input))
}
#[tauri::command(async)]
pub fn update_title_mapping(db: State<Db>, id: String, input: TitleMappingInput) -> Result<TitleMapping> {
    tx!(db, |c| importer::update_mapping(c, &id, input))
}
#[tauri::command(async)]
pub fn list_unmapped_titles(db: State<Db>) -> Result<Vec<UnmappedTitle>> {
    importer::unmapped_titles(conn!(db))
}

#[tauri::command]
pub async fn export_all(app: AppHandle, path: String) -> Result<usize> {
    off_main(app, move |db| export::export_all(&db.lock(), &path)).await
}

#[tauri::command(async)]
pub fn get_insights(db: State<Db>, from: String, to: String) -> Result<Insights> {
    insights::insights_for(conn!(db), &from, &to)
}
#[tauri::command(async)]
pub fn list_semesters(db: State<Db>) -> Result<Vec<Semester>> {
    insights::list_semesters(conn!(db))
}
#[tauri::command(async)]
pub fn create_semester(db: State<Db>, input: SemesterInput) -> Result<Semester> {
    tx!(db, |c| insights::create_semester(c, input))
}
#[tauri::command(async)]
pub fn update_semester(db: State<Db>, id: String, input: SemesterInput) -> Result<Semester> {
    tx!(db, |c| insights::update_semester(c, &id, input))
}

#[tauri::command(async)]
pub fn list_archived(db: State<Db>, query: String) -> Result<ArchiveList> {
    let (items, hidden_events) = archive::list_archived(conn!(db), &query)?;
    Ok(ArchiveList { items, hidden_events })
}

#[tauri::command(async)]
pub fn list_confirmations(db: State<Db>) -> Result<Vec<Confirmation>> {
    reminders::confirmations(conn!(db), chrono::Local::now())
}
#[tauri::command(async)]
pub fn set_confirmed(db: State<Db>, rule_id: String, occurrence: String, done: bool) -> Result<()> {
    tx!(db, |c| reminders::set_confirmed(c, &rule_id, &occurrence, done))
}

fn backup_dir(app: &AppHandle) -> Result<std::path::PathBuf> {
    Ok(app.path().app_data_dir().map_err(|e| crate::error::AppError::Invalid(e.to_string()))?.join("backups"))
}

#[tauri::command(async)]
pub fn backup_settings(app: AppHandle, db: State<Db>) -> Result<BackupSettings> {
    let mirror_dir = repo::get_setting(conn!(db), "backup_mirror_dir")?.filter(|v| !v.is_empty());
    Ok(BackupSettings { mirror_dir, backups: backup::list(&backup_dir(&app)?) })
}

/// Sets (or with `None` stops) the second backup folder, and copies the backups there now.
#[tauri::command]
pub async fn set_backup_mirror(app: AppHandle, path: Option<String>) -> Result<usize> {
    off_main(app.clone(), move |db| {
        repo::set_setting(&db.lock(), "backup_mirror_dir", path.as_deref())?;
        match path {
            Some(p) => backup::mirror(&backup_dir(&app)?, std::path::Path::new(&p)),
            None => Ok(0),
        }
    })
    .await
}

/// Puts a backup back. Returns the name of the copy made of the data as it was just before.
#[tauri::command]
pub async fn restore_backup(app: AppHandle, name: String) -> Result<String> {
    let dir = backup_dir(&app)?;
    let handle = app.clone();
    let safety = off_main(app, move |db| backup::restore(&mut db.lock(), &dir, &name)).await?;
    let _ = handle.emit("data-changed", ());
    Ok(safety.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default())
}

pub const FOCUS_MINI: &str = "focus-mini";

/// Sizes of the small timer: only the time, or the time with what you work on and the buttons.
fn mini_size(expanded: bool) -> (f64, f64) {
    if expanded {
        (264.0, 76.0)
    } else {
        (108.0, 40.0)
    }
}

/// The small always-on-top timer, in the top-right corner of the screen.
#[tauri::command]
pub fn show_focus_mini(app: AppHandle, expanded: bool) -> Result<()> {
    if let Some(w) = app.get_webview_window(FOCUS_MINI) {
        let _ = w.show();
        return Ok(());
    }
    let err = |e: tauri::Error| crate::error::AppError::Invalid(e.to_string());
    let (w, h) = mini_size(expanded);
    let mut builder = tauri::WebviewWindowBuilder::new(&app, FOCUS_MINI, tauri::WebviewUrl::App("index.html".into()))
        .title("Milo focus")
        .inner_size(w, h)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .focused(false);
    if let Some(m) = app.get_webview_window("main").and_then(|m| m.current_monitor().ok().flatten()) {
        let scale = m.scale_factor();
        let size = m.size().to_logical::<f64>(scale);
        let pos = m.position().to_logical::<f64>(scale);
        builder = builder.position(pos.x + size.width - w - 24.0, pos.y + 48.0);
    }
    builder.build().map_err(err)?;
    Ok(())
}

/// Switches the small timer between only the time and the full version. The right edge stays
/// where it is, so the window grows to the left and does not jump away from the corner.
#[tauri::command]
pub fn size_focus_mini(app: AppHandle, expanded: bool) -> Result<()> {
    let Some(w) = app.get_webview_window(FOCUS_MINI) else { return Ok(()) };
    let err = |e: tauri::Error| crate::error::AppError::Invalid(e.to_string());
    let scale = w.scale_factor().map_err(err)?;
    let pos = w.outer_position().map_err(err)?.to_logical::<f64>(scale);
    let size = w.outer_size().map_err(err)?.to_logical::<f64>(scale);
    let (nw, nh) = mini_size(expanded);
    w.set_size(tauri::LogicalSize::new(nw, nh)).map_err(err)?;
    w.set_position(tauri::LogicalPosition::new(pos.x + size.width - nw, pos.y)).map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn close_focus_mini(app: AppHandle) -> Result<()> {
    if let Some(w) = app.get_webview_window(FOCUS_MINI) {
        let _ = w.close();
    }
    Ok(())
}

/// Brings the main window forward (from the small timer).
#[tauri::command]
pub fn show_main_window(app: AppHandle) -> Result<()> {
    crate::show_main(&app);
    Ok(())
}

/// Where Milo keeps its data, for the Settings screen.
#[tauri::command]
pub fn app_info(app: AppHandle) -> Result<AppInfo> {
    let dir = app.path().app_data_dir().map_err(|e| crate::error::AppError::Invalid(e.to_string()))?;
    let backups = dir.join("backups");
    let mut names: Vec<String> = std::fs::read_dir(&backups)
        .map(|it| it.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().to_string()).filter(|n| n.ends_with(".sqlite")).collect())
        .unwrap_or_default();
    names.sort();
    Ok(AppInfo {
        data_dir: dir.to_string_lossy().to_string(),
        backup_dir: backups.to_string_lossy().to_string(),
        backup_count: names.len(),
        last_backup: names.pop(),
        version: app.package_info().version.to_string(),
    })
}

#[tauri::command(async)]
pub fn set_archived(db: State<Db>, entity: String, id: String, archived: bool) -> Result<()> {
    tx!(db, |c| repo::set_archived(c, &entity, &id, archived))
}

// ---------- repeating events ----------

#[tauri::command(async)]
pub fn list_series(db: State<Db>) -> Result<Vec<EventSeries>> {
    crate::series::list(conn!(db))
}

/// Makes an event repeat from now on (this and the following ones), or stops it with `None`.
#[tauri::command(async)]
pub fn set_repeat(db: State<Db>, id: String, rule: Option<RepeatRule>) -> Result<Event> {
    tx!(db, |c| crate::series::set_repeat(c, &id, rule, chrono::Utc::now()))
}

// ---------- inbox and quick capture ----------

#[tauri::command(async)]
pub fn list_inbox(db: State<Db>) -> Result<Vec<InboxItem>> {
    repo::list_inbox(conn!(db))
}

/// Saves a quick note. The main window hears about it, also when the note came from the
/// small capture window.
#[tauri::command(async)]
pub fn add_inbox(app: AppHandle, db: State<Db>, text: String) -> Result<InboxItem> {
    let item = tx!(db, |c| repo::add_inbox(c, &text))?;
    let _ = app.emit("data-changed", ());
    Ok(item)
}

/// Turns a note into a task in one step: the task is made and the note handled together.
#[tauri::command(async)]
pub fn inbox_to_task(db: State<Db>, id: String, space_id: String) -> Result<Task> {
    tx!(db, |c| repo::inbox_to_task(c, &id, &space_id))
}

#[tauri::command(async)]
pub fn set_inbox_done(db: State<Db>, id: String, done: bool) -> Result<()> {
    tx!(db, |c| repo::set_inbox_done(c, &id, done))
}

pub const CAPTURE: &str = "capture";
const CAPTURE_SIZE: (f64, f64) = (520.0, 64.0);

/// The small "write it down" window, in the middle of the screen near the top. It is made once
/// and then shown and hidden, so it appears at once.
pub fn show_capture(app: &AppHandle) -> Result<()> {
    let err = |e: tauri::Error| crate::error::AppError::Invalid(e.to_string());
    let window = match app.get_webview_window(CAPTURE) {
        Some(w) => w,
        None => tauri::WebviewWindowBuilder::new(app, CAPTURE, tauri::WebviewUrl::App("index.html".into()))
            .title("Milo note")
            .inner_size(CAPTURE_SIZE.0, CAPTURE_SIZE.1)
            .resizable(false)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .visible_on_all_workspaces(true)
            .visible(false)
            .build()
            .map_err(err)?,
    };
    // On the screen the mouse is on would be nicest; the main window's screen is a good guess.
    let monitor = app
        .get_webview_window("main")
        .and_then(|m| m.current_monitor().ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten());
    if let Some(m) = monitor {
        let scale = m.scale_factor();
        let size = m.size().to_logical::<f64>(scale);
        let pos = m.position().to_logical::<f64>(scale);
        let _ = window.set_position(tauri::LogicalPosition::new(pos.x + (size.width - CAPTURE_SIZE.0) / 2.0, pos.y + size.height * 0.22));
    }
    window.show().map_err(err)?;
    window.set_focus().map_err(err)?;
    let _ = window.emit("capture-open", ());
    Ok(())
}

#[tauri::command]
pub fn open_capture(app: AppHandle) -> Result<()> {
    show_capture(&app)
}

#[tauri::command]
pub fn hide_capture(app: AppHandle) -> Result<()> {
    if let Some(w) = app.get_webview_window(CAPTURE) {
        let _ = w.hide();
    }
    Ok(())
}

// ---------- earlier versions ----------

#[tauri::command(async)]
pub fn list_changes(db: State<Db>, entity: String, id: String) -> Result<Vec<Change>> {
    crate::history::list(conn!(db), &entity, &id)
}

/// Puts an event or task back the way an earlier version has it.
#[tauri::command(async)]
pub fn restore_change(db: State<Db>, id: String) -> Result<()> {
    tx!(db, |c| crate::history::restore(c, &id)).map(|_| ())
}

#[tauri::command(async)]
pub fn reorder_spaces(db: State<Db>, ids: Vec<String>) -> Result<()> {
    tx!(db, |c| repo::reorder_spaces(c, &ids))
}

/// Whether the next event shows next to the tray icon.
#[tauri::command(async)]
pub fn menubar_setting(db: State<Db>) -> Result<bool> {
    crate::menubar::enabled(conn!(db))
}

#[tauri::command(async)]
pub fn set_menubar_setting(db: State<Db>, on: bool) -> Result<()> {
    crate::menubar::set_enabled(conn!(db), on)?;
    // Show (or clear) it at once instead of at the next half minute.
    FOCUS_STARTED.store(true, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}
