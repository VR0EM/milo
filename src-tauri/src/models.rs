use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    pub name: String,
    pub sort_order: i64,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupInput {
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Space {
    pub id: String,
    pub group_id: Option<String>,
    pub name: String,
    pub color: String,
    pub role: String,
    pub sort_order: i64,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceInput {
    pub group_id: Option<String>,
    pub name: String,
    pub color: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub id: String,
    pub name: String,
    pub category: String,
    pub sort_order: i64,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityInput {
    pub name: String,
    pub category: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: String,
    pub space_id: String,
    pub activity_id: Option<String>,
    pub title: String,
    pub start_at: String,
    pub end_at: String,
    pub all_day: bool,
    pub notes: String,
    pub status: String,
    pub source: String,
    pub source_id: Option<String>,
    pub locally_modified: bool,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventInput {
    pub space_id: String,
    pub activity_id: Option<String>,
    pub title: String,
    pub start_at: String,
    pub end_at: String,
    #[serde(default)]
    pub all_day: bool,
    #[serde(default)]
    pub notes: String,
    #[serde(default = "default_status")]
    pub status: String,
}

fn default_status() -> String {
    "planned".into()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskType {
    pub id: String,
    pub name: String,
    pub sort_order: i64,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskTypeInput {
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPart {
    pub id: String,
    pub task_id: String,
    pub title: String,
    pub weight: f64,
    pub done_at: Option<String>,
    pub sort_order: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPartInput {
    pub title: String,
    #[serde(default = "default_weight")]
    pub weight: f64,
}

fn default_weight() -> f64 {
    1.0
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub space_id: String,
    pub type_id: Option<String>,
    pub title: String,
    pub notes: String,
    pub deadline_at: Option<String>,
    pub target_at: Option<String>,
    pub completed_at: Option<String>,
    pub sort_order: i64,
    pub created_at: String,
    pub parts: Vec<TaskPart>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInput {
    pub space_id: String,
    pub type_id: Option<String>,
    pub title: String,
    #[serde(default)]
    pub notes: String,
    pub deadline_at: Option<String>,
    pub target_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineItem {
    pub id: String,
    pub routine_id: String,
    pub title: String,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Routine {
    pub id: String,
    pub name: String,
    pub start_time: String,
    pub end_time: String,
    pub weekdays: String,
    pub sort_order: i64,
    pub items: Vec<RoutineItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineInput {
    pub name: String,
    pub start_time: String,
    pub end_time: String,
    pub weekdays: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusSession {
    pub id: String,
    pub space_id: String,
    pub activity_id: Option<String>,
    pub task_id: Option<String>,
    pub title: String,
    pub planned_minutes: i64,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub event_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusInput {
    pub space_id: String,
    pub activity_id: Option<String>,
    pub task_id: Option<String>,
    #[serde(default)]
    pub title: String,
    pub planned_minutes: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderRule {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub enabled: bool,
    pub minutes_before: Option<i64>,
    pub times: Option<String>,
    pub weekdays: String,
    pub interval_minutes: Option<i64>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderRuleInput {
    pub kind: String,
    pub title: String,
    pub enabled: bool,
    pub minutes_before: Option<i64>,
    pub times: Option<String>,
    pub weekdays: String,
    pub interval_minutes: Option<i64>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSource {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub location: String,
    pub space_id: String,
    pub enabled: bool,
    pub last_synced_at: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSourceInput {
    pub name: String,
    pub location: String,
    pub space_id: String,
    pub enabled: bool,
}

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub added: usize,
    pub updated: usize,
    pub removed: usize,
    pub kept: usize,
    pub unchanged: usize,
    pub skipped: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TitleMapping {
    pub id: String,
    pub pattern: String,
    pub match_type: String,
    pub space_id: String,
    pub activity_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TitleMappingInput {
    pub pattern: String,
    pub match_type: String,
    pub space_id: String,
    pub activity_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnmappedTitle {
    pub title: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvPreview {
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub title_column: usize,
    pub date_column: usize,
}

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InsightTotals {
    pub class: i64,
    pub self_study: i64,
    pub other: i64,
    pub sleep: i64,
}

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceInsight {
    pub space_id: String,
    pub class: i64,
    pub self_study: i64,
    pub other: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bucket {
    pub start: String,
    pub class: i64,
    pub self_study: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Night {
    pub date: String,
    pub minutes: i64,
}

/// All values are minutes.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Insights {
    pub bucket: String,
    pub buckets: Vec<Bucket>,
    pub totals: InsightTotals,
    pub spaces: Vec<SpaceInsight>,
    pub nights: Vec<Night>,
    pub sleep_average: Option<i64>,
    /// Days of the period that have started, for per-day averages.
    pub elapsed_days: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Semester {
    pub id: String,
    pub name: String,
    pub start_date: String,
    pub end_date: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemesterInput {
    pub name: String,
    pub start_date: String,
    pub end_date: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedItem {
    pub entity: String,
    pub id: String,
    pub label: String,
    /// Where it belonged: the space, the task, the routine ...
    pub context: Option<String>,
    /// For events and tasks: when it was planned or due.
    pub when: Option<String>,
    pub archived_at: String,
    /// An imported event that a sync archived because it left the calendar.
    pub removed_by_sync: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveList {
    pub items: Vec<ArchivedItem>,
    pub hidden_events: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub data_dir: String,
    pub backup_dir: String,
    pub backup_count: usize,
    pub last_backup: Option<String>,
    pub version: String,
}
