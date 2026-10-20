#[cfg(not(test))]
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
#[cfg(not(test))]
use tauri::Manager;

pub mod auth;
pub mod departments;
pub mod llm;
pub mod llm_traces;
pub mod partners;
pub mod products;
pub mod tasks;
pub mod tps2_types;

#[cfg(test)]
thread_local! {
    pub(crate) static TEST_DB_PATH: std::cell::RefCell<Option<PathBuf>> = std::cell::RefCell::new(None);
}

#[derive(serde::Serialize, Clone)]
pub struct ChatResponseChunk {
    pub token: String,
    pub done: bool,
}

// Locate SQLite DB path in secure AppData folder
pub(crate) fn get_db_path<R: tauri::Runtime>(app_handle: &tauri::AppHandle<R>) -> PathBuf {
    #[cfg(test)]
    {
        let _ = app_handle;
        TEST_DB_PATH.with(|path| {
            if let Some(ref p) = *path.borrow() {
                p.clone()
            } else {
                PathBuf::from("target/agent_erp_test.db")
            }
        })
    }
    #[cfg(not(test))]
    {
        let mut path = app_handle
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| PathBuf::from("."));
        if !path.exists() {
            let _ = fs::create_dir_all(&path);
        }
        path.push("agent_erp.db");
        path
    }
}

// Check if demo seeding is explicitly enabled via environment variable
fn parse_seed_demo_flag(raw: Option<&str>) -> bool {
    raw.map(|v| v == "1").unwrap_or(false)
}

fn should_seed_demo_data() -> bool {
    parse_seed_demo_flag(std::env::var("AGENT_ERP_SEED_DEMO_DATA").ok().as_deref())
}

// Database Initialization (SQLite)
fn init_db<R: tauri::Runtime>(app_handle: &tauri::AppHandle<R>) -> Result<(), String> {
    let db_path = get_db_path(app_handle);
    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Failed to open DB: {}", e))?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS modules (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            version TEXT NOT NULL,
            file_path TEXT NOT NULL,
            sha256 TEXT NOT NULL,
            workspace TEXT NOT NULL,
            icon_svg TEXT NOT NULL DEFAULT '',
            installed_at INTEGER NOT NULL
        )",
        [],
    )
    .map_err(|e| format!("Failed to create modules table: {}", e))?;

    // Migration to add icon_svg column to modules if it does not exist
    let _ = conn.execute(
        "ALTER TABLE modules ADD COLUMN icon_svg TEXT NOT NULL DEFAULT ''",
        [],
    );

    conn.execute(
        "CREATE TABLE IF NOT EXISTS mirrored_orders (
            so_id TEXT PRIMARY KEY,
            customer_name TEXT NOT NULL,
            po_reference TEXT NOT NULL,
            items_json TEXT NOT NULL,
            total_amount REAL NOT NULL,
            profit_margin REAL NOT NULL,
            capacity_usage REAL NOT NULL,
            status TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )",
        [],
    )
    .map_err(|e| format!("Failed to create mirrored_orders table: {}", e))?;

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
    .map_err(|e| format!("Failed to create audit_logs table: {}", e))?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            name TEXT NOT NULL DEFAULT ''
        )",
        [],
    )
    .map_err(|e| format!("Failed to create users table: {}", e))?;

    // Migration to add name column to users if it does not exist
    let _ = conn.execute(
        "ALTER TABLE users ADD COLUMN name TEXT NOT NULL DEFAULT ''",
        [],
    );

    conn.execute(
        "CREATE TABLE IF NOT EXISTS tenants (
            id TEXT PRIMARY KEY,
            code TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            company_name TEXT NOT NULL,
            tax_id TEXT
        )",
        [],
    )
    .map_err(|e| format!("Failed to create tenants table: {}", e))?;

    // Migration to add tax_id column to tenants if it does not exist
    let _ = conn.execute("ALTER TABLE tenants ADD COLUMN tax_id TEXT", []);

    conn.execute(
        "CREATE TABLE IF NOT EXISTS user_tenants (
            user_id TEXT NOT NULL,
            tenant_id TEXT NOT NULL,
            role TEXT NOT NULL,
            PRIMARY KEY (user_id, tenant_id)
        )",
        [],
    )
    .map_err(|e| format!("Failed to create user_tenants table: {}", e))?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS user_departments (
            user_id TEXT NOT NULL,
            tenant_id TEXT NOT NULL,
            department_id TEXT NOT NULL,
            PRIMARY KEY (user_id, tenant_id, department_id)
        )",
        [],
    )
    .map_err(|e| format!("Failed to create user_departments table: {}", e))?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            active_tenant_id TEXT,
            created_at INTEGER NOT NULL
        )",
        [],
    )
    .map_err(|e| format!("Failed to create sessions table: {}", e))?;

    tasks::create_tasks_tables(&conn)
        .map_err(|e| format!("Failed to create tasks tables: {}", e))?;

    departments::create_departments_table(&conn)
        .map_err(|e| format!("Failed to create departments table: {}", e))?;

    partners::create_partners_table(&conn)
        .map_err(|e| format!("Failed to create partners table: {}", e))?;

    products::create_products_tables(&conn)
        .map_err(|e| format!("Failed to create products tables: {}", e))?;

    llm_traces::create_llm_traces_table(&conn)
        .map_err(|e| format!("Failed to create llm_traces table: {}", e))?;

    let trace_retention_days = llm_traces::parse_trace_retention_days(
        std::env::var("AGENT_ERP_LLM_TRACE_RETENTION_DAYS")
            .ok()
            .as_deref(),
    );
    let now = llm_traces::current_timestamp();
    let _ = llm_traces::cleanup_expired_llm_traces(&conn, trace_retention_days, now);

    // Seed default mock users and tenants if users table is empty and AGENT_ERP_SEED_DEMO_DATA=1 is explicitly set
    let mut stmt_users = conn
        .prepare("SELECT count(*) FROM users")
        .map_err(|e| e.to_string())?;
    let users_count: i64 = stmt_users.query_row([], |row| row.get(0)).unwrap_or(0);
    if users_count == 0 && should_seed_demo_data() {
        // Sha256 hash of "password123"
        let password_hash = "ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f";

        conn.execute(
            "INSERT INTO users (id, email, password, name) VALUES (?1, ?2, ?3, ?4)",
            (
                "usr_mock_admin",
                "admin@example.com",
                password_hash,
                "Admin User",
            ),
        )
        .map_err(|e| format!("Failed to seed admin user: {}", e))?;

        conn.execute(
            "INSERT INTO users (id, email, password, name) VALUES (?1, ?2, ?3, ?4)",
            ("usr_mock_new", "new@example.com", password_hash, "New User"),
        )
        .map_err(|e| format!("Failed to seed new user: {}", e))?;

        conn.execute(
            "INSERT INTO tenants (id, code, name, company_name, tax_id) VALUES (?1, ?2, ?3, ?4, ?5)",
            ("tnt_mock_1", "numax", "Numax Office", "Numax Inc.", Option::<String>::None),
        ).map_err(|e| format!("Failed to seed tenant 1: {}", e))?;

        conn.execute(
            "INSERT INTO tenants (id, code, name, company_name, tax_id) VALUES (?1, ?2, ?3, ?4, ?5)",
            ("tnt_mock_2", "alpha", "Alpha Corporation", "Alpha Corp.", Option::<String>::None),
        ).map_err(|e| format!("Failed to seed tenant 2: {}", e))?;

        conn.execute(
            "INSERT INTO user_tenants (user_id, tenant_id, role) VALUES (?1, ?2, ?3)",
            ("usr_mock_admin", "tnt_mock_1", "admin"),
        )
        .map_err(|e| format!("Failed to seed user_tenant 1: {}", e))?;

        conn.execute(
            "INSERT INTO user_tenants (user_id, tenant_id, role) VALUES (?1, ?2, ?3)",
            ("usr_mock_admin", "tnt_mock_2", "member"),
        )
        .map_err(|e| format!("Failed to seed user_tenant 2: {}", e))?;

        // Seed default mock departments if empty
        let mut stmt_depts = conn
            .prepare("SELECT count(*) FROM departments")
            .map_err(|e| e.to_string())?;
        let depts_count: i64 = stmt_depts.query_row([], |row| row.get(0)).unwrap_or(0);
        if depts_count == 0 {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;
            conn.execute(
                "INSERT INTO departments (id, tenant_id, name, parent_id, created_at) VALUES
                 ('dept_mock_1', 'tnt_mock_1', '總經理室', NULL, ?1),
                 ('dept_mock_2', 'tnt_mock_1', '研發總處', NULL, ?1),
                 ('dept_mock_3', 'tnt_mock_1', '前端小組', 'dept_mock_2', ?1),
                 ('dept_mock_4', 'tnt_mock_1', '後端架構組', 'dept_mock_2', ?1),
                 ('dept_mock_5', 'tnt_mock_1', '行銷業務部', NULL, ?1),
                 ('dept_mock_6', 'tnt_mock_1', '財務會計處', NULL, ?1)",
                [now],
            )
            .map_err(|e| format!("Failed to seed departments: {}", e))?;
        }

        // Seed default mock tasks if empty
        let mut stmt_tasks = conn
            .prepare("SELECT count(*) FROM tasks")
            .map_err(|e| e.to_string())?;
        let tasks_count: i64 = stmt_tasks.query_row([], |row| row.get(0)).unwrap_or(0);
        if tasks_count == 0 {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;
            conn.execute(
                "INSERT INTO tasks (id, tenant_id, title, status, parent_task_id, module_id, assignee, skill_id, created_at) VALUES
                 ('task_parent_1', 'tnt_mock_1', '新租戶起步', 'in_progress', NULL, 'sales', '主管', NULL, ?1),
                 ('task_sub_1', 'tnt_mock_1', '設定部門', 'pending', 'task_parent_1', 'sales', '主管', 'department.manage', ?1),
                 ('task_sub_2', 'tnt_mock_1', '建立第一個客戶', 'pending', 'task_parent_1', 'sales', '主管', 'customer.create_basic_profile', ?1),
                 ('task_sub_3', 'tnt_mock_1', '建立第一個供應商', 'pending', 'task_parent_1', 'sales', '主管', 'vendor.create_basic_profile', ?1),
                 ('task_sub_4', 'tnt_mock_1', '建立第一個商品', 'pending', 'task_parent_1', 'sales', '主管', 'product.create_basic_profile', ?1)",
                [now],
            ).map_err(|e| format!("Failed to seed tasks: {}", e))?;

            let pending_count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM tasks WHERE tenant_id = 'tnt_mock_1' AND status = 'pending'",
                [],
                |row| row.get(0),
            ).map_err(|e| format!("Failed to query pending task count: {}", e))?;

            let welcome_content = format!(
                "你好，我是 AgentERP 智能助理。已載入本地安全邊緣工作站上下文。您目前有 {} 筆待處理任務、1 則未讀通知。想從下面的常用任務開始，或直接跟我說您需要什麼協助：",
                pending_count
            );

            conn.execute(
                "INSERT INTO task_messages (id, task_id, role, content, timestamp) VALUES
                 ('msg_1', 'main', 'assistant', ?1, ?2),
                 ('msg_2', 'task_sub_1', 'assistant', '您好！我是部門設定助理。新租戶建立完成後，首要步驟是建立組織部門。請問您想先新增哪一個部門？（您可以直接輸入「我想新增行銷部」或詢問「目前有哪些部門」）', ?2),
                 ('msg_3', 'task_sub_2', 'assistant', '您好！我是客戶管理助理。新租戶建立完成後，讓我們來建立第一筆客戶基本資料。請問您想先新增哪一位客戶？（例如：「我想新增台積電 統編 22099131」）', ?2),
                 ('msg_4', 'task_sub_3', 'assistant', '您好！我是供應商管理助理。新租戶建立完成後，讓我們來建立第一筆供應商基本資料。請問您想先新增哪一家供應商？（例如：「我想新增欣興電子 統編 11223344」）', ?2),
                 ('msg_5', 'task_sub_4', 'assistant', '您好！我是商品資料管理助理。新租戶建立完成後，讓我們來建立第一筆商品基本資料。請問您想先新增哪一項商品？（例如：「我想新增智能核心晶片 分類 轉售商品 售價 120」）', ?2)",
                rusqlite::params![welcome_content, now],
            ).map_err(|e| format!("Failed to seed task messages: {}", e))?;
        }
    }

    Ok(())
}

/// Resolve the active tenant ID from the current session in SQLite or TokenStore.
pub fn resolve_active_tenant_id(conn: &rusqlite::Connection) -> Result<String, String> {
    // 1. Check KeyringTokenStore for active session token
    let token_store = auth::KeyringTokenStore::new();
    if let Ok(Some(pair)) = auth::TokenStore::load(&token_store) {
        if let Ok(mut stmt) = conn.prepare("SELECT active_tenant_id FROM sessions WHERE token = ?1")
        {
            if let Ok(Some(tid)) =
                stmt.query_row([&pair.access_token], |row| row.get::<_, Option<String>>(0))
            {
                let trimmed = tid.trim().to_string();
                if !trimmed.is_empty() {
                    return Ok(trimmed);
                }
            }
        }
    }

    // 2. Fallback to latest session in SQLite sessions table with non-empty active_tenant_id
    if let Ok(mut stmt) = conn.prepare(
        "SELECT active_tenant_id FROM sessions WHERE active_tenant_id IS NOT NULL AND TRIM(active_tenant_id) != '' ORDER BY created_at DESC LIMIT 1"
    ) {
        if let Ok(tid) = stmt.query_row([], |row| row.get::<_, String>(0)) {
            let trimmed = tid.trim().to_string();
            if !trimmed.is_empty() {
                return Ok(trimmed);
            }
        }
    }

    // 3. Fallback to first registered tenant in SQLite tenants table
    if let Ok(mut stmt) = conn.prepare("SELECT id FROM tenants ORDER BY rowid ASC LIMIT 1") {
        if let Ok(tid) = stmt.query_row([], |row| row.get::<_, String>(0)) {
            let trimmed = tid.trim().to_string();
            if !trimmed.is_empty() {
                return Ok(trimmed);
            }
        }
    }

    // 4. Fallback to default mock tenant
    Ok("tnt_mock_1".to_string())
}

// 1. Chat Streaming Simulator Command (via Tauri Channels)
// Removed 'pub' to resolve E0255 re-import macro name collisions in lib.rs
#[tauri::command]
async fn simulate_agent_chat(
    _workspace: String,
    _message: String,
    channel: tauri::ipc::Channel<ChatResponseChunk>,
) -> Result<(), String> {
    tokio::spawn(async move {
        let response_text = "智能助理已就緒。隨時可以為您服務，請告訴我您需要什麼協助。";

        // Split text by space and stream back
        let words: Vec<&str> = response_text.split_whitespace().collect();
        for (i, word) in words.iter().enumerate() {
            let is_last = i == words.len() - 1;
            let chunk = ChatResponseChunk {
                token: format!("{} ", word),
                done: is_last,
            };
            let _ = channel.send(chunk);
            tokio::time::sleep(tokio::time::Duration::from_millis(60)).await;
        }
    });
    Ok(())
}

// Removed 'pub' to resolve E0255 re-import macro name collisions in lib.rs
#[tauri::command]
async fn get_audit_logs(app_handle: AppHandle) -> Result<serde_json::Value, String> {
    let db_path = get_db_path(&app_handle);
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id, action_type, arguments, decision, operator, timestamp FROM audit_logs ORDER BY timestamp DESC").map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        Ok(serde_json::json!({
            "id": row.get::<_, String>(0)?,
            "action_type": row.get::<_, String>(1)?,
            "arguments": serde_json::from_str::<serde_json::Value>(&row.get::<_, String>(2)?).unwrap_or(serde_json::json!({})),
            "decision": row.get::<_, String>(3)?,
            "operator": row.get::<_, String>(4)?,
            "timestamp": row.get::<_, i64>(5)?,
        }))
    }).map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for val in rows.flatten() {
        list.push(val);
    }
    Ok(serde_json::json!(list))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let app_handle = app.handle();
            // Initialize local database
            init_db(app_handle).expect("Failed to initialize SQLite Database");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            simulate_agent_chat,
            get_audit_logs,
            auth::api_call,
            auth::get_auth_status,
            auth::logout,
            tasks::create_task,
            tasks::list_tasks,
            tasks::update_task_status,
            tasks::append_task_message,
            tasks::get_task_messages,
            departments::create_department,
            departments::list_departments,
            departments::update_department_skills,
            partners::create_partner,
            partners::list_partners,
            partners::update_partner,
            products::create_product,
            products::list_products,
            products::get_product_detail,
            products::add_product_variant,
            products::update_product_variant,
            products::add_product_unit,
            products::update_product_unit,
            products::add_supply_source,
            products::update_supply_source,
            products::add_bom_item,
            llm::detect_department_intent,
            llm_traces::record_llm_trace,
            llm_traces::update_llm_trace_decision,
            llm_traces::get_llm_traces,
            llm_traces::record_audit_log
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_seed_demo_flag_equivalence_and_boundaries() {
        // Given: Various input values for AGENT_ERP_SEED_DEMO_DATA (normal, boundary, invalid)
        let cases = vec![
            // Normal / Equivalence - Valid opt-in flag
            (Some("1"), true, "Valid opt-in flag '1'"),
            // Boundary values - Non-1 values
            (Some("0"), false, "Boundary '0' must not enable demo seed"),
            (
                Some("true"),
                false,
                "String 'true' must not enable demo seed",
            ),
            (Some(""), false, "Empty string must not enable demo seed"),
            (
                Some(" 1 "),
                false,
                "String with spaces must not enable demo seed",
            ),
            (Some("-1"), false, "Boundary '-1' must not enable demo seed"),
            // Boundary value - None / Unset
            (
                None,
                false,
                "None (unset) must default to false for production safety",
            ),
        ];

        for (input, expected, description) in cases {
            // When: Parsing the flag value
            let actual = parse_seed_demo_flag(input);

            // Then: Output must strictly match expected boolean
            assert_eq!(
                actual, expected,
                "Failed case: {} (input: {:?})",
                description, input
            );
        }
    }
}
