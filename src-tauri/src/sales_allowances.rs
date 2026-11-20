use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static ALLOWANCE_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

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

fn generate_allowance_id(now: i64) -> String {
    format!(
        "salw_{}_{}",
        now,
        ALLOWANCE_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
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
pub enum SalesAllowanceError {
    #[error("租戶 ID 不可為空")]
    EmptyTenantId,

    #[error("找不到指定的租戶")]
    TenantNotFound,

    #[error("租戶未啟用或已停用")]
    TenantNotActive,

    #[error("找不到指定的折讓單")]
    AllowanceNotFound,

    #[error("找不到對應的銷項發票")]
    InvoiceNotFound,

    #[error("找不到對應的應收帳款")]
    AccountReceivableNotFound,

    #[error("原應收非 open 狀態")]
    AccountReceivableNotOpen,

    #[error("僅能對已過帳、已出貨且有出貨短少的發票開立折讓單")]
    InvalidInvoiceStateForAllowance,

    #[error("發票 {0} 已有草稿折讓單 {1}")]
    ExistingDraftAllowance(String, String),

    #[error("折讓原因類型僅支援出貨短少 (shipment_shortfall)")]
    InvalidReasonType,

    #[error("折讓未稅金額需大於 0")]
    InvalidUntaxedAmount,

    #[error("折讓未稅金額不可超過出貨短少剩餘 {0}")]
    UntaxedExceedsShortfall(String),

    #[error("折讓稅額需大於或等於 0")]
    InvalidTaxAmount,

    #[error("折讓稅額累計不可超過原發票稅額 {0}")]
    TaxExceedsInvoiceTax(String),

    #[error("折讓日期不可晚於今天")]
    AllowanceDateAfterToday,

    #[error("折讓日期不可早於發票日或出貨日")]
    AllowanceDateBeforeInvoiceOrShip,

    #[error("折讓金額 {0} 超過應收未收餘額 {1}；客戶已付款需退款的情境不在本輪範圍")]
    AmountExceedsOutstanding(String, String),

    #[error("無效的狀態轉換：不可從 {0} 轉換至 {1}")]
    InvalidStateTransition(String, String),

    #[error("作廢原因必填")]
    VoidReasonRequired,

    #[error("僅草稿狀態可修改")]
    NotDraftForUpdate,

    #[error("僅草稿狀態可取消")]
    NotDraftForCancel,

    #[error("僅已過帳狀態可作廢")]
    NotPostedForVoid,

    #[error("幣別僅支援 TWD")]
    InvalidCurrency,

    #[error("資料庫錯誤: {0}")]
    DatabaseError(String),
}

impl Serialize for SalesAllowanceError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

// ==========================================
// Structs
// ==========================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SalesAllowance {
    pub id: String,
    pub tenant_id: String,
    pub allowance_number: String,
    pub customer_invoice_id: String,
    pub invoice_number_snapshot: String,
    pub tax_invoice_number_snapshot: Option<String>,
    pub account_receivable_id: String,
    pub customer_partner_id: String,
    pub customer_name_snapshot: String,
    pub reason_type: String,
    pub allowance_date: String,
    pub shortfall_snapshot: Option<f64>,
    pub untaxed_amount: f64,
    pub tax_amount: f64,
    pub total_amount: f64,
    pub external_reference: Option<String>,
    pub currency: String,
    pub status: String,
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

#[derive(Debug, Clone, Deserialize)]
pub struct CreateSalesAllowanceInput {
    pub customer_invoice_id: String,
    pub allowance_date: Option<String>,
    pub untaxed_amount: Option<f64>,
    pub tax_amount: Option<f64>,
    pub external_reference: Option<String>,
    pub note: Option<String>,
    pub reason_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateSalesAllowanceInput {
    pub id: String,
    pub allowance_date: Option<String>,
    pub untaxed_amount: Option<f64>,
    pub tax_amount: Option<f64>,
    pub external_reference: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct SalesAllowanceFilter {
    pub status: Option<String>,
    pub customer_partner_id: Option<String>,
    pub customer_invoice_id: Option<String>,
    pub query: Option<String>,
}

// ==========================================
// Tables Initialization
// ==========================================

pub fn create_sales_allowances_tables(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS sales_allowances (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            allowance_number TEXT NOT NULL,
            customer_invoice_id TEXT NOT NULL,
            invoice_number_snapshot TEXT NOT NULL,
            tax_invoice_number_snapshot TEXT,
            account_receivable_id TEXT NOT NULL,
            customer_partner_id TEXT NOT NULL,
            customer_name_snapshot TEXT NOT NULL,
            reason_type TEXT NOT NULL CHECK(reason_type = 'shipment_shortfall'),
            allowance_date TEXT NOT NULL,
            shortfall_snapshot REAL,
            untaxed_amount REAL NOT NULL,
            tax_amount REAL NOT NULL,
            external_reference TEXT,
            currency TEXT NOT NULL DEFAULT 'TWD',
            status TEXT NOT NULL CHECK(status IN ('draft', 'posted', 'cancelled', 'voided')),
            note TEXT,
            created_by TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            posted_by TEXT,
            posted_at INTEGER,
            cancelled_at INTEGER,
            voided_by TEXT,
            voided_at INTEGER,
            void_reason TEXT,
            task_id TEXT,
            FOREIGN KEY (customer_invoice_id) REFERENCES customer_invoices(id),
            FOREIGN KEY (account_receivable_id) REFERENCES accounts_receivable(id)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_allowances_number_tenant ON sales_allowances(tenant_id, allowance_number);
        CREATE INDEX IF NOT EXISTS idx_sales_allowances_invoice ON sales_allowances(customer_invoice_id, tenant_id);
        CREATE INDEX IF NOT EXISTS idx_sales_allowances_ar ON sales_allowances(account_receivable_id, tenant_id);",
    )?;
    Ok(())
}

fn verify_active_tenant(conn: &Connection, tenant_id: &str) -> Result<(), SalesAllowanceError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(SalesAllowanceError::EmptyTenantId);
    }
    let status_res: Result<String, _> = conn.query_row(
        "SELECT status FROM tenants WHERE id = ?1",
        params![tid],
        |r| r.get(0),
    );
    match status_res {
        Ok(s) if s == "active" => Ok(()),
        Ok(_) => Err(SalesAllowanceError::TenantNotActive),
        Err(rusqlite::Error::QueryReturnedNoRows) => Err(SalesAllowanceError::TenantNotFound),
        Err(e) => Err(SalesAllowanceError::DatabaseError(e.to_string())),
    }
}

fn generate_next_allowance_number(
    conn: &Connection,
    tenant_id: &str,
) -> Result<String, SalesAllowanceError> {
    let max_num: Result<Option<String>, _> = conn.query_row(
        "SELECT allowance_number FROM sales_allowances WHERE tenant_id = ?1 ORDER BY allowance_number DESC LIMIT 1",
        params![tenant_id],
        |r| r.get(0),
    );
    let next_seq = match max_num {
        Ok(Some(num)) => {
            if let Some(digits) = num.strip_prefix("SALW-") {
                digits.parse::<i64>().unwrap_or(0) + 1
            } else {
                1
            }
        }
        _ => 1,
    };
    Ok(format!("SALW-{:05}", next_seq))
}

// Helper struct for invoice check
struct InvoiceContext {
    id: String,
    invoice_number: String,
    tax_invoice_number: Option<String>,
    customer_partner_id: String,
    customer_name_snapshot: String,
    invoice_date: String,
    untaxed_amount: f64,
    tax_amount: f64,
    #[allow(dead_code)]
    status: String,
    #[allow(dead_code)]
    basis_amount: f64,
    account_receivable_id: String,
    max_ship_date: Option<String>,
    remaining_shortfall: f64,
    posted_allowances_tax: f64,
}

fn fetch_invoice_context(
    conn: &Connection,
    tenant_id: &str,
    invoice_id: &str,
    exclude_allowance_id: Option<&str>,
) -> Result<InvoiceContext, SalesAllowanceError> {
    // 1. Query invoice
    let inv_row = conn.query_row(
        "SELECT id, invoice_number, tax_invoice_number, customer_partner_id, customer_name_snapshot,
                invoice_date, untaxed_amount, tax_amount, status, COALESCE(basis_amount, 0.0)
         FROM customer_invoices
         WHERE id = ?1 AND tenant_id = ?2",
        params![invoice_id, tenant_id],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, f64>(6)?,
                r.get::<_, f64>(7)?,
                r.get::<_, String>(8)?,
                r.get::<_, f64>(9)?,
            ))
        },
    );

    let (
        id,
        invoice_number,
        tax_invoice_number,
        customer_partner_id,
        customer_name_snapshot,
        invoice_date,
        untaxed_amount,
        tax_amount,
        status,
        basis_amount,
    ) = match inv_row {
        Ok(v) => v,
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            return Err(SalesAllowanceError::InvoiceNotFound)
        }
        Err(e) => return Err(SalesAllowanceError::DatabaseError(e.to_string())),
    };

    // 2. Query covered sales orders
    let mut order_stmt = conn
        .prepare(
            "SELECT so.status, so.ship_date,
                    COALESCE((SELECT SUM(ROUND(COALESCE(l.shipped_quantity, 0.0) * l.unit_price, 2))
                              FROM sales_order_lines l WHERE l.sales_order_id = so.id), 0.0) AS shipped_amount
             FROM customer_invoice_orders cio
             JOIN sales_orders so ON so.id = cio.sales_order_id AND so.tenant_id = cio.tenant_id
             WHERE cio.customer_invoice_id = ?1 AND cio.tenant_id = ?2",
        )
        .map_err(|e| SalesAllowanceError::DatabaseError(e.to_string()))?;

    let order_rows = order_stmt
        .query_map(params![invoice_id, tenant_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, f64>(2)?,
            ))
        })
        .map_err(|e| SalesAllowanceError::DatabaseError(e.to_string()))?;

    let mut orders = Vec::new();
    for o in order_rows {
        orders.push(o.map_err(|e| SalesAllowanceError::DatabaseError(e.to_string()))?);
    }

    if orders.is_empty() || orders.iter().any(|(s, _, _)| s != "shipped") || status != "posted" {
        return Err(SalesAllowanceError::InvalidInvoiceStateForAllowance);
    }

    let max_ship_date = orders
        .iter()
        .filter_map(|(_, d, _)| d.as_deref())
        .max()
        .map(|s| s.to_string());

    let shipped_sum: f64 = orders.iter().map(|(_, _, amt)| amt).sum();

    // 3. Query posted allowances (excluding current allowance if specified)
    let (posted_allowances_untaxed, posted_allowances_tax) = if table_exists(
        conn,
        "sales_allowances",
    ) {
        let (sql_untaxed, sql_tax) = match exclude_allowance_id {
            Some(ex_id) => (
                format!(
                    "SELECT COALESCE(SUM(untaxed_amount), 0.0) FROM sales_allowances WHERE customer_invoice_id = ?1 AND tenant_id = ?2 AND status = 'posted' AND id != '{}'",
                    ex_id
                ),
                format!(
                    "SELECT COALESCE(SUM(tax_amount), 0.0) FROM sales_allowances WHERE customer_invoice_id = ?1 AND tenant_id = ?2 AND status = 'posted' AND id != '{}'",
                    ex_id
                ),
            ),
            None => (
                "SELECT COALESCE(SUM(untaxed_amount), 0.0) FROM sales_allowances WHERE customer_invoice_id = ?1 AND tenant_id = ?2 AND status = 'posted'".to_string(),
                "SELECT COALESCE(SUM(tax_amount), 0.0) FROM sales_allowances WHERE customer_invoice_id = ?1 AND tenant_id = ?2 AND status = 'posted'".to_string(),
            ),
        };

        let u_amt: f64 = conn
            .query_row(&sql_untaxed, params![invoice_id, tenant_id], |r| r.get(0))
            .unwrap_or(0.0);
        let t_amt: f64 = conn
            .query_row(&sql_tax, params![invoice_id, tenant_id], |r| r.get(0))
            .unwrap_or(0.0);
        (u_amt, t_amt)
    } else {
        (0.0, 0.0)
    };

    let remaining_shortfall = round_2(basis_amount - shipped_sum - posted_allowances_untaxed);

    // 4. Query AR id
    let ar_id: Result<String, _> = conn.query_row(
        "SELECT id FROM accounts_receivable
         WHERE source_type = 'customer_invoice' AND source_id = ?1 AND tenant_id = ?2 AND status != 'voided'
         ORDER BY created_at DESC LIMIT 1",
        params![invoice_id, tenant_id],
        |r| r.get(0),
    );

    let account_receivable_id = match ar_id {
        Ok(id) => id,
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            return Err(SalesAllowanceError::AccountReceivableNotFound)
        }
        Err(e) => return Err(SalesAllowanceError::DatabaseError(e.to_string())),
    };

    Ok(InvoiceContext {
        id,
        invoice_number,
        tax_invoice_number,
        customer_partner_id,
        customer_name_snapshot,
        invoice_date,
        untaxed_amount,
        tax_amount,
        status,
        basis_amount,
        account_receivable_id,
        max_ship_date,
        remaining_shortfall,
        posted_allowances_tax,
    })
}

// ==========================================
// Implementation Functions
// ==========================================

pub fn create_sales_allowance_impl(
    conn: &Connection,
    tenant_id: &str,
    created_by: &str,
    input: CreateSalesAllowanceInput,
) -> Result<SalesAllowance, SalesAllowanceError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(SalesAllowanceError::EmptyTenantId);
    }
    verify_active_tenant(conn, tid)?;

    let inv_id = input.customer_invoice_id.trim();
    if inv_id.is_empty() {
        return Err(SalesAllowanceError::InvoiceNotFound);
    }

    // SA-01 reason_type lock
    if let Some(ref r_type) = input.reason_type {
        if r_type.trim() != "shipment_shortfall" {
            return Err(SalesAllowanceError::InvalidReasonType);
        }
    }

    let ctx = fetch_invoice_context(conn, tid, inv_id, None)?;

    // SA-01: remaining shortfall >= 1.0 (CI-10)
    if ctx.remaining_shortfall < 1.0 {
        return Err(SalesAllowanceError::InvalidInvoiceStateForAllowance);
    }

    // SA-01: Only one draft allowance per invoice
    let existing_draft: Result<String, _> = conn.query_row(
        "SELECT allowance_number FROM sales_allowances
         WHERE customer_invoice_id = ?1 AND tenant_id = ?2 AND status = 'draft'
         LIMIT 1",
        params![inv_id, tid],
        |r| r.get(0),
    );
    if let Ok(draft_num) = existing_draft {
        return Err(SalesAllowanceError::ExistingDraftAllowance(
            ctx.invoice_number,
            draft_num,
        ));
    }

    let today = get_today_local(conn).unwrap_or_else(|_| "1970-01-01".to_string());
    let allowance_date = input.allowance_date.unwrap_or_else(|| today.clone());

    // SA-04 validations
    if allowance_date.as_str() > today.as_str() {
        return Err(SalesAllowanceError::AllowanceDateAfterToday);
    }
    if allowance_date.as_str() < ctx.invoice_date.as_str() {
        return Err(SalesAllowanceError::AllowanceDateBeforeInvoiceOrShip);
    }
    if let Some(ref max_s_date) = ctx.max_ship_date {
        if allowance_date.as_str() < max_s_date.as_str() {
            return Err(SalesAllowanceError::AllowanceDateBeforeInvoiceOrShip);
        }
    }

    // Default untaxed = remaining_shortfall
    let untaxed_amount = round_2(input.untaxed_amount.unwrap_or(ctx.remaining_shortfall));
    if untaxed_amount <= 0.0 {
        return Err(SalesAllowanceError::InvalidUntaxedAmount);
    }
    // SA-02
    if untaxed_amount > ctx.remaining_shortfall + 1e-6 {
        return Err(SalesAllowanceError::UntaxedExceedsShortfall(format_amount(
            ctx.remaining_shortfall,
        )));
    }

    // Default tax = round_2(untaxed_amount * invoice.tax / invoice.untaxed)
    let default_tax = if ctx.untaxed_amount > 0.0 {
        round_2(untaxed_amount * ctx.tax_amount / ctx.untaxed_amount)
    } else {
        0.0
    };
    let tax_amount = round_2(input.tax_amount.unwrap_or(default_tax));
    if tax_amount < 0.0 {
        return Err(SalesAllowanceError::InvalidTaxAmount);
    }
    // SA-03: tax cumulative <= invoice tax
    if tax_amount + ctx.posted_allowances_tax > ctx.tax_amount + 1e-6 {
        return Err(SalesAllowanceError::TaxExceedsInvoiceTax(format_amount(
            ctx.tax_amount,
        )));
    }

    let now = current_timestamp();
    let allowance_id = generate_allowance_id(now);
    let allowance_number = generate_next_allowance_number(conn, tid)?;
    let reason_type = "shipment_shortfall".to_string();
    let currency = "TWD".to_string();
    let status = "draft".to_string();

    conn.execute(
        "INSERT INTO sales_allowances (
            id, tenant_id, allowance_number, customer_invoice_id, invoice_number_snapshot,
            tax_invoice_number_snapshot, account_receivable_id, customer_partner_id,
            customer_name_snapshot, reason_type, allowance_date, shortfall_snapshot,
            untaxed_amount, tax_amount, external_reference, currency, status, note,
            created_by, created_at, posted_by, posted_at, cancelled_at, voided_by,
            voided_at, void_reason, task_id
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, NULL, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, NULL, NULL, NULL, NULL, NULL, NULL, NULL
        )",
        params![
            allowance_id,
            tid,
            allowance_number,
            ctx.id,
            ctx.invoice_number,
            ctx.tax_invoice_number,
            ctx.account_receivable_id,
            ctx.customer_partner_id,
            ctx.customer_name_snapshot,
            reason_type,
            allowance_date,
            untaxed_amount,
            tax_amount,
            input.external_reference,
            currency,
            status,
            input.note,
            created_by,
            now,
        ],
    ).map_err(|e| SalesAllowanceError::DatabaseError(e.to_string()))?;

    get_sales_allowance_impl(conn, tid, &allowance_id)
}

pub fn update_sales_allowance_impl(
    conn: &Connection,
    tenant_id: &str,
    input: UpdateSalesAllowanceInput,
) -> Result<SalesAllowance, SalesAllowanceError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(SalesAllowanceError::EmptyTenantId);
    }
    verify_active_tenant(conn, tid)?;

    let allowance = get_sales_allowance_impl(conn, tid, &input.id)?;
    if allowance.status != "draft" {
        return Err(SalesAllowanceError::NotDraftForUpdate);
    }

    let ctx = fetch_invoice_context(conn, tid, &allowance.customer_invoice_id, None)?;
    let today = get_today_local(conn).unwrap_or_else(|_| "1970-01-01".to_string());

    let allowance_date = input.allowance_date.unwrap_or(allowance.allowance_date);
    if allowance_date.as_str() > today.as_str() {
        return Err(SalesAllowanceError::AllowanceDateAfterToday);
    }
    if allowance_date.as_str() < ctx.invoice_date.as_str() {
        return Err(SalesAllowanceError::AllowanceDateBeforeInvoiceOrShip);
    }
    if let Some(ref max_s_date) = ctx.max_ship_date {
        if allowance_date.as_str() < max_s_date.as_str() {
            return Err(SalesAllowanceError::AllowanceDateBeforeInvoiceOrShip);
        }
    }

    let untaxed_amount = round_2(input.untaxed_amount.unwrap_or(allowance.untaxed_amount));
    if untaxed_amount <= 0.0 {
        return Err(SalesAllowanceError::InvalidUntaxedAmount);
    }
    if untaxed_amount > ctx.remaining_shortfall + 1e-6 {
        return Err(SalesAllowanceError::UntaxedExceedsShortfall(format_amount(
            ctx.remaining_shortfall,
        )));
    }

    let tax_amount = round_2(input.tax_amount.unwrap_or(allowance.tax_amount));
    if tax_amount < 0.0 {
        return Err(SalesAllowanceError::InvalidTaxAmount);
    }
    if tax_amount + ctx.posted_allowances_tax > ctx.tax_amount + 1e-6 {
        return Err(SalesAllowanceError::TaxExceedsInvoiceTax(format_amount(
            ctx.tax_amount,
        )));
    }

    let note = match input.note {
        Some(n) => Some(n),
        None => allowance.note,
    };
    let external_reference = match input.external_reference {
        Some(r) => Some(r),
        None => allowance.external_reference,
    };

    conn.execute(
        "UPDATE sales_allowances
         SET allowance_date = ?1, untaxed_amount = ?2, tax_amount = ?3, note = ?4, external_reference = ?5
         WHERE id = ?6 AND tenant_id = ?7 AND status = 'draft'",
        params![
            allowance_date,
            untaxed_amount,
            tax_amount,
            note,
            external_reference,
            input.id,
            tid,
        ],
    ).map_err(|e| SalesAllowanceError::DatabaseError(e.to_string()))?;

    get_sales_allowance_impl(conn, tid, &input.id)
}

pub fn post_sales_allowance_impl(
    conn: &mut Connection,
    tenant_id: &str,
    posted_by: &str,
    allowance_id: &str,
) -> Result<SalesAllowance, SalesAllowanceError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(SalesAllowanceError::EmptyTenantId);
    }
    verify_active_tenant(conn, tid)?;

    let target_id = allowance_id.trim();
    if target_id.is_empty() {
        return Err(SalesAllowanceError::AllowanceNotFound);
    }

    let tx = conn
        .transaction()
        .map_err(|e| SalesAllowanceError::DatabaseError(e.to_string()))?;

    // Load allowance in tx
    let allowance_row = tx.query_row(
        "SELECT id, allowance_number, customer_invoice_id, account_receivable_id, allowance_date,
                untaxed_amount, tax_amount, status
         FROM sales_allowances
         WHERE id = ?1 AND tenant_id = ?2",
        params![target_id, tid],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, f64>(5)?,
                r.get::<_, f64>(6)?,
                r.get::<_, String>(7)?,
            ))
        },
    );

    let (
        id,
        _allowance_number,
        customer_invoice_id,
        account_receivable_id,
        allowance_date,
        untaxed_amount,
        tax_amount,
        status,
    ) = match allowance_row {
        Ok(v) => v,
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            return Err(SalesAllowanceError::AllowanceNotFound)
        }
        Err(e) => return Err(SalesAllowanceError::DatabaseError(e.to_string())),
    };

    // SA-06: status must be draft
    if status != "draft" {
        return Err(SalesAllowanceError::InvalidStateTransition(
            status,
            "posted".to_string(),
        ));
    }

    // Re-check invoice context in tx
    let ctx = fetch_invoice_context(&tx, tid, &customer_invoice_id, Some(&id))?;
    let today = get_today_local(&tx).unwrap_or_else(|_| "1970-01-01".to_string());

    // SA-04
    if allowance_date.as_str() > today.as_str() {
        return Err(SalesAllowanceError::AllowanceDateAfterToday);
    }
    if allowance_date.as_str() < ctx.invoice_date.as_str() {
        return Err(SalesAllowanceError::AllowanceDateBeforeInvoiceOrShip);
    }
    if let Some(ref max_s_date) = ctx.max_ship_date {
        if allowance_date.as_str() < max_s_date.as_str() {
            return Err(SalesAllowanceError::AllowanceDateBeforeInvoiceOrShip);
        }
    }

    // SA-02
    if untaxed_amount <= 0.0 {
        return Err(SalesAllowanceError::InvalidUntaxedAmount);
    }
    if untaxed_amount > ctx.remaining_shortfall + 1e-6 {
        return Err(SalesAllowanceError::UntaxedExceedsShortfall(format_amount(
            ctx.remaining_shortfall,
        )));
    }

    // SA-03
    if tax_amount < 0.0 {
        return Err(SalesAllowanceError::InvalidTaxAmount);
    }
    if tax_amount + ctx.posted_allowances_tax > ctx.tax_amount + 1e-6 {
        return Err(SalesAllowanceError::TaxExceedsInvoiceTax(format_amount(
            ctx.tax_amount,
        )));
    }

    // SA-05: check original AR in tx
    let ar_row = tx.query_row(
        "SELECT amount, status FROM accounts_receivable WHERE id = ?1 AND tenant_id = ?2",
        params![account_receivable_id, tid],
        |r| Ok((r.get::<_, f64>(0)?, r.get::<_, String>(1)?)),
    );

    let (ar_amount, ar_status) = match ar_row {
        Ok(v) => v,
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            return Err(SalesAllowanceError::AccountReceivableNotFound)
        }
        Err(e) => return Err(SalesAllowanceError::DatabaseError(e.to_string())),
    };

    if ar_status != "open" {
        return Err(SalesAllowanceError::AccountReceivableNotOpen);
    }

    // Calculate current AR outstanding balance before this allowance
    let received_amount: f64 = if table_exists(&tx, "customer_receipt_allocations")
        && table_exists(&tx, "customer_receipts")
    {
        tx.query_row(
            "SELECT COALESCE(SUM(ra.amount), 0.0)
             FROM customer_receipt_allocations ra
             JOIN customer_receipts r ON r.id = ra.receipt_id AND r.tenant_id = ra.tenant_id
             WHERE ra.account_receivable_id = ?1 AND ra.tenant_id = ?2 AND r.status = 'posted'",
            params![account_receivable_id, tid],
            |r| r.get(0),
        )
        .unwrap_or(0.0)
    } else {
        0.0
    };

    let other_posted_allowances: f64 = tx
        .query_row(
            "SELECT COALESCE(SUM(untaxed_amount + tax_amount), 0.0)
             FROM sales_allowances
             WHERE account_receivable_id = ?1 AND tenant_id = ?2 AND status = 'posted' AND id != ?3",
            params![account_receivable_id, tid, id],
            |r| r.get(0),
        )
        .unwrap_or(0.0);

    let current_outstanding = round_2(ar_amount - received_amount - other_posted_allowances);
    let allowance_total = round_2(untaxed_amount + tax_amount);

    if allowance_total > current_outstanding + 1e-6 {
        return Err(SalesAllowanceError::AmountExceedsOutstanding(
            format_amount(allowance_total),
            format_amount(current_outstanding),
        ));
    }

    let now = current_timestamp();
    let shortfall_snapshot = ctx.remaining_shortfall;

    let affected = tx
        .execute(
            "UPDATE sales_allowances
             SET status = 'posted', posted_by = ?1, posted_at = ?2, shortfall_snapshot = ?3
             WHERE id = ?4 AND tenant_id = ?5 AND status = 'draft'",
            params![posted_by, now, shortfall_snapshot, id, tid],
        )
        .map_err(|e| SalesAllowanceError::DatabaseError(e.to_string()))?;

    crate::ensure_guarded_mutation_affected(
        &tx,
        "sales_allowances",
        &id,
        tid,
        affected,
        SalesAllowanceError::AllowanceNotFound,
        |s| {
            if s == "draft" {
                Ok(())
            } else {
                Err(SalesAllowanceError::InvalidStateTransition(
                    s,
                    "posted".to_string(),
                ))
            }
        },
    )?;

    tx.commit()
        .map_err(|e| SalesAllowanceError::DatabaseError(e.to_string()))?;

    get_sales_allowance_impl(conn, tid, target_id)
}

pub fn cancel_sales_allowance_impl(
    conn: &Connection,
    tenant_id: &str,
    allowance_id: &str,
) -> Result<SalesAllowance, SalesAllowanceError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(SalesAllowanceError::EmptyTenantId);
    }
    verify_active_tenant(conn, tid)?;

    let target_id = allowance_id.trim();
    if target_id.is_empty() {
        return Err(SalesAllowanceError::AllowanceNotFound);
    }

    let now = current_timestamp();
    let affected = conn
        .execute(
            "UPDATE sales_allowances
             SET status = 'cancelled', cancelled_at = ?1
             WHERE id = ?2 AND tenant_id = ?3 AND status = 'draft'",
            params![now, target_id, tid],
        )
        .map_err(|e| SalesAllowanceError::DatabaseError(e.to_string()))?;

    crate::ensure_guarded_mutation_affected(
        conn,
        "sales_allowances",
        target_id,
        tid,
        affected,
        SalesAllowanceError::AllowanceNotFound,
        |s| {
            if s == "draft" {
                Ok(())
            } else {
                Err(SalesAllowanceError::NotDraftForCancel)
            }
        },
    )?;

    get_sales_allowance_impl(conn, tid, target_id)
}

pub fn void_sales_allowance_impl(
    conn: &Connection,
    tenant_id: &str,
    voided_by: &str,
    allowance_id: &str,
    void_reason: &str,
) -> Result<SalesAllowance, SalesAllowanceError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(SalesAllowanceError::EmptyTenantId);
    }
    verify_active_tenant(conn, tid)?;

    let target_id = allowance_id.trim();
    if target_id.is_empty() {
        return Err(SalesAllowanceError::AllowanceNotFound);
    }

    let reason = void_reason.trim();
    if reason.is_empty() {
        return Err(SalesAllowanceError::VoidReasonRequired);
    }

    let now = current_timestamp();
    let affected = conn
        .execute(
            "UPDATE sales_allowances
             SET status = 'voided', voided_by = ?1, voided_at = ?2, void_reason = ?3
             WHERE id = ?4 AND tenant_id = ?5 AND status = 'posted'",
            params![voided_by, now, reason, target_id, tid],
        )
        .map_err(|e| SalesAllowanceError::DatabaseError(e.to_string()))?;

    crate::ensure_guarded_mutation_affected(
        conn,
        "sales_allowances",
        target_id,
        tid,
        affected,
        SalesAllowanceError::AllowanceNotFound,
        |s| {
            if s == "posted" {
                Ok(())
            } else {
                Err(SalesAllowanceError::NotPostedForVoid)
            }
        },
    )?;

    get_sales_allowance_impl(conn, tid, target_id)
}

pub fn get_sales_allowance_impl(
    conn: &Connection,
    tenant_id: &str,
    allowance_id: &str,
) -> Result<SalesAllowance, SalesAllowanceError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(SalesAllowanceError::EmptyTenantId);
    }
    let target_id = allowance_id.trim();
    if target_id.is_empty() {
        return Err(SalesAllowanceError::AllowanceNotFound);
    }

    let row = conn.query_row(
        "SELECT id, tenant_id, allowance_number, customer_invoice_id, invoice_number_snapshot,
                tax_invoice_number_snapshot, account_receivable_id, customer_partner_id,
                customer_name_snapshot, reason_type, allowance_date, shortfall_snapshot,
                untaxed_amount, tax_amount, external_reference, currency, status, note,
                created_by, created_at, posted_by, posted_at, cancelled_at, voided_by,
                voided_at, void_reason, task_id
         FROM sales_allowances
         WHERE id = ?1 AND tenant_id = ?2",
        params![target_id, tid],
        |r| {
            let untaxed: f64 = r.get(12)?;
            let tax: f64 = r.get(13)?;
            Ok(SalesAllowance {
                id: r.get(0)?,
                tenant_id: r.get(1)?,
                allowance_number: r.get(2)?,
                customer_invoice_id: r.get(3)?,
                invoice_number_snapshot: r.get(4)?,
                tax_invoice_number_snapshot: r.get(5)?,
                account_receivable_id: r.get(6)?,
                customer_partner_id: r.get(7)?,
                customer_name_snapshot: r.get(8)?,
                reason_type: r.get(9)?,
                allowance_date: r.get(10)?,
                shortfall_snapshot: r.get(11)?,
                untaxed_amount: untaxed,
                tax_amount: tax,
                total_amount: round_2(untaxed + tax),
                external_reference: r.get(14)?,
                currency: r.get(15)?,
                status: r.get(16)?,
                note: r.get(17)?,
                created_by: r.get(18)?,
                created_at: r.get(19)?,
                posted_by: r.get(20)?,
                posted_at: r.get(21)?,
                cancelled_at: r.get(22)?,
                voided_by: r.get(23)?,
                voided_at: r.get(24)?,
                void_reason: r.get(25)?,
                task_id: r.get(26)?,
            })
        },
    );

    match row {
        Ok(a) => Ok(a),
        Err(rusqlite::Error::QueryReturnedNoRows) => Err(SalesAllowanceError::AllowanceNotFound),
        Err(e) => Err(SalesAllowanceError::DatabaseError(e.to_string())),
    }
}

pub fn list_sales_allowances_impl(
    conn: &Connection,
    tenant_id: &str,
    filter: Option<SalesAllowanceFilter>,
) -> Result<Vec<SalesAllowance>, SalesAllowanceError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(SalesAllowanceError::EmptyTenantId);
    }

    let mut sql = String::from(
        "SELECT id, tenant_id, allowance_number, customer_invoice_id, invoice_number_snapshot,
                tax_invoice_number_snapshot, account_receivable_id, customer_partner_id,
                customer_name_snapshot, reason_type, allowance_date, shortfall_snapshot,
                untaxed_amount, tax_amount, external_reference, currency, status, note,
                created_by, created_at, posted_by, posted_at, cancelled_at, voided_by,
                voided_at, void_reason, task_id
         FROM sales_allowances
         WHERE tenant_id = ?1",
    );

    let mut param_values: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(tid.to_string())];
    let mut param_idx = 2;

    if let Some(f) = filter {
        if let Some(ref st) = f.status {
            let trimmed = st.trim();
            if !trimmed.is_empty() {
                sql.push_str(&format!(" AND status = ?{}", param_idx));
                param_values.push(Box::new(trimmed.to_string()));
                param_idx += 1;
            }
        }
        if let Some(ref cid) = f.customer_partner_id {
            let trimmed = cid.trim();
            if !trimmed.is_empty() {
                sql.push_str(&format!(" AND customer_partner_id = ?{}", param_idx));
                param_values.push(Box::new(trimmed.to_string()));
                param_idx += 1;
            }
        }
        if let Some(ref inv_id) = f.customer_invoice_id {
            let trimmed = inv_id.trim();
            if !trimmed.is_empty() {
                sql.push_str(&format!(" AND customer_invoice_id = ?{}", param_idx));
                param_values.push(Box::new(trimmed.to_string()));
                param_idx += 1;
            }
        }
        if let Some(ref q) = f.query {
            let trimmed = q.trim();
            if !trimmed.is_empty() {
                sql.push_str(&format!(
                    " AND (allowance_number LIKE ?{} OR invoice_number_snapshot LIKE ?{} OR customer_name_snapshot LIKE ?{})",
                    param_idx, param_idx, param_idx
                ));
                let pattern = format!("%{}%", trimmed);
                param_values.push(Box::new(pattern));
                // param_idx += 1;
            }
        }
    }

    sql.push_str(" ORDER BY created_at DESC");

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| SalesAllowanceError::DatabaseError(e.to_string()))?;

    let params_slice: Vec<&dyn rusqlite::ToSql> = param_values.iter().map(|b| b.as_ref()).collect();

    let rows = stmt
        .query_map(params_slice.as_slice(), |r| {
            let untaxed: f64 = r.get(12)?;
            let tax: f64 = r.get(13)?;
            Ok(SalesAllowance {
                id: r.get(0)?,
                tenant_id: r.get(1)?,
                allowance_number: r.get(2)?,
                customer_invoice_id: r.get(3)?,
                invoice_number_snapshot: r.get(4)?,
                tax_invoice_number_snapshot: r.get(5)?,
                account_receivable_id: r.get(6)?,
                customer_partner_id: r.get(7)?,
                customer_name_snapshot: r.get(8)?,
                reason_type: r.get(9)?,
                allowance_date: r.get(10)?,
                shortfall_snapshot: r.get(11)?,
                untaxed_amount: untaxed,
                tax_amount: tax,
                total_amount: round_2(untaxed + tax),
                external_reference: r.get(14)?,
                currency: r.get(15)?,
                status: r.get(16)?,
                note: r.get(17)?,
                created_by: r.get(18)?,
                created_at: r.get(19)?,
                posted_by: r.get(20)?,
                posted_at: r.get(21)?,
                cancelled_at: r.get(22)?,
                voided_by: r.get(23)?,
                voided_at: r.get(24)?,
                void_reason: r.get(25)?,
                task_id: r.get(26)?,
            })
        })
        .map_err(|e| SalesAllowanceError::DatabaseError(e.to_string()))?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r.map_err(|e| SalesAllowanceError::DatabaseError(e.to_string()))?);
    }
    Ok(list)
}

// ==========================================
// Tauri Commands
// ==========================================

#[tauri::command]
pub fn create_sales_allowance(
    app_handle: tauri::AppHandle,
    input: CreateSalesAllowanceInput,
) -> Result<SalesAllowance, String> {
    let db_path = crate::get_db_path(&app_handle);
    let conn = Connection::open(&db_path).map_err(|e| format!("DB Open Error: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;

    create_sales_allowance_impl(&conn, &active_tid, &active_uid, input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_sales_allowance(
    app_handle: tauri::AppHandle,
    input: UpdateSalesAllowanceInput,
) -> Result<SalesAllowance, String> {
    let db_path = crate::get_db_path(&app_handle);
    let conn = Connection::open(&db_path).map_err(|e| format!("DB Open Error: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;

    update_sales_allowance_impl(&conn, &active_tid, input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn post_sales_allowance(
    app_handle: tauri::AppHandle,
    allowance_id: String,
) -> Result<SalesAllowance, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| format!("DB Open Error: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;

    post_sales_allowance_impl(&mut conn, &active_tid, &active_uid, &allowance_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cancel_sales_allowance(
    app_handle: tauri::AppHandle,
    allowance_id: String,
) -> Result<SalesAllowance, String> {
    let db_path = crate::get_db_path(&app_handle);
    let conn = Connection::open(&db_path).map_err(|e| format!("DB Open Error: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;

    cancel_sales_allowance_impl(&conn, &active_tid, &allowance_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn void_sales_allowance(
    app_handle: tauri::AppHandle,
    allowance_id: String,
    void_reason: String,
) -> Result<SalesAllowance, String> {
    let db_path = crate::get_db_path(&app_handle);
    let conn = Connection::open(&db_path).map_err(|e| format!("DB Open Error: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;

    void_sales_allowance_impl(&conn, &active_tid, &active_uid, &allowance_id, &void_reason)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_sales_allowance(
    app_handle: tauri::AppHandle,
    allowance_id: String,
) -> Result<SalesAllowance, String> {
    let db_path = crate::get_db_path(&app_handle);
    let conn = Connection::open(&db_path).map_err(|e| format!("DB Open Error: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;

    get_sales_allowance_impl(&conn, &active_tid, &allowance_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_sales_allowances(
    app_handle: tauri::AppHandle,
    filter: Option<SalesAllowanceFilter>,
) -> Result<Vec<SalesAllowance>, String> {
    let db_path = crate::get_db_path(&app_handle);
    let conn = Connection::open(&db_path).map_err(|e| format!("DB Open Error: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;

    list_sales_allowances_impl(&conn, &active_tid, filter).map_err(|e| e.to_string())
}

// ==========================================
// Tests
// ==========================================

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::partners::create_partners_table(&conn).unwrap();
        crate::accounts_receivable::create_accounts_receivable_tables(&conn).unwrap();
        crate::customer_invoices::create_customer_invoices_tables(&conn).unwrap();
        create_sales_allowances_tables(&conn).unwrap();

        // Active tenant
        conn.execute(
            "CREATE TABLE IF NOT EXISTS tenants (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tenants (id, name, status, created_at) VALUES ('tnt_test', 'Test Tenant', 'active', 1000)",
            [],
        ).unwrap();

        // Customer partner
        conn.execute(
            "INSERT INTO partners (id, tenant_id, name, is_customer, is_vendor, created_at) VALUES ('cus_01', 'tnt_test', '宏碁科技', 1, 0, 1000)",
            [],
        ).unwrap();

        // Sales order tables if not exist
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS sales_orders (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                so_number TEXT NOT NULL,
                customer_partner_id TEXT NOT NULL,
                customer_name_snapshot TEXT NOT NULL,
                status TEXT NOT NULL,
                ship_date TEXT,
                confirmed_at INTEGER,
                shipped_at INTEGER,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sales_order_lines (
                id TEXT PRIMARY KEY,
                sales_order_id TEXT NOT NULL,
                line_number INTEGER NOT NULL,
                quantity REAL NOT NULL,
                shipped_quantity REAL,
                unit_price REAL NOT NULL
            );",
        )
        .unwrap();

        conn
    }

    fn seed_test_invoice_with_shortfall(
        conn: &Connection,
        basis: f64,
        shipped: f64,
    ) -> (String, String) {
        let so_id = "so_test_01";
        conn.execute(
            "INSERT INTO sales_orders (id, tenant_id, so_number, customer_partner_id, customer_name_snapshot, status, ship_date, confirmed_at, shipped_at, created_at)
             VALUES (?1, 'tnt_test', 'SO-001', 'cus_01', '宏碁科技', 'shipped', '2026-11-15', 1000, 1050, 1000)",
            params![so_id],
        ).unwrap();

        conn.execute(
            "INSERT INTO sales_order_lines (id, sales_order_id, line_number, quantity, shipped_quantity, unit_price)
             VALUES ('sol_01', ?1, 1, ?2, ?3, 1.0)",
            params![so_id, basis, shipped],
        ).unwrap();

        let inv_id = "inv_test_01";
        let tax = round_2(basis * 0.05);
        let total = round_2(basis + tax);
        conn.execute(
            "INSERT INTO customer_invoices (
                id, tenant_id, invoice_number, customer_partner_id, customer_name_snapshot,
                issuance_mode, invoice_date, due_date, untaxed_amount, tax_amount,
                currency, status, basis_amount, created_by, created_at, posted_at
            ) VALUES (
                ?1, 'tnt_test', 'INV-001', 'cus_01', '宏碁科技', 'per_order', '2026-11-15', '2026-12-15',
                ?2, ?3, 'TWD', 'posted', ?4, 'admin', 1000, 1010
            )",
            params![inv_id, basis, tax, basis],
        ).unwrap();

        conn.execute(
            "INSERT INTO customer_invoice_orders (id, tenant_id, customer_invoice_id, sales_order_id, so_number_snapshot, created_at)
             VALUES ('cio_01', 'tnt_test', ?1, ?2, 'SO-001', 1000)",
            params![inv_id, so_id],
        ).unwrap();

        // Create open AR for this invoice
        let ar_id = "ar_test_01";
        conn.execute(
            "INSERT INTO accounts_receivable (
                id, tenant_id, customer_partner_id, customer_name_snapshot,
                source_type, source_id, source_number, document_date, due_date,
                amount, currency, status, created_by, created_at
            ) VALUES (
                ?1, 'tnt_test', 'cus_01', '宏碁科技',
                'customer_invoice', ?2, 'INV-001', '2026-11-15', '2026-12-15',
                ?3, 'TWD', 'open', 'admin', 1000
            )",
            params![ar_id, inv_id, total],
        )
        .unwrap();

        (inv_id.to_string(), ar_id.to_string())
    }

    #[test]
    fn test_tc_sa_01_n1_and_e1_to_e4_and_b1_b2() {
        // Given: Invoice with 1000 basis, 600 shipped (shortfall 400)
        let conn = setup_test_db();
        let (inv_id, _) = seed_test_invoice_with_shortfall(&conn, 1000.0, 600.0);

        // When: TC-SA-01-N1: Create normal draft allowance
        let res = create_sales_allowance_impl(
            &conn,
            "tnt_test",
            "admin",
            CreateSalesAllowanceInput {
                customer_invoice_id: inv_id.clone(),
                allowance_date: Some("2026-11-18".to_string()),
                untaxed_amount: Some(400.0),
                tax_amount: Some(20.0),
                external_reference: None,
                note: Some("出貨短少折讓".to_string()),
                reason_type: Some("shipment_shortfall".to_string()),
            },
        );
        // Then: Successfully created
        assert!(res.is_ok());
        let alw = res.unwrap();
        assert_eq!(alw.status, "draft");
        assert_eq!(alw.allowance_number, "SALW-00001");
        assert_eq!(alw.untaxed_amount, 400.0);
        assert_eq!(alw.tax_amount, 20.0);
        assert_eq!(alw.total_amount, 420.0);

        // When / Then: TC-SA-01-E3: Duplicate draft on same invoice rejected
        let res_dup = create_sales_allowance_impl(
            &conn,
            "tnt_test",
            "admin",
            CreateSalesAllowanceInput {
                customer_invoice_id: inv_id.clone(),
                allowance_date: Some("2026-11-18".to_string()),
                untaxed_amount: Some(100.0),
                tax_amount: Some(5.0),
                external_reference: None,
                note: None,
                reason_type: None,
            },
        );
        assert!(matches!(
            res_dup,
            Err(SalesAllowanceError::ExistingDraftAllowance(_, _))
        ));

        // When / Then: TC-SA-01-E4: Invalid reason_type rejected
        let res_reason = create_sales_allowance_impl(
            &conn,
            "tnt_test",
            "admin",
            CreateSalesAllowanceInput {
                customer_invoice_id: inv_id.clone(),
                allowance_date: Some("2026-11-18".to_string()),
                untaxed_amount: Some(100.0),
                tax_amount: Some(5.0),
                external_reference: None,
                note: None,
                reason_type: Some("quality_discount".to_string()),
            },
        );
        assert_eq!(
            res_reason.unwrap_err(),
            SalesAllowanceError::InvalidReasonType
        );

        // Cancel previous draft so we can test boundaries
        cancel_sales_allowance_impl(&conn, "tnt_test", &alw.id).unwrap();

        // When / Then: TC-SA-01-B2: Shortfall < 1.0 (e.g. 0.99) rejected
        conn.execute(
            "UPDATE sales_order_lines SET shipped_quantity = 999.01 WHERE sales_order_id = 'so_test_01'",
            [],
        ).unwrap();
        let res_sub1 = create_sales_allowance_impl(
            &conn,
            "tnt_test",
            "admin",
            CreateSalesAllowanceInput {
                customer_invoice_id: inv_id.clone(),
                allowance_date: Some("2026-11-18".to_string()),
                untaxed_amount: None,
                tax_amount: None,
                external_reference: None,
                note: None,
                reason_type: None,
            },
        );
        assert_eq!(
            res_sub1.unwrap_err(),
            SalesAllowanceError::InvalidInvoiceStateForAllowance
        );

        // When / Then: TC-SA-01-B1: Shortfall exactly 1.0 allows creation
        conn.execute(
            "UPDATE sales_order_lines SET shipped_quantity = 999.0 WHERE sales_order_id = 'so_test_01'",
            [],
        ).unwrap();
        let res_exact1 = create_sales_allowance_impl(
            &conn,
            "tnt_test",
            "admin",
            CreateSalesAllowanceInput {
                customer_invoice_id: inv_id.clone(),
                allowance_date: Some("2026-11-18".to_string()),
                untaxed_amount: None,
                tax_amount: None,
                external_reference: None,
                note: None,
                reason_type: None,
            },
        );
        assert!(res_exact1.is_ok());
    }

    #[test]
    fn test_tc_sa_02_and_03_and_04_boundaries() {
        // Given: Shortfall is 400 (basis 1000, shipped 600, tax 50, invoice date 2026-11-15, ship date 2026-11-15)
        let mut conn = setup_test_db();
        let (inv_id, _) = seed_test_invoice_with_shortfall(&conn, 1000.0, 600.0);
        let today = get_today_local(&conn).unwrap();

        // When / Then: TC-SA-02-B1: untaxed_amount = 0
        let res_0 = create_sales_allowance_impl(
            &conn,
            "tnt_test",
            "admin",
            CreateSalesAllowanceInput {
                customer_invoice_id: inv_id.clone(),
                allowance_date: Some(today.clone()),
                untaxed_amount: Some(0.0),
                tax_amount: Some(0.0),
                external_reference: None,
                note: None,
                reason_type: None,
            },
        );
        assert_eq!(
            res_0.unwrap_err(),
            SalesAllowanceError::InvalidUntaxedAmount
        );

        // When / Then: TC-SA-02-B4: untaxed_amount exceeds shortfall by 0.01 (400.01)
        let res_over = create_sales_allowance_impl(
            &conn,
            "tnt_test",
            "admin",
            CreateSalesAllowanceInput {
                customer_invoice_id: inv_id.clone(),
                allowance_date: Some(today.clone()),
                untaxed_amount: Some(400.01),
                tax_amount: Some(20.0),
                external_reference: None,
                note: None,
                reason_type: None,
            },
        );
        assert!(matches!(
            res_over,
            Err(SalesAllowanceError::UntaxedExceedsShortfall(_))
        ));

        // When / Then: TC-SA-03-B2: tax_amount < 0
        let res_tax_neg = create_sales_allowance_impl(
            &conn,
            "tnt_test",
            "admin",
            CreateSalesAllowanceInput {
                customer_invoice_id: inv_id.clone(),
                allowance_date: Some(today.clone()),
                untaxed_amount: Some(200.0),
                tax_amount: Some(-0.01),
                external_reference: None,
                note: None,
                reason_type: None,
            },
        );
        assert_eq!(
            res_tax_neg.unwrap_err(),
            SalesAllowanceError::InvalidTaxAmount
        );

        // When / Then: TC-SA-03-B4: tax_amount exceeds invoice tax 50 (e.g. 50.01)
        let res_tax_over = create_sales_allowance_impl(
            &conn,
            "tnt_test",
            "admin",
            CreateSalesAllowanceInput {
                customer_invoice_id: inv_id.clone(),
                allowance_date: Some(today.clone()),
                untaxed_amount: Some(200.0),
                tax_amount: Some(50.01),
                external_reference: None,
                note: None,
                reason_type: None,
            },
        );
        assert!(matches!(
            res_tax_over,
            Err(SalesAllowanceError::TaxExceedsInvoiceTax(_))
        ));

        // When / Then: TC-SA-04-B2: allowance_date in future
        let res_future = create_sales_allowance_impl(
            &conn,
            "tnt_test",
            "admin",
            CreateSalesAllowanceInput {
                customer_invoice_id: inv_id.clone(),
                allowance_date: Some("2099-01-01".to_string()),
                untaxed_amount: Some(200.0),
                tax_amount: Some(10.0),
                external_reference: None,
                note: None,
                reason_type: None,
            },
        );
        assert_eq!(
            res_future.unwrap_err(),
            SalesAllowanceError::AllowanceDateAfterToday
        );

        // When / Then: TC-SA-04-B3: allowance_date earlier than invoice date 2026-11-15
        let res_early = create_sales_allowance_impl(
            &conn,
            "tnt_test",
            "admin",
            CreateSalesAllowanceInput {
                customer_invoice_id: inv_id.clone(),
                allowance_date: Some("2026-11-14".to_string()),
                untaxed_amount: Some(200.0),
                tax_amount: Some(10.0),
                external_reference: None,
                note: None,
                reason_type: None,
            },
        );
        assert_eq!(
            res_early.unwrap_err(),
            SalesAllowanceError::AllowanceDateBeforeInvoiceOrShip
        );

        // When: TC-SA-02-B3 & TC-SA-03-B3: Exactly equal to 400 untaxed and 20 tax
        let alw = create_sales_allowance_impl(
            &conn,
            "tnt_test",
            "admin",
            CreateSalesAllowanceInput {
                customer_invoice_id: inv_id.clone(),
                allowance_date: Some(today.clone()),
                untaxed_amount: Some(400.0),
                tax_amount: Some(20.0),
                external_reference: None,
                note: None,
                reason_type: None,
            },
        )
        .unwrap();

        // Then: Post succeeds
        let posted = post_sales_allowance_impl(&mut conn, "tnt_test", "admin", &alw.id);
        assert!(posted.is_ok());
    }

    #[test]
    fn test_tc_sa_05_and_06_and_07_post_and_void() {
        // Given: Invoice total is 1050 (1000 basis + 50 tax), AR is 1050 open
        let mut conn = setup_test_db();
        let (inv_id, ar_id) = seed_test_invoice_with_shortfall(&conn, 1000.0, 600.0);
        let today = get_today_local(&conn).unwrap();

        // Partial payment on AR of 800, leaving outstanding balance = 250
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS customer_receipts (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                receipt_number TEXT NOT NULL,
                status TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS customer_receipt_allocations (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                receipt_id TEXT NOT NULL,
                account_receivable_id TEXT NOT NULL,
                amount REAL NOT NULL
            );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO customer_receipts VALUES ('rcpt_01', 'tnt_test', 'RCPT-001', 'posted')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO customer_receipt_allocations VALUES ('alloc_01', 'tnt_test', 'rcpt_01', ?1, 800.0)",
            params![ar_id],
        ).unwrap();

        // When / Then: TC-SA-05-B2: Allowance total 420 exceeds remaining outstanding 250
        let alw = create_sales_allowance_impl(
            &conn,
            "tnt_test",
            "admin",
            CreateSalesAllowanceInput {
                customer_invoice_id: inv_id.clone(),
                allowance_date: Some(today.clone()),
                untaxed_amount: Some(400.0),
                tax_amount: Some(20.0),
                external_reference: None,
                note: None,
                reason_type: None,
            },
        )
        .unwrap();

        let res_post_exceed = post_sales_allowance_impl(&mut conn, "tnt_test", "admin", &alw.id);
        assert!(matches!(
            res_post_exceed,
            Err(SalesAllowanceError::AmountExceedsOutstanding(_, _))
        ));

        // When: Update allowance to 200 untaxed + 10 tax = 210 <= 250
        update_sales_allowance_impl(
            &conn,
            "tnt_test",
            UpdateSalesAllowanceInput {
                id: alw.id.clone(),
                allowance_date: None,
                untaxed_amount: Some(200.0),
                tax_amount: Some(10.0),
                external_reference: None,
                note: None,
            },
        )
        .unwrap();

        // When: TC-SA-06: Post allowance
        let posted = post_sales_allowance_impl(&mut conn, "tnt_test", "admin", &alw.id).unwrap();
        assert_eq!(posted.status, "posted");
        assert_eq!(posted.shortfall_snapshot, Some(400.0));

        // When / Then: TC-SA-06-E1: Re-post already posted allowance rejected
        let res_repost = post_sales_allowance_impl(&mut conn, "tnt_test", "admin", &alw.id);
        assert!(matches!(
            res_repost,
            Err(SalesAllowanceError::InvalidStateTransition(_, _))
        ));

        // When / Then: TC-SA-07-E1: Void without reason rejected
        let res_void_noreason =
            void_sales_allowance_impl(&conn, "tnt_test", "admin", &alw.id, "   ");
        assert_eq!(
            res_void_noreason.unwrap_err(),
            SalesAllowanceError::VoidReasonRequired
        );

        // When: TC-SA-07-N1: Void with valid reason
        let voided = void_sales_allowance_impl(
            &conn,
            "tnt_test",
            "admin",
            &alw.id,
            "出貨數量更正，折讓作廢",
        )
        .unwrap();
        assert_eq!(voided.status, "voided");
        assert_eq!(
            voided.void_reason.as_deref(),
            Some("出貨數量更正，折讓作廢")
        );
    }
}
