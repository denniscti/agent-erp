use crate::get_db_path;
use rusqlite::params;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static WH_ID_COUNTER: AtomicU64 = AtomicU64::new(1000);

fn current_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq, Eq)]
pub struct Warehouse {
    pub id: String,
    pub tenant_id: String,
    pub code: String,
    pub name: String,
    pub is_default: bool,
    pub is_active: bool,
    pub created_at: i64,
}

pub fn create_warehouses_tables(conn: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS warehouses (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            code TEXT NOT NULL,
            name TEXT NOT NULL,
            is_default INTEGER NOT NULL DEFAULT 0,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL
        )",
        [],
    )?;

    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouses_tenant_code ON warehouses (tenant_id, code COLLATE NOCASE)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_warehouses_tenant ON warehouses (tenant_id)",
        [],
    )?;

    Ok(())
}

/// Helper: Ensure warehouse_id columns and indices exist on legacy tables (shared across modules)
pub fn ensure_warehouse_columns_and_indices(
    conn: &rusqlite::Connection,
) -> Result<(), rusqlite::Error> {
    let _ = conn.execute(
        "ALTER TABLE purchase_orders ADD COLUMN warehouse_id TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE inventory_movements ADD COLUMN warehouse_id TEXT",
        [],
    );
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_im_tenant_unit_warehouse ON inventory_movements (tenant_id, unit_id, warehouse_id)",
        [],
    );
    Ok(())
}

/// Idempotent migration and backfill for warehouse_id on inventory_movements and purchase_orders.
pub fn run_warehouses_migration_and_backfill(
    conn: &rusqlite::Connection,
) -> Result<(), rusqlite::Error> {
    // 1. Ensure columns exist on legacy tables
    ensure_warehouse_columns_and_indices(conn)?;

    // 2. Check persistent completion flag (O(1) startup cost)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        [],
    )?;
    let already_completed: bool = conn
        .query_row(
            "SELECT 1 FROM app_metadata WHERE key = 'warehouses_legacy_backfill_done' LIMIT 1",
            [],
            |_| Ok(true),
        )
        .unwrap_or(false);

    if already_completed {
        return Ok(());
    }

    // 3. Lightweight existence check (O(1)) before scanning for tenants
    let has_null_rows: bool = conn
        .query_row(
            "SELECT 1 FROM inventory_movements WHERE warehouse_id IS NULL LIMIT 1",
            [],
            |_| Ok(true),
        )
        .unwrap_or(false)
        || conn
            .query_row(
                "SELECT 1 FROM purchase_orders WHERE warehouse_id IS NULL LIMIT 1",
                [],
                |_| Ok(true),
            )
            .unwrap_or(false);

    if !has_null_rows {
        let _ = conn.execute(
            "INSERT OR REPLACE INTO app_metadata (key, value) VALUES ('warehouses_legacy_backfill_done', '1')",
            [],
        );
        return Ok(());
    }

    // 4. Find distinct tenants with NULL warehouse_id in movements or POs
    let mut stmt = conn.prepare(
        "SELECT DISTINCT tenant_id FROM (
            SELECT tenant_id FROM inventory_movements WHERE warehouse_id IS NULL
            UNION
            SELECT tenant_id FROM purchase_orders WHERE warehouse_id IS NULL
        )",
    )?;

    let tenant_ids: Vec<String> = stmt
        .query_map([], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();

    let now = current_timestamp();

    for tid in tenant_ids {
        if tid.trim().is_empty() {
            continue;
        }

        // Check if tenant has a default warehouse
        let default_wh_opt: Option<String> = conn
            .query_row(
                "SELECT id FROM warehouses WHERE tenant_id = ?1 AND is_default = 1 LIMIT 1",
                [&tid],
                |row| row.get(0),
            )
            .ok();

        let default_wh_id = match default_wh_opt {
            Some(id) => id,
            None => {
                // Check if tenant has any warehouse at all
                let any_wh_opt: Option<String> = conn
                    .query_row(
                        "SELECT id FROM warehouses WHERE tenant_id = ?1 ORDER BY created_at ASC LIMIT 1",
                        [&tid],
                        |row| row.get(0),
                    )
                    .ok();

                if let Some(existing_id) = any_wh_opt {
                    let _ = conn.execute(
                        "UPDATE warehouses SET is_default = 1 WHERE id = ?1",
                        [&existing_id],
                    );
                    existing_id
                } else {
                    let new_id = format!(
                        "wh_{}_{}",
                        now,
                        WH_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
                    );
                    conn.execute(
                        "INSERT INTO warehouses (id, tenant_id, code, name, is_default, is_active, created_at)
                         VALUES (?1, ?2, 'MAIN', '主倉', 1, 1, ?3)",
                        rusqlite::params![new_id, tid, now],
                    )?;
                    new_id
                }
            }
        };

        // Backfill NULL warehouse_id for this tenant
        conn.execute(
            "UPDATE inventory_movements SET warehouse_id = ?1 WHERE tenant_id = ?2 AND warehouse_id IS NULL",
            rusqlite::params![default_wh_id, tid],
        )?;

        conn.execute(
            "UPDATE purchase_orders SET warehouse_id = ?1 WHERE tenant_id = ?2 AND warehouse_id IS NULL",
            rusqlite::params![default_wh_id, tid],
        )?;
    }

    let _ = conn.execute(
        "INSERT OR REPLACE INTO app_metadata (key, value) VALUES ('warehouses_legacy_backfill_done', '1')",
        [],
    );

    Ok(())
}

/// Helper: Check if tenant has any warehouses (active or inactive)
pub fn has_any_warehouses(conn: &rusqlite::Connection, tenant_id: &str) -> Result<bool, String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM warehouses WHERE tenant_id = ?1",
            [tenant_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(count > 0)
}

/// Helper: Resolve the active default warehouse for the tenant, or error if not found.
pub fn resolve_default_warehouse(
    conn: &rusqlite::Connection,
    tenant_id: &str,
) -> Result<Warehouse, String> {
    if !has_any_warehouses(conn, tenant_id)? {
        return Err("此租戶尚未建立任何倉別，請先至「倉庫管理」建立一個倉別".to_string());
    }

    let mut stmt = conn
        .prepare("SELECT id, tenant_id, code, name, is_default, is_active, created_at FROM warehouses WHERE tenant_id = ?1 AND is_default = 1 LIMIT 1")
        .map_err(|e| e.to_string())?;

    let wh_res = stmt.query_row([tenant_id], |r| {
        Ok(Warehouse {
            id: r.get(0)?,
            tenant_id: r.get(1)?,
            code: r.get(2)?,
            name: r.get(3)?,
            is_default: r.get::<_, i64>(4)? == 1,
            is_active: r.get::<_, i64>(5)? == 1,
            created_at: r.get(6)?,
        })
    });

    match wh_res {
        Ok(wh) => {
            if !wh.is_active {
                return Err("預設倉已停用，請先重新啟用或設定其他預設倉".to_string());
            }
            Ok(wh)
        }
        Err(_) => {
            // Fallback to first active warehouse if no default is marked
            let mut stmt2 = conn
                .prepare("SELECT id, tenant_id, code, name, is_default, is_active, created_at FROM warehouses WHERE tenant_id = ?1 AND is_active = 1 ORDER BY created_at ASC LIMIT 1")
                .map_err(|e| e.to_string())?;
            stmt2
                .query_row([tenant_id], |r| {
                    Ok(Warehouse {
                        id: r.get(0)?,
                        tenant_id: r.get(1)?,
                        code: r.get(2)?,
                        name: r.get(3)?,
                        is_default: r.get::<_, i64>(4)? == 1,
                        is_active: r.get::<_, i64>(5)? == 1,
                        created_at: r.get(6)?,
                    })
                })
                .map_err(|_| "找不到啟用的預設倉別".to_string())
        }
    }
}

/// Helper: Validate warehouse exists, belongs to tenant, and is active (Rule W-04)
pub fn validate_warehouse_active(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    warehouse_id: &str,
) -> Result<Warehouse, String> {
    let trimmed = warehouse_id.trim();
    if trimmed.is_empty() {
        return Err("找不到倉別或倉別已停用".to_string());
    }

    let mut stmt = conn
        .prepare("SELECT id, tenant_id, code, name, is_default, is_active, created_at FROM warehouses WHERE id = ?1 AND tenant_id = ?2")
        .map_err(|e| e.to_string())?;

    let wh = stmt
        .query_row(rusqlite::params![trimmed, tenant_id], |r| {
            Ok(Warehouse {
                id: r.get(0)?,
                tenant_id: r.get(1)?,
                code: r.get(2)?,
                name: r.get(3)?,
                is_default: r.get::<_, i64>(4)? == 1,
                is_active: r.get::<_, i64>(5)? == 1,
                created_at: r.get(6)?,
            })
        })
        .map_err(|_| "找不到倉別或倉別已停用".to_string())?;

    if !wh.is_active {
        return Err("找不到倉別或倉別已停用".to_string());
    }

    Ok(wh)
}

// ==========================================
// Usecase Implementations
// ==========================================

pub fn create_warehouse_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    code: &str,
    name: &str,
) -> Result<Warehouse, String> {
    if tenant_id.trim().is_empty() {
        return Err("Tenant ID cannot be empty".to_string());
    }

    let trimmed_code = code.trim();
    if trimmed_code.is_empty() {
        return Err("倉別代碼不可空白".to_string());
    }

    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("倉別名稱不可空白".to_string());
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // W-02: Code uniqueness within tenant (case-insensitive)
    let dup_count: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM warehouses WHERE tenant_id = ?1 AND LOWER(TRIM(code)) = LOWER(?2)",
            params![tenant_id, trimmed_code],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    if dup_count > 0 {
        return Err("倉別代碼已存在".to_string());
    }

    // W-06: First warehouse created in tenant automatically becomes default
    let total_count: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM warehouses WHERE tenant_id = ?1",
            params![tenant_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    let is_default = total_count == 0;
    let is_default_int = if is_default { 1 } else { 0 };
    let now = current_timestamp();
    let wh_id = format!(
        "wh_{}_{}",
        now,
        WH_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    );

    tx.execute(
        "INSERT INTO warehouses (id, tenant_id, code, name, is_default, is_active, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)",
        params![
            wh_id,
            tenant_id,
            trimmed_code,
            trimmed_name,
            is_default_int,
            now
        ],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(Warehouse {
        id: wh_id,
        tenant_id: tenant_id.to_string(),
        code: trimmed_code.to_string(),
        name: trimmed_name.to_string(),
        is_default,
        is_active: true,
        created_at: now,
    })
}

pub fn update_warehouse_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    warehouse_id: &str,
    code: &str,
    name: &str,
) -> Result<Warehouse, String> {
    if tenant_id.trim().is_empty() {
        return Err("Tenant ID cannot be empty".to_string());
    }

    let trimmed_id = warehouse_id.trim();
    if trimmed_id.is_empty() {
        return Err("找不到倉別或不屬於目前租戶".to_string());
    }

    let trimmed_code = code.trim();
    if trimmed_code.is_empty() {
        return Err("倉別代碼不可空白".to_string());
    }

    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("倉別名稱不可空白".to_string());
    }

    // Ensure warehouse exists for this tenant
    let (is_default, is_active, created_at): (bool, bool, i64) = {
        let mut stmt = conn
            .prepare("SELECT is_default, is_active, created_at FROM warehouses WHERE id = ?1 AND tenant_id = ?2")
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![trimmed_id, tenant_id], |r| {
            Ok((
                r.get::<_, i64>(0)? == 1,
                r.get::<_, i64>(1)? == 1,
                r.get(2)?,
            ))
        })
        .map_err(|_| "找不到倉別或不屬於目前租戶".to_string())?
    };

    // W-02: Check duplicate code excluding self
    let dup_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM warehouses WHERE tenant_id = ?1 AND LOWER(TRIM(code)) = LOWER(?2) AND id != ?3",
            params![tenant_id, trimmed_code, trimmed_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    if dup_count > 0 {
        return Err("倉別代碼已存在".to_string());
    }

    conn.execute(
        "UPDATE warehouses SET code = ?1, name = ?2 WHERE id = ?3 AND tenant_id = ?4",
        params![trimmed_code, trimmed_name, trimmed_id, tenant_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(Warehouse {
        id: trimmed_id.to_string(),
        tenant_id: tenant_id.to_string(),
        code: trimmed_code.to_string(),
        name: trimmed_name.to_string(),
        is_default,
        is_active,
        created_at,
    })
}

pub fn set_default_warehouse_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    warehouse_id: &str,
) -> Result<Warehouse, String> {
    if tenant_id.trim().is_empty() {
        return Err("Tenant ID cannot be empty".to_string());
    }

    let trimmed_id = warehouse_id.trim();
    if trimmed_id.is_empty() {
        return Err("找不到倉別或不屬於目前租戶".to_string());
    }

    let (code, name, is_active, created_at) = conn
        .query_row(
            "SELECT code, name, is_active, created_at FROM warehouses WHERE id = ?1 AND tenant_id = ?2",
            params![trimmed_id, tenant_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)? == 1,
                    r.get::<_, i64>(3)?,
                ))
            },
        )
        .map_err(|_| "找不到倉別或不屬於目前租戶".to_string())?;

    // W-05: Target warehouse must be active
    if !is_active {
        return Err("停用中的倉別不可設為預設".to_string());
    }

    // W-05: Atomic transaction to switch default warehouse
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE warehouses SET is_default = 0 WHERE tenant_id = ?1",
        params![tenant_id],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE warehouses SET is_default = 1 WHERE id = ?1 AND tenant_id = ?2",
        params![trimmed_id, tenant_id],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(Warehouse {
        id: trimmed_id.to_string(),
        tenant_id: tenant_id.to_string(),
        code,
        name,
        is_default: true,
        is_active: true,
        created_at,
    })
}

pub fn deactivate_warehouse_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    warehouse_id: &str,
) -> Result<Warehouse, String> {
    if tenant_id.trim().is_empty() {
        return Err("Tenant ID cannot be empty".to_string());
    }

    let trimmed_id = warehouse_id.trim();
    if trimmed_id.is_empty() {
        return Err("找不到倉別或不屬於目前租戶".to_string());
    }

    let (code, name, is_default, _is_active, created_at) = conn
        .query_row(
            "SELECT code, name, is_default, is_active, created_at FROM warehouses WHERE id = ?1 AND tenant_id = ?2",
            params![trimmed_id, tenant_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)? == 1,
                    r.get::<_, i64>(3)? == 1,
                    r.get::<_, i64>(4)?,
                ))
            },
        )
        .map_err(|_| "找不到倉別或不屬於目前租戶".to_string())?;

    // W-03: Cannot deactivate default warehouse
    if is_default {
        return Err("預設倉不可停用".to_string());
    }

    // W-03: Cannot deactivate if any unit has non-zero stock (reusing get_inventory_level_impl)
    let mut stmt = conn
        .prepare("SELECT DISTINCT unit_id FROM inventory_movements WHERE tenant_id = ?1 AND warehouse_id = ?2")
        .map_err(|e| e.to_string())?;
    let unit_ids: Vec<String> = stmt
        .query_map(params![tenant_id, trimmed_id], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    for uid in unit_ids {
        if let Ok(lvl) = crate::purchase_orders::get_inventory_level_impl(
            conn,
            tenant_id,
            &uid,
            Some(trimmed_id),
        ) {
            if lvl.current_quantity.abs() > 0.000001 {
                return Err("此倉仍有庫存，請先調撥或調整歸零".to_string());
            }
        }
    }

    // W-03: Cannot deactivate if referenced by draft/ordered purchase orders
    let pending_po: Option<String> = conn
        .query_row(
            "SELECT po_number FROM purchase_orders 
             WHERE tenant_id = ?1 AND warehouse_id = ?2 AND status IN ('draft', 'ordered') 
             ORDER BY created_at ASC LIMIT 1",
            params![tenant_id, trimmed_id],
            |r| r.get(0),
        )
        .ok();

    if let Some(po_num) = pending_po {
        return Err(format!("此倉仍被未結案單據引用：{}", po_num));
    }

    // W-03 Extension: Cannot deactivate if referenced by draft inventory adjustments
    let has_adj_table = match conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='inventory_adjustments'",
        [],
        |_| Ok(true),
    ) {
        Ok(v) => v,
        Err(rusqlite::Error::QueryReturnedNoRows) => false,
        Err(e) => return Err(e.to_string()),
    };

    if has_adj_table {
        let pending_adj: Option<String> = match conn.query_row(
            "SELECT adjustment_number FROM inventory_adjustments 
             WHERE tenant_id = ?1 AND warehouse_id = ?2 AND status = 'draft' 
             ORDER BY created_at ASC LIMIT 1",
            params![tenant_id, trimmed_id],
            |r| r.get(0),
        ) {
            Ok(adj_num) => Some(adj_num),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => return Err(e.to_string()),
        };

        if let Some(adj_num) = pending_adj {
            return Err(format!("此倉仍被未結案單據引用：{}", adj_num));
        }
    }

    conn.execute(
        "UPDATE warehouses SET is_active = 0 WHERE id = ?1 AND tenant_id = ?2",
        params![trimmed_id, tenant_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(Warehouse {
        id: trimmed_id.to_string(),
        tenant_id: tenant_id.to_string(),
        code,
        name,
        is_default: false,
        is_active: false,
        created_at,
    })
}

pub fn reactivate_warehouse_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    warehouse_id: &str,
) -> Result<Warehouse, String> {
    if tenant_id.trim().is_empty() {
        return Err("Tenant ID cannot be empty".to_string());
    }

    let trimmed_id = warehouse_id.trim();
    if trimmed_id.is_empty() {
        return Err("找不到倉別或不屬於目前租戶".to_string());
    }

    let (code, name, is_default, created_at) = conn
        .query_row(
            "SELECT code, name, is_default, created_at FROM warehouses WHERE id = ?1 AND tenant_id = ?2",
            params![trimmed_id, tenant_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)? == 1,
                    r.get::<_, i64>(3)?,
                ))
            },
        )
        .map_err(|_| "找不到倉別或不屬於目前租戶".to_string())?;

    conn.execute(
        "UPDATE warehouses SET is_active = 1 WHERE id = ?1 AND tenant_id = ?2",
        params![trimmed_id, tenant_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(Warehouse {
        id: trimmed_id.to_string(),
        tenant_id: tenant_id.to_string(),
        code,
        name,
        is_default,
        is_active: true,
        created_at,
    })
}

pub fn list_warehouses_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    include_inactive: Option<bool>,
) -> Result<Vec<Warehouse>, String> {
    if tenant_id.trim().is_empty() {
        return Err("Tenant ID cannot be empty".to_string());
    }

    let inc = include_inactive.unwrap_or(false);
    let query = if inc {
        "SELECT id, tenant_id, code, name, is_default, is_active, created_at 
         FROM warehouses WHERE tenant_id = ?1 
         ORDER BY is_default DESC, created_at ASC"
    } else {
        "SELECT id, tenant_id, code, name, is_default, is_active, created_at 
         FROM warehouses WHERE tenant_id = ?1 AND is_active = 1 
         ORDER BY is_default DESC, created_at ASC"
    };

    let mut stmt = conn.prepare(query).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([tenant_id], |r| {
            Ok(Warehouse {
                id: r.get(0)?,
                tenant_id: r.get(1)?,
                code: r.get(2)?,
                name: r.get(3)?,
                is_default: r.get::<_, i64>(4)? == 1,
                is_active: r.get::<_, i64>(5)? == 1,
                created_at: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r.map_err(|e| e.to_string())?);
    }
    Ok(list)
}

// ==========================================
// Tauri Commands
// ==========================================

#[tauri::command]
#[specta::specta]
pub async fn create_warehouse<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    code: String,
    name: String,
) -> Result<Warehouse, String> {
    let db_path = get_db_path(&app);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    create_warehouse_impl(&mut conn, &active_tid, &code, &name)
}

#[tauri::command]
#[specta::specta]
pub async fn update_warehouse<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    code: String,
    name: String,
) -> Result<Warehouse, String> {
    let db_path = get_db_path(&app);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    update_warehouse_impl(&mut conn, &active_tid, &id, &code, &name)
}

#[tauri::command]
#[specta::specta]
pub async fn set_default_warehouse<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<Warehouse, String> {
    let db_path = get_db_path(&app);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    set_default_warehouse_impl(&mut conn, &active_tid, &id)
}

#[tauri::command]
#[specta::specta]
pub async fn deactivate_warehouse<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<Warehouse, String> {
    let db_path = get_db_path(&app);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    deactivate_warehouse_impl(&mut conn, &active_tid, &id)
}

#[tauri::command]
#[specta::specta]
pub async fn reactivate_warehouse<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<Warehouse, String> {
    let db_path = get_db_path(&app);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    reactivate_warehouse_impl(&mut conn, &active_tid, &id)
}

#[tauri::command]
#[specta::specta]
pub async fn list_warehouses<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    include_inactive: Option<bool>,
) -> Result<Vec<Warehouse>, String> {
    let db_path = get_db_path(&app);
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    list_warehouses_impl(&conn, &active_tid, include_inactive)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::partners::create_partner_impl;
    use crate::products::create_product_impl;
    use crate::purchase_orders::{
        confirm_purchase_order_received_impl, create_purchase_order_impl,
        create_purchase_orders_tables, get_inventory_level_impl, list_inventory_levels_impl,
        record_opening_inventory_balance_impl, submit_purchase_order_impl,
        update_purchase_order_header_impl, CreatePurchaseOrderLineInput,
    };
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();

        conn.execute(
            "CREATE TABLE IF NOT EXISTS tenants (
                id TEXT PRIMARY KEY,
                code TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                company_name TEXT NOT NULL DEFAULT ''
            )",
            [],
        )
        .unwrap();

        conn.execute(
            "CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL,
                name TEXT NOT NULL DEFAULT ''
            )",
            [],
        )
        .unwrap();

        crate::partners::create_partners_table(&conn).unwrap();
        crate::products::create_products_tables(&conn).unwrap();
        create_warehouses_tables(&conn).unwrap();
        create_purchase_orders_tables(&conn).unwrap();

        conn.execute(
            "INSERT INTO tenants (id, code, name, company_name) VALUES ('tnt_test', 'test', 'Test Tenant', 'Test Inc.')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tenants (id, code, name, company_name) VALUES ('tnt_other', 'other', 'Other Tenant', 'Other Inc.')",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO users (id, email, password, name) VALUES ('usr_1', 'u1@example.com', 'hash', 'User One')",
            [],
        )
        .unwrap();

        conn
    }

    #[test]
    fn test_tc_wh_n_01_and_n_02_first_warehouse_default_and_second_false() {
        // Given: Clean database with tenant 'tnt_test' having 0 warehouses
        let mut conn = setup_test_db();

        // When: Creating the first warehouse in the tenant (W-06)
        let wh1 = create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉").unwrap();

        // Then: First warehouse automatically becomes default with is_default = true
        assert!(wh1.id.starts_with("wh_"));
        assert_eq!(wh1.code, "MAIN");
        assert_eq!(wh1.name, "主倉");
        assert!(wh1.is_default);
        assert!(wh1.is_active);

        // When: Creating the second warehouse in the same tenant
        let wh2 = create_warehouse_impl(&mut conn, "tnt_test", "SUB", "二倉").unwrap();

        // Then: Second warehouse is NOT default (is_default = false)
        assert!(wh2.id.starts_with("wh_"));
        assert_eq!(wh2.code, "SUB");
        assert_eq!(wh2.name, "二倉");
        assert!(!wh2.is_default);
        assert!(wh2.is_active);

        // Then: list_warehouses returns both, ordered by default first
        let list = list_warehouses_impl(&conn, "tnt_test", None).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, wh1.id);
        assert_eq!(list[1].id, wh2.id);
    }

    #[test]
    fn test_tc_wh_n_03_switch_default_warehouse_atomic() {
        // Given: Tenant with wh1 (default) and wh2 (non-default)
        let mut conn = setup_test_db();
        let wh1 = create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉").unwrap();
        let wh2 = create_warehouse_impl(&mut conn, "tnt_test", "SUB", "二倉").unwrap();
        assert!(wh1.is_default);
        assert!(!wh2.is_default);

        // When: Switching default warehouse to wh2 (W-05)
        let switched = set_default_warehouse_impl(&mut conn, "tnt_test", &wh2.id).unwrap();

        // Then: wh2 is now default
        assert_eq!(switched.id, wh2.id);
        assert!(switched.is_default);

        // Then: Exactly one warehouse in tenant is default
        let default_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM warehouses WHERE tenant_id = 'tnt_test' AND is_default = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(default_count, 1);

        // Then: wh1 is no longer default
        let wh1_db_default: i64 = conn
            .query_row(
                "SELECT is_default FROM warehouses WHERE id = ?1",
                [&wh1.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(wh1_db_default, 0);
    }

    #[test]
    fn test_tc_wh_n_04_update_code_and_name() {
        // Given: Existing warehouse
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉").unwrap();

        // When: Updating code and name
        let updated =
            update_warehouse_impl(&mut conn, "tnt_test", &wh.id, "CENTRAL", "中央總倉").unwrap();

        // Then: Code and name updated, default status preserved
        assert_eq!(updated.code, "CENTRAL");
        assert_eq!(updated.name, "中央總倉");
        assert!(updated.is_default);
    }

    #[test]
    fn test_tc_wh_n_05_deactivate_and_reactivate() {
        // Given: Tenant with default wh1 and non-default wh2
        let mut conn = setup_test_db();
        let wh1 = create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉").unwrap();
        let wh2 = create_warehouse_impl(&mut conn, "tnt_test", "SUB", "二倉").unwrap();

        // When: Deactivating non-default wh2
        let deactivated = deactivate_warehouse_impl(&mut conn, "tnt_test", &wh2.id).unwrap();

        // Then: wh2 is deactivated
        assert!(!deactivated.is_active);

        // Then: Default list_warehouses (include_inactive = false) returns only active wh1
        let active_list = list_warehouses_impl(&conn, "tnt_test", None).unwrap();
        assert_eq!(active_list.len(), 1);
        assert_eq!(active_list[0].id, wh1.id);

        // Then: list_warehouses with include_inactive = true returns both
        let all_list = list_warehouses_impl(&conn, "tnt_test", Some(true)).unwrap();
        assert_eq!(all_list.len(), 2);

        // When: Reactivating wh2
        let reactivated = reactivate_warehouse_impl(&mut conn, "tnt_test", &wh2.id).unwrap();

        // Then: wh2 is active again
        assert!(reactivated.is_active);
        let active_list_after = list_warehouses_impl(&conn, "tnt_test", None).unwrap();
        assert_eq!(active_list_after.len(), 2);
    }

    #[test]
    fn test_tc_wh_e_01_w00_zero_warehouse_rejections_and_q01_queries() {
        // Given: Tenant 'tnt_other' with 0 warehouses, with vendor and product set up
        let mut conn = setup_test_db();
        let vendor = create_partner_impl(
            &conn,
            "tnt_other",
            "零倉供應商".to_string(),
            None,
            Some(true),
            None,
        )
        .unwrap();
        let prod = create_product_impl(
            &conn,
            "tnt_other",
            "零倉測試品".to_string(),
            "resale".to_string(),
            None,
            Some("個".to_string()),
            Some(100.0),
        )
        .unwrap();
        let unit_id = &prod.units[0].id;

        // When: Zero-warehouse tenant attempts to create purchase order
        let po_err = create_purchase_order_impl(
            &mut conn,
            "tnt_other",
            "usr_1",
            &vendor.id,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap_err();

        // Then: Rejected with exact rule W-00 message
        assert_eq!(
            po_err,
            "此租戶尚未建立任何倉別，請先至「倉庫管理」建立一個倉別"
        );

        // When: Zero-warehouse tenant attempts to record opening inventory balance
        let inv_err = record_opening_inventory_balance_impl(
            &mut conn,
            "tnt_other",
            "usr_1",
            unit_id,
            10.0,
            50.0,
            None,
        )
        .unwrap_err();

        // Then: Rejected with exact rule W-00 message
        assert_eq!(
            inv_err,
            "此租戶尚未建立任何倉別，請先至「倉庫管理」建立一個倉別"
        );

        // When: Zero-warehouse tenant calls pure query list_inventory_levels (Q-01)
        let levels = list_inventory_levels_impl(&conn, "tnt_other", None).unwrap();

        // Then: Returns empty array without error
        assert!(levels.is_empty());

        // When: Zero-warehouse tenant calls pure query list_inventory_movements (Q-01)
        let movements =
            crate::purchase_orders::list_inventory_movements_impl(&conn, "tnt_other", None, None)
                .unwrap();

        // Then: Returns empty array without error
        assert!(movements.is_empty());

        // When: Zero-warehouse tenant calls pure query get_inventory_level (Q-01)
        let level =
            crate::purchase_orders::get_inventory_level_impl(&conn, "tnt_other", unit_id, None)
                .unwrap();

        // Then: Returns level with 0.0 current quantity
        assert_eq!(level.current_quantity, 0.0);

        // When: Zero-warehouse tenant calls pure query list_warehouses (Q-01)
        let warehouses = list_warehouses_impl(&conn, "tnt_other", None).unwrap();

        // Then: Returns empty array without error
        assert!(warehouses.is_empty());
    }

    #[test]
    fn test_tc_wh_e_02_duplicate_code_case_insensitive_and_empty_inputs() {
        // Given: Existing warehouse with code 'MAIN'
        let mut conn = setup_test_db();
        create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉").unwrap();

        // When: Creating warehouse with duplicate code in lowercase 'main' (W-02)
        let dup_err = create_warehouse_impl(&mut conn, "tnt_test", "main", "次倉").unwrap_err();
        // Then: Rejected with exact message
        assert_eq!(dup_err, "倉別代碼已存在");

        // When: Creating warehouse with duplicate code with leading/trailing spaces '  MAIN  '
        let dup_err2 =
            create_warehouse_impl(&mut conn, "tnt_test", "  MAIN  ", "次倉").unwrap_err();
        assert_eq!(dup_err2, "倉別代碼已存在");

        // When: Creating warehouse with empty code
        let empty_code = create_warehouse_impl(&mut conn, "tnt_test", "  ", "無代碼").unwrap_err();
        assert_eq!(empty_code, "倉別代碼不可空白");

        // When: Creating warehouse with empty name
        let empty_name =
            create_warehouse_impl(&mut conn, "tnt_test", "WH_EMPTY", "   ").unwrap_err();
        assert_eq!(empty_name, "倉別名稱不可空白");

        // When: Creating warehouse with empty tenant ID (W-01)
        let empty_tnt = create_warehouse_impl(&mut conn, "   ", "WH1", "倉1").unwrap_err();
        assert_eq!(empty_tnt, "Tenant ID cannot be empty");

        // When: Updating a warehouse to an existing code of another warehouse
        let wh2 = create_warehouse_impl(&mut conn, "tnt_test", "SEC", "二倉").unwrap();
        let update_dup_err =
            update_warehouse_impl(&mut conn, "tnt_test", &wh2.id, "main", "改名").unwrap_err();
        assert_eq!(update_dup_err, "倉別代碼已存在");
    }

    #[test]
    fn test_tc_wh_e_03_w03_deactivate_guards() {
        // Given: Setup with default warehouse wh1 and secondary warehouse wh2
        let mut conn = setup_test_db();
        let wh1 = create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉").unwrap();
        let wh2 = create_warehouse_impl(&mut conn, "tnt_test", "SUB", "二倉").unwrap();

        let vendor = create_partner_impl(
            &conn,
            "tnt_test",
            "保護測試供應商".to_string(),
            None,
            Some(true),
            None,
        )
        .unwrap();
        let prod = create_product_impl(
            &conn,
            "tnt_test",
            "防護測試品".to_string(),
            "resale".to_string(),
            None,
            Some("件".to_string()),
            Some(100.0),
        )
        .unwrap();
        let unit_id = &prod.units[0].id;

        // --- Guard 1: Cannot deactivate default warehouse ---
        // When: Attempting to deactivate wh1
        let err_default = deactivate_warehouse_impl(&mut conn, "tnt_test", &wh1.id).unwrap_err();
        // Then: Rejected
        assert_eq!(err_default, "預設倉不可停用");

        // --- Guard 2: Cannot deactivate warehouse with non-zero stock ---
        // Given: Opening inventory balance in wh2
        record_opening_inventory_balance_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            unit_id,
            15.0,
            50.0,
            Some(wh2.id.clone()),
        )
        .unwrap();

        // When: Attempting to deactivate wh2 with active inventory
        let err_stock = deactivate_warehouse_impl(&mut conn, "tnt_test", &wh2.id).unwrap_err();
        // Then: Rejected with stock zeroing warning
        assert_eq!(err_stock, "此倉仍有庫存，請先調撥或調整歸零");

        // --- Guard 3: Cannot deactivate warehouse referenced by draft or ordered purchase orders ---
        // Given: A third empty warehouse wh3 with zero stock
        let wh3 = create_warehouse_impl(&mut conn, "tnt_test", "PO_WH", "待收單倉").unwrap();
        let po_draft = create_purchase_order_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            &vendor.id,
            None,
            None,
            None,
            None,
            None,
            Some(wh3.id.clone()),
        )
        .unwrap();

        // When: Attempting to deactivate wh3 referenced by draft PO
        let err_po = deactivate_warehouse_impl(&mut conn, "tnt_test", &wh3.id).unwrap_err();
        // Then: Rejected with PO reference error
        assert_eq!(
            err_po,
            format!("此倉仍被未結案單據引用：{}", po_draft.order.po_number)
        );
    }

    #[test]
    fn test_tc_wh_e_04_w05_set_deactivated_as_default_rejected() {
        // Given: wh1 is default, wh2 is secondary and deactivated
        let mut conn = setup_test_db();
        let _wh1 = create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉").unwrap();
        let wh2 = create_warehouse_impl(&mut conn, "tnt_test", "SUB", "二倉").unwrap();
        deactivate_warehouse_impl(&mut conn, "tnt_test", &wh2.id).unwrap();

        // When: Attempting to set deactivated wh2 as default
        let err = set_default_warehouse_impl(&mut conn, "tnt_test", &wh2.id).unwrap_err();

        // Then: Rejected with exact specification message
        assert_eq!(err, "停用中的倉別不可設為預設");
    }

    #[test]
    fn test_tc_wh_po_and_inv_warehouse_dimension() {
        // Given: Tenant with wh1 (default) and wh2 (secondary), product and vendor
        let mut conn = setup_test_db();
        let wh1 = create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉").unwrap();
        let wh2 = create_warehouse_impl(&mut conn, "tnt_test", "SUB", "二倉").unwrap();

        let vendor = create_partner_impl(
            &conn,
            "tnt_test",
            "多倉測試廠商".to_string(),
            None,
            Some(true),
            None,
        )
        .unwrap();
        let prod = create_product_impl(
            &conn,
            "tnt_test",
            "維度測試商品".to_string(),
            "resale".to_string(),
            None,
            Some("台".to_string()),
            Some(500.0),
        )
        .unwrap();
        let unit_id = &prod.units[0].id;

        // When: Creating PO without warehouse_id (P-01 fallback to default)
        let po_default = create_purchase_order_impl(
            &mut conn, "tnt_test", "usr_1", &vendor.id, None, None, None, None, None, None,
        )
        .unwrap();
        // Then: Assigned to default warehouse wh1
        assert_eq!(po_default.order.warehouse_id, wh1.id);

        // When: Creating PO with explicit warehouse_id wh2
        let po_sub = create_purchase_order_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            &vendor.id,
            None,
            None,
            None,
            None,
            Some(vec![CreatePurchaseOrderLineInput {
                unit_id: unit_id.clone(),
                quantity: 8.0,
                purchase_cost: Some(300.0),
            }]),
            Some(wh2.id.clone()),
        )
        .unwrap();
        // Then: Assigned to wh2
        assert_eq!(po_sub.order.warehouse_id, wh2.id);

        // When: Updating PO header warehouse on draft PO (P-02)
        let updated_po = update_purchase_order_header_impl(
            &mut conn,
            "tnt_test",
            &po_sub.order.id,
            None,
            None,
            None,
            Some(wh1.id.clone()),
        )
        .unwrap();
        // Then: Warehouse updated to wh1
        assert_eq!(updated_po.order.warehouse_id, wh1.id);

        // When: Submitting and receiving PO into wh1 (P-03)
        submit_purchase_order_impl(&mut conn, "tnt_test", &updated_po.order.id).unwrap();
        let received = confirm_purchase_order_received_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            &updated_po.order.id,
            None,
        )
        .unwrap();
        assert_eq!(received.order.status, "received");

        // Then: Inventory movement recorded with wh1.id
        let mov: (String, f64) = conn
            .query_row(
                "SELECT warehouse_id, quantity_delta FROM inventory_movements WHERE reference_id = ?1",
                [&updated_po.order.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(mov.0, wh1.id);
        assert_eq!(mov.1, 8.0);

        // When: Recording opening balance for the same unit in wh2 (O-01 multi-warehouse independence)
        let open_sub = record_opening_inventory_balance_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            unit_id,
            20.0,
            280.0,
            Some(wh2.id.clone()),
        )
        .unwrap();
        assert_eq!(open_sub.warehouse_id, wh2.id);
        assert_eq!(open_sub.quantity_delta, 20.0);

        // When: Attempting duplicate opening balance in wh2
        let dup_open_err = record_opening_inventory_balance_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            unit_id,
            10.0,
            280.0,
            Some(wh2.id.clone()),
        )
        .unwrap_err();
        // Then: Rejected with formatted warehouse name (O-01)
        assert_eq!(
            dup_open_err,
            "此商品單位在〔二倉〕已開帳，數量更正請用庫存調整（原因：期初更正）"
        );

        // When: Querying inventory level specifically for wh1
        let level_wh1 =
            get_inventory_level_impl(&conn, "tnt_test", unit_id, Some(&wh1.id)).unwrap();
        assert_eq!(level_wh1.current_quantity, 8.0);
        assert_eq!(level_wh1.warehouse_id, Some(wh1.id.clone()));

        // When: Querying inventory level specifically for wh2
        let level_wh2 =
            get_inventory_level_impl(&conn, "tnt_test", unit_id, Some(&wh2.id)).unwrap();
        assert_eq!(level_wh2.current_quantity, 20.0);
        assert_eq!(level_wh2.warehouse_id, Some(wh2.id.clone()));

        // When: Querying all-warehouse total (warehouse_id = None)
        let level_total = get_inventory_level_impl(&conn, "tnt_test", unit_id, None).unwrap();
        assert_eq!(level_total.current_quantity, 28.0);
        assert_eq!(level_total.warehouse_id, None);
    }

    #[test]
    fn test_tc_wh_mig_idempotent_migration_and_backfill() {
        // Given: In-memory DB simulating legacy schema with NULL warehouse_id rows
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();

        conn.execute(
            "CREATE TABLE tenants (id TEXT PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tenants (id, code, name) VALUES ('tnt_legacy', 'legacy', 'Legacy Tenant')",
            [],
        )
        .unwrap();

        create_warehouses_tables(&conn).unwrap();

        // Create legacy purchase_orders without warehouse_id column
        conn.execute(
            "CREATE TABLE purchase_orders (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                po_number TEXT NOT NULL,
                vendor_partner_id TEXT NOT NULL,
                vendor_name_snapshot TEXT NOT NULL,
                status TEXT NOT NULL,
                total_amount REAL NOT NULL,
                currency TEXT NOT NULL,
                expected_delivery_date INTEGER,
                notes TEXT,
                task_id TEXT,
                ordered_at INTEGER,
                received_at INTEGER,
                cancelled_at INTEGER,
                created_by TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )",
            [],
        )
        .unwrap();

        // Create legacy inventory_movements without warehouse_id column
        conn.execute(
            "CREATE TABLE inventory_movements (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                unit_id TEXT NOT NULL,
                quantity_delta REAL NOT NULL,
                unit_cost REAL,
                reason TEXT NOT NULL,
                reference_id TEXT,
                created_by TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )",
            [],
        )
        .unwrap();

        // Insert legacy PO and movement
        conn.execute(
            "INSERT INTO purchase_orders (id, tenant_id, po_number, vendor_partner_id, vendor_name_snapshot, status, total_amount, currency, created_by, created_at)
             VALUES ('po_old', 'tnt_legacy', 'PO-00001', 'ptn_1', 'Old Vendor', 'draft', 100.0, 'TWD', 'usr_1', 1000)",
            [],
        ).unwrap();

        conn.execute(
            "INSERT INTO inventory_movements (id, tenant_id, unit_id, quantity_delta, unit_cost, reason, reference_id, created_by, created_at)
             VALUES ('mov_old', 'tnt_legacy', 'unt_1', 50.0, 10.0, 'opening_balance', NULL, 'usr_1', 1000)",
            [],
        ).unwrap();

        // When: First execution of migration and backfill
        run_warehouses_migration_and_backfill(&conn).unwrap();

        // Then: Default warehouse MAIN / 主倉 was created for tnt_legacy
        let wh: (String, String, bool) = conn
            .query_row(
                "SELECT code, name, is_default FROM warehouses WHERE tenant_id = 'tnt_legacy'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get::<_, i64>(2)? == 1)),
            )
            .unwrap();
        assert_eq!(wh.0, "MAIN");
        assert_eq!(wh.1, "主倉");
        assert!(wh.2);

        let default_wh_id: String = conn
            .query_row(
                "SELECT id FROM warehouses WHERE tenant_id = 'tnt_legacy'",
                [],
                |r| r.get(0),
            )
            .unwrap();

        // Then: Legacy rows in purchase_orders and inventory_movements have been backfilled
        let po_wh: String = conn
            .query_row(
                "SELECT warehouse_id FROM purchase_orders WHERE id = 'po_old'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(po_wh, default_wh_id);

        let mov_wh: String = conn
            .query_row(
                "SELECT warehouse_id FROM inventory_movements WHERE id = 'mov_old'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(mov_wh, default_wh_id);

        // When: Second execution to test idempotency
        run_warehouses_migration_and_backfill(&conn).unwrap();

        // Then: Total warehouse count remains 1
        let total_whs: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM warehouses WHERE tenant_id = 'tnt_legacy'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(total_whs, 1);
    }
}
