use crate::get_db_path;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static ID_COUNTER: AtomicU64 = AtomicU64::new(1000);

pub const DEFAULT_TRACE_RETENTION_DAYS: u64 = 30;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
pub struct LlmTraceRecord {
    pub id: String,
    pub agent_scope: String,
    pub system_prompt: String,
    pub tools_json: String,
    pub user_message: String,
    pub raw_response: Option<String>,
    pub parsed_result: Option<String>,
    pub model: String,
    pub latency_ms: Option<i64>,
    pub error: Option<String>,
    pub human_decision: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
pub struct LlmTraceInput {
    pub id: Option<String>,
    pub agent_scope: String,
    pub system_prompt: String,
    pub tools_json: String,
    pub user_message: String,
    pub raw_response: Option<String>,
    pub parsed_result: Option<String>,
    pub model: String,
    pub latency_ms: Option<i64>,
    pub error: Option<String>,
    pub human_decision: Option<String>,
    pub created_at: Option<i64>,
}

pub fn current_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

pub fn create_llm_traces_table(conn: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS llm_traces (
            id TEXT PRIMARY KEY,
            agent_scope TEXT NOT NULL,
            system_prompt TEXT NOT NULL,
            tools_json TEXT NOT NULL,
            user_message TEXT NOT NULL,
            raw_response TEXT,
            parsed_result TEXT,
            model TEXT NOT NULL,
            latency_ms INTEGER,
            error TEXT,
            human_decision TEXT,
            created_at INTEGER NOT NULL
        )",
        [],
    )?;

    Ok(())
}

pub fn parse_trace_retention_days(raw_env: Option<&str>) -> u64 {
    match raw_env {
        Some(val) => {
            let trimmed = val.trim();
            if trimmed.is_empty() {
                DEFAULT_TRACE_RETENTION_DAYS
            } else {
                match trimmed.parse::<u64>() {
                    Ok(days) if days > 0 => days,
                    _ => DEFAULT_TRACE_RETENTION_DAYS,
                }
            }
        }
        None => DEFAULT_TRACE_RETENTION_DAYS,
    }
}

pub fn cleanup_expired_llm_traces(
    conn: &rusqlite::Connection,
    retention_days: u64,
    now: i64,
) -> Result<usize, rusqlite::Error> {
    let retention_seconds = (retention_days as i64) * 86_400;
    let cutoff = now - retention_seconds;

    conn.execute(
        "DELETE FROM llm_traces WHERE created_at < ?1",
        params![cutoff],
    )
}

pub fn record_llm_trace_impl(
    conn: &rusqlite::Connection,
    trace: LlmTraceInput,
) -> Result<String, String> {
    let now = current_timestamp();
    let trace_id = match trace.id {
        Some(id) if !id.trim().is_empty() => id.trim().to_string(),
        _ => format!(
            "trace_{}_{}",
            now,
            ID_COUNTER.fetch_add(1, Ordering::Relaxed)
        ),
    };

    let created_at = trace.created_at.unwrap_or(now);

    conn.execute(
        "INSERT INTO llm_traces (
            id, agent_scope, system_prompt, tools_json, user_message,
            raw_response, parsed_result, model, latency_ms, error, human_decision, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
        ON CONFLICT(id) DO UPDATE SET
            raw_response = excluded.raw_response,
            parsed_result = excluded.parsed_result,
            latency_ms = excluded.latency_ms,
            error = excluded.error,
            human_decision = COALESCE(excluded.human_decision, llm_traces.human_decision)",
        params![
            trace_id,
            trace.agent_scope,
            trace.system_prompt,
            trace.tools_json,
            trace.user_message,
            trace.raw_response,
            trace.parsed_result,
            trace.model,
            trace.latency_ms,
            trace.error,
            trace.human_decision,
            created_at,
        ],
    )
    .map_err(|e| format!("Failed to record llm_trace: {}", e))?;

    Ok(trace_id)
}

pub fn update_llm_trace_decision_impl(
    conn: &rusqlite::Connection,
    id: &str,
    decision: &str,
) -> Result<(), String> {
    let trimmed_id = id.trim();
    if trimmed_id.is_empty() {
        return Err("Trace ID cannot be empty".to_string());
    }

    let affected = conn
        .execute(
            "UPDATE llm_traces SET human_decision = ?1 WHERE id = ?2",
            params![decision, trimmed_id],
        )
        .map_err(|e| format!("Failed to update llm_trace decision: {}", e))?;

    if affected == 0 {
        return Err(format!("Trace with ID '{}' not found", trimmed_id));
    }

    Ok(())
}

pub fn get_llm_traces_impl(
    conn: &rusqlite::Connection,
    limit: Option<u32>,
) -> Result<Vec<LlmTraceRecord>, String> {
    let limit_clause = limit.unwrap_or(100);
    let mut stmt = conn
        .prepare(
            "SELECT id, agent_scope, system_prompt, tools_json, user_message,
                    raw_response, parsed_result, model, latency_ms, error, human_decision, created_at
             FROM llm_traces
             ORDER BY created_at DESC, id DESC
             LIMIT ?1",
        )
        .map_err(|e| format!("Failed to prepare get_llm_traces query: {}", e))?;

    let rows = stmt
        .query_map(params![limit_clause], |row| {
            Ok(LlmTraceRecord {
                id: row.get(0)?,
                agent_scope: row.get(1)?,
                system_prompt: row.get(2)?,
                tools_json: row.get(3)?,
                user_message: row.get(4)?,
                raw_response: row.get(5)?,
                parsed_result: row.get(6)?,
                model: row.get(7)?,
                latency_ms: row.get(8)?,
                error: row.get(9)?,
                human_decision: row.get(10)?,
                created_at: row.get(11)?,
            })
        })
        .map_err(|e| format!("Failed to query llm_traces: {}", e))?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r.map_err(|e| e.to_string())?);
    }
    Ok(list)
}

pub fn record_audit_log_impl(
    conn: &rusqlite::Connection,
    action_type: &str,
    arguments: &str,
    decision: &str,
    operator: &str,
) -> Result<String, String> {
    let timestamp = current_timestamp();
    let log_id = format!(
        "LOG-{}-{}",
        timestamp,
        ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    );

    conn.execute(
        "INSERT INTO audit_logs (id, action_type, arguments, decision, operator, timestamp)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            log_id,
            action_type.trim(),
            arguments.trim(),
            decision.trim(),
            operator.trim(),
            timestamp
        ],
    )
    .map_err(|e| format!("Failed to insert audit log: {}", e))?;

    Ok(log_id)
}

#[tauri::command]
#[specta::specta]
pub async fn record_llm_trace<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    trace: LlmTraceInput,
) -> Result<String, String> {
    let db_path = get_db_path(&app_handle);
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    record_llm_trace_impl(&conn, trace)
}

#[tauri::command]
#[specta::specta]
pub async fn update_llm_trace_decision<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    id: String,
    decision: String,
) -> Result<(), String> {
    let db_path = get_db_path(&app_handle);
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    update_llm_trace_decision_impl(&conn, &id, &decision)
}

#[tauri::command]
#[specta::specta]
pub async fn get_llm_traces<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    limit: Option<u32>,
) -> Result<Vec<LlmTraceRecord>, String> {
    let db_path = get_db_path(&app_handle);
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    get_llm_traces_impl(&conn, limit)
}

#[tauri::command]
#[specta::specta]
pub async fn record_audit_log<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    action_type: String,
    arguments: String,
    decision: String,
    operator: Option<String>,
) -> Result<String, String> {
    let db_path = get_db_path(&app_handle);
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let op = operator.unwrap_or_else(|| "user".to_string());
    record_audit_log_impl(&conn, &action_type, &arguments, &decision, &op)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    fn setup_test_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("failed to create in-memory db");
        create_llm_traces_table(&conn).expect("failed to create llm_traces table");
        conn.execute(
            "CREATE TABLE IF NOT EXISTS audit_logs (
                id TEXT PRIMARY KEY,
                action_type TEXT NOT NULL,
                arguments TEXT NOT NULL,
                decision TEXT NOT NULL,
                operator TEXT NOT NULL,
                timestamp INTEGER NOT NULL
            )",
            [],
        )
        .expect("failed to create audit_logs table");
        conn
    }

    #[test]
    fn test_tc_rust_trace_01_record_and_query_trace_success() {
        // Given: An in-memory DB and a complete LlmTraceInput
        let conn = setup_test_db();
        let input = LlmTraceInput {
            id: Some("trace_test_01".to_string()),
            agent_scope: "task_m2_dept".to_string(),
            system_prompt: "你是組織架構助理".to_string(),
            tools_json: "[{\"type\":\"function\"}]".to_string(),
            user_message: "我想建立行銷部".to_string(),
            raw_response: Some("{\"tool_calls\":[{\"name\":\"create_department\"}]}".to_string()),
            parsed_result: Some("{\"tool\":\"create_department\",\"name\":\"行銷部\"}".to_string()),
            model: "z-ai/glm-5.3-flash".to_string(),
            latency_ms: Some(180),
            error: None,
            human_decision: None,
            created_at: Some(1700000000),
        };

        // When: record_llm_trace_impl is executed
        let trace_id = record_llm_trace_impl(&conn, input).expect("record trace should succeed");

        // Then: Querying traces returns the exact record
        assert_eq!(trace_id, "trace_test_01");
        let traces = get_llm_traces_impl(&conn, None).expect("query traces should succeed");
        assert_eq!(traces.len(), 1);
        assert_eq!(traces[0].id, "trace_test_01");
        assert_eq!(traces[0].agent_scope, "task_m2_dept");
        assert_eq!(traces[0].user_message, "我想建立行銷部");
        assert_eq!(traces[0].model, "z-ai/glm-5.3-flash");
        assert_eq!(traces[0].latency_ms, Some(180));
        assert_eq!(traces[0].human_decision, None);
    }

    #[test]
    fn test_tc_rust_trace_02_update_human_decision_success() {
        // Given: An existing trace in DB
        let conn = setup_test_db();
        let input = LlmTraceInput {
            id: Some("trace_decision_01".to_string()),
            agent_scope: "task_m2_dept".to_string(),
            system_prompt: "你是組織架構助理".to_string(),
            tools_json: "[]".to_string(),
            user_message: "建立研發部".to_string(),
            raw_response: None,
            parsed_result: None,
            model: "z-ai/glm-5.3-flash".to_string(),
            latency_ms: Some(150),
            error: None,
            human_decision: None,
            created_at: Some(1700000000),
        };
        record_llm_trace_impl(&conn, input).expect("record trace should succeed");

        // When: update_llm_trace_decision_impl is called with 'approved'
        let update_res = update_llm_trace_decision_impl(&conn, "trace_decision_01", "approved");

        // Then: human_decision is updated to 'approved'
        assert!(update_res.is_ok());
        let traces = get_llm_traces_impl(&conn, None).expect("query traces should succeed");
        assert_eq!(traces[0].human_decision, Some("approved".to_string()));
    }

    #[test]
    fn test_tc_rust_trace_03_update_nonexistent_trace_returns_error() {
        // Given: An empty DB
        let conn = setup_test_db();

        // When: Updating a nonexistent trace ID
        let res = update_llm_trace_decision_impl(&conn, "nonexistent_trace", "rejected");

        // Then: Returns error indicating not found
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("not found"));
    }

    #[test]
    fn test_tc_rust_ret_01_to_03_parse_trace_retention_days_equivalence_and_boundaries() {
        // Given: Various raw string inputs for AGENT_ERP_LLM_TRACE_RETENTION_DAYS
        let cases = vec![
            // Normal default / None
            (None, 30, "None returns default 30"),
            // Normal custom values
            (Some("7"), 7, "Valid 7 days"),
            (Some("60"), 60, "Valid 60 days"),
            (Some("  14  "), 14, "Valid 14 days with whitespace"),
            // Boundaries & invalid values falling back to 30
            (Some("0"), 30, "0 days falls back to 30"),
            (Some("-5"), 30, "Negative days falls back to 30"),
            (Some(""), 30, "Empty string falls back to 30"),
            (Some("   "), 30, "Whitespace string falls back to 30"),
            (Some("invalid"), 30, "Non-numeric string falls back to 30"),
        ];

        for (input, expected, desc) in cases {
            // When: Parsing the retention days
            let actual = parse_trace_retention_days(input);

            // Then: Matches expected retention days
            assert_eq!(actual, expected, "Failed for case: {}", desc);
        }
    }

    #[test]
    fn test_tc_rust_ret_04_cleanup_expired_llm_traces_boundary() {
        // Given: A DB with 3 traces: expired (cutoff - 100), exact boundary (cutoff), and recent (cutoff + 100)
        let conn = setup_test_db();
        let now = 1700000000i64;
        let retention_days = 30u64;
        let cutoff = now - (30 * 86_400);

        let trace_expired = LlmTraceInput {
            id: Some("trace_expired".to_string()),
            agent_scope: "scope".to_string(),
            system_prompt: "p".to_string(),
            tools_json: "[]".to_string(),
            user_message: "old msg".to_string(),
            raw_response: None,
            parsed_result: None,
            model: "m".to_string(),
            latency_ms: None,
            error: None,
            human_decision: None,
            created_at: Some(cutoff - 100),
        };
        let trace_boundary = LlmTraceInput {
            id: Some("trace_boundary".to_string()),
            agent_scope: "scope".to_string(),
            system_prompt: "p".to_string(),
            tools_json: "[]".to_string(),
            user_message: "boundary msg".to_string(),
            raw_response: None,
            parsed_result: None,
            model: "m".to_string(),
            latency_ms: None,
            error: None,
            human_decision: None,
            created_at: Some(cutoff),
        };
        let trace_recent = LlmTraceInput {
            id: Some("trace_recent".to_string()),
            agent_scope: "scope".to_string(),
            system_prompt: "p".to_string(),
            tools_json: "[]".to_string(),
            user_message: "recent msg".to_string(),
            raw_response: None,
            parsed_result: None,
            model: "m".to_string(),
            latency_ms: None,
            error: None,
            human_decision: None,
            created_at: Some(cutoff + 100),
        };

        record_llm_trace_impl(&conn, trace_expired).expect("insert expired trace");
        record_llm_trace_impl(&conn, trace_boundary).expect("insert boundary trace");
        record_llm_trace_impl(&conn, trace_recent).expect("insert recent trace");

        // When: Cleanup is executed
        let deleted_count =
            cleanup_expired_llm_traces(&conn, retention_days, now).expect("cleanup succeeds");

        // Then: Only trace_expired (< cutoff) is deleted (1 record), boundary and recent remain (2 records)
        assert_eq!(deleted_count, 1);
        let remaining = get_llm_traces_impl(&conn, None).expect("query remaining");
        assert_eq!(remaining.len(), 2);
        let ids: Vec<String> = remaining.into_iter().map(|t| t.id).collect();
        assert!(!ids.contains(&"trace_expired".to_string()));
        assert!(ids.contains(&"trace_boundary".to_string()));
        assert!(ids.contains(&"trace_recent".to_string()));
    }

    #[test]
    fn test_tc_rust_audit_01_record_audit_log_success() {
        // Given: An in-memory DB with audit_logs table
        let conn = setup_test_db();

        // When: Recording an audit log for 'create_department' with decision 'approved'
        let log_id = record_audit_log_impl(
            &conn,
            "create_department",
            "{\"name\":\"行銷部\"}",
            "approved",
            "user",
        )
        .expect("record audit log succeeds");

        // Then: Audit log is inserted and queryable
        assert!(log_id.starts_with("LOG-"));
        let mut stmt = conn
            .prepare("SELECT id, action_type, arguments, decision, operator FROM audit_logs WHERE id = ?1")
            .unwrap();
        let row = stmt
            .query_row(params![log_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                ))
            })
            .expect("query inserted audit log");

        assert_eq!(row.1, "create_department");
        assert_eq!(row.2, "{\"name\":\"行銷部\"}");
        assert_eq!(row.3, "approved");
        assert_eq!(row.4, "user");
    }
}
