use crate::get_db_path;
use rusqlite::params;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static ADJ_ID_COUNTER: AtomicU64 = AtomicU64::new(1000);

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
pub struct InventoryAdjustment {
    pub id: String,
    pub tenant_id: String,
    pub adjustment_number: String,
    pub warehouse_id: String,
    pub reason_code: String,
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
pub struct InventoryAdjustmentLine {
    pub id: String,
    pub adjustment_id: String,
    pub line_no: i64,
    pub unit_id: String,
    pub quantity_delta: f64,
    pub product_name_snapshot: String,
    pub variant_name_snapshot: String,
    pub sku_snapshot: Option<String>,
    pub unit_name_snapshot: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq)]
pub struct InventoryAdjustmentDetail {
    pub adjustment: InventoryAdjustment,
    pub lines: Vec<InventoryAdjustmentLine>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq)]
pub struct CreateInventoryAdjustmentLineInput {
    pub unit_id: String,
    pub quantity_delta: f64,
}

// ==========================================
// Table Creation
// ==========================================

pub fn create_inventory_adjustments_tables(
    conn: &rusqlite::Connection,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS inventory_adjustments (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            adjustment_number TEXT NOT NULL,
            warehouse_id TEXT NOT NULL,
            reason_code TEXT NOT NULL,
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
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_adj_tenant_number ON inventory_adjustments (tenant_id, adjustment_number)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_adj_tenant ON inventory_adjustments (tenant_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_adj_tenant_warehouse ON inventory_adjustments (tenant_id, warehouse_id)",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS inventory_adjustment_lines (
            id TEXT PRIMARY KEY,
            adjustment_id TEXT NOT NULL,
            line_no INTEGER NOT NULL,
            unit_id TEXT NOT NULL,
            quantity_delta REAL NOT NULL,
            product_name_snapshot TEXT NOT NULL,
            variant_name_snapshot TEXT NOT NULL,
            sku_snapshot TEXT,
            unit_name_snapshot TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_adjl_adjustment ON inventory_adjustment_lines (adjustment_id)",
        [],
    )?;

    Ok(())
}

// ==========================================
// ==========================================
// Errors
// ==========================================

#[derive(Debug, PartialEq, Clone)]
pub struct NegativeStockDetails {
    pub product_name: String,
    pub variant_name: String,
    pub unit_name: String,
    pub warehouse_name: String,
    pub current_qty: String,
    pub new_qty: String,
}

impl std::fmt::Display for NegativeStockDetails {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "〔{}／{}／{}〕在〔{}〕現有 {}，調整後將為 {}（負數），無法過帳",
            self.product_name,
            self.variant_name,
            self.unit_name,
            self.warehouse_name,
            self.current_qty,
            self.new_qty
        )
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Clone)]
pub enum InventoryAdjustmentError {
    #[error("Tenant ID cannot be empty")]
    EmptyTenantId,

    #[error("無法解析有效使用者 session，操作被拒絕")]
    EmptyUserId,

    #[error("找不到倉別或倉別已停用")]
    WarehouseNotFoundOrInactive,

    #[error("請選擇調整原因")]
    InvalidReasonCode,

    #[error("原因為其他時須填寫說明")]
    OtherReasonRequiresNote,

    #[error("找不到指定的商品單位 (unit_id) 或不屬於目前租戶")]
    UnitNotFound,

    #[error("調整數量不可為 0")]
    ZeroQuantityDelta,

    #[error("同一調整單內商品單位不可重複，請修改既有明細")]
    DuplicateUnitInAdjustment,

    #[error("找不到調整單或不屬於目前租戶")]
    AdjustmentNotFound,

    #[error("調整單狀態為 {0}，不允許修改表頭")]
    NotDraftForHeaderEdit(String),

    #[error("調整單狀態為 {0}，僅草稿狀態可新增明細")]
    NotDraftForLineAdd(String),

    #[error("調整單狀態為 {0}，僅草稿狀態可修改明細")]
    NotDraftForLineEdit(String),

    #[error("調整單狀態為 {0}，僅草稿狀態可刪除明細")]
    NotDraftForLineRemove(String),

    #[error("無效的狀態轉換：不可從 {from} 轉換至 {to}")]
    InvalidStateTransition { from: String, to: String },

    #[error("調整單沒有任何明細")]
    EmptyAdjustmentLines,

    #[error("找不到指定的調整單明細行")]
    LineNotFound,

    #[error("{0}")]
    NegativeStock(Box<NegativeStockDetails>),

    #[error("{0}")]
    WarehouseError(String),

    #[error("{0}")]
    DatabaseError(String),
}

impl From<rusqlite::Error> for InventoryAdjustmentError {
    fn from(err: rusqlite::Error) -> Self {
        InventoryAdjustmentError::DatabaseError(err.to_string())
    }
}

// ==========================================
// Helpers
// ==========================================

pub use crate::products::{resolve_unit_snapshot, UnitSnapshot};

const ALLOWED_REASON_CODES: &[&str] = &["damage", "loss", "found", "opening_correction", "other"];

fn validate_reason_and_note(
    reason_code: &str,
    note: Option<&str>,
) -> Result<(), InventoryAdjustmentError> {
    let trimmed_reason = reason_code.trim();
    if !ALLOWED_REASON_CODES.contains(&trimmed_reason) {
        return Err(InventoryAdjustmentError::InvalidReasonCode);
    }
    if trimmed_reason == "other" {
        match note {
            Some(n) if !n.trim().is_empty() => Ok(()),
            _ => Err(InventoryAdjustmentError::OtherReasonRequiresNote),
        }
    } else {
        Ok(())
    }
}

fn next_adj_number(
    tx: &rusqlite::Transaction,
    tenant_id: &str,
) -> Result<String, InventoryAdjustmentError> {
    let mut stmt = tx.prepare(
        "SELECT COALESCE(MAX(CAST(SUBSTR(adjustment_number, 5) AS INTEGER)), 0) + 1 
             FROM inventory_adjustments WHERE tenant_id = ?1",
    )?;
    let next_seq: i64 = stmt.query_row(params![tenant_id], |row| row.get(0))?;
    Ok(format!("ADJ-{:05}", next_seq))
}

// ==========================================
// Usecase Implementations
// ==========================================

#[allow(clippy::too_many_arguments)]
pub fn create_inventory_adjustment_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    user_id: &str,
    warehouse_id: &str,
    reason_code: &str,
    note: Option<String>,
    task_id: Option<String>,
    initial_lines: Option<Vec<CreateInventoryAdjustmentLineInput>>,
) -> Result<InventoryAdjustmentDetail, InventoryAdjustmentError> {
    if tenant_id.trim().is_empty() {
        return Err(InventoryAdjustmentError::EmptyTenantId);
    }
    let trimmed_uid = user_id.trim();
    if trimmed_uid.is_empty() {
        return Err(InventoryAdjustmentError::EmptyUserId);
    }

    let trimmed_wh = warehouse_id.trim();
    if trimmed_wh.is_empty() {
        return Err(InventoryAdjustmentError::WarehouseNotFoundOrInactive);
    }

    // A-02: Warehouse validation (W-04)
    crate::warehouses::validate_warehouse_active(conn, tenant_id, trimmed_wh).map_err(|e| {
        if e == "找不到倉別或倉別已停用" {
            InventoryAdjustmentError::WarehouseNotFoundOrInactive
        } else {
            InventoryAdjustmentError::WarehouseError(e)
        }
    })?;

    // A-03: Reason code & note validation
    validate_reason_and_note(reason_code, note.as_deref())?;

    let now = current_timestamp();
    let adj_id = format!(
        "adj_{}_{}",
        now,
        ADJ_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    );

    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

    let adj_num = next_adj_number(&tx, tenant_id)?;

    tx.execute(
        "INSERT INTO inventory_adjustments (
            id, tenant_id, adjustment_number, warehouse_id, reason_code,
            status, note, created_by, created_at, posted_at, cancelled_at, task_id
        ) VALUES (?1, ?2, ?3, ?4, ?5, 'draft', ?6, ?7, ?8, NULL, NULL, ?9)",
        params![
            adj_id,
            tenant_id,
            adj_num,
            trimmed_wh,
            reason_code.trim(),
            note.as_deref().map(|s| s.trim()),
            trimmed_uid,
            now,
            task_id
        ],
    )?;

    let mut lines = Vec::new();
    if let Some(items) = initial_lines {
        let mut seen_units = std::collections::HashSet::new();
        for (idx, item) in items.into_iter().enumerate() {
            let unit_id = item.unit_id.trim();
            if unit_id.is_empty() {
                return Err(InventoryAdjustmentError::UnitNotFound);
            }

            // A-05: Delta cannot be 0
            if item.quantity_delta.abs() < 1e-9 {
                return Err(InventoryAdjustmentError::ZeroQuantityDelta);
            }

            // A-06: No duplicate unit_id
            if !seen_units.insert(unit_id.to_string()) {
                return Err(InventoryAdjustmentError::DuplicateUnitInAdjustment);
            }

            // A-04 & A-07: Snapshot
            let snapshot = resolve_unit_snapshot(&tx, tenant_id, unit_id)
                .map_err(|_| InventoryAdjustmentError::UnitNotFound)?;

            let line_id = format!(
                "adjl_{}_{}",
                now,
                ADJ_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
            );

            tx.execute(
                "INSERT INTO inventory_adjustment_lines (
                    id, adjustment_id, line_no, unit_id, quantity_delta,
                    product_name_snapshot, variant_name_snapshot, sku_snapshot,
                    unit_name_snapshot, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    line_id,
                    adj_id,
                    (idx + 1) as i64,
                    unit_id,
                    item.quantity_delta,
                    snapshot.product_name,
                    snapshot.variant_name,
                    snapshot.sku,
                    snapshot.unit_name,
                    now
                ],
            )?;

            lines.push(InventoryAdjustmentLine {
                id: line_id,
                adjustment_id: adj_id.clone(),
                line_no: (idx + 1) as i64,
                unit_id: unit_id.to_string(),
                quantity_delta: item.quantity_delta,
                product_name_snapshot: snapshot.product_name,
                variant_name_snapshot: snapshot.variant_name,
                sku_snapshot: snapshot.sku,
                unit_name_snapshot: snapshot.unit_name,
                created_at: now,
            });
        }
    }

    tx.commit()?;

    get_inventory_adjustment_impl(conn, tenant_id, &adj_id)
}

pub fn update_inventory_adjustment_header_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    adjustment_id: &str,
    warehouse_id: Option<String>,
    reason_code: Option<String>,
    note: Option<Option<String>>,
) -> Result<InventoryAdjustmentDetail, InventoryAdjustmentError> {
    if tenant_id.trim().is_empty() {
        return Err(InventoryAdjustmentError::EmptyTenantId);
    }

    let (status, current_wh, current_reason, current_note): (
        String,
        String,
        String,
        Option<String>,
    ) = {
        let mut stmt = conn
            .prepare("SELECT status, warehouse_id, reason_code, note FROM inventory_adjustments WHERE id = ?1 AND tenant_id = ?2")?;
        stmt.query_row(params![adjustment_id, tenant_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .map_err(|_| InventoryAdjustmentError::AdjustmentNotFound)?
    };

    if status != "draft" {
        return Err(InventoryAdjustmentError::NotDraftForHeaderEdit(status));
    }

    let target_wh = warehouse_id.as_deref().unwrap_or(&current_wh);
    let target_reason = reason_code.as_deref().unwrap_or(&current_reason);
    let target_note = match note {
        Some(ref opt_n) => opt_n.as_deref(),
        None => current_note.as_deref(),
    };

    // A-02: Warehouse validation
    crate::warehouses::validate_warehouse_active(conn, tenant_id, target_wh).map_err(|e| {
        if e == "找不到倉別或倉別已停用" {
            InventoryAdjustmentError::WarehouseNotFoundOrInactive
        } else {
            InventoryAdjustmentError::WarehouseError(e)
        }
    })?;

    // A-03: Reason & Note validation
    validate_reason_and_note(target_reason, target_note)?;

    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

    if let Some(ref wh) = warehouse_id {
        tx.execute(
            "UPDATE inventory_adjustments SET warehouse_id = ?1 WHERE id = ?2 AND tenant_id = ?3",
            params![wh.trim(), adjustment_id, tenant_id],
        )?;
    }

    if let Some(ref rc) = reason_code {
        tx.execute(
            "UPDATE inventory_adjustments SET reason_code = ?1 WHERE id = ?2 AND tenant_id = ?3",
            params![rc.trim(), adjustment_id, tenant_id],
        )?;
    }

    if let Some(ref n) = note {
        tx.execute(
            "UPDATE inventory_adjustments SET note = ?1 WHERE id = ?2 AND tenant_id = ?3",
            params![n.as_deref().map(|s| s.trim()), adjustment_id, tenant_id],
        )?;
    }

    tx.commit()?;

    get_inventory_adjustment_impl(conn, tenant_id, adjustment_id)
}

pub fn add_inventory_adjustment_line_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    adjustment_id: &str,
    unit_id: &str,
    quantity_delta: f64,
) -> Result<InventoryAdjustmentDetail, InventoryAdjustmentError> {
    if tenant_id.trim().is_empty() {
        return Err(InventoryAdjustmentError::EmptyTenantId);
    }

    let trimmed_uid = unit_id.trim();
    if trimmed_uid.is_empty() {
        return Err(InventoryAdjustmentError::UnitNotFound);
    }

    // A-05: Delta cannot be 0
    if quantity_delta.abs() < 1e-9 {
        return Err(InventoryAdjustmentError::ZeroQuantityDelta);
    }

    let status: String = {
        let mut stmt = conn
            .prepare("SELECT status FROM inventory_adjustments WHERE id = ?1 AND tenant_id = ?2")?;
        stmt.query_row(params![adjustment_id, tenant_id], |row| row.get(0))
            .map_err(|_| InventoryAdjustmentError::AdjustmentNotFound)?
    };

    if status != "draft" {
        return Err(InventoryAdjustmentError::NotDraftForLineAdd(status));
    }

    // A-04 & A-07: Snapshot and unit existence check
    let snapshot = resolve_unit_snapshot(conn, tenant_id, trimmed_uid)
        .map_err(|_| InventoryAdjustmentError::UnitNotFound)?;

    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

    // A-06: Duplicate unit check within adjustment
    let dup_count: i64 = tx.query_row(
        "SELECT COUNT(*) FROM inventory_adjustment_lines WHERE adjustment_id = ?1 AND unit_id = ?2",
        params![adjustment_id, trimmed_uid],
        |r| r.get(0),
    )?;

    if dup_count > 0 {
        return Err(InventoryAdjustmentError::DuplicateUnitInAdjustment);
    }

    let next_line_no: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(line_no), 0) + 1 FROM inventory_adjustment_lines WHERE adjustment_id = ?1",
            params![adjustment_id],
            |r| r.get(0),
        )?;

    let now = current_timestamp();
    let line_id = format!(
        "adjl_{}_{}",
        now,
        ADJ_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    );

    tx.execute(
        "INSERT INTO inventory_adjustment_lines (
            id, adjustment_id, line_no, unit_id, quantity_delta,
            product_name_snapshot, variant_name_snapshot, sku_snapshot,
            unit_name_snapshot, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            line_id,
            adjustment_id,
            next_line_no,
            trimmed_uid,
            quantity_delta,
            snapshot.product_name,
            snapshot.variant_name,
            snapshot.sku,
            snapshot.unit_name,
            now
        ],
    )?;

    tx.commit()?;

    get_inventory_adjustment_impl(conn, tenant_id, adjustment_id)
}

pub fn update_inventory_adjustment_line_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    line_id: &str,
    quantity_delta: f64,
) -> Result<InventoryAdjustmentDetail, InventoryAdjustmentError> {
    if tenant_id.trim().is_empty() {
        return Err(InventoryAdjustmentError::EmptyTenantId);
    }

    if quantity_delta.abs() < 1e-9 {
        return Err(InventoryAdjustmentError::ZeroQuantityDelta);
    }

    let (adjustment_id, status): (String, String) = {
        let mut stmt = conn.prepare(
            "SELECT a.id, a.status 
                 FROM inventory_adjustments a
                 JOIN inventory_adjustment_lines l ON a.id = l.adjustment_id
                 WHERE l.id = ?1 AND a.tenant_id = ?2",
        )?;
        stmt.query_row(params![line_id, tenant_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map_err(|_| InventoryAdjustmentError::LineNotFound)?
    };

    if status != "draft" {
        return Err(InventoryAdjustmentError::NotDraftForLineEdit(status));
    }

    conn.execute(
        "UPDATE inventory_adjustment_lines SET quantity_delta = ?1 WHERE id = ?2",
        params![quantity_delta, line_id],
    )?;

    get_inventory_adjustment_impl(conn, tenant_id, &adjustment_id)
}

pub fn remove_inventory_adjustment_line_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    line_id: &str,
) -> Result<InventoryAdjustmentDetail, InventoryAdjustmentError> {
    if tenant_id.trim().is_empty() {
        return Err(InventoryAdjustmentError::EmptyTenantId);
    }

    let (adjustment_id, status): (String, String) = {
        let mut stmt = conn.prepare(
            "SELECT a.id, a.status 
                 FROM inventory_adjustments a
                 JOIN inventory_adjustment_lines l ON a.id = l.adjustment_id
                 WHERE l.id = ?1 AND a.tenant_id = ?2",
        )?;
        stmt.query_row(params![line_id, tenant_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map_err(|_| InventoryAdjustmentError::LineNotFound)?
    };

    if status != "draft" {
        return Err(InventoryAdjustmentError::NotDraftForLineRemove(status));
    }

    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

    tx.execute(
        "DELETE FROM inventory_adjustment_lines WHERE id = ?1",
        params![line_id],
    )?;

    // Resequence line_no
    let remaining_ids: Vec<String> = {
        let mut stmt = tx
            .prepare("SELECT id FROM inventory_adjustment_lines WHERE adjustment_id = ?1 ORDER BY line_no ASC, created_at ASC")?;
        let rows = stmt.query_map(params![adjustment_id], |r| r.get(0))?;
        let mut ids = Vec::new();
        for r in rows {
            ids.push(r?);
        }
        ids
    };

    for (idx, rid) in remaining_ids.iter().enumerate() {
        tx.execute(
            "UPDATE inventory_adjustment_lines SET line_no = ?1 WHERE id = ?2",
            params![(idx + 1) as i64, rid],
        )?;
    }

    tx.commit()?;

    get_inventory_adjustment_impl(conn, tenant_id, &adjustment_id)
}

pub fn post_inventory_adjustment_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    user_id: &str,
    adjustment_id: &str,
) -> Result<InventoryAdjustmentDetail, InventoryAdjustmentError> {
    if tenant_id.trim().is_empty() {
        return Err(InventoryAdjustmentError::EmptyTenantId);
    }
    let trimmed_uid = user_id.trim();
    if trimmed_uid.is_empty() {
        return Err(InventoryAdjustmentError::EmptyUserId);
    }

    let (status, warehouse_id): (String, String) = {
        let mut stmt = conn
            .prepare("SELECT status, warehouse_id FROM inventory_adjustments WHERE id = ?1 AND tenant_id = ?2")?;
        stmt.query_row(params![adjustment_id, tenant_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map_err(|_| InventoryAdjustmentError::AdjustmentNotFound)?
    };

    if status != "draft" {
        return Err(InventoryAdjustmentError::InvalidStateTransition {
            from: status,
            to: "posted".to_string(),
        });
    }

    // A-02 / W-04: Validate warehouse
    let wh = crate::warehouses::validate_warehouse_active(conn, tenant_id, &warehouse_id).map_err(
        |e| {
            if e == "找不到倉別或倉別已停用" {
                InventoryAdjustmentError::WarehouseNotFoundOrInactive
            } else {
                InventoryAdjustmentError::WarehouseError(e)
            }
        },
    )?;

    let now = current_timestamp();
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

    // Idempotency status guard
    let affected = tx.execute(
        "UPDATE inventory_adjustments SET status = 'posted', posted_at = ?1 
             WHERE id = ?2 AND status = 'draft' AND tenant_id = ?3",
        params![now, adjustment_id, tenant_id],
    )?;

    crate::ensure_guarded_mutation_affected(
        &tx,
        "inventory_adjustments",
        adjustment_id,
        tenant_id,
        affected,
        InventoryAdjustmentError::AdjustmentNotFound,
        |s| {
            if s != "draft" {
                Err(InventoryAdjustmentError::InvalidStateTransition {
                    from: s,
                    to: "posted".to_string(),
                })
            } else {
                Ok(())
            }
        },
    )?;

    // Fetch lines INSIDE the transaction to guarantee fresh snapshot without race conditions
    let lines: Vec<(String, i64, String, f64, String, String, String)> = {
        let mut lines_stmt = tx.prepare(
            "SELECT id, line_no, unit_id, quantity_delta, product_name_snapshot, variant_name_snapshot, unit_name_snapshot
                 FROM inventory_adjustment_lines WHERE adjustment_id = ?1 ORDER BY line_no ASC",
        )?;

        let rows = lines_stmt.query_map(params![adjustment_id], |r| {
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

    // A-08: At least 1 line
    if lines.is_empty() {
        return Err(InventoryAdjustmentError::EmptyAdjustmentLines);
    }

    // Re-verify A-04 & A-05
    for (_, _, uid, q_delta, _, _, _) in &lines {
        resolve_unit_snapshot(&tx, tenant_id, uid)
            .map_err(|_| InventoryAdjustmentError::UnitNotFound)?;
        if q_delta.abs() < 1e-9 {
            return Err(InventoryAdjustmentError::ZeroQuantityDelta);
        }
    }

    // A-09: Check current stock in transaction and ensure current_qty + quantity_delta >= 0
    for (_, _, uid, q_delta, prod_name, var_name, u_name) in &lines {
        let current_qty: f64 = tx.query_row(
            "SELECT COALESCE(SUM(quantity_delta), 0.0) 
                 FROM inventory_movements 
                 WHERE tenant_id = ?1 AND warehouse_id = ?2 AND unit_id = ?3",
            params![tenant_id, warehouse_id, uid],
            |r| r.get(0),
        )?;

        let new_qty = current_qty + q_delta;
        if new_qty < -1e-6 {
            // A-09 failure
            let cur_str = format_qty(current_qty);
            let new_str = format_qty(new_qty);
            return Err(InventoryAdjustmentError::NegativeStock(Box::new(
                NegativeStockDetails {
                    product_name: prod_name.clone(),
                    variant_name: var_name.clone(),
                    unit_name: u_name.clone(),
                    warehouse_name: wh.name.clone(),
                    current_qty: cur_str,
                    new_qty: new_str,
                },
            )));
        }

        // Insert inventory movement
        let im_id = format!(
            "im_{}_{}",
            now,
            ADJ_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
        );

        tx.execute(
            "INSERT INTO inventory_movements (
                id, tenant_id, unit_id, warehouse_id, quantity_delta, unit_cost, reason, reference_type, reference_id, created_by, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, 'adjustment', 'inventory_adjustment', ?6, ?7, ?8)",
            params![
                im_id,
                tenant_id,
                uid,
                warehouse_id,
                q_delta,
                adjustment_id,
                trimmed_uid,
                now
            ],
        )?;
    }

    tx.commit()?;

    get_inventory_adjustment_impl(conn, tenant_id, adjustment_id)
}

pub fn cancel_inventory_adjustment_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    adjustment_id: &str,
) -> Result<InventoryAdjustmentDetail, InventoryAdjustmentError> {
    if tenant_id.trim().is_empty() {
        return Err(InventoryAdjustmentError::EmptyTenantId);
    }

    let status: String = {
        let mut stmt = conn
            .prepare("SELECT status FROM inventory_adjustments WHERE id = ?1 AND tenant_id = ?2")?;
        stmt.query_row(params![adjustment_id, tenant_id], |row| row.get(0))
            .map_err(|_| InventoryAdjustmentError::AdjustmentNotFound)?
    };

    if status != "draft" {
        return Err(InventoryAdjustmentError::InvalidStateTransition {
            from: status,
            to: "cancelled".to_string(),
        });
    }

    let now = current_timestamp();
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let affected = tx.execute(
        "UPDATE inventory_adjustments SET status = 'cancelled', cancelled_at = ?1 
             WHERE id = ?2 AND status = 'draft' AND tenant_id = ?3",
        params![now, adjustment_id, tenant_id],
    )?;

    crate::ensure_guarded_mutation_affected(
        &tx,
        "inventory_adjustments",
        adjustment_id,
        tenant_id,
        affected,
        InventoryAdjustmentError::AdjustmentNotFound,
        |s| {
            if s != "draft" {
                Err(InventoryAdjustmentError::InvalidStateTransition {
                    from: s,
                    to: "cancelled".to_string(),
                })
            } else {
                Ok(())
            }
        },
    )?;

    tx.commit()?;

    get_inventory_adjustment_impl(conn, tenant_id, adjustment_id)
}

const INVENTORY_ADJUSTMENT_COLUMNS: &str = "
    id, tenant_id, adjustment_number, warehouse_id, reason_code,
    status, note, created_by, created_at, posted_at, cancelled_at, task_id,
    (SELECT COUNT(*) FROM inventory_adjustment_lines WHERE adjustment_id = inventory_adjustments.id)
";

fn map_inventory_adjustment_row(row: &rusqlite::Row) -> rusqlite::Result<InventoryAdjustment> {
    Ok(InventoryAdjustment {
        id: row.get(0)?,
        tenant_id: row.get(1)?,
        adjustment_number: row.get(2)?,
        warehouse_id: row.get(3)?,
        reason_code: row.get(4)?,
        status: row.get(5)?,
        note: row.get(6)?,
        created_by: row.get(7)?,
        created_at: row.get(8)?,
        posted_at: row.get(9)?,
        cancelled_at: row.get(10)?,
        task_id: row.get(11)?,
        lines_count: row.get(12)?,
    })
}

pub fn get_inventory_adjustment_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    adjustment_id: &str,
) -> Result<InventoryAdjustmentDetail, InventoryAdjustmentError> {
    if tenant_id.trim().is_empty() {
        return Err(InventoryAdjustmentError::EmptyTenantId);
    }

    let sql = format!(
        "SELECT {} FROM inventory_adjustments WHERE id = ?1 AND tenant_id = ?2",
        INVENTORY_ADJUSTMENT_COLUMNS
    );
    let mut stmt = conn.prepare(&sql)?;

    let adjustment = stmt
        .query_row(
            params![adjustment_id, tenant_id],
            map_inventory_adjustment_row,
        )
        .map_err(|_| InventoryAdjustmentError::AdjustmentNotFound)?;

    let mut lines_stmt = conn.prepare(
        "SELECT 
                id, adjustment_id, line_no, unit_id, quantity_delta,
                product_name_snapshot, variant_name_snapshot, sku_snapshot,
                unit_name_snapshot, created_at
             FROM inventory_adjustment_lines
             WHERE adjustment_id = ?1
             ORDER BY line_no ASC, created_at ASC",
    )?;

    let lines: Vec<InventoryAdjustmentLine> = lines_stmt
        .query_map(params![adjustment_id], |row| {
            Ok(InventoryAdjustmentLine {
                id: row.get(0)?,
                adjustment_id: row.get(1)?,
                line_no: row.get(2)?,
                unit_id: row.get(3)?,
                quantity_delta: row.get(4)?,
                product_name_snapshot: row.get(5)?,
                variant_name_snapshot: row.get(6)?,
                sku_snapshot: row.get(7)?,
                unit_name_snapshot: row.get(8)?,
                created_at: row.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(InventoryAdjustmentDetail { adjustment, lines })
}

pub fn list_inventory_adjustments_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    filter_status: Option<String>,
    filter_warehouse_id: Option<String>,
) -> Result<Vec<InventoryAdjustment>, InventoryAdjustmentError> {
    if tenant_id.trim().is_empty() {
        return Err(InventoryAdjustmentError::EmptyTenantId);
    }

    let mut query = format!(
        "SELECT {} FROM inventory_adjustments WHERE tenant_id = ?1",
        INVENTORY_ADJUSTMENT_COLUMNS
    );

    let mut sql_params: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(tenant_id.to_string())];

    if let Some(ref st) = filter_status {
        if !st.trim().is_empty() {
            query.push_str(" AND status = ?");
            sql_params.push(Box::new(st.trim().to_string()));
        }
    }

    if let Some(ref wid) = filter_warehouse_id {
        if !wid.trim().is_empty() {
            query.push_str(" AND warehouse_id = ?");
            sql_params.push(Box::new(wid.trim().to_string()));
        }
    }

    query.push_str(" ORDER BY created_at DESC, id DESC");

    let mut stmt = conn.prepare(&query)?;
    let param_refs: Vec<&dyn rusqlite::ToSql> = sql_params.iter().map(|p| p.as_ref()).collect();

    let list_iter = stmt.query_map(param_refs.as_slice(), map_inventory_adjustment_row)?;

    let mut result = Vec::new();
    for item in list_iter {
        result.push(item?);
    }
    Ok(result)
}

// ==========================================
// Delivery Layer (Tauri Commands)
// ==========================================

#[tauri::command]
#[specta::specta]
pub async fn create_inventory_adjustment<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    warehouse_id: String,
    reason_code: String,
    note: Option<String>,
    task_id: Option<String>,
    initial_lines: Option<Vec<CreateInventoryAdjustmentLineInput>>,
) -> Result<InventoryAdjustmentDetail, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;
    create_inventory_adjustment_impl(
        &mut conn,
        &active_tid,
        &active_uid,
        &warehouse_id,
        &reason_code,
        note,
        task_id,
        initial_lines,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn update_inventory_adjustment_header<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    adjustment_id: String,
    warehouse_id: Option<String>,
    reason_code: Option<String>,
    note: Option<Option<String>>,
) -> Result<InventoryAdjustmentDetail, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    update_inventory_adjustment_header_impl(
        &mut conn,
        &active_tid,
        &adjustment_id,
        warehouse_id,
        reason_code,
        note,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn add_inventory_adjustment_line<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    adjustment_id: String,
    unit_id: String,
    quantity_delta: f64,
) -> Result<InventoryAdjustmentDetail, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    add_inventory_adjustment_line_impl(
        &mut conn,
        &active_tid,
        &adjustment_id,
        &unit_id,
        quantity_delta,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn update_inventory_adjustment_line<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    line_id: String,
    quantity_delta: f64,
) -> Result<InventoryAdjustmentDetail, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    update_inventory_adjustment_line_impl(&mut conn, &active_tid, &line_id, quantity_delta)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn remove_inventory_adjustment_line<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    line_id: String,
) -> Result<InventoryAdjustmentDetail, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    remove_inventory_adjustment_line_impl(&mut conn, &active_tid, &line_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn post_inventory_adjustment<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    adjustment_id: String,
) -> Result<InventoryAdjustmentDetail, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;
    post_inventory_adjustment_impl(&mut conn, &active_tid, &active_uid, &adjustment_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_inventory_adjustment<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    adjustment_id: String,
) -> Result<InventoryAdjustmentDetail, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    cancel_inventory_adjustment_impl(&mut conn, &active_tid, &adjustment_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn get_inventory_adjustment<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    adjustment_id: String,
) -> Result<InventoryAdjustmentDetail, String> {
    let db_path = get_db_path(&app_handle);
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    get_inventory_adjustment_impl(&conn, &active_tid, &adjustment_id).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn list_inventory_adjustments<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    status: Option<String>,
    warehouse_id: Option<String>,
) -> Result<Vec<InventoryAdjustment>, String> {
    let db_path = get_db_path(&app_handle);
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    list_inventory_adjustments_impl(&conn, &active_tid, status, warehouse_id)
        .map_err(|e| e.to_string())
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
        create_inventory_adjustments_tables(&conn).unwrap();

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

    #[test]
    fn test_tc_adj_n_01_create_draft_adjustment() {
        // Given: Active tenant and active warehouse
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "WH-01", "主倉").unwrap();

        // When: Creating draft inventory adjustment with reason 'damage'
        let detail = create_inventory_adjustment_impl(
            &mut conn, "tnt_test", "usr_test", &wh.id, "damage", None, None, None,
        )
        .unwrap();

        // Then: Successfully created with ADJ-00001, status is draft
        assert_eq!(detail.adjustment.adjustment_number, "ADJ-00001");
        assert_eq!(detail.adjustment.status, "draft");
        assert_eq!(detail.adjustment.warehouse_id, wh.id);
        assert_eq!(detail.adjustment.reason_code, "damage");
        assert_eq!(detail.adjustment.created_by, "usr_test");
        assert!(detail.lines.is_empty());
    }

    #[test]
    fn test_tc_adj_n_02_create_with_initial_lines() {
        // Given: Active warehouse and two units
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "WH-01", "主倉").unwrap();
        let (_, unit1) = create_test_product(&mut conn, "tnt_test", "商品A", "resale");
        let (_, unit2) = create_test_product(&mut conn, "tnt_test", "商品B", "resale");

        // When: Creating adjustment with initial lines (positive and negative)
        let initial_lines = vec![
            CreateInventoryAdjustmentLineInput {
                unit_id: unit1.clone(),
                quantity_delta: 10.0,
            },
            CreateInventoryAdjustmentLineInput {
                unit_id: unit2.clone(),
                quantity_delta: -5.0,
            },
        ];

        let detail = create_inventory_adjustment_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh.id,
            "loss",
            None,
            None,
            Some(initial_lines),
        )
        .unwrap();

        // Then: Lines created with snapshots and sequential line_no
        assert_eq!(detail.lines.len(), 2);
        assert_eq!(detail.lines[0].line_no, 1);
        assert_eq!(detail.lines[0].unit_id, unit1);
        assert_eq!(detail.lines[0].quantity_delta, 10.0);
        assert_eq!(detail.lines[0].product_name_snapshot, "商品A");

        assert_eq!(detail.lines[1].line_no, 2);
        assert_eq!(detail.lines[1].unit_id, unit2);
        assert_eq!(detail.lines[1].quantity_delta, -5.0);
        assert_eq!(detail.lines[1].product_name_snapshot, "商品B");
    }

    #[test]
    fn test_tc_adj_n_03_reason_other_with_note() {
        // Given: Active warehouse
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "WH-01", "主倉").unwrap();

        // When: Reason is 'other' and note is provided
        let detail = create_inventory_adjustment_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh.id,
            "other",
            Some("特殊報廢備註說明".to_string()),
            None,
            None,
        )
        .unwrap();

        // Then: Creation succeeds with note
        assert_eq!(detail.adjustment.reason_code, "other");
        assert_eq!(detail.adjustment.note.as_deref(), Some("特殊報廢備註說明"));
    }

    #[test]
    fn test_tc_adj_n_04_n_05_n_06_lines_lifecycle() {
        // Given: Draft adjustment
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "WH-01", "主倉").unwrap();
        let (_, unit1) = create_test_product(&mut conn, "tnt_test", "商品A", "resale");
        let (_, unit2) = create_test_product(&mut conn, "tnt_test", "商品B", "resale");

        let detail = create_inventory_adjustment_impl(
            &mut conn, "tnt_test", "usr_test", &wh.id, "damage", None, None, None,
        )
        .unwrap();
        let adj_id = detail.adjustment.id;

        // When: Adding line 1 and line 2 (TC-ADJ-N-04)
        let d1 = add_inventory_adjustment_line_impl(&mut conn, "tnt_test", &adj_id, &unit1, 5.0)
            .unwrap();
        assert_eq!(d1.lines.len(), 1);
        let l1_id = d1.lines[0].id.clone();

        let d2 = add_inventory_adjustment_line_impl(&mut conn, "tnt_test", &adj_id, &unit2, -3.0)
            .unwrap();
        assert_eq!(d2.lines.len(), 2);
        let l2_id = d2.lines[1].id.clone();

        // When: Updating line 1 quantity (TC-ADJ-N-05)
        let d3 = update_inventory_adjustment_line_impl(&mut conn, "tnt_test", &l1_id, 8.5).unwrap();
        assert_eq!(d3.lines[0].quantity_delta, 8.5);

        // When: Removing line 1 (TC-ADJ-N-06)
        let d4 = remove_inventory_adjustment_line_impl(&mut conn, "tnt_test", &l1_id).unwrap();
        // Then: Line 2 becomes line_no 1
        assert_eq!(d4.lines.len(), 1);
        assert_eq!(d4.lines[0].id, l2_id);
        assert_eq!(d4.lines[0].line_no, 1);
    }

    #[test]
    fn test_tc_adj_n_07_update_header() {
        // Given: Draft adjustment and two warehouses
        let mut conn = setup_test_db();
        let wh1 = create_warehouse_impl(&mut conn, "tnt_test", "WH-01", "主倉").unwrap();
        let wh2 = create_warehouse_impl(&mut conn, "tnt_test", "WH-02", "二倉").unwrap();

        let detail = create_inventory_adjustment_impl(
            &mut conn, "tnt_test", "usr_test", &wh1.id, "damage", None, None, None,
        )
        .unwrap();

        // When: Updating header to wh2, found, note
        let updated = update_inventory_adjustment_header_impl(
            &mut conn,
            "tnt_test",
            &detail.adjustment.id,
            Some(wh2.id.clone()),
            Some("found".to_string()),
            Some(Some("尋獲盤盈備註".to_string())),
        )
        .unwrap();

        // Then: Header fields updated
        assert_eq!(updated.adjustment.warehouse_id, wh2.id);
        assert_eq!(updated.adjustment.reason_code, "found");
        assert_eq!(updated.adjustment.note.as_deref(), Some("尋獲盤盈備註"));
    }

    #[test]
    fn test_tc_adj_n_08_n_09_post_and_zero_boundary() {
        // Given: Warehouse with opening inventory = 10
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "WH-01", "主倉").unwrap();
        let (_, unit1) = create_test_product(&mut conn, "tnt_test", "商品A", "resale");

        // Seed initial balance 10 via opening balance
        crate::purchase_orders::record_opening_inventory_balance_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &unit1,
            10.0,
            50.0,
            Some(wh.id.clone()),
        )
        .unwrap();

        // When: Posting adjustment with delta = -10 (TC-ADJ-N-09 boundary: exactly 0)
        let detail = create_inventory_adjustment_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh.id,
            "damage",
            None,
            None,
            Some(vec![CreateInventoryAdjustmentLineInput {
                unit_id: unit1.clone(),
                quantity_delta: -10.0,
            }]),
        )
        .unwrap();

        let posted = post_inventory_adjustment_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &detail.adjustment.id,
        )
        .unwrap();

        // Then: Status is posted, and stock becomes 0
        assert_eq!(posted.adjustment.status, "posted");
        assert!(posted.adjustment.posted_at.is_some());

        let lvl = crate::purchase_orders::get_inventory_level_impl(
            &conn,
            "tnt_test",
            &unit1,
            Some(&wh.id),
        )
        .unwrap();
        assert_eq!(lvl.current_quantity, 0.0);

        // When: Posting adjustment with delta = +15 (TC-ADJ-N-08: normal positive increase)
        let detail2 = create_inventory_adjustment_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh.id,
            "found",
            None,
            None,
            Some(vec![CreateInventoryAdjustmentLineInput {
                unit_id: unit1.clone(),
                quantity_delta: 15.0,
            }]),
        )
        .unwrap();

        let posted2 = post_inventory_adjustment_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &detail2.adjustment.id,
        )
        .unwrap();
        assert_eq!(posted2.adjustment.status, "posted");

        let lvl2 = crate::purchase_orders::get_inventory_level_impl(
            &conn,
            "tnt_test",
            &unit1,
            Some(&wh.id),
        )
        .unwrap();
        assert_eq!(lvl2.current_quantity, 15.0);

        // Verify inventory movement attributes
        let movements = crate::purchase_orders::list_inventory_movements_impl(
            &conn,
            "tnt_test",
            Some(&unit1),
            Some(&wh.id),
        )
        .unwrap();
        assert_eq!(movements.len(), 3);
        let adj_mov = &movements[2];
        assert_eq!(adj_mov.reason, "adjustment");
        assert_eq!(adj_mov.reference_type, "inventory_adjustment");
        assert_eq!(
            adj_mov.reference_id.as_deref(),
            Some(detail2.adjustment.id.as_str())
        );
        assert_eq!(adj_mov.unit_cost, None);
    }

    #[test]
    fn test_tc_adj_n_10_cancel_adjustment() {
        // Given: Draft adjustment
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "WH-01", "主倉").unwrap();
        let detail = create_inventory_adjustment_impl(
            &mut conn, "tnt_test", "usr_test", &wh.id, "damage", None, None, None,
        )
        .unwrap();

        // When: Cancelling adjustment
        let cancelled =
            cancel_inventory_adjustment_impl(&mut conn, "tnt_test", &detail.adjustment.id).unwrap();

        // Then: Status is cancelled and cancelled_at is recorded
        assert_eq!(cancelled.adjustment.status, "cancelled");
        assert!(cancelled.adjustment.cancelled_at.is_some());
    }

    #[test]
    fn test_tc_adj_n_11_list_and_filter() {
        // Given: Two adjustments in different warehouses and statuses
        let mut conn = setup_test_db();
        let wh1 = create_warehouse_impl(&mut conn, "tnt_test", "WH-01", "主倉").unwrap();
        let wh2 = create_warehouse_impl(&mut conn, "tnt_test", "WH-02", "二倉").unwrap();
        let (_, unit1) = create_test_product(&mut conn, "tnt_test", "商品A", "resale");

        let a1 = create_inventory_adjustment_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh1.id,
            "damage",
            None,
            None,
            Some(vec![CreateInventoryAdjustmentLineInput {
                unit_id: unit1.clone(),
                quantity_delta: 5.0,
            }]),
        )
        .unwrap();
        post_inventory_adjustment_impl(&mut conn, "tnt_test", "usr_test", &a1.adjustment.id)
            .unwrap();

        let _a2 = create_inventory_adjustment_impl(
            &mut conn, "tnt_test", "usr_test", &wh2.id, "loss", None, None, None,
        )
        .unwrap();

        // When: Listing with filter status='posted'
        let list_posted =
            list_inventory_adjustments_impl(&conn, "tnt_test", Some("posted".to_string()), None)
                .unwrap();
        assert_eq!(list_posted.len(), 1);
        assert_eq!(list_posted[0].id, a1.adjustment.id);

        // When: Listing with filter warehouse_id=wh2.id
        let list_wh2 =
            list_inventory_adjustments_impl(&conn, "tnt_test", None, Some(wh2.id)).unwrap();
        assert_eq!(list_wh2.len(), 1);
        assert_eq!(list_wh2[0].warehouse_id, list_wh2[0].warehouse_id);
    }

    #[test]
    fn test_tc_adj_n_12_unit_independence() {
        // Given: Warehouse and two units
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "WH-01", "主倉").unwrap();
        let (_, unit1) = create_test_product(&mut conn, "tnt_test", "商品A", "resale");
        let (_, unit2) = create_test_product(&mut conn, "tnt_test", "商品B", "resale");

        // When: Adjusting unit1 +10 and unit2 +20 in separate adjustments
        let a1 = create_inventory_adjustment_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh.id,
            "found",
            None,
            None,
            Some(vec![CreateInventoryAdjustmentLineInput {
                unit_id: unit1.clone(),
                quantity_delta: 10.0,
            }]),
        )
        .unwrap();
        post_inventory_adjustment_impl(&mut conn, "tnt_test", "usr_test", &a1.adjustment.id)
            .unwrap();

        let a2 = create_inventory_adjustment_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh.id,
            "found",
            None,
            None,
            Some(vec![CreateInventoryAdjustmentLineInput {
                unit_id: unit2.clone(),
                quantity_delta: 20.0,
            }]),
        )
        .unwrap();
        post_inventory_adjustment_impl(&mut conn, "tnt_test", "usr_test", &a2.adjustment.id)
            .unwrap();

        // Then: Levels are completely independent
        let lvl1 = crate::purchase_orders::get_inventory_level_impl(
            &conn,
            "tnt_test",
            &unit1,
            Some(&wh.id),
        )
        .unwrap();
        let lvl2 = crate::purchase_orders::get_inventory_level_impl(
            &conn,
            "tnt_test",
            &unit2,
            Some(&wh.id),
        )
        .unwrap();
        assert_eq!(lvl1.current_quantity, 10.0);
        assert_eq!(lvl2.current_quantity, 20.0);
    }

    #[test]
    fn test_tc_adj_n_13_opening_correction_scenario() {
        // Given: Opening balance = 50
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "WH-01", "主倉").unwrap();
        let (_, unit1) = create_test_product(&mut conn, "tnt_test", "商品A", "resale");

        crate::purchase_orders::record_opening_inventory_balance_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &unit1,
            50.0,
            10.0,
            Some(wh.id.clone()),
        )
        .unwrap();

        // When: User uses opening_correction to reduce 15
        let adj = create_inventory_adjustment_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh.id,
            "opening_correction",
            None,
            None,
            Some(vec![CreateInventoryAdjustmentLineInput {
                unit_id: unit1.clone(),
                quantity_delta: -15.0,
            }]),
        )
        .unwrap();
        post_inventory_adjustment_impl(&mut conn, "tnt_test", "usr_test", &adj.adjustment.id)
            .unwrap();

        // Then: SUM is exactly 35
        let lvl = crate::purchase_orders::get_inventory_level_impl(
            &conn,
            "tnt_test",
            &unit1,
            Some(&wh.id),
        )
        .unwrap();
        assert_eq!(lvl.current_quantity, 35.0);
    }

    #[test]
    fn test_tc_adj_n_14_w03_warehouse_deactivation_allowed_when_posted_or_cancelled() {
        // Given: Non-default warehouse with adjustment posted and inventory back to 0
        let mut conn = setup_test_db();
        let _wh_default = create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉").unwrap();
        let wh2 = create_warehouse_impl(&mut conn, "tnt_test", "WH-02", "二倉").unwrap();
        let (_, unit1) = create_test_product(&mut conn, "tnt_test", "商品A", "resale");

        // Adjustment +10 and -10 -> stock 0
        let a1 = create_inventory_adjustment_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh2.id,
            "found",
            None,
            None,
            Some(vec![CreateInventoryAdjustmentLineInput {
                unit_id: unit1.clone(),
                quantity_delta: 10.0,
            }]),
        )
        .unwrap();
        post_inventory_adjustment_impl(&mut conn, "tnt_test", "usr_test", &a1.adjustment.id)
            .unwrap();

        let a2 = create_inventory_adjustment_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh2.id,
            "damage",
            None,
            None,
            Some(vec![CreateInventoryAdjustmentLineInput {
                unit_id: unit1.clone(),
                quantity_delta: -10.0,
            }]),
        )
        .unwrap();
        post_inventory_adjustment_impl(&mut conn, "tnt_test", "usr_test", &a2.adjustment.id)
            .unwrap();

        // When: Deactivating warehouse WH-02 (no active draft adjustments, 0 stock)
        let deact = deactivate_warehouse_impl(&mut conn, "tnt_test", &wh2.id).unwrap();

        // Then: Warehouse is deactivated successfully
        assert!(!deact.is_active);
    }

    #[test]
    fn test_tc_adj_n_15_non_purchasable_product_allowed() {
        // Given: Manufactured product (is_purchasable = 0)
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "WH-01", "主倉").unwrap();
        let (_, mfg_unit) = create_test_product(&mut conn, "tnt_test", "自製零件", "manufactured");

        // When: Creating adjustment for manufactured product
        let adj = create_inventory_adjustment_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh.id,
            "found",
            None,
            None,
            Some(vec![CreateInventoryAdjustmentLineInput {
                unit_id: mfg_unit.clone(),
                quantity_delta: 25.0,
            }]),
        )
        .unwrap();

        let posted =
            post_inventory_adjustment_impl(&mut conn, "tnt_test", "usr_test", &adj.adjustment.id)
                .unwrap();

        // Then: Successful posting, not blocked by is_purchasable check
        assert_eq!(posted.adjustment.status, "posted");
        let lvl = crate::purchase_orders::get_inventory_level_impl(
            &conn,
            "tnt_test",
            &mfg_unit,
            Some(&wh.id),
        )
        .unwrap();
        assert_eq!(lvl.current_quantity, 25.0);
    }

    // ==========================================
    // Error & Boundary Cases
    // ==========================================

    #[test]
    fn test_tc_adj_e_01_empty_tenant_id() {
        // Given: Empty tenant
        let mut conn = setup_test_db();

        // When: Creating adjustment
        let err = create_inventory_adjustment_impl(
            &mut conn, "", "usr_test", "wh_1", "damage", None, None, None,
        )
        .unwrap_err();

        // Then: Rejected with Tenant ID error
        assert_eq!(err, InventoryAdjustmentError::EmptyTenantId);
    }

    #[test]
    fn test_tc_adj_e_02_empty_user_session() {
        // Given: Empty user id
        let mut conn = setup_test_db();

        // When: Creating adjustment
        let err = create_inventory_adjustment_impl(
            &mut conn, "tnt_test", " ", "wh_1", "damage", None, None, None,
        )
        .unwrap_err();

        // Then: Rejected with session error
        assert_eq!(err, InventoryAdjustmentError::EmptyUserId);
    }

    #[test]
    fn test_tc_adj_e_03_non_existent_warehouse() {
        // Given: Non-existent warehouse
        let mut conn = setup_test_db();

        // When: Creating adjustment with fake warehouse
        let err = create_inventory_adjustment_impl(
            &mut conn, "tnt_test", "usr_test", "wh_fake", "damage", None, None, None,
        )
        .unwrap_err();

        // Then: W-04 rejection
        assert_eq!(err, InventoryAdjustmentError::WarehouseNotFoundOrInactive);
    }

    #[test]
    fn test_tc_adj_e_04_deactivated_warehouse() {
        // Given: Deactivated warehouse
        let mut conn = setup_test_db();
        let _wh1 = create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉").unwrap();
        let wh2 = create_warehouse_impl(&mut conn, "tnt_test", "WH-02", "二倉").unwrap();
        deactivate_warehouse_impl(&mut conn, "tnt_test", &wh2.id).unwrap();

        // When: Creating adjustment with deactivated warehouse
        let err = create_inventory_adjustment_impl(
            &mut conn, "tnt_test", "usr_test", &wh2.id, "damage", None, None, None,
        )
        .unwrap_err();

        // Then: W-04 rejection
        assert_eq!(err, InventoryAdjustmentError::WarehouseNotFoundOrInactive);
    }

    #[test]
    fn test_tc_adj_e_05_invalid_reason_code() {
        // Given: Active warehouse
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "WH-01", "主倉").unwrap();

        // When: Creating adjustment with invalid reason
        let err = create_inventory_adjustment_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh.id,
            "invalid_reason",
            None,
            None,
            None,
        )
        .unwrap_err();

        // Then: A-03 rejection
        assert_eq!(err, InventoryAdjustmentError::InvalidReasonCode);
    }

    #[test]
    fn test_tc_adj_e_06_reason_other_requires_note() {
        // Given: Active warehouse
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "WH-01", "主倉").unwrap();

        // When: Reason is 'other' but note is empty
        let err = create_inventory_adjustment_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh.id,
            "other",
            Some("  ".to_string()),
            None,
            None,
        )
        .unwrap_err();

        // Then: A-03 rejection
        assert_eq!(err, InventoryAdjustmentError::OtherReasonRequiresNote);
    }

    #[test]
    fn test_tc_adj_e_07_invalid_or_cross_tenant_unit() {
        // Given: Product in other tenant
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "WH-01", "主倉").unwrap();
        let (_, other_unit) = create_test_product(&mut conn, "tnt_other", "他租戶商品", "resale");

        // When: Adding cross-tenant unit
        let adj = create_inventory_adjustment_impl(
            &mut conn, "tnt_test", "usr_test", &wh.id, "damage", None, None, None,
        )
        .unwrap();
        let err = add_inventory_adjustment_line_impl(
            &mut conn,
            "tnt_test",
            &adj.adjustment.id,
            &other_unit,
            5.0,
        )
        .unwrap_err();

        // Then: A-04 rejection
        assert_eq!(err, InventoryAdjustmentError::UnitNotFound);
    }

    #[test]
    fn test_tc_adj_e_08_e_09_quantity_delta_cannot_be_zero() {
        // Given: Draft adjustment
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "WH-01", "主倉").unwrap();
        let (_, unit1) = create_test_product(&mut conn, "tnt_test", "商品A", "resale");

        let adj = create_inventory_adjustment_impl(
            &mut conn, "tnt_test", "usr_test", &wh.id, "damage", None, None, None,
        )
        .unwrap();

        // When: Adding line with quantity_delta = 0 (TC-ADJ-E-08)
        let err1 = add_inventory_adjustment_line_impl(
            &mut conn,
            "tnt_test",
            &adj.adjustment.id,
            &unit1,
            0.0,
        )
        .unwrap_err();
        assert_eq!(err1, InventoryAdjustmentError::ZeroQuantityDelta);

        // When: Adding valid line then updating to 0 (TC-ADJ-E-09)
        let d = add_inventory_adjustment_line_impl(
            &mut conn,
            "tnt_test",
            &adj.adjustment.id,
            &unit1,
            5.0,
        )
        .unwrap();
        let line_id = d.lines[0].id.clone();

        let err2 = update_inventory_adjustment_line_impl(&mut conn, "tnt_test", &line_id, 0.0)
            .unwrap_err();
        assert_eq!(err2, InventoryAdjustmentError::ZeroQuantityDelta);
    }

    #[test]
    fn test_tc_adj_e_10_duplicate_unit_in_same_adjustment() {
        // Given: Draft adjustment with unit1
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "WH-01", "主倉").unwrap();
        let (_, unit1) = create_test_product(&mut conn, "tnt_test", "商品A", "resale");

        let adj = create_inventory_adjustment_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh.id,
            "damage",
            None,
            None,
            Some(vec![CreateInventoryAdjustmentLineInput {
                unit_id: unit1.clone(),
                quantity_delta: 5.0,
            }]),
        )
        .unwrap();

        // When: Adding unit1 again (A-06)
        let err = add_inventory_adjustment_line_impl(
            &mut conn,
            "tnt_test",
            &adj.adjustment.id,
            &unit1,
            2.0,
        )
        .unwrap_err();

        // Then: Duplicate rejection
        assert_eq!(err, InventoryAdjustmentError::DuplicateUnitInAdjustment);
    }

    #[test]
    fn test_tc_adj_e_11_post_with_zero_lines() {
        // Given: Draft adjustment with no lines
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "WH-01", "主倉").unwrap();
        let adj = create_inventory_adjustment_impl(
            &mut conn, "tnt_test", "usr_test", &wh.id, "damage", None, None, None,
        )
        .unwrap();

        // When: Posting without lines
        let err =
            post_inventory_adjustment_impl(&mut conn, "tnt_test", "usr_test", &adj.adjustment.id)
                .unwrap_err();

        // Then: A-08 rejection
        assert_eq!(err, InventoryAdjustmentError::EmptyAdjustmentLines);
    }

    #[test]
    fn test_tc_adj_e_12_negative_stock_boundary() {
        // Given: Stock is 10
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "WH-01", "主倉").unwrap();
        let (_, unit1) = create_test_product(&mut conn, "tnt_test", "商品A", "resale");

        crate::purchase_orders::record_opening_inventory_balance_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &unit1,
            10.0,
            10.0,
            Some(wh.id.clone()),
        )
        .unwrap();

        // When: Posting delta = -10.01 (results in -0.01)
        let adj = create_inventory_adjustment_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh.id,
            "damage",
            None,
            None,
            Some(vec![CreateInventoryAdjustmentLineInput {
                unit_id: unit1.clone(),
                quantity_delta: -10.01,
            }]),
        )
        .unwrap();

        let err =
            post_inventory_adjustment_impl(&mut conn, "tnt_test", "usr_test", &adj.adjustment.id)
                .unwrap_err();

        // Then: Exact A-09 failure message and typed error
        assert_eq!(
            err,
            InventoryAdjustmentError::NegativeStock(Box::new(NegativeStockDetails {
                product_name: "商品A".to_string(),
                variant_name: "標準".to_string(),
                unit_name: "件".to_string(),
                warehouse_name: "主倉".to_string(),
                current_qty: "10".to_string(),
                new_qty: "-0.01".to_string(),
            }))
        );
        assert_eq!(
            err.to_string(),
            "〔商品A／標準／件〕在〔主倉〕現有 10，調整後將為 -0.01（負數），無法過帳"
        );
    }

    #[test]
    fn test_tc_adj_e_12b_negative_stock_sub_epsilon_boundary() {
        // Given: Stock 1.0 in WH-01
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "WH-01", "主倉").unwrap();
        let (_, unit1) = create_test_product(&mut conn, "tnt_test", "商品A", "resale");

        crate::purchase_orders::record_opening_inventory_balance_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &unit1,
            1.0,
            10.0,
            Some(wh.id.clone()),
        )
        .unwrap();

        // When: Delta is -1.0000011 (sum is -0.0000011 < -1e-6)
        let adj = create_inventory_adjustment_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh.id,
            "damage",
            None,
            None,
            Some(vec![CreateInventoryAdjustmentLineInput {
                unit_id: unit1.clone(),
                quantity_delta: -1.0000011,
            }]),
        )
        .unwrap();

        let err =
            post_inventory_adjustment_impl(&mut conn, "tnt_test", "usr_test", &adj.adjustment.id)
                .unwrap_err();

        assert_eq!(
            err,
            InventoryAdjustmentError::NegativeStock(Box::new(NegativeStockDetails {
                product_name: "商品A".to_string(),
                variant_name: "標準".to_string(),
                unit_name: "件".to_string(),
                warehouse_name: "主倉".to_string(),
                current_qty: "1".to_string(),
                new_qty: "-0.000001".to_string(),
            }))
        );
        assert_eq!(
            err.to_string(),
            "〔商品A／標準／件〕在〔主倉〕現有 1，調整後將為 -0.000001（負數），無法過帳"
        );
    }

    #[test]
    fn test_tc_adj_e_13_multi_line_atomicity_and_partial_failure() {
        // Given: Unit 1 has 10, Unit 2 has 2
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "WH-01", "主倉").unwrap();
        let (_, unit1) = create_test_product(&mut conn, "tnt_test", "商品A", "resale");
        let (_, unit2) = create_test_product(&mut conn, "tnt_test", "商品B", "resale");

        crate::purchase_orders::record_opening_inventory_balance_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &unit1,
            10.0,
            10.0,
            Some(wh.id.clone()),
        )
        .unwrap();
        crate::purchase_orders::record_opening_inventory_balance_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &unit2,
            2.0,
            10.0,
            Some(wh.id.clone()),
        )
        .unwrap();

        // When: Adjustment has line 1 (+5) and line 2 (-5 -> would be -3)
        let adj = create_inventory_adjustment_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh.id,
            "damage",
            None,
            None,
            Some(vec![
                CreateInventoryAdjustmentLineInput {
                    unit_id: unit1.clone(),
                    quantity_delta: 5.0,
                },
                CreateInventoryAdjustmentLineInput {
                    unit_id: unit2.clone(),
                    quantity_delta: -5.0,
                },
            ]),
        )
        .unwrap();

        let err =
            post_inventory_adjustment_impl(&mut conn, "tnt_test", "usr_test", &adj.adjustment.id)
                .unwrap_err();
        assert!(matches!(err, InventoryAdjustmentError::NegativeStock(..)));

        // Then: Entire post rolled back; status is still draft; unit1 stock is still 10
        let reloaded =
            get_inventory_adjustment_impl(&conn, "tnt_test", &adj.adjustment.id).unwrap();
        assert_eq!(reloaded.adjustment.status, "draft");

        let lvl1 = crate::purchase_orders::get_inventory_level_impl(
            &conn,
            "tnt_test",
            &unit1,
            Some(&wh.id),
        )
        .unwrap();
        assert_eq!(lvl1.current_quantity, 10.0);
    }

    #[test]
    fn test_tc_adj_e_14_e_15_e_16_state_machine_and_idempotency() {
        // Given: Posted adjustment
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "WH-01", "主倉").unwrap();
        let (_, unit1) = create_test_product(&mut conn, "tnt_test", "商品A", "resale");

        let adj = create_inventory_adjustment_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh.id,
            "found",
            None,
            None,
            Some(vec![CreateInventoryAdjustmentLineInput {
                unit_id: unit1.clone(),
                quantity_delta: 5.0,
            }]),
        )
        .unwrap();
        post_inventory_adjustment_impl(&mut conn, "tnt_test", "usr_test", &adj.adjustment.id)
            .unwrap();

        // When: Calling post again (TC-ADJ-E-14 double post / idempotency)
        let err_double_post =
            post_inventory_adjustment_impl(&mut conn, "tnt_test", "usr_test", &adj.adjustment.id)
                .unwrap_err();
        assert_eq!(
            err_double_post,
            InventoryAdjustmentError::InvalidStateTransition {
                from: "posted".to_string(),
                to: "posted".to_string(),
            }
        );

        // When: Calling cancel on posted adjustment (TC-ADJ-E-15 posted -> cancelled)
        let err_cancel =
            cancel_inventory_adjustment_impl(&mut conn, "tnt_test", &adj.adjustment.id)
                .unwrap_err();
        assert_eq!(
            err_cancel,
            InventoryAdjustmentError::InvalidStateTransition {
                from: "posted".to_string(),
                to: "cancelled".to_string(),
            }
        );

        // Given: Cancelled adjustment
        let adj_cancel = create_inventory_adjustment_impl(
            &mut conn, "tnt_test", "usr_test", &wh.id, "damage", None, None, None,
        )
        .unwrap();
        cancel_inventory_adjustment_impl(&mut conn, "tnt_test", &adj_cancel.adjustment.id).unwrap();

        // When: Calling post on cancelled adjustment (TC-ADJ-E-16 cancelled -> posted)
        let err_post_canc = post_inventory_adjustment_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &adj_cancel.adjustment.id,
        )
        .unwrap_err();
        assert_eq!(
            err_post_canc,
            InventoryAdjustmentError::InvalidStateTransition {
                from: "cancelled".to_string(),
                to: "posted".to_string(),
            }
        );
    }

    #[test]
    fn test_tc_adj_e_17_e_18_terminal_state_cannot_be_edited() {
        // Given: Posted adjustment and Cancelled adjustment
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "WH-01", "主倉").unwrap();
        let (_, unit1) = create_test_product(&mut conn, "tnt_test", "商品A", "resale");

        let adj_posted = create_inventory_adjustment_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &wh.id,
            "found",
            None,
            None,
            Some(vec![CreateInventoryAdjustmentLineInput {
                unit_id: unit1.clone(),
                quantity_delta: 5.0,
            }]),
        )
        .unwrap();
        post_inventory_adjustment_impl(
            &mut conn,
            "tnt_test",
            "usr_test",
            &adj_posted.adjustment.id,
        )
        .unwrap();

        // When: Editing header of posted adjustment (TC-ADJ-E-17)
        let err_head = update_inventory_adjustment_header_impl(
            &mut conn,
            "tnt_test",
            &adj_posted.adjustment.id,
            None,
            Some("damage".to_string()),
            None,
        )
        .unwrap_err();
        assert_eq!(
            err_head,
            InventoryAdjustmentError::NotDraftForHeaderEdit("posted".to_string())
        );

        // When: Editing lines of posted adjustment
        let err_line = add_inventory_adjustment_line_impl(
            &mut conn,
            "tnt_test",
            &adj_posted.adjustment.id,
            &unit1,
            2.0,
        )
        .unwrap_err();
        assert_eq!(
            err_line,
            InventoryAdjustmentError::NotDraftForLineAdd("posted".to_string())
        );

        // Given: Cancelled adjustment (TC-ADJ-E-18)
        let adj_canc = create_inventory_adjustment_impl(
            &mut conn, "tnt_test", "usr_test", &wh.id, "damage", None, None, None,
        )
        .unwrap();
        cancel_inventory_adjustment_impl(&mut conn, "tnt_test", &adj_canc.adjustment.id).unwrap();

        let err_head_canc = update_inventory_adjustment_header_impl(
            &mut conn,
            "tnt_test",
            &adj_canc.adjustment.id,
            None,
            Some("found".to_string()),
            None,
        )
        .unwrap_err();
        assert_eq!(
            err_head_canc,
            InventoryAdjustmentError::NotDraftForHeaderEdit("cancelled".to_string())
        );
    }

    #[test]
    fn test_tc_adj_e_19_tenant_isolation() {
        // Given: Adjustment in tnt_test
        let mut conn = setup_test_db();
        let wh = create_warehouse_impl(&mut conn, "tnt_test", "WH-01", "主倉").unwrap();
        let adj = create_inventory_adjustment_impl(
            &mut conn, "tnt_test", "usr_test", &wh.id, "damage", None, None, None,
        )
        .unwrap();

        // When: Accessing from tnt_other
        let err_get =
            get_inventory_adjustment_impl(&conn, "tnt_other", &adj.adjustment.id).unwrap_err();
        assert_eq!(err_get, InventoryAdjustmentError::AdjustmentNotFound);

        let err_post =
            post_inventory_adjustment_impl(&mut conn, "tnt_other", "usr_test", &adj.adjustment.id)
                .unwrap_err();
        assert_eq!(err_post, InventoryAdjustmentError::AdjustmentNotFound);
    }

    #[test]
    fn test_tc_adj_e_20_w03_deactivation_blocked_by_draft_adjustment() {
        // Given: Non-default warehouse WH-02 and draft adjustment referencing WH-02
        let mut conn = setup_test_db();
        let _wh1 = create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉").unwrap();
        let wh2 = create_warehouse_impl(&mut conn, "tnt_test", "WH-02", "二倉").unwrap();

        let adj = create_inventory_adjustment_impl(
            &mut conn, "tnt_test", "usr_test", &wh2.id, "damage", None, None, None,
        )
        .unwrap();

        // When: Attempting to deactivate WH-02 (W-03 Extension)
        let err = deactivate_warehouse_impl(&mut conn, "tnt_test", &wh2.id).unwrap_err();

        // Then: Blocked by draft adjustment reference
        assert_eq!(
            err,
            format!(
                "此倉仍被未結案單據引用：{}",
                adj.adjustment.adjustment_number
            )
        );
    }
}
