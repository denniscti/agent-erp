use crate::get_db_path;
use rusqlite::params;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static STK_ID_COUNTER: AtomicU64 = AtomicU64::new(1000);

fn current_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

// ==========================================
// Data Structures
// ==========================================

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq)]
pub struct Stocktake {
    pub id: String,
    pub tenant_id: String,
    pub stocktake_number: String,
    pub warehouse_id: String,
    pub status: String, // "draft" | "counting" | "posted" | "cancelled"
    pub note: Option<String>,
    pub created_by: String,
    pub created_at: i64,
    pub counting_started_at: Option<i64>,
    pub posted_at: Option<i64>,
    pub cancelled_at: Option<i64>,
    pub task_id: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq)]
pub struct StocktakeLine {
    pub id: String,
    pub stocktake_id: String,
    pub line_no: i64,
    pub unit_id: String,
    pub product_name_snapshot: String,
    pub variant_name_snapshot: String,
    pub sku_snapshot: Option<String>,
    pub unit_name_snapshot: String,
    pub system_quantity: Option<f64>,
    pub system_quantity_at: Option<i64>,
    pub counted_quantity: Option<f64>,
    pub created_at: i64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq)]
pub struct StocktakeDetail {
    pub stocktake: Stocktake,
    pub lines: Vec<StocktakeLine>,
}

// ==========================================
// Table Creation
// ==========================================

pub fn create_stocktakes_tables(conn: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS stocktakes (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            stocktake_number TEXT NOT NULL,
            warehouse_id TEXT NOT NULL,
            status TEXT NOT NULL,
            note TEXT,
            created_by TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            counting_started_at INTEGER,
            posted_at INTEGER,
            cancelled_at INTEGER,
            task_id TEXT
        )",
        [],
    )?;

    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_stk_tenant_number ON stocktakes (tenant_id, stocktake_number)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_stk_tenant ON stocktakes (tenant_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_stk_tenant_warehouse ON stocktakes (tenant_id, warehouse_id)",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS stocktake_lines (
            id TEXT PRIMARY KEY,
            stocktake_id TEXT NOT NULL,
            line_no INTEGER NOT NULL,
            unit_id TEXT NOT NULL,
            product_name_snapshot TEXT NOT NULL,
            variant_name_snapshot TEXT NOT NULL,
            sku_snapshot TEXT,
            unit_name_snapshot TEXT NOT NULL,
            system_quantity REAL,
            system_quantity_at INTEGER,
            counted_quantity REAL,
            created_at INTEGER NOT NULL
        )",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_stkl_stocktake ON stocktake_lines (stocktake_id)",
        [],
    )?;

    Ok(())
}

// ==========================================
// Errors
// ==========================================

#[derive(Debug, thiserror::Error, PartialEq, Clone)]
pub enum StocktakeError {
    #[error("Tenant ID cannot be empty")]
    EmptyTenantId,

    #[error("無法解析有效使用者 session，操作被拒絕")]
    EmptyUserId,

    #[error("找不到倉別或倉別已停用")]
    WarehouseNotFoundOrInactive,

    #[error("找不到指定的商品單位 (unit_id) 或不屬於目前租戶")]
    UnitNotFound,

    #[error("此品項已在盤點單中")]
    DuplicateUnitInStocktake,

    #[error("找不到盤點單或不屬於目前租戶")]
    StocktakeNotFound,

    #[error("找不到指定的盤點單明細行")]
    LineNotFound,

    #[error("盤點單沒有任何品項")]
    EmptyStocktakeLines,

    #[error("盤點單狀態為 {0}，僅草稿狀態可修改表頭")]
    NotDraftForHeaderEdit(String),

    #[error("盤點單狀態為 {0}，僅草稿狀態可新增品項")]
    NotDraftForLineAdd(String),

    #[error("盤點單狀態為 {0}，不可刪除明細")]
    NotDraftOrCountingForLineRemove(String),

    #[error("只有盤點中 (counting) 狀態可輸入實盤量")]
    OnlyCountingForCountedQty(String),

    #[error("只有 counting 狀態可以重新取得系統量")]
    OnlyCountingForRefresh(String),

    #[error("實盤量不可為負")]
    NegativeCountedQuantity,

    #[error("尚有 {0} 項未輸入實盤量")]
    MissingCountedQuantity(i64),

    #[error("〔{product_info}〕已在盤點單 {stocktake_number} 盤點中")]
    UnitAlreadyInCounting {
        product_info: String,
        stocktake_number: String,
    },

    #[error("以下品項在盤點期間有異動：{0}，請重新取得系統量並重新確認實盤")]
    MovementsDetectedDuringCounting(String),

    #[error("無效的狀態轉換：不可從 {from} 轉換至 {to}")]
    InvalidStateTransition { from: String, to: String },

    #[error("{0}")]
    WarehouseError(String),

    #[error("{0}")]
    DatabaseError(String),
}

impl From<rusqlite::Error> for StocktakeError {
    fn from(err: rusqlite::Error) -> Self {
        StocktakeError::DatabaseError(err.to_string())
    }
}

impl StocktakeError {
    pub fn code(&self) -> &'static str {
        match self {
            StocktakeError::EmptyTenantId => "TENANT_ID_EMPTY",
            StocktakeError::EmptyUserId => "USER_ID_EMPTY",
            StocktakeError::WarehouseNotFoundOrInactive => "WAREHOUSE_NOT_FOUND_OR_INACTIVE",
            StocktakeError::UnitNotFound => "UNIT_NOT_FOUND",
            StocktakeError::StocktakeNotFound => "STOCKTAKE_NOT_FOUND",
            StocktakeError::LineNotFound => "LINE_NOT_FOUND",
            StocktakeError::EmptyStocktakeLines => "EMPTY_STOCKTAKE_LINES",
            StocktakeError::DuplicateUnitInStocktake => "DUPLICATE_UNIT_IN_STOCKTAKE",
            StocktakeError::NotDraftForHeaderEdit(_) => "NOT_DRAFT_FOR_HEADER_EDIT",
            StocktakeError::NotDraftForLineAdd(_) => "NOT_DRAFT_FOR_LINE_ADD",
            StocktakeError::NotDraftOrCountingForLineRemove(_) => {
                "NOT_DRAFT_OR_COUNTING_FOR_LINE_REMOVE"
            }
            StocktakeError::OnlyCountingForCountedQty(_) => "ONLY_COUNTING_FOR_COUNTED_QTY",
            StocktakeError::OnlyCountingForRefresh(_) => "ONLY_COUNTING_FOR_REFRESH",
            StocktakeError::NegativeCountedQuantity => "NEGATIVE_COUNTED_QUANTITY",
            StocktakeError::MissingCountedQuantity(_) => "MISSING_COUNTED_QUANTITY",
            StocktakeError::UnitAlreadyInCounting { .. } => "UNIT_ALREADY_IN_COUNTING",
            StocktakeError::MovementsDetectedDuringCounting(_) => {
                "MOVEMENTS_DETECTED_DURING_COUNTING"
            }
            StocktakeError::InvalidStateTransition { .. } => "INVALID_STATE_TRANSITION",
            StocktakeError::WarehouseError(_) => "WAREHOUSE_ERROR",
            StocktakeError::DatabaseError(_) => "DATABASE_ERROR",
        }
    }
}

#[derive(Debug, serde::Serialize, serde::Deserialize, specta::Type, Clone, PartialEq, Eq)]
pub struct StocktakeErrorPayload {
    pub code: String,
    pub message: String,
}

impl From<StocktakeError> for StocktakeErrorPayload {
    fn from(err: StocktakeError) -> Self {
        Self {
            code: err.code().to_string(),
            message: err.to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default, specta::Type)]
pub enum OptionalUpdate<T> {
    #[default]
    Keep,
    Clear,
    Set(T),
}

impl<'de, T: serde::Deserialize<'de>> serde::Deserialize<'de> for OptionalUpdate<T> {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        Option::<T>::deserialize(deserializer).map(|opt| match opt {
            Some(v) => OptionalUpdate::Set(v),
            None => OptionalUpdate::Clear,
        })
    }
}

impl From<Option<String>> for OptionalUpdate<String> {
    fn from(opt: Option<String>) -> Self {
        match opt {
            None => OptionalUpdate::Keep,
            Some(s) => OptionalUpdate::Set(s),
        }
    }
}

// ==========================================
// Helpers
// ==========================================

pub fn can_transition(from: &str, to: &str) -> bool {
    matches!(
        (from, to),
        ("draft", "counting")
            | ("draft", "cancelled")
            | ("counting", "posted")
            | ("counting", "cancelled")
    )
}

pub fn validate_transition(from: &str, to: &str) -> Result<(), StocktakeError> {
    if can_transition(from, to) {
        Ok(())
    } else {
        Err(StocktakeError::InvalidStateTransition {
            from: from.to_string(),
            to: to.to_string(),
        })
    }
}

pub use crate::products::{resolve_unit_snapshot, UnitSnapshot};

fn next_stk_number(tx: &rusqlite::Transaction, tenant_id: &str) -> Result<String, StocktakeError> {
    let mut stmt = tx.prepare(
        "SELECT COALESCE(MAX(CAST(SUBSTR(stocktake_number, 5) AS INTEGER)), 0) + 1 
         FROM stocktakes WHERE tenant_id = ?1",
    )?;
    let next_seq: i64 = stmt.query_row(params![tenant_id], |row| row.get(0))?;
    Ok(format!("STK-{:05}", next_seq))
}

fn map_stocktake_row(row: &rusqlite::Row<'_>) -> Result<Stocktake, rusqlite::Error> {
    Ok(Stocktake {
        id: row.get(0)?,
        tenant_id: row.get(1)?,
        stocktake_number: row.get(2)?,
        warehouse_id: row.get(3)?,
        status: row.get(4)?,
        note: row.get(5)?,
        created_by: row.get(6)?,
        created_at: row.get(7)?,
        counting_started_at: row.get(8)?,
        posted_at: row.get(9)?,
        cancelled_at: row.get(10)?,
        task_id: row.get(11)?,
    })
}

fn map_stocktake_line_row(row: &rusqlite::Row<'_>) -> Result<StocktakeLine, rusqlite::Error> {
    Ok(StocktakeLine {
        id: row.get(0)?,
        stocktake_id: row.get(1)?,
        line_no: row.get(2)?,
        unit_id: row.get(3)?,
        product_name_snapshot: row.get(4)?,
        variant_name_snapshot: row.get(5)?,
        sku_snapshot: row.get(6)?,
        unit_name_snapshot: row.get(7)?,
        system_quantity: row.get(8)?,
        system_quantity_at: row.get(9)?,
        counted_quantity: row.get(10)?,
        created_at: row.get(11)?,
    })
}

// ==========================================
// Usecase Implementations
// ==========================================

pub fn create_stocktake_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    user_id: &str,
    warehouse_id: &str,
    note: Option<String>,
    task_id: Option<String>,
    initial_unit_ids: Option<Vec<String>>,
) -> Result<StocktakeDetail, StocktakeError> {
    if tenant_id.trim().is_empty() {
        return Err(StocktakeError::EmptyTenantId);
    }
    let trimmed_uid = user_id.trim();
    if trimmed_uid.is_empty() {
        return Err(StocktakeError::EmptyUserId);
    }

    let trimmed_wh = warehouse_id.trim();
    if trimmed_wh.is_empty() {
        return Err(StocktakeError::WarehouseNotFoundOrInactive);
    }

    // S-02: Warehouse validation (W-04)
    crate::warehouses::validate_warehouse_active(conn, tenant_id, trimmed_wh).map_err(|e| {
        if e == "找不到倉別或倉別已停用" {
            StocktakeError::WarehouseNotFoundOrInactive
        } else {
            StocktakeError::WarehouseError(e)
        }
    })?;

    let now = current_timestamp();
    let stk_id = format!(
        "stk_{}_{}",
        now,
        STK_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    );

    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

    let stk_num = next_stk_number(&tx, tenant_id)?;

    tx.execute(
        "INSERT INTO stocktakes (
            id, tenant_id, stocktake_number, warehouse_id, status,
            note, created_by, created_at, counting_started_at, posted_at, cancelled_at, task_id
        ) VALUES (?1, ?2, ?3, ?4, 'draft', ?5, ?6, ?7, NULL, NULL, NULL, ?8)",
        params![
            stk_id,
            tenant_id,
            stk_num,
            trimmed_wh,
            note.as_deref().map(|s| s.trim()),
            trimmed_uid,
            now,
            task_id
        ],
    )?;

    let mut lines = Vec::new();
    if let Some(unit_ids) = initial_unit_ids {
        let mut seen_units = std::collections::HashSet::new();
        for (idx, uid_raw) in unit_ids.into_iter().enumerate() {
            let uid = uid_raw.trim();
            if uid.is_empty() {
                return Err(StocktakeError::UnitNotFound);
            }

            // S-03: No duplicate unit_id in same stocktake
            if !seen_units.insert(uid.to_string()) {
                return Err(StocktakeError::DuplicateUnitInStocktake);
            }

            // S-03: Validate unit belongs to tenant
            let snapshot = resolve_unit_snapshot(&tx, tenant_id, uid)
                .map_err(|_| StocktakeError::UnitNotFound)?;

            let line_id = format!(
                "stkl_{}_{}",
                now,
                STK_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
            );

            tx.execute(
                "INSERT INTO stocktake_lines (
                    id, stocktake_id, line_no, unit_id, product_name_snapshot,
                    variant_name_snapshot, sku_snapshot, unit_name_snapshot,
                    system_quantity, system_quantity_at, counted_quantity, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, NULL, NULL, ?9)",
                params![
                    line_id,
                    stk_id,
                    (idx + 1) as i64,
                    uid,
                    snapshot.product_name,
                    snapshot.variant_name,
                    snapshot.sku,
                    snapshot.unit_name,
                    now
                ],
            )?;

            lines.push(StocktakeLine {
                id: line_id,
                stocktake_id: stk_id.clone(),
                line_no: (idx + 1) as i64,
                unit_id: uid.to_string(),
                product_name_snapshot: snapshot.product_name,
                variant_name_snapshot: snapshot.variant_name,
                sku_snapshot: snapshot.sku,
                unit_name_snapshot: snapshot.unit_name,
                system_quantity: None,
                system_quantity_at: None,
                counted_quantity: None,
                created_at: now,
            });
        }
    }

    tx.commit()?;

    let stocktake = Stocktake {
        id: stk_id,
        tenant_id: tenant_id.to_string(),
        stocktake_number: stk_num,
        warehouse_id: trimmed_wh.to_string(),
        status: "draft".to_string(),
        note: note.map(|s| s.trim().to_string()),
        created_by: trimmed_uid.to_string(),
        created_at: now,
        counting_started_at: None,
        posted_at: None,
        cancelled_at: None,
        task_id,
    };

    Ok(StocktakeDetail { stocktake, lines })
}

pub fn update_stocktake_header_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    stocktake_id: &str,
    warehouse_id: Option<String>,
    note: OptionalUpdate<String>,
) -> Result<StocktakeDetail, StocktakeError> {
    if tenant_id.trim().is_empty() {
        return Err(StocktakeError::EmptyTenantId);
    }

    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

    let (status, current_wh): (String, String) = match tx.query_row(
        "SELECT status, warehouse_id FROM stocktakes WHERE id = ?1 AND tenant_id = ?2",
        params![stocktake_id, tenant_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ) {
        Ok(v) => v,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Err(StocktakeError::StocktakeNotFound),
        Err(e) => return Err(StocktakeError::from(e)),
    };

    if status != "draft" {
        return Err(StocktakeError::NotDraftForHeaderEdit(status));
    }

    let target_wh = warehouse_id.as_deref().unwrap_or(&current_wh);

    // S-02: Warehouse validation
    crate::warehouses::validate_warehouse_active(&tx, tenant_id, target_wh).map_err(|e| {
        if e == "找不到倉別或倉別已停用" {
            StocktakeError::WarehouseNotFoundOrInactive
        } else {
            StocktakeError::WarehouseError(e)
        }
    })?;

    if let Some(ref wh) = warehouse_id {
        let affected = tx.execute(
            "UPDATE stocktakes SET warehouse_id = ?1 WHERE id = ?2 AND tenant_id = ?3 AND status = 'draft'",
            params![wh.trim(), stocktake_id, tenant_id],
        )?;
        if affected == 0 {
            let current_status: String = tx
                .query_row(
                    "SELECT status FROM stocktakes WHERE id = ?1 AND tenant_id = ?2",
                    params![stocktake_id, tenant_id],
                    |row| row.get(0),
                )
                .map_err(|_| StocktakeError::StocktakeNotFound)?;
            return Err(StocktakeError::NotDraftForHeaderEdit(current_status));
        }
    }

    match note {
        OptionalUpdate::Keep => {}
        OptionalUpdate::Clear => {
            let affected = tx.execute(
                "UPDATE stocktakes SET note = NULL WHERE id = ?1 AND tenant_id = ?2 AND status = 'draft'",
                params![stocktake_id, tenant_id],
            )?;
            if affected == 0 {
                let current_status: String = tx
                    .query_row(
                        "SELECT status FROM stocktakes WHERE id = ?1 AND tenant_id = ?2",
                        params![stocktake_id, tenant_id],
                        |row| row.get(0),
                    )
                    .map_err(|_| StocktakeError::StocktakeNotFound)?;
                return Err(StocktakeError::NotDraftForHeaderEdit(current_status));
            }
        }
        OptionalUpdate::Set(n) => {
            let trimmed = n.trim();
            let note_val = if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            };
            let affected = tx.execute(
                "UPDATE stocktakes SET note = ?1 WHERE id = ?2 AND tenant_id = ?3 AND status = 'draft'",
                params![note_val, stocktake_id, tenant_id],
            )?;
            if affected == 0 {
                let current_status: String = tx
                    .query_row(
                        "SELECT status FROM stocktakes WHERE id = ?1 AND tenant_id = ?2",
                        params![stocktake_id, tenant_id],
                        |row| row.get(0),
                    )
                    .map_err(|_| StocktakeError::StocktakeNotFound)?;
                return Err(StocktakeError::NotDraftForHeaderEdit(current_status));
            }
        }
    }

    tx.commit()?;

    get_stocktake_impl(conn, tenant_id, stocktake_id)
}

pub fn add_stocktake_lines_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    stocktake_id: &str,
    unit_ids: Vec<String>,
) -> Result<StocktakeDetail, StocktakeError> {
    if tenant_id.trim().is_empty() {
        return Err(StocktakeError::EmptyTenantId);
    }

    let status: String = {
        let mut stmt =
            conn.prepare("SELECT status FROM stocktakes WHERE id = ?1 AND tenant_id = ?2")?;
        stmt.query_row(params![stocktake_id, tenant_id], |row| row.get(0))
            .map_err(|_| StocktakeError::StocktakeNotFound)?
    };

    if status != "draft" {
        return Err(StocktakeError::NotDraftForLineAdd(status));
    }

    let mut existing_units: std::collections::HashSet<String> = {
        let mut stmt =
            conn.prepare("SELECT unit_id FROM stocktake_lines WHERE stocktake_id = ?1")?;
        let rows = stmt.query_map(params![stocktake_id], |r| r.get(0))?;
        let mut set = std::collections::HashSet::new();
        for r in rows {
            set.insert(r?);
        }
        set
    };

    let mut max_line_no: i64 = {
        let mut stmt = conn.prepare(
            "SELECT COALESCE(MAX(line_no), 0) FROM stocktake_lines WHERE stocktake_id = ?1",
        )?;
        stmt.query_row(params![stocktake_id], |r| r.get(0))?
    };

    let now = current_timestamp();
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

    for uid_raw in unit_ids {
        let uid = uid_raw.trim();
        if uid.is_empty() {
            return Err(StocktakeError::UnitNotFound);
        }

        if !existing_units.insert(uid.to_string()) {
            return Err(StocktakeError::DuplicateUnitInStocktake);
        }

        let snapshot =
            resolve_unit_snapshot(&tx, tenant_id, uid).map_err(|_| StocktakeError::UnitNotFound)?;

        max_line_no += 1;
        let line_id = format!(
            "stkl_{}_{}",
            now,
            STK_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
        );

        tx.execute(
            "INSERT INTO stocktake_lines (
                id, stocktake_id, line_no, unit_id, product_name_snapshot,
                variant_name_snapshot, sku_snapshot, unit_name_snapshot,
                system_quantity, system_quantity_at, counted_quantity, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, NULL, NULL, ?9)",
            params![
                line_id,
                stocktake_id,
                max_line_no,
                uid,
                snapshot.product_name,
                snapshot.variant_name,
                snapshot.sku,
                snapshot.unit_name,
                now
            ],
        )?;
    }

    tx.commit()?;

    get_stocktake_impl(conn, tenant_id, stocktake_id)
}

pub fn add_stocktake_lines_from_stock_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    stocktake_id: &str,
) -> Result<StocktakeDetail, StocktakeError> {
    if tenant_id.trim().is_empty() {
        return Err(StocktakeError::EmptyTenantId);
    }

    let (status, warehouse_id): (String, String) = {
        let mut stmt = conn.prepare(
            "SELECT status, warehouse_id FROM stocktakes WHERE id = ?1 AND tenant_id = ?2",
        )?;
        stmt.query_row(params![stocktake_id, tenant_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map_err(|_| StocktakeError::StocktakeNotFound)?
    };

    if status != "draft" {
        return Err(StocktakeError::NotDraftForLineAdd(status));
    }

    // S-04: Query units in this warehouse with balance != 0 via purchase_orders::list_inventory_levels_impl
    let levels =
        crate::purchase_orders::list_inventory_levels_impl(conn, tenant_id, Some(&warehouse_id))
            .map_err(StocktakeError::WarehouseError)?;

    let active_stock_units: Vec<String> = levels
        .into_iter()
        .filter(|lvl| lvl.current_quantity.abs() > 1e-6)
        .map(|lvl| lvl.unit_id)
        .collect();

    let existing_units: std::collections::HashSet<String> = {
        let mut stmt =
            conn.prepare("SELECT unit_id FROM stocktake_lines WHERE stocktake_id = ?1")?;
        let rows = stmt.query_map(params![stocktake_id], |r| r.get(0))?;
        let mut set = std::collections::HashSet::new();
        for r in rows {
            set.insert(r?);
        }
        set
    };

    let mut max_line_no: i64 = {
        let mut stmt = conn.prepare(
            "SELECT COALESCE(MAX(line_no), 0) FROM stocktake_lines WHERE stocktake_id = ?1",
        )?;
        stmt.query_row(params![stocktake_id], |r| r.get(0))?
    };

    let now = current_timestamp();
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

    for uid in active_stock_units {
        if existing_units.contains(&uid) {
            continue;
        }

        let snapshot = resolve_unit_snapshot(&tx, tenant_id, &uid)
            .map_err(|_| StocktakeError::UnitNotFound)?;

        max_line_no += 1;
        let line_id = format!(
            "stkl_{}_{}",
            now,
            STK_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
        );

        tx.execute(
            "INSERT INTO stocktake_lines (
                id, stocktake_id, line_no, unit_id, product_name_snapshot,
                variant_name_snapshot, sku_snapshot, unit_name_snapshot,
                system_quantity, system_quantity_at, counted_quantity, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, NULL, NULL, ?9)",
            params![
                line_id,
                stocktake_id,
                max_line_no,
                uid,
                snapshot.product_name,
                snapshot.variant_name,
                snapshot.sku,
                snapshot.unit_name,
                now
            ],
        )?;
    }

    tx.commit()?;

    get_stocktake_impl(conn, tenant_id, stocktake_id)
}

pub fn remove_stocktake_line_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    line_id: &str,
) -> Result<StocktakeDetail, StocktakeError> {
    if tenant_id.trim().is_empty() {
        return Err(StocktakeError::EmptyTenantId);
    }

    let (stocktake_id, status): (String, String) = {
        let mut stmt = conn.prepare(
            "SELECT st.id, st.status 
             FROM stocktake_lines stl
             JOIN stocktakes st ON stl.stocktake_id = st.id
             WHERE stl.id = ?1 AND st.tenant_id = ?2",
        )?;
        stmt.query_row(params![line_id, tenant_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map_err(|_| StocktakeError::LineNotFound)?
    };

    // Allowed in draft and counting; prohibited in posted and cancelled
    if status != "draft" && status != "counting" {
        return Err(StocktakeError::NotDraftOrCountingForLineRemove(status));
    }

    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

    tx.execute(
        "DELETE FROM stocktake_lines WHERE id = ?1",
        params![line_id],
    )?;

    // Resequence line_no
    let remaining_ids: Vec<String> = {
        let mut stmt = tx.prepare(
            "SELECT id FROM stocktake_lines WHERE stocktake_id = ?1 ORDER BY line_no ASC, created_at ASC",
        )?;
        let rows = stmt.query_map(params![stocktake_id], |r| r.get(0))?;
        let mut ids = Vec::new();
        for r in rows {
            ids.push(r?);
        }
        ids
    };

    for (idx, rid) in remaining_ids.iter().enumerate() {
        tx.execute(
            "UPDATE stocktake_lines SET line_no = ?1 WHERE id = ?2",
            params![(idx + 1) as i64, rid],
        )?;
    }

    tx.commit()?;

    get_stocktake_impl(conn, tenant_id, &stocktake_id)
}

pub fn start_stocktake_counting_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    stocktake_id: &str,
) -> Result<StocktakeDetail, StocktakeError> {
    if tenant_id.trim().is_empty() {
        return Err(StocktakeError::EmptyTenantId);
    }

    let (status, warehouse_id): (String, String) = {
        let mut stmt = conn.prepare(
            "SELECT status, warehouse_id FROM stocktakes WHERE id = ?1 AND tenant_id = ?2",
        )?;
        stmt.query_row(params![stocktake_id, tenant_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map_err(|_| StocktakeError::StocktakeNotFound)?
    };

    validate_transition(&status, "counting")?;

    // S-02: Warehouse active validation
    crate::warehouses::validate_warehouse_active(conn, tenant_id, &warehouse_id).map_err(|e| {
        if e == "找不到倉別或倉別已停用" {
            StocktakeError::WarehouseNotFoundOrInactive
        } else {
            StocktakeError::WarehouseError(e)
        }
    })?;

    // Fetch lines
    let lines: Vec<(String, String, String, String, String)> = {
        let mut stmt = conn.prepare(
            "SELECT id, unit_id, product_name_snapshot, variant_name_snapshot, unit_name_snapshot 
             FROM stocktake_lines WHERE stocktake_id = ?1 ORDER BY line_no ASC",
        )?;
        let rows = stmt.query_map(params![stocktake_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
        })?;
        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        list
    };

    // S-05: At least 1 line
    if lines.is_empty() {
        return Err(StocktakeError::EmptyStocktakeLines);
    }

    let now = current_timestamp();
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

    // S-05: Check mutual exclusion for counting in the same warehouse
    for (_lid, uid, prod_name, var_name, u_name) in &lines {
        let conflict_opt: Option<String> = match tx.query_row(
            "SELECT st.stocktake_number 
             FROM stocktake_lines stl
             JOIN stocktakes st ON stl.stocktake_id = st.id
             WHERE st.tenant_id = ?1 
               AND st.warehouse_id = ?2 
               AND st.status = 'counting' 
               AND st.id != ?3 
               AND stl.unit_id = ?4 
             LIMIT 1",
            params![tenant_id, warehouse_id, stocktake_id, uid],
            |r| r.get(0),
        ) {
            Ok(num) => Some(num),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => return Err(StocktakeError::from(e)),
        };

        if let Some(other_stk_num) = conflict_opt {
            return Err(StocktakeError::UnitAlreadyInCounting {
                product_info: format!("{}／{}／{}", prod_name, var_name, u_name),
                stocktake_number: other_stk_num,
            });
        }
    }

    // Idempotent conditional update
    let affected = tx.execute(
        "UPDATE stocktakes SET status = 'counting', counting_started_at = ?1 
         WHERE id = ?2 AND status = 'draft' AND tenant_id = ?3",
        params![now, stocktake_id, tenant_id],
    )?;

    if affected == 0 {
        return Err(StocktakeError::InvalidStateTransition {
            from: status,
            to: "counting".to_string(),
        });
    }

    // Write system_quantity and system_quantity_at for each line using get_inventory_level_impl
    for (lid, uid, _, _, _) in &lines {
        let current_balance = crate::purchase_orders::get_inventory_level_impl(
            &tx,
            tenant_id,
            uid,
            Some(&warehouse_id),
        )
        .map_err(StocktakeError::WarehouseError)?
        .current_quantity;

        tx.execute(
            "UPDATE stocktake_lines 
             SET system_quantity = ?1, system_quantity_at = ?2, counted_quantity = NULL 
             WHERE id = ?3",
            params![current_balance, now, lid],
        )?;
    }

    tx.commit()?;

    get_stocktake_impl(conn, tenant_id, stocktake_id)
}

pub fn set_stocktake_counted_quantity_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    line_id: &str,
    counted_quantity: f64,
) -> Result<StocktakeDetail, StocktakeError> {
    if tenant_id.trim().is_empty() {
        return Err(StocktakeError::EmptyTenantId);
    }

    let (stocktake_id, status): (String, String) = {
        let mut stmt = conn.prepare(
            "SELECT st.id, st.status 
             FROM stocktake_lines stl
             JOIN stocktakes st ON stl.stocktake_id = st.id
             WHERE stl.id = ?1 AND st.tenant_id = ?2",
        )?;
        stmt.query_row(params![line_id, tenant_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map_err(|_| StocktakeError::LineNotFound)?
    };

    // S-06: Only counting status
    if status != "counting" {
        return Err(StocktakeError::OnlyCountingForCountedQty(status));
    }

    // S-06: counted_quantity must be a finite, non-negative number
    if !counted_quantity.is_finite() || counted_quantity < 0.0 {
        return Err(StocktakeError::NegativeCountedQuantity);
    }

    conn.execute(
        "UPDATE stocktake_lines SET counted_quantity = ?1 WHERE id = ?2",
        params![counted_quantity, line_id],
    )?;

    get_stocktake_impl(conn, tenant_id, &stocktake_id)
}

pub fn refresh_stocktake_system_quantity_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    stocktake_id: &str,
    line_ids: Vec<String>,
) -> Result<StocktakeDetail, StocktakeError> {
    if tenant_id.trim().is_empty() {
        return Err(StocktakeError::EmptyTenantId);
    }

    let (status, warehouse_id): (String, String) = {
        let mut stmt = conn.prepare(
            "SELECT status, warehouse_id FROM stocktakes WHERE id = ?1 AND tenant_id = ?2",
        )?;
        stmt.query_row(params![stocktake_id, tenant_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map_err(|_| StocktakeError::StocktakeNotFound)?
    };

    // S-08: Only counting status
    if status != "counting" {
        return Err(StocktakeError::OnlyCountingForRefresh(status));
    }

    let now = current_timestamp();
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

    for lid in line_ids {
        let uid: String = tx
            .query_row(
                "SELECT unit_id FROM stocktake_lines WHERE id = ?1 AND stocktake_id = ?2",
                params![lid, stocktake_id],
                |r| r.get(0),
            )
            .map_err(|_| StocktakeError::LineNotFound)?;

        let current_balance = crate::purchase_orders::get_inventory_level_impl(
            &tx,
            tenant_id,
            &uid,
            Some(&warehouse_id),
        )
        .map_err(StocktakeError::WarehouseError)?
        .current_quantity;

        // S-08: Re-write system_quantity, update system_quantity_at, and CLEAR counted_quantity
        tx.execute(
            "UPDATE stocktake_lines 
             SET system_quantity = ?1, system_quantity_at = ?2, counted_quantity = NULL 
             WHERE id = ?3",
            params![current_balance, now, lid],
        )?;
    }

    tx.commit()?;

    get_stocktake_impl(conn, tenant_id, stocktake_id)
}

pub fn post_stocktake_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    user_id: &str,
    stocktake_id: &str,
) -> Result<StocktakeDetail, StocktakeError> {
    if tenant_id.trim().is_empty() {
        return Err(StocktakeError::EmptyTenantId);
    }
    let trimmed_uid = user_id.trim();
    if trimmed_uid.is_empty() {
        return Err(StocktakeError::EmptyUserId);
    }

    let (status, warehouse_id): (String, String) = {
        let mut stmt = conn.prepare(
            "SELECT status, warehouse_id FROM stocktakes WHERE id = ?1 AND tenant_id = ?2",
        )?;
        stmt.query_row(params![stocktake_id, tenant_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map_err(|_| StocktakeError::StocktakeNotFound)?
    };

    validate_transition(&status, "posted")?;

    // S-02: Warehouse validation
    crate::warehouses::validate_warehouse_active(conn, tenant_id, &warehouse_id).map_err(|e| {
        if e == "找不到倉別或倉別已停用" {
            StocktakeError::WarehouseNotFoundOrInactive
        } else {
            StocktakeError::WarehouseError(e)
        }
    })?;

    // Fetch lines
    let lines: Vec<StocktakeLine> = {
        let mut stmt = conn.prepare(
            "SELECT id, stocktake_id, line_no, unit_id, product_name_snapshot,
                    variant_name_snapshot, sku_snapshot, unit_name_snapshot,
                    system_quantity, system_quantity_at, counted_quantity, created_at
             FROM stocktake_lines WHERE stocktake_id = ?1 ORDER BY line_no ASC",
        )?;
        let rows = stmt.query_map(params![stocktake_id], map_stocktake_line_row)?;
        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        list
    };

    // S-05: At least 1 line
    if lines.is_empty() {
        return Err(StocktakeError::EmptyStocktakeLines);
    }

    // S-07: Every line must have counted_quantity
    let uncounted_count = lines
        .iter()
        .filter(|l| l.counted_quantity.is_none())
        .count();

    if uncounted_count > 0 {
        return Err(StocktakeError::MissingCountedQuantity(
            uncounted_count as i64,
        ));
    }

    let now = current_timestamp();
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

    // S-09 & Idempotency: conditional update status
    let affected = tx.execute(
        "UPDATE stocktakes SET status = 'posted', posted_at = ?1 
         WHERE id = ?2 AND status = 'counting' AND tenant_id = ?3",
        params![now, stocktake_id, tenant_id],
    )?;

    if affected == 0 {
        return Err(StocktakeError::InvalidStateTransition {
            from: status,
            to: "posted".to_string(),
        });
    }

    // S-07: Detect new inventory movements in this warehouse created after system_quantity_at
    let mut affected_items = Vec::new();
    for l in &lines {
        let snap_at = l.system_quantity_at.unwrap_or(0);
        let has_movement: bool = match tx.query_row(
            "SELECT 1 FROM inventory_movements 
             WHERE tenant_id = ?1 
               AND warehouse_id = ?2 
               AND unit_id = ?3 
               AND created_at > ?4 
             LIMIT 1",
            params![tenant_id, warehouse_id, l.unit_id, snap_at],
            |_| Ok(true),
        ) {
            Ok(v) => v,
            Err(rusqlite::Error::QueryReturnedNoRows) => false,
            Err(e) => return Err(StocktakeError::from(e)),
        };

        if has_movement {
            affected_items.push(format!(
                "〔{}／{}／{}〕",
                l.product_name_snapshot, l.variant_name_snapshot, l.unit_name_snapshot
            ));
        }
    }

    if !affected_items.is_empty() {
        return Err(StocktakeError::MovementsDetectedDuringCounting(
            affected_items.join("、"),
        ));
    }

    // Write inventory movements for lines with difference != 0
    for l in &lines {
        let sys_qty = l.system_quantity.unwrap_or(0.0);
        let counted_qty = l.counted_quantity.unwrap();
        let delta = counted_qty - sys_qty;

        if delta.abs() > 1e-6 {
            let im_id = format!(
                "im_{}_{}",
                now,
                STK_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
            );

            tx.execute(
                "INSERT INTO inventory_movements (
                    id, tenant_id, unit_id, warehouse_id, quantity_delta, unit_cost,
                    reason, reference_type, reference_id, created_by, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, 'stocktake', 'stocktake', ?6, ?7, ?8)",
                params![
                    im_id,
                    tenant_id,
                    l.unit_id,
                    warehouse_id,
                    delta,
                    stocktake_id,
                    trimmed_uid,
                    now
                ],
            )?;
        }
    }

    tx.commit()?;

    get_stocktake_impl(conn, tenant_id, stocktake_id)
}

pub fn cancel_stocktake_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    stocktake_id: &str,
) -> Result<StocktakeDetail, StocktakeError> {
    if tenant_id.trim().is_empty() {
        return Err(StocktakeError::EmptyTenantId);
    }

    let status: String = {
        let mut stmt =
            conn.prepare("SELECT status FROM stocktakes WHERE id = ?1 AND tenant_id = ?2")?;
        stmt.query_row(params![stocktake_id, tenant_id], |row| row.get(0))
            .map_err(|_| StocktakeError::StocktakeNotFound)?
    };

    validate_transition(&status, "cancelled")?;

    let now = current_timestamp();
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

    let affected = tx.execute(
        "UPDATE stocktakes SET status = 'cancelled', cancelled_at = ?1 
         WHERE id = ?2 AND status IN ('draft', 'counting') AND tenant_id = ?3",
        params![now, stocktake_id, tenant_id],
    )?;

    if affected == 0 {
        return Err(StocktakeError::InvalidStateTransition {
            from: status,
            to: "cancelled".to_string(),
        });
    }

    tx.commit()?;

    get_stocktake_impl(conn, tenant_id, stocktake_id)
}

pub fn get_stocktake_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    stocktake_id: &str,
) -> Result<StocktakeDetail, StocktakeError> {
    if tenant_id.trim().is_empty() {
        return Err(StocktakeError::EmptyTenantId);
    }

    let mut stmt = conn.prepare(
        "SELECT id, tenant_id, stocktake_number, warehouse_id, status, note,
                created_by, created_at, counting_started_at, posted_at, cancelled_at, task_id
         FROM stocktakes WHERE id = ?1 AND tenant_id = ?2",
    )?;

    let stocktake = stmt
        .query_row(params![stocktake_id, tenant_id], map_stocktake_row)
        .map_err(|_| StocktakeError::StocktakeNotFound)?;

    let mut lines_stmt = conn.prepare(
        "SELECT id, stocktake_id, line_no, unit_id, product_name_snapshot,
                variant_name_snapshot, sku_snapshot, unit_name_snapshot,
                system_quantity, system_quantity_at, counted_quantity, created_at
         FROM stocktake_lines WHERE stocktake_id = ?1 ORDER BY line_no ASC",
    )?;

    let rows = lines_stmt.query_map(params![stocktake_id], map_stocktake_line_row)?;
    let mut lines = Vec::new();
    for r in rows {
        lines.push(r?);
    }

    Ok(StocktakeDetail { stocktake, lines })
}

pub fn list_stocktakes_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    status: Option<String>,
    warehouse_id: Option<String>,
) -> Result<Vec<Stocktake>, StocktakeError> {
    if tenant_id.trim().is_empty() {
        return Err(StocktakeError::EmptyTenantId);
    }

    let mut query = String::from(
        "SELECT id, tenant_id, stocktake_number, warehouse_id, status, note,
                created_by, created_at, counting_started_at, posted_at, cancelled_at, task_id
         FROM stocktakes WHERE tenant_id = ?1",
    );
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(tenant_id.to_string())];

    if let Some(ref st) = status {
        let trimmed_st = st.trim();
        if !trimmed_st.is_empty() {
            query.push_str(" AND status = ?");
            params_vec.push(Box::new(trimmed_st.to_string()));
        }
    }

    if let Some(ref wh) = warehouse_id {
        let trimmed_wh = wh.trim();
        if !trimmed_wh.is_empty() {
            query.push_str(" AND warehouse_id = ?");
            params_vec.push(Box::new(trimmed_wh.to_string()));
        }
    }

    query.push_str(" ORDER BY created_at DESC, id DESC");

    let mut stmt = conn.prepare(&query)?;
    let params_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();

    let rows = stmt.query_map(params_refs.as_slice(), map_stocktake_row)?;
    let mut list = Vec::new();
    for r in rows {
        list.push(r?);
    }
    Ok(list)
}

// ==========================================
// Tauri Commands
// ==========================================

fn map_ipc_err(e: impl ToString) -> StocktakeErrorPayload {
    StocktakeErrorPayload {
        code: "IPC_ERROR".to_string(),
        message: e.to_string(),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn create_stocktake<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    warehouse_id: String,
    note: Option<String>,
    task_id: Option<String>,
    initial_unit_ids: Option<Vec<String>>,
) -> Result<StocktakeDetail, StocktakeErrorPayload> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(map_ipc_err)?;
    let active_tid = crate::resolve_active_tenant_id(&conn).map_err(map_ipc_err)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn).map_err(map_ipc_err)?;
    create_stocktake_impl(
        &mut conn,
        &active_tid,
        &active_uid,
        &warehouse_id,
        note,
        task_id,
        initial_unit_ids,
    )
    .map_err(StocktakeErrorPayload::from)
}

#[tauri::command]
#[specta::specta]
pub async fn update_stocktake_header<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    stocktake_id: String,
    warehouse_id: Option<String>,
    note: OptionalUpdate<String>,
) -> Result<StocktakeDetail, StocktakeErrorPayload> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(map_ipc_err)?;
    let active_tid = crate::resolve_active_tenant_id(&conn).map_err(map_ipc_err)?;
    update_stocktake_header_impl(&mut conn, &active_tid, &stocktake_id, warehouse_id, note)
        .map_err(StocktakeErrorPayload::from)
}

#[tauri::command]
#[specta::specta]
pub async fn add_stocktake_lines<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    stocktake_id: String,
    unit_ids: Vec<String>,
) -> Result<StocktakeDetail, StocktakeErrorPayload> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(map_ipc_err)?;
    let active_tid = crate::resolve_active_tenant_id(&conn).map_err(map_ipc_err)?;
    add_stocktake_lines_impl(&mut conn, &active_tid, &stocktake_id, unit_ids)
        .map_err(StocktakeErrorPayload::from)
}

#[tauri::command]
#[specta::specta]
pub async fn add_stocktake_lines_from_stock<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    stocktake_id: String,
) -> Result<StocktakeDetail, StocktakeErrorPayload> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(map_ipc_err)?;
    let active_tid = crate::resolve_active_tenant_id(&conn).map_err(map_ipc_err)?;
    add_stocktake_lines_from_stock_impl(&mut conn, &active_tid, &stocktake_id)
        .map_err(StocktakeErrorPayload::from)
}

#[tauri::command]
#[specta::specta]
pub async fn remove_stocktake_line<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    line_id: String,
) -> Result<StocktakeDetail, StocktakeErrorPayload> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(map_ipc_err)?;
    let active_tid = crate::resolve_active_tenant_id(&conn).map_err(map_ipc_err)?;
    remove_stocktake_line_impl(&mut conn, &active_tid, &line_id)
        .map_err(StocktakeErrorPayload::from)
}

#[tauri::command]
#[specta::specta]
pub async fn start_stocktake_counting<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    stocktake_id: String,
) -> Result<StocktakeDetail, StocktakeErrorPayload> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(map_ipc_err)?;
    let active_tid = crate::resolve_active_tenant_id(&conn).map_err(map_ipc_err)?;
    start_stocktake_counting_impl(&mut conn, &active_tid, &stocktake_id)
        .map_err(StocktakeErrorPayload::from)
}

#[tauri::command]
#[specta::specta]
pub async fn set_stocktake_counted_quantity<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    line_id: String,
    counted_quantity: f64,
) -> Result<StocktakeDetail, StocktakeErrorPayload> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(map_ipc_err)?;
    let active_tid = crate::resolve_active_tenant_id(&conn).map_err(map_ipc_err)?;
    set_stocktake_counted_quantity_impl(&mut conn, &active_tid, &line_id, counted_quantity)
        .map_err(StocktakeErrorPayload::from)
}

#[tauri::command]
#[specta::specta]
pub async fn refresh_stocktake_system_quantity<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    stocktake_id: String,
    line_ids: Vec<String>,
) -> Result<StocktakeDetail, StocktakeErrorPayload> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(map_ipc_err)?;
    let active_tid = crate::resolve_active_tenant_id(&conn).map_err(map_ipc_err)?;
    refresh_stocktake_system_quantity_impl(&mut conn, &active_tid, &stocktake_id, line_ids)
        .map_err(StocktakeErrorPayload::from)
}

#[tauri::command]
#[specta::specta]
pub async fn post_stocktake<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    stocktake_id: String,
) -> Result<StocktakeDetail, StocktakeErrorPayload> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(map_ipc_err)?;
    let active_tid = crate::resolve_active_tenant_id(&conn).map_err(map_ipc_err)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn).map_err(map_ipc_err)?;
    post_stocktake_impl(&mut conn, &active_tid, &active_uid, &stocktake_id)
        .map_err(StocktakeErrorPayload::from)
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_stocktake<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    stocktake_id: String,
) -> Result<StocktakeDetail, StocktakeErrorPayload> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(map_ipc_err)?;
    let active_tid = crate::resolve_active_tenant_id(&conn).map_err(map_ipc_err)?;
    cancel_stocktake_impl(&mut conn, &active_tid, &stocktake_id)
        .map_err(StocktakeErrorPayload::from)
}

#[tauri::command]
#[specta::specta]
pub async fn get_stocktake<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    stocktake_id: String,
) -> Result<StocktakeDetail, StocktakeErrorPayload> {
    let db_path = get_db_path(&app_handle);
    let conn = rusqlite::Connection::open(&db_path).map_err(map_ipc_err)?;
    let active_tid = crate::resolve_active_tenant_id(&conn).map_err(map_ipc_err)?;
    get_stocktake_impl(&conn, &active_tid, &stocktake_id).map_err(StocktakeErrorPayload::from)
}

#[tauri::command]
#[specta::specta]
pub async fn list_stocktakes<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    status: Option<String>,
    warehouse_id: Option<String>,
) -> Result<Vec<Stocktake>, StocktakeErrorPayload> {
    let db_path = get_db_path(&app_handle);
    let conn = rusqlite::Connection::open(&db_path).map_err(map_ipc_err)?;
    let active_tid = crate::resolve_active_tenant_id(&conn).map_err(map_ipc_err)?;
    list_stocktakes_impl(&conn, &active_tid, status, warehouse_id)
        .map_err(StocktakeErrorPayload::from)
}

// ==========================================
// Unit and Integration Tests (Layer 1)
// ==========================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::products::create_product_impl;
    use crate::warehouses::{
        create_warehouse_impl, create_warehouses_tables, deactivate_warehouse_impl,
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
        crate::purchase_orders::create_purchase_orders_tables(&conn).unwrap();
        create_stocktakes_tables(&conn).unwrap();

        conn.execute(
            "INSERT INTO tenants (id, code, name) VALUES ('tnt_test', 'TEST', 'Test Tenant')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tenants (id, code, name) VALUES ('tnt_other', 'OTHER', 'Other Tenant')",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO users (id, email, password, name) VALUES ('usr_test', 'test@test.com', 'pwd', 'Tester')",
            [],
        )
        .unwrap();

        conn
    }

    fn create_test_product(
        conn: &mut Connection,
        tenant_id: &str,
        name: &str,
        category: &str,
    ) -> (String, String) {
        let res = create_product_impl(
            conn,
            tenant_id,
            name.to_string(),
            category.to_string(),
            None,
            Some("件".to_string()),
            Some(100.0),
        )
        .unwrap();

        let unit_id = res.units.first().unwrap().id.clone();
        (res.product.id, unit_id)
    }

    fn seed_movement(
        conn: &Connection,
        tenant_id: &str,
        warehouse_id: &str,
        unit_id: &str,
        delta: f64,
        created_at: i64,
    ) {
        let im_id = format!("im_seed_{}", STK_ID_COUNTER.fetch_add(1, Ordering::Relaxed));
        conn.execute(
            "INSERT INTO inventory_movements (
                id, tenant_id, unit_id, warehouse_id, quantity_delta, unit_cost, reason, reference_type, reference_id, created_by, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, 'opening_balance', 'seed', 'seed_1', 'usr_test', ?6)",
            params![im_id, tenant_id, unit_id, warehouse_id, delta, created_at],
        )
        .unwrap();
    }

    #[test]
    fn test_tc_stk_n_01_create_draft_stocktake() {
        // Given: Active tenant and active warehouse
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉").unwrap();

        // When: Creating draft stocktake
        let detail = create_stocktake_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh.id,
            Some("盤點備註".to_string()),
            None,
            None,
        )
        .unwrap();

        // Then: Stocktake created with STK-00001 in draft status
        assert!(detail.stocktake.id.starts_with("stk_"));
        assert_eq!(detail.stocktake.stocktake_number, "STK-00001");
        assert_eq!(detail.stocktake.status, "draft");
        assert_eq!(detail.stocktake.warehouse_id, wh.id);
        assert_eq!(detail.stocktake.note.as_deref(), Some("盤點備註"));
        assert_eq!(detail.lines.len(), 0);
    }

    #[test]
    fn test_tc_stk_n_02_add_lines_with_snapshots() {
        // Given: Active warehouse and sample product
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉").unwrap();
        let (_, unit_a) = create_test_product(&mut conn, "tnt_test", "品項A", "resale");
        let (_, unit_b) = create_test_product(&mut conn, "tnt_test", "品項B", "resale");

        let detail =
            create_stocktake_impl(&mut conn, "tnt_test", "usr_test", &wh.id, None, None, None)
                .unwrap();

        // When: Adding lines to draft stocktake
        let updated = add_stocktake_lines_impl(
            &mut conn,
            "tnt_test",
            &detail.stocktake.id,
            vec![unit_a.clone(), unit_b.clone()],
        )
        .unwrap();

        // Then: Lines added with snapshot and line_no sequenced
        assert_eq!(updated.lines.len(), 2);
        assert_eq!(updated.lines[0].line_no, 1);
        assert_eq!(updated.lines[0].unit_id, unit_a);
        assert_eq!(updated.lines[0].product_name_snapshot, "品項A");
        assert!(updated.lines[0].system_quantity.is_none());
        assert!(updated.lines[0].counted_quantity.is_none());

        assert_eq!(updated.lines[1].line_no, 2);
        assert_eq!(updated.lines[1].unit_id, unit_b);
        assert_eq!(updated.lines[1].product_name_snapshot, "品項B");
    }

    #[test]
    fn test_tc_stk_n_03_add_lines_from_stock_s04() {
        // Given: Warehouse with stock for unit_a and unit_b, while unit_c has 0 stock
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉").unwrap();
        let (_, unit_a) = create_test_product(&mut conn, "tnt_test", "品項A", "resale");
        let (_, unit_b) = create_test_product(&mut conn, "tnt_test", "品項B", "resale");
        let (_, unit_c) = create_test_product(&mut conn, "tnt_test", "品項C", "resale");

        seed_movement(&conn, "tnt_test", &wh.id, &unit_a, 10.0, 100);
        seed_movement(&conn, "tnt_test", &wh.id, &unit_b, 5.0, 100);
        // unit_c: +5 then -5 => 0 balance
        seed_movement(&conn, "tnt_test", &wh.id, &unit_c, 5.0, 100);
        seed_movement(&conn, "tnt_test", &wh.id, &unit_c, -5.0, 101);

        let detail =
            create_stocktake_impl(&mut conn, "tnt_test", "usr_test", &wh.id, None, None, None)
                .unwrap();

        // When: One-click bringing in active stock
        let updated =
            add_stocktake_lines_from_stock_impl(&mut conn, "tnt_test", &detail.stocktake.id)
                .unwrap();

        // Then: Exactly unit_a and unit_b are brought in; unit_c (0 balance) is excluded
        assert_eq!(updated.lines.len(), 2);
        let units_in_stk: Vec<String> = updated.lines.into_iter().map(|l| l.unit_id).collect();
        assert!(units_in_stk.contains(&unit_a));
        assert!(units_in_stk.contains(&unit_b));
        assert!(!units_in_stk.contains(&unit_c));
    }

    #[test]
    fn test_tc_stk_n_04_update_header() {
        // Given: Draft stocktake with warehouse WH1
        let mut conn = setup_test_db();
        let wh1 = create_warehouse_impl(&mut conn, "tnt_test", "WH1", "倉1").unwrap();
        let wh2 = create_warehouse_impl(&mut conn, "tnt_test", "WH2", "倉2").unwrap();

        let detail = create_stocktake_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh1.id,
            Some("舊備註".to_string()),
            None,
            None,
        )
        .unwrap();

        // When: Updating warehouse to WH2 and note
        let updated = update_stocktake_header_impl(
            &mut conn,
            "tnt_test",
            &detail.stocktake.id,
            Some(wh2.id.clone()),
            OptionalUpdate::Set("新備註".to_string()),
        )
        .unwrap();

        // Then: Header updated successfully
        assert_eq!(updated.stocktake.warehouse_id, wh2.id);
        assert_eq!(updated.stocktake.note.as_deref(), Some("新備註"));
    }

    #[test]
    fn test_tc_stk_n_05_remove_line_and_resequence() {
        // Given: Draft stocktake with 3 lines
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉").unwrap();
        let (_, unit_a) = create_test_product(&mut conn, "tnt_test", "品項A", "resale");
        let (_, unit_b) = create_test_product(&mut conn, "tnt_test", "品項B", "resale");
        let (_, unit_c) = create_test_product(&mut conn, "tnt_test", "品項C", "resale");

        let detail = create_stocktake_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh.id,
            None,
            None,
            Some(vec![unit_a, unit_b, unit_c]),
        )
        .unwrap();

        let second_line_id = detail.lines[1].id.clone();

        // When: Removing the second line
        let updated = remove_stocktake_line_impl(&mut conn, "tnt_test", &second_line_id).unwrap();

        // Then: Remaining 2 lines are resequenced to line_no 1 and 2
        assert_eq!(updated.lines.len(), 2);
        assert_eq!(updated.lines[0].line_no, 1);
        assert_eq!(updated.lines[1].line_no, 2);
    }

    #[test]
    fn test_tc_stk_n_06_start_counting_snapshots_balance_s05() {
        // Given: Active warehouse with unit balance 25.5
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉").unwrap();
        let (_, unit_a) = create_test_product(&mut conn, "tnt_test", "品項A", "resale");
        seed_movement(&conn, "tnt_test", &wh.id, &unit_a, 25.5, 100);

        let detail = create_stocktake_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh.id,
            None,
            None,
            Some(vec![unit_a]),
        )
        .unwrap();

        // When: Starting stocktake counting
        let updated =
            start_stocktake_counting_impl(&mut conn, "tnt_test", &detail.stocktake.id).unwrap();

        // Then: Status transitions to counting, system_quantity is 25.5, system_quantity_at is recorded
        assert_eq!(updated.stocktake.status, "counting");
        assert!(updated.stocktake.counting_started_at.is_some());
        assert_eq!(updated.lines[0].system_quantity, Some(25.5));
        assert!(updated.lines[0].system_quantity_at.is_some());
        assert!(updated.lines[0].counted_quantity.is_none());
    }

    #[test]
    fn test_tc_stk_n_07_and_08_set_counted_qty_and_remove_line_in_counting() {
        // Given: Stocktake in counting state with 2 lines
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉").unwrap();
        let (_, unit_a) = create_test_product(&mut conn, "tnt_test", "品項A", "resale");
        let (_, unit_b) = create_test_product(&mut conn, "tnt_test", "品項B", "resale");

        let detail = create_stocktake_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh.id,
            None,
            None,
            Some(vec![unit_a, unit_b]),
        )
        .unwrap();

        let in_counting =
            start_stocktake_counting_impl(&mut conn, "tnt_test", &detail.stocktake.id).unwrap();
        let line_1_id = in_counting.lines[0].id.clone();
        let line_2_id = in_counting.lines[1].id.clone();

        // When: Setting counted quantity on line 1
        let updated =
            set_stocktake_counted_quantity_impl(&mut conn, "tnt_test", &line_1_id, 15.0).unwrap();
        assert_eq!(updated.lines[0].counted_quantity, Some(15.0));

        // When: Removing line 2 while in counting state
        let after_remove = remove_stocktake_line_impl(&mut conn, "tnt_test", &line_2_id).unwrap();

        // Then: Line 2 removed successfully, line 1 remains with counted quantity
        assert_eq!(after_remove.lines.len(), 1);
        assert_eq!(after_remove.lines[0].id, line_1_id);
        assert_eq!(after_remove.lines[0].counted_quantity, Some(15.0));
    }

    #[test]
    fn test_tc_stk_n_09_post_stocktake_ledger_discrepancy() {
        // Given: 3 lines in counting state:
        // unit_a: sys=10, counted=15 (gain +5)
        // unit_b: sys=10, counted=8  (loss -2)
        // unit_c: sys=10, counted=10 (match 0)
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉").unwrap();
        let (_, unit_a) = create_test_product(&mut conn, "tnt_test", "品項A", "resale");
        let (_, unit_b) = create_test_product(&mut conn, "tnt_test", "品項B", "resale");
        let (_, unit_c) = create_test_product(&mut conn, "tnt_test", "品項C", "resale");

        seed_movement(&conn, "tnt_test", &wh.id, &unit_a, 10.0, 100);
        seed_movement(&conn, "tnt_test", &wh.id, &unit_b, 10.0, 100);
        seed_movement(&conn, "tnt_test", &wh.id, &unit_c, 10.0, 100);

        let detail = create_stocktake_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh.id,
            None,
            None,
            Some(vec![unit_a.clone(), unit_b.clone(), unit_c.clone()]),
        )
        .unwrap();

        let in_counting =
            start_stocktake_counting_impl(&mut conn, "tnt_test", &detail.stocktake.id).unwrap();
        set_stocktake_counted_quantity_impl(&mut conn, "tnt_test", &in_counting.lines[0].id, 15.0)
            .unwrap();
        set_stocktake_counted_quantity_impl(&mut conn, "tnt_test", &in_counting.lines[1].id, 8.0)
            .unwrap();
        set_stocktake_counted_quantity_impl(&mut conn, "tnt_test", &in_counting.lines[2].id, 10.0)
            .unwrap();

        // When: Posting stocktake
        let posted =
            post_stocktake_impl(&mut conn, "tnt_test", "usr_test", &detail.stocktake.id).unwrap();

        // Then: Status is posted, posted_at is recorded
        assert_eq!(posted.stocktake.status, "posted");
        assert!(posted.stocktake.posted_at.is_some());

        // Then: Verify inventory_movements:
        // Exactly 2 movements written with reason='stocktake' (delta +5 and -2); 0 delta is NOT written
        let mut stmt = conn
            .prepare(
                "SELECT unit_id, quantity_delta, reason, reference_type 
             FROM inventory_movements WHERE reference_id = ?1 ORDER BY quantity_delta DESC",
            )
            .unwrap();

        let rows: Vec<(String, f64, String, String)> = stmt
            .query_map(params![detail.stocktake.id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })
            .unwrap()
            .map(|r| r.unwrap())
            .collect();

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].0, unit_a);
        assert_eq!(rows[0].1, 5.0);
        assert_eq!(rows[0].2, "stocktake");
        assert_eq!(rows[0].3, "stocktake");

        assert_eq!(rows[1].0, unit_b);
        assert_eq!(rows[1].1, -2.0);

        // Then: Final balances match counted quantities
        let bal_a: f64 = conn.query_row(
            "SELECT SUM(quantity_delta) FROM inventory_movements WHERE warehouse_id = ?1 AND unit_id = ?2",
            params![wh.id, unit_a],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(bal_a, 15.0);

        let bal_b: f64 = conn.query_row(
            "SELECT SUM(quantity_delta) FROM inventory_movements WHERE warehouse_id = ?1 AND unit_id = ?2",
            params![wh.id, unit_b],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(bal_b, 8.0);

        let bal_c: f64 = conn.query_row(
            "SELECT SUM(quantity_delta) FROM inventory_movements WHERE warehouse_id = ?1 AND unit_id = ?2",
            params![wh.id, unit_c],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(bal_c, 10.0);
    }

    #[test]
    fn test_tc_stk_n_10_and_e_13_s07_movement_detected_and_s08_refresh() {
        // Given: Stocktake in counting state with system_quantity=10 at t=100
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉").unwrap();
        let (_, unit_a) = create_test_product(&mut conn, "tnt_test", "品項A", "resale");
        seed_movement(&conn, "tnt_test", &wh.id, &unit_a, 10.0, 50);

        let detail = create_stocktake_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh.id,
            None,
            None,
            Some(vec![unit_a.clone()]),
        )
        .unwrap();

        let in_counting =
            start_stocktake_counting_impl(&mut conn, "tnt_test", &detail.stocktake.id).unwrap();
        let line_id = in_counting.lines[0].id.clone();
        set_stocktake_counted_quantity_impl(&mut conn, "tnt_test", &line_id, 12.0).unwrap();

        let snap_at = in_counting.lines[0].system_quantity_at.unwrap();

        // Simulate snapshot was taken at t = snap_at - 100
        conn.execute(
            "UPDATE stocktake_lines SET system_quantity_at = ?1 WHERE id = ?2",
            params![snap_at - 100, line_id],
        )
        .unwrap();

        // When: A new movement is created in the same warehouse at t = snap_at - 50
        seed_movement(&conn, "tnt_test", &wh.id, &unit_a, 5.0, snap_at - 50);

        // When: Attempting to post stocktake
        let post_err = post_stocktake_impl(&mut conn, "tnt_test", "usr_test", &detail.stocktake.id)
            .unwrap_err();

        // Then: TC-STK-E-13: Blocked by S-07 movement detection
        assert!(matches!(
            post_err,
            StocktakeError::MovementsDetectedDuringCounting(_)
        ));
        assert!(post_err
            .to_string()
            .contains("以下品項在盤點期間有異動：〔品項A"));

        // When: S-08: Calling refresh_stocktake_system_quantity
        let refreshed = refresh_stocktake_system_quantity_impl(
            &mut conn,
            "tnt_test",
            &detail.stocktake.id,
            vec![line_id.clone()],
        )
        .unwrap();

        // Then: System quantity refreshed to 15 (10 + 5), and counted_quantity is CLEARED to NULL
        assert_eq!(refreshed.lines[0].system_quantity, Some(15.0));
        assert!(refreshed.lines[0].counted_quantity.is_none());

        // When: User re-counts and sets counted quantity to 15.0
        set_stocktake_counted_quantity_impl(&mut conn, "tnt_test", &line_id, 15.0).unwrap();

        // When: Posting stocktake again
        let posted =
            post_stocktake_impl(&mut conn, "tnt_test", "usr_test", &detail.stocktake.id).unwrap();

        // Then: Post succeeds
        assert_eq!(posted.stocktake.status, "posted");
    }

    #[test]
    fn test_tc_stk_n_11_and_12_cancel_draft_and_counting() {
        // Given: Active warehouse and sample product
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉").unwrap();
        let (_, unit_a) = create_test_product(&mut conn, "tnt_test", "品項A", "resale");

        // When: Cancelling a draft stocktake (N-11)
        let draft =
            create_stocktake_impl(&mut conn, "tnt_test", "usr_test", &wh.id, None, None, None)
                .unwrap();
        let cancelled_draft =
            cancel_stocktake_impl(&mut conn, "tnt_test", &draft.stocktake.id).unwrap();
        assert_eq!(cancelled_draft.stocktake.status, "cancelled");
        assert!(cancelled_draft.stocktake.cancelled_at.is_some());

        // When: Cancelling a counting stocktake (N-12)
        let stk2 = create_stocktake_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh.id,
            None,
            None,
            Some(vec![unit_a]),
        )
        .unwrap();
        let counting =
            start_stocktake_counting_impl(&mut conn, "tnt_test", &stk2.stocktake.id).unwrap();
        let cancelled_counting =
            cancel_stocktake_impl(&mut conn, "tnt_test", &counting.stocktake.id).unwrap();
        assert_eq!(cancelled_counting.stocktake.status, "cancelled");
        assert!(cancelled_counting.stocktake.cancelled_at.is_some());
    }

    #[test]
    fn test_tc_stk_n_13_zero_counted_quantity_boundary() {
        // Given: Stock is 10, counted is 0 (all lost)
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉").unwrap();
        let (_, unit_a) = create_test_product(&mut conn, "tnt_test", "品項A", "resale");
        seed_movement(&conn, "tnt_test", &wh.id, &unit_a, 10.0, 100);

        let detail = create_stocktake_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh.id,
            None,
            None,
            Some(vec![unit_a.clone()]),
        )
        .unwrap();
        let counting =
            start_stocktake_counting_impl(&mut conn, "tnt_test", &detail.stocktake.id).unwrap();
        set_stocktake_counted_quantity_impl(&mut conn, "tnt_test", &counting.lines[0].id, 0.0)
            .unwrap();

        // When: Posting stocktake
        let posted =
            post_stocktake_impl(&mut conn, "tnt_test", "usr_test", &detail.stocktake.id).unwrap();
        assert_eq!(posted.stocktake.status, "posted");

        // Then: Final balance is exactly 0
        let bal: f64 = conn.query_row(
            "SELECT SUM(quantity_delta) FROM inventory_movements WHERE warehouse_id = ?1 AND unit_id = ?2",
            params![wh.id, unit_a],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(bal, 0.0);
    }

    #[test]
    fn test_tc_stk_n_14_and_e_07_s05_counting_mutual_exclusion() {
        // Given: Two warehouses WH1 and WH2, and unit_a
        let mut conn = setup_test_db();
        let wh1 = create_warehouse_impl(&mut conn, "tnt_test", "WH1", "倉1").unwrap();
        let wh2 = create_warehouse_impl(&mut conn, "tnt_test", "WH2", "倉2").unwrap();
        let (_, unit_a) = create_test_product(&mut conn, "tnt_test", "品項A", "resale");

        // STK1 in WH1 starts counting with unit_a
        let stk1 = create_stocktake_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh1.id,
            None,
            None,
            Some(vec![unit_a.clone()]),
        )
        .unwrap();
        start_stocktake_counting_impl(&mut conn, "tnt_test", &stk1.stocktake.id).unwrap();

        // When: STK2 in DIFFERENT warehouse WH2 starts counting with unit_a (TC-STK-N-14)
        let stk2 = create_stocktake_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh2.id,
            None,
            None,
            Some(vec![unit_a.clone()]),
        )
        .unwrap();
        let stk2_counting =
            start_stocktake_counting_impl(&mut conn, "tnt_test", &stk2.stocktake.id);
        // Then: Allowed! Different warehouse is independent
        assert!(stk2_counting.is_ok());

        // When: STK3 in the SAME warehouse WH1 tries to start counting with unit_a (TC-STK-E-07)
        let stk3 = create_stocktake_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh1.id,
            None,
            None,
            Some(vec![unit_a.clone()]),
        )
        .unwrap();
        let stk3_err =
            start_stocktake_counting_impl(&mut conn, "tnt_test", &stk3.stocktake.id).unwrap_err();

        // Then: S-05 mutual exclusion blocks STK3
        assert!(matches!(
            stk3_err,
            StocktakeError::UnitAlreadyInCounting { .. }
        ));
        assert!(stk3_err.to_string().contains("STK-00001 盤點中"));
    }

    #[test]
    fn test_tc_stk_n_15_and_e_19_w03_warehouse_deactivation_guard() {
        // Given: Active warehouse with draft stocktake
        let mut conn = setup_test_db();
        let wh1 = create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉").unwrap();
        let wh2 = create_warehouse_impl(&mut conn, "tnt_test", "SUB", "副倉").unwrap();

        let detail =
            create_stocktake_impl(&mut conn, "tnt_test", "usr_test", &wh2.id, None, None, None)
                .unwrap();

        // When: Attempting to deactivate wh2 while draft stocktake exists (TC-STK-E-19)
        let deact_err = deactivate_warehouse_impl(&mut conn, "tnt_test", &wh2.id).unwrap_err();

        // Then: W-03 extension blocks deactivation
        assert_eq!(
            deact_err,
            format!(
                "此倉仍被未結案單據引用：{}",
                detail.stocktake.stocktake_number
            )
        );

        // When: Cancelling the stocktake
        cancel_stocktake_impl(&mut conn, "tnt_test", &detail.stocktake.id).unwrap();

        // When: Deactivating wh2 now (TC-STK-N-15)
        let deact_res = deactivate_warehouse_impl(&mut conn, "tnt_test", &wh2.id);

        // Then: Deactivation succeeds
        assert!(deact_res.is_ok());
        let _ = wh1;
    }

    #[test]
    fn test_tc_stk_n_16_non_purchasable_product_can_be_counted() {
        // Given: Manufactured product (is_purchasable = false)
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉").unwrap();
        let (_, mfg_unit) = create_test_product(&mut conn, "tnt_test", "自製商品", "manufactured");
        seed_movement(&conn, "tnt_test", &wh.id, &mfg_unit, 20.0, 100);

        // When: Creating and counting manufactured product
        let detail = create_stocktake_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh.id,
            None,
            None,
            Some(vec![mfg_unit]),
        )
        .unwrap();
        let counting =
            start_stocktake_counting_impl(&mut conn, "tnt_test", &detail.stocktake.id).unwrap();
        set_stocktake_counted_quantity_impl(&mut conn, "tnt_test", &counting.lines[0].id, 22.0)
            .unwrap();
        let posted =
            post_stocktake_impl(&mut conn, "tnt_test", "usr_test", &detail.stocktake.id).unwrap();

        // Then: Successfully posted
        assert_eq!(posted.stocktake.status, "posted");
    }

    #[test]
    fn test_tc_stk_e_01_empty_tenant_id() {
        // Given: Empty tenant ID
        let mut conn = setup_test_db();

        // When: Calling create_stocktake_impl
        let err =
            create_stocktake_impl(&mut conn, "", "usr_test", "wh_1", None, None, None).unwrap_err();

        // Then: EmptyTenantId error
        assert_eq!(err, StocktakeError::EmptyTenantId);
    }

    #[test]
    fn test_tc_stk_e_02_and_03_warehouse_validation() {
        // Given: Inactive warehouse
        let mut conn = setup_test_db();
        let _wh1 = create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉").unwrap();
        let wh2 = create_warehouse_impl(&mut conn, "tnt_test", "SUB", "副倉").unwrap();
        deactivate_warehouse_impl(&mut conn, "tnt_test", &wh2.id).unwrap();

        // When: Creating with non-existent warehouse (E-02)
        let err1 = create_stocktake_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            "wh_nonexistent",
            None,
            None,
            None,
        )
        .unwrap_err();
        assert_eq!(err1, StocktakeError::WarehouseNotFoundOrInactive);

        // When: Creating with deactivated warehouse (E-03)
        let err2 =
            create_stocktake_impl(&mut conn, "tnt_test", "usr_test", &wh2.id, None, None, None)
                .unwrap_err();
        assert_eq!(err2, StocktakeError::WarehouseNotFoundOrInactive);
    }

    #[test]
    fn test_tc_stk_e_04_and_05_unit_validations() {
        // Given: Sample product in tnt_test
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉").unwrap();
        let (_, unit_a) = create_test_product(&mut conn, "tnt_test", "品項A", "resale");

        // When: Cross-tenant unit (E-04)
        let err_cross = create_stocktake_impl(
            &mut conn,
            "tnt_other",
            "usr_test",
            &wh.id,
            None,
            None,
            Some(vec![unit_a.clone()]),
        )
        .unwrap_err();
        // Cross tenant warehouse or unit rejected
        assert!(matches!(
            err_cross,
            StocktakeError::WarehouseNotFoundOrInactive | StocktakeError::UnitNotFound
        ));

        // When: Duplicate unit in same stocktake (E-05)
        let err_dup = create_stocktake_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh.id,
            None,
            None,
            Some(vec![unit_a.clone(), unit_a]),
        )
        .unwrap_err();
        assert_eq!(err_dup, StocktakeError::DuplicateUnitInStocktake);
    }

    #[test]
    fn test_tc_stk_e_06_empty_lines_start_counting_rejected() {
        // Given: Draft stocktake with 0 lines
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉").unwrap();
        let detail =
            create_stocktake_impl(&mut conn, "tnt_test", "usr_test", &wh.id, None, None, None)
                .unwrap();

        // When: Starting counting on empty stocktake
        let err =
            start_stocktake_counting_impl(&mut conn, "tnt_test", &detail.stocktake.id).unwrap_err();

        // Then: EmptyStocktakeLines error
        assert_eq!(err, StocktakeError::EmptyStocktakeLines);
    }

    #[test]
    fn test_tc_stk_e_08_and_09_counted_quantity_validations() {
        // Given: Draft stocktake and counting stocktake
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉").unwrap();
        let (_, unit_a) = create_test_product(&mut conn, "tnt_test", "品項A", "resale");

        let detail = create_stocktake_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh.id,
            None,
            None,
            Some(vec![unit_a]),
        )
        .unwrap();
        let line_id = detail.lines[0].id.clone();

        // When: Trying to set counted quantity while still in draft (E-08)
        let err_draft =
            set_stocktake_counted_quantity_impl(&mut conn, "tnt_test", &line_id, 10.0).unwrap_err();
        assert!(matches!(
            err_draft,
            StocktakeError::OnlyCountingForCountedQty(_)
        ));

        // When: In counting, trying to set negative counted quantity (E-09)
        start_stocktake_counting_impl(&mut conn, "tnt_test", &detail.stocktake.id).unwrap();
        let err_neg =
            set_stocktake_counted_quantity_impl(&mut conn, "tnt_test", &line_id, -1.0).unwrap_err();
        assert_eq!(err_neg, StocktakeError::NegativeCountedQuantity);
    }

    #[test]
    fn test_tc_stk_e_10_and_11_counting_state_restrictions() {
        // Given: Stocktake in counting state
        let mut conn = setup_test_db();
        let wh1 = create_warehouse_impl(&mut conn, "tnt_test", "WH1", "倉1").unwrap();
        let wh2 = create_warehouse_impl(&mut conn, "tnt_test", "WH2", "倉2").unwrap();
        let (_, unit_a) = create_test_product(&mut conn, "tnt_test", "品項A", "resale");
        let (_, unit_b) = create_test_product(&mut conn, "tnt_test", "品項B", "resale");

        let detail = create_stocktake_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh1.id,
            None,
            None,
            Some(vec![unit_a]),
        )
        .unwrap();
        start_stocktake_counting_impl(&mut conn, "tnt_test", &detail.stocktake.id).unwrap();

        // When: Adding lines while in counting state (E-10)
        let err_add =
            add_stocktake_lines_impl(&mut conn, "tnt_test", &detail.stocktake.id, vec![unit_b])
                .unwrap_err();
        assert!(matches!(err_add, StocktakeError::NotDraftForLineAdd(_)));

        // When: Updating warehouse while in counting state (E-11)
        let err_header = update_stocktake_header_impl(
            &mut conn,
            "tnt_test",
            &detail.stocktake.id,
            Some(wh2.id),
            OptionalUpdate::Keep,
        )
        .unwrap_err();
        assert!(matches!(
            err_header,
            StocktakeError::NotDraftForHeaderEdit(_)
        ));
    }

    #[test]
    fn test_tc_stk_e_12_missing_counted_quantity_post_rejected() {
        // Given: Stocktake in counting state with 2 lines, but only 1 has counted_quantity
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉").unwrap();
        let (_, unit_a) = create_test_product(&mut conn, "tnt_test", "品項A", "resale");
        let (_, unit_b) = create_test_product(&mut conn, "tnt_test", "品項B", "resale");

        let detail = create_stocktake_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh.id,
            None,
            None,
            Some(vec![unit_a, unit_b]),
        )
        .unwrap();
        let counting =
            start_stocktake_counting_impl(&mut conn, "tnt_test", &detail.stocktake.id).unwrap();
        set_stocktake_counted_quantity_impl(&mut conn, "tnt_test", &counting.lines[0].id, 10.0)
            .unwrap();

        // When: Posting with line 2 counted_quantity = NULL
        let err = post_stocktake_impl(&mut conn, "tnt_test", "usr_test", &detail.stocktake.id)
            .unwrap_err();

        // Then: MissingCountedQuantity error (1 missing)
        assert_eq!(err, StocktakeError::MissingCountedQuantity(1));
    }

    #[test]
    fn test_tc_stk_e_14_movement_in_other_warehouse_does_not_block_post() {
        // Given: Stocktake for WH1 with unit_a
        let mut conn = setup_test_db();
        let wh1 = create_warehouse_impl(&mut conn, "tnt_test", "WH1", "倉1").unwrap();
        let wh2 = create_warehouse_impl(&mut conn, "tnt_test", "WH2", "倉2").unwrap();
        let (_, unit_a) = create_test_product(&mut conn, "tnt_test", "品項A", "resale");
        seed_movement(&conn, "tnt_test", &wh1.id, &unit_a, 10.0, 50);

        let detail = create_stocktake_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh1.id,
            None,
            None,
            Some(vec![unit_a.clone()]),
        )
        .unwrap();
        let counting =
            start_stocktake_counting_impl(&mut conn, "tnt_test", &detail.stocktake.id).unwrap();
        set_stocktake_counted_quantity_impl(&mut conn, "tnt_test", &counting.lines[0].id, 10.0)
            .unwrap();

        let snap_at = counting.lines[0].system_quantity_at.unwrap();

        // When: A movement occurs in WH2 (OTHER warehouse) at snap_at + 10
        seed_movement(&conn, "tnt_test", &wh2.id, &unit_a, 50.0, snap_at + 10);

        // When: Posting WH1 stocktake
        let posted = post_stocktake_impl(&mut conn, "tnt_test", "usr_test", &detail.stocktake.id);

        // Then: Succeeds! WH2 movements do NOT block WH1 post
        assert!(posted.is_ok());
    }

    #[test]
    fn test_tc_stk_e_15_to_18_terminal_state_protections() {
        // Given: Posted stocktake
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉").unwrap();
        let (_, unit_a) = create_test_product(&mut conn, "tnt_test", "品項A", "resale");

        let detail = create_stocktake_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh.id,
            None,
            None,
            Some(vec![unit_a]),
        )
        .unwrap();
        let counting =
            start_stocktake_counting_impl(&mut conn, "tnt_test", &detail.stocktake.id).unwrap();
        set_stocktake_counted_quantity_impl(&mut conn, "tnt_test", &counting.lines[0].id, 5.0)
            .unwrap();
        let posted =
            post_stocktake_impl(&mut conn, "tnt_test", "usr_test", &detail.stocktake.id).unwrap();

        // When: Trying to post again (E-15 Idempotency)
        let err_double_post =
            post_stocktake_impl(&mut conn, "tnt_test", "usr_test", &posted.stocktake.id)
                .unwrap_err();
        assert!(matches!(
            err_double_post,
            StocktakeError::InvalidStateTransition { .. }
        ));

        // When: Trying to cancel posted stocktake (E-16)
        let err_cancel =
            cancel_stocktake_impl(&mut conn, "tnt_test", &posted.stocktake.id).unwrap_err();
        assert!(matches!(
            err_cancel,
            StocktakeError::InvalidStateTransition { .. }
        ));

        // When: Trying to delete line on posted stocktake (E-18)
        let err_del_line =
            remove_stocktake_line_impl(&mut conn, "tnt_test", &posted.lines[0].id).unwrap_err();
        assert!(matches!(
            err_del_line,
            StocktakeError::NotDraftOrCountingForLineRemove(_)
        ));

        // When: Trying to post cancelled stocktake (E-17)
        let stk_cancel =
            create_stocktake_impl(&mut conn, "tnt_test", "usr_test", &wh.id, None, None, None)
                .unwrap();
        cancel_stocktake_impl(&mut conn, "tnt_test", &stk_cancel.stocktake.id).unwrap();
        let err_post_cancelled =
            post_stocktake_impl(&mut conn, "tnt_test", "usr_test", &stk_cancel.stocktake.id)
                .unwrap_err();
        assert!(matches!(
            err_post_cancelled,
            StocktakeError::InvalidStateTransition { .. }
        ));
    }

    #[test]
    fn test_tc_stk_e_20_tenant_isolation_s11() {
        // Given: Stocktake in tnt_test
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉").unwrap();
        let detail =
            create_stocktake_impl(&mut conn, "tnt_test", "usr_test", &wh.id, None, None, None)
                .unwrap();

        // When: Querying from tnt_other (E-20)
        let err_get = get_stocktake_impl(&conn, "tnt_other", &detail.stocktake.id).unwrap_err();
        assert_eq!(err_get, StocktakeError::StocktakeNotFound);

        // When: Listing from tnt_other
        let list_other = list_stocktakes_impl(&conn, "tnt_other", None, None).unwrap();
        assert_eq!(list_other.len(), 0);
    }

    #[test]
    fn test_tc_stk_n_17_update_header_clear_note() {
        // Given: Stocktake with existing note
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉").unwrap();
        let detail = create_stocktake_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh.id,
            Some("原始備註".to_string()),
            None,
            None,
        )
        .unwrap();
        assert_eq!(detail.stocktake.note.as_deref(), Some("原始備註"));

        // When: Updating header with OptionalUpdate::Clear
        let updated = update_stocktake_header_impl(
            &mut conn,
            "tnt_test",
            &detail.stocktake.id,
            None,
            OptionalUpdate::Clear,
        )
        .unwrap();

        // Then: Note is cleared to None
        assert_eq!(updated.stocktake.note, None);
    }

    #[test]
    fn test_tc_stk_e_21_nan_counted_quantity_rejected() {
        // Given: Stocktake in counting state
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉").unwrap();
        let (_, unit_a) = create_test_product(&mut conn, "tnt_test", "品項A", "resale");
        let detail = create_stocktake_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh.id,
            None,
            None,
            Some(vec![unit_a]),
        )
        .unwrap();
        let counting =
            start_stocktake_counting_impl(&mut conn, "tnt_test", &detail.stocktake.id).unwrap();

        // When: Setting NaN counted quantity
        let err = set_stocktake_counted_quantity_impl(
            &mut conn,
            "tnt_test",
            &counting.lines[0].id,
            f64::NAN,
        )
        .unwrap_err();

        // Then: Rejected with NegativeCountedQuantity
        assert_eq!(err, StocktakeError::NegativeCountedQuantity);
    }

    #[test]
    fn test_tc_stk_n_18_state_transition_validation() {
        assert!(can_transition("draft", "counting"));
        assert!(can_transition("draft", "cancelled"));
        assert!(can_transition("counting", "posted"));
        assert!(can_transition("counting", "cancelled"));

        assert!(!can_transition("draft", "posted"));
        assert!(!can_transition("counting", "draft"));
        assert!(!can_transition("posted", "draft"));
        assert!(!can_transition("posted", "cancelled"));
        assert!(!can_transition("cancelled", "counting"));
    }
}
