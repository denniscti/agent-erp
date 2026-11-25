use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static SRET_ID_COUNTER: AtomicU64 = AtomicU64::new(1);
static SRETL_ID_COUNTER: AtomicU64 = AtomicU64::new(1);
static MOV_SRET_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

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
pub enum SalesReturnError {
    #[error("租戶 ID 不可為空")]
    EmptyTenantId,

    #[error("找不到指定的租戶")]
    TenantNotFound,

    #[error("租戶未啟用或已停用")]
    TenantNotActive,

    #[error("找不到指定的退回單")]
    ReturnNotFound,

    #[error("找不到指定的銷售訂單")]
    SalesOrderNotFound,

    #[error("找不到指定的出貨明細")]
    ShipmentLineNotFound,

    #[error("退回明細不可為空")]
    EmptyReturnLines,

    #[error("退回原因類型僅支援：quality_issue、wrong_item、customer_cancel、other")]
    InvalidReasonCode,

    #[error("退回數量必須大於 0")]
    InvalidReturnQuantity,

    #[error("出貨明細 {0} 退回數量 {1} 超過可退數量剩餘 {2}")]
    ReturnQuantityExceedsReturnable(String, String, String),

    #[error("退回日期不可晚於今天")]
    ReturnDateAfterToday,

    #[error("退回日期不可早於出貨日 {0}")]
    ReturnDateBeforeShipDate(String),

    #[error("退回金額 {0} 超過應收未收餘額 {1}；客戶已付款需退款的情境不在本輪範圍")]
    AmountExceedsOutstanding(String, String),

    #[error("無效的狀態轉換：不可從 {0} 轉換至 {1}")]
    InvalidStateTransition(String, String),

    #[error("作廢原因必填")]
    VoidReasonRequired,

    #[error("僅草稿狀態可修改")]
    NotDraftForUpdate,

    #[error("僅已過帳狀態可作廢")]
    NotPostedForVoid,

    #[error("資料庫錯誤: {0}")]
    DatabaseError(String),
}

impl Serialize for SalesReturnError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<rusqlite::Error> for SalesReturnError {
    fn from(e: rusqlite::Error) -> Self {
        SalesReturnError::DatabaseError(e.to_string())
    }
}

// ==========================================
// Structs
// ==========================================

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct SalesReturn {
    pub id: String,
    pub tenant_id: String,
    pub return_number: String,
    pub sales_order_id: String,
    pub customer_invoice_id: Option<String>,
    pub account_receivable_id: Option<String>,
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
pub struct SalesReturnLine {
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
pub struct SalesReturnDetail {
    pub return_record: SalesReturn,
    pub lines: Vec<SalesReturnLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct CreateSalesReturnLineInput {
    pub shipment_line_id: String,
    pub return_quantity: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct CreateSalesReturnInput {
    pub sales_order_id: String,
    pub return_date: Option<String>,
    pub reason_code: String,
    pub note: Option<String>,
    pub lines: Vec<CreateSalesReturnLineInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct UpdateSalesReturnInput {
    pub id: String,
    pub return_date: Option<String>,
    pub reason_code: Option<String>,
    pub note: Option<String>,
    pub lines: Option<Vec<CreateSalesReturnLineInput>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
pub struct ListSalesReturnsFilter {
    pub sales_order_id: Option<String>,
    pub status: Option<String>,
    pub reason_code: Option<String>,
}

// ==========================================
// Tables Initialization
// ==========================================

pub fn create_sales_returns_tables(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS sales_returns (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            return_number TEXT NOT NULL,
            sales_order_id TEXT NOT NULL,
            customer_invoice_id TEXT,
            account_receivable_id TEXT,
            return_date TEXT NOT NULL,
            reason_code TEXT NOT NULL CHECK(reason_code IN ('quality_issue', 'wrong_item', 'customer_cancel', 'other')),
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
            FOREIGN KEY (sales_order_id) REFERENCES sales_orders(id)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_sret_tenant_number ON sales_returns (tenant_id, return_number);
        CREATE INDEX IF NOT EXISTS idx_sret_order ON sales_returns (tenant_id, sales_order_id);
        CREATE INDEX IF NOT EXISTS idx_sret_ar ON sales_returns (tenant_id, account_receivable_id);

        CREATE TABLE IF NOT EXISTS sales_return_lines (
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
            FOREIGN KEY (return_id) REFERENCES sales_returns(id),
            FOREIGN KEY (shipment_line_id) REFERENCES sales_shipment_lines(id)
        );
        CREATE INDEX IF NOT EXISTS idx_sretl_return ON sales_return_lines (return_id);
        CREATE INDEX IF NOT EXISTS idx_sretl_shpl ON sales_return_lines (shipment_line_id);",
    )?;
    Ok(())
}

fn verify_active_tenant(conn: &Connection, tenant_id: &str) -> Result<(), SalesReturnError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(SalesReturnError::EmptyTenantId);
    }
    let status_res: Result<String, _> = conn.query_row(
        "SELECT status FROM tenants WHERE id = ?1",
        params![tid],
        |r| r.get(0),
    );
    match status_res {
        Ok(s) if s == "active" => Ok(()),
        Ok(_) => Err(SalesReturnError::TenantNotActive),
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            if table_exists(conn, "tenants") {
                Err(SalesReturnError::TenantNotFound)
            } else {
                Ok(())
            }
        }
        Err(e) => Err(SalesReturnError::DatabaseError(e.to_string())),
    }
}

fn generate_return_id(now: i64) -> String {
    format!(
        "sret_{}_{}",
        now,
        SRET_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

fn generate_return_line_id(now: i64) -> String {
    format!(
        "sretl_{}_{}",
        now,
        SRETL_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

fn generate_next_return_number(
    conn: &Connection,
    tenant_id: &str,
) -> Result<String, SalesReturnError> {
    let max_num: Result<Option<String>, _> = conn.query_row(
        "SELECT return_number FROM sales_returns WHERE tenant_id = ?1 ORDER BY return_number DESC LIMIT 1",
        params![tenant_id],
        |r| r.get(0),
    );
    let next_seq = match max_num {
        Ok(Some(num)) => {
            if let Some(digits) = num.strip_prefix("SRET-") {
                digits.parse::<i64>().unwrap_or(0) + 1
            } else {
                1
            }
        }
        _ => 1,
    };
    Ok(format!("SRET-{:05}", next_seq))
}

fn validate_reason_code(reason: &str) -> Result<&str, SalesReturnError> {
    let r = reason.trim();
    match r {
        "quality_issue" | "wrong_item" | "customer_cancel" | "other" => Ok(r),
        _ => Err(SalesReturnError::InvalidReasonCode),
    }
}

struct ShipmentLineInfo {
    id: String,
    unit_id: String,
    product_name_snapshot: String,
    variant_name_snapshot: String,
    sku_snapshot: Option<String>,
    unit_name_snapshot: String,
    unit_price: f64,
    shipped_quantity: f64,
    ship_date: String,
    warehouse_id: String,
}

fn fetch_and_validate_shipment_line(
    conn: &Connection,
    tenant_id: &str,
    sales_order_id: &str,
    shipment_line_id: &str,
    requested_qty: f64,
    exclude_return_id: Option<&str>,
) -> Result<ShipmentLineInfo, SalesReturnError> {
    if requested_qty <= 0.0 {
        return Err(SalesReturnError::InvalidReturnQuantity);
    }

    let line_row = conn.query_row(
        "SELECT shpl.id, shpl.unit_id, shpl.product_name_snapshot, shpl.variant_name_snapshot,
                shpl.sku_snapshot, shpl.unit_name_snapshot, shpl.unit_price, shpl.shipped_quantity,
                shp.ship_date, shp.warehouse_id
         FROM sales_shipment_lines shpl
         JOIN sales_shipments shp ON shp.id = shpl.shipment_id AND shp.tenant_id = ?1
         WHERE shpl.id = ?2 AND shp.sales_order_id = ?3",
        params![tenant_id, shipment_line_id, sales_order_id],
        |r| {
            Ok(ShipmentLineInfo {
                id: r.get(0)?,
                unit_id: r.get(1)?,
                product_name_snapshot: r.get(2)?,
                variant_name_snapshot: r.get(3)?,
                sku_snapshot: r.get(4)?,
                unit_name_snapshot: r.get(5)?,
                unit_price: r.get(6)?,
                shipped_quantity: r.get(7)?,
                ship_date: r.get(8)?,
                warehouse_id: r.get(9)?,
            })
        },
    );

    let info = match line_row {
        Ok(v) => v,
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            return Err(SalesReturnError::ShipmentLineNotFound)
        }
        Err(e) => return Err(SalesReturnError::DatabaseError(e.to_string())),
    };

    // Calculate cumulative posted returned quantity
    let posted_returned_qty: f64 = match exclude_return_id {
        Some(ex_id) => conn
            .query_row(
                "SELECT COALESCE(SUM(srl.return_quantity), 0.0)
                 FROM sales_return_lines srl
                 JOIN sales_returns sr ON sr.id = srl.return_id AND sr.tenant_id = ?1
                 WHERE srl.shipment_line_id = ?2 AND sr.status = 'posted' AND sr.id != ?3",
                params![tenant_id, shipment_line_id, ex_id],
                |r| r.get(0),
            )
            .unwrap_or(0.0),
        None => conn
            .query_row(
                "SELECT COALESCE(SUM(srl.return_quantity), 0.0)
                 FROM sales_return_lines srl
                 JOIN sales_returns sr ON sr.id = srl.return_id AND sr.tenant_id = ?1
                 WHERE srl.shipment_line_id = ?2 AND sr.status = 'posted'",
                params![tenant_id, shipment_line_id],
                |r| r.get(0),
            )
            .unwrap_or(0.0),
    };

    let remaining_returnable = round_2(info.shipped_quantity - posted_returned_qty);
    if requested_qty > remaining_returnable + 1e-6 {
        return Err(SalesReturnError::ReturnQuantityExceedsReturnable(
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

pub fn create_sales_return_impl(
    conn: &mut Connection,
    tenant_id: &str,
    created_by: &str,
    input: CreateSalesReturnInput,
) -> Result<SalesReturnDetail, SalesReturnError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(SalesReturnError::EmptyTenantId);
    }
    verify_active_tenant(conn, tid)?;

    let so_id = input.sales_order_id.trim();
    if so_id.is_empty() {
        return Err(SalesReturnError::SalesOrderNotFound);
    }

    // Verify order exists
    let so_exists: bool = conn
        .query_row(
            "SELECT 1 FROM sales_orders WHERE id = ?1 AND tenant_id = ?2",
            params![so_id, tid],
            |_| Ok(true),
        )
        .optional()?
        .unwrap_or(false);
    if !so_exists {
        return Err(SalesReturnError::SalesOrderNotFound);
    }

    if input.lines.is_empty() {
        return Err(SalesReturnError::EmptyReturnLines);
    }

    let reason_code = validate_reason_code(&input.reason_code)?;
    let today = get_today_local(conn).unwrap_or_else(|_| "1970-01-01".to_string());
    let return_date = input.return_date.unwrap_or_else(|| today.clone());

    if return_date.as_str() > today.as_str() {
        return Err(SalesReturnError::ReturnDateAfterToday);
    }

    // Validate lines and check ship_date
    let mut validated_lines = Vec::new();
    for (idx, line_input) in input.lines.iter().enumerate() {
        let line_info = fetch_and_validate_shipment_line(
            conn,
            tid,
            so_id,
            line_input.shipment_line_id.trim(),
            line_input.return_quantity,
            None,
        )?;

        if return_date.as_str() < line_info.ship_date.as_str() {
            return Err(SalesReturnError::ReturnDateBeforeShipDate(
                line_info.ship_date,
            ));
        }

        validated_lines.push((idx as i64 + 1, line_input.return_quantity, line_info));
    }

    let now = current_timestamp();
    let return_id = generate_return_id(now);
    let return_number = generate_next_return_number(conn, tid)?;

    let tx = conn.transaction()?;

    tx.execute(
        "INSERT INTO sales_returns (
            id, tenant_id, return_number, sales_order_id, customer_invoice_id,
            account_receivable_id, return_date, reason_code, status, total_amount,
            note, created_by, created_at
        ) VALUES (?1, ?2, ?3, ?4, NULL, NULL, ?5, ?6, 'draft', 0.0, ?7, ?8, ?9)",
        params![
            return_id,
            tid,
            return_number,
            so_id,
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
            "INSERT INTO sales_return_lines (
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
                info.unit_price,
                qty,
                now,
            ],
        )?;
    }

    tx.commit()?;

    get_sales_return_impl(conn, tid, &return_id)
}

pub fn update_sales_return_impl(
    conn: &mut Connection,
    tenant_id: &str,
    input: UpdateSalesReturnInput,
) -> Result<SalesReturnDetail, SalesReturnError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(SalesReturnError::EmptyTenantId);
    }
    verify_active_tenant(conn, tid)?;

    let existing = get_sales_return_impl(conn, tid, &input.id)?;
    if existing.return_record.status != "draft" {
        return Err(SalesReturnError::NotDraftForUpdate);
    }

    let today = get_today_local(conn).unwrap_or_else(|_| "1970-01-01".to_string());
    let return_date = input
        .return_date
        .unwrap_or_else(|| existing.return_record.return_date.clone());

    if return_date.as_str() > today.as_str() {
        return Err(SalesReturnError::ReturnDateAfterToday);
    }

    let reason_code = match input.reason_code {
        Some(ref r) => validate_reason_code(r)?,
        None => existing.return_record.reason_code.as_str(),
    };

    let note = match input.note {
        Some(n) => Some(n),
        None => existing.return_record.note,
    };

    let tx = conn.transaction()?;

    tx.execute(
        "UPDATE sales_returns
         SET return_date = ?1, reason_code = ?2, note = ?3
         WHERE id = ?4 AND tenant_id = ?5 AND status = 'draft'",
        params![return_date, reason_code, note, input.id, tid],
    )?;

    if let Some(new_lines) = input.lines {
        if new_lines.is_empty() {
            return Err(SalesReturnError::EmptyReturnLines);
        }

        let mut validated_lines = Vec::new();
        for (idx, line_input) in new_lines.iter().enumerate() {
            let line_info = fetch_and_validate_shipment_line(
                &tx,
                tid,
                &existing.return_record.sales_order_id,
                line_input.shipment_line_id.trim(),
                line_input.return_quantity,
                Some(&input.id),
            )?;

            if return_date.as_str() < line_info.ship_date.as_str() {
                return Err(SalesReturnError::ReturnDateBeforeShipDate(
                    line_info.ship_date,
                ));
            }

            validated_lines.push((idx as i64 + 1, line_input.return_quantity, line_info));
        }

        tx.execute(
            "DELETE FROM sales_return_lines WHERE return_id = ?1",
            params![input.id],
        )?;

        let now = current_timestamp();
        for (line_no, qty, info) in validated_lines {
            let line_id = generate_return_line_id(now);
            tx.execute(
                "INSERT INTO sales_return_lines (
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
                    info.unit_price,
                    qty,
                    now,
                ],
            )?;
        }
    }

    tx.commit()?;

    get_sales_return_impl(conn, tid, &input.id)
}

pub fn post_sales_return_impl(
    conn: &mut Connection,
    tenant_id: &str,
    posted_by: &str,
    return_id: &str,
) -> Result<SalesReturnDetail, SalesReturnError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(SalesReturnError::EmptyTenantId);
    }
    verify_active_tenant(conn, tid)?;

    let target_id = return_id.trim();
    if target_id.is_empty() {
        return Err(SalesReturnError::ReturnNotFound);
    }

    let tx = conn.transaction()?;

    // 1. Fetch return record
    let return_row = tx.query_row(
        "SELECT id, sales_order_id, return_date, reason_code, status
         FROM sales_returns
         WHERE id = ?1 AND tenant_id = ?2",
        params![target_id, tid],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
            ))
        },
    );

    let (id, sales_order_id, return_date, _reason_code, status) = match return_row {
        Ok(v) => v,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Err(SalesReturnError::ReturnNotFound),
        Err(e) => return Err(SalesReturnError::DatabaseError(e.to_string())),
    };

    if status != "draft" {
        return Err(SalesReturnError::InvalidStateTransition(
            status,
            "posted".to_string(),
        ));
    }

    let today = get_today_local(&tx).unwrap_or_else(|_| "1970-01-01".to_string());
    if return_date.as_str() > today.as_str() {
        return Err(SalesReturnError::ReturnDateAfterToday);
    }

    // 2. Fetch lines
    let lines = {
        let mut stmt = tx.prepare(
            "SELECT id, shipment_line_id, unit_id, return_quantity, unit_price
             FROM sales_return_lines
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
        return Err(SalesReturnError::EmptyReturnLines);
    }

    // Validate lines and collect details
    let mut validated_lines = Vec::new();
    let mut untaxed_return_total = 0.0;

    for (line_id, shipment_line_id, _unit_id, return_qty, unit_price) in lines {
        let line_info = fetch_and_validate_shipment_line(
            &tx,
            tid,
            &sales_order_id,
            &shipment_line_id,
            return_qty,
            Some(&id),
        )?;

        if return_date.as_str() < line_info.ship_date.as_str() {
            return Err(SalesReturnError::ReturnDateBeforeShipDate(
                line_info.ship_date,
            ));
        }

        untaxed_return_total += round_2(return_qty * unit_price);
        validated_lines.push((line_id, shipment_line_id, return_qty, line_info));
    }

    untaxed_return_total = round_2(untaxed_return_total);

    // 3. Inventory movements for each line
    let now = current_timestamp();
    for (_line_id, shipment_line_id, return_qty, line_info) in &validated_lines {
        // Query unit_cost from original shipment inventory movement
        let shipment_unit_cost: Option<f64> = tx
            .query_row(
                "SELECT im.unit_cost
                 FROM inventory_movements im
                 JOIN sales_shipments shp ON shp.sales_order_id = im.reference_id AND shp.warehouse_id = im.warehouse_id
                 JOIN sales_shipment_lines shpl ON shpl.shipment_id = shp.id AND shpl.unit_id = im.unit_id
                 WHERE shpl.id = ?1 AND im.reason = 'sales_shipment'
                 ORDER BY ABS(im.created_at - shpl.created_at) ASC
                 LIMIT 1",
                params![shipment_line_id],
                |r| r.get(0),
            )
            .optional()?
            .flatten();

        let unit_cost = match shipment_unit_cost {
            Some(c) => c,
            None => {
                // Fallback to weighted average cost if not found
                crate::inventory_costing::calculate_weighted_average_cost(
                    &tx,
                    tid,
                    &line_info.unit_id,
                    &line_info.warehouse_id,
                    Some(now),
                )
                .unwrap_or(0.0)
            }
        };

        let mov_id = format!(
            "mov_sret_{}_{}",
            now,
            MOV_SRET_ID_COUNTER.fetch_add(1, Ordering::SeqCst)
        );

        tx.execute(
            "INSERT INTO inventory_movements (
                id, tenant_id, unit_id, warehouse_id, quantity_delta, unit_cost,
                reason, reference_type, reference_id, created_by, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'sales_return', 'sales_return', ?7, ?8, ?9)",
            params![
                mov_id,
                tid,
                line_info.unit_id,
                line_info.warehouse_id,
                *return_qty,
                unit_cost,
                id,
                posted_by,
                now,
            ],
        )?;
    }

    // 4. Accounts Receivable offset check
    // Check if sales_order has a posted customer_invoice
    let invoice_info_opt: Option<(String, f64, f64)> = if table_exists(
        &tx,
        "customer_invoice_orders",
    ) && table_exists(
        &tx,
        "customer_invoices",
    ) {
        tx.query_row(
            "SELECT ci.id, ci.untaxed_amount, ci.tax_amount
             FROM customer_invoices ci
             JOIN customer_invoice_orders cio ON cio.customer_invoice_id = ci.id AND cio.tenant_id = ci.tenant_id
             WHERE cio.sales_order_id = ?1 AND ci.tenant_id = ?2 AND ci.status = 'posted'
             LIMIT 1",
            params![sales_order_id, tid],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?
    } else {
        None
    };

    let (customer_invoice_id, account_receivable_id, total_amount) = match invoice_info_opt {
        Some((inv_id, inv_untaxed, inv_tax)) => {
            // Find linked open AR
            let ar_opt: Option<(String, f64, String)> = tx
                .query_row(
                    "SELECT id, amount, status
                     FROM accounts_receivable
                     WHERE source_type = 'customer_invoice' AND source_id = ?1 AND tenant_id = ?2 AND status = 'open'
                     LIMIT 1",
                    params![inv_id, tid],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .optional()?;

            match ar_opt {
                Some((ar_id, ar_amount, _ar_status)) => {
                    // Compute return tax proportion
                    let tax_rate = if inv_untaxed > 0.0 && inv_tax > 0.0 {
                        inv_tax / inv_untaxed
                    } else {
                        0.0
                    };
                    let tax_return = round_2(untaxed_return_total * tax_rate);
                    let return_total = round_2(untaxed_return_total + tax_return);

                    // Compute current AR outstanding before this return
                    let received_amount: f64 = if table_exists(&tx, "customer_receipt_allocations")
                        && table_exists(&tx, "customer_receipts")
                    {
                        tx.query_row(
                            "SELECT COALESCE(SUM(ra.amount), 0.0)
                             FROM customer_receipt_allocations ra
                             JOIN customer_receipts r ON r.id = ra.receipt_id AND r.tenant_id = ra.tenant_id
                             WHERE ra.account_receivable_id = ?1 AND ra.tenant_id = ?2 AND r.status = 'posted'",
                            params![ar_id, tid],
                            |r| r.get(0),
                        )
                        .unwrap_or(0.0)
                    } else {
                        0.0
                    };

                    let posted_allowances: f64 = if table_exists(&tx, "sales_allowances") {
                        tx.query_row(
                            "SELECT COALESCE(SUM(untaxed_amount + tax_amount), 0.0)
                             FROM sales_allowances
                             WHERE account_receivable_id = ?1 AND tenant_id = ?2 AND status = 'posted'",
                            params![ar_id, tid],
                            |r| r.get(0),
                        )
                        .unwrap_or(0.0)
                    } else {
                        0.0
                    };

                    let other_posted_returns: f64 = tx
                        .query_row(
                            "SELECT COALESCE(SUM(total_amount), 0.0)
                             FROM sales_returns
                             WHERE account_receivable_id = ?1 AND tenant_id = ?2 AND status = 'posted' AND id != ?3",
                            params![ar_id, tid, id],
                            |r| r.get(0),
                        )
                        .unwrap_or(0.0);

                    let current_outstanding = round_2(
                        ar_amount - received_amount - posted_allowances - other_posted_returns,
                    );

                    if return_total > current_outstanding + 1e-6 {
                        return Err(SalesReturnError::AmountExceedsOutstanding(
                            format_amount(return_total),
                            format_amount(current_outstanding),
                        ));
                    }

                    (Some(inv_id), Some(ar_id), return_total)
                }
                None => (Some(inv_id), None, untaxed_return_total),
            }
        }
        None => {
            // Uninvoiced order
            (None, None, untaxed_return_total)
        }
    };

    tx.execute(
        "UPDATE sales_returns
         SET status = 'posted', posted_by = ?1, posted_at = ?2,
             customer_invoice_id = ?3, account_receivable_id = ?4, total_amount = ?5
         WHERE id = ?6 AND tenant_id = ?7 AND status = 'draft'",
        params![
            posted_by,
            now,
            customer_invoice_id,
            account_receivable_id,
            total_amount,
            target_id,
            tid,
        ],
    )?;

    tx.commit()?;

    get_sales_return_impl(conn, tid, target_id)
}

pub fn void_sales_return_impl(
    conn: &mut Connection,
    tenant_id: &str,
    voided_by: &str,
    return_id: &str,
    void_reason: &str,
) -> Result<SalesReturnDetail, SalesReturnError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(SalesReturnError::EmptyTenantId);
    }
    verify_active_tenant(conn, tid)?;

    let target_id = return_id.trim();
    if target_id.is_empty() {
        return Err(SalesReturnError::ReturnNotFound);
    }

    let reason = void_reason.trim();
    if reason.is_empty() {
        return Err(SalesReturnError::VoidReasonRequired);
    }

    let tx = conn.transaction()?;

    let return_status: String = match tx.query_row(
        "SELECT status FROM sales_returns WHERE id = ?1 AND tenant_id = ?2",
        params![target_id, tid],
        |r| r.get(0),
    ) {
        Ok(s) => s,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Err(SalesReturnError::ReturnNotFound),
        Err(e) => return Err(SalesReturnError::DatabaseError(e.to_string())),
    };

    if return_status != "posted" {
        return Err(SalesReturnError::NotPostedForVoid);
    }

    // Fetch lines to reverse inventory
    let lines = {
        let mut stmt = tx.prepare(
            "SELECT srl.unit_id, srl.return_quantity, shp.warehouse_id
             FROM sales_return_lines srl
             JOIN sales_shipment_lines shpl ON shpl.id = srl.shipment_line_id
             JOIN sales_shipments shp ON shp.id = shpl.shipment_id
             WHERE srl.return_id = ?1",
        )?;

        let line_rows = stmt.query_map(params![target_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, f64>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?;

        let mut lines = Vec::new();
        for l in line_rows {
            lines.push(l?);
        }
        lines
    };

    let now = current_timestamp();

    // Insert reversing inventory movements (-qty)
    for (unit_id, return_qty, warehouse_id) in lines {
        // Query unit_cost from the posted sales_return movement
        let return_unit_cost: Option<f64> = tx
            .query_row(
                "SELECT unit_cost FROM inventory_movements
                 WHERE reference_id = ?1 AND reference_type = 'sales_return' AND unit_id = ?2
                 LIMIT 1",
                params![target_id, unit_id],
                |r| r.get(0),
            )
            .optional()?
            .flatten();

        let unit_cost = return_unit_cost.unwrap_or(0.0);
        let mov_id = format!(
            "mov_sret_void_{}_{}",
            now,
            MOV_SRET_ID_COUNTER.fetch_add(1, Ordering::SeqCst)
        );

        tx.execute(
            "INSERT INTO inventory_movements (
                id, tenant_id, unit_id, warehouse_id, quantity_delta, unit_cost,
                reason, reference_type, reference_id, created_by, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'sales_return_void', 'sales_return', ?7, ?8, ?9)",
            params![
                mov_id,
                tid,
                unit_id,
                warehouse_id,
                -return_qty,
                unit_cost,
                target_id,
                voided_by,
                now,
            ],
        )?;
    }

    tx.execute(
        "UPDATE sales_returns
         SET status = 'void', voided_by = ?1, voided_at = ?2, void_reason = ?3
         WHERE id = ?4 AND tenant_id = ?5 AND status = 'posted'",
        params![voided_by, now, reason, target_id, tid],
    )?;

    tx.commit()?;

    get_sales_return_impl(conn, tid, target_id)
}

pub fn get_sales_return_impl(
    conn: &Connection,
    tenant_id: &str,
    return_id: &str,
) -> Result<SalesReturnDetail, SalesReturnError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(SalesReturnError::EmptyTenantId);
    }
    let target_id = return_id.trim();
    if target_id.is_empty() {
        return Err(SalesReturnError::ReturnNotFound);
    }

    let ret_res = conn.query_row(
        "SELECT id, tenant_id, return_number, sales_order_id, customer_invoice_id,
                account_receivable_id, return_date, reason_code, status, total_amount,
                note, created_by, created_at, posted_by, posted_at, voided_by, voided_at, void_reason
         FROM sales_returns
         WHERE id = ?1 AND tenant_id = ?2",
        params![target_id, tid],
        |r| {
            Ok(SalesReturn {
                id: r.get(0)?,
                tenant_id: r.get(1)?,
                return_number: r.get(2)?,
                sales_order_id: r.get(3)?,
                customer_invoice_id: r.get(4)?,
                account_receivable_id: r.get(5)?,
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
        Err(rusqlite::Error::QueryReturnedNoRows) => return Err(SalesReturnError::ReturnNotFound),
        Err(e) => return Err(SalesReturnError::DatabaseError(e.to_string())),
    };

    let mut stmt = conn.prepare(
        "SELECT id, return_id, line_no, shipment_line_id, unit_id,
                product_name_snapshot, variant_name_snapshot, sku_snapshot,
                unit_name_snapshot, unit_price, return_quantity, created_at
         FROM sales_return_lines
         WHERE return_id = ?1
         ORDER BY line_no ASC",
    )?;

    let line_rows = stmt.query_map(params![target_id], |r| {
        Ok(SalesReturnLine {
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

    Ok(SalesReturnDetail {
        return_record,
        lines,
    })
}

pub fn list_sales_returns_impl(
    conn: &Connection,
    tenant_id: &str,
    filter: ListSalesReturnsFilter,
) -> Result<Vec<SalesReturn>, SalesReturnError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(SalesReturnError::EmptyTenantId);
    }

    let mut query = "SELECT id, tenant_id, return_number, sales_order_id, customer_invoice_id,
                            account_receivable_id, return_date, reason_code, status, total_amount,
                            note, created_by, created_at, posted_by, posted_at, voided_by, voided_at, void_reason
                     FROM sales_returns
                     WHERE tenant_id = ?1".to_string();

    let mut param_values: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(tid.to_string())];

    if let Some(ref so_id) = filter.sales_order_id {
        let s = so_id.trim();
        if !s.is_empty() {
            param_values.push(Box::new(s.to_string()));
            query.push_str(&format!(" AND sales_order_id = ?{}", param_values.len()));
        }
    }

    if let Some(ref st) = filter.status {
        let s = st.trim();
        if !s.is_empty() {
            param_values.push(Box::new(s.to_string()));
            query.push_str(&format!(" AND status = ?{}", param_values.len()));
        }
    }

    if let Some(ref rc) = filter.reason_code {
        let r = rc.trim();
        if !r.is_empty() {
            param_values.push(Box::new(r.to_string()));
            query.push_str(&format!(" AND reason_code = ?{}", param_values.len()));
        }
    }

    query.push_str(" ORDER BY created_at DESC");

    let mut stmt = conn
        .prepare(&query)
        .map_err(|e| SalesReturnError::DatabaseError(e.to_string()))?;

    let params_slice: Vec<&dyn rusqlite::ToSql> = param_values.iter().map(|b| b.as_ref()).collect();

    let rows = stmt.query_map(params_slice.as_slice(), |r| {
        Ok(SalesReturn {
            id: r.get(0)?,
            tenant_id: r.get(1)?,
            return_number: r.get(2)?,
            sales_order_id: r.get(3)?,
            customer_invoice_id: r.get(4)?,
            account_receivable_id: r.get(5)?,
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

    let mut res = Vec::new();
    for row in rows {
        res.push(row?);
    }
    Ok(res)
}

// ==========================================
// Tauri Commands
// ==========================================

#[tauri::command]
pub fn create_sales_return(
    app_handle: tauri::AppHandle,
    input: CreateSalesReturnInput,
) -> Result<SalesReturnDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| format!("DB Open Error: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;

    create_sales_return_impl(&mut conn, &active_tid, &active_uid, input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_sales_return(
    app_handle: tauri::AppHandle,
    input: UpdateSalesReturnInput,
) -> Result<SalesReturnDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| format!("DB Open Error: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;

    update_sales_return_impl(&mut conn, &active_tid, input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn post_sales_return(
    app_handle: tauri::AppHandle,
    return_id: String,
) -> Result<SalesReturnDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| format!("DB Open Error: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;

    post_sales_return_impl(&mut conn, &active_tid, &active_uid, &return_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn void_sales_return(
    app_handle: tauri::AppHandle,
    return_id: String,
    void_reason: String,
) -> Result<SalesReturnDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| format!("DB Open Error: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;

    void_sales_return_impl(
        &mut conn,
        &active_tid,
        &active_uid,
        &return_id,
        &void_reason,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_sales_return(
    app_handle: tauri::AppHandle,
    return_id: String,
) -> Result<SalesReturnDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let conn = Connection::open(&db_path).map_err(|e| format!("DB Open Error: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;

    get_sales_return_impl(&conn, &active_tid, &return_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_sales_returns(
    app_handle: tauri::AppHandle,
    filter: ListSalesReturnsFilter,
) -> Result<Vec<SalesReturn>, String> {
    let db_path = crate::get_db_path(&app_handle);
    let conn = Connection::open(&db_path).map_err(|e| format!("DB Open Error: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;

    list_sales_returns_impl(&conn, &active_tid, filter).map_err(|e| e.to_string())
}

// ==========================================
// Unit Tests (Test Strategy Compliant)
// ==========================================

#[cfg(test)]
pub mod tests {
    use super::*;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::partners::create_partners_table(&conn).unwrap();
        crate::accounts_receivable::create_accounts_receivable_tables(&conn).unwrap();
        crate::customer_invoices::create_customer_invoices_tables(&conn).unwrap();
        crate::sales_orders::create_sales_orders_tables(&conn).unwrap();
        crate::sales_allowances::create_sales_allowances_tables(&conn).unwrap();
        create_sales_returns_tables(&conn).unwrap();

        // Create inventory_movements table
        conn.execute(
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
            )",
            [],
        )
        .unwrap();

        // Create tenants table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS tenants (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                status TEXT NOT NULL
            )",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tenants (id, name, status) VALUES ('tnt_test', 'Test Tenant', 'active')",
            [],
        )
        .unwrap();

        conn
    }

    fn insert_test_sales_order_and_shipment(
        conn: &Connection,
        tenant_id: &str,
        so_id: &str,
        unit_id: &str,
        shipped_qty: f64,
        unit_price: f64,
        ship_date: &str,
    ) -> (String, String) {
        let now = current_timestamp();

        // Partner
        conn.execute(
            "INSERT OR IGNORE INTO partners (id, tenant_id, name, is_customer, is_vendor, created_at)
             VALUES ('cus_1', ?1, 'Test Customer', 1, 0, ?2)",
            params![tenant_id, now],
        ).unwrap();

        // Sales Order
        conn.execute(
            "INSERT INTO sales_orders (
                id, tenant_id, so_number, customer_partner_id, customer_name_snapshot,
                source_quote_id, warehouse_id, currency, status, ship_date,
                created_by, created_at, confirmed_at, shipped_at
            ) VALUES (?1, ?2, 'SO-0001', 'cus_1', 'Test Customer', ?1, 'wh_1', 'TWD', 'shipped', ?3, 'usr_1', ?4, ?4, ?4)",
            params![so_id, tenant_id, ship_date, now],
        ).unwrap();

        // Sales Order Line
        conn.execute(
            "INSERT INTO sales_order_lines (
                id, sales_order_id, line_no, unit_id, product_name_snapshot, variant_name_snapshot,
                sku_snapshot, unit_name_snapshot, quantity, shipped_quantity, unit_price, standard_price_snapshot, created_at
            ) VALUES ('sol_1', ?1, 1, ?2, '筆電', '標配', 'SKU-001', '台', ?3, ?3, ?4, ?4, ?5)",
            params![so_id, unit_id, shipped_qty, unit_price, now],
        ).unwrap();

        // Shipment
        let shp_id = format!("shp_{}", so_id);
        conn.execute(
            "INSERT INTO sales_shipments (
                id, tenant_id, sales_order_id, shipment_number, warehouse_id,
                ship_date, note, shipped_by, shipped_at, created_at
            ) VALUES (?1, ?2, ?3, 'SHP-0001', 'wh_1', ?4, NULL, 'usr_1', ?5, ?5)",
            params![shp_id, tenant_id, so_id, ship_date, now],
        )
        .unwrap();

        // Shipment Line
        let shpl_id = format!("shpl_{}", so_id);
        conn.execute(
            "INSERT INTO sales_shipment_lines (
                id, shipment_id, sales_order_line_id, line_no, unit_id,
                product_name_snapshot, variant_name_snapshot, sku_snapshot,
                unit_name_snapshot, shipped_quantity, unit_price, created_at
            ) VALUES (?1, ?2, 'sol_1', 1, ?3, '筆電', '標配', 'SKU-001', '台', ?4, ?5, ?6)",
            params![shpl_id, shp_id, unit_id, shipped_qty, unit_price, now],
        )
        .unwrap();

        // Shipment inventory movement
        let mov_id = format!("mov_shp_{}", so_id);
        conn.execute(
            "INSERT INTO inventory_movements (
                id, tenant_id, unit_id, warehouse_id, quantity_delta, unit_cost,
                reason, reference_type, reference_id, created_by, created_at
            ) VALUES (?1, ?2, ?3, 'wh_1', ?4, 80.0, 'sales_shipment', 'sales_order', ?5, 'usr_1', ?6)",
            params![mov_id, tenant_id, unit_id, -shipped_qty, so_id, now],
        ).unwrap();

        (shp_id, shpl_id)
    }

    #[test]
    fn test_tc_sr_n_01_create_draft_sales_return() {
        // Given: Shipped sales order with 10 units at unit_price 100
        let mut conn = setup_test_db();
        let (_shp_id, shpl_id) = insert_test_sales_order_and_shipment(
            &conn,
            "tnt_test",
            "so_01",
            "unt_01",
            10.0,
            100.0,
            "2026-11-15",
        );

        // When: Create draft sales return with 4 units, reason quality_issue
        let input = CreateSalesReturnInput {
            sales_order_id: "so_01".to_string(),
            return_date: Some("2026-11-20".to_string()),
            reason_code: "quality_issue".to_string(),
            note: Some("外觀刮傷".to_string()),
            lines: vec![CreateSalesReturnLineInput {
                shipment_line_id: shpl_id.clone(),
                return_quantity: 4.0,
            }],
        };
        let detail = create_sales_return_impl(&mut conn, "tnt_test", "usr_tester", input).unwrap();

        // Then: Successfully created as draft with snapshot fields
        assert_eq!(detail.return_record.status, "draft");
        assert_eq!(detail.return_record.reason_code, "quality_issue");
        assert_eq!(detail.return_record.return_number, "SRET-00001");
        assert_eq!(detail.lines.len(), 1);
        assert_eq!(detail.lines[0].return_quantity, 4.0);
        assert_eq!(detail.lines[0].unit_price, 100.0);
        assert_eq!(detail.lines[0].product_name_snapshot, "筆電");
    }

    #[test]
    fn test_tc_sr_n_02_post_uninvoiced_sales_return() {
        // Given: Draft sales return on uninvoiced sales order
        let mut conn = setup_test_db();
        let (_shp_id, shpl_id) = insert_test_sales_order_and_shipment(
            &conn,
            "tnt_test",
            "so_02",
            "unt_01",
            10.0,
            100.0,
            "2026-11-15",
        );

        let input = CreateSalesReturnInput {
            sales_order_id: "so_02".to_string(),
            return_date: Some("2026-11-20".to_string()),
            reason_code: "wrong_item".to_string(),
            note: None,
            lines: vec![CreateSalesReturnLineInput {
                shipment_line_id: shpl_id,
                return_quantity: 5.0,
            }],
        };
        let draft = create_sales_return_impl(&mut conn, "tnt_test", "usr_tester", input).unwrap();

        // When: Post sales return
        let posted =
            post_sales_return_impl(&mut conn, "tnt_test", "usr_poster", &draft.return_record.id)
                .unwrap();

        // Then: Status is posted, inventory movement created with +5.0 and cost 80.0, no AR affected
        assert_eq!(posted.return_record.status, "posted");
        assert!(posted.return_record.posted_at.is_some());
        assert_eq!(posted.return_record.account_receivable_id, None);

        let (delta, cost, reason, ref_type, ref_id): (f64, f64, String, String, String) = conn
            .query_row(
                "SELECT quantity_delta, unit_cost, reason, reference_type, reference_id
                 FROM inventory_movements WHERE reference_id = ?1 AND reason = 'sales_return'",
                params![posted.return_record.id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .unwrap();
        assert_eq!(delta, 5.0);
        assert_eq!(cost, 80.0);
        assert_eq!(reason, "sales_return");
        assert_eq!(ref_type, "sales_return");
        assert_eq!(ref_id, posted.return_record.id);
    }

    #[test]
    fn test_tc_sr_n_03_post_invoiced_sales_return_offsets_ar() {
        // Given: Shipped sales order covered by posted customer invoice and open AR
        let mut conn = setup_test_db();
        let (_shp_id, shpl_id) = insert_test_sales_order_and_shipment(
            &conn,
            "tnt_test",
            "so_03",
            "unt_01",
            10.0,
            100.0,
            "2026-11-15",
        );

        // Create posted customer invoice (untaxed 1000, tax 50) and open AR (1050)
        let now = current_timestamp();
        conn.execute(
            "INSERT INTO customer_invoices (
                id, tenant_id, invoice_number, customer_partner_id, customer_name_snapshot,
                issuance_mode, invoice_date, due_date, untaxed_amount, tax_amount, status, created_by, created_at
            ) VALUES ('cinv_03', 'tnt_test', 'CINV-0003', 'cus_1', 'Test Customer', 'per_order', '2026-11-16', '2026-11-30', 1000.0, 50.0, 'posted', 'usr_1', ?1)",
            params![now],
        ).unwrap();
        conn.execute(
            "INSERT INTO customer_invoice_orders (id, tenant_id, customer_invoice_id, sales_order_id, so_number_snapshot, created_at)
             VALUES ('cio_03', 'tnt_test', 'cinv_03', 'so_03', 'SO-0001', ?1)",
            params![now],
        ).unwrap();
        conn.execute(
            "INSERT INTO accounts_receivable (
                id, tenant_id, customer_partner_id, customer_name_snapshot, source_type,
                source_id, source_number, document_date, due_date, amount, currency, status, created_by, created_at
            ) VALUES ('ar_03', 'tnt_test', 'cus_1', 'Test Customer', 'customer_invoice', 'cinv_03', 'CINV-0003', '2026-11-16', '2026-11-30', 1050.0, 'TWD', 'open', 'usr_1', ?1)",
            params![now],
        ).unwrap();

        // When: Return 2 units (2 * 100 = 200 untaxed, 5% tax = 10 -> total 210)
        let input = CreateSalesReturnInput {
            sales_order_id: "so_03".to_string(),
            return_date: Some("2026-11-20".to_string()),
            reason_code: "customer_cancel".to_string(),
            note: None,
            lines: vec![CreateSalesReturnLineInput {
                shipment_line_id: shpl_id,
                return_quantity: 2.0,
            }],
        };
        let draft = create_sales_return_impl(&mut conn, "tnt_test", "usr_tester", input).unwrap();
        let posted =
            post_sales_return_impl(&mut conn, "tnt_test", "usr_poster", &draft.return_record.id)
                .unwrap();

        // Then: Total amount is 210, account_receivable_id is linked
        assert_eq!(posted.return_record.status, "posted");
        assert_eq!(posted.return_record.total_amount, 210.0);
        assert_eq!(
            posted.return_record.account_receivable_id,
            Some("ar_03".to_string())
        );

        // And: AR derived amount is reduced (1050 - 210 = 840 outstanding)
        let ar_detail =
            crate::accounts_receivable::get_account_receivable_impl(&conn, "tnt_test", "ar_03")
                .unwrap();
        assert_eq!(ar_detail.allowance_amount, 210.0);
        assert_eq!(ar_detail.outstanding_amount, 840.0);
        assert_eq!(
            ar_detail.settlement_status,
            crate::accounts_receivable::SettlementStatus::PartiallyPaid
        );
    }

    #[test]
    fn test_tc_sr_n_04_void_posted_sales_return_uninvoiced() {
        // Given: Posted sales return on uninvoiced order
        let mut conn = setup_test_db();
        let (_shp_id, shpl_id) = insert_test_sales_order_and_shipment(
            &conn,
            "tnt_test",
            "so_04",
            "unt_01",
            10.0,
            100.0,
            "2026-11-15",
        );
        let input = CreateSalesReturnInput {
            sales_order_id: "so_04".to_string(),
            return_date: Some("2026-11-20".to_string()),
            reason_code: "wrong_item".to_string(),
            note: None,
            lines: vec![CreateSalesReturnLineInput {
                shipment_line_id: shpl_id,
                return_quantity: 3.0,
            }],
        };
        let draft = create_sales_return_impl(&mut conn, "tnt_test", "usr_tester", input).unwrap();
        let posted =
            post_sales_return_impl(&mut conn, "tnt_test", "usr_poster", &draft.return_record.id)
                .unwrap();

        // When: Void posted sales return with reason
        let voided = void_sales_return_impl(
            &mut conn,
            "tnt_test",
            "usr_voider",
            &posted.return_record.id,
            "客戶撤銷退貨",
        )
        .unwrap();

        // Then: Status is void, reversing inventory movement exists (-3.0)
        assert_eq!(voided.return_record.status, "void");
        assert_eq!(
            voided.return_record.void_reason,
            Some("客戶撤銷退貨".to_string())
        );

        let void_delta: f64 = conn
            .query_row(
                "SELECT quantity_delta FROM inventory_movements
                 WHERE reference_id = ?1 AND reason = 'sales_return_void'",
                params![voided.return_record.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(void_delta, -3.0);
    }

    #[test]
    fn test_tc_sr_n_05_void_posted_sales_return_invoiced_restores_ar() {
        // Given: Invoiced order with posted return offsetting AR
        let mut conn = setup_test_db();
        let (_shp_id, shpl_id) = insert_test_sales_order_and_shipment(
            &conn,
            "tnt_test",
            "so_05",
            "unt_01",
            10.0,
            100.0,
            "2026-11-15",
        );

        let now = current_timestamp();
        conn.execute(
            "INSERT INTO customer_invoices (
                id, tenant_id, invoice_number, customer_partner_id, customer_name_snapshot,
                issuance_mode, invoice_date, due_date, untaxed_amount, tax_amount, status, created_by, created_at
            ) VALUES ('cinv_05', 'tnt_test', 'CINV-0005', 'cus_1', 'Test Customer', 'per_order', '2026-11-16', '2026-11-30', 1000.0, 50.0, 'posted', 'usr_1', ?1)",
            params![now],
        ).unwrap();
        conn.execute(
            "INSERT INTO customer_invoice_orders (id, tenant_id, customer_invoice_id, sales_order_id, so_number_snapshot, created_at)
             VALUES ('cio_05', 'tnt_test', 'cinv_05', 'so_05', 'SO-0001', ?1)",
            params![now],
        ).unwrap();
        conn.execute(
            "INSERT INTO accounts_receivable (
                id, tenant_id, customer_partner_id, customer_name_snapshot, source_type,
                source_id, source_number, document_date, due_date, amount, currency, status, created_by, created_at
            ) VALUES ('ar_05', 'tnt_test', 'cus_1', 'Test Customer', 'customer_invoice', 'cinv_05', 'CINV-0005', '2026-11-16', '2026-11-30', 1050.0, 'TWD', 'open', 'usr_1', ?1)",
            params![now],
        ).unwrap();

        let input = CreateSalesReturnInput {
            sales_order_id: "so_05".to_string(),
            return_date: Some("2026-11-20".to_string()),
            reason_code: "quality_issue".to_string(),
            note: None,
            lines: vec![CreateSalesReturnLineInput {
                shipment_line_id: shpl_id,
                return_quantity: 5.0,
            }],
        };
        let draft = create_sales_return_impl(&mut conn, "tnt_test", "usr_tester", input).unwrap();
        let posted =
            post_sales_return_impl(&mut conn, "tnt_test", "usr_poster", &draft.return_record.id)
                .unwrap();

        // Verify AR was reduced
        let ar_before_void =
            crate::accounts_receivable::get_account_receivable_impl(&conn, "tnt_test", "ar_05")
                .unwrap();
        assert_eq!(ar_before_void.outstanding_amount, 525.0);

        // When: Void the return
        void_sales_return_impl(
            &mut conn,
            "tnt_test",
            "usr_voider",
            &posted.return_record.id,
            "錯誤退回作廢",
        )
        .unwrap();

        // Then: AR outstanding balance is restored to 1050.0, allowance_amount is 0.0
        let ar_after_void =
            crate::accounts_receivable::get_account_receivable_impl(&conn, "tnt_test", "ar_05")
                .unwrap();
        assert_eq!(ar_after_void.outstanding_amount, 1050.0);
        assert_eq!(ar_after_void.allowance_amount, 0.0);
        assert_eq!(
            ar_after_void.settlement_status,
            crate::accounts_receivable::SettlementStatus::Unpaid
        );
    }

    #[test]
    fn test_tc_sr_n_06_cumulative_partial_returns() {
        // Given: 10 units shipped
        let mut conn = setup_test_db();
        let (_shp_id, shpl_id) = insert_test_sales_order_and_shipment(
            &conn,
            "tnt_test",
            "so_06",
            "unt_01",
            10.0,
            100.0,
            "2026-11-15",
        );

        // When: Return 4 units first
        let ret1 = create_sales_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesReturnInput {
                sales_order_id: "so_06".to_string(),
                return_date: Some("2026-11-18".to_string()),
                reason_code: "quality_issue".to_string(),
                note: None,
                lines: vec![CreateSalesReturnLineInput {
                    shipment_line_id: shpl_id.clone(),
                    return_quantity: 4.0,
                }],
            },
        )
        .unwrap();
        post_sales_return_impl(&mut conn, "tnt_test", "usr_1", &ret1.return_record.id).unwrap();

        // And: Return remaining 6 units
        let ret2 = create_sales_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesReturnInput {
                sales_order_id: "so_06".to_string(),
                return_date: Some("2026-11-20".to_string()),
                reason_code: "other".to_string(),
                note: None,
                lines: vec![CreateSalesReturnLineInput {
                    shipment_line_id: shpl_id.clone(),
                    return_quantity: 6.0,
                }],
            },
        )
        .unwrap();
        let post2 =
            post_sales_return_impl(&mut conn, "tnt_test", "usr_1", &ret2.return_record.id).unwrap();

        // Then: Second return succeeds and is posted
        assert_eq!(post2.return_record.status, "posted");
    }

    #[test]
    fn test_tc_sr_b_01_and_b_02_boundary_dates() {
        // Given: Shipped sales order on 2026-11-15
        let mut conn = setup_test_db();
        let (_shp_id, shpl_id) = insert_test_sales_order_and_shipment(
            &conn,
            "tnt_test",
            "so_b1",
            "unt_01",
            10.0,
            100.0,
            "2026-11-15",
        );
        let today = get_today_local(&conn).unwrap();

        // When: Date = ship_date (2026-11-15) -> Valid
        let ret1 = create_sales_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesReturnInput {
                sales_order_id: "so_b1".to_string(),
                return_date: Some("2026-11-15".to_string()),
                reason_code: "quality_issue".to_string(),
                note: None,
                lines: vec![CreateSalesReturnLineInput {
                    shipment_line_id: shpl_id.clone(),
                    return_quantity: 1.0,
                }],
            },
        );
        assert!(ret1.is_ok());

        // When: Date = today -> Valid
        let ret2 = create_sales_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesReturnInput {
                sales_order_id: "so_b1".to_string(),
                return_date: Some(today),
                reason_code: "wrong_item".to_string(),
                note: None,
                lines: vec![CreateSalesReturnLineInput {
                    shipment_line_id: shpl_id,
                    return_quantity: 1.0,
                }],
            },
        );
        assert!(ret2.is_ok());
    }

    #[test]
    fn test_tc_sr_b_03_exact_max_quantity() {
        // Given: 10 units shipped
        let mut conn = setup_test_db();
        let (_shp_id, shpl_id) = insert_test_sales_order_and_shipment(
            &conn,
            "tnt_test",
            "so_b3",
            "unt_01",
            10.0,
            100.0,
            "2026-11-15",
        );

        // When: Return exactly 10 units
        let ret = create_sales_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesReturnInput {
                sales_order_id: "so_b3".to_string(),
                return_date: Some("2026-11-20".to_string()),
                reason_code: "customer_cancel".to_string(),
                note: None,
                lines: vec![CreateSalesReturnLineInput {
                    shipment_line_id: shpl_id,
                    return_quantity: 10.0,
                }],
            },
        );

        // Then: Passes validation
        assert!(ret.is_ok());
    }

    #[test]
    fn test_tc_sr_b_04_and_b_05_quantity_zero_or_negative() {
        let mut conn = setup_test_db();
        let (_shp_id, shpl_id) = insert_test_sales_order_and_shipment(
            &conn,
            "tnt_test",
            "so_b4",
            "unt_01",
            10.0,
            100.0,
            "2026-11-15",
        );

        // When: Return quantity = 0
        let err_zero = create_sales_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesReturnInput {
                sales_order_id: "so_b4".to_string(),
                return_date: Some("2026-11-20".to_string()),
                reason_code: "quality_issue".to_string(),
                note: None,
                lines: vec![CreateSalesReturnLineInput {
                    shipment_line_id: shpl_id.clone(),
                    return_quantity: 0.0,
                }],
            },
        );
        assert_eq!(
            err_zero.unwrap_err(),
            SalesReturnError::InvalidReturnQuantity
        );

        // When: Return quantity = -1
        let err_neg = create_sales_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesReturnInput {
                sales_order_id: "so_b4".to_string(),
                return_date: Some("2026-11-20".to_string()),
                reason_code: "quality_issue".to_string(),
                note: None,
                lines: vec![CreateSalesReturnLineInput {
                    shipment_line_id: shpl_id,
                    return_quantity: -1.0,
                }],
            },
        );
        assert_eq!(
            err_neg.unwrap_err(),
            SalesReturnError::InvalidReturnQuantity
        );
    }

    #[test]
    fn test_tc_sr_e_01_empty_tenant_id() {
        let mut conn = setup_test_db();
        let err = create_sales_return_impl(
            &mut conn,
            "",
            "usr_1",
            CreateSalesReturnInput {
                sales_order_id: "so_1".to_string(),
                return_date: None,
                reason_code: "quality_issue".to_string(),
                note: None,
                lines: vec![],
            },
        );
        assert_eq!(err.unwrap_err(), SalesReturnError::EmptyTenantId);
    }

    #[test]
    fn test_tc_sr_e_02_order_not_found() {
        let mut conn = setup_test_db();
        let err = create_sales_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesReturnInput {
                sales_order_id: "so_non_existent".to_string(),
                return_date: None,
                reason_code: "quality_issue".to_string(),
                note: None,
                lines: vec![CreateSalesReturnLineInput {
                    shipment_line_id: "shpl_1".to_string(),
                    return_quantity: 1.0,
                }],
            },
        );
        assert_eq!(err.unwrap_err(), SalesReturnError::SalesOrderNotFound);
    }

    #[test]
    fn test_tc_sr_e_03_and_e_04_invalid_or_empty_reason_code() {
        let mut conn = setup_test_db();
        let (_shp_id, shpl_id) = insert_test_sales_order_and_shipment(
            &conn,
            "tnt_test",
            "so_e3",
            "unt_01",
            10.0,
            100.0,
            "2026-11-15",
        );

        // When: Free string "damaged_package"
        let err_free = create_sales_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesReturnInput {
                sales_order_id: "so_e3".to_string(),
                return_date: Some("2026-11-20".to_string()),
                reason_code: "damaged_package".to_string(),
                note: None,
                lines: vec![CreateSalesReturnLineInput {
                    shipment_line_id: shpl_id.clone(),
                    return_quantity: 1.0,
                }],
            },
        );
        assert_eq!(err_free.unwrap_err(), SalesReturnError::InvalidReasonCode);

        // When: Empty reason
        let err_empty = create_sales_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesReturnInput {
                sales_order_id: "so_e3".to_string(),
                return_date: Some("2026-11-20".to_string()),
                reason_code: "  ".to_string(),
                note: None,
                lines: vec![CreateSalesReturnLineInput {
                    shipment_line_id: shpl_id,
                    return_quantity: 1.0,
                }],
            },
        );
        assert_eq!(err_empty.unwrap_err(), SalesReturnError::InvalidReasonCode);
    }

    #[test]
    fn test_tc_sr_e_05_return_date_after_today() {
        let mut conn = setup_test_db();
        let (_shp_id, shpl_id) = insert_test_sales_order_and_shipment(
            &conn,
            "tnt_test",
            "so_e5",
            "unt_01",
            10.0,
            100.0,
            "2026-11-15",
        );

        let err = create_sales_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesReturnInput {
                sales_order_id: "so_e5".to_string(),
                return_date: Some("2099-12-31".to_string()),
                reason_code: "quality_issue".to_string(),
                note: None,
                lines: vec![CreateSalesReturnLineInput {
                    shipment_line_id: shpl_id,
                    return_quantity: 1.0,
                }],
            },
        );
        assert_eq!(err.unwrap_err(), SalesReturnError::ReturnDateAfterToday);
    }

    #[test]
    fn test_tc_sr_e_06_return_date_before_ship_date() {
        let mut conn = setup_test_db();
        let (_shp_id, shpl_id) = insert_test_sales_order_and_shipment(
            &conn,
            "tnt_test",
            "so_e6",
            "unt_01",
            10.0,
            100.0,
            "2026-11-15",
        );

        let err = create_sales_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesReturnInput {
                sales_order_id: "so_e6".to_string(),
                return_date: Some("2026-11-14".to_string()), // Earlier than 2026-11-15
                reason_code: "quality_issue".to_string(),
                note: None,
                lines: vec![CreateSalesReturnLineInput {
                    shipment_line_id: shpl_id,
                    return_quantity: 1.0,
                }],
            },
        );
        assert_eq!(
            err.unwrap_err(),
            SalesReturnError::ReturnDateBeforeShipDate("2026-11-15".to_string())
        );
    }

    #[test]
    fn test_tc_sr_e_07_and_e_08_quantity_exceeds_available() {
        let mut conn = setup_test_db();
        let (_shp_id, shpl_id) = insert_test_sales_order_and_shipment(
            &conn,
            "tnt_test",
            "so_e7",
            "unt_01",
            10.0,
            100.0,
            "2026-11-15",
        );

        // When: Return 11 units when only 10 shipped
        let err_single = create_sales_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesReturnInput {
                sales_order_id: "so_e7".to_string(),
                return_date: Some("2026-11-20".to_string()),
                reason_code: "quality_issue".to_string(),
                note: None,
                lines: vec![CreateSalesReturnLineInput {
                    shipment_line_id: shpl_id.clone(),
                    return_quantity: 11.0,
                }],
            },
        );
        assert_eq!(
            err_single.unwrap_err(),
            SalesReturnError::ReturnQuantityExceedsReturnable(
                shpl_id.clone(),
                "11".to_string(),
                "10".to_string()
            )
        );

        // When: First return 6 units and post it
        let ret1 = create_sales_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesReturnInput {
                sales_order_id: "so_e7".to_string(),
                return_date: Some("2026-11-18".to_string()),
                reason_code: "quality_issue".to_string(),
                note: None,
                lines: vec![CreateSalesReturnLineInput {
                    shipment_line_id: shpl_id.clone(),
                    return_quantity: 6.0,
                }],
            },
        )
        .unwrap();
        post_sales_return_impl(&mut conn, "tnt_test", "usr_1", &ret1.return_record.id).unwrap();

        // And: Attempt to return 5 units when only 4 remaining
        let err_cum = create_sales_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesReturnInput {
                sales_order_id: "so_e7".to_string(),
                return_date: Some("2026-11-20".to_string()),
                reason_code: "quality_issue".to_string(),
                note: None,
                lines: vec![CreateSalesReturnLineInput {
                    shipment_line_id: shpl_id.clone(),
                    return_quantity: 5.0,
                }],
            },
        );
        assert_eq!(
            err_cum.unwrap_err(),
            SalesReturnError::ReturnQuantityExceedsReturnable(
                shpl_id,
                "5".to_string(),
                "4".to_string()
            )
        );
    }

    #[test]
    fn test_tc_sr_e_09_shipment_line_not_found() {
        let mut conn = setup_test_db();
        insert_test_sales_order_and_shipment(
            &conn,
            "tnt_test",
            "so_e9",
            "unt_01",
            10.0,
            100.0,
            "2026-11-15",
        );

        let err = create_sales_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesReturnInput {
                sales_order_id: "so_e9".to_string(),
                return_date: Some("2026-11-20".to_string()),
                reason_code: "quality_issue".to_string(),
                note: None,
                lines: vec![CreateSalesReturnLineInput {
                    shipment_line_id: "non_existent_shpl".to_string(),
                    return_quantity: 1.0,
                }],
            },
        );
        assert_eq!(err.unwrap_err(), SalesReturnError::ShipmentLineNotFound);
    }

    #[test]
    fn test_tc_sr_e_10_and_e_11_state_transitions() {
        let mut conn = setup_test_db();
        let (_shp_id, shpl_id) = insert_test_sales_order_and_shipment(
            &conn,
            "tnt_test",
            "so_e10",
            "unt_01",
            10.0,
            100.0,
            "2026-11-15",
        );
        let ret = create_sales_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesReturnInput {
                sales_order_id: "so_e10".to_string(),
                return_date: Some("2026-11-20".to_string()),
                reason_code: "quality_issue".to_string(),
                note: None,
                lines: vec![CreateSalesReturnLineInput {
                    shipment_line_id: shpl_id,
                    return_quantity: 2.0,
                }],
            },
        )
        .unwrap();
        post_sales_return_impl(&mut conn, "tnt_test", "usr_1", &ret.return_record.id).unwrap();

        // When: Attempt to update posted return
        let err_update = update_sales_return_impl(
            &mut conn,
            "tnt_test",
            UpdateSalesReturnInput {
                id: ret.return_record.id.clone(),
                return_date: None,
                reason_code: None,
                note: Some("修改備註".to_string()),
                lines: None,
            },
        );
        assert_eq!(err_update.unwrap_err(), SalesReturnError::NotDraftForUpdate);

        // When: Attempt to post already posted return
        let err_post =
            post_sales_return_impl(&mut conn, "tnt_test", "usr_1", &ret.return_record.id);
        assert_eq!(
            err_post.unwrap_err(),
            SalesReturnError::InvalidStateTransition("posted".to_string(), "posted".to_string())
        );
    }

    #[test]
    fn test_tc_sr_e_12_amount_exceeds_outstanding() {
        let mut conn = setup_test_db();
        let (_shp_id, shpl_id) = insert_test_sales_order_and_shipment(
            &conn,
            "tnt_test",
            "so_e12",
            "unt_01",
            10.0,
            100.0,
            "2026-11-15",
        );

        let now = current_timestamp();
        conn.execute(
            "INSERT INTO customer_invoices (
                id, tenant_id, invoice_number, customer_partner_id, customer_name_snapshot,
                issuance_mode, invoice_date, due_date, untaxed_amount, tax_amount, status, created_by, created_at
            ) VALUES ('cinv_e12', 'tnt_test', 'CINV-E12', 'cus_1', 'Test Customer', 'per_order', '2026-11-16', '2026-11-30', 1000.0, 50.0, 'posted', 'usr_1', ?1)",
            params![now],
        ).unwrap();
        conn.execute(
            "INSERT INTO customer_invoice_orders (id, tenant_id, customer_invoice_id, sales_order_id, so_number_snapshot, created_at)
             VALUES ('cio_e12', 'tnt_test', 'cinv_e12', 'so_e12', 'SO-0001', ?1)",
            params![now],
        ).unwrap();
        // AR total is 1050, but customer already paid 900, remaining outstanding is 150
        conn.execute(
            "INSERT INTO accounts_receivable (
                id, tenant_id, customer_partner_id, customer_name_snapshot, source_type,
                source_id, source_number, document_date, due_date, amount, currency, status, created_by, created_at
            ) VALUES ('ar_e12', 'tnt_test', 'cus_1', 'Test Customer', 'customer_invoice', 'cinv_e12', 'CINV-E12', '2026-11-16', '2026-11-30', 1050.0, 'TWD', 'open', 'usr_1', ?1)",
            params![now],
        ).unwrap();
        conn.execute(
            "CREATE TABLE IF NOT EXISTS customer_receipts (id TEXT PRIMARY KEY, tenant_id TEXT, status TEXT)",
            [],
        ).unwrap();
        conn.execute(
            "CREATE TABLE IF NOT EXISTS customer_receipt_allocations (id TEXT PRIMARY KEY, tenant_id TEXT, receipt_id TEXT, account_receivable_id TEXT, amount REAL)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO customer_receipts (id, tenant_id, status) VALUES ('rcpt_1', 'tnt_test', 'posted')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO customer_receipt_allocations (id, tenant_id, receipt_id, account_receivable_id, amount) VALUES ('alloc_1', 'tnt_test', 'rcpt_1', 'ar_e12', 900.0)",
            [],
        ).unwrap();

        // When: Return 2 units (amount with tax = 210, but outstanding is only 150)
        let ret = create_sales_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesReturnInput {
                sales_order_id: "so_e12".to_string(),
                return_date: Some("2026-11-20".to_string()),
                reason_code: "quality_issue".to_string(),
                note: None,
                lines: vec![CreateSalesReturnLineInput {
                    shipment_line_id: shpl_id,
                    return_quantity: 2.0,
                }],
            },
        )
        .unwrap();
        let err = post_sales_return_impl(&mut conn, "tnt_test", "usr_1", &ret.return_record.id);

        // Then: Blocked by AmountExceedsOutstanding
        assert_eq!(
            err.unwrap_err(),
            SalesReturnError::AmountExceedsOutstanding("210".to_string(), "150".to_string())
        );
    }

    #[test]
    fn test_tc_sr_e_13_14_15_void_validations() {
        let mut conn = setup_test_db();
        let (_shp_id, shpl_id) = insert_test_sales_order_and_shipment(
            &conn,
            "tnt_test",
            "so_e13",
            "unt_01",
            10.0,
            100.0,
            "2026-11-15",
        );
        let draft = create_sales_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesReturnInput {
                sales_order_id: "so_e13".to_string(),
                return_date: Some("2026-11-20".to_string()),
                reason_code: "quality_issue".to_string(),
                note: None,
                lines: vec![CreateSalesReturnLineInput {
                    shipment_line_id: shpl_id,
                    return_quantity: 2.0,
                }],
            },
        )
        .unwrap();

        // Case E-14: Attempt to void draft return
        let err_draft = void_sales_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            &draft.return_record.id,
            "理由",
        );
        assert_eq!(err_draft.unwrap_err(), SalesReturnError::NotPostedForVoid);

        // Post it first
        post_sales_return_impl(&mut conn, "tnt_test", "usr_1", &draft.return_record.id).unwrap();

        // Case E-13: Void without reason
        let err_no_reason = void_sales_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            &draft.return_record.id,
            "   ",
        );
        assert_eq!(
            err_no_reason.unwrap_err(),
            SalesReturnError::VoidReasonRequired
        );

        // Void it successfully
        void_sales_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            &draft.return_record.id,
            "有效原因",
        )
        .unwrap();

        // Case E-15: Attempt to void already voided return
        let err_again = void_sales_return_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            &draft.return_record.id,
            "重複作廢",
        );
        assert_eq!(err_again.unwrap_err(), SalesReturnError::NotPostedForVoid);
    }
}
