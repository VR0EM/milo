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

macro_rules! conn {
    ($db:expr) => {
        &*$db.0.lock().unwrap_or_else(|e| e.into_inner())
    };
}

#[tauri::command]
pub fn list_groups(db: State<Db>) -> Result<Vec<Group>> {
    repo::list_groups(conn!(db))
}
#[tauri::command]
pub fn create_group(db: State<Db>, input: GroupInput) -> Result<Group> {
    repo::create_group(conn!(db), input)
}
#[tauri::command]
pub fn update_group(db: State<Db>, id: String, input: GroupInput) -> Result<Group> {
    repo::update_group(conn!(db), &id, input)
}

#[tauri::command]
pub fn list_spaces(db: State<Db>) -> Result<Vec<Space>> {
    repo::list_spaces(conn!(db))
}
#[tauri::command]
pub fn create_space(db: State<Db>, input: SpaceInput) -> Result<Space> {
    repo::create_space(conn!(db), input)
}
#[tauri::command]
pub fn update_space(db: State<Db>, id: String, input: SpaceInput) -> Result<Space> {
    repo::update_space(conn!(db), &id, input)
}

#[tauri::command]
pub fn list_activities(db: State<Db>) -> Result<Vec<Activity>> {
    repo::list_activities(conn!(db))
}
#[tauri::command]
pub fn create_activity(db: State<Db>, input: ActivityInput) -> Result<Activity> {
    repo::create_activity(conn!(db), input)
}
#[tauri::command]
pub fn update_activity(db: State<Db>, id: String, input: ActivityInput) -> Result<Activity> {
    repo::update_activity(conn!(db), &id, input)
}

#[tauri::command]
pub fn list_events(db: State<Db>, from: String, to: String) -> Result<Vec<Event>> {
    repo::list_events(conn!(db), &from, &to)
}
#[tauri::command]
pub fn create_event(db: State<Db>, input: EventInput) -> Result<Event> {
    repo::create_event(conn!(db), input, "manual")
}
#[tauri::command]
pub fn update_event(db: State<Db>, id: String, input: EventInput) -> Result<Event> {
    repo::update_event(conn!(db), &id, input)
}

#[tauri::command]
pub fn list_task_types(db: State<Db>) -> Result<Vec<TaskType>> {
    repo::list_task_types(conn!(db))
}
#[tauri::command]
pub fn create_task_type(db: State<Db>, input: TaskTypeInput) -> Result<TaskType> {
    repo::create_task_type(conn!(db), input)
}
#[tauri::command]
pub fn update_task_type(db: State<Db>, id: String, input: TaskTypeInput) -> Result<TaskType> {
    repo::update_task_type(conn!(db), &id, input)
}

#[tauri::command]
pub fn list_tasks(db: State<Db>) -> Result<Vec<Task>> {
    repo::list_tasks(conn!(db))
}
#[tauri::command]
pub fn create_task(db: State<Db>, input: TaskInput) -> Result<Task> {
    repo::create_task(conn!(db), input)
}
#[tauri::command]
pub fn update_task(db: State<Db>, id: String, input: TaskInput) -> Result<Task> {
    repo::update_task(conn!(db), &id, input)
}
#[tauri::command]
pub fn set_task_completed(db: State<Db>, id: String, completed: bool) -> Result<Task> {
    repo::set_task_completed(conn!(db), &id, completed)
}
#[tauri::command]
pub fn create_task_part(db: State<Db>, task_id: String, input: TaskPartInput) -> Result<Task> {
    repo::create_task_part(conn!(db), &task_id, input)
}
#[tauri::command]
pub fn update_task_part(db: State<Db>, id: String, input: TaskPartInput) -> Result<Task> {
    repo::update_task_part(conn!(db), &id, input)
}
#[tauri::command]
pub fn set_part_done(db: State<Db>, id: String, done: bool) -> Result<Task> {
    repo::set_part_done(conn!(db), &id, done)
}

#[tauri::command]
pub fn list_routines(db: State<Db>) -> Result<Vec<Routine>> {
    repo::list_routines(conn!(db))
}
#[tauri::command]
pub fn create_routine(db: State<Db>, input: RoutineInput) -> Result<Routine> {
    repo::create_routine(conn!(db), input)
}
#[tauri::command]
pub fn update_routine(db: State<Db>, id: String, input: RoutineInput) -> Result<Routine> {
    repo::update_routine(conn!(db), &id, input)
}
#[tauri::command]
pub fn create_routine_item(db: State<Db>, routine_id: String, title: String) -> Result<Routine> {
    repo::create_routine_item(conn!(db), &routine_id, &title)
}
#[tauri::command]
pub fn update_routine_item(db: State<Db>, id: String, title: String) -> Result<Routine> {
    repo::update_routine_item(conn!(db), &id, &title)
}
#[tauri::command]
pub fn list_routine_checks(db: State<Db>, day: String) -> Result<Vec<String>> {
    repo::list_routine_checks(conn!(db), &day)
}
#[tauri::command]
pub fn set_routine_check(db: State<Db>, item_id: String, day: String, checked: bool) -> Result<()> {
    repo::set_routine_check(conn!(db), &item_id, &day, checked)
}

#[tauri::command]
pub fn active_focus(db: State<Db>) -> Result<Option<FocusSession>> {
    repo::active_focus(conn!(db))
}
#[tauri::command]
pub fn start_focus(db: State<Db>, input: FocusInput) -> Result<FocusSession> {
    repo::start_focus(conn!(db), input)
}
#[tauri::command]
pub fn finish_focus(db: State<Db>, id: String) -> Result<Event> {
    repo::finish_focus(conn!(db), &id)
}
#[tauri::command]
pub fn discard_focus(db: State<Db>, id: String) -> Result<()> {
    repo::discard_focus(conn!(db), &id)
}

#[tauri::command]
pub fn list_reminder_rules(db: State<Db>) -> Result<Vec<ReminderRule>> {
    repo::list_reminder_rules(conn!(db))
}
#[tauri::command]
pub fn create_reminder_rule(db: State<Db>, input: ReminderRuleInput) -> Result<ReminderRule> {
    repo::create_reminder_rule(conn!(db), input)
}
#[tauri::command]
pub fn update_reminder_rule(db: State<Db>, id: String, input: ReminderRuleInput) -> Result<ReminderRule> {
    repo::update_reminder_rule(conn!(db), &id, input)
}
/// Shows one notification right away, so the user can see what a reminder looks like.
#[tauri::command]
pub fn send_test_reminder(app: tauri::AppHandle) -> Result<()> {
    crate::notify(&app, "Milo", "This is what a reminder looks like.");
    Ok(())
}

#[tauri::command]
pub fn follow_import(db: State<Db>, id: String) -> Result<Event> {
    repo::follow_import(conn!(db), &id)
}

#[tauri::command]
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
#[tauri::command]
pub fn update_import_source(db: State<Db>, id: String, input: ImportSourceInput) -> Result<ImportSource> {
    importer::update_source(conn!(db), &id, input)
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

#[tauri::command]
pub fn list_title_mappings(db: State<Db>) -> Result<Vec<TitleMapping>> {
    importer::list_mappings(conn!(db))
}
#[tauri::command]
pub fn create_title_mapping(db: State<Db>, input: TitleMappingInput) -> Result<TitleMapping> {
    importer::create_mapping(conn!(db), input)
}
#[tauri::command]
pub fn update_title_mapping(db: State<Db>, id: String, input: TitleMappingInput) -> Result<TitleMapping> {
    importer::update_mapping(conn!(db), &id, input)
}
#[tauri::command]
pub fn list_unmapped_titles(db: State<Db>) -> Result<Vec<UnmappedTitle>> {
    importer::unmapped_titles(conn!(db))
}

#[tauri::command]
pub async fn export_all(app: AppHandle, path: String) -> Result<usize> {
    off_main(app, move |db| export::export_all(&db.lock(), &path)).await
}

#[tauri::command]
pub fn get_insights(db: State<Db>, from: String, to: String) -> Result<Insights> {
    insights::insights_for(conn!(db), &from, &to)
}
#[tauri::command]
pub fn list_semesters(db: State<Db>) -> Result<Vec<Semester>> {
    insights::list_semesters(conn!(db))
}
#[tauri::command]
pub fn create_semester(db: State<Db>, input: SemesterInput) -> Result<Semester> {
    insights::create_semester(conn!(db), input)
}
#[tauri::command]
pub fn update_semester(db: State<Db>, id: String, input: SemesterInput) -> Result<Semester> {
    insights::update_semester(conn!(db), &id, input)
}

#[tauri::command]
pub fn list_archived(db: State<Db>, query: String) -> Result<ArchiveList> {
    let (items, hidden_events) = archive::list_archived(conn!(db), &query)?;
    Ok(ArchiveList { items, hidden_events })
}

#[tauri::command]
pub fn list_confirmations(db: State<Db>) -> Result<Vec<Confirmation>> {
    reminders::confirmations(conn!(db), chrono::Local::now())
}
#[tauri::command]
pub fn set_confirmed(db: State<Db>, rule_id: String, occurrence: String, done: bool) -> Result<()> {
    reminders::set_confirmed(conn!(db), &rule_id, &occurrence, done)
}

fn backup_dir(app: &AppHandle) -> Result<std::path::PathBuf> {
    Ok(app.path().app_data_dir().map_err(|e| crate::error::AppError::Invalid(e.to_string()))?.join("backups"))
}

#[tauri::command]
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

#[tauri::command]
pub fn set_archived(db: State<Db>, entity: String, id: String, archived: bool) -> Result<()> {
    repo::set_archived(conn!(db), &entity, &id, archived)
}
