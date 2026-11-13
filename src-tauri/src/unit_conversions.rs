use crate::get_db_path;
use rusqlite::params;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static UCV_ID_COUNTER: AtomicU64 = AtomicU64::new(1000);
static IM_UCV_ID_COUNTER: AtomicU64 = AtomicU64::new(1000);

fn current_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn format_qty(q: f64) -> String {
    let rounded = (q * 1_000_000.0).round() / 1_000_000.0;
    if (rounded - rounded.round()).abs() < 1e-9 {
        format!("{:.0}", rounded)
    } else {
        let s = format!("{:.6}", rounded);
        let trimmed = s.trim_end_matches('0').trim_end_matches('.');
        trimmed.to_string()
    }
}

// ==========================================
// Data Structures
// ==========================================

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq)]
pub struct UnitConversion {
    pub id: String,
    pub tenant_id: String,
    pub conversion_number: String,
    pub warehouse_id: String,
    pub variant_id: String,
    pub from_unit_id: String,
    pub from_quantity: f64,
    pub to_unit_id: String,
    pub to_quantity: f64,
    pub status: String, // "draft" | "posted" | "cancelled"
    pub note: Option<String>,
    pub product_name_snapshot: String,
    pub variant_name_snapshot: String,
    pub sku_snapshot: Option<String>,
    pub from_unit_name_snapshot: String,
    pub to_unit_name_snapshot: String,
    pub created_by: String,
    pub created_at: i64,
    pub posted_at: Option<i64>,
    pub cancelled_at: Option<i64>,
    pub task_id: Option<String>,
}

struct UnitWithVariant {
    variant_id: String,
    unit_name: String,
    variant_name: String,
    sku: Option<String>,
    product_name: String,
}

// ==========================================
// Table Creation
// ==========================================

pub fn create_unit_conversions_tables(conn: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS unit_conversions (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            conversion_number TEXT NOT NULL,
            warehouse_id TEXT NOT NULL,
            variant_id TEXT NOT NULL,
            from_unit_id TEXT NOT NULL,
            from_quantity REAL NOT NULL,
            to_unit_id TEXT NOT NULL,
            to_quantity REAL NOT NULL,
            status TEXT NOT NULL,
            note TEXT,
            product_name_snapshot TEXT NOT NULL,
            variant_name_snapshot TEXT NOT NULL,
            sku_snapshot TEXT,
            from_unit_name_snapshot TEXT NOT NULL,
            to_unit_name_snapshot TEXT NOT NULL,
            created_by TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            posted_at INTEGER,
            cancelled_at INTEGER,
            task_id TEXT
        )",
        [],
    )?;

    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_ucv_tenant_number ON unit_conversions (tenant_id, conversion_number)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ucv_tenant ON unit_conversions (tenant_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ucv_tenant_warehouse ON unit_conversions (tenant_id, warehouse_id)",
        [],
    )?;

    Ok(())
}

// ==========================================
// Errors
// ==========================================

#[derive(Debug, PartialEq, Clone)]
pub struct InsufficientStockDetails {
    pub product_name: String,
    pub variant_name: String,
    pub unit_name: String,
    pub warehouse_name: String,
    pub available_qty: String,
    pub requested_qty: String,
}

impl std::fmt::Display for InsufficientStockDetails {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "〔{}／{}／{}〕在〔{}〕現有庫存 {} 不足，無法扣除轉換數量 {}",
            self.product_name,
            self.variant_name,
            self.unit_name,
            self.warehouse_name,
            self.available_qty,
            self.requested_qty
        )
    }
}

#[derive(Debug, PartialEq)]
pub enum UnitConversionError {
    EmptyTenantId,
    EmptyUserId,
    ConversionNotFound,
    WarehouseNotFoundOrInactive,
    WarehouseError(String),
    FromUnitNotFound,
    ToUnitNotFound,
    SameUnit,
    DifferentVariant,
    InvalidFromQuantity,
    InvalidToQuantity,
    InsufficientStock(Box<InsufficientStockDetails>),
    InvalidStateTransition { from: String, to: String },
    Database(String),
}

impl std::fmt::Display for UnitConversionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UnitConversionError::EmptyTenantId => write!(f, "tenant_id 不可為空"),
            UnitConversionError::EmptyUserId => write!(f, "user_id 不可為空"),
            UnitConversionError::ConversionNotFound => {
                write!(f, "找不到指定的單位轉換單或無權限存取")
            }
            UnitConversionError::WarehouseNotFoundOrInactive => {
                write!(f, "找不到指定的倉別或倉別已停用")
            }
            UnitConversionError::WarehouseError(msg) => write!(f, "{}", msg),
            UnitConversionError::FromUnitNotFound => {
                write!(f, "找不到來源商品單位 (from_unit_id) 或不屬於目前租戶")
            }
            UnitConversionError::ToUnitNotFound => {
                write!(f, "找不到目標商品單位 (to_unit_id) 或不屬於目前租戶")
            }
            UnitConversionError::SameUnit => write!(f, "來源單位與目標單位不可相同"),
            UnitConversionError::DifferentVariant => {
                write!(f, "來源單位與目標單位必須屬於同一個商品規格 (variant)")
            }
            UnitConversionError::InvalidFromQuantity => {
                write!(f, "來源數量 (from_quantity) 必須大於 0")
            }
            UnitConversionError::InvalidToQuantity => {
                write!(f, "目標數量 (to_quantity) 必須大於 0")
            }
            UnitConversionError::InsufficientStock(details) => write!(f, "{}", details),
            UnitConversionError::InvalidStateTransition { from, to } => {
                write!(f, "單位轉換單狀態為「{}」，無法變更為「{}」", from, to)
            }
            UnitConversionError::Database(msg) => write!(f, "{}", msg),
        }
    }
}

impl From<rusqlite::Error> for UnitConversionError {
    fn from(err: rusqlite::Error) -> Self {
        UnitConversionError::Database(err.to_string())
    }
}

// ==========================================
// Helpers
// ==========================================

fn resolve_unit_with_variant(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    unit_id: &str,
) -> Option<UnitWithVariant> {
    let mut stmt = conn
        .prepare(
            "SELECT u.variant_id, u.unit_name, v.name, v.sku, p.name
             FROM product_units u
             JOIN product_variants v ON u.variant_id = v.id
             JOIN products p ON v.product_id = p.id
             WHERE u.id = ?1 AND p.tenant_id = ?2",
        )
        .ok()?;

    stmt.query_row(params![unit_id, tenant_id], |row| {
        Ok(UnitWithVariant {
            variant_id: row.get(0)?,
            unit_name: row.get(1)?,
            variant_name: row.get(2)?,
            sku: row.get(3)?,
            product_name: row.get(4)?,
        })
    })
    .ok()
}

fn next_ucv_number(
    tx: &rusqlite::Transaction,
    tenant_id: &str,
) -> Result<String, UnitConversionError> {
    let mut stmt = tx.prepare(
        "SELECT COALESCE(MAX(CAST(SUBSTR(conversion_number, 5) AS INTEGER)), 0) + 1
         FROM unit_conversions WHERE tenant_id = ?1",
    )?;
    let next_seq: i64 = stmt.query_row(params![tenant_id], |row| row.get(0))?;
    Ok(format!("UCV-{:05}", next_seq))
}

fn validate_positive_qty(qty: f64) -> bool {
    qty.is_finite() && qty > 1e-9
}

const UNIT_CONVERSION_COLUMNS: &str = "
    id, tenant_id, conversion_number, warehouse_id, variant_id,
    from_unit_id, from_quantity, to_unit_id, to_quantity,
    status, note, product_name_snapshot, variant_name_snapshot, sku_snapshot,
    from_unit_name_snapshot, to_unit_name_snapshot,
    created_by, created_at, posted_at, cancelled_at, task_id
";

fn map_conversion_row(row: &rusqlite::Row) -> Result<UnitConversion, rusqlite::Error> {
    Ok(UnitConversion {
        id: row.get(0)?,
        tenant_id: row.get(1)?,
        conversion_number: row.get(2)?,
        warehouse_id: row.get(3)?,
        variant_id: row.get(4)?,
        from_unit_id: row.get(5)?,
        from_quantity: row.get(6)?,
        to_unit_id: row.get(7)?,
        to_quantity: row.get(8)?,
        status: row.get(9)?,
        note: row.get(10)?,
        product_name_snapshot: row.get(11)?,
        variant_name_snapshot: row.get(12)?,
        sku_snapshot: row.get(13)?,
        from_unit_name_snapshot: row.get(14)?,
        to_unit_name_snapshot: row.get(15)?,
        created_by: row.get(16)?,
        created_at: row.get(17)?,
        posted_at: row.get(18)?,
        cancelled_at: row.get(19)?,
        task_id: row.get(20)?,
    })
}

// ==========================================
// Usecase Implementations
// ==========================================

#[allow(clippy::too_many_arguments)]
pub fn create_unit_conversion_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    user_id: &str,
    warehouse_id: &str,
    from_unit_id: &str,
    from_quantity: f64,
    to_unit_id: &str,
    to_quantity: f64,
    note: Option<String>,
    task_id: Option<String>,
) -> Result<UnitConversion, UnitConversionError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(UnitConversionError::EmptyTenantId);
    }
    let uid = user_id.trim();
    if uid.is_empty() {
        return Err(UnitConversionError::EmptyUserId);
    }

    let trimmed_wh = warehouse_id.trim();
    if trimmed_wh.is_empty() {
        return Err(UnitConversionError::WarehouseNotFoundOrInactive);
    }

    crate::warehouses::validate_warehouse_active(conn, tid, trimmed_wh).map_err(|e| {
        if e == "找不到倉別或倉別已停用" {
            UnitConversionError::WarehouseNotFoundOrInactive
        } else {
            UnitConversionError::WarehouseError(e)
        }
    })?;

    let trimmed_from_unit = from_unit_id.trim();
    if trimmed_from_unit.is_empty() {
        return Err(UnitConversionError::FromUnitNotFound);
    }
    let trimmed_to_unit = to_unit_id.trim();
    if trimmed_to_unit.is_empty() {
        return Err(UnitConversionError::ToUnitNotFound);
    }

    if !validate_positive_qty(from_quantity) {
        return Err(UnitConversionError::InvalidFromQuantity);
    }
    if !validate_positive_qty(to_quantity) {
        return Err(UnitConversionError::InvalidToQuantity);
    }

    let from_info = resolve_unit_with_variant(conn, tid, trimmed_from_unit)
        .ok_or(UnitConversionError::FromUnitNotFound)?;
    let to_info = resolve_unit_with_variant(conn, tid, trimmed_to_unit)
        .ok_or(UnitConversionError::ToUnitNotFound)?;

    if from_info.variant_id != to_info.variant_id {
        return Err(UnitConversionError::DifferentVariant);
    }
    if trimmed_from_unit == trimmed_to_unit {
        return Err(UnitConversionError::SameUnit);
    }

    let now = current_timestamp();
    let ucv_id = format!(
        "ucv_{}_{}",
        now,
        UCV_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let trimmed_note = note
        .as_deref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let conv_num = next_ucv_number(&tx, tid)?;

    tx.execute(
        "INSERT INTO unit_conversions (
            id, tenant_id, conversion_number, warehouse_id, variant_id,
            from_unit_id, from_quantity, to_unit_id, to_quantity,
            status, note, product_name_snapshot, variant_name_snapshot, sku_snapshot,
            from_unit_name_snapshot, to_unit_name_snapshot,
            created_by, created_at, posted_at, cancelled_at, task_id
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'draft', ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, NULL, NULL, ?18)",
        params![
            ucv_id,
            tid,
            conv_num,
            trimmed_wh,
            from_info.variant_id,
            trimmed_from_unit,
            from_quantity,
            trimmed_to_unit,
            to_quantity,
            trimmed_note,
            from_info.product_name,
            from_info.variant_name,
            from_info.sku,
            from_info.unit_name,
            to_info.unit_name,
            uid,
            now,
            task_id,
        ],
    )?;

    tx.commit()?;

    get_unit_conversion_impl(conn, tid, &ucv_id)
}

pub fn post_unit_conversion_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    user_id: &str,
    conversion_id: &str,
) -> Result<UnitConversion, UnitConversionError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(UnitConversionError::EmptyTenantId);
    }
    let uid = user_id.trim();
    if uid.is_empty() {
        return Err(UnitConversionError::EmptyUserId);
    }
    let trimmed_id = conversion_id.trim();
    if trimmed_id.is_empty() {
        return Err(UnitConversionError::ConversionNotFound);
    }

    let existing = get_unit_conversion_impl(conn, tid, trimmed_id)?;
    if existing.status != "draft" {
        return Err(UnitConversionError::InvalidStateTransition {
            from: existing.status,
            to: "posted".to_string(),
        });
    }

    // Validate warehouse is still active
    let wh = crate::warehouses::validate_warehouse_active(conn, tid, &existing.warehouse_id)
        .map_err(|e| {
            if e == "找不到倉別或倉別已停用" {
                UnitConversionError::WarehouseNotFoundOrInactive
            } else {
                UnitConversionError::WarehouseError(e)
            }
        })?;

    if !validate_positive_qty(existing.from_quantity) {
        return Err(UnitConversionError::InvalidFromQuantity);
    }
    if !validate_positive_qty(existing.to_quantity) {
        return Err(UnitConversionError::InvalidToQuantity);
    }

    let now = current_timestamp();
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

    // Idempotent status guard
    let affected = tx.execute(
        "UPDATE unit_conversions SET status = 'posted', posted_at = ?1
         WHERE id = ?2 AND status = 'draft' AND tenant_id = ?3",
        params![now, trimmed_id, tid],
    )?;

    crate::ensure_guarded_mutation_affected(
        &tx,
        "unit_conversions",
        trimmed_id,
        tid,
        affected,
        UnitConversionError::ConversionNotFound,
        |s| {
            if s != "draft" {
                Err(UnitConversionError::InvalidStateTransition {
                    from: s,
                    to: "posted".to_string(),
                })
            } else {
                Ok(())
            }
        },
    )?;

    // Re-verify units & same-variant invariant inside transaction
    let from_info = resolve_unit_with_variant(&tx, tid, &existing.from_unit_id)
        .ok_or(UnitConversionError::FromUnitNotFound)?;
    let to_info = resolve_unit_with_variant(&tx, tid, &existing.to_unit_id)
        .ok_or(UnitConversionError::ToUnitNotFound)?;
    if from_info.variant_id != to_info.variant_id {
        return Err(UnitConversionError::DifferentVariant);
    }
    if existing.from_unit_id == existing.to_unit_id {
        return Err(UnitConversionError::SameUnit);
    }

    // SH-03 style negative stock guard on from_unit_id in warehouse_id
    let current_stock: f64 = tx.query_row(
        "SELECT COALESCE(SUM(quantity_delta), 0.0)
         FROM inventory_movements
         WHERE tenant_id = ?1 AND warehouse_id = ?2 AND unit_id = ?3",
        params![tid, existing.warehouse_id, existing.from_unit_id],
        |r| r.get(0),
    )?;

    if current_stock + 1e-9 < existing.from_quantity {
        return Err(UnitConversionError::InsufficientStock(Box::new(
            InsufficientStockDetails {
                product_name: existing.product_name_snapshot,
                variant_name: existing.variant_name_snapshot,
                unit_name: existing.from_unit_name_snapshot,
                warehouse_name: wh.name,
                available_qty: format_qty(current_stock),
                requested_qty: format_qty(existing.from_quantity),
            },
        )));
    }

    // Write two inventory_movements rows: unit_conversion_out & unit_conversion_in, both with unit_cost = NULL
    let out_mov_id = format!(
        "im_ucv_{}_{}",
        now,
        IM_UCV_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    tx.execute(
        "INSERT INTO inventory_movements (
            id, tenant_id, unit_id, warehouse_id, quantity_delta, unit_cost,
            reason, reference_type, reference_id, created_by, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, 'unit_conversion_out', 'unit_conversion', ?6, ?7, ?8)",
        params![
            out_mov_id,
            tid,
            existing.from_unit_id,
            existing.warehouse_id,
            -existing.from_quantity,
            trimmed_id,
            uid,
            now,
        ],
    )?;

    let in_mov_id = format!(
        "im_ucv_{}_{}",
        now,
        IM_UCV_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    tx.execute(
        "INSERT INTO inventory_movements (
            id, tenant_id, unit_id, warehouse_id, quantity_delta, unit_cost,
            reason, reference_type, reference_id, created_by, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, 'unit_conversion_in', 'unit_conversion', ?6, ?7, ?8)",
        params![
            in_mov_id,
            tid,
            existing.to_unit_id,
            existing.warehouse_id,
            existing.to_quantity,
            trimmed_id,
            uid,
            now,
        ],
    )?;

    tx.commit()?;

    get_unit_conversion_impl(conn, tid, trimmed_id)
}

pub fn cancel_unit_conversion_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    conversion_id: &str,
) -> Result<UnitConversion, UnitConversionError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(UnitConversionError::EmptyTenantId);
    }
    let trimmed_id = conversion_id.trim();
    if trimmed_id.is_empty() {
        return Err(UnitConversionError::ConversionNotFound);
    }

    let status: String = {
        let mut stmt =
            conn.prepare("SELECT status FROM unit_conversions WHERE id = ?1 AND tenant_id = ?2")?;
        stmt.query_row(params![trimmed_id, tid], |row| row.get(0))
            .map_err(|_| UnitConversionError::ConversionNotFound)?
    };

    if status != "draft" {
        return Err(UnitConversionError::InvalidStateTransition {
            from: status,
            to: "cancelled".to_string(),
        });
    }

    let now = current_timestamp();
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let affected = tx.execute(
        "UPDATE unit_conversions SET status = 'cancelled', cancelled_at = ?1
         WHERE id = ?2 AND status = 'draft' AND tenant_id = ?3",
        params![now, trimmed_id, tid],
    )?;

    crate::ensure_guarded_mutation_affected(
        &tx,
        "unit_conversions",
        trimmed_id,
        tid,
        affected,
        UnitConversionError::ConversionNotFound,
        |s| {
            if s != "draft" {
                Err(UnitConversionError::InvalidStateTransition {
                    from: s,
                    to: "cancelled".to_string(),
                })
            } else {
                Ok(())
            }
        },
    )?;

    tx.commit()?;

    get_unit_conversion_impl(conn, tid, trimmed_id)
}

pub fn get_unit_conversion_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    conversion_id: &str,
) -> Result<UnitConversion, UnitConversionError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(UnitConversionError::EmptyTenantId);
    }
    let trimmed_id = conversion_id.trim();
    if trimmed_id.is_empty() {
        return Err(UnitConversionError::ConversionNotFound);
    }

    let sql = format!(
        "SELECT {} FROM unit_conversions WHERE id = ?1 AND tenant_id = ?2",
        UNIT_CONVERSION_COLUMNS
    );
    let mut stmt = conn.prepare(&sql)?;
    stmt.query_row(params![trimmed_id, tid], map_conversion_row)
        .map_err(|_| UnitConversionError::ConversionNotFound)
}

pub fn list_unit_conversions_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    status: Option<String>,
    warehouse_id: Option<String>,
) -> Result<Vec<UnitConversion>, UnitConversionError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(UnitConversionError::EmptyTenantId);
    }

    let mut sql = format!(
        "SELECT {} FROM unit_conversions WHERE tenant_id = ?1",
        UNIT_CONVERSION_COLUMNS
    );
    let mut param_values: Vec<String> = vec![tid.to_string()];

    if let Some(st) = status {
        let trimmed = st.trim();
        if !trimmed.is_empty() && trimmed != "all" {
            param_values.push(trimmed.to_string());
            sql.push_str(&format!(" AND status = ?{}", param_values.len()));
        }
    }

    if let Some(wh) = warehouse_id {
        let trimmed = wh.trim();
        if !trimmed.is_empty() {
            param_values.push(trimmed.to_string());
            sql.push_str(&format!(" AND warehouse_id = ?{}", param_values.len()));
        }
    }

    sql.push_str(" ORDER BY created_at DESC, conversion_number DESC");

    let mut stmt = conn.prepare(&sql)?;
    let params_refs: Vec<&dyn rusqlite::ToSql> = param_values
        .iter()
        .map(|s| s as &dyn rusqlite::ToSql)
        .collect();

    let rows = stmt.query_map(params_refs.as_slice(), map_conversion_row)?;
    let mut list = Vec::new();
    for r in rows {
        list.push(r?);
    }
    Ok(list)
}

// ==========================================
// Tauri Commands
// ==========================================

#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn create_unit_conversion<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    warehouse_id: String,
    from_unit_id: String,
    from_quantity: f64,
    to_unit_id: String,
    to_quantity: f64,
    note: Option<String>,
    task_id: Option<String>,
) -> Result<UnitConversion, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;

    create_unit_conversion_impl(
        &mut conn,
        &active_tid,
        &active_uid,
        &warehouse_id,
        &from_unit_id,
        from_quantity,
        &to_unit_id,
        to_quantity,
        note,
        task_id,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn post_unit_conversion<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    conversion_id: String,
) -> Result<UnitConversion, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;

    post_unit_conversion_impl(&mut conn, &active_tid, &active_uid, &conversion_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_unit_conversion<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    conversion_id: String,
) -> Result<UnitConversion, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let _active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;

    cancel_unit_conversion_impl(&mut conn, &active_tid, &conversion_id).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn get_unit_conversion<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    conversion_id: String,
) -> Result<UnitConversion, String> {
    let db_path = get_db_path(&app_handle);
    let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let _active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;

    get_unit_conversion_impl(&conn, &active_tid, &conversion_id).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn list_unit_conversions<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    status: Option<String>,
    warehouse_id: Option<String>,
) -> Result<Vec<UnitConversion>, String> {
    let db_path = get_db_path(&app_handle);
    let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let _active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;

    list_unit_conversions_impl(&conn, &active_tid, status, warehouse_id).map_err(|e| e.to_string())
}

// ==========================================
// Unit Tests
// ==========================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::partners::create_partner_impl;
    use crate::products::{add_product_unit_impl, add_product_variant_impl, create_product_impl};
    use crate::sales_orders::{
        create_sales_order_from_quote_impl, create_sales_orders_tables, ship_sales_order_impl,
        CreateSalesOrderFromQuoteInput, CreateSalesOrderLineFromQuoteInput,
    };
    use crate::warehouses::{create_warehouse_impl, deactivate_warehouse_impl};

    fn setup_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::partners::create_partners_table(&conn).unwrap();
        crate::products::create_products_tables(&conn).unwrap();
        crate::purchase_orders::create_purchase_orders_tables(&conn).unwrap();
        crate::warehouses::create_warehouses_tables(&conn).unwrap();
        crate::warehouses::run_warehouses_migration_and_backfill(&conn).unwrap();
        create_unit_conversions_tables(&conn).unwrap();
        create_sales_orders_tables(&conn).unwrap();
        conn
    }

    fn seed_warehouse(
        conn: &mut rusqlite::Connection,
        tid: &str,
        code: &str,
        name: &str,
    ) -> String {
        create_warehouse_impl(conn, tid, code, name).unwrap().id
    }

    fn seed_product_with_two_units(
        conn: &mut rusqlite::Connection,
        tid: &str,
        name: &str,
        base_unit: &str,
        pack_unit: &str,
        pack_ratio: f64,
    ) -> (String, String, String) {
        let detail = create_product_impl(
            conn,
            tid,
            name.to_string(),
            "轉售商品".to_string(),
            None,
            Some(base_unit.to_string()),
            Some(10.0),
        )
        .unwrap();
        let variant_id = detail.variants[0].id.clone();
        let pcs_unit_id = detail.units[0].id.clone();
        let box_unit = add_product_unit_impl(
            conn,
            tid,
            &variant_id,
            pack_unit.to_string(),
            pack_ratio,
            Some(false),
            100.0,
        )
        .unwrap();
        (variant_id, box_unit.id, pcs_unit_id)
    }

    fn seed_stock(conn: &rusqlite::Connection, tid: &str, wh_id: &str, unit_id: &str, qty: f64) {
        let now = current_timestamp();
        let id = format!(
            "mov_seed_{}_{}",
            now,
            IM_UCV_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
        );
        conn.execute(
            "INSERT INTO inventory_movements (
                id, tenant_id, unit_id, warehouse_id, quantity_delta, unit_cost,
                reason, reference_type, reference_id, created_by, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, 10.0, 'purchase_receipt', 'purchase_order', 'po_seed', 'usr_1', ?6)",
            params![id, tid, unit_id, wh_id, qty, now],
        )
        .unwrap();
    }

    fn get_stock(conn: &rusqlite::Connection, tid: &str, wh_id: &str, unit_id: &str) -> f64 {
        conn.query_row(
            "SELECT COALESCE(SUM(quantity_delta), 0.0) FROM inventory_movements WHERE tenant_id = ?1 AND warehouse_id = ?2 AND unit_id = ?3",
            params![tid, wh_id, unit_id],
            |r| r.get(0),
        )
        .unwrap()
    }

    // TC-UCV-N-01: Create draft unit conversion & number sequence
    #[test]
    fn test_tc_ucv_n_01_create_draft_and_sequence() {
        let mut conn = setup_db();
        let _wh_default = seed_warehouse(&mut conn, "tnt_1", "WH-MAIN", "主倉");
        let wh_id = seed_warehouse(&mut conn, "tnt_1", "WH-A", "A倉");
        let (variant_id, box_id, pcs_id) =
            seed_product_with_two_units(&mut conn, "tnt_1", "原子筆", "個", "盒", 12.0);

        let ucv1 = create_unit_conversion_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            &wh_id,
            &box_id,
            1.0,
            &pcs_id,
            12.0,
            Some("拆盒上架".to_string()),
            None,
        )
        .unwrap();

        assert_eq!(ucv1.conversion_number, "UCV-00001");
        assert_eq!(ucv1.status, "draft");
        assert_eq!(ucv1.variant_id, variant_id);
        assert_eq!(ucv1.from_unit_id, box_id);
        assert_eq!(ucv1.from_quantity, 1.0);
        assert_eq!(ucv1.to_unit_id, pcs_id);
        assert_eq!(ucv1.to_quantity, 12.0);
        assert_eq!(ucv1.from_unit_name_snapshot, "盒");
        assert_eq!(ucv1.to_unit_name_snapshot, "個");
        assert_eq!(ucv1.product_name_snapshot, "原子筆");
        assert_eq!(ucv1.note.as_deref(), Some("拆盒上架"));

        let ucv2 = create_unit_conversion_impl(
            &mut conn, "tnt_1", "usr_1", &wh_id, &box_id, 2.0, &pcs_id, 20.0, None, None,
        )
        .unwrap();
        assert_eq!(ucv2.conversion_number, "UCV-00002");
    }

    // TC-UCV-N-02: Post unit conversion writes two movements with unit_cost = NULL and no ratio validation
    #[test]
    fn test_tc_ucv_n_02_post_writes_two_movements_and_respects_user_qty() {
        let mut conn = setup_db();
        let _wh_default = seed_warehouse(&mut conn, "tnt_1", "WH-MAIN", "主倉");
        let wh_id = seed_warehouse(&mut conn, "tnt_1", "WH-A", "A倉");
        let (_, box_id, pcs_id) =
            seed_product_with_two_units(&mut conn, "tnt_1", "原子筆", "個", "盒", 12.0);
        seed_stock(&conn, "tnt_1", &wh_id, &box_id, 3.0);

        // Intentionally enter to_quantity = 10 instead of conversion_ratio 12 to verify backend does NOT validate/recalculate
        let ucv = create_unit_conversion_impl(
            &mut conn, "tnt_1", "usr_1", &wh_id, &box_id, 1.0, &pcs_id, 10.0, None, None,
        )
        .unwrap();

        let posted = post_unit_conversion_impl(&mut conn, "tnt_1", "usr_1", &ucv.id).unwrap();
        assert_eq!(posted.status, "posted");
        assert!(posted.posted_at.is_some());

        // Verify inventory_movements rows
        let mut stmt = conn
            .prepare(
                "SELECT unit_id, warehouse_id, quantity_delta, unit_cost, reason, reference_type, reference_id
                 FROM inventory_movements
                 WHERE reference_id = ?1
                 ORDER BY quantity_delta ASC",
            )
            .unwrap();
        let rows: Vec<(String, String, f64, Option<f64>, String, String, String)> = stmt
            .query_map(params![ucv.id], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                ))
            })
            .unwrap()
            .map(|r| r.unwrap())
            .collect();

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].0, box_id);
        assert_eq!(rows[0].1, wh_id);
        assert_eq!(rows[0].2, -1.0);
        assert_eq!(rows[0].3, None); // unit_cost MUST be NULL
        assert_eq!(rows[0].4, "unit_conversion_out");
        assert_eq!(rows[0].5, "unit_conversion");

        assert_eq!(rows[1].0, pcs_id);
        assert_eq!(rows[1].1, wh_id);
        assert_eq!(rows[1].2, 10.0);
        assert_eq!(rows[1].3, None); // unit_cost MUST be NULL
        assert_eq!(rows[1].4, "unit_conversion_in");
        assert_eq!(rows[1].5, "unit_conversion");

        assert!((get_stock(&conn, "tnt_1", &wh_id, &box_id) - 2.0).abs() < 1e-9);
        assert!((get_stock(&conn, "tnt_1", &wh_id, &pcs_id) - 10.0).abs() < 1e-9);
    }

    // TC-UCV-E-01: Negative stock blocked on post (insufficient source unit stock)
    #[test]
    fn test_tc_ucv_e_01_insufficient_stock_blocked() {
        let mut conn = setup_db();
        let wh_a = seed_warehouse(&mut conn, "tnt_1", "WH-A", "A倉");
        let wh_b = seed_warehouse(&mut conn, "tnt_1", "WH-B", "B倉");
        let (_, box_id, pcs_id) =
            seed_product_with_two_units(&mut conn, "tnt_1", "原子筆", "個", "盒", 12.0);
        // Stock in WH-B, not WH-A; and only 1 box in WH-A
        seed_stock(&conn, "tnt_1", &wh_b, &box_id, 5.0);
        seed_stock(&conn, "tnt_1", &wh_a, &box_id, 1.0);

        let ucv = create_unit_conversion_impl(
            &mut conn, "tnt_1", "usr_1", &wh_a, &box_id, 2.0, &pcs_id, 24.0, None, None,
        )
        .unwrap();

        let err = post_unit_conversion_impl(&mut conn, "tnt_1", "usr_1", &ucv.id).unwrap_err();
        assert!(matches!(err, UnitConversionError::InsufficientStock(_)));

        // Status must remain draft and no movements created
        let fetched = get_unit_conversion_impl(&conn, "tnt_1", &ucv.id).unwrap();
        assert_eq!(fetched.status, "draft");
        assert!((get_stock(&conn, "tnt_1", &wh_a, &box_id) - 1.0).abs() < 1e-9);
        assert!((get_stock(&conn, "tnt_1", &wh_a, &pcs_id) - 0.0).abs() < 1e-9);
    }

    // TC-UCV-E-02: Same variant restriction (different variants of same product, and different products)
    #[test]
    fn test_tc_ucv_e_02_same_variant_restriction() {
        let mut conn = setup_db();
        let _wh_default = seed_warehouse(&mut conn, "tnt_1", "WH-MAIN", "主倉");
        let wh_id = seed_warehouse(&mut conn, "tnt_1", "WH-A", "A倉");
        let detail = create_product_impl(
            &mut conn,
            "tnt_1",
            "T-Shirt".to_string(),
            "轉售商品".to_string(),
            None,
            Some("件".to_string()),
            Some(200.0),
        )
        .unwrap();
        let v1_unit_id = detail.units[0].id.clone();
        let v2 = add_product_variant_impl(
            &mut conn,
            "tnt_1",
            &detail.product.id,
            "黑色".to_string(),
            Some("TS-BLK".to_string()),
            None,
        )
        .unwrap();
        // Find unit for v2
        let v2_detail =
            crate::products::get_product_detail_impl(&conn, "tnt_1", &detail.product.id).unwrap();
        let v2_unit_id = v2_detail
            .units
            .iter()
            .find(|u| u.variant_id == v2.id)
            .unwrap()
            .id
            .clone();

        let err = create_unit_conversion_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            &wh_id,
            &v1_unit_id,
            1.0,
            &v2_unit_id,
            12.0,
            None,
            None,
        )
        .unwrap_err();
        assert_eq!(err, UnitConversionError::DifferentVariant);

        // Also different products
        let (_, other_box_id, _) =
            seed_product_with_two_units(&mut conn, "tnt_1", "筆記本", "本", "箱", 10.0);
        let err2 = create_unit_conversion_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            &wh_id,
            &v1_unit_id,
            1.0,
            &other_box_id,
            10.0,
            None,
            None,
        )
        .unwrap_err();
        assert_eq!(err2, UnitConversionError::DifferentVariant);

        // Same unit
        let err3 = create_unit_conversion_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            &wh_id,
            &v1_unit_id,
            1.0,
            &v1_unit_id,
            1.0,
            None,
            None,
        )
        .unwrap_err();
        assert_eq!(err3, UnitConversionError::SameUnit);
    }

    // TC-UCV-E-03: Validation boundaries (0, negative, NaN, inactive warehouse, cross-tenant)
    #[test]
    fn test_tc_ucv_e_03_validation_and_state_machine() {
        let mut conn = setup_db();
        let _wh_default = seed_warehouse(&mut conn, "tnt_1", "WH-MAIN", "主倉");
        let wh_id = seed_warehouse(&mut conn, "tnt_1", "WH-A", "A倉");
        let (_, box_id, pcs_id) =
            seed_product_with_two_units(&mut conn, "tnt_1", "原子筆", "個", "盒", 12.0);

        assert_eq!(
            create_unit_conversion_impl(
                &mut conn, "tnt_1", "usr_1", &wh_id, &box_id, 0.0, &pcs_id, 12.0, None, None
            )
            .unwrap_err(),
            UnitConversionError::InvalidFromQuantity
        );
        assert_eq!(
            create_unit_conversion_impl(
                &mut conn, "tnt_1", "usr_1", &wh_id, &box_id, 1.0, &pcs_id, -5.0, None, None
            )
            .unwrap_err(),
            UnitConversionError::InvalidToQuantity
        );
        assert_eq!(
            create_unit_conversion_impl(
                &mut conn,
                "tnt_1",
                "usr_1",
                &wh_id,
                &box_id,
                f64::NAN,
                &pcs_id,
                12.0,
                None,
                None
            )
            .unwrap_err(),
            UnitConversionError::InvalidFromQuantity
        );

        let ucv = create_unit_conversion_impl(
            &mut conn, "tnt_1", "usr_1", &wh_id, &box_id, 1.0, &pcs_id, 12.0, None, None,
        )
        .unwrap();

        // W-03: Draft conversion blocks warehouse deactivation
        let deact_err = deactivate_warehouse_impl(&mut conn, "tnt_1", &wh_id).unwrap_err();
        assert!(deact_err.contains("UCV-00001"));

        // Cancel draft
        let cancelled = cancel_unit_conversion_impl(&mut conn, "tnt_1", &ucv.id).unwrap();
        assert_eq!(cancelled.status, "cancelled");
        assert!(cancelled.cancelled_at.is_some());

        // Cannot post or cancel a cancelled conversion
        assert!(matches!(
            post_unit_conversion_impl(&mut conn, "tnt_1", "usr_1", &ucv.id).unwrap_err(),
            UnitConversionError::InvalidStateTransition { .. }
        ));
        assert!(matches!(
            cancel_unit_conversion_impl(&mut conn, "tnt_1", &ucv.id).unwrap_err(),
            UnitConversionError::InvalidStateTransition { .. }
        ));

        // Tenant isolation
        assert_eq!(
            get_unit_conversion_impl(&conn, "tnt_other", &ucv.id).unwrap_err(),
            UnitConversionError::ConversionNotFound
        );
    }

    // TC-UCV-L2-01: Layer 2 - Convert box to pcs, then ship pcs via sales order successfully
    #[test]
    fn test_tc_ucv_l2_01_convert_box_to_pcs_then_ship_sales_order() {
        let mut conn = setup_db();
        let wh_id = seed_warehouse(&mut conn, "tnt_1", "WH-A", "主倉");
        let (_, box_id, pcs_id) =
            seed_product_with_two_units(&mut conn, "tnt_1", "原子筆", "個", "盒", 12.0);
        let customer = create_partner_impl(
            &conn,
            "tnt_1",
            "測試客戶".to_string(),
            Some(true),
            Some(false),
            None,
        )
        .unwrap();

        // Initial stock: 2 boxes, 0 pcs
        seed_stock(&conn, "tnt_1", &wh_id, &box_id, 2.0);

        // Convert 1 box -> 12 pcs
        let ucv = create_unit_conversion_impl(
            &mut conn, "tnt_1", "usr_1", &wh_id, &box_id, 1.0, &pcs_id, 12.0, None, None,
        )
        .unwrap();
        post_unit_conversion_impl(&mut conn, "tnt_1", "usr_1", &ucv.id).unwrap();

        assert!((get_stock(&conn, "tnt_1", &wh_id, &box_id) - 1.0).abs() < 1e-9);
        assert!((get_stock(&conn, "tnt_1", &wh_id, &pcs_id) - 12.0).abs() < 1e-9);

        // Create & confirm sales order for 5 pcs
        let so = create_sales_order_from_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            CreateSalesOrderFromQuoteInput {
                source_quote_id: "quo_ucv_l2".to_string(),
                customer_partner_id: customer.id,
                customer_name_snapshot: None,
                customer_reference: None,
                warehouse_id: Some(wh_id.clone()),
                currency: None,
                expected_ship_date: None,
                note: None,
                task_id: None,
                lines: vec![CreateSalesOrderLineFromQuoteInput {
                    unit_id: pcs_id.clone(),
                    product_name_snapshot: "原子筆".to_string(),
                    variant_name_snapshot: "預設".to_string(),
                    sku_snapshot: None,
                    unit_name_snapshot: "個".to_string(),
                    quantity: 5.0,
                    unit_price: 15.0,
                    standard_price_snapshot: 10.0,
                }],
            },
        )
        .unwrap();

        // Ship 5 pcs from WH-A
        let shipped = ship_sales_order_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            &so.order.id,
            None,
            None,
            Some("2026-11-12"),
        )
        .unwrap();

        assert_eq!(shipped.order.status, "shipped");
        assert!((get_stock(&conn, "tnt_1", &wh_id, &pcs_id) - 7.0).abs() < 1e-9);
    }
}
