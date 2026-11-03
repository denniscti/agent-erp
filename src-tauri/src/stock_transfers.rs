use crate::get_db_path;
use rusqlite::params;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static TRF_ID_COUNTER: AtomicU64 = AtomicU64::new(1000);
static TRFL_ID_COUNTER: AtomicU64 = AtomicU64::new(1000);

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
pub struct StockTransfer {
    pub id: String,
    pub tenant_id: String,
    pub transfer_number: String,
    pub from_warehouse_id: String,
    pub to_warehouse_id: String,
    pub status: String, // "draft" | "posted" | "cancelled"
    pub note: Option<String>,
    pub created_by: String,
    pub created_at: i64,
    pub posted_at: Option<i64>,
    pub cancelled_at: Option<i64>,
    pub task_id: Option<String>,
    #[serde(default)]
    pub lines_count: Option<i64>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq)]
pub struct StockTransferLine {
    pub id: String,
    pub transfer_id: String,
    pub line_no: i64,
    pub unit_id: String,
    pub quantity: f64,
    pub product_name_snapshot: String,
    pub variant_name_snapshot: String,
    pub sku_snapshot: Option<String>,
    pub unit_name_snapshot: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq)]
pub struct StockTransferDetail {
    pub transfer: StockTransfer,
    pub lines: Vec<StockTransferLine>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq)]
pub struct CreateStockTransferLineInput {
    pub unit_id: String,
    pub quantity: f64,
}

// ==========================================
// Table Creation
// ==========================================

pub fn create_stock_transfers_tables(conn: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS stock_transfers (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            transfer_number TEXT NOT NULL,
            from_warehouse_id TEXT NOT NULL,
            to_warehouse_id TEXT NOT NULL,
            status TEXT NOT NULL,
            note TEXT,
            created_by TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            posted_at INTEGER,
            cancelled_at INTEGER,
            task_id TEXT
        )",
        [],
    )?;

    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_trf_tenant_number ON stock_transfers (tenant_id, transfer_number)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_trf_tenant ON stock_transfers (tenant_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_trf_tenant_from_wh ON stock_transfers (tenant_id, from_warehouse_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_trf_tenant_to_wh ON stock_transfers (tenant_id, to_warehouse_id)",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS stock_transfer_lines (
            id TEXT PRIMARY KEY,
            transfer_id TEXT NOT NULL,
            line_no INTEGER NOT NULL,
            unit_id TEXT NOT NULL,
            quantity REAL NOT NULL,
            product_name_snapshot TEXT NOT NULL,
            variant_name_snapshot TEXT NOT NULL,
            sku_snapshot TEXT,
            unit_name_snapshot TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_trfl_transfer ON stock_transfer_lines (transfer_id)",
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
            "〔{}／{}／{}〕在〔{}〕現有 {}，不足調撥 {}",
            self.product_name,
            self.variant_name,
            self.unit_name,
            self.warehouse_name,
            self.available_qty,
            self.requested_qty
        )
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Clone)]
pub enum StockTransferError {
    #[error("Tenant ID cannot be empty")]
    EmptyTenantId,

    #[error("無法解析有效使用者 session，操作被拒絕")]
    EmptyUserId,

    #[error("找不到倉別或倉別已停用")]
    WarehouseNotFoundOrInactive,

    #[error("來源倉與目的倉不可相同")]
    SameWarehouse,

    #[error("找不到指定的商品單位 (unit_id) 或不屬於目前租戶")]
    UnitNotFound,

    #[error("調撥數量必須大於 0")]
    InvalidQuantity,

    #[error("同一調撥單內商品單位不可重複")]
    DuplicateUnit,

    #[error("找不到調撥單或不屬於目前租戶")]
    TransferNotFound,

    #[error("調撥單狀態為 {0}，不允許修改表頭")]
    NotDraftForHeaderEdit(String),

    #[error("調撥單狀態為 {0}，僅草稿狀態可新增明細")]
    NotDraftForLineAdd(String),

    #[error("調撥單狀態為 {0}，僅草稿狀態可修改明細")]
    NotDraftForLineEdit(String),

    #[error("調撥單狀態為 {0}，僅草稿狀態可刪除明細")]
    NotDraftForLineRemove(String),

    #[error("無效的狀態轉換：不可從 {from} 轉換至 {to}")]
    InvalidStateTransition { from: String, to: String },

    #[error("調撥單沒有任何明細")]
    EmptyLines,

    #[error("找不到指定的調撥單明細行")]
    LineNotFound,

    #[error("{0}")]
    InsufficientStock(Box<InsufficientStockDetails>),

    #[error("{0}")]
    WarehouseError(String),

    #[error("{0}")]
    DatabaseError(String),
}

impl From<rusqlite::Error> for StockTransferError {
    fn from(err: rusqlite::Error) -> Self {
        StockTransferError::DatabaseError(err.to_string())
    }
}

// ==========================================
// Helpers
// ==========================================

pub use crate::products::{resolve_unit_snapshot, UnitSnapshot};

fn next_trf_number(
    tx: &rusqlite::Transaction,
    tenant_id: &str,
) -> Result<String, StockTransferError> {
    let mut stmt = tx.prepare(
        "SELECT transfer_number FROM stock_transfers 
         WHERE tenant_id = ?1 AND transfer_number LIKE 'TRF-%' 
         ORDER BY transfer_number DESC",
    )?;

    let mut rows = stmt.query(params![tenant_id])?;
    let mut max_seq: i64 = 0;
    while let Some(row) = rows.next()? {
        let code: String = row.get(0)?;
        if let Some(num_part) = code.strip_prefix("TRF-") {
            if let Ok(seq) = num_part.parse::<i64>() {
                if seq > max_seq {
                    max_seq = seq;
                }
            }
        }
    }
    let next_seq = max_seq + 1;
    Ok(format!("TRF-{:05}", next_seq))
}

fn validate_transfer_warehouses(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    from_wh_id: &str,
    to_wh_id: &str,
) -> Result<(crate::warehouses::Warehouse, crate::warehouses::Warehouse), StockTransferError> {
    let trimmed_from = from_wh_id.trim();
    let trimmed_to = to_wh_id.trim();

    if trimmed_from.is_empty() || trimmed_to.is_empty() {
        return Err(StockTransferError::WarehouseNotFoundOrInactive);
    }

    if trimmed_from == trimmed_to {
        return Err(StockTransferError::SameWarehouse);
    }

    let from_wh = crate::warehouses::validate_warehouse_active(conn, tenant_id, trimmed_from)
        .map_err(|e| {
            if e == "找不到倉別或倉別已停用" {
                StockTransferError::WarehouseNotFoundOrInactive
            } else {
                StockTransferError::WarehouseError(e)
            }
        })?;

    let to_wh =
        crate::warehouses::validate_warehouse_active(conn, tenant_id, trimmed_to).map_err(|e| {
            if e == "找不到倉別或倉別已停用" {
                StockTransferError::WarehouseNotFoundOrInactive
            } else {
                StockTransferError::WarehouseError(e)
            }
        })?;

    Ok((from_wh, to_wh))
}

fn map_stock_transfer_row(row: &rusqlite::Row) -> Result<StockTransfer, rusqlite::Error> {
    Ok(StockTransfer {
        id: row.get(0)?,
        tenant_id: row.get(1)?,
        transfer_number: row.get(2)?,
        from_warehouse_id: row.get(3)?,
        to_warehouse_id: row.get(4)?,
        status: row.get(5)?,
        note: row.get(6)?,
        created_by: row.get(7)?,
        created_at: row.get(8)?,
        posted_at: row.get(9)?,
        cancelled_at: row.get(10)?,
        task_id: row.get(11)?,
        lines_count: row.get(12).ok(),
    })
}

fn map_stock_transfer_line_row(row: &rusqlite::Row) -> Result<StockTransferLine, rusqlite::Error> {
    Ok(StockTransferLine {
        id: row.get(0)?,
        transfer_id: row.get(1)?,
        line_no: row.get(2)?,
        unit_id: row.get(3)?,
        quantity: row.get(4)?,
        product_name_snapshot: row.get(5)?,
        variant_name_snapshot: row.get(6)?,
        sku_snapshot: row.get(7)?,
        unit_name_snapshot: row.get(8)?,
        created_at: row.get(9)?,
    })
}

// ==========================================
// Core Implementation Functions
// ==========================================

#[allow(clippy::too_many_arguments)]
pub fn create_stock_transfer_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    user_id: &str,
    from_warehouse_id: &str,
    to_warehouse_id: &str,
    note: Option<String>,
    task_id: Option<String>,
    initial_lines: Option<Vec<CreateStockTransferLineInput>>,
) -> Result<StockTransferDetail, StockTransferError> {
    if tenant_id.trim().is_empty() {
        return Err(StockTransferError::EmptyTenantId);
    }
    let trimmed_uid = user_id.trim();
    if trimmed_uid.is_empty() {
        return Err(StockTransferError::EmptyUserId);
    }

    // T-02: validate both warehouses active and not equal
    validate_transfer_warehouses(conn, tenant_id, from_warehouse_id, to_warehouse_id)?;

    // T-03 & T-04: Validate initial lines if provided
    let mut resolved_lines = Vec::new();
    if let Some(lines) = initial_lines {
        let mut seen_units = std::collections::HashSet::new();
        for line in lines {
            let trimmed_unit_id = line.unit_id.trim();
            if trimmed_unit_id.is_empty() {
                return Err(StockTransferError::UnitNotFound);
            }
            if !seen_units.insert(trimmed_unit_id.to_string()) {
                return Err(StockTransferError::DuplicateUnit);
            }
            if line.quantity <= 0.0 || line.quantity.is_nan() || line.quantity.is_infinite() {
                return Err(StockTransferError::InvalidQuantity);
            }
            let snapshot = resolve_unit_snapshot(conn, tenant_id, trimmed_unit_id)
                .map_err(|_| StockTransferError::UnitNotFound)?;
            resolved_lines.push((trimmed_unit_id.to_string(), line.quantity, snapshot));
        }
    }

    let now = current_timestamp();
    let trf_id = format!(
        "trf_{}_{}",
        now,
        TRF_ID_COUNTER.fetch_add(1, Ordering::SeqCst)
    );

    let tx = conn.transaction()?;
    let trf_number = next_trf_number(&tx, tenant_id)?;

    let clean_note = note.and_then(|n| {
        let trimmed = n.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });

    let clean_task_id = task_id.and_then(|t| {
        let trimmed = t.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });

    tx.execute(
        "INSERT INTO stock_transfers (
            id, tenant_id, transfer_number, from_warehouse_id, to_warehouse_id,
            status, note, created_by, created_at, posted_at, cancelled_at, task_id
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, NULL, ?10)",
        params![
            trf_id,
            tenant_id,
            trf_number,
            from_warehouse_id.trim(),
            to_warehouse_id.trim(),
            "draft",
            clean_note,
            trimmed_uid,
            now,
            clean_task_id
        ],
    )?;

    for (idx, (unit_id, quantity, snapshot)) in resolved_lines.into_iter().enumerate() {
        let line_id = format!(
            "trfl_{}_{}",
            now,
            TRFL_ID_COUNTER.fetch_add(1, Ordering::SeqCst)
        );
        tx.execute(
            "INSERT INTO stock_transfer_lines (
                id, transfer_id, line_no, unit_id, quantity,
                product_name_snapshot, variant_name_snapshot, sku_snapshot,
                unit_name_snapshot, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                line_id,
                trf_id,
                (idx + 1) as i64,
                unit_id,
                quantity,
                snapshot.product_name,
                snapshot.variant_name,
                snapshot.sku,
                snapshot.unit_name,
                now
            ],
        )?;
    }

    tx.commit()?;

    get_stock_transfer_impl(conn, tenant_id, &trf_id)
}

pub fn update_stock_transfer_header_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    transfer_id: &str,
    from_warehouse_id: Option<String>,
    to_warehouse_id: Option<String>,
    note: Option<Option<String>>,
) -> Result<StockTransferDetail, StockTransferError> {
    if tenant_id.trim().is_empty() {
        return Err(StockTransferError::EmptyTenantId);
    }

    let (current_status, current_from_wh, current_to_wh): (String, String, String) = {
        let mut stmt = conn.prepare(
            "SELECT status, from_warehouse_id, to_warehouse_id FROM stock_transfers WHERE id = ?1 AND tenant_id = ?2",
        )?;
        stmt.query_row(params![transfer_id, tenant_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .map_err(|_| StockTransferError::TransferNotFound)?
    };

    if current_status != "draft" {
        return Err(StockTransferError::NotDraftForHeaderEdit(current_status));
    }

    let target_from_wh = from_warehouse_id
        .map(|w| w.trim().to_string())
        .filter(|w| !w.is_empty())
        .unwrap_or(current_from_wh);

    let target_to_wh = to_warehouse_id
        .map(|w| w.trim().to_string())
        .filter(|w| !w.is_empty())
        .unwrap_or(current_to_wh);

    validate_transfer_warehouses(conn, tenant_id, &target_from_wh, &target_to_wh)?;

    let mut query =
        String::from("UPDATE stock_transfers SET from_warehouse_id = ?1, to_warehouse_id = ?2");
    let mut param_values: Vec<rusqlite::types::Value> = vec![
        rusqlite::types::Value::Text(target_from_wh),
        rusqlite::types::Value::Text(target_to_wh),
    ];

    if let Some(note_val) = note {
        match note_val {
            Some(n) => {
                let trimmed = n.trim().to_string();
                if trimmed.is_empty() {
                    query.push_str(", note = NULL");
                } else {
                    query.push_str(&format!(", note = ?{}", param_values.len() + 1));
                    param_values.push(rusqlite::types::Value::Text(trimmed));
                }
            }
            None => {
                query.push_str(", note = NULL");
            }
        }
    }

    query.push_str(&format!(
        " WHERE id = ?{} AND tenant_id = ?{} AND status = 'draft'",
        param_values.len() + 1,
        param_values.len() + 2
    ));
    param_values.push(rusqlite::types::Value::Text(transfer_id.to_string()));
    param_values.push(rusqlite::types::Value::Text(tenant_id.to_string()));

    let tx = conn.transaction()?;
    let affected = tx.execute(&query, rusqlite::params_from_iter(param_values))?;
    crate::ensure_guarded_mutation_affected(
        &tx,
        "stock_transfers",
        transfer_id,
        tenant_id,
        affected,
        StockTransferError::TransferNotFound,
        |s| {
            if s != "draft" {
                Err(StockTransferError::NotDraftForHeaderEdit(s))
            } else {
                Ok(())
            }
        },
    )?;
    tx.commit()?;

    get_stock_transfer_impl(conn, tenant_id, transfer_id)
}

pub fn add_stock_transfer_line_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    transfer_id: &str,
    unit_id: &str,
    quantity: f64,
) -> Result<StockTransferDetail, StockTransferError> {
    if tenant_id.trim().is_empty() {
        return Err(StockTransferError::EmptyTenantId);
    }
    let trimmed_unit_id = unit_id.trim();
    if trimmed_unit_id.is_empty() {
        return Err(StockTransferError::UnitNotFound);
    }

    // T-04: quantity > 0
    if quantity <= 0.0 || quantity.is_nan() || quantity.is_infinite() {
        return Err(StockTransferError::InvalidQuantity);
    }

    let status: String = {
        let mut stmt =
            conn.prepare("SELECT status FROM stock_transfers WHERE id = ?1 AND tenant_id = ?2")?;
        stmt.query_row(params![transfer_id, tenant_id], |row| row.get(0))
            .map_err(|_| StockTransferError::TransferNotFound)?
    };

    if status != "draft" {
        return Err(StockTransferError::NotDraftForLineAdd(status));
    }

    // T-03: Validate unit belongs to tenant
    let snapshot = resolve_unit_snapshot(conn, tenant_id, trimmed_unit_id)
        .map_err(|_| StockTransferError::UnitNotFound)?;

    let tx = conn.transaction()?;

    // Check duplicate unit in the same transfer
    let is_dup: bool = tx
        .query_row(
            "SELECT 1 FROM stock_transfer_lines WHERE transfer_id = ?1 AND unit_id = ?2",
            params![transfer_id, trimmed_unit_id],
            |_| Ok(true),
        )
        .unwrap_or(false);

    if is_dup {
        return Err(StockTransferError::DuplicateUnit);
    }

    let max_line_no: i64 = tx.query_row(
        "SELECT COALESCE(MAX(line_no), 0) FROM stock_transfer_lines WHERE transfer_id = ?1",
        params![transfer_id],
        |r| r.get(0),
    )?;

    let now = current_timestamp();
    let line_id = format!(
        "trfl_{}_{}",
        now,
        TRFL_ID_COUNTER.fetch_add(1, Ordering::SeqCst)
    );

    tx.execute(
        "INSERT INTO stock_transfer_lines (
            id, transfer_id, line_no, unit_id, quantity,
            product_name_snapshot, variant_name_snapshot, sku_snapshot,
            unit_name_snapshot, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            line_id,
            transfer_id,
            max_line_no + 1,
            trimmed_unit_id,
            quantity,
            snapshot.product_name,
            snapshot.variant_name,
            snapshot.sku,
            snapshot.unit_name,
            now
        ],
    )?;

    tx.commit()?;

    get_stock_transfer_impl(conn, tenant_id, transfer_id)
}

pub fn update_stock_transfer_line_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    line_id: &str,
    quantity: f64,
) -> Result<StockTransferDetail, StockTransferError> {
    if tenant_id.trim().is_empty() {
        return Err(StockTransferError::EmptyTenantId);
    }

    // T-04: quantity > 0
    if quantity <= 0.0 || quantity.is_nan() || quantity.is_infinite() {
        return Err(StockTransferError::InvalidQuantity);
    }

    let (transfer_id, status): (String, String) = {
        let mut stmt = conn.prepare(
            "SELECT t.id, t.status 
             FROM stock_transfer_lines l 
             JOIN stock_transfers t ON l.transfer_id = t.id 
             WHERE l.id = ?1 AND t.tenant_id = ?2",
        )?;
        stmt.query_row(params![line_id, tenant_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map_err(|_| StockTransferError::LineNotFound)?
    };

    if status != "draft" {
        return Err(StockTransferError::NotDraftForLineEdit(status));
    }

    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE stock_transfer_lines SET quantity = ?1 WHERE id = ?2",
        params![quantity, line_id],
    )?;
    tx.commit()?;

    get_stock_transfer_impl(conn, tenant_id, &transfer_id)
}

pub fn remove_stock_transfer_line_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    line_id: &str,
) -> Result<StockTransferDetail, StockTransferError> {
    if tenant_id.trim().is_empty() {
        return Err(StockTransferError::EmptyTenantId);
    }

    let (transfer_id, status): (String, String) = {
        let mut stmt = conn.prepare(
            "SELECT t.id, t.status 
             FROM stock_transfer_lines l 
             JOIN stock_transfers t ON l.transfer_id = t.id 
             WHERE l.id = ?1 AND t.tenant_id = ?2",
        )?;
        stmt.query_row(params![line_id, tenant_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map_err(|_| StockTransferError::LineNotFound)?
    };

    if status != "draft" {
        return Err(StockTransferError::NotDraftForLineRemove(status));
    }

    let tx = conn.transaction()?;
    tx.execute(
        "DELETE FROM stock_transfer_lines WHERE id = ?1",
        params![line_id],
    )?;

    // Re-index remaining lines
    let remaining_ids: Vec<String> = {
        let mut stmt = tx.prepare(
            "SELECT id FROM stock_transfer_lines WHERE transfer_id = ?1 ORDER BY line_no ASC",
        )?;
        let rows = stmt.query_map(params![transfer_id], |r| r.get(0))?;
        let mut ids = Vec::new();
        for r in rows {
            ids.push(r?);
        }
        ids
    };

    for (idx, rid) in remaining_ids.iter().enumerate() {
        tx.execute(
            "UPDATE stock_transfer_lines SET line_no = ?1 WHERE id = ?2",
            params![(idx + 1) as i64, rid],
        )?;
    }

    tx.commit()?;

    get_stock_transfer_impl(conn, tenant_id, &transfer_id)
}

pub fn post_stock_transfer_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    user_id: &str,
    transfer_id: &str,
) -> Result<StockTransferDetail, StockTransferError> {
    if tenant_id.trim().is_empty() {
        return Err(StockTransferError::EmptyTenantId);
    }
    let trimmed_uid = user_id.trim();
    if trimmed_uid.is_empty() {
        return Err(StockTransferError::EmptyUserId);
    }

    let (status, from_wh_id, to_wh_id): (String, String, String) = {
        let mut stmt = conn.prepare(
            "SELECT status, from_warehouse_id, to_warehouse_id 
             FROM stock_transfers WHERE id = ?1 AND tenant_id = ?2",
        )?;
        stmt.query_row(params![transfer_id, tenant_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .map_err(|_| StockTransferError::TransferNotFound)?
    };

    if status != "draft" {
        return Err(StockTransferError::InvalidStateTransition {
            from: status,
            to: "posted".to_string(),
        });
    }

    // T-02: Validate both warehouses active and not equal
    let (from_wh, _to_wh) = validate_transfer_warehouses(conn, tenant_id, &from_wh_id, &to_wh_id)?;

    let now = current_timestamp();
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

    // Idempotency status guard (T-07)
    let affected = tx.execute(
        "UPDATE stock_transfers SET status = 'posted', posted_at = ?1 
         WHERE id = ?2 AND status = 'draft' AND tenant_id = ?3",
        params![now, transfer_id, tenant_id],
    )?;

    crate::ensure_guarded_mutation_affected(
        &tx,
        "stock_transfers",
        transfer_id,
        tenant_id,
        affected,
        StockTransferError::TransferNotFound,
        |s| {
            if s != "draft" {
                Err(StockTransferError::InvalidStateTransition {
                    from: s,
                    to: "posted".to_string(),
                })
            } else {
                Ok(())
            }
        },
    )?;

    // Fetch lines INSIDE transaction
    let lines: Vec<(String, i64, String, f64, String, String, String)> = {
        let mut stmt = tx.prepare(
            "SELECT id, line_no, unit_id, quantity, product_name_snapshot, variant_name_snapshot, unit_name_snapshot 
             FROM stock_transfer_lines WHERE transfer_id = ?1 ORDER BY line_no ASC",
        )?;
        let rows = stmt.query_map(params![transfer_id], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
            ))
        })?;
        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        list
    };

    // T-05: At least 1 line
    if lines.is_empty() {
        return Err(StockTransferError::EmptyLines);
    }

    // T-05: Check inventory in source warehouse and write movements
    for (_, _, unit_id, requested_qty, prod_name, var_name, unit_name) in &lines {
        let current_stock: f64 = tx.query_row(
            "SELECT COALESCE(SUM(quantity_delta), 0.0) 
             FROM inventory_movements 
             WHERE tenant_id = ?1 AND unit_id = ?2 AND warehouse_id = ?3",
            params![tenant_id, unit_id, from_wh_id],
            |r| r.get(0),
        )?;

        // T-05: If current_stock < requested_qty, reject with detailed insufficient stock error
        if current_stock + 1e-9 < *requested_qty {
            return Err(StockTransferError::InsufficientStock(Box::new(
                InsufficientStockDetails {
                    product_name: prod_name.clone(),
                    variant_name: var_name.clone(),
                    unit_name: unit_name.clone(),
                    warehouse_name: from_wh.name.clone(),
                    available_qty: format_qty(current_stock),
                    requested_qty: format_qty(*requested_qty),
                },
            )));
        }

        // T-06: Write two movements in the same transaction
        // Movement 1: Source warehouse (transfer_out, -quantity)
        let mov_id_out = format!(
            "mov_trf_out_{}_{}",
            now,
            TRFL_ID_COUNTER.fetch_add(1, Ordering::SeqCst)
        );
        tx.execute(
            "INSERT INTO inventory_movements (
                id, tenant_id, unit_id, warehouse_id, quantity_delta, unit_cost,
                reason, reference_type, reference_id, created_by, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, 'transfer_out', 'stock_transfer', ?6, ?7, ?8)",
            params![
                mov_id_out,
                tenant_id,
                unit_id,
                from_wh_id,
                -*requested_qty,
                transfer_id,
                trimmed_uid,
                now
            ],
        )?;

        // Movement 2: Destination warehouse (transfer_in, +quantity)
        let mov_id_in = format!(
            "mov_trf_in_{}_{}",
            now,
            TRFL_ID_COUNTER.fetch_add(1, Ordering::SeqCst)
        );
        tx.execute(
            "INSERT INTO inventory_movements (
                id, tenant_id, unit_id, warehouse_id, quantity_delta, unit_cost,
                reason, reference_type, reference_id, created_by, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, 'transfer_in', 'stock_transfer', ?6, ?7, ?8)",
            params![
                mov_id_in,
                tenant_id,
                unit_id,
                to_wh_id,
                *requested_qty,
                transfer_id,
                trimmed_uid,
                now
            ],
        )?;
    }

    tx.commit()?;

    get_stock_transfer_impl(conn, tenant_id, transfer_id)
}

pub fn cancel_stock_transfer_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    user_id: &str,
    transfer_id: &str,
) -> Result<StockTransferDetail, StockTransferError> {
    if tenant_id.trim().is_empty() {
        return Err(StockTransferError::EmptyTenantId);
    }
    let trimmed_uid = user_id.trim();
    if trimmed_uid.is_empty() {
        return Err(StockTransferError::EmptyUserId);
    }

    let status: String = {
        let mut stmt =
            conn.prepare("SELECT status FROM stock_transfers WHERE id = ?1 AND tenant_id = ?2")?;
        stmt.query_row(params![transfer_id, tenant_id], |row| row.get(0))
            .map_err(|_| StockTransferError::TransferNotFound)?
    };

    if status != "draft" {
        return Err(StockTransferError::InvalidStateTransition {
            from: status,
            to: "cancelled".to_string(),
        });
    }

    let now = current_timestamp();
    let tx = conn.transaction()?;
    let affected = tx.execute(
        "UPDATE stock_transfers SET status = 'cancelled', cancelled_at = ?1 
         WHERE id = ?2 AND status = 'draft' AND tenant_id = ?3",
        params![now, transfer_id, tenant_id],
    )?;

    crate::ensure_guarded_mutation_affected(
        &tx,
        "stock_transfers",
        transfer_id,
        tenant_id,
        affected,
        StockTransferError::TransferNotFound,
        |s| {
            if s != "draft" {
                Err(StockTransferError::InvalidStateTransition {
                    from: s,
                    to: "cancelled".to_string(),
                })
            } else {
                Ok(())
            }
        },
    )?;

    tx.commit()?;

    get_stock_transfer_impl(conn, tenant_id, transfer_id)
}

pub fn get_stock_transfer_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    transfer_id: &str,
) -> Result<StockTransferDetail, StockTransferError> {
    if tenant_id.trim().is_empty() {
        return Err(StockTransferError::EmptyTenantId);
    }

    let transfer = {
        let mut stmt = conn.prepare(
            "SELECT id, tenant_id, transfer_number, from_warehouse_id, to_warehouse_id,
                    status, note, created_by, created_at, posted_at, cancelled_at, task_id,
                    (SELECT COUNT(*) FROM stock_transfer_lines WHERE transfer_id = stock_transfers.id) as lines_count
             FROM stock_transfers 
             WHERE id = ?1 AND tenant_id = ?2",
        )?;
        stmt.query_row(params![transfer_id, tenant_id], map_stock_transfer_row)
            .map_err(|_| StockTransferError::TransferNotFound)?
    };

    let lines = {
        let mut stmt = conn.prepare(
            "SELECT id, transfer_id, line_no, unit_id, quantity,
                    product_name_snapshot, variant_name_snapshot, sku_snapshot,
                    unit_name_snapshot, created_at 
             FROM stock_transfer_lines 
             WHERE transfer_id = ?1 
             ORDER BY line_no ASC",
        )?;
        let rows = stmt.query_map(params![transfer_id], map_stock_transfer_line_row)?;
        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        list
    };

    Ok(StockTransferDetail { transfer, lines })
}

pub fn list_stock_transfers_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    status: Option<String>,
    from_warehouse_id: Option<String>,
    to_warehouse_id: Option<String>,
) -> Result<Vec<StockTransfer>, StockTransferError> {
    if tenant_id.trim().is_empty() {
        return Err(StockTransferError::EmptyTenantId);
    }

    let mut query = String::from(
        "SELECT id, tenant_id, transfer_number, from_warehouse_id, to_warehouse_id,
                status, note, created_by, created_at, posted_at, cancelled_at, task_id,
                (SELECT COUNT(*) FROM stock_transfer_lines WHERE transfer_id = stock_transfers.id) as lines_count
         FROM stock_transfers 
         WHERE tenant_id = ?1",
    );
    let mut param_values: Vec<rusqlite::types::Value> =
        vec![rusqlite::types::Value::Text(tenant_id.to_string())];

    if let Some(st) = status {
        let trimmed = st.trim().to_string();
        if !trimmed.is_empty() {
            query.push_str(&format!(" AND status = ?{}", param_values.len() + 1));
            param_values.push(rusqlite::types::Value::Text(trimmed));
        }
    }

    if let Some(f_wh) = from_warehouse_id {
        let trimmed = f_wh.trim().to_string();
        if !trimmed.is_empty() {
            query.push_str(&format!(
                " AND from_warehouse_id = ?{}",
                param_values.len() + 1
            ));
            param_values.push(rusqlite::types::Value::Text(trimmed));
        }
    }

    if let Some(t_wh) = to_warehouse_id {
        let trimmed = t_wh.trim().to_string();
        if !trimmed.is_empty() {
            query.push_str(&format!(
                " AND to_warehouse_id = ?{}",
                param_values.len() + 1
            ));
            param_values.push(rusqlite::types::Value::Text(trimmed));
        }
    }

    query.push_str(" ORDER BY created_at DESC");

    let mut stmt = conn.prepare(&query)?;
    let param_refs: Vec<&dyn rusqlite::ToSql> = param_values
        .iter()
        .map(|v| v as &dyn rusqlite::ToSql)
        .collect();

    let rows = stmt.query_map(param_refs.as_slice(), map_stock_transfer_row)?;
    let mut result = Vec::new();
    for r in rows {
        result.push(r?);
    }
    Ok(result)
}

// ==========================================
// Delivery Layer (Tauri Commands)
// ==========================================

#[tauri::command]
#[specta::specta]
pub async fn create_stock_transfer<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    from_warehouse_id: String,
    to_warehouse_id: String,
    note: Option<String>,
    task_id: Option<String>,
    initial_lines: Option<Vec<CreateStockTransferLineInput>>,
) -> Result<StockTransferDetail, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;
    create_stock_transfer_impl(
        &mut conn,
        &active_tid,
        &active_uid,
        &from_warehouse_id,
        &to_warehouse_id,
        note,
        task_id,
        initial_lines,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn update_stock_transfer_header<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    transfer_id: String,
    from_warehouse_id: Option<String>,
    to_warehouse_id: Option<String>,
    note: Option<Option<String>>,
) -> Result<StockTransferDetail, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    update_stock_transfer_header_impl(
        &mut conn,
        &active_tid,
        &transfer_id,
        from_warehouse_id,
        to_warehouse_id,
        note,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn add_stock_transfer_line<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    transfer_id: String,
    unit_id: String,
    quantity: f64,
) -> Result<StockTransferDetail, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    add_stock_transfer_line_impl(&mut conn, &active_tid, &transfer_id, &unit_id, quantity)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn update_stock_transfer_line<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    line_id: String,
    quantity: f64,
) -> Result<StockTransferDetail, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    update_stock_transfer_line_impl(&mut conn, &active_tid, &line_id, quantity)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn remove_stock_transfer_line<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    line_id: String,
) -> Result<StockTransferDetail, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    remove_stock_transfer_line_impl(&mut conn, &active_tid, &line_id).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn post_stock_transfer<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    transfer_id: String,
) -> Result<StockTransferDetail, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;
    post_stock_transfer_impl(&mut conn, &active_tid, &active_uid, &transfer_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_stock_transfer<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    transfer_id: String,
) -> Result<StockTransferDetail, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;
    cancel_stock_transfer_impl(&mut conn, &active_tid, &active_uid, &transfer_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn get_stock_transfer<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    transfer_id: String,
) -> Result<StockTransferDetail, String> {
    let db_path = get_db_path(&app_handle);
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    get_stock_transfer_impl(&conn, &active_tid, &transfer_id).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn list_stock_transfers<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    status: Option<String>,
    from_warehouse_id: Option<String>,
    to_warehouse_id: Option<String>,
) -> Result<Vec<StockTransfer>, String> {
    let db_path = get_db_path(&app_handle);
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    list_stock_transfers_impl(
        &conn,
        &active_tid,
        status,
        from_warehouse_id,
        to_warehouse_id,
    )
    .map_err(|e| e.to_string())
}

// ==========================================
// Tests
// ==========================================

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn setup_test_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::warehouses::create_warehouses_tables(&conn).unwrap();
        crate::products::create_products_tables(&conn).unwrap();
        crate::purchase_orders::create_purchase_orders_tables(&conn).unwrap();
        crate::warehouses::ensure_warehouse_columns_and_indices(&conn).unwrap();
        create_stock_transfers_tables(&conn).unwrap();

        // Seed tenant & user
        let _ = conn.execute(
            "CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL)",
            [],
        );
        let _ = conn.execute(
            "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL, password TEXT NOT NULL, name TEXT NOT NULL)",
            [],
        );
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
            "INSERT INTO users (id, email, password, name) VALUES ('usr_test', 'user@test.com', 'pwd', 'Test User')",
            [],
        ).unwrap();

        // Seed 2 warehouses in tnt_test
        conn.execute(
            "INSERT INTO warehouses (id, tenant_id, code, name, is_default, is_active, created_at)
             VALUES ('wh_src', 'tnt_test', 'SRC', '來源倉庫', 1, 1, 1000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO warehouses (id, tenant_id, code, name, is_default, is_active, created_at)
             VALUES ('wh_dst', 'tnt_test', 'DST', '目的倉庫', 0, 1, 1000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO warehouses (id, tenant_id, code, name, is_default, is_active, created_at)
             VALUES ('wh_inactive', 'tnt_test', 'INACT', '停用倉', 0, 0, 1000)",
            [],
        )
        .unwrap();

        // Seed products and units via create_product_impl
        let p1 = crate::products::create_product_impl(
            &conn,
            "tnt_test",
            "商品A".to_string(),
            "resale".to_string(),
            None,
            Some("件".to_string()),
            Some(100.0),
        )
        .unwrap();
        let orig_u1 = p1.units[0].id.clone();
        conn.execute(
            "UPDATE product_units SET id = 'unt_1' WHERE id = ?1",
            params![orig_u1],
        )
        .unwrap();

        let p2 = crate::products::create_product_impl(
            &conn,
            "tnt_test",
            "商品B".to_string(),
            "resale".to_string(),
            None,
            Some("箱".to_string()),
            Some(200.0),
        )
        .unwrap();
        let orig_u2 = p2.units[0].id.clone();
        conn.execute(
            "UPDATE product_units SET id = 'unt_2' WHERE id = ?1",
            params![orig_u2],
        )
        .unwrap();
        conn.execute(
            "UPDATE products SET is_purchasable = 0 WHERE id = ?1",
            params![p2.product.id],
        )
        .unwrap();

        // Seed opening balance into wh_src (unt_1: 100, unt_2: 50)
        conn.execute(
            "INSERT INTO inventory_movements (id, tenant_id, unit_id, warehouse_id, quantity_delta, unit_cost, reason, reference_type, reference_id, created_by, created_at)
             VALUES ('mov_init_1', 'tnt_test', 'unt_1', 'wh_src', 100.0, NULL, 'opening_balance', 'initial', 'init_1', 'usr_test', 1000)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO inventory_movements (id, tenant_id, unit_id, warehouse_id, quantity_delta, unit_cost, reason, reference_type, reference_id, created_by, created_at)
             VALUES ('mov_init_2', 'tnt_test', 'unt_2', 'wh_src', 50.0, NULL, 'opening_balance', 'initial', 'init_2', 'usr_test', 1000)",
            [],
        ).unwrap();

        conn
    }

    #[test]
    fn test_tc_trf_n_01_create_draft_transfer_success() {
        // Given: Valid tenant, active user, two distinct active warehouses
        let mut conn = setup_test_db();

        // When: Creating a stock transfer
        let detail = create_stock_transfer_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            "wh_src",
            "wh_dst",
            Some("測試調撥備註".to_string()),
            None,
            Some(vec![CreateStockTransferLineInput {
                unit_id: "unt_1".to_string(),
                quantity: 10.0,
            }]),
        )
        .unwrap();

        // Then: Transfer is draft, sequential TRF-00001, 1 line
        assert_eq!(detail.transfer.transfer_number, "TRF-00001");
        assert_eq!(detail.transfer.status, "draft");
        assert_eq!(detail.transfer.from_warehouse_id, "wh_src");
        assert_eq!(detail.transfer.to_warehouse_id, "wh_dst");
        assert_eq!(detail.transfer.note, Some("測試調撥備註".to_string()));
        assert_eq!(detail.lines.len(), 1);
        assert_eq!(detail.lines[0].unit_id, "unt_1");
        assert_eq!(detail.lines[0].quantity, 10.0);
        assert_eq!(detail.lines[0].line_no, 1);
    }

    #[test]
    fn test_tc_trf_n_02_manage_lines_add_update_remove() {
        // Given: A draft transfer without initial lines
        let mut conn = setup_test_db();
        let detail = create_stock_transfer_impl(
            &mut conn, "tnt_test", "usr_test", "wh_src", "wh_dst", None, None, None,
        )
        .unwrap();
        let trf_id = &detail.transfer.id;

        // When: Adding first line
        let d1 = add_stock_transfer_line_impl(&mut conn, "tnt_test", trf_id, "unt_1", 5.0).unwrap();
        assert_eq!(d1.lines.len(), 1);
        assert_eq!(d1.lines[0].quantity, 5.0);

        // When: Adding second line
        let d2 = add_stock_transfer_line_impl(&mut conn, "tnt_test", trf_id, "unt_2", 8.0).unwrap();
        assert_eq!(d2.lines.len(), 2);
        assert_eq!(d2.lines[1].line_no, 2);

        // When: Updating line 1 quantity
        let line1_id = &d2.lines[0].id;
        let d3 = update_stock_transfer_line_impl(&mut conn, "tnt_test", line1_id, 12.0).unwrap();
        assert_eq!(d3.lines[0].quantity, 12.0);

        // When: Removing line 1
        let d4 = remove_stock_transfer_line_impl(&mut conn, "tnt_test", line1_id).unwrap();
        // Then: Remaining line re-indexed to line_no = 1
        assert_eq!(d4.lines.len(), 1);
        assert_eq!(d4.lines[0].unit_id, "unt_2");
        assert_eq!(d4.lines[0].line_no, 1);
    }

    #[test]
    fn test_tc_trf_n_03_update_header() {
        // Given: A draft transfer
        let mut conn = setup_test_db();
        let detail = create_stock_transfer_impl(
            &mut conn, "tnt_test", "usr_test", "wh_src", "wh_dst", None, None, None,
        )
        .unwrap();
        let trf_id = &detail.transfer.id;

        // When: Updating note and warehouses
        let d1 = update_stock_transfer_header_impl(
            &mut conn,
            "tnt_test",
            trf_id,
            Some("wh_dst".to_string()),
            Some("wh_src".to_string()),
            Some(Some("新備註".to_string())),
        )
        .unwrap();

        // Then: Warehouses swapped and note updated
        assert_eq!(d1.transfer.from_warehouse_id, "wh_dst");
        assert_eq!(d1.transfer.to_warehouse_id, "wh_src");
        assert_eq!(d1.transfer.note, Some("新備註".to_string()));

        // When: Clearing note
        let d2 = update_stock_transfer_header_impl(
            &mut conn,
            "tnt_test",
            trf_id,
            None,
            None,
            Some(None),
        )
        .unwrap();
        assert_eq!(d2.transfer.note, None);
    }

    #[test]
    fn test_tc_trf_n_04_post_transfer_and_ledger_invariance() {
        // Given: Draft transfer from wh_src (100 in stock) to wh_dst (0 in stock), qty = 30
        let mut conn = setup_test_db();
        let detail = create_stock_transfer_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            "wh_src",
            "wh_dst",
            None,
            None,
            Some(vec![CreateStockTransferLineInput {
                unit_id: "unt_1".to_string(),
                quantity: 30.0,
            }]),
        )
        .unwrap();

        // When: Posting the transfer
        let posted =
            post_stock_transfer_impl(&mut conn, "tnt_test", "usr_test", &detail.transfer.id)
                .unwrap();

        // Then: Transfer status is posted
        assert_eq!(posted.transfer.status, "posted");
        assert!(posted.transfer.posted_at.is_some());

        // Check movements: exactly 2 rows created
        let movements: Vec<(String, String, f64, String, String)> = {
            let mut stmt = conn
                .prepare(
                    "SELECT warehouse_id, reason, quantity_delta, reference_type, reference_id 
                     FROM inventory_movements 
                     WHERE reference_id = ?1 
                     ORDER BY reason ASC",
                )
                .unwrap();
            let rows = stmt
                .query_map(params![detail.transfer.id], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
                })
                .unwrap();
            rows.map(|r| r.unwrap()).collect()
        };

        assert_eq!(movements.len(), 2);
        // Destination warehouse: transfer_in +30
        assert_eq!(movements[0].0, "wh_dst");
        assert_eq!(movements[0].1, "transfer_in");
        assert_eq!(movements[0].2, 30.0);
        assert_eq!(movements[0].3, "stock_transfer");
        // Source warehouse: transfer_out -30
        assert_eq!(movements[1].0, "wh_src");
        assert_eq!(movements[1].1, "transfer_out");
        assert_eq!(movements[1].2, -30.0);

        // Check stock levels:
        // wh_src: 100 - 30 = 70
        let stock_src: f64 = conn
            .query_row(
                "SELECT COALESCE(SUM(quantity_delta), 0.0) FROM inventory_movements WHERE tenant_id = 'tnt_test' AND unit_id = 'unt_1' AND warehouse_id = 'wh_src'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stock_src, 70.0);

        // wh_dst: 0 + 30 = 30
        let stock_dst: f64 = conn
            .query_row(
                "SELECT COALESCE(SUM(quantity_delta), 0.0) FROM inventory_movements WHERE tenant_id = 'tnt_test' AND unit_id = 'unt_1' AND warehouse_id = 'wh_dst'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stock_dst, 30.0);

        // Total stock across all warehouses: 70 + 30 = 100 (invariance!)
        let total_stock: f64 = conn
            .query_row(
                "SELECT COALESCE(SUM(quantity_delta), 0.0) FROM inventory_movements WHERE tenant_id = 'tnt_test' AND unit_id = 'unt_1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(total_stock, 100.0);
    }

    #[test]
    fn test_tc_trf_n_05_cancel_draft_transfer() {
        // Given: Draft transfer
        let mut conn = setup_test_db();
        let detail = create_stock_transfer_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            "wh_src",
            "wh_dst",
            None,
            None,
            Some(vec![CreateStockTransferLineInput {
                unit_id: "unt_1".to_string(),
                quantity: 15.0,
            }]),
        )
        .unwrap();

        // When: Cancelling transfer
        let cancelled =
            cancel_stock_transfer_impl(&mut conn, "tnt_test", "usr_test", &detail.transfer.id)
                .unwrap();

        // Then: Status is cancelled, no movements created
        assert_eq!(cancelled.transfer.status, "cancelled");
        assert!(cancelled.transfer.cancelled_at.is_some());

        let mov_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM inventory_movements WHERE reference_id = ?1",
                params![detail.transfer.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(mov_count, 0);
    }

    #[test]
    fn test_tc_trf_n_06_non_purchasable_unit_allowed() {
        // Given: Product unit unt_2 has is_purchasable = 0
        let mut conn = setup_test_db();

        // When: Creating and posting transfer for unt_2
        let detail = create_stock_transfer_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            "wh_src",
            "wh_dst",
            None,
            None,
            Some(vec![CreateStockTransferLineInput {
                unit_id: "unt_2".to_string(),
                quantity: 10.0,
            }]),
        )
        .unwrap();

        let posted =
            post_stock_transfer_impl(&mut conn, "tnt_test", "usr_test", &detail.transfer.id);

        // Then: T-03 does not check is_purchasable, transfer succeeds
        assert!(posted.is_ok());
    }

    #[test]
    fn test_tc_trf_b_01_exact_inventory_clearing() {
        // Given: wh_src has exactly 50 of unt_2
        let mut conn = setup_test_db();
        let detail = create_stock_transfer_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            "wh_src",
            "wh_dst",
            None,
            None,
            Some(vec![CreateStockTransferLineInput {
                unit_id: "unt_2".to_string(),
                quantity: 50.0,
            }]),
        )
        .unwrap();

        // When: Transferring exactly 50.0
        let posted =
            post_stock_transfer_impl(&mut conn, "tnt_test", "usr_test", &detail.transfer.id)
                .unwrap();

        // Then: Succeeded, source remaining stock is 0.0
        assert_eq!(posted.transfer.status, "posted");
        let stock_src: f64 = conn
            .query_row(
                "SELECT COALESCE(SUM(quantity_delta), 0.0) FROM inventory_movements WHERE tenant_id = 'tnt_test' AND unit_id = 'unt_2' AND warehouse_id = 'wh_src'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stock_src, 0.0);
    }

    #[test]
    fn test_tc_trf_b_02_and_b_03_insufficient_stock_boundaries() {
        // Given: wh_src has 100 of unt_1
        let mut conn = setup_test_db();

        // Boundary +0.01
        let d1 = create_stock_transfer_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            "wh_src",
            "wh_dst",
            None,
            None,
            Some(vec![CreateStockTransferLineInput {
                unit_id: "unt_1".to_string(),
                quantity: 100.01,
            }]),
        )
        .unwrap();

        // When: Posting 100.01
        let err1 = post_stock_transfer_impl(&mut conn, "tnt_test", "usr_test", &d1.transfer.id)
            .unwrap_err();

        // Then: Rejected with formatted message T-05
        assert_eq!(
            err1.to_string(),
            "〔商品A／標準／件〕在〔來源倉庫〕現有 100，不足調撥 100.01"
        );

        // Boundary +0.000001 (micro float)
        let d2 = create_stock_transfer_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            "wh_src",
            "wh_dst",
            None,
            None,
            Some(vec![CreateStockTransferLineInput {
                unit_id: "unt_1".to_string(),
                quantity: 100.000001,
            }]),
        )
        .unwrap();

        let err2 = post_stock_transfer_impl(&mut conn, "tnt_test", "usr_test", &d2.transfer.id)
            .unwrap_err();
        assert_eq!(
            err2.to_string(),
            "〔商品A／標準／件〕在〔來源倉庫〕現有 100，不足調撥 100.000001"
        );
    }

    #[test]
    fn test_tc_trf_b_04_and_b_05_quantity_zero_and_negative() {
        // Given: Database setup
        let mut conn = setup_test_db();

        // Zero quantity
        let err_zero = create_stock_transfer_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            "wh_src",
            "wh_dst",
            None,
            None,
            Some(vec![CreateStockTransferLineInput {
                unit_id: "unt_1".to_string(),
                quantity: 0.0,
            }]),
        )
        .unwrap_err();
        assert_eq!(err_zero, StockTransferError::InvalidQuantity);

        // Negative quantity
        let err_neg = create_stock_transfer_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            "wh_src",
            "wh_dst",
            None,
            None,
            Some(vec![CreateStockTransferLineInput {
                unit_id: "unt_1".to_string(),
                quantity: -5.0,
            }]),
        )
        .unwrap_err();
        assert_eq!(err_neg, StockTransferError::InvalidQuantity);
    }

    #[test]
    fn test_tc_trf_e_01_and_e_02_empty_tenant_and_user() {
        let mut conn = setup_test_db();

        let err_tid = create_stock_transfer_impl(
            &mut conn, "", "usr_test", "wh_src", "wh_dst", None, None, None,
        )
        .unwrap_err();
        assert_eq!(err_tid, StockTransferError::EmptyTenantId);

        let err_uid = create_stock_transfer_impl(
            &mut conn, "tnt_test", "  ", "wh_src", "wh_dst", None, None, None,
        )
        .unwrap_err();
        assert_eq!(err_uid, StockTransferError::EmptyUserId);
    }

    #[test]
    fn test_tc_trf_e_03_same_warehouse_rejected() {
        // Given: from_warehouse_id == to_warehouse_id
        let mut conn = setup_test_db();

        // When: Creating transfer with same warehouses
        let err = create_stock_transfer_impl(
            &mut conn, "tnt_test", "usr_test", "wh_src", "wh_src", None, None, None,
        )
        .unwrap_err();

        // Then: T-02 rejected
        assert_eq!(err, StockTransferError::SameWarehouse);
    }

    #[test]
    fn test_tc_trf_e_04_and_e_05_invalid_and_inactive_warehouses() {
        let mut conn = setup_test_db();

        // Non-existent warehouse
        let err_nonexist = create_stock_transfer_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            "wh_src",
            "wh_nonexistent",
            None,
            None,
            None,
        )
        .unwrap_err();
        assert_eq!(
            err_nonexist,
            StockTransferError::WarehouseNotFoundOrInactive
        );

        // Deactivated warehouse
        let err_inactive = create_stock_transfer_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            "wh_src",
            "wh_inactive",
            None,
            None,
            None,
        )
        .unwrap_err();
        assert_eq!(
            err_inactive,
            StockTransferError::WarehouseNotFoundOrInactive
        );
    }

    #[test]
    fn test_tc_trf_e_06_post_empty_lines_rejected() {
        // Given: Draft transfer with 0 lines
        let mut conn = setup_test_db();
        let detail = create_stock_transfer_impl(
            &mut conn, "tnt_test", "usr_test", "wh_src", "wh_dst", None, None, None,
        )
        .unwrap();

        // When: Posting empty transfer
        let err = post_stock_transfer_impl(&mut conn, "tnt_test", "usr_test", &detail.transfer.id)
            .unwrap_err();

        // Then: T-05 requires at least 1 line
        assert_eq!(err, StockTransferError::EmptyLines);
    }

    #[test]
    fn test_tc_trf_e_07_duplicate_unit_in_same_transfer() {
        // Given: Transfer with unt_1
        let mut conn = setup_test_db();
        let detail = create_stock_transfer_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            "wh_src",
            "wh_dst",
            None,
            None,
            Some(vec![CreateStockTransferLineInput {
                unit_id: "unt_1".to_string(),
                quantity: 10.0,
            }]),
        )
        .unwrap();

        // When: Adding unt_1 again
        let err =
            add_stock_transfer_line_impl(&mut conn, "tnt_test", &detail.transfer.id, "unt_1", 5.0)
                .unwrap_err();

        // Then: T-03 rejects duplicate unit
        assert_eq!(err, StockTransferError::DuplicateUnit);
    }

    #[test]
    fn test_tc_trf_e_08_multi_line_atomicity_one_insufficient_fails_all() {
        // Given: unt_1 has 100, unt_2 has 50. Line 1: unt_1 requested 30 (sufficient). Line 2: unt_2 requested 60 (insufficient).
        let mut conn = setup_test_db();
        let detail = create_stock_transfer_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            "wh_src",
            "wh_dst",
            None,
            None,
            Some(vec![
                CreateStockTransferLineInput {
                    unit_id: "unt_1".to_string(),
                    quantity: 30.0,
                },
                CreateStockTransferLineInput {
                    unit_id: "unt_2".to_string(),
                    quantity: 60.0,
                },
            ]),
        )
        .unwrap();

        // When: Posting
        let err = post_stock_transfer_impl(&mut conn, "tnt_test", "usr_test", &detail.transfer.id)
            .unwrap_err();

        // Then: Error returned for unt_2
        assert_eq!(
            err.to_string(),
            "〔商品B／標準／箱〕在〔來源倉庫〕現有 50，不足調撥 60"
        );

        // Verify atomicity: NO movements written at all!
        let mov_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM inventory_movements WHERE reference_id = ?1",
                params![detail.transfer.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(mov_count, 0);

        // Status remains draft
        let current_detail =
            get_stock_transfer_impl(&conn, "tnt_test", &detail.transfer.id).unwrap();
        assert_eq!(current_detail.transfer.status, "draft");
    }

    #[test]
    fn test_tc_trf_e_09_to_e_13_state_transitions_and_idempotency() {
        // Given: Posted transfer and cancelled transfer
        let mut conn = setup_test_db();
        let d_post = create_stock_transfer_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            "wh_src",
            "wh_dst",
            None,
            None,
            Some(vec![CreateStockTransferLineInput {
                unit_id: "unt_1".to_string(),
                quantity: 10.0,
            }]),
        )
        .unwrap();
        let post_id = d_post.transfer.id.clone();
        post_stock_transfer_impl(&mut conn, "tnt_test", "usr_test", &post_id).unwrap();

        let d_canc = create_stock_transfer_impl(
            &mut conn, "tnt_test", "usr_test", "wh_src", "wh_dst", None, None, None,
        )
        .unwrap();
        let canc_id = d_canc.transfer.id.clone();
        cancel_stock_transfer_impl(&mut conn, "tnt_test", "usr_test", &canc_id).unwrap();

        // TC-TRF-E-09: Edit posted transfer rejected
        let err_edit_post = update_stock_transfer_header_impl(
            &mut conn,
            "tnt_test",
            &post_id,
            None,
            None,
            Some(Some("abc".to_string())),
        )
        .unwrap_err();
        assert_eq!(
            err_edit_post,
            StockTransferError::NotDraftForHeaderEdit("posted".to_string())
        );

        // TC-TRF-E-10: Edit cancelled transfer rejected
        let err_edit_canc =
            add_stock_transfer_line_impl(&mut conn, "tnt_test", &canc_id, "unt_1", 5.0)
                .unwrap_err();
        assert_eq!(
            err_edit_canc,
            StockTransferError::NotDraftForLineAdd("cancelled".to_string())
        );

        // TC-TRF-E-11: Idempotent re-post rejected
        let err_repost =
            post_stock_transfer_impl(&mut conn, "tnt_test", "usr_test", &post_id).unwrap_err();
        assert_eq!(
            err_repost,
            StockTransferError::InvalidStateTransition {
                from: "posted".to_string(),
                to: "posted".to_string(),
            }
        );

        // TC-TRF-E-12: Cancel posted transfer rejected
        let err_canc_post =
            cancel_stock_transfer_impl(&mut conn, "tnt_test", "usr_test", &post_id).unwrap_err();
        assert_eq!(
            err_canc_post,
            StockTransferError::InvalidStateTransition {
                from: "posted".to_string(),
                to: "cancelled".to_string(),
            }
        );

        // TC-TRF-E-13: Post cancelled transfer rejected
        let err_post_canc =
            post_stock_transfer_impl(&mut conn, "tnt_test", "usr_test", &canc_id).unwrap_err();
        assert_eq!(
            err_post_canc,
            StockTransferError::InvalidStateTransition {
                from: "cancelled".to_string(),
                to: "posted".to_string(),
            }
        );
    }

    #[test]
    fn test_tc_trf_e_14_tenant_isolation() {
        // Given: Transfer created in tnt_test
        let mut conn = setup_test_db();
        let detail = create_stock_transfer_impl(
            &mut conn, "tnt_test", "usr_test", "wh_src", "wh_dst", None, None, None,
        )
        .unwrap();

        // When: Accessing from tnt_other
        let err_get = get_stock_transfer_impl(&conn, "tnt_other", &detail.transfer.id).unwrap_err();
        assert_eq!(err_get, StockTransferError::TransferNotFound);

        let list_other = list_stock_transfers_impl(&conn, "tnt_other", None, None, None).unwrap();
        assert_eq!(list_other.len(), 0);
    }

    #[test]
    fn test_tc_trf_ensure_guarded_mutation_affected_stock_transfers_whitelisted() {
        // Given: A stock transfer in posted state
        let mut conn = setup_test_db();
        let detail = create_stock_transfer_impl(
            &mut conn, "tnt_test", "usr_test", "wh_src", "wh_dst", None, None, None,
        )
        .unwrap();
        add_stock_transfer_line_impl(&mut conn, "tnt_test", &detail.transfer.id, "unt_1", 5.0)
            .unwrap();
        post_stock_transfer_impl(&mut conn, "tnt_test", "usr_test", &detail.transfer.id).unwrap();

        // When: Mutation affected is 0 for the posted transfer (simulating concurrent state change)
        let res_posted = crate::ensure_guarded_mutation_affected(
            &conn,
            "stock_transfers",
            &detail.transfer.id,
            "tnt_test",
            0,
            StockTransferError::TransferNotFound,
            |s| {
                if s != "draft" {
                    Err(StockTransferError::InvalidStateTransition {
                        from: s,
                        to: "posted".to_string(),
                    })
                } else {
                    Ok(())
                }
            },
        );

        // Then: Correctly returns InvalidStateTransition from closure instead of TransferNotFound
        assert_eq!(
            res_posted,
            Err(StockTransferError::InvalidStateTransition {
                from: "posted".to_string(),
                to: "posted".to_string(),
            })
        );

        // When: Mutation affected is 0 for a non-existent transfer
        let res_nonexistent = crate::ensure_guarded_mutation_affected(
            &conn,
            "stock_transfers",
            "trf_nonexistent",
            "tnt_test",
            0,
            StockTransferError::TransferNotFound,
            |_| Ok(()),
        );

        // Then: Correctly returns TransferNotFound
        assert_eq!(res_nonexistent, Err(StockTransferError::TransferNotFound));
    }
}
