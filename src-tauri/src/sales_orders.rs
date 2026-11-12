use crate::get_db_path;
use rusqlite::params;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static SO_ID_COUNTER: AtomicU64 = AtomicU64::new(1000);
static SOL_ID_COUNTER: AtomicU64 = AtomicU64::new(1000);
static MOV_SO_ID_COUNTER: AtomicU64 = AtomicU64::new(1000);

fn current_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

pub fn round_2(val: f64) -> f64 {
    (val * 100.0).round() / 100.0
}

fn format_qty(q: f64) -> String {
    let rounded = (q * 1_000_000.0).round() / 1_000_000.0;
    if rounded.abs() < 1e-9 {
        return "0".to_string();
    }
    if (rounded - rounded.round()).abs() < 1e-9 {
        format!("{:.0}", rounded)
    } else {
        let s = format!("{:.6}", rounded);
        s.trim_end_matches('0').trim_end_matches('.').to_string()
    }
}

pub fn parse_date(date_str: &str) -> Result<(i32, u32, u32), SalesOrderError> {
    let trimmed = date_str.trim();
    let parts: Vec<&str> = trimmed.split('-').collect();
    if parts.len() != 3 || parts[0].len() != 4 || parts[1].len() != 2 || parts[2].len() != 2 {
        return Err(SalesOrderError::InvalidDateFormat(
            "日期格式需為 YYYY-MM-DD".to_string(),
        ));
    }
    let year: i32 = parts[0]
        .parse()
        .map_err(|_| SalesOrderError::InvalidDateFormat("無效的年份".to_string()))?;
    let month: u32 = parts[1]
        .parse()
        .map_err(|_| SalesOrderError::InvalidDateFormat("無效的月份".to_string()))?;
    let day: u32 = parts[2]
        .parse()
        .map_err(|_| SalesOrderError::InvalidDateFormat("無效的日期".to_string()))?;

    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return Err(SalesOrderError::InvalidDateFormat(
            "無效的日期數值".to_string(),
        ));
    }
    let is_leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
    let dim = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap {
                29
            } else {
                28
            }
        }
        _ => 30,
    };
    if day > dim {
        return Err(SalesOrderError::InvalidDateFormat(
            "日期超出該月份天數".to_string(),
        ));
    }
    Ok((year, month, day))
}

pub fn get_today_local(conn: &rusqlite::Connection) -> Result<String, rusqlite::Error> {
    conn.query_row("SELECT date('now', 'localtime')", [], |r| r.get(0))
}

// ==========================================
// Data Structures
// ==========================================

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq)]
pub struct SalesOrder {
    pub id: String,
    pub tenant_id: String,
    pub so_number: String,
    pub customer_partner_id: String,
    pub customer_name_snapshot: String,
    pub customer_reference: Option<String>,
    pub source_quote_id: String,
    pub warehouse_id: String,
    pub currency: String,
    pub status: String, // "confirmed" | "shipped" | "cancelled"
    pub expected_ship_date: Option<String>,
    pub ship_date: Option<String>,
    pub note: Option<String>,
    pub created_by: String,
    pub created_at: i64,
    pub confirmed_at: i64,
    pub shipped_by: Option<String>,
    pub shipped_at: Option<i64>,
    pub cancelled_at: Option<i64>,
    pub task_id: Option<String>,
    pub total_amount: f64,
    pub shipped_amount: f64,
    #[serde(default)]
    pub lines_count: Option<i64>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq)]
pub struct SalesOrderLine {
    pub id: String,
    pub sales_order_id: String,
    pub line_no: i64,
    pub unit_id: String,
    pub product_name_snapshot: String,
    pub variant_name_snapshot: String,
    pub sku_snapshot: Option<String>,
    pub unit_name_snapshot: String,
    pub quantity: f64,
    pub shipped_quantity: Option<f64>,
    pub unit_price: f64,
    pub standard_price_snapshot: f64,
    pub created_at: i64,
    pub subtotal: f64,
    pub shipped_subtotal: Option<f64>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq)]
pub struct SalesOrderDetail {
    pub order: SalesOrder,
    pub lines: Vec<SalesOrderLine>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq)]
pub struct CreateSalesOrderLineFromQuoteInput {
    pub unit_id: String,
    pub product_name_snapshot: String,
    pub variant_name_snapshot: String,
    pub sku_snapshot: Option<String>,
    pub unit_name_snapshot: String,
    pub quantity: f64,
    pub unit_price: f64,
    pub standard_price_snapshot: f64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq)]
pub struct CreateSalesOrderFromQuoteInput {
    pub source_quote_id: String,
    pub customer_partner_id: String,
    pub customer_name_snapshot: Option<String>,
    pub customer_reference: Option<String>,
    pub warehouse_id: Option<String>,
    pub currency: Option<String>,
    pub expected_ship_date: Option<String>,
    pub note: Option<String>,
    pub task_id: Option<String>,
    pub lines: Vec<CreateSalesOrderLineFromQuoteInput>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq)]
pub struct ShippedLineInput {
    #[serde(alias = "lineId")]
    pub line_id: String,
    #[serde(alias = "shippedQuantity")]
    pub shipped_quantity: f64,
}

// ==========================================
// Table Creation
// ==========================================

pub fn create_sales_orders_tables(conn: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS sales_orders (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            so_number TEXT NOT NULL,
            customer_partner_id TEXT NOT NULL,
            customer_name_snapshot TEXT NOT NULL,
            customer_reference TEXT,
            source_quote_id TEXT NOT NULL UNIQUE,
            warehouse_id TEXT NOT NULL,
            currency TEXT NOT NULL DEFAULT 'TWD',
            status TEXT NOT NULL,
            expected_ship_date TEXT,
            ship_date TEXT,
            note TEXT,
            created_by TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            confirmed_at INTEGER NOT NULL,
            shipped_by TEXT,
            shipped_at INTEGER,
            cancelled_at INTEGER,
            task_id TEXT
        )",
        [],
    )?;

    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_so_tenant_number ON sales_orders (tenant_id, so_number)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_so_tenant ON sales_orders (tenant_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_so_tenant_status ON sales_orders (tenant_id, status)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_so_tenant_customer ON sales_orders (tenant_id, customer_partner_id)",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS sales_order_lines (
            id TEXT PRIMARY KEY,
            sales_order_id TEXT NOT NULL,
            line_no INTEGER NOT NULL,
            unit_id TEXT NOT NULL,
            product_name_snapshot TEXT NOT NULL,
            variant_name_snapshot TEXT NOT NULL,
            sku_snapshot TEXT,
            unit_name_snapshot TEXT NOT NULL,
            quantity REAL NOT NULL,
            shipped_quantity REAL,
            unit_price REAL NOT NULL,
            standard_price_snapshot REAL NOT NULL,
            created_at INTEGER NOT NULL
        )",
        [],
    )?;

    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_sol_order_unit ON sales_order_lines (sales_order_id, unit_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sol_order ON sales_order_lines (sales_order_id)",
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
            "〔{}／{}／{}〕在〔{}〕現有 {}，不足出貨 {}",
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
pub enum SalesOrderError {
    #[error("Tenant ID cannot be empty")]
    EmptyTenantId,

    #[error("無法解析有效使用者 session，操作被拒絕")]
    EmptyUserId,

    #[error("來源報價單 ID 不可為空")]
    EmptySourceQuoteId,

    #[error("此報價單已轉換過銷售單，不可重複轉單")]
    DuplicateSourceQuote,

    #[error("找不到此客戶，或該往來對象未設定為客戶")]
    CustomerNotFoundOrInactive,

    #[error("找不到倉別或倉別已停用")]
    WarehouseNotFoundOrInactive,

    #[error("{0}")]
    WarehouseError(String),

    #[error("幣別僅支援 TWD")]
    InvalidCurrency,

    #[error("銷售單至少需有 1 筆明細")]
    EmptyLines,

    #[error("找不到指定的商品單位 (unit_id) 或不屬於目前租戶")]
    UnitNotFound,

    #[error("同一銷售單內商品單位不可重複")]
    DuplicateUnit,

    #[error("數量必須大於 0")]
    InvalidQuantity,

    #[error("單價不可為負數")]
    InvalidUnitPrice,

    #[error("找不到銷售單或不屬於目前租戶")]
    OrderNotFound,

    #[error("找不到指定的銷售單明細行")]
    LineNotFound,

    #[error("銷售單明細不可修改，請透過庫存調整單或作廢重開報價處理")]
    LinesImmutable,

    #[error("無效的狀態轉換：不可從 {from} 轉換至 {to}")]
    InvalidStateTransition { from: String, to: String },

    #[error("出貨數量不可超過訂購數量")]
    ShippedQuantityExceedsOrder,

    #[error("出貨數量不可小於 0")]
    ShippedQuantityNegative,

    #[error("出貨數量合計需大於 0")]
    TotalShippedQuantityMustBePositive,

    #[error("出貨明細重複指定同一行")]
    DuplicateShipLineInput,

    #[error("{0}")]
    InsufficientStock(Box<InsufficientStockDetails>),

    #[error("{0}")]
    InvalidDateFormat(String),

    #[error("出貨日不可晚於今天")]
    ShipDateCannotBeInFuture,

    #[error("{0}")]
    DatabaseError(String),
}

impl From<rusqlite::Error> for SalesOrderError {
    fn from(err: rusqlite::Error) -> Self {
        SalesOrderError::DatabaseError(err.to_string())
    }
}

// ==========================================
// Helpers
// ==========================================

fn clean_opt_str(val: Option<String>) -> Option<String> {
    val.and_then(|s| {
        let trimmed = s.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn map_warehouse_error(err: String) -> SalesOrderError {
    if err == "找不到倉別或倉別已停用" {
        SalesOrderError::WarehouseNotFoundOrInactive
    } else {
        SalesOrderError::WarehouseError(err)
    }
}

fn next_so_number(tx: &rusqlite::Transaction, tenant_id: &str) -> Result<String, SalesOrderError> {
    let mut stmt = tx.prepare(
        "SELECT so_number FROM sales_orders
         WHERE tenant_id = ?1 AND so_number LIKE 'SO-%'
         ORDER BY so_number DESC",
    )?;

    let mut rows = stmt.query(params![tenant_id])?;
    let mut max_seq: i64 = 0;
    while let Some(row) = rows.next()? {
        let code: String = row.get(0)?;
        if let Some(num_part) = code.strip_prefix("SO-") {
            if let Ok(seq) = num_part.parse::<i64>() {
                if seq > max_seq {
                    max_seq = seq;
                }
            }
        }
    }
    Ok(format!("SO-{:05}", max_seq + 1))
}

fn validate_customer_active(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    customer_partner_id: &str,
) -> Result<String, SalesOrderError> {
    let trimmed = customer_partner_id.trim();
    if trimmed.is_empty() {
        return Err(SalesOrderError::CustomerNotFoundOrInactive);
    }

    let mut stmt = conn.prepare(
        "SELECT name, is_customer, is_active FROM partners WHERE id = ?1 AND tenant_id = ?2",
    )?;
    let row = stmt.query_row(params![trimmed, tenant_id], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, i64>(1)? == 1,
            r.get::<_, i64>(2)? == 1,
        ))
    });

    match row {
        Ok((name, true, true)) => Ok(name),
        _ => Err(SalesOrderError::CustomerNotFoundOrInactive),
    }
}

fn ensure_unit_belongs_to_tenant(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    unit_id: &str,
) -> Result<(), SalesOrderError> {
    crate::products::resolve_unit_snapshot(conn, tenant_id, unit_id)
        .map(|_| ())
        .map_err(|_| SalesOrderError::UnitNotFound)
}

fn map_sales_order_row(row: &rusqlite::Row) -> Result<SalesOrder, rusqlite::Error> {
    Ok(SalesOrder {
        id: row.get(0)?,
        tenant_id: row.get(1)?,
        so_number: row.get(2)?,
        customer_partner_id: row.get(3)?,
        customer_name_snapshot: row.get(4)?,
        customer_reference: row.get(5)?,
        source_quote_id: row.get(6)?,
        warehouse_id: row.get(7)?,
        currency: row.get(8)?,
        status: row.get(9)?,
        expected_ship_date: row.get(10)?,
        ship_date: row.get(11)?,
        note: row.get(12)?,
        created_by: row.get(13)?,
        created_at: row.get(14)?,
        confirmed_at: row.get(15)?,
        shipped_by: row.get(16)?,
        shipped_at: row.get(17)?,
        cancelled_at: row.get(18)?,
        task_id: row.get(19)?,
        total_amount: round_2(row.get(20)?),
        shipped_amount: round_2(row.get(21)?),
        lines_count: row.get(22).ok(),
    })
}

fn map_sales_order_line_row(row: &rusqlite::Row) -> Result<SalesOrderLine, rusqlite::Error> {
    let quantity: f64 = row.get(8)?;
    let shipped_quantity: Option<f64> = row.get(9)?;
    let unit_price: f64 = row.get(10)?;
    Ok(SalesOrderLine {
        id: row.get(0)?,
        sales_order_id: row.get(1)?,
        line_no: row.get(2)?,
        unit_id: row.get(3)?,
        product_name_snapshot: row.get(4)?,
        variant_name_snapshot: row.get(5)?,
        sku_snapshot: row.get(6)?,
        unit_name_snapshot: row.get(7)?,
        quantity,
        shipped_quantity,
        unit_price,
        standard_price_snapshot: row.get(11)?,
        created_at: row.get(12)?,
        subtotal: round_2(quantity * unit_price),
        shipped_subtotal: shipped_quantity.map(|sq| round_2(sq * unit_price)),
    })
}

fn fetch_sales_order_detail(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    order_id: &str,
) -> Result<SalesOrderDetail, SalesOrderError> {
    let mut stmt = conn.prepare(
        "SELECT
            so.id, so.tenant_id, so.so_number, so.customer_partner_id, so.customer_name_snapshot,
            so.customer_reference, so.source_quote_id, so.warehouse_id, so.currency, so.status,
            so.expected_ship_date, so.ship_date, so.note, so.created_by, so.created_at,
            so.confirmed_at, so.shipped_by, so.shipped_at, so.cancelled_at, so.task_id,
            COALESCE((SELECT SUM(ROUND(l.quantity * l.unit_price, 2)) FROM sales_order_lines l WHERE l.sales_order_id = so.id), 0.0) AS total_amount,
            COALESCE((SELECT SUM(ROUND(COALESCE(l.shipped_quantity, 0.0) * l.unit_price, 2)) FROM sales_order_lines l WHERE l.sales_order_id = so.id), 0.0) AS shipped_amount,
            (SELECT COUNT(*) FROM sales_order_lines l WHERE l.sales_order_id = so.id) AS lines_count
         FROM sales_orders so
         WHERE so.id = ?1 AND so.tenant_id = ?2",
    )?;

    let mut order = stmt
        .query_row(params![order_id, tenant_id], map_sales_order_row)
        .map_err(|_| SalesOrderError::OrderNotFound)?;

    let mut lines_stmt = conn.prepare(
        "SELECT
            id, sales_order_id, line_no, unit_id,
            product_name_snapshot, variant_name_snapshot, sku_snapshot, unit_name_snapshot,
            quantity, shipped_quantity, unit_price, standard_price_snapshot, created_at
         FROM sales_order_lines
         WHERE sales_order_id = ?1
         ORDER BY line_no ASC, created_at ASC",
    )?;

    let rows = lines_stmt.query_map(params![order_id], map_sales_order_line_row)?;
    let mut lines = Vec::new();
    for r in rows {
        lines.push(r?);
    }

    order.total_amount = round_2(lines.iter().map(|l| l.subtotal).sum());
    order.shipped_amount = round_2(
        lines
            .iter()
            .map(|l| l.shipped_subtotal.unwrap_or(0.0))
            .sum(),
    );
    order.lines_count = Some(lines.len() as i64);

    Ok(SalesOrderDetail { order, lines })
}

// ==========================================
// Usecase Implementations
// ==========================================

/// Internal transactional creation helper called exclusively by #234 (`convert_quote`).
/// Issue #220 intentionally does NOT expose a standalone `create_sales_order` Tauri command.
pub fn create_sales_order_from_quote_in_tx(
    tx: &rusqlite::Transaction,
    tenant_id: &str,
    user_id: &str,
    input: CreateSalesOrderFromQuoteInput,
) -> Result<SalesOrderDetail, SalesOrderError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(SalesOrderError::EmptyTenantId);
    }
    let uid = user_id.trim();
    if uid.is_empty() {
        return Err(SalesOrderError::EmptyUserId);
    }

    // SO-04: source_quote_id required and unique
    let source_quote_id = input.source_quote_id.trim().to_string();
    if source_quote_id.is_empty() {
        return Err(SalesOrderError::EmptySourceQuoteId);
    }
    let dup_quote: bool = tx
        .query_row(
            "SELECT 1 FROM sales_orders WHERE source_quote_id = ?1",
            params![source_quote_id],
            |_| Ok(true),
        )
        .unwrap_or(false);
    if dup_quote {
        return Err(SalesOrderError::DuplicateSourceQuote);
    }

    // SO-02: customer must exist, belong to tenant, is_customer=1 and is_active=1
    let resolved_customer_name = validate_customer_active(tx, tid, &input.customer_partner_id)?;
    let customer_name_snapshot =
        clean_opt_str(input.customer_name_snapshot).unwrap_or(resolved_customer_name);

    // SO-03: validate explicit warehouse or resolve tenant's active default warehouse
    let warehouse = match clean_opt_str(input.warehouse_id) {
        Some(wh_id) => crate::warehouses::validate_warehouse_active(tx, tid, &wh_id)
            .map_err(map_warehouse_error)?,
        None => {
            crate::warehouses::resolve_default_warehouse(tx, tid).map_err(map_warehouse_error)?
        }
    };

    // SO-08: currency only 'TWD'
    let currency = match clean_opt_str(input.currency) {
        Some(c) => {
            if c != "TWD" {
                return Err(SalesOrderError::InvalidCurrency);
            }
            c
        }
        None => "TWD".to_string(),
    };

    // SO-08: optional expected_ship_date must be valid calendar date
    let expected_ship_date = match clean_opt_str(input.expected_ship_date) {
        Some(d) => {
            parse_date(&d)?;
            Some(d)
        }
        None => None,
    };

    // SO-05, SO-06, SO-07: lines validation (preserve quote snapshots and unit_price verbatim)
    if input.lines.is_empty() {
        return Err(SalesOrderError::EmptyLines);
    }

    let mut seen_units = HashSet::new();
    let mut cleaned_lines = Vec::with_capacity(input.lines.len());
    for line in input.lines {
        let trimmed_unit_id = line.unit_id.trim().to_string();
        if trimmed_unit_id.is_empty() {
            return Err(SalesOrderError::UnitNotFound);
        }
        ensure_unit_belongs_to_tenant(tx, tid, &trimmed_unit_id)?;
        if !seen_units.insert(trimmed_unit_id.clone()) {
            return Err(SalesOrderError::DuplicateUnit);
        }
        if line.quantity <= 0.0 || line.quantity.is_nan() || line.quantity.is_infinite() {
            return Err(SalesOrderError::InvalidQuantity);
        }
        if line.unit_price < 0.0 || line.unit_price.is_nan() || line.unit_price.is_infinite() {
            return Err(SalesOrderError::InvalidUnitPrice);
        }
        if line.standard_price_snapshot.is_nan() || line.standard_price_snapshot.is_infinite() {
            return Err(SalesOrderError::InvalidUnitPrice);
        }
        cleaned_lines.push((trimmed_unit_id, line));
    }

    let now = current_timestamp();
    let so_id = format!(
        "so_{}_{}",
        now,
        SO_ID_COUNTER.fetch_add(1, Ordering::SeqCst)
    );
    let so_number = next_so_number(tx, tid)?;

    let customer_reference = clean_opt_str(input.customer_reference);
    let note = clean_opt_str(input.note);
    let task_id = clean_opt_str(input.task_id);

    tx.execute(
        "INSERT INTO sales_orders (
            id, tenant_id, so_number, customer_partner_id, customer_name_snapshot,
            customer_reference, source_quote_id, warehouse_id, currency, status,
            expected_ship_date, ship_date, note, created_by, created_at, confirmed_at,
            shipped_by, shipped_at, cancelled_at, task_id
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5,
            ?6, ?7, ?8, ?9, 'confirmed',
            ?10, NULL, ?11, ?12, ?13, ?14,
            NULL, NULL, NULL, ?15
        )",
        params![
            so_id,
            tid,
            so_number,
            input.customer_partner_id.trim(),
            customer_name_snapshot,
            customer_reference,
            source_quote_id,
            warehouse.id,
            currency,
            expected_ship_date,
            note,
            uid,
            now,
            now,
            task_id,
        ],
    )?;

    for (idx, (unit_id, line)) in cleaned_lines.into_iter().enumerate() {
        let line_id = format!(
            "sol_{}_{}",
            now,
            SOL_ID_COUNTER.fetch_add(1, Ordering::SeqCst)
        );
        tx.execute(
            "INSERT INTO sales_order_lines (
                id, sales_order_id, line_no, unit_id,
                product_name_snapshot, variant_name_snapshot, sku_snapshot, unit_name_snapshot,
                quantity, shipped_quantity, unit_price, standard_price_snapshot, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, ?10, ?11, ?12)",
            params![
                line_id,
                so_id,
                (idx + 1) as i64,
                unit_id,
                line.product_name_snapshot.trim(),
                line.variant_name_snapshot.trim(),
                clean_opt_str(line.sku_snapshot),
                line.unit_name_snapshot.trim(),
                line.quantity,
                line.unit_price,
                line.standard_price_snapshot,
                now,
            ],
        )?;
    }

    fetch_sales_order_detail(tx, tid, &so_id)
}

/// Convenience wrapper for Rust-internal callers/tests that own a `&mut Connection`.
pub fn create_sales_order_from_quote_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    user_id: &str,
    input: CreateSalesOrderFromQuoteInput,
) -> Result<SalesOrderDetail, SalesOrderError> {
    let tx = conn.transaction()?;
    let detail = create_sales_order_from_quote_in_tx(&tx, tenant_id, user_id, input)?;
    tx.commit()?;
    Ok(detail)
}

/// SO-13: Sales order lines (items, quantities, unit prices) are immutable after creation.
pub fn reject_sales_order_line_modification() -> Result<(), SalesOrderError> {
    Err(SalesOrderError::LinesImmutable)
}

pub fn ship_sales_order_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    user_id: &str,
    order_id: &str,
    ship_date: Option<String>,
    line_shipped_quantities: Option<Vec<ShippedLineInput>>,
    today_override: Option<&str>,
) -> Result<SalesOrderDetail, SalesOrderError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(SalesOrderError::EmptyTenantId);
    }
    let trimmed_uid = user_id.trim();
    if trimmed_uid.is_empty() {
        return Err(SalesOrderError::EmptyUserId);
    }

    // SH-04: Validate ship_date (default today, valid calendar date, not later than today)
    let today = match today_override {
        Some(t) => {
            let trimmed = t.trim();
            parse_date(trimmed)?;
            trimmed.to_string()
        }
        None => get_today_local(conn)?,
    };

    let resolved_ship_date = match clean_opt_str(ship_date) {
        Some(d) => {
            parse_date(&d)?;
            if d.as_str() > today.as_str() {
                return Err(SalesOrderError::ShipDateCannotBeInFuture);
            }
            d
        }
        None => today,
    };

    let trimmed_order_id = order_id.trim();
    let (status, warehouse_id): (String, String) = {
        let mut stmt = conn.prepare(
            "SELECT status, warehouse_id FROM sales_orders WHERE id = ?1 AND tenant_id = ?2",
        )?;
        stmt.query_row(params![trimmed_order_id, tid], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map_err(|_| SalesOrderError::OrderNotFound)?
    };

    // SH-01 pre-check
    if status != "confirmed" {
        return Err(SalesOrderError::InvalidStateTransition {
            from: status,
            to: "shipped".to_string(),
        });
    }

    // SO-03: Re-validate warehouse is active before shipment
    let warehouse = crate::warehouses::validate_warehouse_active(conn, tid, &warehouse_id)
        .map_err(map_warehouse_error)?;

    let now = current_timestamp();
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

    // SH-01: Conditional UPDATE inside Immediate transaction to prevent duplicate shipment
    let affected = tx.execute(
        "UPDATE sales_orders
         SET status = 'shipped', ship_date = ?1, shipped_by = ?2, shipped_at = ?3
         WHERE id = ?4 AND status = 'confirmed' AND tenant_id = ?5",
        params![resolved_ship_date, trimmed_uid, now, trimmed_order_id, tid],
    )?;

    crate::ensure_guarded_mutation_affected(
        &tx,
        "sales_orders",
        trimmed_order_id,
        tid,
        affected,
        SalesOrderError::OrderNotFound,
        |s| {
            if s != "confirmed" {
                Err(SalesOrderError::InvalidStateTransition {
                    from: s,
                    to: "shipped".to_string(),
                })
            } else {
                Ok(())
            }
        },
    )?;

    // Fetch order lines inside transaction
    let lines: Vec<(String, String, f64, String, String, String)> = {
        let mut stmt = tx.prepare(
            "SELECT id, unit_id, quantity, product_name_snapshot, variant_name_snapshot, unit_name_snapshot
             FROM sales_order_lines
             WHERE sales_order_id = ?1
             ORDER BY line_no ASC",
        )?;
        let rows = stmt.query_map(params![trimmed_order_id], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
            ))
        })?;
        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        list
    };

    if lines.is_empty() {
        return Err(SalesOrderError::EmptyLines);
    }

    let known_line_ids: HashSet<&str> = lines.iter().map(|l| l.0.as_str()).collect();
    let mut override_map: HashMap<String, f64> = HashMap::new();
    if let Some(inputs) = line_shipped_quantities {
        for item in inputs {
            let lid = item.line_id.trim().to_string();
            if !known_line_ids.contains(lid.as_str()) {
                return Err(SalesOrderError::LineNotFound);
            }
            if override_map.insert(lid, item.shipped_quantity).is_some() {
                return Err(SalesOrderError::DuplicateShipLineInput);
            }
        }
    }

    // SH-02: Validate 0 <= shipped_quantity <= quantity for every line, and SUM(shipped_quantity) > 0
    let mut resolved_lines = Vec::with_capacity(lines.len());
    let mut total_shipped = 0.0_f64;
    for (lid, unit_id, ordered_qty, prod_name, var_name, unit_name) in lines {
        let actual_qty = match override_map.get(&lid) {
            Some(&q) => q,
            None => ordered_qty,
        };
        if actual_qty.is_nan() || actual_qty.is_infinite() || actual_qty < 0.0 {
            return Err(SalesOrderError::ShippedQuantityNegative);
        }
        if actual_qty > ordered_qty {
            return Err(SalesOrderError::ShippedQuantityExceedsOrder);
        }
        total_shipped += actual_qty;
        resolved_lines.push((lid, unit_id, actual_qty, prod_name, var_name, unit_name));
    }

    if total_shipped <= 0.0 {
        return Err(SalesOrderError::TotalShippedQuantityMustBePositive);
    }

    // SH-03: Check available stock per (unit_id + warehouse_id) inside Immediate tx; deduct & record movements
    for (lid, unit_id, actual_qty, prod_name, var_name, unit_name) in resolved_lines {
        tx.execute(
            "UPDATE sales_order_lines SET shipped_quantity = ?1 WHERE id = ?2",
            params![actual_qty, lid],
        )?;

        // Intentionally skip writing inventory_movements when shipped_quantity == 0
        if actual_qty <= 0.0 {
            continue;
        }

        let current_stock: f64 = tx.query_row(
            "SELECT COALESCE(SUM(quantity_delta), 0.0)
             FROM inventory_movements
             WHERE tenant_id = ?1 AND unit_id = ?2 AND warehouse_id = ?3",
            params![tid, unit_id, warehouse.id],
            |r| r.get(0),
        )?;

        if current_stock + 1e-9 < actual_qty {
            return Err(SalesOrderError::InsufficientStock(Box::new(
                InsufficientStockDetails {
                    product_name: prod_name,
                    variant_name: var_name,
                    unit_name,
                    warehouse_name: warehouse.name.clone(),
                    available_qty: format_qty(current_stock),
                    requested_qty: format_qty(actual_qty),
                },
            )));
        }

        let mov_id = format!(
            "mov_so_{}_{}",
            now,
            MOV_SO_ID_COUNTER.fetch_add(1, Ordering::SeqCst)
        );
        tx.execute(
            "INSERT INTO inventory_movements (
                id, tenant_id, unit_id, warehouse_id, quantity_delta, unit_cost,
                reason, reference_type, reference_id, created_by, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, 'sales_shipment', 'sales_order', ?6, ?7, ?8)",
            params![
                mov_id,
                tid,
                unit_id,
                warehouse.id,
                -actual_qty,
                trimmed_order_id,
                trimmed_uid,
                now,
            ],
        )?;
    }

    tx.commit()?;

    fetch_sales_order_detail(conn, tid, trimmed_order_id)
}

pub fn cancel_sales_order_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    user_id: &str,
    order_id: &str,
) -> Result<SalesOrderDetail, SalesOrderError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(SalesOrderError::EmptyTenantId);
    }
    let trimmed_uid = user_id.trim();
    if trimmed_uid.is_empty() {
        return Err(SalesOrderError::EmptyUserId);
    }

    let trimmed_order_id = order_id.trim();
    let status: String = {
        let mut stmt =
            conn.prepare("SELECT status FROM sales_orders WHERE id = ?1 AND tenant_id = ?2")?;
        stmt.query_row(params![trimmed_order_id, tid], |row| row.get(0))
            .map_err(|_| SalesOrderError::OrderNotFound)?
    };

    if status != "confirmed" {
        return Err(SalesOrderError::InvalidStateTransition {
            from: status,
            to: "cancelled".to_string(),
        });
    }

    // Note (SO-14 / #223): M14 active invoice check will be added here when M14 lands.
    // Issue #220 intentionally does not read any M14 tables.

    let now = current_timestamp();
    let tx = conn.transaction()?;

    let affected = tx.execute(
        "UPDATE sales_orders
         SET status = 'cancelled', cancelled_at = ?1
         WHERE id = ?2 AND status = 'confirmed' AND tenant_id = ?3",
        params![now, trimmed_order_id, tid],
    )?;

    crate::ensure_guarded_mutation_affected(
        &tx,
        "sales_orders",
        trimmed_order_id,
        tid,
        affected,
        SalesOrderError::OrderNotFound,
        |s| {
            if s != "confirmed" {
                Err(SalesOrderError::InvalidStateTransition {
                    from: s,
                    to: "cancelled".to_string(),
                })
            } else {
                Ok(())
            }
        },
    )?;

    tx.commit()?;

    fetch_sales_order_detail(conn, tid, trimmed_order_id)
}

pub fn get_sales_order_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    order_id: &str,
) -> Result<SalesOrderDetail, SalesOrderError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(SalesOrderError::EmptyTenantId);
    }
    fetch_sales_order_detail(conn, tid, order_id.trim())
}

pub fn list_sales_orders_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    status: Option<String>,
    customer_partner_id: Option<String>,
    warehouse_id: Option<String>,
) -> Result<Vec<SalesOrder>, SalesOrderError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(SalesOrderError::EmptyTenantId);
    }

    let mut query = String::from(
        "SELECT
            so.id, so.tenant_id, so.so_number, so.customer_partner_id, so.customer_name_snapshot,
            so.customer_reference, so.source_quote_id, so.warehouse_id, so.currency, so.status,
            so.expected_ship_date, so.ship_date, so.note, so.created_by, so.created_at,
            so.confirmed_at, so.shipped_by, so.shipped_at, so.cancelled_at, so.task_id,
            COALESCE((SELECT SUM(ROUND(l.quantity * l.unit_price, 2)) FROM sales_order_lines l WHERE l.sales_order_id = so.id), 0.0) AS total_amount,
            COALESCE((SELECT SUM(ROUND(COALESCE(l.shipped_quantity, 0.0) * l.unit_price, 2)) FROM sales_order_lines l WHERE l.sales_order_id = so.id), 0.0) AS shipped_amount,
            (SELECT COUNT(*) FROM sales_order_lines l WHERE l.sales_order_id = so.id) AS lines_count
         FROM sales_orders so
         WHERE so.tenant_id = ?1",
    );

    let mut param_values: Vec<rusqlite::types::Value> =
        vec![rusqlite::types::Value::Text(tid.to_string())];

    if let Some(st) = clean_opt_str(status) {
        query.push_str(&format!(" AND so.status = ?{}", param_values.len() + 1));
        param_values.push(rusqlite::types::Value::Text(st));
    }

    if let Some(cid) = clean_opt_str(customer_partner_id) {
        query.push_str(&format!(
            " AND so.customer_partner_id = ?{}",
            param_values.len() + 1
        ));
        param_values.push(rusqlite::types::Value::Text(cid));
    }

    if let Some(wid) = clean_opt_str(warehouse_id) {
        query.push_str(&format!(
            " AND so.warehouse_id = ?{}",
            param_values.len() + 1
        ));
        param_values.push(rusqlite::types::Value::Text(wid));
    }

    query.push_str(" ORDER BY so.created_at DESC, so.id DESC");

    let mut stmt = conn.prepare(&query)?;
    let param_refs: Vec<&dyn rusqlite::ToSql> = param_values
        .iter()
        .map(|v| v as &dyn rusqlite::ToSql)
        .collect();

    let rows = stmt.query_map(param_refs.as_slice(), map_sales_order_row)?;
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
pub async fn ship_sales_order<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    order_id: String,
    ship_date: Option<String>,
    line_shipped_quantities: Option<Vec<ShippedLineInput>>,
    today_override: Option<String>,
) -> Result<SalesOrderDetail, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;
    ship_sales_order_impl(
        &mut conn,
        &active_tid,
        &active_uid,
        &order_id,
        ship_date,
        line_shipped_quantities,
        today_override.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_sales_order<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    order_id: String,
) -> Result<SalesOrderDetail, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;
    cancel_sales_order_impl(&mut conn, &active_tid, &active_uid, &order_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn get_sales_order<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    order_id: String,
) -> Result<SalesOrderDetail, String> {
    let db_path = get_db_path(&app_handle);
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    get_sales_order_impl(&conn, &active_tid, &order_id).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn list_sales_orders<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    status: Option<String>,
    customer_partner_id: Option<String>,
    warehouse_id: Option<String>,
) -> Result<Vec<SalesOrder>, String> {
    let db_path = get_db_path(&app_handle);
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    list_sales_orders_impl(
        &conn,
        &active_tid,
        status,
        customer_partner_id,
        warehouse_id,
    )
    .map_err(|e| e.to_string())
}

// ==========================================
// Tests (Layer 1)
// ==========================================

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_test_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::warehouses::create_warehouses_tables(&conn).unwrap();
        crate::partners::create_partners_table(&conn).unwrap();
        crate::products::create_products_tables(&conn).unwrap();
        crate::purchase_orders::create_purchase_orders_tables(&conn).unwrap();
        crate::warehouses::ensure_warehouse_columns_and_indices(&conn).unwrap();
        crate::quotes::create_quotes_tables(&conn).unwrap();
        create_sales_orders_tables(&conn).unwrap();

        conn.execute(
            "CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL)",
            [],
        )
        .unwrap();
        conn.execute(
            "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL, password TEXT NOT NULL, name TEXT NOT NULL)",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO tenants (id, code, name) VALUES ('tnt_test', 'test', 'Test Tenant'), ('tnt_other', 'other', 'Other Tenant')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO users (id, email, password, name) VALUES ('usr_1', 'u1@test.com', 'p', 'User 1'), ('usr_wh', 'wh@test.com', 'p', 'Warehouse Staff')",
            [],
        )
        .unwrap();

        conn
    }

    fn seed_customer(conn: &rusqlite::Connection, tenant_id: &str, name: &str) -> String {
        let partner = crate::partners::create_partner_impl(
            conn,
            tenant_id,
            name.to_string(),
            Some(true),
            Some(false),
            None,
        )
        .unwrap();
        partner.id
    }

    fn seed_product_unit(
        conn: &rusqlite::Connection,
        tenant_id: &str,
        name: &str,
        selling_price: f64,
    ) -> (String, String) {
        let detail = crate::products::create_product_impl(
            conn,
            tenant_id,
            name.to_string(),
            "resale".to_string(),
            Some(format!("SKU-{}", name)),
            Some("個".to_string()),
            Some(selling_price),
        )
        .unwrap();
        (detail.product.id, detail.units[0].id.clone())
    }

    fn seed_stock(
        conn: &rusqlite::Connection,
        tenant_id: &str,
        unit_id: &str,
        warehouse_id: &str,
        qty: f64,
    ) {
        let id = format!(
            "mov_seed_{}_{}",
            current_timestamp(),
            MOV_SO_ID_COUNTER.fetch_add(1, Ordering::SeqCst)
        );
        conn.execute(
            "INSERT INTO inventory_movements (
                id, tenant_id, unit_id, warehouse_id, quantity_delta, unit_cost,
                reason, reference_type, reference_id, created_by, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, 50.0, 'opening_balance', 'opening_balance', NULL, 'usr_1', ?6)",
            params![id, tenant_id, unit_id, warehouse_id, qty, current_timestamp()],
        )
        .unwrap();
    }

    fn sample_line_input(
        unit_id: &str,
        name: &str,
        qty: f64,
        price: f64,
    ) -> CreateSalesOrderLineFromQuoteInput {
        CreateSalesOrderLineFromQuoteInput {
            unit_id: unit_id.to_string(),
            product_name_snapshot: name.to_string(),
            variant_name_snapshot: "標準規格".to_string(),
            sku_snapshot: Some(format!("SKU-{}", name)),
            unit_name_snapshot: "個".to_string(),
            quantity: qty,
            unit_price: price,
            standard_price_snapshot: price + 20.0,
        }
    }

    #[test]
    fn test_tc_so_n_01_create_with_default_warehouse_and_price_snapshot_invariance() {
        // Given: Tenant has default warehouse, active customer, product with selling_price 200, and quote price 150
        let mut conn = setup_test_db();
        let def_wh =
            crate::warehouses::create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉")
                .unwrap();
        let cust_id = seed_customer(&conn, "tnt_test", "台積電");
        let (prod_id, unit_id) = seed_product_unit(&conn, "tnt_test", "晶片", 200.0);

        // Update product selling_price after quote was locked to ensure SO does NOT re-fetch selling_price
        crate::products::update_product_unit_impl(
            &conn,
            "tnt_test",
            &unit_id,
            None,
            None,
            None,
            Some(999.0),
        )
        .unwrap();
        let _ = prod_id;

        // When: Creating confirmed sales order without specifying warehouse_id
        let detail = create_sales_order_from_quote_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesOrderFromQuoteInput {
                source_quote_id: "quo_1".to_string(),
                customer_partner_id: cust_id.clone(),
                customer_name_snapshot: Some("台積電(報價快照)".to_string()),
                customer_reference: Some("CUST-PO-88".to_string()),
                warehouse_id: None,
                currency: None,
                expected_ship_date: None,
                note: None,
                task_id: None,
                lines: vec![sample_line_input(&unit_id, "晶片(報價快照)", 4.0, 150.0)],
            },
        )
        .unwrap();

        // Then: Confirmed SO created with SO-00001, default warehouse, preserved quote price 150 (not 999)
        assert!(detail.order.id.starts_with("so_"));
        assert_eq!(detail.order.so_number, "SO-00001");
        assert_eq!(detail.order.status, "confirmed");
        assert_eq!(detail.order.confirmed_at, detail.order.created_at);
        assert_eq!(detail.order.warehouse_id, def_wh.id);
        assert_eq!(detail.order.currency, "TWD");
        assert_eq!(detail.order.customer_name_snapshot, "台積電(報價快照)");
        assert_eq!(
            detail.order.customer_reference.as_deref(),
            Some("CUST-PO-88")
        );
        assert_eq!(detail.order.source_quote_id, "quo_1");
        assert_eq!(detail.order.total_amount, 600.0);
        assert_eq!(detail.order.shipped_amount, 0.0);
        assert_eq!(detail.order.lines_count, Some(1));
        assert_eq!(detail.lines.len(), 1);
        assert_eq!(detail.lines[0].unit_price, 150.0);
        assert_eq!(detail.lines[0].standard_price_snapshot, 170.0);
        assert_eq!(detail.lines[0].shipped_quantity, None);
    }

    #[test]
    fn test_tc_so_n_02_explicit_warehouse_and_sequence_increment() {
        // Given: Two warehouses and active customer
        let mut conn = setup_test_db();
        let _wh1 = crate::warehouses::create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉")
            .unwrap();
        let wh2 =
            crate::warehouses::create_warehouse_impl(&mut conn, "tnt_test", "SUB", "二倉").unwrap();
        let cust_id = seed_customer(&conn, "tnt_test", "聯發科");
        let (_, unit_id) = seed_product_unit(&conn, "tnt_test", "感測器", 100.0);

        // When: Creating two sales orders
        let d1 = create_sales_order_from_quote_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesOrderFromQuoteInput {
                source_quote_id: "quo_a".to_string(),
                customer_partner_id: cust_id.clone(),
                customer_name_snapshot: None,
                customer_reference: None,
                warehouse_id: Some(wh2.id.clone()),
                currency: Some("TWD".to_string()),
                expected_ship_date: Some("2026-11-20".to_string()),
                note: Some("急件".to_string()),
                task_id: None,
                lines: vec![sample_line_input(&unit_id, "感測器", 2.0, 100.0)],
            },
        )
        .unwrap();

        let d2 = create_sales_order_from_quote_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesOrderFromQuoteInput {
                source_quote_id: "quo_b".to_string(),
                customer_partner_id: cust_id,
                customer_name_snapshot: None,
                customer_reference: None,
                warehouse_id: Some(wh2.id.clone()),
                currency: None,
                expected_ship_date: None,
                note: None,
                task_id: None,
                lines: vec![sample_line_input(&unit_id, "感測器", 3.0, 100.0)],
            },
        )
        .unwrap();

        // Then: Sequence increments and fields preserved
        assert_eq!(d1.order.so_number, "SO-00001");
        assert_eq!(d1.order.warehouse_id, wh2.id);
        assert_eq!(d1.order.expected_ship_date.as_deref(), Some("2026-11-20"));
        assert_eq!(d1.order.note.as_deref(), Some("急件"));
        assert_eq!(d2.order.so_number, "SO-00002");
    }

    #[test]
    fn test_tc_so_n_03_cancel_confirmed_sales_order() {
        // Given: A confirmed sales order
        let mut conn = setup_test_db();
        let wh = crate::warehouses::create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉")
            .unwrap();
        let cust_id = seed_customer(&conn, "tnt_test", "日月光");
        let (_, unit_id) = seed_product_unit(&conn, "tnt_test", "封裝膠", 50.0);
        seed_stock(&conn, "tnt_test", &unit_id, &wh.id, 100.0);

        let so = create_sales_order_from_quote_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesOrderFromQuoteInput {
                source_quote_id: "quo_cancel".to_string(),
                customer_partner_id: cust_id,
                customer_name_snapshot: None,
                customer_reference: None,
                warehouse_id: Some(wh.id.clone()),
                currency: None,
                expected_ship_date: None,
                note: None,
                task_id: None,
                lines: vec![sample_line_input(&unit_id, "封裝膠", 10.0, 50.0)],
            },
        )
        .unwrap();

        // When: Cancelling the confirmed sales order
        let cancelled =
            cancel_sales_order_impl(&mut conn, "tnt_test", "usr_wh", &so.order.id).unwrap();

        // Then: Status is cancelled, cancelled_at is set, no sales_shipment movements created
        assert_eq!(cancelled.order.status, "cancelled");
        assert!(cancelled.order.cancelled_at.is_some());
        let mov_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM inventory_movements WHERE reference_id = ?1",
                params![so.order.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(mov_count, 0);
    }

    #[test]
    fn test_tc_sh_n_01_full_shipment_writes_ledger_and_defaults_today() {
        // Given: Confirmed SO with 10 qty and 25 stock in warehouse
        let mut conn = setup_test_db();
        let wh = crate::warehouses::create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉")
            .unwrap();
        let cust_id = seed_customer(&conn, "tnt_test", "廣達");
        let (_, unit_id) = seed_product_unit(&conn, "tnt_test", "伺服器主板", 1200.0);
        seed_stock(&conn, "tnt_test", &unit_id, &wh.id, 25.0);

        let so = create_sales_order_from_quote_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesOrderFromQuoteInput {
                source_quote_id: "quo_ship_1".to_string(),
                customer_partner_id: cust_id,
                customer_name_snapshot: None,
                customer_reference: None,
                warehouse_id: Some(wh.id.clone()),
                currency: None,
                expected_ship_date: None,
                note: None,
                task_id: None,
                lines: vec![sample_line_input(&unit_id, "伺服器主板", 10.0, 1000.0)],
            },
        )
        .unwrap();

        // When: Shipping with ship_date=None and line_shipped_quantities=None
        let shipped = ship_sales_order_impl(
            &mut conn,
            "tnt_test",
            "usr_wh",
            &so.order.id,
            None,
            None,
            Some("2026-11-11"),
        )
        .unwrap();

        // Then: Status is shipped, ship_date defaulted to today, stock deducted by 10, movement recorded with unit_cost=NULL
        assert_eq!(shipped.order.status, "shipped");
        assert_eq!(shipped.order.ship_date.as_deref(), Some("2026-11-11"));
        assert_eq!(shipped.order.shipped_by.as_deref(), Some("usr_wh"));
        assert!(shipped.order.shipped_at.is_some());
        assert_eq!(shipped.order.shipped_amount, 10000.0);
        assert_eq!(shipped.lines[0].shipped_quantity, Some(10.0));
        assert_eq!(shipped.lines[0].shipped_subtotal, Some(10000.0));

        let stock_after: f64 = conn
            .query_row(
                "SELECT COALESCE(SUM(quantity_delta), 0.0) FROM inventory_movements WHERE tenant_id = 'tnt_test' AND unit_id = ?1 AND warehouse_id = ?2",
                params![unit_id, wh.id],
                |r| r.get(0),
            )
            .unwrap();
        assert!((stock_after - 15.0).abs() < 1e-9);

        let (delta, unit_cost, reason, ref_type, ref_id): (
            f64,
            Option<f64>,
            String,
            String,
            String,
        ) = conn
            .query_row(
                "SELECT quantity_delta, unit_cost, reason, reference_type, reference_id
                 FROM inventory_movements WHERE reference_id = ?1",
                params![so.order.id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .unwrap();
        assert_eq!(delta, -10.0);
        assert_eq!(unit_cost, None);
        assert_eq!(reason, "sales_shipment");
        assert_eq!(ref_type, "sales_order");
        assert_eq!(ref_id, so.order.id);
    }

    #[test]
    fn test_tc_sh_n_02_partial_shipment_and_zero_qty_line_skips_movement() {
        // Given: Confirmed SO with 2 lines (qty 10 and 5) and sufficient stock
        let mut conn = setup_test_db();
        let wh = crate::warehouses::create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉")
            .unwrap();
        let cust_id = seed_customer(&conn, "tnt_test", "緯創");
        let (_, u1) = seed_product_unit(&conn, "tnt_test", "料號A", 100.0);
        let (_, u2) = seed_product_unit(&conn, "tnt_test", "料號B", 200.0);
        seed_stock(&conn, "tnt_test", &u1, &wh.id, 20.0);
        seed_stock(&conn, "tnt_test", &u2, &wh.id, 20.0);

        let so = create_sales_order_from_quote_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesOrderFromQuoteInput {
                source_quote_id: "quo_partial".to_string(),
                customer_partner_id: cust_id,
                customer_name_snapshot: None,
                customer_reference: None,
                warehouse_id: Some(wh.id.clone()),
                currency: None,
                expected_ship_date: None,
                note: None,
                task_id: None,
                lines: vec![
                    sample_line_input(&u1, "料號A", 10.0, 100.0),
                    sample_line_input(&u2, "料號B", 5.0, 200.0),
                ],
            },
        )
        .unwrap();

        let l1_id = so.lines[0].id.clone();
        let l2_id = so.lines[1].id.clone();

        // When: Shipping line 1 with 7 and line 2 with 0
        let shipped = ship_sales_order_impl(
            &mut conn,
            "tnt_test",
            "usr_wh",
            &so.order.id,
            Some("2026-11-10".to_string()),
            Some(vec![
                ShippedLineInput {
                    line_id: l1_id,
                    shipped_quantity: 7.0,
                },
                ShippedLineInput {
                    line_id: l2_id,
                    shipped_quantity: 0.0,
                },
            ]),
            Some("2026-11-11"),
        )
        .unwrap();

        // Then: Order closes as shipped, line 2 shipped_quantity is 0, NO 0-delta movement written for line 2
        assert_eq!(shipped.order.status, "shipped");
        assert_eq!(shipped.order.ship_date.as_deref(), Some("2026-11-10"));
        assert_eq!(shipped.order.total_amount, 2000.0);
        assert_eq!(shipped.order.shipped_amount, 700.0);
        assert_eq!(shipped.lines[0].shipped_quantity, Some(7.0));
        assert_eq!(shipped.lines[1].shipped_quantity, Some(0.0));

        let mov_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM inventory_movements WHERE reference_id = ?1",
                params![so.order.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(mov_count, 1);

        let u2_stock: f64 = conn
            .query_row(
                "SELECT COALESCE(SUM(quantity_delta), 0.0) FROM inventory_movements WHERE tenant_id = 'tnt_test' AND unit_id = ?1 AND warehouse_id = ?2",
                params![u2, wh.id],
                |r| r.get(0),
            )
            .unwrap();
        assert!((u2_stock - 20.0).abs() < 1e-9);
    }

    #[test]
    fn test_tc_sh_b_01_and_b_02_stock_boundaries_and_1e9_tolerance() {
        // Given: Warehouse with stock 10.0 - 5e-10 (within 1e-9 tolerance) and another unit with 9.999999
        let mut conn = setup_test_db();
        let wh = crate::warehouses::create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉")
            .unwrap();
        let cust_id = seed_customer(&conn, "tnt_test", "和碩");
        let (_, u_tol) = seed_product_unit(&conn, "tnt_test", "容差件", 10.0);
        let (_, u_short) = seed_product_unit(&conn, "tnt_test", "短少件", 10.0);
        seed_stock(&conn, "tnt_test", &u_tol, &wh.id, 10.0 - 5e-10);
        seed_stock(&conn, "tnt_test", &u_short, &wh.id, 9.999);

        let so_tol = create_sales_order_from_quote_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesOrderFromQuoteInput {
                source_quote_id: "quo_tol".to_string(),
                customer_partner_id: cust_id.clone(),
                customer_name_snapshot: None,
                customer_reference: None,
                warehouse_id: Some(wh.id.clone()),
                currency: None,
                expected_ship_date: None,
                note: None,
                task_id: None,
                lines: vec![sample_line_input(&u_tol, "容差件", 10.0, 10.0)],
            },
        )
        .unwrap();

        let so_short = create_sales_order_from_quote_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesOrderFromQuoteInput {
                source_quote_id: "quo_short".to_string(),
                customer_partner_id: cust_id,
                customer_name_snapshot: None,
                customer_reference: None,
                warehouse_id: Some(wh.id.clone()),
                currency: None,
                expected_ship_date: None,
                note: None,
                task_id: None,
                lines: vec![sample_line_input(&u_short, "短少件", 10.0, 10.0)],
            },
        )
        .unwrap();

        // When: Shipping so_tol (within 1e-9) and so_short (short by 0.001)
        let ok_res = ship_sales_order_impl(
            &mut conn,
            "tnt_test",
            "usr_wh",
            &so_tol.order.id,
            None,
            None,
            Some("2026-11-11"),
        );
        let err_res = ship_sales_order_impl(
            &mut conn,
            "tnt_test",
            "usr_wh",
            &so_short.order.id,
            None,
            None,
            Some("2026-11-11"),
        );

        // Then: so_tol succeeds; so_short fails with exact InsufficientStock message
        assert!(ok_res.is_ok());
        let err = err_res.unwrap_err();
        assert_eq!(
            err.to_string(),
            "〔短少件／標準規格／個〕在〔主倉〕現有 9.999，不足出貨 10"
        );
        let reloaded = get_sales_order_impl(&conn, "tnt_test", &so_short.order.id).unwrap();
        assert_eq!(reloaded.order.status, "confirmed");
    }

    #[test]
    fn test_tc_sh_b_03_ship_date_calendar_and_future_boundaries() {
        // Given: Confirmed SO with stock
        let mut conn = setup_test_db();
        let wh = crate::warehouses::create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉")
            .unwrap();
        let cust_id = seed_customer(&conn, "tnt_test", "英業達");
        let (_, unit_id) = seed_product_unit(&conn, "tnt_test", "電源模組", 300.0);
        seed_stock(&conn, "tnt_test", &unit_id, &wh.id, 10.0);

        let so = create_sales_order_from_quote_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesOrderFromQuoteInput {
                source_quote_id: "quo_date".to_string(),
                customer_partner_id: cust_id,
                customer_name_snapshot: None,
                customer_reference: None,
                warehouse_id: Some(wh.id.clone()),
                currency: None,
                expected_ship_date: None,
                note: None,
                task_id: None,
                lines: vec![sample_line_input(&unit_id, "電源模組", 2.0, 300.0)],
            },
        )
        .unwrap();

        // When / Then: Future date rejected
        let err_future = ship_sales_order_impl(
            &mut conn,
            "tnt_test",
            "usr_wh",
            &so.order.id,
            Some("2026-11-12".to_string()),
            None,
            Some("2026-11-11"),
        )
        .unwrap_err();
        assert_eq!(err_future, SalesOrderError::ShipDateCannotBeInFuture);
        assert_eq!(err_future.to_string(), "出貨日不可晚於今天");

        // When / Then: Non-leap Feb 29 rejected
        let err_leap = ship_sales_order_impl(
            &mut conn,
            "tnt_test",
            "usr_wh",
            &so.order.id,
            Some("2026-02-29".to_string()),
            None,
            Some("2026-11-11"),
        )
        .unwrap_err();
        assert!(matches!(err_leap, SalesOrderError::InvalidDateFormat(_)));

        // When / Then: Bad format rejected
        let err_fmt = ship_sales_order_impl(
            &mut conn,
            "tnt_test",
            "usr_wh",
            &so.order.id,
            Some("2026/11/11".to_string()),
            None,
            Some("2026-11-11"),
        )
        .unwrap_err();
        assert!(matches!(err_fmt, SalesOrderError::InvalidDateFormat(_)));

        // When / Then: Today boundary succeeds
        let ok_today = ship_sales_order_impl(
            &mut conn,
            "tnt_test",
            "usr_wh",
            &so.order.id,
            Some("2026-11-11".to_string()),
            None,
            Some("2026-11-11"),
        )
        .unwrap();
        assert_eq!(ok_today.order.ship_date.as_deref(), Some("2026-11-11"));
    }

    #[test]
    fn test_tc_so_a_01_to_04_creation_validation_and_error_cases() {
        let mut conn = setup_test_db();
        let wh = crate::warehouses::create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉")
            .unwrap();
        let cust_id = seed_customer(&conn, "tnt_test", "宏碁");
        let vendor = crate::partners::create_partner_impl(
            &conn,
            "tnt_test",
            "純供應商".to_string(),
            Some(false),
            Some(true),
            None,
        )
        .unwrap();
        let inactive_cust = crate::partners::create_partner_impl(
            &conn,
            "tnt_test",
            "停用客戶".to_string(),
            Some(true),
            Some(false),
            None,
        )
        .unwrap();
        conn.execute(
            "UPDATE partners SET is_active = 0 WHERE id = ?1",
            params![inactive_cust.id],
        )
        .unwrap();

        let (_, u1) = seed_product_unit(&conn, "tnt_test", "筆電", 20000.0);
        let (_, u_other) = seed_product_unit(&conn, "tnt_other", "他租戶商品", 500.0);

        // SO-01: Empty tenant / user / source_quote_id
        let err_tid = create_sales_order_from_quote_impl(
            &mut conn,
            "",
            "usr_1",
            CreateSalesOrderFromQuoteInput {
                source_quote_id: "q1".to_string(),
                customer_partner_id: cust_id.clone(),
                customer_name_snapshot: None,
                customer_reference: None,
                warehouse_id: Some(wh.id.clone()),
                currency: None,
                expected_ship_date: None,
                note: None,
                task_id: None,
                lines: vec![sample_line_input(&u1, "筆電", 1.0, 20000.0)],
            },
        )
        .unwrap_err();
        assert_eq!(err_tid, SalesOrderError::EmptyTenantId);

        let err_uid = create_sales_order_from_quote_impl(
            &mut conn,
            "tnt_test",
            "  ",
            CreateSalesOrderFromQuoteInput {
                source_quote_id: "q1".to_string(),
                customer_partner_id: cust_id.clone(),
                customer_name_snapshot: None,
                customer_reference: None,
                warehouse_id: Some(wh.id.clone()),
                currency: None,
                expected_ship_date: None,
                note: None,
                task_id: None,
                lines: vec![sample_line_input(&u1, "筆電", 1.0, 20000.0)],
            },
        )
        .unwrap_err();
        assert_eq!(err_uid, SalesOrderError::EmptyUserId);

        let err_q = create_sales_order_from_quote_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesOrderFromQuoteInput {
                source_quote_id: "".to_string(),
                customer_partner_id: cust_id.clone(),
                customer_name_snapshot: None,
                customer_reference: None,
                warehouse_id: Some(wh.id.clone()),
                currency: None,
                expected_ship_date: None,
                note: None,
                task_id: None,
                lines: vec![sample_line_input(&u1, "筆電", 1.0, 20000.0)],
            },
        )
        .unwrap_err();
        assert_eq!(err_q, SalesOrderError::EmptySourceQuoteId);

        // SO-02: Non-customer & inactive customer
        for bad_cust in [&vendor.id, &inactive_cust.id, &"missing_cust".to_string()] {
            let err_c = create_sales_order_from_quote_impl(
                &mut conn,
                "tnt_test",
                "usr_1",
                CreateSalesOrderFromQuoteInput {
                    source_quote_id: "q_bad_c".to_string(),
                    customer_partner_id: bad_cust.clone(),
                    customer_name_snapshot: None,
                    customer_reference: None,
                    warehouse_id: Some(wh.id.clone()),
                    currency: None,
                    expected_ship_date: None,
                    note: None,
                    task_id: None,
                    lines: vec![sample_line_input(&u1, "筆電", 1.0, 20000.0)],
                },
            )
            .unwrap_err();
            assert_eq!(err_c, SalesOrderError::CustomerNotFoundOrInactive);
        }

        // SO-03: Zero-warehouse tenant refused with warehouse management guidance
        let cust_other = seed_customer(&conn, "tnt_other", "他租戶客戶");
        let err_no_wh = create_sales_order_from_quote_impl(
            &mut conn,
            "tnt_other",
            "usr_1",
            CreateSalesOrderFromQuoteInput {
                source_quote_id: "q_no_wh".to_string(),
                customer_partner_id: cust_other,
                customer_name_snapshot: None,
                customer_reference: None,
                warehouse_id: None,
                currency: None,
                expected_ship_date: None,
                note: None,
                task_id: None,
                lines: vec![sample_line_input(&u_other, "他租戶商品", 1.0, 500.0)],
            },
        )
        .unwrap_err();
        assert_eq!(
            err_no_wh.to_string(),
            "此租戶尚未建立任何倉別，請先至「倉庫管理」建立一個倉別"
        );

        // SO-03: Nonexistent warehouse refused
        let err_bad_wh = create_sales_order_from_quote_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesOrderFromQuoteInput {
                source_quote_id: "q_bad_wh".to_string(),
                customer_partner_id: cust_id.clone(),
                customer_name_snapshot: None,
                customer_reference: None,
                warehouse_id: Some("wh_nonexistent".to_string()),
                currency: None,
                expected_ship_date: None,
                note: None,
                task_id: None,
                lines: vec![sample_line_input(&u1, "筆電", 1.0, 20000.0)],
            },
        )
        .unwrap_err();
        assert_eq!(err_bad_wh, SalesOrderError::WarehouseNotFoundOrInactive);

        // SO-05: Empty lines
        let err_empty_lines = create_sales_order_from_quote_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesOrderFromQuoteInput {
                source_quote_id: "q_empty".to_string(),
                customer_partner_id: cust_id.clone(),
                customer_name_snapshot: None,
                customer_reference: None,
                warehouse_id: Some(wh.id.clone()),
                currency: None,
                expected_ship_date: None,
                note: None,
                task_id: None,
                lines: vec![],
            },
        )
        .unwrap_err();
        assert_eq!(err_empty_lines, SalesOrderError::EmptyLines);

        // SO-06: 0 qty, negative qty, negative price
        let err_zero_qty = create_sales_order_from_quote_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesOrderFromQuoteInput {
                source_quote_id: "q_zqty".to_string(),
                customer_partner_id: cust_id.clone(),
                customer_name_snapshot: None,
                customer_reference: None,
                warehouse_id: Some(wh.id.clone()),
                currency: None,
                expected_ship_date: None,
                note: None,
                task_id: None,
                lines: vec![sample_line_input(&u1, "筆電", 0.0, 20000.0)],
            },
        )
        .unwrap_err();
        assert_eq!(err_zero_qty, SalesOrderError::InvalidQuantity);

        let err_neg_price = create_sales_order_from_quote_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesOrderFromQuoteInput {
                source_quote_id: "q_nprice".to_string(),
                customer_partner_id: cust_id.clone(),
                customer_name_snapshot: None,
                customer_reference: None,
                warehouse_id: Some(wh.id.clone()),
                currency: None,
                expected_ship_date: None,
                note: None,
                task_id: None,
                lines: vec![sample_line_input(&u1, "筆電", 1.0, -0.01)],
            },
        )
        .unwrap_err();
        assert_eq!(err_neg_price, SalesOrderError::InvalidUnitPrice);

        // SO-07: Duplicate unit_id
        let err_dup_unit = create_sales_order_from_quote_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesOrderFromQuoteInput {
                source_quote_id: "q_dupu".to_string(),
                customer_partner_id: cust_id.clone(),
                customer_name_snapshot: None,
                customer_reference: None,
                warehouse_id: Some(wh.id.clone()),
                currency: None,
                expected_ship_date: None,
                note: None,
                task_id: None,
                lines: vec![
                    sample_line_input(&u1, "筆電", 1.0, 20000.0),
                    sample_line_input(&u1, "筆電", 2.0, 20000.0),
                ],
            },
        )
        .unwrap_err();
        assert_eq!(err_dup_unit, SalesOrderError::DuplicateUnit);
        assert_eq!(err_dup_unit.to_string(), "同一銷售單內商品單位不可重複");

        // SO-08: Invalid currency & cross-tenant unit
        let err_curr = create_sales_order_from_quote_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesOrderFromQuoteInput {
                source_quote_id: "q_usd".to_string(),
                customer_partner_id: cust_id.clone(),
                customer_name_snapshot: None,
                customer_reference: None,
                warehouse_id: Some(wh.id.clone()),
                currency: Some("USD".to_string()),
                expected_ship_date: None,
                note: None,
                task_id: None,
                lines: vec![sample_line_input(&u1, "筆電", 1.0, 20000.0)],
            },
        )
        .unwrap_err();
        assert_eq!(err_curr, SalesOrderError::InvalidCurrency);

        let err_cross_u = create_sales_order_from_quote_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesOrderFromQuoteInput {
                source_quote_id: "q_cu".to_string(),
                customer_partner_id: cust_id.clone(),
                customer_name_snapshot: None,
                customer_reference: None,
                warehouse_id: Some(wh.id.clone()),
                currency: None,
                expected_ship_date: None,
                note: None,
                task_id: None,
                lines: vec![sample_line_input(&u_other, "他租戶商品", 1.0, 500.0)],
            },
        )
        .unwrap_err();
        assert_eq!(err_cross_u, SalesOrderError::UnitNotFound);

        // SO-04: Duplicate source_quote_id rejected
        create_sales_order_from_quote_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesOrderFromQuoteInput {
                source_quote_id: "q_unique".to_string(),
                customer_partner_id: cust_id.clone(),
                customer_name_snapshot: None,
                customer_reference: None,
                warehouse_id: Some(wh.id.clone()),
                currency: None,
                expected_ship_date: None,
                note: None,
                task_id: None,
                lines: vec![sample_line_input(&u1, "筆電", 1.0, 20000.0)],
            },
        )
        .unwrap();

        let err_dup_q = create_sales_order_from_quote_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesOrderFromQuoteInput {
                source_quote_id: "q_unique".to_string(),
                customer_partner_id: cust_id,
                customer_name_snapshot: None,
                customer_reference: None,
                warehouse_id: Some(wh.id),
                currency: None,
                expected_ship_date: None,
                note: None,
                task_id: None,
                lines: vec![sample_line_input(&u1, "筆電", 1.0, 20000.0)],
            },
        )
        .unwrap_err();
        assert_eq!(err_dup_q, SalesOrderError::DuplicateSourceQuote);
    }

    #[test]
    fn test_tc_so_a_05_06_and_sh_a_01_immutability_and_state_transitions() {
        // Given: Two confirmed sales orders, one shipped and one cancelled
        let mut conn = setup_test_db();
        let wh = crate::warehouses::create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉")
            .unwrap();
        let cust_id = seed_customer(&conn, "tnt_test", "華碩");
        let (_, unit_id) = seed_product_unit(&conn, "tnt_test", "顯示卡", 15000.0);
        seed_stock(&conn, "tnt_test", &unit_id, &wh.id, 10.0);

        let so1 = create_sales_order_from_quote_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesOrderFromQuoteInput {
                source_quote_id: "quo_s1".to_string(),
                customer_partner_id: cust_id.clone(),
                customer_name_snapshot: None,
                customer_reference: None,
                warehouse_id: Some(wh.id.clone()),
                currency: None,
                expected_ship_date: None,
                note: None,
                task_id: None,
                lines: vec![sample_line_input(&unit_id, "顯示卡", 2.0, 15000.0)],
            },
        )
        .unwrap();

        let so2 = create_sales_order_from_quote_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesOrderFromQuoteInput {
                source_quote_id: "quo_s2".to_string(),
                customer_partner_id: cust_id,
                customer_name_snapshot: None,
                customer_reference: None,
                warehouse_id: Some(wh.id),
                currency: None,
                expected_ship_date: None,
                note: None,
                task_id: None,
                lines: vec![sample_line_input(&unit_id, "顯示卡", 2.0, 15000.0)],
            },
        )
        .unwrap();

        // SO-13: Reject line modification
        let err_immut = reject_sales_order_line_modification().unwrap_err();
        assert_eq!(err_immut, SalesOrderError::LinesImmutable);
        assert_eq!(
            err_immut.to_string(),
            "銷售單明細不可修改，請透過庫存調整單或作廢重開報價處理"
        );

        // Ship so1, cancel so2
        ship_sales_order_impl(
            &mut conn,
            "tnt_test",
            "usr_wh",
            &so1.order.id,
            None,
            None,
            Some("2026-11-11"),
        )
        .unwrap();
        cancel_sales_order_impl(&mut conn, "tnt_test", "usr_wh", &so2.order.id).unwrap();

        // When / Then: Duplicate ship on so1 -> InvalidStateTransition
        let err_dup_ship = ship_sales_order_impl(
            &mut conn,
            "tnt_test",
            "usr_wh",
            &so1.order.id,
            None,
            None,
            Some("2026-11-11"),
        )
        .unwrap_err();
        assert_eq!(
            err_dup_ship,
            SalesOrderError::InvalidStateTransition {
                from: "shipped".to_string(),
                to: "shipped".to_string()
            }
        );
        assert_eq!(
            err_dup_ship.to_string(),
            "無效的狀態轉換：不可從 shipped 轉換至 shipped"
        );

        // When / Then: Cancel shipped so1 -> InvalidStateTransition (shipped is terminal)
        let err_cancel_shipped =
            cancel_sales_order_impl(&mut conn, "tnt_test", "usr_wh", &so1.order.id).unwrap_err();
        assert_eq!(
            err_cancel_shipped,
            SalesOrderError::InvalidStateTransition {
                from: "shipped".to_string(),
                to: "cancelled".to_string()
            }
        );

        // When / Then: Ship cancelled so2 -> InvalidStateTransition
        let err_ship_cancelled = ship_sales_order_impl(
            &mut conn,
            "tnt_test",
            "usr_wh",
            &so2.order.id,
            None,
            None,
            Some("2026-11-11"),
        )
        .unwrap_err();
        assert_eq!(
            err_ship_cancelled,
            SalesOrderError::InvalidStateTransition {
                from: "cancelled".to_string(),
                to: "shipped".to_string()
            }
        );

        // When / Then: Double cancel on so2 -> InvalidStateTransition
        let err_dup_cancel =
            cancel_sales_order_impl(&mut conn, "tnt_test", "usr_wh", &so2.order.id).unwrap_err();
        assert_eq!(
            err_dup_cancel,
            SalesOrderError::InvalidStateTransition {
                from: "cancelled".to_string(),
                to: "cancelled".to_string()
            }
        );
    }

    #[test]
    fn test_tc_sh_a_02_shipment_quantity_boundaries() {
        // Given: Confirmed SO with 2 lines (qty 5 and 3) and sufficient stock
        let mut conn = setup_test_db();
        let wh = crate::warehouses::create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉")
            .unwrap();
        let cust_id = seed_customer(&conn, "tnt_test", "技嘉");
        let (_, u1) = seed_product_unit(&conn, "tnt_test", "風扇", 200.0);
        let (_, u2) = seed_product_unit(&conn, "tnt_test", "散熱片", 150.0);
        seed_stock(&conn, "tnt_test", &u1, &wh.id, 50.0);
        seed_stock(&conn, "tnt_test", &u2, &wh.id, 50.0);

        let so = create_sales_order_from_quote_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesOrderFromQuoteInput {
                source_quote_id: "quo_qbounds".to_string(),
                customer_partner_id: cust_id,
                customer_name_snapshot: None,
                customer_reference: None,
                warehouse_id: Some(wh.id.clone()),
                currency: None,
                expected_ship_date: None,
                note: None,
                task_id: None,
                lines: vec![
                    sample_line_input(&u1, "風扇", 5.0, 200.0),
                    sample_line_input(&u2, "散熱片", 3.0, 150.0),
                ],
            },
        )
        .unwrap();
        let l1 = so.lines[0].id.clone();
        let l2 = so.lines[1].id.clone();

        // When / Then: Negative shipped_quantity rejected
        let err_neg = ship_sales_order_impl(
            &mut conn,
            "tnt_test",
            "usr_wh",
            &so.order.id,
            None,
            Some(vec![ShippedLineInput {
                line_id: l1.clone(),
                shipped_quantity: -1.0,
            }]),
            Some("2026-11-11"),
        )
        .unwrap_err();
        assert_eq!(err_neg, SalesOrderError::ShippedQuantityNegative);

        // When / Then: Over-shipped (> quantity) rejected
        let err_over = ship_sales_order_impl(
            &mut conn,
            "tnt_test",
            "usr_wh",
            &so.order.id,
            None,
            Some(vec![ShippedLineInput {
                line_id: l1.clone(),
                shipped_quantity: 5.001,
            }]),
            Some("2026-11-11"),
        )
        .unwrap_err();
        assert_eq!(err_over, SalesOrderError::ShippedQuantityExceedsOrder);
        assert_eq!(err_over.to_string(), "出貨數量不可超過訂購數量");

        // When / Then: Total shipped == 0 rejected
        let err_zero_total = ship_sales_order_impl(
            &mut conn,
            "tnt_test",
            "usr_wh",
            &so.order.id,
            None,
            Some(vec![
                ShippedLineInput {
                    line_id: l1.clone(),
                    shipped_quantity: 0.0,
                },
                ShippedLineInput {
                    line_id: l2.clone(),
                    shipped_quantity: 0.0,
                },
            ]),
            Some("2026-11-11"),
        )
        .unwrap_err();
        assert_eq!(
            err_zero_total,
            SalesOrderError::TotalShippedQuantityMustBePositive
        );
        assert_eq!(err_zero_total.to_string(), "出貨數量合計需大於 0");

        // When / Then: Unknown line_id and duplicate line_id rejected
        let err_unknown = ship_sales_order_impl(
            &mut conn,
            "tnt_test",
            "usr_wh",
            &so.order.id,
            None,
            Some(vec![ShippedLineInput {
                line_id: "sol_unknown".to_string(),
                shipped_quantity: 1.0,
            }]),
            Some("2026-11-11"),
        )
        .unwrap_err();
        assert_eq!(err_unknown, SalesOrderError::LineNotFound);

        let err_dup = ship_sales_order_impl(
            &mut conn,
            "tnt_test",
            "usr_wh",
            &so.order.id,
            None,
            Some(vec![
                ShippedLineInput {
                    line_id: l1.clone(),
                    shipped_quantity: 1.0,
                },
                ShippedLineInput {
                    line_id: l1,
                    shipped_quantity: 2.0,
                },
            ]),
            Some("2026-11-11"),
        )
        .unwrap_err();
        assert_eq!(err_dup, SalesOrderError::DuplicateShipLineInput);
    }

    #[test]
    fn test_tc_sh_a_03_atomicity_no_cross_warehouse_no_cross_unit_and_inactive_warehouse() {
        // Given: Warehouse 1 has u1=100, u2=2, and Warehouse 2 has u2=50; plus another unit u1_box of same product with 100 in wh1
        let mut conn = setup_test_db();
        let wh1 = crate::warehouses::create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉")
            .unwrap();
        let wh2 =
            crate::warehouses::create_warehouse_impl(&mut conn, "tnt_test", "SUB", "二倉").unwrap();
        let cust_id = seed_customer(&conn, "tnt_test", "微星");
        let (prod1_id, u1) = seed_product_unit(&conn, "tnt_test", "主機板", 3000.0);
        let u1_box = crate::products::add_product_unit_impl(
            &conn,
            "tnt_test",
            &conn
                .query_row(
                    "SELECT id FROM product_variants WHERE product_id = ?1 LIMIT 1",
                    params![prod1_id],
                    |r| r.get::<_, String>(0),
                )
                .unwrap(),
            "箱".to_string(),
            10.0,
            Some(false),
            30000.0,
        )
        .unwrap()
        .id;
        let (_, u2) = seed_product_unit(&conn, "tnt_test", "記憶體", 1500.0);

        seed_stock(&conn, "tnt_test", &u1, &wh1.id, 100.0);
        seed_stock(&conn, "tnt_test", &u1_box, &wh1.id, 100.0);
        seed_stock(&conn, "tnt_test", &u2, &wh1.id, 2.0);
        seed_stock(&conn, "tnt_test", &u2, &wh2.id, 50.0); // Stock in wh2 must NOT cover wh1

        let so_atomic = create_sales_order_from_quote_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesOrderFromQuoteInput {
                source_quote_id: "quo_atom".to_string(),
                customer_partner_id: cust_id.clone(),
                customer_name_snapshot: None,
                customer_reference: None,
                warehouse_id: Some(wh1.id.clone()),
                currency: None,
                expected_ship_date: None,
                note: None,
                task_id: None,
                lines: vec![
                    sample_line_input(&u1, "主機板", 5.0, 3000.0),
                    sample_line_input(&u2, "記憶體", 5.0, 1500.0), // needs 5, only 2 in wh1
                ],
            },
        )
        .unwrap();

        // When: Attempting to ship multi-line SO where line 2 lacks stock in wh1
        let err_atom = ship_sales_order_impl(
            &mut conn,
            "tnt_test",
            "usr_wh",
            &so_atomic.order.id,
            None,
            None,
            Some("2026-11-11"),
        )
        .unwrap_err();

        // Then: Entire shipment rolls back; line 1 NOT deducted; SO remains confirmed
        assert_eq!(
            err_atom.to_string(),
            "〔記憶體／標準規格／個〕在〔主倉〕現有 2，不足出貨 5"
        );
        let after = get_sales_order_impl(&conn, "tnt_test", &so_atomic.order.id).unwrap();
        assert_eq!(after.order.status, "confirmed");
        assert_eq!(after.lines[0].shipped_quantity, None);
        let mov_cnt: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM inventory_movements WHERE reference_id = ?1",
                params![so_atomic.order.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(mov_cnt, 0);

        // ADR #157: u1_box has 100 in wh1, u1 has 100; requesting 150 of u1 must NOT convert from u1_box
        let so_unit = create_sales_order_from_quote_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesOrderFromQuoteInput {
                source_quote_id: "quo_adr157".to_string(),
                customer_partner_id: cust_id.clone(),
                customer_name_snapshot: None,
                customer_reference: None,
                warehouse_id: Some(wh1.id.clone()),
                currency: None,
                expected_ship_date: None,
                note: None,
                task_id: None,
                lines: vec![sample_line_input(&u1, "主機板", 150.0, 3000.0)],
            },
        )
        .unwrap();
        let err_adr = ship_sales_order_impl(
            &mut conn,
            "tnt_test",
            "usr_wh",
            &so_unit.order.id,
            None,
            None,
            Some("2026-11-11"),
        )
        .unwrap_err();
        assert_eq!(
            err_adr.to_string(),
            "〔主機板／標準規格／個〕在〔主倉〕現有 100，不足出貨 150"
        );

        // SO-03: Deactivated warehouse blocks shipment
        let so_wh2 = create_sales_order_from_quote_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesOrderFromQuoteInput {
                source_quote_id: "quo_wh2".to_string(),
                customer_partner_id: cust_id,
                customer_name_snapshot: None,
                customer_reference: None,
                warehouse_id: Some(wh2.id.clone()),
                currency: None,
                expected_ship_date: None,
                note: None,
                task_id: None,
                lines: vec![sample_line_input(&u2, "記憶體", 1.0, 1500.0)],
            },
        )
        .unwrap();
        conn.execute(
            "UPDATE warehouses SET is_active = 0 WHERE id = ?1",
            params![wh2.id],
        )
        .unwrap();
        let err_wh_inactive = ship_sales_order_impl(
            &mut conn,
            "tnt_test",
            "usr_wh",
            &so_wh2.order.id,
            None,
            None,
            Some("2026-11-11"),
        )
        .unwrap_err();
        assert_eq!(
            err_wh_inactive,
            SalesOrderError::WarehouseNotFoundOrInactive
        );
    }

    #[test]
    fn test_tc_so_sec_01_tenant_isolation_and_guarded_mutation_whitelist() {
        // Given: Tenant A has a confirmed SO
        let mut conn = setup_test_db();
        let wh_a = crate::warehouses::create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉")
            .unwrap();
        let cust_a = seed_customer(&conn, "tnt_test", "租戶A客戶");
        let (_, u_a) = seed_product_unit(&conn, "tnt_test", "租戶A商品", 100.0);
        seed_stock(&conn, "tnt_test", &u_a, &wh_a.id, 10.0);

        let so_a = create_sales_order_from_quote_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            CreateSalesOrderFromQuoteInput {
                source_quote_id: "quo_iso".to_string(),
                customer_partner_id: cust_a,
                customer_name_snapshot: None,
                customer_reference: None,
                warehouse_id: Some(wh_a.id),
                currency: None,
                expected_ship_date: None,
                note: None,
                task_id: None,
                lines: vec![sample_line_input(&u_a, "租戶A商品", 2.0, 100.0)],
            },
        )
        .unwrap();

        // When / Then: Tenant B cannot list, get, ship, or cancel Tenant A's SO
        let list_b = list_sales_orders_impl(&conn, "tnt_other", None, None, None).unwrap();
        assert!(list_b.is_empty());

        assert_eq!(
            get_sales_order_impl(&conn, "tnt_other", &so_a.order.id).unwrap_err(),
            SalesOrderError::OrderNotFound
        );
        assert_eq!(
            ship_sales_order_impl(
                &mut conn,
                "tnt_other",
                "usr_1",
                &so_a.order.id,
                None,
                None,
                Some("2026-11-11")
            )
            .unwrap_err(),
            SalesOrderError::OrderNotFound
        );
        assert_eq!(
            cancel_sales_order_impl(&mut conn, "tnt_other", "usr_1", &so_a.order.id).unwrap_err(),
            SalesOrderError::OrderNotFound
        );

        // Verify ensure_guarded_mutation_affected recognizes "sales_orders" in ALLOWED_TABLES
        let guard_err = crate::ensure_guarded_mutation_affected(
            &conn,
            "sales_orders",
            &so_a.order.id,
            "tnt_test",
            0,
            SalesOrderError::OrderNotFound,
            |s| {
                Err(SalesOrderError::InvalidStateTransition {
                    from: s,
                    to: "shipped".to_string(),
                })
            },
        )
        .unwrap_err();
        assert_eq!(
            guard_err,
            SalesOrderError::InvalidStateTransition {
                from: "confirmed".to_string(),
                to: "shipped".to_string()
            }
        );
    }
}
