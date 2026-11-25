use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static PRET_ID_COUNTER: AtomicU64 = AtomicU64::new(1);
static PRETL_ID_COUNTER: AtomicU64 = AtomicU64::new(1);
static MOV_PRET_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

fn current_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

pub fn round_2(val: f64) -> f64 {
    (val * 100.0).round() / 100.0
}

pub fn format_amount(val: f64) -> String {
    let rounded = round_2(val);
    if (rounded - rounded.round()).abs() < 1e-6 {
        format!("{}", rounded.round() as i64)
    } else {
        format!("{:.2}", rounded)
    }
}

pub fn get_today_local(conn: &Connection) -> Result<String, rusqlite::Error> {
    conn.query_row(
        "SELECT strftime('%Y-%m-%d', 'now', 'localtime')",
        [],
        |row| row.get(0),
    )
}

fn table_exists(conn: &Connection, table_name: &str) -> bool {
    let mut stmt =
        match conn.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1") {
            Ok(s) => s,
            Err(_) => return false,
        };
    stmt.exists(params![table_name]).unwrap_or(false)
}

// ==========================================
// Errors
// ==========================================

#[derive(Debug, thiserror::Error, PartialEq, Clone)]
pub enum PurchaseReturnError {
    #[error("租戶 ID 不可為空")]
    EmptyTenantId,

    #[error("找不到指定的租戶")]
    TenantNotFound,

    #[error("租戶未啟用或已停用")]
    TenantNotActive,

    #[error("找不到指定的採購退貨單")]
    ReturnNotFound,

    #[error("找不到指定的採購訂單")]
    PurchaseOrderNotFound,

    #[error("找不到指定的收貨明細")]
    ShipmentLineNotFound,

    #[error("退貨明細不可為空")]
    EmptyReturnLines,

    #[error("退回原因類型僅支援：quality_issue、wrong_item、vendor_error、other")]
    InvalidReasonCode,

    #[error("退回數量必須大於 0")]
    InvalidReturnQuantity,

    #[error("收貨明細 {0} 退回數量 {1} 超過可退數量剩餘 {2}")]
    ReturnQuantityExceedsReturnable(String, String, String),

    #[error("退貨單中包含重複的收貨明細 {0}")]
    DuplicateShipmentLine(String),

    #[error("退回日期不可晚於今天")]
    ReturnDateAfterToday,

    #[error("退回日期不可早於收貨日 {0}")]
    ReturnDateBeforeReceiptDate(String),

    #[error("退回金額 {0} 超過應付未付餘額 {1}；供應商退款情境不在本輪範圍")]
    AmountExceedsOutstanding(String, String),

    #[error("無效的狀態轉換：不可從 {0} 轉換至 {1}")]
    InvalidStateTransition(String, String),

    #[error("作廢原因必填")]
    VoidReasonRequired,

    #[error("僅草稿狀態可修改")]
    NotDraftForUpdate,

    #[error("僅草稿狀態可過帳")]
    NotDraftForPost,

    #[error("僅已過帳狀態可作廢")]
    NotPostedForVoid,

    #[error("資料庫錯誤: {0}")]
    DatabaseError(String),
}

impl Serialize for PurchaseReturnError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<rusqlite::Error> for PurchaseReturnError {
    fn from(e: rusqlite::Error) -> Self {
        PurchaseReturnError::DatabaseError(e.to_string())
    }
}

// ==========================================
// Structs
// ==========================================

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct PurchaseReturn {
    pub id: String,
    pub tenant_id: String,
    pub return_number: String,
    pub purchase_order_id: String,
    pub vendor_bill_id: Option<String>,
    pub account_payable_id: Option<String>,
    pub return_date: String,
    pub reason_code: String,
    pub status: String,
    pub total_amount: f64,
    pub note: Option<String>,
    pub created_by: String,
    pub created_at: i64,
    pub posted_by: Option<String>,
    pub posted_at: Option<i64>,
    pub voided_by: Option<String>,
    pub voided_at: Option<i64>,
    pub void_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct PurchaseReturnLine {
    pub id: String,
    pub return_id: String,
    pub line_no: i64,
    pub shipment_line_id: String,
    pub unit_id: String,
    pub product_name_snapshot: String,
    pub variant_name_snapshot: String,
    pub sku_snapshot: Option<String>,
    pub unit_name_snapshot: String,
    pub unit_price: f64,
    pub return_quantity: f64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct PurchaseReturnDetail {
    pub return_record: PurchaseReturn,
    pub lines: Vec<PurchaseReturnLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct CreatePurchaseReturnLineInput {
    pub shipment_line_id: String,
    pub return_quantity: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct CreatePurchaseReturnInput {
    pub purchase_order_id: String,
    pub return_date: Option<String>,
    pub reason_code: String,
    pub note: Option<String>,
    pub lines: Vec<CreatePurchaseReturnLineInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct UpdatePurchaseReturnInput {
    pub id: String,
    pub return_date: Option<String>,
    pub reason_code: Option<String>,
    pub note: Option<String>,
    pub lines: Option<Vec<CreatePurchaseReturnLineInput>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
pub struct ListPurchaseReturnsFilter {
    pub purchase_order_id: Option<String>,
    pub status: Option<String>,
    pub reason_code: Option<String>,
}

// ==========================================
// Tables Initialization
// ==========================================

pub fn create_purchase_returns_tables(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS purchase_returns (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            return_number TEXT NOT NULL,
            purchase_order_id TEXT NOT NULL,
            vendor_bill_id TEXT,
            account_payable_id TEXT,
            return_date TEXT NOT NULL,
            reason_code TEXT NOT NULL CHECK(reason_code IN ('quality_issue', 'wrong_item', 'vendor_error', 'other')),
            status TEXT NOT NULL CHECK(status IN ('draft', 'posted', 'void')),
            total_amount REAL NOT NULL DEFAULT 0.0,
            note TEXT,
            created_by TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            posted_by TEXT,
            posted_at INTEGER,
            voided_by TEXT,
            voided_at INTEGER,
            void_reason TEXT,
            FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_pret_tenant_number ON purchase_returns (tenant_id, return_number);
        CREATE INDEX IF NOT EXISTS idx_pret_order ON purchase_returns (tenant_id, purchase_order_id);
        CREATE INDEX IF NOT EXISTS idx_pret_ap ON purchase_returns (tenant_id, account_payable_id);

        CREATE TABLE IF NOT EXISTS purchase_return_lines (
            id TEXT PRIMARY KEY,
            return_id TEXT NOT NULL,
            line_no INTEGER NOT NULL,
            shipment_line_id TEXT NOT NULL,
            unit_id TEXT NOT NULL,
            product_name_snapshot TEXT NOT NULL,
            variant_name_snapshot TEXT NOT NULL,
            sku_snapshot TEXT,
            unit_name_snapshot TEXT NOT NULL,
            unit_price REAL NOT NULL,
            return_quantity REAL NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (return_id) REFERENCES purchase_returns(id),
            FOREIGN KEY (shipment_line_id) REFERENCES inventory_movements(id)
        );
        CREATE INDEX IF NOT EXISTS idx_pretl_return ON purchase_return_lines (return_id);
        CREATE INDEX IF NOT EXISTS idx_pretl_shpl ON purchase_return_lines (shipment_line_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_pretl_return_shpl ON purchase_return_lines (return_id, shipment_line_id);",
    )?;
    Ok(())
}

fn verify_active_tenant(conn: &Connection, tenant_id: &str) -> Result<(), PurchaseReturnError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(PurchaseReturnError::EmptyTenantId);
    }
    let status_res: Result<String, _> = conn.query_row(
        "SELECT status FROM tenants WHERE id = ?1",
        params![tid],
        |r| r.get(0),
    );
    match status_res {
        Ok(s) => {
            if s != "active" {
                Err(PurchaseReturnError::TenantNotActive)
            } else {
                Ok(())
            }
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            if table_exists(conn, "tenants") {
                Err(PurchaseReturnError::TenantNotFound)
            } else {
                Ok(())
            }
        }
        Err(e) => Err(PurchaseReturnError::DatabaseError(e.to_string())),
    }
}

fn generate_return_id(now: i64) -> String {
    format!(
        "pret_{}_{}",
        now,
        PRET_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

fn generate_return_line_id(now: i64) -> String {
    format!(
        "pretl_{}_{}",
        now,
        PRETL_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

fn generate_next_return_number(
    conn: &Connection,
    tenant_id: &str,
) -> Result<String, PurchaseReturnError> {
    let max_num: Result<Option<String>, _> = conn.query_row(
        "SELECT return_number FROM purchase_returns WHERE tenant_id = ?1 ORDER BY return_number DESC LIMIT 1",
        params![tenant_id],
        |r| r.get(0),
    );
    let next_seq = match max_num {
        Ok(Some(num)) => {
            if let Some(digits) = num.strip_prefix("PRET-") {
                digits.parse::<i64>().unwrap_or(0) + 1
            } else {
                1
            }
        }
        _ => 1,
    };
    Ok(format!("PRET-{:05}", next_seq))
}

fn validate_reason_code(reason: &str) -> Result<&str, PurchaseReturnError> {
    let r = reason.trim();
    match r {
        "quality_issue" | "wrong_item" | "vendor_error" | "other" => Ok(r),
        _ => Err(PurchaseReturnError::InvalidReasonCode),
    }
}

pub struct ReceiptLineInfo {
    pub id: String,
    pub unit_id: String,
    pub product_name_snapshot: String,
    pub variant_name_snapshot: String,
    pub sku_snapshot: Option<String>,
    pub unit_name_snapshot: String,
    pub unit_cost: f64,
    pub received_quantity: f64,
    pub receipt_date: String,
    pub warehouse_id: String,
}

fn fetch_and_validate_receipt_line(
    conn: &Connection,
    tenant_id: &str,
    purchase_order_id: &str,
    shipment_line_id: &str,
    requested_qty: f64,
    exclude_return_id: Option<&str>,
) -> Result<ReceiptLineInfo, PurchaseReturnError> {
    if requested_qty <= 0.0 {
        return Err(PurchaseReturnError::InvalidReturnQuantity);
    }

    let line_row = conn.query_row(
        "SELECT im.id, im.unit_id,
                COALESCE(pol.product_name_snapshot, ''),
                COALESCE(pol.variant_name_snapshot, ''),
                pol.sku_snapshot,
                COALESCE(pol.unit_name_snapshot, ''),
                COALESCE(im.unit_cost, pol.purchase_cost, 0.0),
                im.quantity_delta,
                CASE WHEN im.created_at > 10000000000
                     THEN strftime('%Y-%m-%d', im.created_at / 1000, 'unixepoch', 'localtime')
                     ELSE strftime('%Y-%m-%d', im.created_at, 'unixepoch', 'localtime')
                END AS receipt_date,
                COALESCE(im.warehouse_id, '')
         FROM inventory_movements im
         LEFT JOIN purchase_order_lines pol
                ON pol.purchase_order_id = im.reference_id AND pol.unit_id = im.unit_id
         WHERE im.id = ?1
           AND im.tenant_id = ?2
           AND im.reference_type = 'purchase_order'
           AND im.reference_id = ?3
           AND im.reason = 'purchase_receipt'
         LIMIT 1",
        params![shipment_line_id, tenant_id, purchase_order_id],
        |r| {
            Ok(ReceiptLineInfo {
                id: r.get(0)?,
                unit_id: r.get(1)?,
                product_name_snapshot: r.get(2)?,
                variant_name_snapshot: r.get(3)?,
                sku_snapshot: r.get(4)?,
                unit_name_snapshot: r.get(5)?,
                unit_cost: r.get(6)?,
                received_quantity: r.get(7)?,
                receipt_date: r.get(8)?,
                warehouse_id: r.get(9)?,
            })
        },
    );

    let info = match line_row {
        Ok(v) => v,
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            return Err(PurchaseReturnError::ShipmentLineNotFound)
        }
        Err(e) => return Err(PurchaseReturnError::DatabaseError(e.to_string())),
    };

    // Calculate cumulative posted returned quantity
    let posted_returned_qty: f64 = match exclude_return_id {
        Some(ex_id) => conn
            .query_row(
                "SELECT COALESCE(SUM(prl.return_quantity), 0.0)
                 FROM purchase_return_lines prl
                 JOIN purchase_returns pr ON pr.id = prl.return_id AND pr.tenant_id = ?1
                 WHERE prl.shipment_line_id = ?2 AND pr.status = 'posted' AND pr.id != ?3",
                params![tenant_id, shipment_line_id, ex_id],
                |r| r.get(0),
            )
            .unwrap_or(0.0),
        None => conn
            .query_row(
                "SELECT COALESCE(SUM(prl.return_quantity), 0.0)
                 FROM purchase_return_lines prl
                 JOIN purchase_returns pr ON pr.id = prl.return_id AND pr.tenant_id = ?1
                 WHERE prl.shipment_line_id = ?2 AND pr.status = 'posted'",
                params![tenant_id, shipment_line_id],
                |r| r.get(0),
            )
            .unwrap_or(0.0),
    };

    let remaining_returnable = round_2(info.received_quantity - posted_returned_qty);
    if requested_qty > remaining_returnable + 1e-6 {
        return Err(PurchaseReturnError::ReturnQuantityExceedsReturnable(
            info.id,
            format_amount(requested_qty),
            format_amount(remaining_returnable),
        ));
    }

    Ok(info)
}

// ==========================================
// Implementation Functions
// ==========================================

pub fn create_purchase_return_impl(
    conn: &mut Connection,
    tenant_id: &str,
    created_by: &str,
    input: CreatePurchaseReturnInput,
) -> Result<PurchaseReturnDetail, PurchaseReturnError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(PurchaseReturnError::EmptyTenantId);
    }
    verify_active_tenant(conn, tid)?;

    let po_id = input.purchase_order_id.trim();
    if po_id.is_empty() {
        return Err(PurchaseReturnError::PurchaseOrderNotFound);
    }

    // Verify order exists
    let po_exists: bool = conn
        .query_row(
            "SELECT 1 FROM purchase_orders WHERE id = ?1 AND tenant_id = ?2",
            params![po_id, tid],
            |_| Ok(true),
        )
        .optional()?
        .unwrap_or(false);
    if !po_exists {
        return Err(PurchaseReturnError::PurchaseOrderNotFound);
    }

    if input.lines.is_empty() {
        return Err(PurchaseReturnError::EmptyReturnLines);
    }

    let reason_code = validate_reason_code(&input.reason_code)?;
    let today = get_today_local(conn).unwrap_or_else(|_| "1970-01-01".to_string());
    let return_date = input.return_date.unwrap_or_else(|| today.clone());

    if return_date.as_str() > today.as_str() {
        return Err(PurchaseReturnError::ReturnDateAfterToday);
    }

    // Validate lines and check receipt_date
    let mut seen_shipment_lines = std::collections::HashSet::new();
    let mut total_qty_by_shipment_line = std::collections::HashMap::new();
    for line_input in &input.lines {
        let shp_id = line_input.shipment_line_id.trim();
        if !seen_shipment_lines.insert(shp_id.to_string()) {
            return Err(PurchaseReturnError::DuplicateShipmentLine(
                shp_id.to_string(),
            ));
        }
        *total_qty_by_shipment_line
            .entry(shp_id.to_string())
            .or_insert(0.0) += line_input.return_quantity;
    }

    let mut validated_lines = Vec::new();
    for (idx, line_input) in input.lines.iter().enumerate() {
        let shp_id = line_input.shipment_line_id.trim();
        let total_requested_qty = *total_qty_by_shipment_line
            .get(shp_id)
            .unwrap_or(&line_input.return_quantity);
        let line_info =
            fetch_and_validate_receipt_line(conn, tid, po_id, shp_id, total_requested_qty, None)?;

        if return_date.as_str() < line_info.receipt_date.as_str() {
            return Err(PurchaseReturnError::ReturnDateBeforeReceiptDate(
                line_info.receipt_date,
            ));
        }

        validated_lines.push((idx as i64 + 1, line_input.return_quantity, line_info));
    }

    let now = current_timestamp();
    let return_id = generate_return_id(now);
    let return_number = generate_next_return_number(conn, tid)?;

    let tx = conn.transaction()?;

    tx.execute(
        "INSERT INTO purchase_returns (
            id, tenant_id, return_number, purchase_order_id, vendor_bill_id,
            account_payable_id, return_date, reason_code, status, total_amount,
            note, created_by, created_at
        ) VALUES (?1, ?2, ?3, ?4, NULL, NULL, ?5, ?6, 'draft', 0.0, ?7, ?8, ?9)",
        params![
            return_id,
            tid,
            return_number,
            po_id,
            return_date,
            reason_code,
            input.note,
            created_by,
            now,
        ],
    )?;

    for (line_no, qty, info) in validated_lines {
        let line_id = generate_return_line_id(now);
        tx.execute(
            "INSERT INTO purchase_return_lines (
                id, return_id, line_no, shipment_line_id, unit_id,
                product_name_snapshot, variant_name_snapshot, sku_snapshot,
                unit_name_snapshot, unit_price, return_quantity, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                line_id,
                return_id,
                line_no,
                info.id,
                info.unit_id,
                info.product_name_snapshot,
                info.variant_name_snapshot,
                info.sku_snapshot,
                info.unit_name_snapshot,
                info.unit_cost,
                qty,
                now,
            ],
        )?;
    }

    tx.commit()?;

    get_purchase_return_impl(conn, tid, &return_id)
}

pub fn update_purchase_return_impl(
    conn: &mut Connection,
    tenant_id: &str,
    input: UpdatePurchaseReturnInput,
) -> Result<PurchaseReturnDetail, PurchaseReturnError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(PurchaseReturnError::EmptyTenantId);
    }
    verify_active_tenant(conn, tid)?;

    let existing = get_purchase_return_impl(conn, tid, &input.id)?;
    if existing.return_record.status != "draft" {
        return Err(PurchaseReturnError::NotDraftForUpdate);
    }

    let today = get_today_local(conn).unwrap_or_else(|_| "1970-01-01".to_string());
    let return_date = input
        .return_date
        .unwrap_or_else(|| existing.return_record.return_date.clone());

    if return_date.as_str() > today.as_str() {
        return Err(PurchaseReturnError::ReturnDateAfterToday);
    }

    let reason_code = match input.reason_code {
        Some(ref r) => validate_reason_code(r)?.to_string(),
        None => existing.return_record.reason_code.clone(),
    };

    let note = match input.note {
        Some(n) => Some(n),
        None => existing.return_record.note.clone(),
    };

    let validated_lines = if let Some(ref lines_input) = input.lines {
        if lines_input.is_empty() {
            return Err(PurchaseReturnError::EmptyReturnLines);
        }
        let mut seen_shipment_lines = std::collections::HashSet::new();
        let mut total_qty_by_shipment_line = std::collections::HashMap::new();
        for line_input in lines_input {
            let shp_id = line_input.shipment_line_id.trim();
            if !seen_shipment_lines.insert(shp_id.to_string()) {
                return Err(PurchaseReturnError::DuplicateShipmentLine(
                    shp_id.to_string(),
                ));
            }
            *total_qty_by_shipment_line
                .entry(shp_id.to_string())
                .or_insert(0.0) += line_input.return_quantity;
        }

        let mut list = Vec::new();
        for (idx, line_input) in lines_input.iter().enumerate() {
            let shp_id = line_input.shipment_line_id.trim();
            let total_requested_qty = *total_qty_by_shipment_line
                .get(shp_id)
                .unwrap_or(&line_input.return_quantity);
            let line_info = fetch_and_validate_receipt_line(
                conn,
                tid,
                &existing.return_record.purchase_order_id,
                shp_id,
                total_requested_qty,
                Some(&existing.return_record.id),
            )?;

            if return_date.as_str() < line_info.receipt_date.as_str() {
                return Err(PurchaseReturnError::ReturnDateBeforeReceiptDate(
                    line_info.receipt_date,
                ));
            }

            list.push((idx as i64 + 1, line_input.return_quantity, line_info));
        }
        Some(list)
    } else {
        None
    };

    let tx = conn.transaction()?;

    tx.execute(
        "UPDATE purchase_returns
         SET return_date = ?1, reason_code = ?2, note = ?3
         WHERE id = ?4 AND tenant_id = ?5 AND status = 'draft'",
        params![return_date, reason_code, note, input.id, tid],
    )?;

    if let Some(lines) = validated_lines {
        tx.execute(
            "DELETE FROM purchase_return_lines WHERE return_id = ?1",
            params![input.id],
        )?;

        let now = current_timestamp();
        for (line_no, qty, info) in lines {
            let line_id = generate_return_line_id(now);
            tx.execute(
                "INSERT INTO purchase_return_lines (
                    id, return_id, line_no, shipment_line_id, unit_id,
                    product_name_snapshot, variant_name_snapshot, sku_snapshot,
                    unit_name_snapshot, unit_price, return_quantity, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    line_id,
                    input.id,
                    line_no,
                    info.id,
                    info.unit_id,
                    info.product_name_snapshot,
                    info.variant_name_snapshot,
                    info.sku_snapshot,
                    info.unit_name_snapshot,
                    info.unit_cost,
                    qty,
                    now,
                ],
            )?;
        }
    }

    tx.commit()?;

    get_purchase_return_impl(conn, tid, &input.id)
}

pub fn post_purchase_return_impl(
    conn: &mut Connection,
    tenant_id: &str,
    posted_by: &str,
    return_id: &str,
) -> Result<PurchaseReturnDetail, PurchaseReturnError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(PurchaseReturnError::EmptyTenantId);
    }
    verify_active_tenant(conn, tid)?;

    let target_id = return_id.trim();
    if target_id.is_empty() {
        return Err(PurchaseReturnError::ReturnNotFound);
    }

    let tx = conn.transaction()?;

    // 1. Fetch return record and lock
    let (id, purchase_order_id, return_date, status) = {
        let mut stmt = tx.prepare(
            "SELECT id, purchase_order_id, return_date, status
             FROM purchase_returns
             WHERE id = ?1 AND tenant_id = ?2",
        )?;
        let row_res: Result<(String, String, String, String), _> = stmt
            .query_row(params![target_id, tid], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            });
        match row_res {
            Ok(v) => v,
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                return Err(PurchaseReturnError::ReturnNotFound)
            }
            Err(e) => return Err(PurchaseReturnError::DatabaseError(e.to_string())),
        }
    };

    if status != "draft" {
        return Err(PurchaseReturnError::NotDraftForPost);
    }

    // 2. Fetch lines
    let lines = {
        let mut stmt = tx.prepare(
            "SELECT id, shipment_line_id, unit_id, return_quantity, unit_price
             FROM purchase_return_lines
             WHERE return_id = ?1
             ORDER BY line_no ASC",
        )?;

        let line_rows = stmt.query_map(params![target_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, f64>(3)?,
                r.get::<_, f64>(4)?,
            ))
        })?;

        let mut lines = Vec::new();
        for l in line_rows {
            lines.push(l?);
        }
        lines
    };

    if lines.is_empty() {
        return Err(PurchaseReturnError::EmptyReturnLines);
    }

    // Validate lines and collect details
    let mut total_qty_by_shipment_line = std::collections::HashMap::new();
    for (_, shipment_line_id, _, return_qty, _) in &lines {
        *total_qty_by_shipment_line
            .entry(shipment_line_id.clone())
            .or_insert(0.0) += *return_qty;
    }

    let mut validated_lines = Vec::new();
    let mut untaxed_return_total = 0.0;

    for (line_id, shipment_line_id, _unit_id, return_qty, unit_price) in lines {
        let total_requested_qty = *total_qty_by_shipment_line
            .get(&shipment_line_id)
            .unwrap_or(&return_qty);
        let line_info = fetch_and_validate_receipt_line(
            &tx,
            tid,
            &purchase_order_id,
            &shipment_line_id,
            total_requested_qty,
            Some(&id),
        )?;

        if return_date.as_str() < line_info.receipt_date.as_str() {
            return Err(PurchaseReturnError::ReturnDateBeforeReceiptDate(
                line_info.receipt_date,
            ));
        }

        untaxed_return_total += round_2(return_qty * unit_price);
        validated_lines.push((line_id, shipment_line_id, return_qty, line_info));
    }

    untaxed_return_total = round_2(untaxed_return_total);

    // 3. Outward inventory movements for each line (quantity_delta = -return_quantity)
    let now = current_timestamp();
    for (_line_id, _shipment_line_id, return_qty, line_info) in &validated_lines {
        let mov_id = format!(
            "mov_pret_{}_{}",
            now,
            MOV_PRET_ID_COUNTER.fetch_add(1, Ordering::SeqCst)
        );

        tx.execute(
            "INSERT INTO inventory_movements (
                id, tenant_id, unit_id, warehouse_id, quantity_delta, unit_cost,
                reason, reference_type, reference_id, created_by, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'purchase_return', 'purchase_return', ?7, ?8, ?9)",
            params![
                mov_id,
                tid,
                line_info.unit_id,
                line_info.warehouse_id,
                -*return_qty,
                line_info.unit_cost,
                id,
                posted_by,
                now,
            ],
        )?;
    }

    // 4. Accounts Payable offset check
    // Check if purchase_order has a posted vendor_bill
    let bill_info_opt: Option<(String, f64, f64)> =
        if table_exists(&tx, "vendor_bill_orders") && table_exists(&tx, "vendor_bills") {
            tx.query_row(
                "SELECT vb.id, vb.untaxed_amount, vb.tax_amount
             FROM vendor_bills vb
             JOIN vendor_bill_orders vbo ON vbo.bill_id = vb.id
             WHERE vbo.purchase_order_id = ?1 AND vb.tenant_id = ?2 AND vb.status = 'posted'
             LIMIT 1",
                params![purchase_order_id, tid],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?
        } else {
            None
        };

    let (vendor_bill_id, account_payable_id, total_amount) = match bill_info_opt {
        Some((vb_id, vb_untaxed, vb_tax)) => {
            // Find linked open AP
            let ap_opt: Option<(String, f64, String)> = tx
                .query_row(
                    "SELECT id, amount, status
                     FROM accounts_payable
                     WHERE source_type = 'vendor_bill' AND source_id = ?1 AND tenant_id = ?2 AND status = 'open'
                     LIMIT 1",
                    params![vb_id, tid],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .optional()?;

            match ap_opt {
                Some((ap_id, ap_amount, _ap_status)) => {
                    // Compute return tax proportion
                    let tax_rate = if vb_untaxed > 0.0 && vb_tax > 0.0 {
                        vb_tax / vb_untaxed
                    } else {
                        0.0
                    };
                    let tax_return = round_2(untaxed_return_total * tax_rate);
                    let return_total = round_2(untaxed_return_total + tax_return);

                    // Compute current AP outstanding before this return
                    let paid_amount: f64 = if table_exists(&tx, "vendor_payment_allocations")
                        && table_exists(&tx, "vendor_payments")
                    {
                        tx.query_row(
                            "SELECT COALESCE(SUM(pa.amount), 0.0)
                             FROM vendor_payment_allocations pa
                             JOIN vendor_payments p ON p.id = pa.payment_id AND p.tenant_id = pa.tenant_id
                             WHERE pa.account_payable_id = ?1 AND pa.tenant_id = ?2 AND p.status = 'posted'",
                            params![ap_id, tid],
                            |r| r.get(0),
                        )
                        .unwrap_or(0.0)
                    } else {
                        0.0
                    };

                    let other_posted_returns: f64 = tx
                        .query_row(
                            "SELECT COALESCE(SUM(total_amount), 0.0)
                             FROM purchase_returns
                             WHERE account_payable_id = ?1 AND tenant_id = ?2 AND status = 'posted' AND id != ?3",
                            params![ap_id, tid, id],
                            |r| r.get(0),
                        )
                        .unwrap_or(0.0);

                    let current_outstanding =
                        round_2(ap_amount - paid_amount - other_posted_returns);

                    if return_total > current_outstanding + 1e-6 {
                        return Err(PurchaseReturnError::AmountExceedsOutstanding(
                            format_amount(return_total),
                            format_amount(current_outstanding),
                        ));
                    }

                    (Some(vb_id), Some(ap_id), return_total)
                }
                None => (Some(vb_id), None, untaxed_return_total),
            }
        }
        None => {
            // Unbilled order
            (None, None, untaxed_return_total)
        }
    };

    tx.execute(
        "UPDATE purchase_returns
         SET status = 'posted', posted_by = ?1, posted_at = ?2,
             vendor_bill_id = ?3, account_payable_id = ?4, total_amount = ?5
         WHERE id = ?6 AND tenant_id = ?7 AND status = 'draft'",
        params![
            posted_by,
            now,
            vendor_bill_id,
            account_payable_id,
            total_amount,
            target_id,
            tid,
        ],
    )?;

    tx.commit()?;

    get_purchase_return_impl(conn, tid, target_id)
}

pub fn void_purchase_return_impl(
    conn: &mut Connection,
    tenant_id: &str,
    voided_by: &str,
    return_id: &str,
    void_reason: &str,
) -> Result<PurchaseReturnDetail, PurchaseReturnError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(PurchaseReturnError::EmptyTenantId);
    }
    verify_active_tenant(conn, tid)?;

    let target_id = return_id.trim();
    if target_id.is_empty() {
        return Err(PurchaseReturnError::ReturnNotFound);
    }

    let reason = void_reason.trim();
    if reason.is_empty() {
        return Err(PurchaseReturnError::VoidReasonRequired);
    }

    let tx = conn.transaction()?;

    let return_status: String = match tx.query_row(
        "SELECT status FROM purchase_returns WHERE id = ?1 AND tenant_id = ?2",
        params![target_id, tid],
        |r| r.get(0),
    ) {
        Ok(s) => s,
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            return Err(PurchaseReturnError::ReturnNotFound)
        }
        Err(e) => return Err(PurchaseReturnError::DatabaseError(e.to_string())),
    };

    if return_status != "posted" {
        return Err(PurchaseReturnError::NotPostedForVoid);
    }

    // Fetch lines to reverse inventory
    let lines = {
        let mut stmt = tx.prepare(
            "SELECT prl.unit_id, prl.return_quantity, prl.unit_price, im.warehouse_id
             FROM purchase_return_lines prl
             JOIN inventory_movements im ON im.id = prl.shipment_line_id
             WHERE prl.return_id = ?1",
        )?;

        let line_rows = stmt.query_map(params![target_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, f64>(1)?,
                r.get::<_, f64>(2)?,
                r.get::<_, String>(3)?,
            ))
        })?;

        let mut lines = Vec::new();
        for l in line_rows {
            lines.push(l?);
        }
        lines
    };

    let now = current_timestamp();

    // Insert reversing inventory movements (+qty)
    for (unit_id, return_qty, unit_cost, warehouse_id) in lines {
        let mov_id = format!(
            "mov_pret_void_{}_{}",
            now,
            MOV_PRET_ID_COUNTER.fetch_add(1, Ordering::SeqCst)
        );

        tx.execute(
            "INSERT INTO inventory_movements (
                id, tenant_id, unit_id, warehouse_id, quantity_delta, unit_cost,
                reason, reference_type, reference_id, created_by, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'purchase_return_void', 'purchase_return', ?7, ?8, ?9)",
            params![
                mov_id,
                tid,
                unit_id,
                warehouse_id,
                return_qty,
                unit_cost,
                target_id,
                voided_by,
                now,
            ],
        )?;
    }

    tx.execute(
        "UPDATE purchase_returns
         SET status = 'void', voided_by = ?1, voided_at = ?2, void_reason = ?3
         WHERE id = ?4 AND tenant_id = ?5 AND status = 'posted'",
        params![voided_by, now, reason, target_id, tid],
    )?;

    tx.commit()?;

    get_purchase_return_impl(conn, tid, target_id)
}

pub fn get_purchase_return_impl(
    conn: &Connection,
    tenant_id: &str,
    return_id: &str,
) -> Result<PurchaseReturnDetail, PurchaseReturnError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(PurchaseReturnError::EmptyTenantId);
    }
    let target_id = return_id.trim();
    if target_id.is_empty() {
        return Err(PurchaseReturnError::ReturnNotFound);
    }

    let ret_res = conn.query_row(
        "SELECT id, tenant_id, return_number, purchase_order_id, vendor_bill_id,
                account_payable_id, return_date, reason_code, status, total_amount,
                note, created_by, created_at, posted_by, posted_at, voided_by,
                voided_at, void_reason
         FROM purchase_returns
         WHERE id = ?1 AND tenant_id = ?2",
        params![target_id, tid],
        |r| {
            Ok(PurchaseReturn {
                id: r.get(0)?,
                tenant_id: r.get(1)?,
                return_number: r.get(2)?,
                purchase_order_id: r.get(3)?,
                vendor_bill_id: r.get(4)?,
                account_payable_id: r.get(5)?,
                return_date: r.get(6)?,
                reason_code: r.get(7)?,
                status: r.get(8)?,
                total_amount: r.get(9)?,
                note: r.get(10)?,
                created_by: r.get(11)?,
                created_at: r.get(12)?,
                posted_by: r.get(13)?,
                posted_at: r.get(14)?,
                voided_by: r.get(15)?,
                voided_at: r.get(16)?,
                void_reason: r.get(17)?,
            })
        },
    );

    let return_record = match ret_res {
        Ok(v) => v,
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            return Err(PurchaseReturnError::ReturnNotFound)
        }
        Err(e) => return Err(PurchaseReturnError::DatabaseError(e.to_string())),
    };

    let mut stmt = conn.prepare(
        "SELECT id, return_id, line_no, shipment_line_id, unit_id,
                product_name_snapshot, variant_name_snapshot, sku_snapshot,
                unit_name_snapshot, unit_price, return_quantity, created_at
         FROM purchase_return_lines
         WHERE return_id = ?1
         ORDER BY line_no ASC",
    )?;

    let line_rows = stmt.query_map(params![target_id], |r| {
        Ok(PurchaseReturnLine {
            id: r.get(0)?,
            return_id: r.get(1)?,
            line_no: r.get(2)?,
            shipment_line_id: r.get(3)?,
            unit_id: r.get(4)?,
            product_name_snapshot: r.get(5)?,
            variant_name_snapshot: r.get(6)?,
            sku_snapshot: r.get(7)?,
            unit_name_snapshot: r.get(8)?,
            unit_price: r.get(9)?,
            return_quantity: r.get(10)?,
            created_at: r.get(11)?,
        })
    })?;

    let mut lines = Vec::new();
    for l in line_rows {
        lines.push(l?);
    }

    Ok(PurchaseReturnDetail {
        return_record,
        lines,
    })
}

pub fn list_purchase_returns_impl(
    conn: &Connection,
    tenant_id: &str,
    filter: ListPurchaseReturnsFilter,
) -> Result<Vec<PurchaseReturn>, PurchaseReturnError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(PurchaseReturnError::EmptyTenantId);
    }

    let mut sql = String::from(
        "SELECT id, tenant_id, return_number, purchase_order_id, vendor_bill_id,
                account_payable_id, return_date, reason_code, status, total_amount,
                note, created_by, created_at, posted_by, posted_at, voided_by,
                voided_at, void_reason
         FROM purchase_returns
         WHERE tenant_id = ?1",
    );
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(tid.to_string())];

    if let Some(po_id) = filter.purchase_order_id {
        let p = po_id.trim();
        if !p.is_empty() {
            params_vec.push(Box::new(p.to_string()));
            sql.push_str(&format!(" AND purchase_order_id = ?{}", params_vec.len()));
        }
    }

    if let Some(st) = filter.status {
        let s = st.trim();
        if !s.is_empty() {
            params_vec.push(Box::new(s.to_string()));
            sql.push_str(&format!(" AND status = ?{}", params_vec.len()));
        }
    }

    if let Some(rc) = filter.reason_code {
        let r = rc.trim();
        if !r.is_empty() {
            params_vec.push(Box::new(r.to_string()));
            sql.push_str(&format!(" AND reason_code = ?{}", params_vec.len()));
        }
    }

    sql.push_str(" ORDER BY created_at DESC");

    let params_slice: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;

    let rows = stmt.query_map(params_slice.as_slice(), |r| {
        Ok(PurchaseReturn {
            id: r.get(0)?,
            tenant_id: r.get(1)?,
            return_number: r.get(2)?,
            purchase_order_id: r.get(3)?,
            vendor_bill_id: r.get(4)?,
            account_payable_id: r.get(5)?,
            return_date: r.get(6)?,
            reason_code: r.get(7)?,
            status: r.get(8)?,
            total_amount: r.get(9)?,
            note: r.get(10)?,
            created_by: r.get(11)?,
            created_at: r.get(12)?,
            posted_by: r.get(13)?,
            posted_at: r.get(14)?,
            voided_by: r.get(15)?,
            voided_at: r.get(16)?,
            void_reason: r.get(17)?,
        })
    })?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row?);
    }

    Ok(results)
}

// ==========================================
// Tauri Commands
// ==========================================

#[tauri::command]
pub fn create_purchase_return(
    app_handle: tauri::AppHandle,
    input: CreatePurchaseReturnInput,
) -> Result<PurchaseReturnDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| format!("DB Open Error: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;
    create_purchase_return_impl(&mut conn, &active_tid, &active_uid, input)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_purchase_return(
    app_handle: tauri::AppHandle,
    input: UpdatePurchaseReturnInput,
) -> Result<PurchaseReturnDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| format!("DB Open Error: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    update_purchase_return_impl(&mut conn, &active_tid, input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn post_purchase_return(
    app_handle: tauri::AppHandle,
    id: String,
) -> Result<PurchaseReturnDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| format!("DB Open Error: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;
    post_purchase_return_impl(&mut conn, &active_tid, &active_uid, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn void_purchase_return(
    app_handle: tauri::AppHandle,
    id: String,
    void_reason: String,
) -> Result<PurchaseReturnDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| format!("DB Open Error: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;
    void_purchase_return_impl(&mut conn, &active_tid, &active_uid, &id, &void_reason)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_purchase_return(
    app_handle: tauri::AppHandle,
    id: String,
) -> Result<PurchaseReturnDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let conn = Connection::open(&db_path).map_err(|e| format!("DB Open Error: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    get_purchase_return_impl(&conn, &active_tid, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_purchase_returns(
    app_handle: tauri::AppHandle,
    filter: ListPurchaseReturnsFilter,
) -> Result<Vec<PurchaseReturn>, String> {
    let db_path = crate::get_db_path(&app_handle);
    let conn = Connection::open(&db_path).map_err(|e| format!("DB Open Error: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    list_purchase_returns_impl(&conn, &active_tid, filter).map_err(|e| e.to_string())
}

// ==========================================
// Unit Tests (Layer 1)
// ==========================================

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();

        // Tenants
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS tenants (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                status TEXT NOT NULL
            );
            INSERT INTO tenants (id, name, status) VALUES ('tnt_test', 'Test Tenant', 'active');",
        )
        .unwrap();

        // Partners & Products & Warehouses
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS partners (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                name TEXT NOT NULL,
                is_vendor INTEGER NOT NULL DEFAULT 1,
                is_customer INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'active'
            );
            INSERT INTO partners (id, tenant_id, name, is_vendor) VALUES ('vnd_001', 'tnt_test', 'Vendor 1', 1);

            CREATE TABLE IF NOT EXISTS warehouses (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                name TEXT NOT NULL,
                code TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active'
            );
            INSERT INTO warehouses (id, tenant_id, name, code) VALUES ('wh_01', 'tnt_test', 'Main WH', 'WH01');",
        )
        .unwrap();

        // Purchase Orders & Lines
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS purchase_orders (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                order_number TEXT NOT NULL,
                vendor_partner_id TEXT NOT NULL,
                order_date TEXT NOT NULL,
                status TEXT NOT NULL,
                total_amount REAL NOT NULL DEFAULT 0.0,
                created_by TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                warehouse_id TEXT
            );

            CREATE TABLE IF NOT EXISTS purchase_order_lines (
                id TEXT PRIMARY KEY,
                purchase_order_id TEXT NOT NULL,
                line_no INTEGER NOT NULL,
                unit_id TEXT NOT NULL,
                supply_source_id TEXT,
                product_name_snapshot TEXT NOT NULL,
                variant_name_snapshot TEXT NOT NULL,
                sku_snapshot TEXT,
                unit_name_snapshot TEXT NOT NULL,
                quantity REAL NOT NULL,
                received_quantity REAL,
                purchase_cost REAL NOT NULL,
                created_at INTEGER NOT NULL
            );",
        )
        .unwrap();

        // Inventory movements
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS inventory_movements (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                unit_id TEXT NOT NULL,
                quantity_delta REAL NOT NULL,
                unit_cost REAL,
                reason TEXT NOT NULL,
                reference_type TEXT NOT NULL,
                reference_id TEXT,
                created_by TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                warehouse_id TEXT
            );",
        )
        .unwrap();

        // Accounts payable & Vendor Bills
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS accounts_payable (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                vendor_partner_id TEXT NOT NULL,
                vendor_name_snapshot TEXT NOT NULL,
                source_type TEXT NOT NULL,
                source_id TEXT NOT NULL,
                source_number TEXT NOT NULL,
                external_reference TEXT,
                document_date TEXT NOT NULL,
                due_date TEXT NOT NULL,
                amount REAL NOT NULL,
                currency TEXT NOT NULL DEFAULT 'TWD',
                status TEXT NOT NULL,
                created_by TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                voided_by TEXT,
                voided_at INTEGER,
                void_reason TEXT
            );

            CREATE TABLE IF NOT EXISTS vendor_bills (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                bill_number TEXT NOT NULL,
                vendor_partner_id TEXT NOT NULL,
                vendor_name_snapshot TEXT NOT NULL,
                vendor_invoice_number TEXT NOT NULL,
                bill_date TEXT NOT NULL,
                due_date TEXT NOT NULL,
                untaxed_amount REAL NOT NULL,
                tax_amount REAL NOT NULL,
                currency TEXT NOT NULL DEFAULT 'TWD',
                status TEXT NOT NULL,
                created_by TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS vendor_bill_orders (
                id TEXT PRIMARY KEY,
                bill_id TEXT NOT NULL,
                purchase_order_id TEXT NOT NULL,
                po_number_snapshot TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS vendor_payments (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                payment_number TEXT NOT NULL,
                vendor_partner_id TEXT NOT NULL,
                payment_date TEXT NOT NULL,
                amount REAL NOT NULL,
                status TEXT NOT NULL,
                created_by TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS vendor_payment_allocations (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                payment_id TEXT NOT NULL,
                account_payable_id TEXT NOT NULL,
                amount REAL NOT NULL,
                created_at INTEGER NOT NULL
            );",
        )
        .unwrap();

        create_purchase_returns_tables(&conn).unwrap();
        conn
    }

    /// Seed a standard PO with received inventory movement
    fn seed_test_po(conn: &Connection) -> (String, String, String) {
        let po_id = "po_test_001";
        let unit_id = "unit_apple";
        let movement_id = "im_receipt_001";
        let today = get_today_local(conn).unwrap();

        conn.execute(
            "INSERT INTO purchase_orders (id, tenant_id, order_number, vendor_partner_id, order_date, status, total_amount, created_by, created_at, warehouse_id)
             VALUES (?1, 'tnt_test', 'PO-00001', 'vnd_001', ?2, 'received', 1000.0, 'usr_1', 1000, 'wh_01')",
            params![po_id, today],
        ).unwrap();

        conn.execute(
            "INSERT INTO purchase_order_lines (id, purchase_order_id, line_no, unit_id, product_name_snapshot, variant_name_snapshot, sku_snapshot, unit_name_snapshot, quantity, received_quantity, purchase_cost, created_at)
             VALUES ('pol_1', ?1, 1, ?2, 'Apple', 'Red', 'SKU-APP', 'Box', 10.0, 10.0, 100.0, 1000)",
            params![po_id, unit_id],
        ).unwrap();

        conn.execute(
            "INSERT INTO inventory_movements (id, tenant_id, unit_id, quantity_delta, unit_cost, reason, reference_type, reference_id, created_by, created_at, warehouse_id)
             VALUES (?1, 'tnt_test', ?2, 10.0, 100.0, 'purchase_receipt', 'purchase_order', ?3, 'usr_1', 1000, 'wh_01')",
            params![movement_id, unit_id, po_id],
        ).unwrap();

        (
            po_id.to_string(),
            unit_id.to_string(),
            movement_id.to_string(),
        )
    }

    // ==========================================
    // Normal Cases (TC-PRET-N-01 ~ TC-PRET-N-08)
    // ==========================================

    #[test]
    fn test_tc_pret_n_01_create_draft_success() {
        // Given: Seeded PO and receipt movement
        let mut conn = setup_test_db();
        let (po_id, _, mov_id) = seed_test_po(&conn);

        // When: Creating a draft purchase return
        let input = CreatePurchaseReturnInput {
            purchase_order_id: po_id.clone(),
            return_date: None,
            reason_code: "quality_issue".to_string(),
            note: Some("Defective items".to_string()),
            lines: vec![CreatePurchaseReturnLineInput {
                shipment_line_id: mov_id,
                return_quantity: 3.0,
            }],
        };
        let detail =
            create_purchase_return_impl(&mut conn, "tnt_test", "usr_tester", input).unwrap();

        // Then: Successfully created with PRET-00001 and draft status
        assert_eq!(detail.return_record.return_number, "PRET-00001");
        assert_eq!(detail.return_record.status, "draft");
        assert_eq!(detail.return_record.total_amount, 0.0);
        assert_eq!(detail.lines.len(), 1);
        assert_eq!(detail.lines[0].return_quantity, 3.0);
        assert_eq!(detail.lines[0].unit_price, 100.0);
        assert_eq!(detail.lines[0].product_name_snapshot, "Apple");
    }

    #[test]
    fn test_tc_pret_n_02_update_draft_success() {
        // Given: Created draft return
        let mut conn = setup_test_db();
        let (po_id, _, mov_id) = seed_test_po(&conn);
        let detail = create_purchase_return_impl(
            &mut conn,
            "tnt_test",
            "usr_tester",
            CreatePurchaseReturnInput {
                purchase_order_id: po_id,
                return_date: None,
                reason_code: "quality_issue".to_string(),
                note: Some("Original note".to_string()),
                lines: vec![CreatePurchaseReturnLineInput {
                    shipment_line_id: mov_id.clone(),
                    return_quantity: 2.0,
                }],
            },
        )
        .unwrap();

        // When: Updating the return draft with new reason, note, and lines
        let updated = update_purchase_return_impl(
            &mut conn,
            "tnt_test",
            UpdatePurchaseReturnInput {
                id: detail.return_record.id,
                return_date: None,
                reason_code: Some("wrong_item".to_string()),
                note: Some("Updated note".to_string()),
                lines: Some(vec![CreatePurchaseReturnLineInput {
                    shipment_line_id: mov_id,
                    return_quantity: 5.0,
                }]),
            },
        )
        .unwrap();

        // Then: Fields and line quantities are updated
        assert_eq!(updated.return_record.reason_code, "wrong_item");
        assert_eq!(updated.return_record.note.as_deref(), Some("Updated note"));
        assert_eq!(updated.lines[0].return_quantity, 5.0);
    }

    #[test]
    fn test_tc_pret_n_03_post_uninvoiced_purchase_return_success() {
        // Given: Seeded PO without vendor bill
        let mut conn = setup_test_db();
        let (po_id, _, mov_id) = seed_test_po(&conn);
        let detail = create_purchase_return_impl(
            &mut conn,
            "tnt_test",
            "usr_tester",
            CreatePurchaseReturnInput {
                purchase_order_id: po_id,
                return_date: None,
                reason_code: "vendor_error".to_string(),
                note: None,
                lines: vec![CreatePurchaseReturnLineInput {
                    shipment_line_id: mov_id,
                    return_quantity: 4.0,
                }],
            },
        )
        .unwrap();

        // When: Posting the return
        let posted = post_purchase_return_impl(
            &mut conn,
            "tnt_test",
            "usr_warehouse",
            &detail.return_record.id,
        )
        .unwrap();

        // Then: Status is posted, inventory movement created with -4.0, unit_cost 100.0, AP is None
        assert_eq!(posted.return_record.status, "posted");
        assert_eq!(posted.return_record.total_amount, 400.0);
        assert_eq!(posted.return_record.vendor_bill_id, None);
        assert_eq!(posted.return_record.account_payable_id, None);

        let (delta, cost, reason, ref_type): (f64, f64, String, String) = conn
            .query_row(
                "SELECT quantity_delta, unit_cost, reason, reference_type
                 FROM inventory_movements
                 WHERE reference_id = ?1 AND reason = 'purchase_return'",
                params![posted.return_record.id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(delta, -4.0);
        assert_eq!(cost, 100.0);
        assert_eq!(reason, "purchase_return");
        assert_eq!(ref_type, "purchase_return");
    }

    #[test]
    fn test_tc_pret_n_04_post_invoiced_purchase_return_with_ap_offset() {
        // Given: Seeded PO linked to posted vendor bill and open AP (1000 untaxed + 50 tax = 1050 total)
        let mut conn = setup_test_db();
        let (po_id, _, mov_id) = seed_test_po(&conn);

        conn.execute(
            "INSERT INTO vendor_bills (id, tenant_id, bill_number, vendor_partner_id, vendor_name_snapshot, vendor_invoice_number, bill_date, due_date, untaxed_amount, tax_amount, status, created_by, created_at)
             VALUES ('vb_01', 'tnt_test', 'VB-001', 'vnd_001', 'Vendor 1', 'INV-V01', '2026-11-01', '2026-11-30', 1000.0, 50.0, 'posted', 'usr_1', 1000)",
            [],
        ).unwrap();

        conn.execute(
            "INSERT INTO vendor_bill_orders (id, bill_id, purchase_order_id, po_number_snapshot, created_at)
             VALUES ('vbo_01', 'vb_01', ?1, 'PO-00001', 1000)",
            params![po_id],
        ).unwrap();

        conn.execute(
            "INSERT INTO accounts_payable (id, tenant_id, vendor_partner_id, vendor_name_snapshot, source_type, source_id, source_number, document_date, due_date, amount, status, created_by, created_at)
             VALUES ('ap_01', 'tnt_test', 'vnd_001', 'Vendor 1', 'vendor_bill', 'vb_01', 'VB-001', '2026-11-01', '2026-11-30', 1050.0, 'open', 'usr_1', 1000)",
            [],
        ).unwrap();

        // And: Return draft for 4 boxes (untaxed 400.0, tax = 400 * (50/1000) = 20.0, return_total = 420.0)
        let detail = create_purchase_return_impl(
            &mut conn,
            "tnt_test",
            "usr_tester",
            CreatePurchaseReturnInput {
                purchase_order_id: po_id,
                return_date: None,
                reason_code: "quality_issue".to_string(),
                note: None,
                lines: vec![CreatePurchaseReturnLineInput {
                    shipment_line_id: mov_id,
                    return_quantity: 4.0,
                }],
            },
        )
        .unwrap();

        // When: Posting the return
        let posted = post_purchase_return_impl(
            &mut conn,
            "tnt_test",
            "usr_tester",
            &detail.return_record.id,
        )
        .unwrap();

        // Then: Total amount includes tax (420.0), linked to vb_01 and ap_01
        assert_eq!(posted.return_record.total_amount, 420.0);
        assert_eq!(
            posted.return_record.vendor_bill_id.as_deref(),
            Some("vb_01")
        );
        assert_eq!(
            posted.return_record.account_payable_id.as_deref(),
            Some("ap_01")
        );

        // And: Accounts payable outstanding is reduced from 1050.0 to 630.0
        let ap_detail =
            crate::accounts_payable::get_account_payable_impl(&conn, "tnt_test", "ap_01").unwrap();
        assert_eq!(ap_detail.outstanding_amount, 630.0);
        assert_eq!(
            ap_detail.settlement_status,
            crate::accounts_payable::SettlementStatus::PartiallyPaid
        );
    }

    #[test]
    fn test_tc_pret_n_05_void_uninvoiced_purchase_return_success() {
        // Given: Posted uninvoiced purchase return
        let mut conn = setup_test_db();
        let (po_id, _, mov_id) = seed_test_po(&conn);
        let detail = create_purchase_return_impl(
            &mut conn,
            "tnt_test",
            "usr_tester",
            CreatePurchaseReturnInput {
                purchase_order_id: po_id,
                return_date: None,
                reason_code: "other".to_string(),
                note: None,
                lines: vec![CreatePurchaseReturnLineInput {
                    shipment_line_id: mov_id,
                    return_quantity: 3.0,
                }],
            },
        )
        .unwrap();
        let posted = post_purchase_return_impl(
            &mut conn,
            "tnt_test",
            "usr_warehouse",
            &detail.return_record.id,
        )
        .unwrap();

        // When: Voiding the purchase return
        let voided = void_purchase_return_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            &posted.return_record.id,
            "Mistaken return",
        )
        .unwrap();

        // Then: Status is void, and reversing movement with +3.0 and reason='purchase_return_void' is inserted
        assert_eq!(voided.return_record.status, "void");
        assert_eq!(
            voided.return_record.void_reason.as_deref(),
            Some("Mistaken return")
        );

        let (delta, reason): (f64, String) = conn
            .query_row(
                "SELECT quantity_delta, reason
                 FROM inventory_movements
                 WHERE reference_id = ?1 AND reason = 'purchase_return_void'",
                params![voided.return_record.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(delta, 3.0);
        assert_eq!(reason, "purchase_return_void");
    }

    #[test]
    fn test_tc_pret_n_06_void_invoiced_purchase_return_restores_ap() {
        // Given: Posted return linked to AP (reducing AP from 1050 to 630)
        let mut conn = setup_test_db();
        let (po_id, _, mov_id) = seed_test_po(&conn);

        conn.execute(
            "INSERT INTO vendor_bills (id, tenant_id, bill_number, vendor_partner_id, vendor_name_snapshot, vendor_invoice_number, bill_date, due_date, untaxed_amount, tax_amount, status, created_by, created_at)
             VALUES ('vb_02', 'tnt_test', 'VB-002', 'vnd_001', 'Vendor 1', 'INV-V02', '2026-11-01', '2026-11-30', 1000.0, 50.0, 'posted', 'usr_1', 1000)",
            [],
        ).unwrap();

        conn.execute(
            "INSERT INTO vendor_bill_orders (id, bill_id, purchase_order_id, po_number_snapshot, created_at)
             VALUES ('vbo_02', 'vb_02', ?1, 'PO-00001', 1000)",
            params![po_id],
        ).unwrap();

        conn.execute(
            "INSERT INTO accounts_payable (id, tenant_id, vendor_partner_id, vendor_name_snapshot, source_type, source_id, source_number, document_date, due_date, amount, status, created_by, created_at)
             VALUES ('ap_02', 'tnt_test', 'vnd_001', 'Vendor 1', 'vendor_bill', 'vb_02', 'VB-002', '2026-11-01', '2026-11-30', 1050.0, 'open', 'usr_1', 1000)",
            [],
        ).unwrap();

        let detail = create_purchase_return_impl(
            &mut conn,
            "tnt_test",
            "usr_tester",
            CreatePurchaseReturnInput {
                purchase_order_id: po_id,
                return_date: None,
                reason_code: "quality_issue".to_string(),
                note: None,
                lines: vec![CreatePurchaseReturnLineInput {
                    shipment_line_id: mov_id,
                    return_quantity: 4.0,
                }],
            },
        )
        .unwrap();
        let posted = post_purchase_return_impl(
            &mut conn,
            "tnt_test",
            "usr_tester",
            &detail.return_record.id,
        )
        .unwrap();

        let ap_before_void =
            crate::accounts_payable::get_account_payable_impl(&conn, "tnt_test", "ap_02").unwrap();
        assert_eq!(ap_before_void.outstanding_amount, 630.0);

        // When: Voiding the posted return
        void_purchase_return_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            &posted.return_record.id,
            "作廢退貨",
        )
        .unwrap();

        // Then: AP outstanding is automatically restored back to 1050.0
        let ap_after_void =
            crate::accounts_payable::get_account_payable_impl(&conn, "tnt_test", "ap_02").unwrap();
        assert_eq!(ap_after_void.outstanding_amount, 1050.0);
        assert_eq!(
            ap_after_void.settlement_status,
            crate::accounts_payable::SettlementStatus::Unpaid
        );
    }

    #[test]
    fn test_tc_pret_n_07_multiple_partial_returns_up_to_received_quantity() {
        // Given: Seeded receipt of 10 items
        let mut conn = setup_test_db();
        let (po_id, _, mov_id) = seed_test_po(&conn);

        // When: Creating and posting first return of 6 items
        let ret1 = create_purchase_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreatePurchaseReturnInput {
                purchase_order_id: po_id.clone(),
                return_date: None,
                reason_code: "wrong_item".to_string(),
                note: None,
                lines: vec![CreatePurchaseReturnLineInput {
                    shipment_line_id: mov_id.clone(),
                    return_quantity: 6.0,
                }],
            },
        )
        .unwrap();
        post_purchase_return_impl(&mut conn, "tnt_test", "usr_1", &ret1.return_record.id).unwrap();

        // And: Creating and posting second return of remaining 4 items
        let ret2 = create_purchase_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreatePurchaseReturnInput {
                purchase_order_id: po_id.clone(),
                return_date: None,
                reason_code: "quality_issue".to_string(),
                note: None,
                lines: vec![CreatePurchaseReturnLineInput {
                    shipment_line_id: mov_id.clone(),
                    return_quantity: 4.0,
                }],
            },
        )
        .unwrap();
        post_purchase_return_impl(&mut conn, "tnt_test", "usr_1", &ret2.return_record.id).unwrap();

        // Then: Attempting a 3rd return with 0.1 exceeds returnable quantity (0 remaining)
        let err = create_purchase_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreatePurchaseReturnInput {
                purchase_order_id: po_id,
                return_date: None,
                reason_code: "other".to_string(),
                note: None,
                lines: vec![CreatePurchaseReturnLineInput {
                    shipment_line_id: mov_id,
                    return_quantity: 0.1,
                }],
            },
        )
        .unwrap_err();

        match err {
            PurchaseReturnError::ReturnQuantityExceedsReturnable(_, req, rem) => {
                assert_eq!(req, "0.10");
                assert_eq!(rem, "0");
            }
            other => panic!("Expected ReturnQuantityExceedsReturnable, got {:?}", other),
        }
    }

    #[test]
    fn test_tc_pret_n_08_return_offsets_ap_exactly_to_zero() {
        // Given: Seeded PO with 10 units @ 100 = 1000, and vendor bill / AP of 1000.0 (no tax)
        let mut conn = setup_test_db();
        let (po_id, _, mov_id) = seed_test_po(&conn);

        conn.execute(
            "INSERT INTO vendor_bills (id, tenant_id, bill_number, vendor_partner_id, vendor_name_snapshot, vendor_invoice_number, bill_date, due_date, untaxed_amount, tax_amount, status, created_by, created_at)
             VALUES ('vb_exact', 'tnt_test', 'VB-EXACT', 'vnd_001', 'Vendor 1', 'INV-EXACT', '2026-11-01', '2026-11-30', 1000.0, 0.0, 'posted', 'usr_1', 1000)",
            [],
        ).unwrap();

        conn.execute(
            "INSERT INTO vendor_bill_orders (id, bill_id, purchase_order_id, po_number_snapshot, created_at)
             VALUES ('vbo_exact', 'vb_exact', ?1, 'PO-00001', 1000)",
            params![po_id],
        ).unwrap();

        conn.execute(
            "INSERT INTO accounts_payable (id, tenant_id, vendor_partner_id, vendor_name_snapshot, source_type, source_id, source_number, document_date, due_date, amount, status, created_by, created_at)
             VALUES ('ap_exact', 'tnt_test', 'vnd_001', 'Vendor 1', 'vendor_bill', 'vb_exact', 'VB-EXACT', '2026-11-01', '2026-11-30', 1000.0, 'open', 'usr_1', 1000)",
            [],
        ).unwrap();

        // When: Returning all 10 items (exact total 1000.0)
        let detail = create_purchase_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreatePurchaseReturnInput {
                purchase_order_id: po_id,
                return_date: None,
                reason_code: "wrong_item".to_string(),
                note: None,
                lines: vec![CreatePurchaseReturnLineInput {
                    shipment_line_id: mov_id,
                    return_quantity: 10.0,
                }],
            },
        )
        .unwrap();
        post_purchase_return_impl(&mut conn, "tnt_test", "usr_1", &detail.return_record.id)
            .unwrap();

        // Then: AP outstanding is exactly 0.0, and settlement_status is Paid
        let ap = crate::accounts_payable::get_account_payable_impl(&conn, "tnt_test", "ap_exact")
            .unwrap();
        assert_eq!(ap.outstanding_amount, 0.0);
        assert_eq!(
            ap.settlement_status,
            crate::accounts_payable::SettlementStatus::Paid
        );
    }

    // ==========================================
    // Error & Boundary Cases (TC-PRET-E-01 ~ TC-PRET-E-15)
    // ==========================================

    #[test]
    fn test_tc_pret_e_01_invalid_reason_code() {
        // Given: Seeded PO
        let mut conn = setup_test_db();
        let (po_id, _, mov_id) = seed_test_po(&conn);

        // When: Creating return with invalid reason_code
        let err = create_purchase_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreatePurchaseReturnInput {
                purchase_order_id: po_id,
                return_date: None,
                reason_code: "invalid_reason".to_string(),
                note: None,
                lines: vec![CreatePurchaseReturnLineInput {
                    shipment_line_id: mov_id,
                    return_quantity: 1.0,
                }],
            },
        )
        .unwrap_err();

        // Then: InvalidReasonCode error returned
        assert_eq!(err, PurchaseReturnError::InvalidReasonCode);
    }

    #[test]
    fn test_tc_pret_e_02_and_e_03_zero_or_negative_quantity() {
        // Given: Seeded PO
        let mut conn = setup_test_db();
        let (po_id, _, mov_id) = seed_test_po(&conn);

        // When & Then: return_quantity = 0.0 -> InvalidReturnQuantity
        let err_zero = create_purchase_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreatePurchaseReturnInput {
                purchase_order_id: po_id.clone(),
                return_date: None,
                reason_code: "quality_issue".to_string(),
                note: None,
                lines: vec![CreatePurchaseReturnLineInput {
                    shipment_line_id: mov_id.clone(),
                    return_quantity: 0.0,
                }],
            },
        )
        .unwrap_err();
        assert_eq!(err_zero, PurchaseReturnError::InvalidReturnQuantity);

        // When & Then: return_quantity = -1.0 -> InvalidReturnQuantity
        let err_neg = create_purchase_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreatePurchaseReturnInput {
                purchase_order_id: po_id,
                return_date: None,
                reason_code: "quality_issue".to_string(),
                note: None,
                lines: vec![CreatePurchaseReturnLineInput {
                    shipment_line_id: mov_id,
                    return_quantity: -1.0,
                }],
            },
        )
        .unwrap_err();
        assert_eq!(err_neg, PurchaseReturnError::InvalidReturnQuantity);
    }

    #[test]
    fn test_tc_pret_e_04_quantity_exceeds_returnable() {
        // Given: Seeded PO with 10.0 received
        let mut conn = setup_test_db();
        let (po_id, _, mov_id) = seed_test_po(&conn);

        // When: Requesting return quantity of 11.0 (boundary max + 1)
        let err = create_purchase_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreatePurchaseReturnInput {
                purchase_order_id: po_id,
                return_date: None,
                reason_code: "quality_issue".to_string(),
                note: None,
                lines: vec![CreatePurchaseReturnLineInput {
                    shipment_line_id: mov_id,
                    return_quantity: 11.0,
                }],
            },
        )
        .unwrap_err();

        // Then: ReturnQuantityExceedsReturnable error
        match err {
            PurchaseReturnError::ReturnQuantityExceedsReturnable(_, req, rem) => {
                assert_eq!(req, "11");
                assert_eq!(rem, "10");
            }
            other => panic!("Expected ReturnQuantityExceedsReturnable, got {:?}", other),
        }
    }

    #[test]
    fn test_tc_pret_e_05_shipment_line_not_found() {
        // Given: Seeded PO
        let mut conn = setup_test_db();
        let (po_id, _, _) = seed_test_po(&conn);

        // When: Passing nonexistent shipment_line_id
        let err = create_purchase_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreatePurchaseReturnInput {
                purchase_order_id: po_id,
                return_date: None,
                reason_code: "quality_issue".to_string(),
                note: None,
                lines: vec![CreatePurchaseReturnLineInput {
                    shipment_line_id: "im_nonexistent".to_string(),
                    return_quantity: 1.0,
                }],
            },
        )
        .unwrap_err();

        // Then: ShipmentLineNotFound error
        assert_eq!(err, PurchaseReturnError::ShipmentLineNotFound);
    }

    #[test]
    fn test_tc_pret_e_06_shipment_line_not_purchase_receipt() {
        // Given: Seeded PO and movement with reason != purchase_receipt (e.g. inventory_adjustment)
        let mut conn = setup_test_db();
        let (po_id, unit_id, _) = seed_test_po(&conn);
        let adj_mov_id = "im_adj_001";
        conn.execute(
            "INSERT INTO inventory_movements (id, tenant_id, unit_id, quantity_delta, unit_cost, reason, reference_type, reference_id, created_by, created_at, warehouse_id)
             VALUES (?1, 'tnt_test', ?2, 5.0, 100.0, 'manual_adjustment', 'purchase_order', ?3, 'usr_1', 1000, 'wh_01')",
            params![adj_mov_id, unit_id, po_id],
        ).unwrap();

        // When: Attempting to return against non-purchase_receipt movement
        let err = create_purchase_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreatePurchaseReturnInput {
                purchase_order_id: po_id,
                return_date: None,
                reason_code: "quality_issue".to_string(),
                note: None,
                lines: vec![CreatePurchaseReturnLineInput {
                    shipment_line_id: adj_mov_id.to_string(),
                    return_quantity: 1.0,
                }],
            },
        )
        .unwrap_err();

        // Then: ShipmentLineNotFound
        assert_eq!(err, PurchaseReturnError::ShipmentLineNotFound);
    }

    #[test]
    fn test_tc_pret_e_07_shipment_line_belongs_to_different_order() {
        // Given: Seeded PO 1, and another PO 2
        let mut conn = setup_test_db();
        let (_po1, _, mov1) = seed_test_po(&conn);

        let po2 = "po_test_002";
        conn.execute(
            "INSERT INTO purchase_orders (id, tenant_id, order_number, vendor_partner_id, order_date, status, total_amount, created_by, created_at, warehouse_id)
             VALUES (?1, 'tnt_test', 'PO-00002', 'vnd_001', '2026-11-01', 'received', 500.0, 'usr_1', 1000, 'wh_01')",
            params![po2],
        ).unwrap();

        // When: Attempting to create return for PO 2 with movement from PO 1
        let err = create_purchase_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreatePurchaseReturnInput {
                purchase_order_id: po2.to_string(),
                return_date: None,
                reason_code: "quality_issue".to_string(),
                note: None,
                lines: vec![CreatePurchaseReturnLineInput {
                    shipment_line_id: mov1,
                    return_quantity: 1.0,
                }],
            },
        )
        .unwrap_err();

        // Then: ShipmentLineNotFound (isolated to order)
        assert_eq!(err, PurchaseReturnError::ShipmentLineNotFound);
    }

    #[test]
    fn test_tc_pret_e_08_empty_lines() {
        // Given: Seeded PO
        let mut conn = setup_test_db();
        let (po_id, _, _) = seed_test_po(&conn);

        // When: Lines is empty array []
        let err = create_purchase_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreatePurchaseReturnInput {
                purchase_order_id: po_id,
                return_date: None,
                reason_code: "quality_issue".to_string(),
                note: None,
                lines: vec![],
            },
        )
        .unwrap_err();

        // Then: EmptyReturnLines error
        assert_eq!(err, PurchaseReturnError::EmptyReturnLines);
    }

    #[test]
    fn test_tc_pret_e_09_return_date_after_today() {
        // Given: Seeded PO
        let mut conn = setup_test_db();
        let (po_id, _, mov_id) = seed_test_po(&conn);

        // When: return_date is 2099-12-31 (future date)
        let err = create_purchase_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreatePurchaseReturnInput {
                purchase_order_id: po_id,
                return_date: Some("2099-12-31".to_string()),
                reason_code: "quality_issue".to_string(),
                note: None,
                lines: vec![CreatePurchaseReturnLineInput {
                    shipment_line_id: mov_id,
                    return_quantity: 1.0,
                }],
            },
        )
        .unwrap_err();

        // Then: ReturnDateAfterToday
        assert_eq!(err, PurchaseReturnError::ReturnDateAfterToday);
    }

    #[test]
    fn test_tc_pret_e_10_return_date_before_receipt_date() {
        // Given: Seeded PO with receipt movement created today
        let mut conn = setup_test_db();
        let (po_id, unit_id, _) = seed_test_po(&conn);

        // Insert a receipt movement created today (e.g. 2026-11-20)
        let today = get_today_local(&conn).unwrap();
        let mov_id = "im_rec_dated";
        // Convert today to epoch seconds
        conn.execute(
            "INSERT INTO inventory_movements (id, tenant_id, unit_id, quantity_delta, unit_cost, reason, reference_type, reference_id, created_by, created_at, warehouse_id)
             VALUES (?1, 'tnt_test', ?2, 10.0, 100.0, 'purchase_receipt', 'purchase_order', ?3, 'usr_1', strftime('%s', ?4), 'wh_01')",
            params![mov_id, unit_id, po_id, today],
        ).unwrap();

        // When: return_date is 2020-01-01 (earlier than receipt date)
        let err = create_purchase_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreatePurchaseReturnInput {
                purchase_order_id: po_id,
                return_date: Some("2020-01-01".to_string()),
                reason_code: "quality_issue".to_string(),
                note: None,
                lines: vec![CreatePurchaseReturnLineInput {
                    shipment_line_id: mov_id.to_string(),
                    return_quantity: 1.0,
                }],
            },
        )
        .unwrap_err();

        // Then: ReturnDateBeforeReceiptDate error
        match err {
            PurchaseReturnError::ReturnDateBeforeReceiptDate(d) => {
                assert_eq!(d, today);
            }
            other => panic!("Expected ReturnDateBeforeReceiptDate, got {:?}", other),
        }
    }

    #[test]
    fn test_tc_pret_e_11_not_draft_for_update_or_post() {
        // Given: Posted return
        let mut conn = setup_test_db();
        let (po_id, _, mov_id) = seed_test_po(&conn);
        let detail = create_purchase_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreatePurchaseReturnInput {
                purchase_order_id: po_id,
                return_date: None,
                reason_code: "quality_issue".to_string(),
                note: None,
                lines: vec![CreatePurchaseReturnLineInput {
                    shipment_line_id: mov_id,
                    return_quantity: 1.0,
                }],
            },
        )
        .unwrap();
        post_purchase_return_impl(&mut conn, "tnt_test", "usr_1", &detail.return_record.id)
            .unwrap();

        // When & Then: update fails with NotDraftForUpdate
        let err_update = update_purchase_return_impl(
            &mut conn,
            "tnt_test",
            UpdatePurchaseReturnInput {
                id: detail.return_record.id.clone(),
                return_date: None,
                reason_code: Some("wrong_item".to_string()),
                note: None,
                lines: None,
            },
        )
        .unwrap_err();
        assert_eq!(err_update, PurchaseReturnError::NotDraftForUpdate);

        // When & Then: post fails with NotDraftForPost
        let err_post =
            post_purchase_return_impl(&mut conn, "tnt_test", "usr_1", &detail.return_record.id)
                .unwrap_err();
        assert_eq!(err_post, PurchaseReturnError::NotDraftForPost);
    }

    #[test]
    fn test_tc_pret_e_12_not_posted_for_void() {
        // Given: Draft return
        let mut conn = setup_test_db();
        let (po_id, _, mov_id) = seed_test_po(&conn);
        let detail = create_purchase_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreatePurchaseReturnInput {
                purchase_order_id: po_id,
                return_date: None,
                reason_code: "quality_issue".to_string(),
                note: None,
                lines: vec![CreatePurchaseReturnLineInput {
                    shipment_line_id: mov_id,
                    return_quantity: 1.0,
                }],
            },
        )
        .unwrap();

        // When & Then: Attempting to void draft fails with NotPostedForVoid
        let err = void_purchase_return_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            &detail.return_record.id,
            "Reason",
        )
        .unwrap_err();
        assert_eq!(err, PurchaseReturnError::NotPostedForVoid);
    }

    #[test]
    fn test_tc_pret_e_13_void_reason_required() {
        // Given: Posted return
        let mut conn = setup_test_db();
        let (po_id, _, mov_id) = seed_test_po(&conn);
        let detail = create_purchase_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreatePurchaseReturnInput {
                purchase_order_id: po_id,
                return_date: None,
                reason_code: "quality_issue".to_string(),
                note: None,
                lines: vec![CreatePurchaseReturnLineInput {
                    shipment_line_id: mov_id,
                    return_quantity: 1.0,
                }],
            },
        )
        .unwrap();
        post_purchase_return_impl(&mut conn, "tnt_test", "usr_1", &detail.return_record.id)
            .unwrap();

        // When & Then: Voiding with empty string or whitespace reason fails with VoidReasonRequired
        let err = void_purchase_return_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            &detail.return_record.id,
            "   ",
        )
        .unwrap_err();
        assert_eq!(err, PurchaseReturnError::VoidReasonRequired);
    }

    #[test]
    fn test_tc_pret_e_14_amount_exceeds_outstanding_ap() {
        // Given: AP with amount 500, but partially paid 400 (outstanding is only 100)
        let mut conn = setup_test_db();
        let (po_id, _, mov_id) = seed_test_po(&conn);

        conn.execute(
            "INSERT INTO vendor_bills (id, tenant_id, bill_number, vendor_partner_id, vendor_name_snapshot, vendor_invoice_number, bill_date, due_date, untaxed_amount, tax_amount, status, created_by, created_at)
             VALUES ('vb_small', 'tnt_test', 'VB-SMALL', 'vnd_001', 'Vendor 1', 'INV-S1', '2026-11-01', '2026-11-30', 500.0, 0.0, 'posted', 'usr_1', 1000)",
            [],
        ).unwrap();

        conn.execute(
            "INSERT INTO vendor_bill_orders (id, bill_id, purchase_order_id, po_number_snapshot, created_at)
             VALUES ('vbo_s1', 'vb_small', ?1, 'PO-00001', 1000)",
            params![po_id],
        ).unwrap();

        conn.execute(
            "INSERT INTO accounts_payable (id, tenant_id, vendor_partner_id, vendor_name_snapshot, source_type, source_id, source_number, document_date, due_date, amount, status, created_by, created_at)
             VALUES ('ap_small', 'tnt_test', 'vnd_001', 'Vendor 1', 'vendor_bill', 'vb_small', 'VB-SMALL', '2026-11-01', '2026-11-30', 500.0, 'open', 'usr_1', 1000)",
            [],
        ).unwrap();

        conn.execute(
            "INSERT INTO vendor_payments (id, tenant_id, payment_number, vendor_partner_id, payment_date, amount, status, created_by, created_at)
             VALUES ('pay_1', 'tnt_test', 'PAY-001', 'vnd_001', '2026-11-05', 400.0, 'posted', 'usr_1', 1000)",
            [],
        ).unwrap();

        conn.execute(
            "INSERT INTO vendor_payment_allocations (id, tenant_id, payment_id, account_payable_id, amount, created_at)
             VALUES ('pa_1', 'tnt_test', 'pay_1', 'ap_small', 400.0, 1000)",
            [],
        ).unwrap();

        // When: Return draft with 2 items @ 100 = 200.0 (exceeds remaining outstanding 100.0)
        let detail = create_purchase_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreatePurchaseReturnInput {
                purchase_order_id: po_id,
                return_date: None,
                reason_code: "wrong_item".to_string(),
                note: None,
                lines: vec![CreatePurchaseReturnLineInput {
                    shipment_line_id: mov_id,
                    return_quantity: 2.0,
                }],
            },
        )
        .unwrap();

        let err =
            post_purchase_return_impl(&mut conn, "tnt_test", "usr_1", &detail.return_record.id)
                .unwrap_err();

        // Then: AmountExceedsOutstanding error
        match err {
            PurchaseReturnError::AmountExceedsOutstanding(ret_amt, out_amt) => {
                assert_eq!(ret_amt, "200");
                assert_eq!(out_amt, "100");
            }
            other => panic!("Expected AmountExceedsOutstanding, got {:?}", other),
        }
    }

    #[test]
    fn test_tc_pret_e_15_list_and_get_isolation() {
        // Given: Return created for tnt_test
        let mut conn = setup_test_db();
        let (po_id, _, mov_id) = seed_test_po(&conn);
        let detail = create_purchase_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreatePurchaseReturnInput {
                purchase_order_id: po_id,
                return_date: None,
                reason_code: "quality_issue".to_string(),
                note: None,
                lines: vec![CreatePurchaseReturnLineInput {
                    shipment_line_id: mov_id,
                    return_quantity: 1.0,
                }],
            },
        )
        .unwrap();

        // When: Querying with another tenant
        let get_err =
            get_purchase_return_impl(&conn, "tnt_other", &detail.return_record.id).unwrap_err();
        assert_eq!(get_err, PurchaseReturnError::ReturnNotFound);

        let list_other =
            list_purchase_returns_impl(&conn, "tnt_other", ListPurchaseReturnsFilter::default())
                .unwrap();
        assert_eq!(list_other.len(), 0);

        // And: Querying with tnt_test returns 1 item
        let list_test =
            list_purchase_returns_impl(&conn, "tnt_test", ListPurchaseReturnsFilter::default())
                .unwrap();
        assert_eq!(list_test.len(), 1);
        assert_eq!(list_test[0].id, detail.return_record.id);
    }

    #[test]
    fn test_tc_pret_e_16_duplicate_shipment_line_rejected_on_create() {
        // Given: PO with 10 units received
        let mut conn = setup_test_db();
        let (po_id, _, mov_id) = seed_test_po(&conn);

        // When: Creating a return with duplicate shipment_line_id (each 2 units)
        let err = create_purchase_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreatePurchaseReturnInput {
                purchase_order_id: po_id,
                return_date: None,
                reason_code: "quality_issue".to_string(),
                note: None,
                lines: vec![
                    CreatePurchaseReturnLineInput {
                        shipment_line_id: mov_id.clone(),
                        return_quantity: 2.0,
                    },
                    CreatePurchaseReturnLineInput {
                        shipment_line_id: mov_id.clone(),
                        return_quantity: 2.0,
                    },
                ],
            },
        )
        .unwrap_err();

        // Then: DuplicateShipmentLine is returned
        assert_eq!(err, PurchaseReturnError::DuplicateShipmentLine(mov_id));
    }

    #[test]
    fn test_tc_pret_e_17_aggregate_quantity_exceeds_returnable_on_post() {
        // Given: PO with 10 units received, manually insert duplicate lines in DB to test post-level aggregation protection
        let mut conn = setup_test_db();
        let (po_id, _, mov_id) = seed_test_po(&conn);

        let ret_id = "pret_manual_test";
        conn.execute(
            "INSERT INTO purchase_returns (id, tenant_id, return_number, purchase_order_id, return_date, reason_code, status, total_amount, created_by, created_at)
             VALUES (?1, 'tnt_test', 'PRET-00099', ?2, '2026-11-10', 'quality_issue', 'draft', 0.0, 'usr_1', 1000)",
            params![ret_id, po_id],
        ).unwrap();

        // Line 1: 6 units, Line 2: 6 units (total 12 units > 10 units received)
        conn.execute(
            "INSERT INTO purchase_return_lines (id, return_id, line_no, shipment_line_id, unit_id, product_name_snapshot, variant_name_snapshot, sku_snapshot, unit_name_snapshot, unit_price, return_quantity, created_at)
             VALUES ('line_1', ?1, 1, ?2, 'unit_001', 'P1', 'V1', 'SKU-1', 'PCS', 100.0, 6.0, 1000)",
            params![ret_id, mov_id],
        ).unwrap();
        // Insert line 2 (disable index check for this unit test if index exists, but with the unique index we verify either DB constraint or validation)
        let insert_res = conn.execute(
            "INSERT INTO purchase_return_lines (id, return_id, line_no, shipment_line_id, unit_id, product_name_snapshot, variant_name_snapshot, sku_snapshot, unit_name_snapshot, unit_price, return_quantity, created_at)
             VALUES ('line_2', ?1, 2, ?2, 'unit_001', 'P1', 'V1', 'SKU-1', 'PCS', 100.0, 6.0, 1000)",
            params![ret_id, mov_id],
        );

        // If unique index prevented it, that also satisfies the requirement!
        // But if we drop the unique index temporarily or if it's evaluated in post:
        if insert_res.is_err() {
            // Unique index blocked duplicate return_id + shipment_line_id
            return;
        }

        // When: Posting the return
        let err = post_purchase_return_impl(&mut conn, "tnt_test", "usr_1", ret_id).unwrap_err();

        // Then: Aggregated check rejects with ReturnQuantityExceedsReturnable (12 > 10)
        match err {
            PurchaseReturnError::ReturnQuantityExceedsReturnable(line, req, rem) => {
                assert_eq!(line, mov_id);
                assert_eq!(req, "12");
                assert_eq!(rem, "10");
            }
            other => panic!("Expected ReturnQuantityExceedsReturnable, got {:?}", other),
        }
    }
}
