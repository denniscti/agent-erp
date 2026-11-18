use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

use crate::accounts_receivable::{
    create_account_receivable_in_tx, void_account_receivable_in_tx, CreateAccountReceivableInput,
};

static CINV_ID_COUNTER: AtomicU64 = AtomicU64::new(1);
static CINV_ORDER_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

fn current_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

fn round_2(val: f64) -> f64 {
    (val * 100.0).round() / 100.0
}

fn table_exists(conn: &Connection, table_name: &str) -> bool {
    let mut stmt = match conn
        .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1")
    {
        Ok(s) => s,
        Err(_) => return false,
    };
    let count: i64 = stmt
        .query_row(params![table_name], |r| r.get(0))
        .unwrap_or(0);
    count > 0
}

pub fn get_today_local(conn: &Connection) -> Result<String, rusqlite::Error> {
    conn.query_row("SELECT date('now', 'localtime')", [], |r| r.get(0))
}

// ==========================================
// Errors
// ==========================================

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum CustomerInvoiceError {
    #[error("租戶 ID 不可為空")]
    EmptyTenantId,

    #[error("使用者 ID 不可為空")]
    EmptyUserId,

    #[error("發票 ID 不可為空")]
    EmptyInvoiceId,

    #[error("銷售單 ID 不可為空")]
    EmptySalesOrderId,

    #[error("客戶 ID 不可為空")]
    EmptyCustomerPartnerId,

    #[error("未稅金額必須大於 0")]
    InvalidUntaxedAmount,

    #[error("銷項稅額不可小於 0")]
    InvalidTaxAmount,

    #[error("發票日期不可晚於今天")]
    InvoiceDateCannotBeInFuture,

    #[error("到期日不可早於發票日期")]
    DueDateEarlierThanInvoiceDate,

    #[error("無效的日期格式: {0}")]
    InvalidDateFormat(String),

    #[error("僅能為同一客戶、已確認或已出貨的銷售單開立發票")]
    InvalidOrderForInvoice,

    #[error("銷售單 {0} 已在發票 {1} 中")]
    OrderAlreadyCoveredInInvoice(String, String),

    #[error("逐單開立僅能涵蓋一張銷售單")]
    PerOrderLimitExceeded,

    #[error("月結彙開僅能涵蓋已出貨的銷售單")]
    MonthlyConsolidatedRequiresShipped,

    #[error("發票需至少涵蓋一張銷售單")]
    NoOrdersCovered,

    #[error("比對基準金額必須大於 0")]
    BasisAmountMustBePositive,

    #[error("發票狀態為 {0}，不可修改")]
    InvalidStateForModification(String),

    #[error("發票未稅金額與比對基準差 {0}，需填寫差異說明")]
    DifferenceNoteRequired(String),

    #[error("請登錄統一發票號碼，或選擇免開立原因")]
    TaxInvoiceOrExemptionRequired,

    #[error("選擇其他免開立原因時備註為必填")]
    OtherExemptionNoteRequired,

    #[error("發票號碼 {0} 已登錄於 {1}")]
    DuplicateTaxInvoiceNumber(String, String),

    #[error("作廢原因為必填")]
    VoidReasonRequired,

    #[error("此發票已有收款核銷：{0}，請先作廢收款單")]
    HasPostedReceiptAllocations(String),

    #[error("此發票已有折讓單 {0}，請先作廢折讓單")]
    HasPostedSalesAllowances(String),

    #[error("無效的狀態轉換：不可從 {from} 轉換至 {to}")]
    InvalidStateTransition { from: String, to: String },

    #[error("找不到指定的發票")]
    InvoiceNotFound,

    #[error("找不到指定的客戶")]
    CustomerNotFound,

    #[error("指定的合作夥伴不是客戶")]
    PartnerNotCustomer,

    #[error("應收帳款模組錯誤: {0}")]
    AccountsReceivableError(String),

    #[error("資料庫錯誤: {0}")]
    DatabaseError(String),

    #[error("{0}")]
    Other(String),
}

impl From<rusqlite::Error> for CustomerInvoiceError {
    fn from(err: rusqlite::Error) -> Self {
        CustomerInvoiceError::DatabaseError(err.to_string())
    }
}

// ==========================================
// Data Structures
// ==========================================

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct CustomerInvoice {
    pub id: String,
    pub tenant_id: String,
    pub invoice_number: String,
    pub customer_partner_id: String,
    pub customer_name_snapshot: String,
    pub issuance_mode: String,
    pub tax_invoice_number: Option<String>,
    pub tax_invoice_exemption_reason: Option<String>,
    pub invoice_date: String,
    pub due_date: String,
    pub untaxed_amount: f64,
    pub tax_amount: f64,
    pub total_amount: f64,
    pub currency: String,
    pub status: String,
    pub basis_amount: Option<f64>,
    pub difference_amount: Option<f64>,
    pub difference_note: Option<String>,
    pub note: Option<String>,
    pub created_by: String,
    pub created_at: i64,
    pub posted_by: Option<String>,
    pub posted_at: Option<i64>,
    pub cancelled_at: Option<i64>,
    pub voided_by: Option<String>,
    pub voided_at: Option<i64>,
    pub void_reason: Option<String>,
    pub task_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct CustomerInvoiceOrderInfo {
    pub id: String,
    pub customer_invoice_id: String,
    pub sales_order_id: String,
    pub so_number_snapshot: String,
    pub created_at: i64,
    pub total_amount: f64,
    pub shipped_amount: f64,
    pub status: String,
    pub ship_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct CustomerInvoiceDetail {
    pub invoice: CustomerInvoice,
    pub orders: Vec<CustomerInvoiceOrderInfo>,
    pub receivable: Option<crate::accounts_receivable::AccountReceivableDetail>,
    pub revenue_status: String,
    pub revenue_recognized_date: Option<String>,
    pub shipment_shortfall: f64,
    pub is_late_issued: bool,
    pub late_issue_warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct CustomerInvoiceItem {
    pub id: String,
    pub invoice_number: String,
    pub customer_partner_id: String,
    pub customer_name_snapshot: String,
    pub issuance_mode: String,
    pub tax_invoice_number: Option<String>,
    pub tax_invoice_exemption_reason: Option<String>,
    pub invoice_date: String,
    pub due_date: String,
    pub untaxed_amount: f64,
    pub tax_amount: f64,
    pub total_amount: f64,
    pub currency: String,
    pub status: String,
    pub basis_amount: Option<f64>,
    pub difference_amount: Option<f64>,
    pub created_at: i64,
    pub posted_at: Option<i64>,
    pub cancelled_at: Option<i64>,
    pub voided_at: Option<i64>,
    pub order_count: i64,
    pub revenue_status: String,
    pub shipment_shortfall: f64,
    pub is_late_issued: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct UninvoicedSalesOrder {
    pub sales_order_id: String,
    pub so_number: String,
    pub customer_partner_id: String,
    pub customer_name_snapshot: String,
    pub status: String,
    pub confirmed_at: i64,
    pub shipped_at: Option<i64>,
    pub ship_date: Option<String>,
    pub total_amount: f64,
    pub shipped_amount: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct SalesOrderInvoicingInfo {
    pub invoice_id: String,
    pub invoice_number: String,
    pub invoice_status: String,
    pub invoice_total_amount: f64,
    pub invoice_order_count: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateCustomerInvoiceInput {
    #[serde(alias = "customerPartnerId")]
    pub customer_partner_id: String,
    #[serde(alias = "issuanceMode")]
    pub issuance_mode: Option<String>,
    #[serde(alias = "invoiceDate")]
    pub invoice_date: String,
    #[serde(alias = "dueDate")]
    pub due_date: Option<String>,
    #[serde(alias = "untaxedAmount")]
    pub untaxed_amount: Option<f64>,
    #[serde(alias = "taxAmount")]
    pub tax_amount: Option<f64>,
    #[serde(alias = "salesOrderIds")]
    pub sales_order_ids: Option<Vec<String>>,
    #[serde(alias = "taxInvoiceNumber")]
    pub tax_invoice_number: Option<String>,
    #[serde(alias = "taxInvoiceExemptionReason")]
    pub tax_invoice_exemption_reason: Option<String>,
    pub note: Option<String>,
    #[serde(alias = "taskId")]
    pub task_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateCustomerInvoiceHeaderInput {
    #[serde(alias = "invoiceId")]
    pub invoice_id: String,
    #[serde(alias = "invoiceDate")]
    pub invoice_date: Option<String>,
    #[serde(alias = "dueDate")]
    pub due_date: Option<String>,
    #[serde(alias = "untaxedAmount")]
    pub untaxed_amount: Option<f64>,
    #[serde(alias = "taxAmount")]
    pub tax_amount: Option<f64>,
    #[serde(alias = "taxInvoiceNumber")]
    pub tax_invoice_number: Option<String>,
    #[serde(alias = "taxInvoiceExemptionReason")]
    pub tax_invoice_exemption_reason: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PostCustomerInvoiceInput {
    #[serde(alias = "invoiceId")]
    pub invoice_id: String,
    #[serde(alias = "taxInvoiceNumber")]
    pub tax_invoice_number: Option<String>,
    #[serde(alias = "taxInvoiceExemptionReason")]
    pub tax_invoice_exemption_reason: Option<String>,
    #[serde(alias = "differenceNote")]
    pub difference_note: Option<String>,
    pub note: Option<String>,
}

// ==========================================
// Database Tables & Initialization
// ==========================================

pub fn create_customer_invoices_tables(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS customer_invoices (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            invoice_number TEXT NOT NULL,
            customer_partner_id TEXT NOT NULL,
            customer_name_snapshot TEXT NOT NULL,
            issuance_mode TEXT NOT NULL,
            tax_invoice_number TEXT,
            tax_invoice_exemption_reason TEXT,
            invoice_date TEXT NOT NULL,
            due_date TEXT NOT NULL,
            untaxed_amount REAL NOT NULL,
            tax_amount REAL NOT NULL,
            currency TEXT NOT NULL DEFAULT 'TWD',
            status TEXT NOT NULL DEFAULT 'draft',
            basis_amount REAL,
            difference_amount REAL,
            difference_note TEXT,
            note TEXT,
            created_by TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            posted_by TEXT,
            posted_at INTEGER,
            cancelled_at INTEGER,
            voided_by TEXT,
            voided_at INTEGER,
            void_reason TEXT,
            task_id TEXT
        )",
        [],
    )?;

    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_cinv_tenant_num 
         ON customer_invoices (tenant_id, invoice_number)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_cinv_tenant_status 
         ON customer_invoices (tenant_id, status)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_cinv_tenant_cust 
         ON customer_invoices (tenant_id, customer_partner_id)",
        [],
    )?;

    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_cinv_tenant_tax_num 
         ON customer_invoices (tenant_id, tax_invoice_number) 
         WHERE tax_invoice_number IS NOT NULL AND status NOT IN ('cancelled', 'voided')",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS customer_invoice_orders (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            customer_invoice_id TEXT NOT NULL,
            sales_order_id TEXT NOT NULL,
            so_number_snapshot TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_cio_invoice 
         ON customer_invoice_orders (customer_invoice_id)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_cio_order 
         ON customer_invoice_orders (sales_order_id)",
        [],
    )?;

    Ok(())
}

// ==========================================
// Helper Functions
// ==========================================

fn next_invoice_number(tx: &Transaction, tenant_id: &str) -> Result<String, rusqlite::Error> {
    let mut stmt = tx.prepare(
        "SELECT COALESCE(MAX(CAST(SUBSTR(invoice_number, 6) AS INTEGER)), 0) + 1 
         FROM customer_invoices WHERE tenant_id = ?1",
    )?;
    let next_seq: i64 = stmt.query_row(params![tenant_id], |row| row.get(0))?;
    Ok(format!("SINV-{:05}", next_seq))
}

struct CustomerPartnerInfo {
    name: String,
    terms_type: Option<String>,
    terms_days: Option<i64>,
    default_mode: Option<String>,
}

fn resolve_customer_info(
    conn: &Connection,
    tenant_id: &str,
    customer_partner_id: &str,
) -> Result<CustomerPartnerInfo, CustomerInvoiceError> {
    let mut stmt = conn
        .prepare(
            "SELECT name, is_customer, collection_terms_type, collection_terms_days, invoice_issuance_mode 
             FROM partners WHERE id = ?1 AND tenant_id = ?2",
        )
        .map_err(|e| CustomerInvoiceError::DatabaseError(e.to_string()))?;

    let res = stmt.query_row(params![customer_partner_id, tenant_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, Option<i64>>(3)?,
            row.get::<_, Option<String>>(4)?,
        ))
    });

    match res {
        Ok((name, is_customer, terms_type, terms_days, default_mode)) => {
            if is_customer != 1 {
                return Err(CustomerInvoiceError::PartnerNotCustomer);
            }
            Ok(CustomerPartnerInfo {
                name,
                terms_type,
                terms_days,
                default_mode,
            })
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Err(CustomerInvoiceError::CustomerNotFound),
        Err(e) => Err(CustomerInvoiceError::DatabaseError(e.to_string())),
    }
}

fn check_duplicate_tax_invoice_number(
    conn: &Connection,
    tenant_id: &str,
    tax_invoice_number: &str,
    exclude_invoice_id: Option<&str>,
) -> Result<(), CustomerInvoiceError> {
    let trimmed = tax_invoice_number.trim();
    if trimmed.is_empty() {
        return Ok(());
    }

    let sql = if let Some(_ex_id) = exclude_invoice_id {
        "SELECT invoice_number FROM customer_invoices 
         WHERE tenant_id = ?1 AND tax_invoice_number = ?2 AND id != ?3 AND status NOT IN ('cancelled', 'voided') 
         LIMIT 1"
    } else {
        "SELECT invoice_number FROM customer_invoices 
         WHERE tenant_id = ?1 AND tax_invoice_number = ?2 AND status NOT IN ('cancelled', 'voided') 
         LIMIT 1"
    };

    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| CustomerInvoiceError::DatabaseError(e.to_string()))?;

    let res: Result<String, _> = if let Some(ex_id) = exclude_invoice_id {
        stmt.query_row(params![tenant_id, trimmed, ex_id], |row| row.get(0))
    } else {
        stmt.query_row(params![tenant_id, trimmed], |row| row.get(0))
    };

    match res {
        Ok(existing_inv_num) => Err(CustomerInvoiceError::DuplicateTaxInvoiceNumber(
            trimmed.to_string(),
            existing_inv_num,
        )),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(()),
        Err(e) => Err(CustomerInvoiceError::DatabaseError(e.to_string())),
    }
}

pub struct SalesOrderSummary {
    pub id: String,
    pub so_number: String,
    pub customer_partner_id: String,
    pub status: String,
    pub ship_date: Option<String>,
    pub total_amount: f64,
    pub shipped_amount: f64,
}

fn fetch_sales_order_summary(
    conn: &Connection,
    tenant_id: &str,
    sales_order_id: &str,
) -> Result<SalesOrderSummary, CustomerInvoiceError> {
    let mut stmt = conn
        .prepare(
            "SELECT 
                so.id, so.so_number, so.customer_partner_id, so.status, so.ship_date,
                COALESCE((SELECT SUM(ROUND(l.quantity * l.unit_price, 2)) FROM sales_order_lines l WHERE l.sales_order_id = so.id), 0.0) AS total_amount,
                COALESCE((SELECT SUM(ROUND(COALESCE(l.shipped_quantity, 0.0) * l.unit_price, 2)) FROM sales_order_lines l WHERE l.sales_order_id = so.id), 0.0) AS shipped_amount
             FROM sales_orders so
             WHERE so.id = ?1 AND so.tenant_id = ?2",
        )
        .map_err(|e| CustomerInvoiceError::DatabaseError(e.to_string()))?;

    stmt.query_row(params![sales_order_id, tenant_id], |row| {
        Ok(SalesOrderSummary {
            id: row.get(0)?,
            so_number: row.get(1)?,
            customer_partner_id: row.get(2)?,
            status: row.get(3)?,
            ship_date: row.get(4)?,
            total_amount: round_2(row.get(5)?),
            shipped_amount: round_2(row.get(6)?),
        })
    })
    .map_err(|_| CustomerInvoiceError::InvalidOrderForInvoice)
}

fn check_order_already_covered(
    conn: &Connection,
    tenant_id: &str,
    sales_order_id: &str,
    exclude_invoice_id: Option<&str>,
) -> Result<(), CustomerInvoiceError> {
    let sql = if let Some(_ex_id) = exclude_invoice_id {
        "SELECT ci.invoice_number, so.so_number 
         FROM customer_invoice_orders cio
         JOIN customer_invoices ci ON ci.id = cio.customer_invoice_id AND ci.tenant_id = cio.tenant_id
         JOIN sales_orders so ON so.id = cio.sales_order_id AND so.tenant_id = cio.tenant_id
         WHERE cio.sales_order_id = ?1 AND cio.tenant_id = ?2 AND ci.id != ?3 AND ci.status IN ('draft', 'posted')
         LIMIT 1"
    } else {
        "SELECT ci.invoice_number, so.so_number 
         FROM customer_invoice_orders cio
         JOIN customer_invoices ci ON ci.id = cio.customer_invoice_id AND ci.tenant_id = cio.tenant_id
         JOIN sales_orders so ON so.id = cio.sales_order_id AND so.tenant_id = cio.tenant_id
         WHERE cio.sales_order_id = ?1 AND cio.tenant_id = ?2 AND ci.status IN ('draft', 'posted')
         LIMIT 1"
    };

    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| CustomerInvoiceError::DatabaseError(e.to_string()))?;

    let res: Result<(String, String), _> = if let Some(ex_id) = exclude_invoice_id {
        stmt.query_row(params![sales_order_id, tenant_id, ex_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
    } else {
        stmt.query_row(params![sales_order_id, tenant_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
    };

    match res {
        Ok((inv_num, so_num)) => Err(CustomerInvoiceError::OrderAlreadyCoveredInInvoice(
            so_num, inv_num,
        )),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(()),
        Err(e) => Err(CustomerInvoiceError::DatabaseError(e.to_string())),
    }
}

struct CustomerInvoiceDerivedValues {
    revenue_status: String,
    revenue_recognized_date: Option<String>,
    shipment_shortfall: f64,
    is_late_issued: bool,
    late_issue_warning: Option<String>,
}

// Compute dynamic derived values for a customer invoice and its orders
fn compute_derived_values(
    conn: &Connection,
    tenant_id: &str,
    invoice: &CustomerInvoice,
    orders: &[CustomerInvoiceOrderInfo],
) -> CustomerInvoiceDerivedValues {
    // 1. revenue_status & revenue_recognized_date
    let (revenue_status, revenue_recognized_date) = if orders.is_empty() {
        ("deferred".to_string(), None)
    } else {
        let has_confirmed = orders.iter().any(|o| o.status == "confirmed");
        let all_shipped = orders.iter().all(|o| o.status == "shipped");
        if has_confirmed || !all_shipped {
            ("deferred".to_string(), None)
        } else {
            let max_ship_date = orders
                .iter()
                .filter_map(|o| o.ship_date.as_deref())
                .max()
                .map(|s| s.to_string());
            ("recognized".to_string(), max_ship_date)
        }
    };

    // 2. shipment_shortfall
    let shipment_shortfall = if invoice.status == "posted"
        && !orders.is_empty()
        && orders.iter().all(|o| o.status == "shipped")
    {
        let shipped_sum: f64 = orders.iter().map(|o| o.shipped_amount).sum();
        let posted_allowances_untaxed: f64 = if table_exists(conn, "sales_allowances") {
            let stmt = conn
                .prepare(
                    "SELECT COALESCE(SUM(untaxed_amount), 0.0) 
                     FROM sales_allowances 
                     WHERE customer_invoice_id = ?1 AND tenant_id = ?2 AND status = 'posted'",
                )
                .ok();
            stmt.and_then(|mut s| {
                s.query_row(params![invoice.id, tenant_id], |r| r.get(0))
                    .ok()
            })
            .unwrap_or(0.0)
        } else {
            0.0
        };

        let basis = invoice.basis_amount.unwrap_or(0.0);
        let shortfall = round_2(basis - shipped_sum - posted_allowances_untaxed);
        if shortfall >= 1.0 {
            shortfall
        } else {
            0.0
        }
    } else {
        0.0
    };

    // 3. is_late_issued & late_issue_warning (CI-09)
    let (is_late_issued, late_issue_warning) = if invoice.issuance_mode == "per_order" {
        let mut warning = None;
        for o in orders {
            if let Some(ref s_date) = o.ship_date {
                if invoice.invoice_date > *s_date {
                    warning = Some(format!(
                        "發票開立日期晚於出貨日 {}，可能不符銷售憑證開立時限",
                        s_date
                    ));
                    break;
                }
            }
        }
        (warning.is_some(), warning)
    } else if invoice.issuance_mode == "monthly_consolidated" {
        let mut warning = None;
        let inv_ym = if invoice.invoice_date.len() >= 7 {
            &invoice.invoice_date[0..7]
        } else {
            ""
        };
        for o in orders {
            if let Some(ref s_date) = o.ship_date {
                let s_ym = if s_date.len() >= 7 { &s_date[0..7] } else { "" };
                if !inv_ym.is_empty() && !s_ym.is_empty() && inv_ym != s_ym {
                    warning = Some(format!(
                        "銷售單 {} 於 {} 出貨，已超過當月彙開期間",
                        o.so_number_snapshot, s_date
                    ));
                    break;
                }
            }
        }
        (warning.is_some(), warning)
    } else {
        (false, None)
    };

    CustomerInvoiceDerivedValues {
        revenue_status,
        revenue_recognized_date,
        shipment_shortfall,
        is_late_issued,
        late_issue_warning,
    }
}

// ==========================================
// Core Business Implementations
// ==========================================

pub fn create_customer_invoice_impl(
    conn: &mut Connection,
    tenant_id: &str,
    user_id: &str,
    input: CreateCustomerInvoiceInput,
) -> Result<CustomerInvoiceDetail, CustomerInvoiceError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(CustomerInvoiceError::EmptyTenantId);
    }
    let uid = user_id.trim();
    if uid.is_empty() {
        return Err(CustomerInvoiceError::EmptyUserId);
    }
    let c_id = input.customer_partner_id.trim();
    if c_id.is_empty() {
        return Err(CustomerInvoiceError::EmptyCustomerPartnerId);
    }

    let inv_date = input.invoice_date.trim();
    crate::terms::parse_date(inv_date)
        .map_err(|e| CustomerInvoiceError::InvalidDateFormat(e.to_string()))?;

    let today = get_today_local(conn)?;
    if inv_date > today.as_str() {
        return Err(CustomerInvoiceError::InvoiceDateCannotBeInFuture);
    }

    let cust_info = resolve_customer_info(conn, tid, c_id)?;

    let issuance_mode = input
        .issuance_mode
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .or(cust_info.default_mode.as_deref())
        .unwrap_or("per_order")
        .to_string();

    let due_date = match input.due_date {
        Some(ref d) if !d.trim().is_empty() => {
            let trimmed_d = d.trim();
            crate::terms::parse_date(trimmed_d)
                .map_err(|e| CustomerInvoiceError::InvalidDateFormat(e.to_string()))?;
            trimmed_d.to_string()
        }
        _ => crate::terms::calculate_due_date(
            inv_date,
            cust_info.terms_type.as_deref(),
            cust_info.terms_days,
        )
        .map_err(CustomerInvoiceError::InvalidDateFormat)?,
    };

    if due_date.as_str() < inv_date {
        return Err(CustomerInvoiceError::DueDateEarlierThanInvoiceDate);
    }

    let tax_amt = round_2(input.tax_amount.unwrap_or(0.0));
    if tax_amt < 0.0 {
        return Err(CustomerInvoiceError::InvalidTaxAmount);
    }

    // Pre-validate initial sales orders if provided to resolve initial untaxed_amount default
    let initial_order_ids = input.sales_order_ids.unwrap_or_default();
    let mut initial_orders = Vec::new();
    let mut initial_basis = 0.0;
    for oid in &initial_order_ids {
        let order = fetch_sales_order_summary(conn, tid, oid)?;
        if order.customer_partner_id != c_id {
            return Err(CustomerInvoiceError::InvalidOrderForInvoice);
        }
        if order.status != "confirmed" && order.status != "shipped" {
            return Err(CustomerInvoiceError::InvalidOrderForInvoice);
        }
        if issuance_mode == "monthly_consolidated" && order.status != "shipped" {
            return Err(CustomerInvoiceError::MonthlyConsolidatedRequiresShipped);
        }
        check_order_already_covered(conn, tid, oid, None)?;

        let basis_contrib = if order.status == "shipped" {
            order.shipped_amount
        } else {
            order.total_amount
        };
        initial_basis += basis_contrib;
        initial_orders.push(order);
    }

    if issuance_mode == "per_order" && initial_orders.len() > 1 {
        return Err(CustomerInvoiceError::PerOrderLimitExceeded);
    }

    let untaxed_amt = match input.untaxed_amount {
        Some(u) => round_2(u),
        None => {
            if !initial_orders.is_empty() && initial_basis > 0.0 {
                round_2(initial_basis)
            } else {
                0.0
            }
        }
    };

    if untaxed_amt <= 0.0 {
        return Err(CustomerInvoiceError::InvalidUntaxedAmount);
    }

    let tax_inv_no = input
        .tax_invoice_number
        .as_deref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    if let Some(ref tin) = tax_inv_no {
        check_duplicate_tax_invoice_number(conn, tid, tin, None)?;
    }

    let exemption_reason = input
        .tax_invoice_exemption_reason
        .as_deref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let now = current_timestamp();
    let invoice_id = format!(
        "cinv_{}_{}",
        now,
        CINV_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    );

    let tx = conn.transaction()?;
    let invoice_number = next_invoice_number(&tx, tid)?;

    tx.execute(
        "INSERT INTO customer_invoices (
            id, tenant_id, invoice_number, customer_partner_id, customer_name_snapshot,
            issuance_mode, tax_invoice_number, tax_invoice_exemption_reason,
            invoice_date, due_date, untaxed_amount, tax_amount, currency,
            status, basis_amount, difference_amount, difference_note,
            note, created_by, created_at, posted_by, posted_at, cancelled_at,
            voided_by, voided_at, void_reason, task_id
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5,
            ?6, ?7, ?8,
            ?9, ?10, ?11, ?12, 'TWD',
            'draft', NULL, NULL, NULL,
            ?13, ?14, ?15, NULL, NULL, NULL,
            NULL, NULL, NULL, ?16
        )",
        params![
            invoice_id,
            tid,
            invoice_number,
            c_id,
            cust_info.name,
            issuance_mode,
            tax_inv_no,
            exemption_reason,
            inv_date,
            due_date,
            untaxed_amt,
            tax_amt,
            input.note.as_ref().map(|s| s.trim()),
            uid,
            now,
            input.task_id.as_ref().map(|s| s.trim())
        ],
    )?;

    for order in initial_orders {
        let cio_id = format!(
            "cio_{}_{}",
            now,
            CINV_ORDER_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
        );
        tx.execute(
            "INSERT INTO customer_invoice_orders (
                id, tenant_id, customer_invoice_id, sales_order_id, so_number_snapshot, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![cio_id, tid, invoice_id, order.id, order.so_number, now],
        )?;
    }

    tx.commit()?;

    get_customer_invoice_impl(conn, tid, &invoice_id)
}

pub fn update_customer_invoice_header_impl(
    conn: &mut Connection,
    tenant_id: &str,
    input: UpdateCustomerInvoiceHeaderInput,
) -> Result<CustomerInvoiceDetail, CustomerInvoiceError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(CustomerInvoiceError::EmptyTenantId);
    }
    let inv_id = input.invoice_id.trim();
    if inv_id.is_empty() {
        return Err(CustomerInvoiceError::EmptyInvoiceId);
    }

    let invoice = fetch_customer_invoice_raw(conn, tid, inv_id)?;
    if invoice.status != "draft" {
        return Err(CustomerInvoiceError::InvalidStateForModification(
            invoice.status,
        ));
    }

    let new_inv_date = match input.invoice_date {
        Some(ref d) => {
            let trimmed = d.trim();
            crate::terms::parse_date(trimmed)
                .map_err(|e| CustomerInvoiceError::InvalidDateFormat(e.to_string()))?;
            let today = get_today_local(conn)?;
            if trimmed > today.as_str() {
                return Err(CustomerInvoiceError::InvoiceDateCannotBeInFuture);
            }
            trimmed.to_string()
        }
        None => invoice.invoice_date.clone(),
    };

    let new_due_date = match input.due_date {
        Some(ref d) => {
            let trimmed = d.trim();
            crate::terms::parse_date(trimmed)
                .map_err(|e| CustomerInvoiceError::InvalidDateFormat(e.to_string()))?;
            trimmed.to_string()
        }
        None => invoice.due_date.clone(),
    };

    if new_due_date.as_str() < new_inv_date.as_str() {
        return Err(CustomerInvoiceError::DueDateEarlierThanInvoiceDate);
    }

    let new_untaxed = match input.untaxed_amount {
        Some(u) => {
            let r = round_2(u);
            if r <= 0.0 {
                return Err(CustomerInvoiceError::InvalidUntaxedAmount);
            }
            r
        }
        None => invoice.untaxed_amount,
    };

    let new_tax = match input.tax_amount {
        Some(t) => {
            let r = round_2(t);
            if r < 0.0 {
                return Err(CustomerInvoiceError::InvalidTaxAmount);
            }
            r
        }
        None => invoice.tax_amount,
    };

    let new_tax_no = if let Some(tin) = input.tax_invoice_number {
        let trimmed = tin.trim().to_string();
        if !trimmed.is_empty() {
            check_duplicate_tax_invoice_number(conn, tid, &trimmed, Some(inv_id))?;
            Some(trimmed)
        } else {
            None
        }
    } else {
        invoice.tax_invoice_number
    };

    let new_exemption = if let Some(ex) = input.tax_invoice_exemption_reason {
        let trimmed = ex.trim().to_string();
        if !trimmed.is_empty() {
            Some(trimmed)
        } else {
            None
        }
    } else {
        invoice.tax_invoice_exemption_reason
    };

    let new_note = input.note.or(invoice.note);

    conn.execute(
        "UPDATE customer_invoices 
         SET invoice_date = ?1, due_date = ?2, untaxed_amount = ?3, tax_amount = ?4,
             tax_invoice_number = ?5, tax_invoice_exemption_reason = ?6, note = ?7
         WHERE id = ?8 AND tenant_id = ?9",
        params![
            new_inv_date,
            new_due_date,
            new_untaxed,
            new_tax,
            new_tax_no,
            new_exemption,
            new_note,
            inv_id,
            tid
        ],
    )?;

    get_customer_invoice_impl(conn, tid, inv_id)
}

pub fn add_customer_invoice_order_impl(
    conn: &mut Connection,
    tenant_id: &str,
    invoice_id: &str,
    sales_order_id: &str,
) -> Result<CustomerInvoiceDetail, CustomerInvoiceError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(CustomerInvoiceError::EmptyTenantId);
    }
    let inv_id = invoice_id.trim();
    if inv_id.is_empty() {
        return Err(CustomerInvoiceError::EmptyInvoiceId);
    }
    let so_id = sales_order_id.trim();
    if so_id.is_empty() {
        return Err(CustomerInvoiceError::EmptySalesOrderId);
    }

    let invoice = fetch_customer_invoice_raw(conn, tid, inv_id)?;
    if invoice.status != "draft" {
        return Err(CustomerInvoiceError::InvalidStateForModification(
            invoice.status,
        ));
    }

    let order = fetch_sales_order_summary(conn, tid, so_id)?;
    if order.customer_partner_id != invoice.customer_partner_id {
        return Err(CustomerInvoiceError::InvalidOrderForInvoice);
    }
    if order.status != "confirmed" && order.status != "shipped" {
        return Err(CustomerInvoiceError::InvalidOrderForInvoice);
    }

    if invoice.issuance_mode == "monthly_consolidated" && order.status != "shipped" {
        return Err(CustomerInvoiceError::MonthlyConsolidatedRequiresShipped);
    }

    // Check if already in this invoice
    let mut check_curr_stmt = conn.prepare(
        "SELECT COUNT(*) FROM customer_invoice_orders 
         WHERE customer_invoice_id = ?1 AND sales_order_id = ?2 AND tenant_id = ?3",
    )?;
    let count_curr: i64 = check_curr_stmt.query_row(params![inv_id, so_id, tid], |r| r.get(0))?;
    if count_curr > 0 {
        return get_customer_invoice_impl(conn, tid, inv_id);
    }

    // Check per_order limit
    if invoice.issuance_mode == "per_order" {
        let mut count_stmt = conn.prepare(
            "SELECT COUNT(*) FROM customer_invoice_orders 
             WHERE customer_invoice_id = ?1 AND tenant_id = ?2",
        )?;
        let existing_count: i64 = count_stmt.query_row(params![inv_id, tid], |r| r.get(0))?;
        if existing_count >= 1 {
            return Err(CustomerInvoiceError::PerOrderLimitExceeded);
        }
    }

    // Check if already covered by another draft or posted invoice
    check_order_already_covered(conn, tid, so_id, Some(inv_id))?;

    let now = current_timestamp();
    let cio_id = format!(
        "cio_{}_{}",
        now,
        CINV_ORDER_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    );

    conn.execute(
        "INSERT INTO customer_invoice_orders (
            id, tenant_id, customer_invoice_id, sales_order_id, so_number_snapshot, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![cio_id, tid, inv_id, so_id, order.so_number, now],
    )?;

    get_customer_invoice_impl(conn, tid, inv_id)
}

pub fn remove_customer_invoice_order_impl(
    conn: &mut Connection,
    tenant_id: &str,
    invoice_id: &str,
    sales_order_id: &str,
) -> Result<CustomerInvoiceDetail, CustomerInvoiceError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(CustomerInvoiceError::EmptyTenantId);
    }
    let inv_id = invoice_id.trim();
    if inv_id.is_empty() {
        return Err(CustomerInvoiceError::EmptyInvoiceId);
    }
    let so_id = sales_order_id.trim();
    if so_id.is_empty() {
        return Err(CustomerInvoiceError::EmptySalesOrderId);
    }

    let invoice = fetch_customer_invoice_raw(conn, tid, inv_id)?;
    if invoice.status != "draft" {
        return Err(CustomerInvoiceError::InvalidStateForModification(
            invoice.status,
        ));
    }

    conn.execute(
        "DELETE FROM customer_invoice_orders 
         WHERE customer_invoice_id = ?1 AND sales_order_id = ?2 AND tenant_id = ?3",
        params![inv_id, so_id, tid],
    )?;

    get_customer_invoice_impl(conn, tid, inv_id)
}

pub fn post_customer_invoice_impl(
    conn: &mut Connection,
    tenant_id: &str,
    user_id: &str,
    input: PostCustomerInvoiceInput,
) -> Result<CustomerInvoiceDetail, CustomerInvoiceError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(CustomerInvoiceError::EmptyTenantId);
    }
    let uid = user_id.trim();
    if uid.is_empty() {
        return Err(CustomerInvoiceError::EmptyUserId);
    }
    let inv_id = input.invoice_id.trim();
    if inv_id.is_empty() {
        return Err(CustomerInvoiceError::EmptyInvoiceId);
    }

    let invoice = fetch_customer_invoice_raw(conn, tid, inv_id)?;
    if invoice.status != "draft" {
        return Err(CustomerInvoiceError::InvalidStateTransition {
            from: invoice.status,
            to: "posted".to_string(),
        });
    }

    // CI-02: invoice_date cannot be in future
    let today = get_today_local(conn)?;
    if invoice.invoice_date > today {
        return Err(CustomerInvoiceError::InvoiceDateCannotBeInFuture);
    }

    // CI-01: Check covered sales orders
    let orders = fetch_invoice_orders_raw(conn, tid, inv_id)?;
    if orders.is_empty() {
        return Err(CustomerInvoiceError::NoOrdersCovered);
    }

    if invoice.issuance_mode == "per_order" && orders.len() > 1 {
        return Err(CustomerInvoiceError::PerOrderLimitExceeded);
    }

    let mut basis_amount = 0.0;
    for o in &orders {
        let so = fetch_sales_order_summary(conn, tid, &o.sales_order_id)?;
        if so.customer_partner_id != invoice.customer_partner_id {
            return Err(CustomerInvoiceError::InvalidOrderForInvoice);
        }
        if so.status != "confirmed" && so.status != "shipped" {
            return Err(CustomerInvoiceError::InvalidOrderForInvoice);
        }
        if invoice.issuance_mode == "monthly_consolidated" && so.status != "shipped" {
            return Err(CustomerInvoiceError::MonthlyConsolidatedRequiresShipped);
        }
        check_order_already_covered(conn, tid, &o.sales_order_id, Some(inv_id))?;

        let contrib = if so.status == "shipped" {
            so.shipped_amount
        } else {
            so.total_amount
        };
        basis_amount += contrib;
    }

    basis_amount = round_2(basis_amount);
    if basis_amount <= 0.0 {
        return Err(CustomerInvoiceError::BasisAmountMustBePositive);
    }

    // CI-05: Difference note check
    let diff = round_2(invoice.untaxed_amount - basis_amount);
    let diff_abs = round_2(diff.abs());
    let diff_note = input
        .difference_note
        .as_deref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or(invoice.difference_note);

    if diff_abs >= 1.0 && diff_note.is_none() {
        let diff_str = if diff_abs.fract() == 0.0 {
            format!("{:.0}", diff_abs)
        } else {
            format!("{:.2}", diff_abs)
        };
        return Err(CustomerInvoiceError::DifferenceNoteRequired(diff_str));
    }

    // CI-06: Tax invoice number vs exemption reason check
    let tax_no = input
        .tax_invoice_number
        .as_deref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or(invoice.tax_invoice_number);

    let exemption = input
        .tax_invoice_exemption_reason
        .as_deref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or(invoice.tax_invoice_exemption_reason);

    match (&tax_no, &exemption) {
        (Some(_), None) => {}
        (None, Some(r)) => {
            if r == "other" {
                let note_val = input
                    .note
                    .as_deref()
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .or(invoice.note.as_deref());
                if note_val.is_none() {
                    return Err(CustomerInvoiceError::OtherExemptionNoteRequired);
                }
            }
        }
        _ => return Err(CustomerInvoiceError::TaxInvoiceOrExemptionRequired),
    }

    if let Some(ref tn) = tax_no {
        check_duplicate_tax_invoice_number(conn, tid, tn, Some(inv_id))?;
    }

    let final_note = input.note.or(invoice.note);
    let now = current_timestamp();

    // Begin atomic transaction for CI-07 (posting invoice + creating AR)
    let tx = conn.transaction()?;

    tx.execute(
        "UPDATE customer_invoices 
         SET status = 'posted', basis_amount = ?1, difference_amount = ?2, difference_note = ?3,
             tax_invoice_number = ?4, tax_invoice_exemption_reason = ?5, note = ?6,
             posted_by = ?7, posted_at = ?8
         WHERE id = ?9 AND tenant_id = ?10",
        params![
            basis_amount,
            diff,
            diff_note,
            tax_no,
            exemption,
            final_note,
            uid,
            now,
            inv_id,
            tid
        ],
    )?;

    // CI-07: Create AR in same transaction
    let total_ar_amount = round_2(invoice.untaxed_amount + invoice.tax_amount);
    let ar_input = CreateAccountReceivableInput {
        customer_partner_id: invoice.customer_partner_id.clone(),
        source_type: "customer_invoice".to_string(),
        source_id: invoice.id.clone(),
        source_number: invoice.invoice_number.clone(),
        external_reference: tax_no.clone(),
        document_date: invoice.invoice_date.clone(),
        due_date: invoice.due_date.clone(),
        amount: total_ar_amount,
        currency: Some("TWD".to_string()),
    };

    create_account_receivable_in_tx(&tx, tid, uid, ar_input)
        .map_err(|e| CustomerInvoiceError::AccountsReceivableError(e.to_string()))?;

    tx.commit()?;

    get_customer_invoice_impl(conn, tid, inv_id)
}

pub fn cancel_customer_invoice_impl(
    conn: &mut Connection,
    tenant_id: &str,
    invoice_id: &str,
) -> Result<CustomerInvoiceDetail, CustomerInvoiceError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(CustomerInvoiceError::EmptyTenantId);
    }
    let inv_id = invoice_id.trim();
    if inv_id.is_empty() {
        return Err(CustomerInvoiceError::EmptyInvoiceId);
    }

    let invoice = fetch_customer_invoice_raw(conn, tid, inv_id)?;
    if invoice.status != "draft" {
        return Err(CustomerInvoiceError::InvalidStateTransition {
            from: invoice.status,
            to: "cancelled".to_string(),
        });
    }

    let now = current_timestamp();
    conn.execute(
        "UPDATE customer_invoices SET status = 'cancelled', cancelled_at = ?1 WHERE id = ?2 AND tenant_id = ?3",
        params![now, inv_id, tid],
    )?;

    get_customer_invoice_impl(conn, tid, inv_id)
}

pub fn void_customer_invoice_impl(
    conn: &mut Connection,
    tenant_id: &str,
    user_id: &str,
    invoice_id: &str,
    void_reason: &str,
) -> Result<CustomerInvoiceDetail, CustomerInvoiceError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(CustomerInvoiceError::EmptyTenantId);
    }
    let uid = user_id.trim();
    if uid.is_empty() {
        return Err(CustomerInvoiceError::EmptyUserId);
    }
    let inv_id = invoice_id.trim();
    if inv_id.is_empty() {
        return Err(CustomerInvoiceError::EmptyInvoiceId);
    }
    let reason_trimmed = void_reason.trim();
    if reason_trimmed.is_empty() {
        return Err(CustomerInvoiceError::VoidReasonRequired);
    }

    let invoice = fetch_customer_invoice_raw(conn, tid, inv_id)?;
    if invoice.status != "posted" {
        return Err(CustomerInvoiceError::InvalidStateTransition {
            from: invoice.status,
            to: "voided".to_string(),
        });
    }

    // Find linked open AR
    let ar_opt: Option<(String, String)> = conn
        .query_row(
            "SELECT id, status FROM accounts_receivable 
             WHERE tenant_id = ?1 AND source_type = 'customer_invoice' AND source_id = ?2",
            params![tid, inv_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;

    // CI-08: Check posted receipt allocations and posted allowances
    if let Some((ref ar_id, _)) = ar_opt {
        if table_exists(conn, "customer_receipt_allocations")
            && table_exists(conn, "customer_receipts")
        {
            let receipt_res: Result<String, _> = conn.query_row(
                "SELECT r.receipt_number 
                 FROM customer_receipt_allocations ra
                 JOIN customer_receipts r ON r.id = ra.receipt_id AND r.tenant_id = ra.tenant_id
                 WHERE ra.account_receivable_id = ?1 AND ra.tenant_id = ?2 AND r.status = 'posted'
                 ORDER BY ra.created_at ASC LIMIT 1",
                params![ar_id, tid],
                |row| row.get(0),
            );
            if let Ok(rec_num) = receipt_res {
                return Err(CustomerInvoiceError::HasPostedReceiptAllocations(rec_num));
            }
        }

        if table_exists(conn, "sales_allowances") {
            let allowance_res: Result<String, _> = conn.query_row(
                "SELECT allowance_number 
                 FROM sales_allowances 
                 WHERE (customer_invoice_id = ?1 OR account_receivable_id = ?2) AND tenant_id = ?3 AND status = 'posted'
                 ORDER BY created_at ASC LIMIT 1",
                params![inv_id, ar_id, tid],
                |row| row.get(0),
            );
            if let Ok(allow_num) = allowance_res {
                return Err(CustomerInvoiceError::HasPostedSalesAllowances(allow_num));
            }
        }
    }

    let now = current_timestamp();
    let tx = conn.transaction()?;

    // Void AR in transaction if it is open
    if let Some((ref ar_id, ref ar_status)) = ar_opt {
        if ar_status == "open" {
            void_account_receivable_in_tx(&tx, tid, uid, ar_id, reason_trimmed)
                .map_err(|e| CustomerInvoiceError::AccountsReceivableError(e.to_string()))?;
        }
    }

    tx.execute(
        "UPDATE customer_invoices 
         SET status = 'voided', voided_by = ?1, voided_at = ?2, void_reason = ?3
         WHERE id = ?4 AND tenant_id = ?5",
        params![uid, now, reason_trimmed, inv_id, tid],
    )?;

    tx.commit()?;

    get_customer_invoice_impl(conn, tid, inv_id)
}

fn fetch_customer_invoice_raw(
    conn: &Connection,
    tenant_id: &str,
    invoice_id: &str,
) -> Result<CustomerInvoice, CustomerInvoiceError> {
    let mut stmt = conn
        .prepare(
            "SELECT 
                id, tenant_id, invoice_number, customer_partner_id, customer_name_snapshot,
                issuance_mode, tax_invoice_number, tax_invoice_exemption_reason,
                invoice_date, due_date, untaxed_amount, tax_amount, currency,
                status, basis_amount, difference_amount, difference_note,
                note, created_by, created_at, posted_by, posted_at, cancelled_at,
                voided_by, voided_at, void_reason, task_id
             FROM customer_invoices 
             WHERE id = ?1 AND tenant_id = ?2",
        )
        .map_err(|e| CustomerInvoiceError::DatabaseError(e.to_string()))?;

    stmt.query_row(params![invoice_id, tenant_id], |row| {
        let untaxed: f64 = row.get(10)?;
        let tax: f64 = row.get(11)?;
        Ok(CustomerInvoice {
            id: row.get(0)?,
            tenant_id: row.get(1)?,
            invoice_number: row.get(2)?,
            customer_partner_id: row.get(3)?,
            customer_name_snapshot: row.get(4)?,
            issuance_mode: row.get(5)?,
            tax_invoice_number: row.get(6)?,
            tax_invoice_exemption_reason: row.get(7)?,
            invoice_date: row.get(8)?,
            due_date: row.get(9)?,
            untaxed_amount: untaxed,
            tax_amount: tax,
            total_amount: round_2(untaxed + tax),
            currency: row.get(12)?,
            status: row.get(13)?,
            basis_amount: row.get(14)?,
            difference_amount: row.get(15)?,
            difference_note: row.get(16)?,
            note: row.get(17)?,
            created_by: row.get(18)?,
            created_at: row.get(19)?,
            posted_by: row.get(20)?,
            posted_at: row.get(21)?,
            cancelled_at: row.get(22)?,
            voided_by: row.get(23)?,
            voided_at: row.get(24)?,
            void_reason: row.get(25)?,
            task_id: row.get(26)?,
        })
    })
    .map_err(|_| CustomerInvoiceError::InvoiceNotFound)
}

fn fetch_invoice_orders_raw(
    conn: &Connection,
    tenant_id: &str,
    invoice_id: &str,
) -> Result<Vec<CustomerInvoiceOrderInfo>, CustomerInvoiceError> {
    let mut stmt = conn
        .prepare(
            "SELECT 
                cio.id, cio.customer_invoice_id, cio.sales_order_id, cio.so_number_snapshot, cio.created_at,
                so.status, so.ship_date,
                COALESCE((SELECT SUM(ROUND(l.quantity * l.unit_price, 2)) FROM sales_order_lines l WHERE l.sales_order_id = so.id), 0.0) AS total_amount,
                COALESCE((SELECT SUM(ROUND(COALESCE(l.shipped_quantity, 0.0) * l.unit_price, 2)) FROM sales_order_lines l WHERE l.sales_order_id = so.id), 0.0) AS shipped_amount
             FROM customer_invoice_orders cio
             JOIN sales_orders so ON so.id = cio.sales_order_id AND so.tenant_id = cio.tenant_id
             WHERE cio.customer_invoice_id = ?1 AND cio.tenant_id = ?2
             ORDER BY cio.created_at ASC",
        )
        .map_err(|e| CustomerInvoiceError::DatabaseError(e.to_string()))?;

    let rows = stmt
        .query_map(params![invoice_id, tenant_id], |row| {
            Ok(CustomerInvoiceOrderInfo {
                id: row.get(0)?,
                customer_invoice_id: row.get(1)?,
                sales_order_id: row.get(2)?,
                so_number_snapshot: row.get(3)?,
                created_at: row.get(4)?,
                status: row.get(5)?,
                ship_date: row.get(6)?,
                total_amount: round_2(row.get(7)?),
                shipped_amount: round_2(row.get(8)?),
            })
        })
        .map_err(|e| CustomerInvoiceError::DatabaseError(e.to_string()))?;

    let mut res = Vec::new();
    for r in rows {
        res.push(r.map_err(|e| CustomerInvoiceError::DatabaseError(e.to_string()))?);
    }
    Ok(res)
}

pub fn get_customer_invoice_impl(
    conn: &Connection,
    tenant_id: &str,
    invoice_id: &str,
) -> Result<CustomerInvoiceDetail, CustomerInvoiceError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(CustomerInvoiceError::EmptyTenantId);
    }
    let inv_id = invoice_id.trim();
    if inv_id.is_empty() {
        return Err(CustomerInvoiceError::EmptyInvoiceId);
    }

    let invoice = fetch_customer_invoice_raw(conn, tid, inv_id)?;
    let orders = fetch_invoice_orders_raw(conn, tid, inv_id)?;

    let derived = compute_derived_values(conn, tid, &invoice, &orders);

    let receivable = if invoice.status == "posted" || invoice.status == "voided" {
        let ar_id_opt: Option<String> = conn
            .query_row(
                "SELECT id FROM accounts_receivable 
                 WHERE tenant_id = ?1 AND source_type = 'customer_invoice' AND source_id = ?2",
                params![tid, inv_id],
                |r| r.get(0),
            )
            .optional()?;

        if let Some(ar_id) = ar_id_opt {
            crate::accounts_receivable::get_account_receivable_impl(conn, tid, &ar_id).ok()
        } else {
            None
        }
    } else {
        None
    };

    Ok(CustomerInvoiceDetail {
        invoice,
        orders,
        receivable,
        revenue_status: derived.revenue_status,
        revenue_recognized_date: derived.revenue_recognized_date,
        shipment_shortfall: derived.shipment_shortfall,
        is_late_issued: derived.is_late_issued,
        late_issue_warning: derived.late_issue_warning,
    })
}

pub fn list_customer_invoices_impl(
    conn: &Connection,
    tenant_id: &str,
    status_filter: Option<&str>,
    customer_partner_id: Option<&str>,
    search_query: Option<&str>,
) -> Result<Vec<CustomerInvoiceItem>, CustomerInvoiceError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(CustomerInvoiceError::EmptyTenantId);
    }

    let mut sql = String::from(
        "SELECT 
            ci.id, ci.invoice_number, ci.customer_partner_id, ci.customer_name_snapshot,
            ci.issuance_mode, ci.tax_invoice_number, ci.tax_invoice_exemption_reason,
            ci.invoice_date, ci.due_date, ci.untaxed_amount, ci.tax_amount, ci.currency,
            ci.status, ci.basis_amount, ci.difference_amount, ci.created_at, ci.posted_at,
            ci.cancelled_at, ci.voided_at,
            (SELECT COUNT(*) FROM customer_invoice_orders cio WHERE cio.customer_invoice_id = ci.id) AS order_count
         FROM customer_invoices ci
         WHERE ci.tenant_id = ?1",
    );

    let mut param_values: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(tid.to_string())];
    let mut param_idx = 2;

    if let Some(status) = status_filter {
        let trimmed = status.trim();
        if !trimmed.is_empty() {
            sql.push_str(&format!(" AND ci.status = ?{}", param_idx));
            param_values.push(Box::new(trimmed.to_string()));
            param_idx += 1;
        }
    }

    if let Some(cid) = customer_partner_id {
        let trimmed = cid.trim();
        if !trimmed.is_empty() {
            sql.push_str(&format!(" AND ci.customer_partner_id = ?{}", param_idx));
            param_values.push(Box::new(trimmed.to_string()));
            param_idx += 1;
        }
    }

    if let Some(query) = search_query {
        let trimmed = query.trim();
        if !trimmed.is_empty() {
            sql.push_str(&format!(
                " AND (ci.invoice_number LIKE ?{} OR ci.tax_invoice_number LIKE ?{} OR ci.customer_name_snapshot LIKE ?{})",
                param_idx, param_idx, param_idx
            ));
            let pattern = format!("%{}%", trimmed);
            param_values.push(Box::new(pattern));
            // param_idx += 1;
        }
    }

    sql.push_str(" ORDER BY ci.created_at DESC");

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| CustomerInvoiceError::DatabaseError(e.to_string()))?;

    let params_slice: Vec<&dyn rusqlite::ToSql> = param_values.iter().map(|b| b.as_ref()).collect();

    let rows = stmt
        .query_map(params_slice.as_slice(), |row| {
            let untaxed: f64 = row.get(9)?;
            let tax: f64 = row.get(10)?;
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
                untaxed,
                tax,
                round_2(untaxed + tax),
                row.get::<_, String>(11)?,
                row.get::<_, String>(12)?,
                row.get::<_, Option<f64>>(13)?,
                row.get::<_, Option<f64>>(14)?,
                row.get::<_, i64>(15)?,
                row.get::<_, Option<i64>>(16)?,
                row.get::<_, Option<i64>>(17)?,
                row.get::<_, Option<i64>>(18)?,
                row.get::<_, i64>(19)?,
            ))
        })
        .map_err(|e| CustomerInvoiceError::DatabaseError(e.to_string()))?;

    let mut items = Vec::new();
    for r in rows {
        let (
            id,
            invoice_number,
            customer_partner_id,
            customer_name_snapshot,
            issuance_mode,
            tax_invoice_number,
            tax_invoice_exemption_reason,
            invoice_date,
            due_date,
            untaxed_amount,
            tax_amount,
            total_amount,
            currency,
            status,
            basis_amount,
            difference_amount,
            created_at,
            posted_at,
            cancelled_at,
            voided_at,
            order_count,
        ) = r.map_err(|e| CustomerInvoiceError::DatabaseError(e.to_string()))?;

        // Compute lightweight derived properties
        let orders = fetch_invoice_orders_raw(conn, tid, &id)?;
        let raw_inv = CustomerInvoice {
            id: id.clone(),
            tenant_id: tid.to_string(),
            invoice_number: invoice_number.clone(),
            customer_partner_id: customer_partner_id.clone(),
            customer_name_snapshot: customer_name_snapshot.clone(),
            issuance_mode: issuance_mode.clone(),
            tax_invoice_number: tax_invoice_number.clone(),
            tax_invoice_exemption_reason: tax_invoice_exemption_reason.clone(),
            invoice_date: invoice_date.clone(),
            due_date: due_date.clone(),
            untaxed_amount,
            tax_amount,
            total_amount,
            currency: currency.clone(),
            status: status.clone(),
            basis_amount,
            difference_amount,
            difference_note: None,
            note: None,
            created_by: "".to_string(),
            created_at,
            posted_by: None,
            posted_at,
            cancelled_at,
            voided_by: None,
            voided_at,
            void_reason: None,
            task_id: None,
        };

        let derived = compute_derived_values(conn, tid, &raw_inv, &orders);

        items.push(CustomerInvoiceItem {
            id,
            invoice_number,
            customer_partner_id,
            customer_name_snapshot,
            issuance_mode,
            tax_invoice_number,
            tax_invoice_exemption_reason,
            invoice_date,
            due_date,
            untaxed_amount,
            tax_amount,
            total_amount,
            currency,
            status,
            basis_amount,
            difference_amount,
            created_at,
            posted_at,
            cancelled_at,
            voided_at,
            order_count,
            revenue_status: derived.revenue_status,
            shipment_shortfall: derived.shipment_shortfall,
            is_late_issued: derived.is_late_issued,
        });
    }

    Ok(items)
}

pub fn list_uninvoiced_sales_orders_impl(
    conn: &Connection,
    tenant_id: &str,
    customer_partner_id: Option<&str>,
) -> Result<Vec<UninvoicedSalesOrder>, CustomerInvoiceError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(CustomerInvoiceError::EmptyTenantId);
    }

    let mut sql = String::from(
        "SELECT 
            so.id, so.so_number, so.customer_partner_id, so.customer_name_snapshot,
            so.status, so.confirmed_at, so.shipped_at, so.ship_date,
            COALESCE((SELECT SUM(ROUND(l.quantity * l.unit_price, 2)) FROM sales_order_lines l WHERE l.sales_order_id = so.id), 0.0) AS total_amount,
            COALESCE((SELECT SUM(ROUND(COALESCE(l.shipped_quantity, 0.0) * l.unit_price, 2)) FROM sales_order_lines l WHERE l.sales_order_id = so.id), 0.0) AS shipped_amount
         FROM sales_orders so
         WHERE so.tenant_id = ?1 
           AND so.status IN ('confirmed', 'shipped')
           AND NOT EXISTS (
               SELECT 1 FROM customer_invoice_orders cio
               JOIN customer_invoices ci ON ci.id = cio.customer_invoice_id AND ci.tenant_id = cio.tenant_id
               WHERE cio.sales_order_id = so.id AND cio.tenant_id = so.tenant_id AND ci.status IN ('draft', 'posted')
           )",
    );

    let mut param_values: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(tid.to_string())];

    if let Some(cid) = customer_partner_id {
        let trimmed = cid.trim();
        if !trimmed.is_empty() {
            sql.push_str(" AND so.customer_partner_id = ?2");
            param_values.push(Box::new(trimmed.to_string()));
        }
    }

    sql.push_str(" ORDER BY so.confirmed_at DESC");

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| CustomerInvoiceError::DatabaseError(e.to_string()))?;

    let params_slice: Vec<&dyn rusqlite::ToSql> = param_values.iter().map(|b| b.as_ref()).collect();

    let rows = stmt
        .query_map(params_slice.as_slice(), |row| {
            Ok(UninvoicedSalesOrder {
                sales_order_id: row.get(0)?,
                so_number: row.get(1)?,
                customer_partner_id: row.get(2)?,
                customer_name_snapshot: row.get(3)?,
                status: row.get(4)?,
                confirmed_at: row.get(5)?,
                shipped_at: row.get(6)?,
                ship_date: row.get(7)?,
                total_amount: round_2(row.get(8)?),
                shipped_amount: round_2(row.get(9)?),
            })
        })
        .map_err(|e| CustomerInvoiceError::DatabaseError(e.to_string()))?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r.map_err(|e| CustomerInvoiceError::DatabaseError(e.to_string()))?);
    }
    Ok(list)
}

pub fn get_sales_order_invoicing_info_impl(
    conn: &Connection,
    tenant_id: &str,
    sales_order_id: &str,
) -> Result<Option<SalesOrderInvoicingInfo>, CustomerInvoiceError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(CustomerInvoiceError::EmptyTenantId);
    }
    let so_id = sales_order_id.trim();
    if so_id.is_empty() {
        return Err(CustomerInvoiceError::EmptySalesOrderId);
    }

    let mut stmt = conn
        .prepare(
            "SELECT 
                ci.id, ci.invoice_number, ci.status, (ci.untaxed_amount + ci.tax_amount) AS total_amount,
                (SELECT COUNT(*) FROM customer_invoice_orders cio2 WHERE cio2.customer_invoice_id = ci.id) AS order_count
             FROM customer_invoice_orders cio
             JOIN customer_invoices ci ON ci.id = cio.customer_invoice_id AND ci.tenant_id = cio.tenant_id
             WHERE cio.sales_order_id = ?1 AND cio.tenant_id = ?2 AND ci.status IN ('draft', 'posted')
             ORDER BY ci.created_at DESC
             LIMIT 1",
        )
        .map_err(|e| CustomerInvoiceError::DatabaseError(e.to_string()))?;

    let res = stmt
        .query_row(params![so_id, tid], |row| {
            Ok(SalesOrderInvoicingInfo {
                invoice_id: row.get(0)?,
                invoice_number: row.get(1)?,
                invoice_status: row.get(2)?,
                invoice_total_amount: round_2(row.get(3)?),
                invoice_order_count: row.get(4)?,
            })
        })
        .optional()
        .map_err(|e| CustomerInvoiceError::DatabaseError(e.to_string()))?;

    Ok(res)
}

// ==========================================
// Tauri Commands
// ==========================================

#[tauri::command]
#[specta::specta]
pub fn create_customer_invoice(
    app_handle: tauri::AppHandle,
    input: CreateCustomerInvoiceInput,
) -> Result<CustomerInvoiceDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| format!("DB Open Error: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;

    create_customer_invoice_impl(&mut conn, &active_tid, &active_uid, input)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn update_customer_invoice_header(
    app_handle: tauri::AppHandle,
    input: UpdateCustomerInvoiceHeaderInput,
) -> Result<CustomerInvoiceDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| format!("DB Open Error: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;

    update_customer_invoice_header_impl(&mut conn, &active_tid, input).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn add_customer_invoice_order(
    app_handle: tauri::AppHandle,
    invoice_id: String,
    sales_order_id: String,
) -> Result<CustomerInvoiceDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| format!("DB Open Error: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;

    add_customer_invoice_order_impl(&mut conn, &active_tid, &invoice_id, &sales_order_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn remove_customer_invoice_order(
    app_handle: tauri::AppHandle,
    invoice_id: String,
    sales_order_id: String,
) -> Result<CustomerInvoiceDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| format!("DB Open Error: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;

    remove_customer_invoice_order_impl(&mut conn, &active_tid, &invoice_id, &sales_order_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn post_customer_invoice(
    app_handle: tauri::AppHandle,
    input: PostCustomerInvoiceInput,
) -> Result<CustomerInvoiceDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| format!("DB Open Error: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;

    post_customer_invoice_impl(&mut conn, &active_tid, &active_uid, input)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn cancel_customer_invoice(
    app_handle: tauri::AppHandle,
    invoice_id: String,
) -> Result<CustomerInvoiceDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| format!("DB Open Error: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;

    cancel_customer_invoice_impl(&mut conn, &active_tid, &invoice_id).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn void_customer_invoice(
    app_handle: tauri::AppHandle,
    invoice_id: String,
    void_reason: String,
) -> Result<CustomerInvoiceDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| format!("DB Open Error: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;

    void_customer_invoice_impl(
        &mut conn,
        &active_tid,
        &active_uid,
        &invoice_id,
        &void_reason,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn get_customer_invoice(
    app_handle: tauri::AppHandle,
    invoice_id: String,
) -> Result<CustomerInvoiceDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let conn = Connection::open(&db_path).map_err(|e| format!("DB Open Error: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;

    get_customer_invoice_impl(&conn, &active_tid, &invoice_id).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn list_customer_invoices(
    app_handle: tauri::AppHandle,
    status_filter: Option<String>,
    customer_partner_id: Option<String>,
    search_query: Option<String>,
) -> Result<Vec<CustomerInvoiceItem>, String> {
    let db_path = crate::get_db_path(&app_handle);
    let conn = Connection::open(&db_path).map_err(|e| format!("DB Open Error: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;

    list_customer_invoices_impl(
        &conn,
        &active_tid,
        status_filter.as_deref(),
        customer_partner_id.as_deref(),
        search_query.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn list_uninvoiced_sales_orders(
    app_handle: tauri::AppHandle,
    customer_partner_id: Option<String>,
) -> Result<Vec<UninvoicedSalesOrder>, String> {
    let db_path = crate::get_db_path(&app_handle);
    let conn = Connection::open(&db_path).map_err(|e| format!("DB Open Error: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;

    list_uninvoiced_sales_orders_impl(&conn, &active_tid, customer_partner_id.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn get_sales_order_invoicing_info(
    app_handle: tauri::AppHandle,
    sales_order_id: String,
) -> Result<Option<SalesOrderInvoicingInfo>, String> {
    let db_path = crate::get_db_path(&app_handle);
    let conn = Connection::open(&db_path).map_err(|e| format!("DB Open Error: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;

    get_sales_order_invoicing_info_impl(&conn, &active_tid, &sales_order_id)
        .map_err(|e| e.to_string())
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
        create_customer_invoices_tables(&conn).unwrap();

        // Minimal mock sales_orders table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS sales_orders (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                so_number TEXT NOT NULL,
                customer_partner_id TEXT NOT NULL,
                customer_name_snapshot TEXT NOT NULL,
                customer_reference TEXT,
                source_quote_id TEXT,
                warehouse_id TEXT,
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
        )
        .unwrap();

        conn.execute(
            "CREATE TABLE IF NOT EXISTS sales_order_lines (
                id TEXT PRIMARY KEY,
                sales_order_id TEXT NOT NULL,
                product_id TEXT NOT NULL,
                unit_id TEXT NOT NULL,
                quantity REAL NOT NULL,
                shipped_quantity REAL,
                unit_price REAL NOT NULL
            )",
            [],
        )
        .unwrap();

        // Seed customer partner cus_001
        conn.execute(
            "INSERT INTO partners (
                id, tenant_id, name, is_customer, is_vendor, tax_id,
                payment_terms_type, payment_terms_days, collection_terms_type, collection_terms_days,
                requested_collection_terms_note, invoice_issuance_mode, created_at
            ) VALUES (
                'cus_001', 'tnt_test', '測試客戶 A', 1, 0, '12345678',
                NULL, NULL, 'net', 30, NULL, 'per_order', 1000
            )",
            [],
        )
        .unwrap();

        // Seed monthly customer cus_monthly
        conn.execute(
            "INSERT INTO partners (
                id, tenant_id, name, is_customer, is_vendor, tax_id,
                payment_terms_type, payment_terms_days, collection_terms_type, collection_terms_days,
                requested_collection_terms_note, invoice_issuance_mode, created_at
            ) VALUES (
                'cus_monthly', 'tnt_test', '月結客戶 B', 1, 0, '87654321',
                NULL, NULL, 'month_end', 0, NULL, 'monthly_consolidated', 1000
            )",
            [],
        )
        .unwrap();

        // Seed vendor only
        conn.execute(
            "INSERT INTO partners (
                id, tenant_id, name, is_customer, is_vendor, tax_id,
                payment_terms_type, payment_terms_days, collection_terms_type, collection_terms_days,
                requested_collection_terms_note, invoice_issuance_mode, created_at
            ) VALUES (
                'vnd_001', 'tnt_test', '純廠商 C', 0, 1, '99999999',
                'net', 30, NULL, NULL, NULL, NULL, 1000
            )",
            [],
        )
        .unwrap();

        conn
    }

    fn insert_test_so(
        conn: &Connection,
        tenant_id: &str,
        so_id: &str,
        so_number: &str,
        customer_id: &str,
        status: &str,
        ship_date: Option<&str>,
        unit_price: f64,
        qty: f64,
        shipped_qty: Option<f64>,
    ) {
        conn.execute(
            "INSERT INTO sales_orders (
                id, tenant_id, so_number, customer_partner_id, customer_name_snapshot,
                status, ship_date, created_by, created_at, confirmed_at
            ) VALUES (?1, ?2, ?3, ?4, '測試客戶', ?5, ?6, 'usr_admin', 1000, 1000)",
            params![so_id, tenant_id, so_number, customer_id, status, ship_date],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO sales_order_lines (
                id, sales_order_id, product_id, unit_id, quantity, shipped_quantity, unit_price
            ) VALUES (?1, ?2, 'prod_1', 'unit_1', ?3, ?4, ?5)",
            params![
                format!("line_{}", so_id),
                so_id,
                qty,
                shipped_qty,
                unit_price
            ],
        )
        .unwrap();
    }

    #[test]
    fn test_tc_ci_01_n1_and_n2_normal_per_order_and_monthly() {
        // Given: Seeded DB with confirmed SO for cus_001 and shipped SOs for cus_monthly
        let mut conn = setup_test_db();
        insert_test_so(
            &conn,
            "tnt_test",
            "so_1",
            "SO-001",
            "cus_001",
            "confirmed",
            None,
            100.0,
            10.0,
            None,
        );
        insert_test_so(
            &conn,
            "tnt_test",
            "so_m1",
            "SO-M1",
            "cus_monthly",
            "shipped",
            Some("2026-11-10"),
            50.0,
            10.0,
            Some(10.0),
        );
        insert_test_so(
            &conn,
            "tnt_test",
            "so_m2",
            "SO-M2",
            "cus_monthly",
            "shipped",
            Some("2026-11-15"),
            80.0,
            5.0,
            Some(5.0),
        );

        // When: Creating per_order invoice with so_1
        let inv1 = create_customer_invoice_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateCustomerInvoiceInput {
                customer_partner_id: "cus_001".to_string(),
                issuance_mode: None,
                invoice_date: "2026-11-10".to_string(),
                due_date: None,
                untaxed_amount: None,
                tax_amount: Some(50.0),
                sales_order_ids: Some(vec!["so_1".to_string()]),
                tax_invoice_number: None,
                tax_invoice_exemption_reason: None,
                note: None,
                task_id: None,
            },
        )
        .unwrap();

        // Then: Due date is auto calculated (2026-11-10 + 30 days = 2026-12-10), untaxed_amount = 1000.0, revenue_status = deferred
        assert_eq!(inv1.invoice.invoice_number, "SINV-00001");
        assert_eq!(inv1.invoice.issuance_mode, "per_order");
        assert_eq!(inv1.invoice.due_date, "2026-12-10");
        assert_eq!(inv1.invoice.untaxed_amount, 1000.0);
        assert_eq!(inv1.revenue_status, "deferred");
        assert_eq!(inv1.revenue_recognized_date, None);

        // When: Creating monthly_consolidated invoice with so_m1 and so_m2
        let inv2 = create_customer_invoice_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateCustomerInvoiceInput {
                customer_partner_id: "cus_monthly".to_string(),
                issuance_mode: Some("monthly_consolidated".to_string()),
                invoice_date: "2026-11-16".to_string(),
                due_date: None,
                untaxed_amount: None,
                tax_amount: Some(45.0),
                sales_order_ids: Some(vec!["so_m1".to_string(), "so_m2".to_string()]),
                tax_invoice_number: None,
                tax_invoice_exemption_reason: None,
                note: None,
                task_id: None,
            },
        )
        .unwrap();

        // Then: untaxed_amount = 500 + 400 = 900.0, revenue_status = recognized, recognized_date = 2026-11-15
        assert_eq!(inv2.invoice.invoice_number, "SINV-00002");
        assert_eq!(inv2.invoice.untaxed_amount, 900.0);
        assert_eq!(inv2.revenue_status, "recognized");
        assert_eq!(inv2.revenue_recognized_date, Some("2026-11-15".to_string()));
    }

    #[test]
    fn test_tc_ci_01_e1_to_e4_and_n3_order_guards() {
        // Given: Seeded DB
        let mut conn = setup_test_db();
        insert_test_so(
            &conn,
            "tnt_test",
            "so_1",
            "SO-001",
            "cus_001",
            "confirmed",
            None,
            100.0,
            10.0,
            None,
        );
        insert_test_so(
            &conn,
            "tnt_test",
            "so_2",
            "SO-002",
            "cus_001",
            "confirmed",
            None,
            100.0,
            10.0,
            None,
        );
        insert_test_so(
            &conn,
            "tnt_test",
            "so_other_cust",
            "SO-OTH",
            "cus_monthly",
            "shipped",
            Some("2026-11-10"),
            100.0,
            10.0,
            Some(10.0),
        );

        // When / Then: TC-CI-01-E1: per_order exceeds 1 order
        let err_e1 = create_customer_invoice_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateCustomerInvoiceInput {
                customer_partner_id: "cus_001".to_string(),
                issuance_mode: Some("per_order".to_string()),
                invoice_date: "2026-11-10".to_string(),
                due_date: None,
                untaxed_amount: Some(2000.0),
                tax_amount: None,
                sales_order_ids: Some(vec!["so_1".to_string(), "so_2".to_string()]),
                tax_invoice_number: None,
                tax_invoice_exemption_reason: None,
                note: None,
                task_id: None,
            },
        )
        .unwrap_err();
        assert_eq!(err_e1, CustomerInvoiceError::PerOrderLimitExceeded);

        // When / Then: TC-CI-01-E2: monthly_consolidated with confirmed order
        let err_e2 = create_customer_invoice_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateCustomerInvoiceInput {
                customer_partner_id: "cus_001".to_string(),
                issuance_mode: Some("monthly_consolidated".to_string()),
                invoice_date: "2026-11-10".to_string(),
                due_date: None,
                untaxed_amount: Some(1000.0),
                tax_amount: None,
                sales_order_ids: Some(vec!["so_1".to_string()]),
                tax_invoice_number: None,
                tax_invoice_exemption_reason: None,
                note: None,
                task_id: None,
            },
        )
        .unwrap_err();
        assert_eq!(
            err_e2,
            CustomerInvoiceError::MonthlyConsolidatedRequiresShipped
        );

        // When / Then: TC-CI-01-E3: wrong customer order
        let err_e3 = create_customer_invoice_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateCustomerInvoiceInput {
                customer_partner_id: "cus_001".to_string(),
                issuance_mode: Some("per_order".to_string()),
                invoice_date: "2026-11-10".to_string(),
                due_date: None,
                untaxed_amount: Some(1000.0),
                tax_amount: None,
                sales_order_ids: Some(vec!["so_other_cust".to_string()]),
                tax_invoice_number: None,
                tax_invoice_exemption_reason: None,
                note: None,
                task_id: None,
            },
        )
        .unwrap_err();
        assert_eq!(err_e3, CustomerInvoiceError::InvalidOrderForInvoice);

        // When: Successfully create invoice 1 covering so_1
        let inv1 = create_customer_invoice_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateCustomerInvoiceInput {
                customer_partner_id: "cus_001".to_string(),
                issuance_mode: Some("per_order".to_string()),
                invoice_date: "2026-11-10".to_string(),
                due_date: None,
                untaxed_amount: Some(1000.0),
                tax_amount: None,
                sales_order_ids: Some(vec!["so_1".to_string()]),
                tax_invoice_number: None,
                tax_invoice_exemption_reason: None,
                note: None,
                task_id: None,
            },
        )
        .unwrap();

        // When / Then: TC-CI-01-E4: so_1 duplicate attach to another invoice
        let err_e4 = create_customer_invoice_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateCustomerInvoiceInput {
                customer_partner_id: "cus_001".to_string(),
                issuance_mode: Some("per_order".to_string()),
                invoice_date: "2026-11-10".to_string(),
                due_date: None,
                untaxed_amount: Some(1000.0),
                tax_amount: None,
                sales_order_ids: Some(vec!["so_1".to_string()]),
                tax_invoice_number: None,
                tax_invoice_exemption_reason: None,
                note: None,
                task_id: None,
            },
        )
        .unwrap_err();
        assert_eq!(
            err_e4,
            CustomerInvoiceError::OrderAlreadyCoveredInInvoice(
                "SO-001".to_string(),
                "SINV-00001".to_string()
            )
        );

        // When: TC-CI-01-N3: Cancel inv1, then so_1 can be re-covered
        cancel_customer_invoice_impl(&mut conn, "tnt_test", &inv1.invoice.id).unwrap();
        let inv_re = create_customer_invoice_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateCustomerInvoiceInput {
                customer_partner_id: "cus_001".to_string(),
                issuance_mode: Some("per_order".to_string()),
                invoice_date: "2026-11-10".to_string(),
                due_date: None,
                untaxed_amount: Some(1000.0),
                tax_amount: None,
                sales_order_ids: Some(vec!["so_1".to_string()]),
                tax_invoice_number: None,
                tax_invoice_exemption_reason: None,
                note: None,
                task_id: None,
            },
        );
        assert!(inv_re.is_ok());
    }

    #[test]
    fn test_tc_ci_02_and_03_and_04_boundaries() {
        // Given: Seeded DB
        let mut conn = setup_test_db();
        insert_test_so(
            &conn,
            "tnt_test",
            "so_1",
            "SO-001",
            "cus_001",
            "confirmed",
            None,
            100.0,
            10.0,
            None,
        );

        // When / Then: TC-CI-02-B2: invoice_date in future
        let err_future = create_customer_invoice_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateCustomerInvoiceInput {
                customer_partner_id: "cus_001".to_string(),
                issuance_mode: None,
                invoice_date: "2099-01-01".to_string(),
                due_date: None,
                untaxed_amount: Some(100.0),
                tax_amount: None,
                sales_order_ids: None,
                tax_invoice_number: None,
                tax_invoice_exemption_reason: None,
                note: None,
                task_id: None,
            },
        )
        .unwrap_err();
        assert_eq!(
            err_future,
            CustomerInvoiceError::InvoiceDateCannotBeInFuture
        );

        // When / Then: TC-CI-03-B2: due_date earlier than invoice_date
        let err_early_due = create_customer_invoice_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateCustomerInvoiceInput {
                customer_partner_id: "cus_001".to_string(),
                issuance_mode: None,
                invoice_date: "2026-11-10".to_string(),
                due_date: Some("2026-11-09".to_string()),
                untaxed_amount: Some(100.0),
                tax_amount: None,
                sales_order_ids: None,
                tax_invoice_number: None,
                tax_invoice_exemption_reason: None,
                note: None,
                task_id: None,
            },
        )
        .unwrap_err();
        assert_eq!(
            err_early_due,
            CustomerInvoiceError::DueDateEarlierThanInvoiceDate
        );

        // When / Then: TC-CI-04-B1 & B2: untaxed_amount <= 0
        let err_zero = create_customer_invoice_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateCustomerInvoiceInput {
                customer_partner_id: "cus_001".to_string(),
                issuance_mode: None,
                invoice_date: "2026-11-10".to_string(),
                due_date: None,
                untaxed_amount: Some(0.0),
                tax_amount: None,
                sales_order_ids: None,
                tax_invoice_number: None,
                tax_invoice_exemption_reason: None,
                note: None,
                task_id: None,
            },
        )
        .unwrap_err();
        assert_eq!(err_zero, CustomerInvoiceError::InvalidUntaxedAmount);

        let err_neg = create_customer_invoice_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateCustomerInvoiceInput {
                customer_partner_id: "cus_001".to_string(),
                issuance_mode: None,
                invoice_date: "2026-11-10".to_string(),
                due_date: None,
                untaxed_amount: Some(-1.0),
                tax_amount: None,
                sales_order_ids: None,
                tax_invoice_number: None,
                tax_invoice_exemption_reason: None,
                note: None,
                task_id: None,
            },
        )
        .unwrap_err();
        assert_eq!(err_neg, CustomerInvoiceError::InvalidUntaxedAmount);

        // When / Then: TC-CI-04-B5: tax_amount < 0
        let err_neg_tax = create_customer_invoice_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateCustomerInvoiceInput {
                customer_partner_id: "cus_001".to_string(),
                issuance_mode: None,
                invoice_date: "2026-11-10".to_string(),
                due_date: None,
                untaxed_amount: Some(100.0),
                tax_amount: Some(-0.01),
                sales_order_ids: None,
                tax_invoice_number: None,
                tax_invoice_exemption_reason: None,
                note: None,
                task_id: None,
            },
        )
        .unwrap_err();
        assert_eq!(err_neg_tax, CustomerInvoiceError::InvalidTaxAmount);

        // When / Then: TC-CI-04-B3 & B4: untaxed = 0.01, tax = 0.0 succeeds
        let valid_inv = create_customer_invoice_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateCustomerInvoiceInput {
                customer_partner_id: "cus_001".to_string(),
                issuance_mode: None,
                invoice_date: "2026-11-10".to_string(),
                due_date: Some("2026-11-10".to_string()),
                untaxed_amount: Some(0.01),
                tax_amount: Some(0.0),
                sales_order_ids: None,
                tax_invoice_number: None,
                tax_invoice_exemption_reason: None,
                note: None,
                task_id: None,
            },
        );
        assert!(valid_inv.is_ok());
    }

    #[test]
    fn test_tc_ci_05_and_06_and_07_post_validation_and_ar_creation() {
        // Given: Seeded DB with SO of 1000.0 total
        let mut conn = setup_test_db();
        insert_test_so(
            &conn,
            "tnt_test",
            "so_1",
            "SO-001",
            "cus_001",
            "confirmed",
            None,
            100.0,
            10.0,
            None,
        );

        // Case TC-CI-05-B2: untaxed = 1001.0, basis = 1000.0 (diff = 1.0 >= 1.0) without difference_note
        let inv_diff = create_customer_invoice_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateCustomerInvoiceInput {
                customer_partner_id: "cus_001".to_string(),
                issuance_mode: Some("per_order".to_string()),
                invoice_date: "2026-11-10".to_string(),
                due_date: None,
                untaxed_amount: Some(1001.0),
                tax_amount: Some(50.0),
                sales_order_ids: Some(vec!["so_1".to_string()]),
                tax_invoice_number: Some("AB-12345678".to_string()),
                tax_invoice_exemption_reason: None,
                note: None,
                task_id: None,
            },
        )
        .unwrap();

        let err_diff = post_customer_invoice_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            PostCustomerInvoiceInput {
                invoice_id: inv_diff.invoice.id.clone(),
                tax_invoice_number: None,
                tax_invoice_exemption_reason: None,
                difference_note: None,
                note: None,
            },
        )
        .unwrap_err();
        assert_eq!(
            err_diff,
            CustomerInvoiceError::DifferenceNoteRequired("1".to_string())
        );

        // Case TC-CI-06-B1: neither tax invoice number nor exemption reason
        update_customer_invoice_header_impl(
            &mut conn,
            "tnt_test",
            UpdateCustomerInvoiceHeaderInput {
                invoice_id: inv_diff.invoice.id.clone(),
                invoice_date: None,
                due_date: None,
                untaxed_amount: Some(1000.0), // match basis
                tax_amount: None,
                tax_invoice_number: Some("".to_string()), // clear
                tax_invoice_exemption_reason: None,
                note: None,
            },
        )
        .unwrap();

        let err_no_tax_no_exemption = post_customer_invoice_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            PostCustomerInvoiceInput {
                invoice_id: inv_diff.invoice.id.clone(),
                tax_invoice_number: None,
                tax_invoice_exemption_reason: None,
                difference_note: None,
                note: None,
            },
        )
        .unwrap_err();
        assert_eq!(
            err_no_tax_no_exemption,
            CustomerInvoiceError::TaxInvoiceOrExemptionRequired
        );

        // Case TC-CI-06-B2: both tax invoice number and exemption reason provided
        let err_both = post_customer_invoice_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            PostCustomerInvoiceInput {
                invoice_id: inv_diff.invoice.id.clone(),
                tax_invoice_number: Some("AB-12345678".to_string()),
                tax_invoice_exemption_reason: Some("export_exempt".to_string()),
                difference_note: None,
                note: None,
            },
        )
        .unwrap_err();
        assert_eq!(
            err_both,
            CustomerInvoiceError::TaxInvoiceOrExemptionRequired
        );

        // Case TC-CI-06-B3: exemption reason "other" without note
        let err_other_no_note = post_customer_invoice_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            PostCustomerInvoiceInput {
                invoice_id: inv_diff.invoice.id.clone(),
                tax_invoice_number: None,
                tax_invoice_exemption_reason: Some("other".to_string()),
                difference_note: None,
                note: None,
            },
        )
        .unwrap_err();
        assert_eq!(
            err_other_no_note,
            CustomerInvoiceError::OtherExemptionNoteRequired
        );

        // When: TC-CI-07-N1: Valid post with tax_invoice_number
        let posted_detail = post_customer_invoice_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            PostCustomerInvoiceInput {
                invoice_id: inv_diff.invoice.id.clone(),
                tax_invoice_number: Some("AB-12345678".to_string()),
                tax_invoice_exemption_reason: None,
                difference_note: None,
                note: Some("備註說明".to_string()),
            },
        )
        .unwrap();

        // Then: Invoice is posted, AR is created in same tx
        assert_eq!(posted_detail.invoice.status, "posted");
        assert_eq!(posted_detail.invoice.basis_amount, Some(1000.0));
        assert!(posted_detail.receivable.is_some());
        let ar = posted_detail.receivable.unwrap();
        assert_eq!(ar.amount, 1050.0); // 1000 + 50
        assert_eq!(ar.source_type, "customer_invoice");
        assert_eq!(ar.source_id, inv_diff.invoice.id);
        assert_eq!(ar.external_reference, Some("AB-12345678".to_string()));

        // When / Then: TC-CI-06-E1: Duplicate tax invoice number in same tenant
        insert_test_so(
            &conn,
            "tnt_test",
            "so_2",
            "SO-002",
            "cus_001",
            "confirmed",
            None,
            100.0,
            10.0,
            None,
        );
        let inv_dup = create_customer_invoice_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateCustomerInvoiceInput {
                customer_partner_id: "cus_001".to_string(),
                issuance_mode: Some("per_order".to_string()),
                invoice_date: "2026-11-10".to_string(),
                due_date: None,
                untaxed_amount: Some(1000.0),
                tax_amount: Some(50.0),
                sales_order_ids: Some(vec!["so_2".to_string()]),
                tax_invoice_number: None,
                tax_invoice_exemption_reason: None,
                note: None,
                task_id: None,
            },
        )
        .unwrap();

        let err_dup = post_customer_invoice_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            PostCustomerInvoiceInput {
                invoice_id: inv_dup.invoice.id.clone(),
                tax_invoice_number: Some("AB-12345678".to_string()),
                tax_invoice_exemption_reason: None,
                difference_note: None,
                note: None,
            },
        )
        .unwrap_err();
        assert_eq!(
            err_dup,
            CustomerInvoiceError::DuplicateTaxInvoiceNumber(
                "AB-12345678".to_string(),
                "SINV-00001".to_string()
            )
        );
    }

    #[test]
    fn test_tc_ci_08_void_validation_and_guards() {
        // Given: Seeded posted invoice
        let mut conn = setup_test_db();
        insert_test_so(
            &conn,
            "tnt_test",
            "so_1",
            "SO-001",
            "cus_001",
            "confirmed",
            None,
            100.0,
            10.0,
            None,
        );

        let inv = create_customer_invoice_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateCustomerInvoiceInput {
                customer_partner_id: "cus_001".to_string(),
                issuance_mode: Some("per_order".to_string()),
                invoice_date: "2026-11-10".to_string(),
                due_date: None,
                untaxed_amount: Some(1000.0),
                tax_amount: Some(50.0),
                sales_order_ids: Some(vec!["so_1".to_string()]),
                tax_invoice_number: Some("AB-99998888".to_string()),
                tax_invoice_exemption_reason: None,
                note: None,
                task_id: None,
            },
        )
        .unwrap();

        post_customer_invoice_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            PostCustomerInvoiceInput {
                invoice_id: inv.invoice.id.clone(),
                tax_invoice_number: None,
                tax_invoice_exemption_reason: None,
                difference_note: None,
                note: None,
            },
        )
        .unwrap();

        // When / Then: TC-CI-08-B1: void_reason empty
        let err_no_reason =
            void_customer_invoice_impl(&mut conn, "tnt_test", "usr_admin", &inv.invoice.id, "   ")
                .unwrap_err();
        assert_eq!(err_no_reason, CustomerInvoiceError::VoidReasonRequired);

        // When: TC-CI-08-N1: Normal void succeeds
        let voided_detail = void_customer_invoice_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            &inv.invoice.id,
            "開錯發票作廢",
        )
        .unwrap();

        assert_eq!(voided_detail.invoice.status, "voided");
        assert_eq!(
            voided_detail.invoice.void_reason,
            Some("開錯發票作廢".to_string())
        );

        // Then: AR is also voided
        let ar_status: String = conn
            .query_row(
                "SELECT status FROM accounts_receivable WHERE source_id = ?1",
                params![inv.invoice.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(ar_status, "voided");

        // When / Then: TC-CI-06-N1: Tax invoice number can be reused after original is voided
        insert_test_so(
            &conn,
            "tnt_test",
            "so_2",
            "SO-002",
            "cus_001",
            "confirmed",
            None,
            100.0,
            10.0,
            None,
        );
        let inv2 = create_customer_invoice_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateCustomerInvoiceInput {
                customer_partner_id: "cus_001".to_string(),
                issuance_mode: Some("per_order".to_string()),
                invoice_date: "2026-11-10".to_string(),
                due_date: None,
                untaxed_amount: Some(1000.0),
                tax_amount: Some(50.0),
                sales_order_ids: Some(vec!["so_2".to_string()]),
                tax_invoice_number: Some("AB-99998888".to_string()), // reuse
                tax_invoice_exemption_reason: None,
                note: None,
                task_id: None,
            },
        );
        assert!(inv2.is_ok());
    }

    #[test]
    fn test_tc_ci_09_and_10_derived_warnings_and_shortfall() {
        // Given: Seeded DB
        let mut conn = setup_test_db();
        insert_test_so(
            &conn,
            "tnt_test",
            "so_late",
            "SO-LATE",
            "cus_001",
            "shipped",
            Some("2026-11-05"), // ship date is earlier than invoice date 2026-11-10
            100.0,
            10.0,
            Some(8.0), // shipped qty 8 (shortfall of 200.0)
        );

        // When: Creating per_order invoice with invoice_date 2026-11-10 (later than ship_date 2026-11-05)
        let inv = create_customer_invoice_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateCustomerInvoiceInput {
                customer_partner_id: "cus_001".to_string(),
                issuance_mode: Some("per_order".to_string()),
                invoice_date: "2026-11-10".to_string(),
                due_date: None,
                untaxed_amount: Some(1000.0), // basis snapshot will be 800.0 because it's shipped
                tax_amount: Some(50.0),
                sales_order_ids: Some(vec!["so_late".to_string()]),
                tax_invoice_number: Some("AB-11112222".to_string()),
                tax_invoice_exemption_reason: None,
                note: None,
                task_id: None,
            },
        )
        .unwrap();

        // Then: TC-CI-09-W1: is_late_issued = true with warning
        assert!(inv.is_late_issued);
        assert_eq!(
            inv.late_issue_warning,
            Some("發票開立日期晚於出貨日 2026-11-05，可能不符銷售憑證開立時限".to_string())
        );

        // When: Monthly consolidated cross-month warning (TC-CI-09-W2)
        insert_test_so(
            &conn,
            "tnt_test",
            "so_m_cross",
            "SO-CROSS",
            "cus_monthly",
            "shipped",
            Some("2026-10-31"), // October
            100.0,
            10.0,
            Some(10.0),
        );
        let inv_m = create_customer_invoice_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateCustomerInvoiceInput {
                customer_partner_id: "cus_monthly".to_string(),
                issuance_mode: Some("monthly_consolidated".to_string()),
                invoice_date: "2026-11-05".to_string(), // November
                due_date: None,
                untaxed_amount: Some(1000.0),
                tax_amount: Some(50.0),
                sales_order_ids: Some(vec!["so_m_cross".to_string()]),
                tax_invoice_number: Some("AB-33334444".to_string()),
                tax_invoice_exemption_reason: None,
                note: None,
                task_id: None,
            },
        )
        .unwrap();

        assert!(inv_m.is_late_issued);
        assert_eq!(
            inv_m.late_issue_warning,
            Some("銷售單 SO-CROSS 於 2026-10-31 出貨，已超過當月彙開期間".to_string())
        );
    }
}
