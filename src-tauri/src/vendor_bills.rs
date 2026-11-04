use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

static VB_ID_COUNTER: AtomicU64 = AtomicU64::new(1);
static VB_ORDER_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

fn current_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

fn round_2(val: f64) -> f64 {
    (val * 100.0).round() / 100.0
}

// ==========================================
// Date Helpers (Pure integer arithmetic, YYYY-MM-DD)
// ==========================================

pub fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

pub fn get_days_in_month(year: i32, month: u32) -> u32 {
    match month {
        2 => {
            if is_leap_year(year) {
                29
            } else {
                28
            }
        }
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

pub fn add_days(mut year: i32, mut month: u32, day: u32, days_to_add: u32) -> (i32, u32, u32) {
    let mut d = day + days_to_add;
    loop {
        let dim = get_days_in_month(year, month);
        if d <= dim {
            break;
        }
        d -= dim;
        month += 1;
        if month > 12 {
            month = 1;
            year += 1;
        }
    }
    (year, month, d)
}

pub fn parse_date(date_str: &str) -> Result<(i32, u32, u32), VendorBillError> {
    let trimmed = date_str.trim();
    let parts: Vec<&str> = trimmed.split('-').collect();
    if parts.len() != 3 || parts[0].len() != 4 || parts[1].len() != 2 || parts[2].len() != 2 {
        return Err(VendorBillError::InvalidDateFormat(
            "日期格式需為 YYYY-MM-DD".to_string(),
        ));
    }
    let year: i32 = parts[0]
        .parse()
        .map_err(|_| VendorBillError::InvalidDateFormat("無效的年份".to_string()))?;
    let month: u32 = parts[1]
        .parse()
        .map_err(|_| VendorBillError::InvalidDateFormat("無效的月份".to_string()))?;
    let day: u32 = parts[2]
        .parse()
        .map_err(|_| VendorBillError::InvalidDateFormat("無效的日期".to_string()))?;

    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return Err(VendorBillError::InvalidDateFormat(
            "無效的日期數值".to_string(),
        ));
    }
    let dim = get_days_in_month(year, month);
    if day > dim {
        return Err(VendorBillError::InvalidDateFormat(
            "日期超出該月份天數".to_string(),
        ));
    }
    Ok((year, month, day))
}

pub fn format_date(year: i32, month: u32, day: u32) -> String {
    format!("{:04}-{:02}-{:02}", year, month, day)
}

pub fn calculate_due_date(
    bill_date: &str,
    payment_terms_type: Option<&str>,
    payment_terms_days: Option<i64>,
) -> Result<String, VendorBillError> {
    let (year, month, day) = parse_date(bill_date)?;
    let terms_type = match payment_terms_type {
        Some(t) => t.trim(),
        None => return Ok(bill_date.trim().to_string()),
    };
    if terms_type.is_empty() {
        return Ok(bill_date.trim().to_string());
    }

    let days = payment_terms_days.unwrap_or(0).max(0) as u32;

    match terms_type {
        "net" => {
            let (y, m, d) = add_days(year, month, day, days);
            Ok(format_date(y, m, d))
        }
        "month_end" => {
            let end_day = get_days_in_month(year, month);
            let (y, m, d) = add_days(year, month, end_day, days);
            Ok(format_date(y, m, d))
        }
        _ => Ok(bill_date.trim().to_string()),
    }
}

pub fn get_today_local(conn: &Connection) -> Result<String, rusqlite::Error> {
    conn.query_row("SELECT date('now', 'localtime')", [], |r| r.get(0))
}

// ==========================================
// Errors
// ==========================================

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum VendorBillError {
    #[error("租戶 ID 不可為空")]
    EmptyTenantId,

    #[error("使用者 ID 不可為空")]
    EmptyUserId,

    #[error("請款單 ID 不可為空")]
    EmptyBillId,

    #[error("採購單 ID 不可為空")]
    EmptyPurchaseOrderId,

    #[error("供應商 ID 不可為空")]
    EmptyVendorPartnerId,

    #[error("供應商發票號碼不可為空")]
    EmptyVendorInvoiceNumber,

    #[error("此供應商的發票號碼 {0} 已登錄於 {1}")]
    DuplicateVendorInvoiceNumber(String, String),

    #[error("未稅金額必須大於 0")]
    InvalidUntaxedAmount,

    #[error("進項稅額不可小於 0")]
    InvalidTaxAmount,

    #[error("請款日不可晚於今天")]
    BillDateCannotBeInFuture,

    #[error("到期日不可早於請款日")]
    DueDateEarlierThanBillDate,

    #[error("無效的日期格式: {0}")]
    InvalidDateFormat(String),

    #[error("僅能加入同一供應商且已到貨的採購單")]
    InvalidOrderForBill,

    #[error("採購單 {0} 已在請款單 {1} 中")]
    OrderAlreadyCoveredInBill(String, String),

    #[error("請款單狀態為 {0}，不可修改")]
    InvalidStateForModification(String),

    #[error("請款單需至少涵蓋一張採購單")]
    NoOrdersCovered,

    #[error("接受差異需填寫說明")]
    DifferenceNoteRequired,

    #[error("作廢原因為必填")]
    VoidReasonRequired,

    #[error("此請款單已有付款核銷：{0}，請先作廢付款單")]
    HasPostedPaymentAllocations(String),

    #[error("無效的狀態轉換：不可從 {from} 轉換至 {to}")]
    InvalidStateTransition { from: String, to: String },

    #[error("找不到指定的請款單")]
    BillNotFound,

    #[error("找不到指定的供應商")]
    VendorNotFound,

    #[error("指定的合作夥伴不是供應商")]
    PartnerNotVendor,

    #[error("資料庫錯誤: {0}")]
    DatabaseError(String),

    #[error("應付帳款模組錯誤: {0}")]
    AccountsPayableError(String),

    #[error("{0}")]
    Other(String),
}

impl From<rusqlite::Error> for VendorBillError {
    fn from(err: rusqlite::Error) -> Self {
        VendorBillError::DatabaseError(err.to_string())
    }
}

// ==========================================
// Data Structures
// ==========================================

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct VendorBill {
    pub id: String,
    pub tenant_id: String,
    pub bill_number: String,
    pub vendor_partner_id: String,
    pub vendor_name_snapshot: String,
    pub vendor_invoice_number: String,
    pub bill_date: String,
    pub due_date: String,
    pub untaxed_amount: f64,
    pub tax_amount: f64,
    pub total_amount: f64, // Derived
    pub currency: String,
    pub status: String,
    pub basis_amount: Option<f64>,
    pub difference_amount: Option<f64>,
    pub difference_note: Option<String>,
    pub difference_accepted_by: Option<String>,
    pub difference_accepted_at: Option<i64>,
    pub note: Option<String>,
    pub created_by: String,
    pub created_at: i64,
    pub posted_at: Option<i64>,
    pub cancelled_at: Option<i64>,
    pub voided_by: Option<String>,
    pub voided_at: Option<i64>,
    pub void_reason: Option<String>,
    pub task_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct VendorBillOrderInfo {
    pub id: String,
    pub bill_id: String,
    pub purchase_order_id: String,
    pub po_number_snapshot: String,
    pub created_at: i64,
    pub received_total_amount: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct VendorBillDetail {
    pub bill: VendorBill,
    pub orders: Vec<VendorBillOrderInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct VendorBillItem {
    pub id: String,
    pub bill_number: String,
    pub vendor_partner_id: String,
    pub vendor_name_snapshot: String,
    pub vendor_invoice_number: String,
    pub bill_date: String,
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
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct UnbilledReceivedOrder {
    pub purchase_order_id: String,
    pub po_number: String,
    pub vendor_partner_id: String,
    pub vendor_name_snapshot: String,
    pub ordered_at: Option<i64>,
    pub received_at: Option<i64>,
    pub received_total_amount: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateVendorBillInput {
    pub vendor_partner_id: String,
    pub vendor_invoice_number: String,
    pub bill_date: String,
    pub due_date: Option<String>,
    pub untaxed_amount: f64,
    pub tax_amount: f64,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateVendorBillHeaderInput {
    pub bill_id: String,
    pub vendor_invoice_number: String,
    pub bill_date: String,
    pub due_date: String,
    pub untaxed_amount: f64,
    pub tax_amount: f64,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct ListVendorBillsFilter {
    pub vendor_partner_id: Option<String>,
    pub status: Option<String>,
}

// ==========================================
// Table Schema Initialization
// ==========================================

pub fn create_vendor_bills_tables(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS vendor_bills (
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
            basis_amount REAL,
            difference_amount REAL,
            difference_note TEXT,
            difference_accepted_by TEXT,
            difference_accepted_at INTEGER,
            note TEXT,
            created_by TEXT NOT NULL,
            created_at INTEGER NOT NULL,
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
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_vb_tenant_number ON vendor_bills (tenant_id, bill_number)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_vb_tenant_vendor ON vendor_bills (tenant_id, vendor_partner_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_vb_tenant_status ON vendor_bills (tenant_id, status)",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS vendor_bill_orders (
            id TEXT PRIMARY KEY,
            bill_id TEXT NOT NULL,
            purchase_order_id TEXT NOT NULL,
            po_number_snapshot TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_vbo_bill ON vendor_bill_orders (bill_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_vbo_order ON vendor_bill_orders (purchase_order_id)",
        [],
    )?;

    Ok(())
}

// ==========================================
// Helper Functions
// ==========================================

fn next_bill_number(tx: &Transaction, tenant_id: &str) -> Result<String, rusqlite::Error> {
    let mut stmt = tx.prepare(
        "SELECT COALESCE(MAX(CAST(SUBSTR(bill_number, 6) AS INTEGER)), 0) + 1 
         FROM vendor_bills WHERE tenant_id = ?1",
    )?;
    let next_seq: i64 = stmt.query_row(params![tenant_id], |row| row.get(0))?;
    Ok(format!("BILL-{:05}", next_seq))
}

fn resolve_vendor_info(
    conn: &Connection,
    tenant_id: &str,
    vendor_partner_id: &str,
) -> Result<(String, Option<String>, Option<i64>), VendorBillError> {
    let mut stmt = conn
        .prepare(
            "SELECT name, is_vendor, payment_terms_type, payment_terms_days 
             FROM partners WHERE id = ?1 AND tenant_id = ?2",
        )
        .map_err(|e| VendorBillError::DatabaseError(e.to_string()))?;

    let res = stmt.query_row(params![vendor_partner_id, tenant_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, Option<i64>>(3)?,
        ))
    });

    match res {
        Ok((name, is_vendor, terms_type, terms_days)) => {
            if is_vendor != 1 {
                return Err(VendorBillError::PartnerNotVendor);
            }
            Ok((name, terms_type, terms_days))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Err(VendorBillError::VendorNotFound),
        Err(e) => Err(VendorBillError::DatabaseError(e.to_string())),
    }
}

/// B-02: Check duplicate vendor invoice number for same vendor among non-cancelled, non-voided bills
fn check_duplicate_vendor_invoice_number(
    conn: &Connection,
    tenant_id: &str,
    vendor_partner_id: &str,
    invoice_number: &str,
    exclude_bill_id: Option<&str>,
) -> Result<(), VendorBillError> {
    let trimmed = invoice_number.trim();
    if trimmed.is_empty() {
        return Err(VendorBillError::EmptyVendorInvoiceNumber);
    }

    let sql = match exclude_bill_id {
        Some(_) => {
            "SELECT bill_number FROM vendor_bills 
             WHERE tenant_id = ?1 AND vendor_partner_id = ?2 
               AND LOWER(TRIM(vendor_invoice_number)) = LOWER(?3) 
               AND status NOT IN ('cancelled', 'voided') 
               AND id != ?4 
             LIMIT 1"
        }
        None => {
            "SELECT bill_number FROM vendor_bills 
             WHERE tenant_id = ?1 AND vendor_partner_id = ?2 
               AND LOWER(TRIM(vendor_invoice_number)) = LOWER(?3) 
               AND status NOT IN ('cancelled', 'voided') 
             LIMIT 1"
        }
    };

    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| VendorBillError::DatabaseError(e.to_string()))?;

    let existing: Result<String, _> = match exclude_bill_id {
        Some(bid) => stmt.query_row(params![tenant_id, vendor_partner_id, trimmed, bid], |r| {
            r.get(0)
        }),
        None => stmt.query_row(params![tenant_id, vendor_partner_id, trimmed], |r| r.get(0)),
    };

    if let Ok(other_bill_number) = existing {
        return Err(VendorBillError::DuplicateVendorInvoiceNumber(
            trimmed.to_string(),
            other_bill_number,
        ));
    }

    Ok(())
}

fn calculate_order_received_total(
    conn: &Connection,
    order_id: &str,
) -> Result<f64, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT quantity, received_quantity, purchase_cost 
         FROM purchase_order_lines WHERE purchase_order_id = ?1",
    )?;
    let rows = stmt.query_map(params![order_id], |r| {
        Ok((
            r.get::<_, f64>(0)?,
            r.get::<_, Option<f64>>(1)?,
            r.get::<_, f64>(2)?,
        ))
    })?;

    let mut total = 0.0;
    for r in rows {
        let (qty, rec_qty, cost) = r?;
        let actual_qty = rec_qty.unwrap_or(qty);
        total += actual_qty * cost;
    }
    Ok(round_2(total))
}

fn row_to_bill(row: &rusqlite::Row) -> Result<VendorBill, rusqlite::Error> {
    let untaxed: f64 = row.get(8)?;
    let tax: f64 = row.get(9)?;
    let total = round_2(untaxed + tax);

    Ok(VendorBill {
        id: row.get(0)?,
        tenant_id: row.get(1)?,
        bill_number: row.get(2)?,
        vendor_partner_id: row.get(3)?,
        vendor_name_snapshot: row.get(4)?,
        vendor_invoice_number: row.get(5)?,
        bill_date: row.get(6)?,
        due_date: row.get(7)?,
        untaxed_amount: untaxed,
        tax_amount: tax,
        total_amount: total,
        currency: row.get(10)?,
        status: row.get(11)?,
        basis_amount: row.get(12)?,
        difference_amount: row.get(13)?,
        difference_note: row.get(14)?,
        difference_accepted_by: row.get(15)?,
        difference_accepted_at: row.get(16)?,
        note: row.get(17)?,
        created_by: row.get(18)?,
        created_at: row.get(19)?,
        posted_at: row.get(20)?,
        cancelled_at: row.get(21)?,
        voided_by: row.get(22)?,
        voided_at: row.get(23)?,
        void_reason: row.get(24)?,
        task_id: row.get(25)?,
    })
}

// ==========================================
// Core Business Implementations
// ==========================================

pub fn create_vendor_bill_impl(
    conn: &mut Connection,
    tenant_id: &str,
    user_id: &str,
    input: CreateVendorBillInput,
) -> Result<VendorBillDetail, VendorBillError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(VendorBillError::EmptyTenantId);
    }
    let uid = user_id.trim();
    if uid.is_empty() {
        return Err(VendorBillError::EmptyUserId);
    }
    let v_id = input.vendor_partner_id.trim();
    if v_id.is_empty() {
        return Err(VendorBillError::EmptyVendorPartnerId);
    }
    let invoice_no = input.vendor_invoice_number.trim();
    if invoice_no.is_empty() {
        return Err(VendorBillError::EmptyVendorInvoiceNumber);
    }

    // B-03: Amount validation
    if input.untaxed_amount <= 0.0 {
        return Err(VendorBillError::InvalidUntaxedAmount);
    }
    if input.tax_amount < 0.0 {
        return Err(VendorBillError::InvalidTaxAmount);
    }

    // B-03: Date validation
    let bill_date = input.bill_date.trim();
    let _ = parse_date(bill_date)?;
    let today = get_today_local(conn)?;
    if bill_date > today.as_str() {
        return Err(VendorBillError::BillDateCannotBeInFuture);
    }

    // Resolve vendor snapshot and payment terms
    let (v_name_snapshot, terms_type, terms_days) = resolve_vendor_info(conn, tid, v_id)?;

    // Determine due_date: default from vendor payment terms if omitted or empty
    let due_date = match input.due_date {
        Some(ref d) if !d.trim().is_empty() => {
            let trimmed_d = d.trim();
            let _ = parse_date(trimmed_d)?;
            trimmed_d.to_string()
        }
        _ => calculate_due_date(bill_date, terms_type.as_deref(), terms_days)?,
    };

    if due_date.as_str() < bill_date {
        return Err(VendorBillError::DueDateEarlierThanBillDate);
    }

    // B-02: Check duplicate invoice number
    check_duplicate_vendor_invoice_number(conn, tid, v_id, invoice_no, None)?;

    let now = current_timestamp();
    let bill_id = format!(
        "bill_{}_{}",
        now,
        VB_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    );

    let tx = conn.transaction()?;
    let bill_number = next_bill_number(&tx, tid)?;

    tx.execute(
        "INSERT INTO vendor_bills (
            id, tenant_id, bill_number, vendor_partner_id, vendor_name_snapshot,
            vendor_invoice_number, bill_date, due_date, untaxed_amount, tax_amount,
            currency, status, basis_amount, difference_amount, difference_note,
            difference_accepted_by, difference_accepted_at, note, created_by,
            created_at, posted_at, cancelled_at, voided_by, voided_at, void_reason, task_id
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5,
            ?6, ?7, ?8, ?9, ?10,
            'TWD', 'draft', NULL, NULL, NULL,
            NULL, NULL, ?11, ?12,
            ?13, NULL, NULL, NULL, NULL, NULL, NULL
        )",
        params![
            bill_id,
            tid,
            bill_number,
            v_id,
            v_name_snapshot,
            invoice_no,
            bill_date,
            due_date,
            round_2(input.untaxed_amount),
            round_2(input.tax_amount),
            input.note.as_ref().map(|s| s.trim()),
            uid,
            now
        ],
    )?;

    tx.commit()?;

    get_vendor_bill_impl(conn, tid, &bill_id)
}

pub fn update_vendor_bill_header_impl(
    conn: &mut Connection,
    tenant_id: &str,
    input: UpdateVendorBillHeaderInput,
) -> Result<VendorBillDetail, VendorBillError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(VendorBillError::EmptyTenantId);
    }
    let b_id = input.bill_id.trim();
    if b_id.is_empty() {
        return Err(VendorBillError::EmptyBillId);
    }
    let invoice_no = input.vendor_invoice_number.trim();
    if invoice_no.is_empty() {
        return Err(VendorBillError::EmptyVendorInvoiceNumber);
    }

    // B-03: Amount validation
    if input.untaxed_amount <= 0.0 {
        return Err(VendorBillError::InvalidUntaxedAmount);
    }
    if input.tax_amount < 0.0 {
        return Err(VendorBillError::InvalidTaxAmount);
    }

    // B-03: Date validation
    let bill_date = input.bill_date.trim();
    let due_date = input.due_date.trim();
    let _ = parse_date(bill_date)?;
    let _ = parse_date(due_date)?;
    let today = get_today_local(conn)?;
    if bill_date > today.as_str() {
        return Err(VendorBillError::BillDateCannotBeInFuture);
    }
    if due_date < bill_date {
        return Err(VendorBillError::DueDateEarlierThanBillDate);
    }

    // Fetch existing bill and verify status == draft (B-06)
    let (status, vendor_partner_id): (String, String) = {
        let mut stmt = conn.prepare(
            "SELECT status, vendor_partner_id FROM vendor_bills WHERE id = ?1 AND tenant_id = ?2",
        )?;
        stmt.query_row(params![b_id, tid], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|_| VendorBillError::BillNotFound)?
    };

    if status != "draft" {
        return Err(VendorBillError::InvalidStateForModification(status));
    }

    // B-02: Check duplicate vendor invoice number
    check_duplicate_vendor_invoice_number(conn, tid, &vendor_partner_id, invoice_no, Some(b_id))?;

    let tx = conn.transaction()?;
    let affected = tx.execute(
        "UPDATE vendor_bills SET 
            vendor_invoice_number = ?1,
            bill_date = ?2,
            due_date = ?3,
            untaxed_amount = ?4,
            tax_amount = ?5,
            note = ?6
         WHERE id = ?7 AND tenant_id = ?8 AND status = 'draft'",
        params![
            invoice_no,
            bill_date,
            due_date,
            round_2(input.untaxed_amount),
            round_2(input.tax_amount),
            input.note.as_ref().map(|s| s.trim()),
            b_id,
            tid
        ],
    )?;

    crate::ensure_guarded_mutation_affected(
        &tx,
        "vendor_bills",
        b_id,
        tid,
        affected,
        VendorBillError::BillNotFound,
        |s| {
            if s != "draft" {
                Err(VendorBillError::InvalidStateForModification(s))
            } else {
                Ok(())
            }
        },
    )?;

    tx.commit()?;

    get_vendor_bill_impl(conn, tid, b_id)
}

pub fn add_vendor_bill_order_impl(
    conn: &mut Connection,
    tenant_id: &str,
    bill_id: &str,
    purchase_order_id: &str,
) -> Result<VendorBillDetail, VendorBillError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(VendorBillError::EmptyTenantId);
    }
    let b_id = bill_id.trim();
    if b_id.is_empty() {
        return Err(VendorBillError::EmptyBillId);
    }
    let po_id = purchase_order_id.trim();
    if po_id.is_empty() {
        return Err(VendorBillError::EmptyPurchaseOrderId);
    }

    // 1. Fetch bill and verify draft status (B-06)
    let (bill_status, bill_vendor_id, bill_number): (String, String, String) = {
        let mut stmt = conn.prepare(
            "SELECT status, vendor_partner_id, bill_number FROM vendor_bills WHERE id = ?1 AND tenant_id = ?2",
        )?;
        stmt.query_row(params![b_id, tid], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .map_err(|_| VendorBillError::BillNotFound)?
    };

    if bill_status != "draft" {
        return Err(VendorBillError::InvalidStateForModification(bill_status));
    }

    // 2. Fetch PO and verify same tenant, status == received, vendor matches (B-04)
    let po_info: Result<(String, String, String), _> = {
        let mut stmt = conn.prepare(
            "SELECT po_number, status, vendor_partner_id FROM purchase_orders WHERE id = ?1 AND tenant_id = ?2",
        )?;
        stmt.query_row(params![po_id, tid], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
    };

    let (po_number, po_status, po_vendor_id) = match po_info {
        Ok(t) => t,
        Err(_) => return Err(VendorBillError::InvalidOrderForBill),
    };

    if po_status != "received" || po_vendor_id != bill_vendor_id {
        return Err(VendorBillError::InvalidOrderForBill);
    }

    // 3. B-05: Check if covered by another draft/disputed/posted bill, or already in this bill
    let existing_bill: Result<String, _> = {
        let mut stmt = conn.prepare(
            "SELECT vb.bill_number 
             FROM vendor_bill_orders vbo
             JOIN vendor_bills vb ON vb.id = vbo.bill_id AND vb.tenant_id = ?1
             WHERE vbo.purchase_order_id = ?2 AND vb.status IN ('draft', 'disputed', 'posted')
             LIMIT 1",
        )?;
        stmt.query_row(params![tid, po_id], |r| r.get(0))
    };

    if let Ok(covering_bill_number) = existing_bill {
        return Err(VendorBillError::OrderAlreadyCoveredInBill(
            po_number,
            covering_bill_number,
        ));
    }

    // Also check if already in the same bill
    let already_in_bill: i64 = conn.query_row(
        "SELECT COUNT(*) FROM vendor_bill_orders WHERE bill_id = ?1 AND purchase_order_id = ?2",
        params![b_id, po_id],
        |r| r.get(0),
    )?;
    if already_in_bill > 0 {
        return Err(VendorBillError::OrderAlreadyCoveredInBill(
            po_number,
            bill_number,
        ));
    }

    let now = current_timestamp();
    let vbo_id = format!(
        "billpo_{}_{}",
        now,
        VB_ORDER_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    );

    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO vendor_bill_orders (id, bill_id, purchase_order_id, po_number_snapshot, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![vbo_id, b_id, po_id, po_number, now],
    )?;
    tx.commit()?;

    get_vendor_bill_impl(conn, tid, b_id)
}

pub fn remove_vendor_bill_order_impl(
    conn: &mut Connection,
    tenant_id: &str,
    bill_id: &str,
    purchase_order_id: &str,
) -> Result<VendorBillDetail, VendorBillError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(VendorBillError::EmptyTenantId);
    }
    let b_id = bill_id.trim();
    if b_id.is_empty() {
        return Err(VendorBillError::EmptyBillId);
    }
    let po_id = purchase_order_id.trim();
    if po_id.is_empty() {
        return Err(VendorBillError::EmptyPurchaseOrderId);
    }

    // Verify bill status == draft (B-06)
    let bill_status: String = {
        let mut stmt =
            conn.prepare("SELECT status FROM vendor_bills WHERE id = ?1 AND tenant_id = ?2")?;
        stmt.query_row(params![b_id, tid], |r| r.get(0))
            .map_err(|_| VendorBillError::BillNotFound)?
    };

    if bill_status != "draft" {
        return Err(VendorBillError::InvalidStateForModification(bill_status));
    }

    let tx = conn.transaction()?;
    tx.execute(
        "DELETE FROM vendor_bill_orders WHERE bill_id = ?1 AND (purchase_order_id = ?2 OR id = ?2)",
        params![b_id, po_id],
    )?;
    tx.commit()?;

    get_vendor_bill_impl(conn, tid, b_id)
}

pub fn post_vendor_bill_impl(
    conn: &mut Connection,
    tenant_id: &str,
    user_id: &str,
    bill_id: &str,
) -> Result<VendorBillDetail, VendorBillError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(VendorBillError::EmptyTenantId);
    }
    let uid = user_id.trim();
    if uid.is_empty() {
        return Err(VendorBillError::EmptyUserId);
    }
    let b_id = bill_id.trim();
    if b_id.is_empty() {
        return Err(VendorBillError::EmptyBillId);
    }

    let tx = conn.transaction()?;

    // 1. Fetch bill and check draft status
    let bill = {
        let mut stmt = tx.prepare(
            "SELECT id, tenant_id, bill_number, vendor_partner_id, vendor_name_snapshot,
                    vendor_invoice_number, bill_date, due_date, untaxed_amount, tax_amount,
                    currency, status, basis_amount, difference_amount, difference_note,
                    difference_accepted_by, difference_accepted_at, note, created_by,
                    created_at, posted_at, cancelled_at, voided_by, voided_at, void_reason, task_id
             FROM vendor_bills WHERE id = ?1 AND tenant_id = ?2",
        )?;
        stmt.query_row(params![b_id, tid], row_to_bill)
            .map_err(|_| VendorBillError::BillNotFound)?
    };

    if bill.status != "draft" {
        return Err(VendorBillError::InvalidStateTransition {
            from: bill.status,
            to: "posted".to_string(),
        });
    }

    // 2. Fetch covered purchase orders and verify count >= 1 (B-07)
    let covered_po_ids: Vec<String> = {
        let mut stmt =
            tx.prepare("SELECT purchase_order_id FROM vendor_bill_orders WHERE bill_id = ?1")?;
        let rows = stmt.query_map(params![b_id], |r| r.get(0))?;
        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        list
    };

    if covered_po_ids.is_empty() {
        return Err(VendorBillError::NoOrdersCovered);
    }

    // 3. In-tx re-validation of B-02, B-04, B-05
    check_duplicate_vendor_invoice_number(
        &tx,
        tid,
        &bill.vendor_partner_id,
        &bill.vendor_invoice_number,
        Some(b_id),
    )?;

    for po_id in &covered_po_ids {
        let po_check: Result<(String, String, String), _> = {
            let mut stmt = tx.prepare(
                "SELECT po_number, status, vendor_partner_id FROM purchase_orders WHERE id = ?1 AND tenant_id = ?2",
            )?;
            stmt.query_row(params![po_id, tid], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
        };
        let (po_number, po_status, po_vendor_id) = match po_check {
            Ok(v) => v,
            Err(_) => return Err(VendorBillError::InvalidOrderForBill),
        };
        if po_status != "received" || po_vendor_id != bill.vendor_partner_id {
            return Err(VendorBillError::InvalidOrderForBill);
        }

        // B-05: verify not in another active bill
        let active_other: Result<String, _> = {
            let mut stmt = tx.prepare(
                "SELECT vb.bill_number 
                 FROM vendor_bill_orders vbo
                 JOIN vendor_bills vb ON vb.id = vbo.bill_id AND vb.tenant_id = ?1
                 WHERE vbo.purchase_order_id = ?2 AND vb.status IN ('draft', 'disputed', 'posted') AND vb.id != ?3
                 LIMIT 1",
            )?;
            stmt.query_row(params![tid, po_id, b_id], |r| r.get(0))
        };
        if let Ok(other_bill) = active_other {
            return Err(VendorBillError::OrderAlreadyCoveredInBill(
                po_number, other_bill,
            ));
        }
    }

    // 4. Calculate basis_amount: sum of COALESCE(received_quantity, quantity) * purchase_cost
    let mut basis_amount = 0.0;
    for po_id in &covered_po_ids {
        basis_amount += calculate_order_received_total(&tx, po_id)?;
    }
    basis_amount = round_2(basis_amount);

    let diff = round_2(bill.untaxed_amount - basis_amount);
    let is_matched = diff.abs() < 1.0 - 1e-9;
    let now = current_timestamp();

    if is_matched {
        // Transition to posted
        let affected = tx.execute(
            "UPDATE vendor_bills 
             SET status = 'posted', basis_amount = ?1, difference_amount = ?2, posted_at = ?3
             WHERE id = ?4 AND tenant_id = ?5 AND status = 'draft'",
            params![basis_amount, diff, now, b_id, tid],
        )?;

        crate::ensure_guarded_mutation_affected(
            &tx,
            "vendor_bills",
            b_id,
            tid,
            affected,
            VendorBillError::BillNotFound,
            |s| {
                if s != "draft" {
                    Err(VendorBillError::InvalidStateTransition {
                        from: s,
                        to: "posted".to_string(),
                    })
                } else {
                    Ok(())
                }
            },
        )?;

        // B-08: Generate Accounts Payable in the same transaction
        let ap_input = crate::accounts_payable::CreateAccountPayableInput {
            vendor_partner_id: bill.vendor_partner_id.clone(),
            source_type: "vendor_bill".to_string(),
            source_id: bill.id.clone(),
            source_number: bill.bill_number.clone(),
            external_reference: Some(bill.vendor_invoice_number.clone()),
            document_date: bill.bill_date.clone(),
            due_date: bill.due_date.clone(),
            amount: round_2(bill.untaxed_amount + bill.tax_amount),
            currency: Some("TWD".to_string()),
        };

        crate::accounts_payable::create_account_payable_in_tx(&tx, tid, uid, ap_input)
            .map_err(|e| VendorBillError::AccountsPayableError(e.to_string()))?;
    } else {
        // Transition to disputed: snapshot basis & difference, no AP
        let affected = tx.execute(
            "UPDATE vendor_bills 
             SET status = 'disputed', basis_amount = ?1, difference_amount = ?2
             WHERE id = ?3 AND tenant_id = ?4 AND status = 'draft'",
            params![basis_amount, diff, b_id, tid],
        )?;

        crate::ensure_guarded_mutation_affected(
            &tx,
            "vendor_bills",
            b_id,
            tid,
            affected,
            VendorBillError::BillNotFound,
            |s| {
                if s != "draft" {
                    Err(VendorBillError::InvalidStateTransition {
                        from: s,
                        to: "disputed".to_string(),
                    })
                } else {
                    Ok(())
                }
            },
        )?;
    }

    tx.commit()?;

    get_vendor_bill_impl(conn, tid, b_id)
}

pub fn accept_vendor_bill_difference_impl(
    conn: &mut Connection,
    tenant_id: &str,
    user_id: &str,
    bill_id: &str,
    difference_note: &str,
) -> Result<VendorBillDetail, VendorBillError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(VendorBillError::EmptyTenantId);
    }
    let uid = user_id.trim();
    if uid.is_empty() {
        return Err(VendorBillError::EmptyUserId);
    }
    let b_id = bill_id.trim();
    if b_id.is_empty() {
        return Err(VendorBillError::EmptyBillId);
    }

    let note_trimmed = difference_note.trim();
    if note_trimmed.is_empty() {
        return Err(VendorBillError::DifferenceNoteRequired);
    }

    let tx = conn.transaction()?;

    let bill = {
        let mut stmt = tx.prepare(
            "SELECT id, tenant_id, bill_number, vendor_partner_id, vendor_name_snapshot,
                    vendor_invoice_number, bill_date, due_date, untaxed_amount, tax_amount,
                    currency, status, basis_amount, difference_amount, difference_note,
                    difference_accepted_by, difference_accepted_at, note, created_by,
                    created_at, posted_at, cancelled_at, voided_by, voided_at, void_reason, task_id
             FROM vendor_bills WHERE id = ?1 AND tenant_id = ?2",
        )?;
        stmt.query_row(params![b_id, tid], row_to_bill)
            .map_err(|_| VendorBillError::BillNotFound)?
    };

    if bill.status != "disputed" {
        return Err(VendorBillError::InvalidStateTransition {
            from: bill.status,
            to: "posted".to_string(),
        });
    }

    let now = current_timestamp();
    let affected = tx.execute(
        "UPDATE vendor_bills 
         SET status = 'posted', 
             difference_note = ?1,
             difference_accepted_by = ?2,
             difference_accepted_at = ?3,
             posted_at = ?3
         WHERE id = ?4 AND tenant_id = ?5 AND status = 'disputed'",
        params![note_trimmed, uid, now, b_id, tid],
    )?;

    crate::ensure_guarded_mutation_affected(
        &tx,
        "vendor_bills",
        b_id,
        tid,
        affected,
        VendorBillError::BillNotFound,
        |s| {
            if s != "disputed" {
                Err(VendorBillError::InvalidStateTransition {
                    from: s,
                    to: "posted".to_string(),
                })
            } else {
                Ok(())
            }
        },
    )?;

    // B-08: Create Accounts Payable with amount = total_amount
    let ap_input = crate::accounts_payable::CreateAccountPayableInput {
        vendor_partner_id: bill.vendor_partner_id.clone(),
        source_type: "vendor_bill".to_string(),
        source_id: bill.id.clone(),
        source_number: bill.bill_number.clone(),
        external_reference: Some(bill.vendor_invoice_number.clone()),
        document_date: bill.bill_date.clone(),
        due_date: bill.due_date.clone(),
        amount: round_2(bill.untaxed_amount + bill.tax_amount),
        currency: Some("TWD".to_string()),
    };

    crate::accounts_payable::create_account_payable_in_tx(&tx, tid, uid, ap_input)
        .map_err(|e| VendorBillError::AccountsPayableError(e.to_string()))?;

    tx.commit()?;

    get_vendor_bill_impl(conn, tid, b_id)
}

pub fn return_vendor_bill_to_draft_impl(
    conn: &mut Connection,
    tenant_id: &str,
    bill_id: &str,
) -> Result<VendorBillDetail, VendorBillError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(VendorBillError::EmptyTenantId);
    }
    let b_id = bill_id.trim();
    if b_id.is_empty() {
        return Err(VendorBillError::EmptyBillId);
    }

    let tx = conn.transaction()?;

    let current_status: String = {
        let mut stmt =
            tx.prepare("SELECT status FROM vendor_bills WHERE id = ?1 AND tenant_id = ?2")?;
        stmt.query_row(params![b_id, tid], |r| r.get(0))
            .map_err(|_| VendorBillError::BillNotFound)?
    };

    if current_status != "disputed" {
        return Err(VendorBillError::InvalidStateTransition {
            from: current_status,
            to: "draft".to_string(),
        });
    }

    let affected = tx.execute(
        "UPDATE vendor_bills 
         SET status = 'draft',
             basis_amount = NULL,
             difference_amount = NULL,
             difference_note = NULL,
             difference_accepted_by = NULL,
             difference_accepted_at = NULL
         WHERE id = ?1 AND tenant_id = ?2 AND status = 'disputed'",
        params![b_id, tid],
    )?;

    crate::ensure_guarded_mutation_affected(
        &tx,
        "vendor_bills",
        b_id,
        tid,
        affected,
        VendorBillError::BillNotFound,
        |s| {
            if s != "disputed" {
                Err(VendorBillError::InvalidStateTransition {
                    from: s,
                    to: "draft".to_string(),
                })
            } else {
                Ok(())
            }
        },
    )?;

    tx.commit()?;

    get_vendor_bill_impl(conn, tid, b_id)
}

pub fn cancel_vendor_bill_impl(
    conn: &mut Connection,
    tenant_id: &str,
    bill_id: &str,
) -> Result<VendorBillDetail, VendorBillError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(VendorBillError::EmptyTenantId);
    }
    let b_id = bill_id.trim();
    if b_id.is_empty() {
        return Err(VendorBillError::EmptyBillId);
    }

    let tx = conn.transaction()?;

    let current_status: String = {
        let mut stmt =
            tx.prepare("SELECT status FROM vendor_bills WHERE id = ?1 AND tenant_id = ?2")?;
        stmt.query_row(params![b_id, tid], |r| r.get(0))
            .map_err(|_| VendorBillError::BillNotFound)?
    };

    if current_status != "draft" && current_status != "disputed" {
        return Err(VendorBillError::InvalidStateTransition {
            from: current_status,
            to: "cancelled".to_string(),
        });
    }

    let now = current_timestamp();
    let affected = tx.execute(
        "UPDATE vendor_bills 
         SET status = 'cancelled', cancelled_at = ?1
         WHERE id = ?2 AND tenant_id = ?3 AND status IN ('draft', 'disputed')",
        params![now, b_id, tid],
    )?;

    crate::ensure_guarded_mutation_affected(
        &tx,
        "vendor_bills",
        b_id,
        tid,
        affected,
        VendorBillError::BillNotFound,
        |s| {
            if s != "draft" && s != "disputed" {
                Err(VendorBillError::InvalidStateTransition {
                    from: s,
                    to: "cancelled".to_string(),
                })
            } else {
                Ok(())
            }
        },
    )?;

    tx.commit()?;

    get_vendor_bill_impl(conn, tid, b_id)
}

pub fn void_vendor_bill_impl(
    conn: &mut Connection,
    tenant_id: &str,
    user_id: &str,
    bill_id: &str,
    void_reason: &str,
) -> Result<VendorBillDetail, VendorBillError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(VendorBillError::EmptyTenantId);
    }
    let uid = user_id.trim();
    if uid.is_empty() {
        return Err(VendorBillError::EmptyUserId);
    }
    let b_id = bill_id.trim();
    if b_id.is_empty() {
        return Err(VendorBillError::EmptyBillId);
    }
    let reason_trimmed = void_reason.trim();
    if reason_trimmed.is_empty() {
        return Err(VendorBillError::VoidReasonRequired);
    }

    let tx = conn.transaction()?;

    let current_status: String = {
        let mut stmt =
            tx.prepare("SELECT status FROM vendor_bills WHERE id = ?1 AND tenant_id = ?2")?;
        stmt.query_row(params![b_id, tid], |r| r.get(0))
            .map_err(|_| VendorBillError::BillNotFound)?
    };

    if current_status != "posted" {
        return Err(VendorBillError::InvalidStateTransition {
            from: current_status,
            to: "voided".to_string(),
        });
    }

    // B-10: Find and void associated accounts payable (with AP-04 check)
    let ap_id: Option<String> = tx
        .query_row(
            "SELECT id FROM accounts_payable 
             WHERE tenant_id = ?1 AND source_type = 'vendor_bill' AND source_id = ?2 AND status = 'open'",
            params![tid, b_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| VendorBillError::DatabaseError(e.to_string()))?;

    if let Some(ap_id) = ap_id {
        crate::accounts_payable::void_account_payable_in_tx(&tx, tid, uid, &ap_id, reason_trimmed)
            .map_err(|e| match e {
                crate::accounts_payable::AccountsPayableError::HasPostedPaymentAllocations(
                    pay_no,
                ) => VendorBillError::HasPostedPaymentAllocations(pay_no),
                other => VendorBillError::AccountsPayableError(other.to_string()),
            })?;
    }

    let now = current_timestamp();
    let affected = tx.execute(
        "UPDATE vendor_bills 
         SET status = 'voided', voided_by = ?1, voided_at = ?2, void_reason = ?3
         WHERE id = ?4 AND tenant_id = ?5 AND status = 'posted'",
        params![uid, now, reason_trimmed, b_id, tid],
    )?;

    crate::ensure_guarded_mutation_affected(
        &tx,
        "vendor_bills",
        b_id,
        tid,
        affected,
        VendorBillError::BillNotFound,
        |s| {
            if s != "posted" {
                Err(VendorBillError::InvalidStateTransition {
                    from: s,
                    to: "voided".to_string(),
                })
            } else {
                Ok(())
            }
        },
    )?;

    tx.commit()?;

    get_vendor_bill_impl(conn, tid, b_id)
}

pub fn get_vendor_bill_impl(
    conn: &Connection,
    tenant_id: &str,
    bill_id: &str,
) -> Result<VendorBillDetail, VendorBillError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(VendorBillError::EmptyTenantId);
    }
    let b_id = bill_id.trim();
    if b_id.is_empty() {
        return Err(VendorBillError::EmptyBillId);
    }

    let mut stmt = conn.prepare(
        "SELECT id, tenant_id, bill_number, vendor_partner_id, vendor_name_snapshot,
                vendor_invoice_number, bill_date, due_date, untaxed_amount, tax_amount,
                currency, status, basis_amount, difference_amount, difference_note,
                difference_accepted_by, difference_accepted_at, note, created_by,
                created_at, posted_at, cancelled_at, voided_by, voided_at, void_reason, task_id
         FROM vendor_bills WHERE id = ?1 AND tenant_id = ?2",
    )?;

    let bill = stmt
        .query_row(params![b_id, tid], row_to_bill)
        .map_err(|_| VendorBillError::BillNotFound)?;

    let mut orders_stmt = conn.prepare(
        "SELECT id, bill_id, purchase_order_id, po_number_snapshot, created_at
         FROM vendor_bill_orders WHERE bill_id = ?1 ORDER BY created_at ASC",
    )?;

    let order_rows = orders_stmt.query_map(params![b_id], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, i64>(4)?,
        ))
    })?;

    let mut orders = Vec::new();
    for r in order_rows {
        let (id, b_id, po_id, po_snapshot, created_at) = r?;
        let rec_total = calculate_order_received_total(conn, &po_id)?;
        orders.push(VendorBillOrderInfo {
            id,
            bill_id: b_id,
            purchase_order_id: po_id,
            po_number_snapshot: po_snapshot,
            created_at,
            received_total_amount: rec_total,
        });
    }

    Ok(VendorBillDetail { bill, orders })
}

pub fn list_vendor_bills_impl(
    conn: &Connection,
    tenant_id: &str,
    filter: ListVendorBillsFilter,
) -> Result<Vec<VendorBillItem>, VendorBillError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(VendorBillError::EmptyTenantId);
    }

    let mut query = "SELECT vb.id, vb.bill_number, vb.vendor_partner_id, vb.vendor_name_snapshot,
                            vb.vendor_invoice_number, vb.bill_date, vb.due_date, vb.untaxed_amount,
                            vb.tax_amount, vb.currency, vb.status, vb.basis_amount, vb.difference_amount,
                            vb.created_at, vb.posted_at, vb.cancelled_at, vb.voided_at,
                            (SELECT COUNT(*) FROM vendor_bill_orders vbo WHERE vbo.bill_id = vb.id) as order_count
                     FROM vendor_bills vb
                     WHERE vb.tenant_id = ?1".to_string();

    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(tid.to_string())];

    if let Some(v_id) = filter.vendor_partner_id {
        let trimmed = v_id.trim().to_string();
        if !trimmed.is_empty() {
            query.push_str(&format!(
                " AND vb.vendor_partner_id = ?{}",
                params_vec.len() + 1
            ));
            params_vec.push(Box::new(trimmed));
        }
    }

    if let Some(st) = filter.status {
        let trimmed = st.trim().to_string();
        if !trimmed.is_empty() {
            query.push_str(&format!(" AND vb.status = ?{}", params_vec.len() + 1));
            params_vec.push(Box::new(trimmed));
        }
    }

    query.push_str(" ORDER BY vb.bill_date DESC, vb.created_at DESC, vb.bill_number DESC");

    let mut stmt = conn
        .prepare(&query)
        .map_err(|e| VendorBillError::DatabaseError(e.to_string()))?;

    let rusqlite_params: Vec<&dyn rusqlite::ToSql> =
        params_vec.iter().map(|p| p.as_ref()).collect();

    let rows = stmt.query_map(rusqlite_params.as_slice(), |r| {
        let untaxed: f64 = r.get(7)?;
        let tax: f64 = r.get(8)?;
        Ok(VendorBillItem {
            id: r.get(0)?,
            bill_number: r.get(1)?,
            vendor_partner_id: r.get(2)?,
            vendor_name_snapshot: r.get(3)?,
            vendor_invoice_number: r.get(4)?,
            bill_date: r.get(5)?,
            due_date: r.get(6)?,
            untaxed_amount: untaxed,
            tax_amount: tax,
            total_amount: round_2(untaxed + tax),
            currency: r.get(9)?,
            status: r.get(10)?,
            basis_amount: r.get(11)?,
            difference_amount: r.get(12)?,
            created_at: r.get(13)?,
            posted_at: r.get(14)?,
            cancelled_at: r.get(15)?,
            voided_at: r.get(16)?,
            order_count: r.get(17)?,
        })
    })?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r?);
    }
    Ok(list)
}

pub fn list_unbilled_received_orders_impl(
    conn: &Connection,
    tenant_id: &str,
    vendor_partner_id: Option<String>,
) -> Result<Vec<UnbilledReceivedOrder>, VendorBillError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(VendorBillError::EmptyTenantId);
    }

    let mut query = "SELECT po.id, po.po_number, po.vendor_partner_id, po.vendor_name_snapshot,
                            po.ordered_at, po.received_at
                     FROM purchase_orders po
                     WHERE po.tenant_id = ?1 AND po.status = 'received'"
        .to_string();

    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(tid.to_string())];

    if let Some(v_id) = vendor_partner_id {
        let trimmed = v_id.trim().to_string();
        if !trimmed.is_empty() {
            query.push_str(&format!(
                " AND po.vendor_partner_id = ?{}",
                params_vec.len() + 1
            ));
            params_vec.push(Box::new(trimmed));
        }
    }

    query.push_str(
        " AND po.id NOT IN (
            SELECT vbo.purchase_order_id 
            FROM vendor_bill_orders vbo
            JOIN vendor_bills vb ON vb.id = vbo.bill_id AND vb.tenant_id = po.tenant_id
            WHERE vb.status IN ('draft', 'disputed', 'posted')
          )
          ORDER BY po.received_at DESC, po.po_number DESC",
    );

    let mut stmt = conn
        .prepare(&query)
        .map_err(|e| VendorBillError::DatabaseError(e.to_string()))?;

    let rusqlite_params: Vec<&dyn rusqlite::ToSql> =
        params_vec.iter().map(|p| p.as_ref()).collect();

    let rows = stmt.query_map(rusqlite_params.as_slice(), |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, Option<i64>>(4)?,
            r.get::<_, Option<i64>>(5)?,
        ))
    })?;

    let mut list = Vec::new();
    for r in rows {
        let (po_id, po_number, v_id, v_name, ordered_at, received_at) = r?;
        let rec_total = calculate_order_received_total(conn, &po_id)?;
        list.push(UnbilledReceivedOrder {
            purchase_order_id: po_id,
            po_number,
            vendor_partner_id: v_id,
            vendor_name_snapshot: v_name,
            ordered_at,
            received_at,
            received_total_amount: rec_total,
        });
    }

    Ok(list)
}

// ==========================================
// Tauri Commands
// ==========================================

#[tauri::command]
#[specta::specta]
pub async fn create_vendor_bill<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    input: CreateVendorBillInput,
) -> Result<VendorBillDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;
    create_vendor_bill_impl(&mut conn, &active_tid, &active_uid, input).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn update_vendor_bill_header<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    input: UpdateVendorBillHeaderInput,
) -> Result<VendorBillDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    update_vendor_bill_header_impl(&mut conn, &active_tid, input).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn add_vendor_bill_order<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    bill_id: String,
    purchase_order_id: String,
) -> Result<VendorBillDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    add_vendor_bill_order_impl(&mut conn, &active_tid, &bill_id, &purchase_order_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn remove_vendor_bill_order<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    bill_id: String,
    purchase_order_id: String,
) -> Result<VendorBillDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    remove_vendor_bill_order_impl(&mut conn, &active_tid, &bill_id, &purchase_order_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn post_vendor_bill<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    bill_id: String,
) -> Result<VendorBillDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;
    post_vendor_bill_impl(&mut conn, &active_tid, &active_uid, &bill_id).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn accept_vendor_bill_difference<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    bill_id: String,
    difference_note: String,
) -> Result<VendorBillDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;
    accept_vendor_bill_difference_impl(
        &mut conn,
        &active_tid,
        &active_uid,
        &bill_id,
        &difference_note,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn return_vendor_bill_to_draft<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    bill_id: String,
) -> Result<VendorBillDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    return_vendor_bill_to_draft_impl(&mut conn, &active_tid, &bill_id).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_vendor_bill<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    bill_id: String,
) -> Result<VendorBillDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    cancel_vendor_bill_impl(&mut conn, &active_tid, &bill_id).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn void_vendor_bill<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    bill_id: String,
    void_reason: String,
) -> Result<VendorBillDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;
    void_vendor_bill_impl(&mut conn, &active_tid, &active_uid, &bill_id, &void_reason)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn get_vendor_bill<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    id: Option<String>,
    bill_id: Option<String>,
) -> Result<VendorBillDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let target_id = id
        .or(bill_id)
        .ok_or_else(|| "缺少請款單 ID (id 或 bill_id)".to_string())?;
    get_vendor_bill_impl(&conn, &active_tid, &target_id).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn list_vendor_bills<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    vendor_partner_id: Option<String>,
    status: Option<String>,
) -> Result<Vec<VendorBillItem>, String> {
    let db_path = crate::get_db_path(&app_handle);
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    list_vendor_bills_impl(
        &conn,
        &active_tid,
        ListVendorBillsFilter {
            vendor_partner_id,
            status,
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn list_unbilled_received_orders<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    vendor_partner_id: Option<String>,
) -> Result<Vec<UnbilledReceivedOrder>, String> {
    let db_path = crate::get_db_path(&app_handle);
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    list_unbilled_received_orders_impl(&conn, &active_tid, vendor_partner_id)
        .map_err(|e| e.to_string())
}

// ==========================================
// Unit and Integration Tests (Layer 1)
// ==========================================

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::partners::create_partners_table(&conn).unwrap();
        crate::accounts_payable::create_accounts_payable_tables(&conn).unwrap();
        crate::purchase_orders::create_purchase_orders_tables(&conn).unwrap();
        create_vendor_bills_tables(&conn).unwrap();

        // 1. Seed vendor vnd_001 (net 30)
        conn.execute(
            "INSERT INTO partners (id, tenant_id, name, is_vendor, is_customer, payment_terms_type, payment_terms_days, created_at)
             VALUES ('vnd_001', 'tnt_test', '測試供應商 A (Net 30)', 1, 0, 'net', 30, 1000)",
            [],
        )
        .unwrap();

        // 2. Seed vendor vnd_002 (month_end 15)
        conn.execute(
            "INSERT INTO partners (id, tenant_id, name, is_vendor, is_customer, payment_terms_type, payment_terms_days, created_at)
             VALUES ('vnd_002', 'tnt_test', '測試供應商 B (Month End 15)', 1, 0, 'month_end', 15, 1000)",
            [],
        )
        .unwrap();

        // 3. Seed vendor vnd_unconfigured (no terms)
        conn.execute(
            "INSERT INTO partners (id, tenant_id, name, is_vendor, is_customer, payment_terms_type, payment_terms_days, created_at)
             VALUES ('vnd_unconf', 'tnt_test', '無付款條件供應商', 1, 0, NULL, NULL, 1000)",
            [],
        )
        .unwrap();

        // 4. Seed non-vendor customer
        conn.execute(
            "INSERT INTO partners (id, tenant_id, name, is_vendor, is_customer, created_at)
             VALUES ('cus_001', 'tnt_test', '純客戶', 0, 1, 1000)",
            [],
        )
        .unwrap();

        // 5. Seed other tenant vendor
        conn.execute(
            "INSERT INTO partners (id, tenant_id, name, is_vendor, is_customer, created_at)
             VALUES ('vnd_other', 'tnt_other', '其他租戶供應商', 1, 0, 1000)",
            [],
        )
        .unwrap();

        // Helper to seed a PO with lines
        // PO 1: vnd_001, status received, 2 lines:
        // line 1: qty 10, rec_qty 10, cost 100 -> 1000
        // line 2: qty 5, rec_qty 5, cost 200 -> 1000. Total = 2000
        seed_po(
            &conn,
            "tnt_test",
            "po_001",
            "PO-00001",
            "vnd_001",
            "received",
            vec![(10.0, Some(10.0), 100.0), (5.0, Some(5.0), 200.0)],
        );

        // PO 2: vnd_001, status received, 1 line:
        // line 1: qty 20, rec_qty 15 (short shipment), cost 100 -> 1500
        seed_po(
            &conn,
            "tnt_test",
            "po_002",
            "PO-00002",
            "vnd_001",
            "received",
            vec![(20.0, Some(15.0), 100.0)],
        );

        // PO 3: vnd_001, status received, 1 line with NULL rec_qty:
        // line 1: qty 8, rec_qty NULL, cost 50 -> 400
        seed_po(
            &conn,
            "tnt_test",
            "po_003",
            "PO-00003",
            "vnd_001",
            "received",
            vec![(8.0, None, 50.0)],
        );

        // PO 4: vnd_001, status ordered (not received)
        seed_po(
            &conn,
            "tnt_test",
            "po_004",
            "PO-00004",
            "vnd_001",
            "ordered",
            vec![(10.0, None, 100.0)],
        );

        // PO 5: vnd_002, status received: qty 10, rec_qty 10, cost 300 -> 3000
        seed_po(
            &conn,
            "tnt_test",
            "po_005",
            "PO-00005",
            "vnd_002",
            "received",
            vec![(10.0, Some(10.0), 300.0)],
        );

        // PO 6: tnt_other
        seed_po(
            &conn,
            "tnt_other",
            "po_other",
            "PO-00001",
            "vnd_other",
            "received",
            vec![(10.0, Some(10.0), 100.0)],
        );

        conn
    }

    fn seed_po(
        conn: &Connection,
        tenant_id: &str,
        po_id: &str,
        po_number: &str,
        vendor_id: &str,
        status: &str,
        lines: Vec<(f64, Option<f64>, f64)>,
    ) {
        conn.execute(
            "INSERT INTO purchase_orders (id, tenant_id, po_number, vendor_partner_id, vendor_name_snapshot, currency, status, created_by, created_at, received_at)
             VALUES (?1, ?2, ?3, ?4, 'Vendor Snapshot', 'TWD', ?5, 'usr_test', 1000, 1050)",
            params![po_id, tenant_id, po_number, vendor_id, status],
        )
        .unwrap();

        for (idx, (qty, rec_qty, cost)) in lines.into_iter().enumerate() {
            let line_id = format!("pol_{}_{}", po_id, idx + 1);
            conn.execute(
                "INSERT INTO purchase_order_lines (id, purchase_order_id, line_no, unit_id, product_name_snapshot, variant_name_snapshot, unit_name_snapshot, quantity, received_quantity, purchase_cost, created_at)
                 VALUES (?1, ?2, ?3, 'unit_test', 'Product', 'Variant', '件', ?4, ?5, ?6, 1000)",
                params![line_id, po_id, idx + 1, qty, rec_qty, cost],
            )
            .unwrap();
        }
    }

    #[test]
    fn test_tc_vb_n_01_create_bill_success_with_manual_due_date() {
        // Given: Valid vendor and manual due_date >= bill_date
        let mut conn = setup_test_db();
        let today = get_today_local(&conn).unwrap();
        let input = CreateVendorBillInput {
            vendor_partner_id: "vnd_001".to_string(),
            vendor_invoice_number: "INV-2026-001".to_string(),
            bill_date: today.clone(),
            due_date: Some("2026-12-31".to_string()),
            untaxed_amount: 2000.0,
            tax_amount: 100.0,
            note: Some("手動輸入到期日".to_string()),
        };

        // When: Creating vendor bill
        let detail = create_vendor_bill_impl(&mut conn, "tnt_test", "usr_admin", input).unwrap();

        // Then: Draft bill is created with BILL-00001, total_amount = 2100.0
        assert_eq!(detail.bill.bill_number, "BILL-00001");
        assert_eq!(detail.bill.status, "draft");
        assert_eq!(detail.bill.vendor_partner_id, "vnd_001");
        assert_eq!(detail.bill.vendor_invoice_number, "INV-2026-001");
        assert_eq!(detail.bill.untaxed_amount, 2000.0);
        assert_eq!(detail.bill.tax_amount, 100.0);
        assert_eq!(detail.bill.total_amount, 2100.0);
        assert_eq!(detail.bill.due_date, "2026-12-31");
        assert_eq!(detail.orders.len(), 0);
    }

    #[test]
    fn test_tc_vb_n_02_to_04_payment_terms_due_date_calculation() {
        // Given: Vendors with net 30, month_end 15, and unconfigured terms
        let mut conn = setup_test_db();

        // TC-VB-N-02: vnd_001 has net 30
        // When: bill_date = "2026-01-10" without due_date
        let b1 = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-NET30".to_string(),
                bill_date: "2026-01-10".to_string(),
                due_date: None,
                untaxed_amount: 1000.0,
                tax_amount: 50.0,
                note: None,
            },
        )
        .unwrap();
        // Then: 2026-01-10 + 30 days = 2026-02-09
        assert_eq!(b1.bill.due_date, "2026-02-09");

        // TC-VB-N-03: vnd_002 has month_end 15
        // When: bill_date = "2026-01-10" without due_date
        let b2 = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_002".to_string(),
                vendor_invoice_number: "INV-ME15".to_string(),
                bill_date: "2026-01-10".to_string(),
                due_date: None,
                untaxed_amount: 3000.0,
                tax_amount: 150.0,
                note: None,
            },
        )
        .unwrap();
        // Then: 2026-01-31 + 15 days = 2026-02-15
        assert_eq!(b2.bill.due_date, "2026-02-15");

        // TC-VB-N-04: vnd_unconf has no terms
        // When: bill_date = "2026-01-10" without due_date
        let b3 = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_unconf".to_string(),
                vendor_invoice_number: "INV-UNCONF".to_string(),
                bill_date: "2026-01-10".to_string(),
                due_date: None,
                untaxed_amount: 500.0,
                tax_amount: 25.0,
                note: None,
            },
        )
        .unwrap();
        // Then: due_date = bill_date = 2026-01-10
        assert_eq!(b3.bill.due_date, "2026-01-10");
    }

    #[test]
    fn test_tc_vb_n_05_update_vendor_bill_header() {
        // Given: A draft bill
        let mut conn = setup_test_db();
        let created = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-UPD-ORIG".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 1000.0,
                tax_amount: 50.0,
                note: None,
            },
        )
        .unwrap();

        // When: Updating header in draft status
        let updated = update_vendor_bill_header_impl(
            &mut conn,
            "tnt_test",
            UpdateVendorBillHeaderInput {
                bill_id: created.bill.id.clone(),
                vendor_invoice_number: "INV-UPD-NEW".to_string(),
                bill_date: "2026-01-05".to_string(),
                due_date: "2026-02-28".to_string(),
                untaxed_amount: 1500.0,
                tax_amount: 75.0,
                note: Some("更新後備註".to_string()),
            },
        )
        .unwrap();

        // Then: Header fields updated successfully, total_amount re-derived
        assert_eq!(updated.bill.vendor_invoice_number, "INV-UPD-NEW");
        assert_eq!(updated.bill.bill_date, "2026-01-05");
        assert_eq!(updated.bill.due_date, "2026-02-28");
        assert_eq!(updated.bill.untaxed_amount, 1500.0);
        assert_eq!(updated.bill.tax_amount, 75.0);
        assert_eq!(updated.bill.total_amount, 1575.0);
        assert_eq!(updated.bill.note, Some("更新後備註".to_string()));
    }

    #[test]
    fn test_tc_vb_n_06_and_07_add_and_remove_purchase_order() {
        // Given: A draft bill and received POs
        let mut conn = setup_test_db();
        let bill = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-PO-TEST".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 2000.0,
                tax_amount: 100.0,
                note: None,
            },
        )
        .unwrap();

        // When: Adding po_001 to the bill
        let with_po =
            add_vendor_bill_order_impl(&mut conn, "tnt_test", &bill.bill.id, "po_001").unwrap();

        // Then: po_001 is included, received_total_amount = 2000.0
        assert_eq!(with_po.orders.len(), 1);
        assert_eq!(with_po.orders[0].purchase_order_id, "po_001");
        assert_eq!(with_po.orders[0].po_number_snapshot, "PO-00001");
        assert_eq!(with_po.orders[0].received_total_amount, 2000.0);

        // When: Removing po_001
        let without_po =
            remove_vendor_bill_order_impl(&mut conn, "tnt_test", &bill.bill.id, "po_001").unwrap();

        // Then: orders list is empty again
        assert_eq!(without_po.orders.len(), 0);
    }

    #[test]
    fn test_tc_vb_n_08_post_bill_exact_match() {
        // Given: Draft bill with untaxed = 2000.0 and po_001 (basis = 2000.0) -> diff = 0.0
        let mut conn = setup_test_db();
        let bill = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-MATCH".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 2000.0,
                tax_amount: 100.0,
                note: None,
            },
        )
        .unwrap();
        add_vendor_bill_order_impl(&mut conn, "tnt_test", &bill.bill.id, "po_001").unwrap();

        // When: Posting the bill
        let posted =
            post_vendor_bill_impl(&mut conn, "tnt_test", "usr_admin", &bill.bill.id).unwrap();

        // Then: Status is posted, basis_amount = 2000.0, difference = 0.0, posted_at is set
        assert_eq!(posted.bill.status, "posted");
        assert_eq!(posted.bill.basis_amount, Some(2000.0));
        assert_eq!(posted.bill.difference_amount, Some(0.0));
        assert!(posted.bill.posted_at.is_some());

        // And: accounts_payable record is created in the same transaction
        let ap_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM accounts_payable WHERE tenant_id = 'tnt_test' AND source_type = 'vendor_bill' AND source_id = ?1 AND status = 'open'",
            params![bill.bill.id],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(ap_count, 1);

        // Verify AP details
        let (amount, ext_ref, doc_date, due_date): (f64, Option<String>, String, String) = conn.query_row(
            "SELECT amount, external_reference, document_date, due_date FROM accounts_payable WHERE source_id = ?1",
            params![bill.bill.id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        ).unwrap();
        assert_eq!(amount, 2100.0); // total_amount = 2000 + 100
        assert_eq!(ext_ref, Some("INV-MATCH".to_string()));
        assert_eq!(doc_date, "2026-01-01");
        assert_eq!(due_date, "2026-01-31");
    }

    #[test]
    fn test_tc_vb_n_09_and_10_tolerance_boundary_within_1_yuan_posted() {
        // Given: PO basis = 2000.0
        let mut conn = setup_test_db();

        // TC-VB-N-09: diff = +0.99 (untaxed = 2000.99)
        let b1 = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-DIFF-POS-099".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 2000.99,
                tax_amount: 100.0,
                note: None,
            },
        )
        .unwrap();
        add_vendor_bill_order_impl(&mut conn, "tnt_test", &b1.bill.id, "po_001").unwrap();
        let posted1 =
            post_vendor_bill_impl(&mut conn, "tnt_test", "usr_admin", &b1.bill.id).unwrap();
        // Then: |diff| = 0.99 < 1.0 -> posted!
        assert_eq!(posted1.bill.status, "posted");
        assert_eq!(posted1.bill.difference_amount, Some(0.99));

        // TC-VB-N-10: diff = -0.99 (untaxed = 1499.01 on po_002 basis 1500.0)
        let b2 = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-DIFF-NEG-099".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 1499.01,
                tax_amount: 75.0,
                note: None,
            },
        )
        .unwrap();
        add_vendor_bill_order_impl(&mut conn, "tnt_test", &b2.bill.id, "po_002").unwrap();
        let posted2 =
            post_vendor_bill_impl(&mut conn, "tnt_test", "usr_admin", &b2.bill.id).unwrap();
        // Then: |diff| = 0.99 < 1.0 -> posted!
        assert_eq!(posted2.bill.status, "posted");
        assert_eq!(posted2.bill.difference_amount, Some(-0.99));
    }

    #[test]
    fn test_tc_vb_n_11_and_12_tolerance_boundary_1_yuan_disputed() {
        // Given: PO basis = 2000.0
        let mut conn = setup_test_db();

        // TC-VB-N-11: diff = +1.00 (untaxed = 2001.00)
        let b1 = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-DIFF-POS-100".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 2001.00,
                tax_amount: 100.0,
                note: None,
            },
        )
        .unwrap();
        add_vendor_bill_order_impl(&mut conn, "tnt_test", &b1.bill.id, "po_001").unwrap();
        let disp1 = post_vendor_bill_impl(&mut conn, "tnt_test", "usr_admin", &b1.bill.id).unwrap();
        // Then: |diff| = 1.00 >= 1.0 -> disputed! No AP created
        assert_eq!(disp1.bill.status, "disputed");
        assert_eq!(disp1.bill.basis_amount, Some(2000.0));
        assert_eq!(disp1.bill.difference_amount, Some(1.00));
        assert!(disp1.bill.posted_at.is_none());

        let ap_count1: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM accounts_payable WHERE source_id = ?1",
                params![b1.bill.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(ap_count1, 0);

        // TC-VB-N-12: diff = -1.00 (untaxed = 1499.00 on po_002 basis 1500.0)
        let b2 = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-DIFF-NEG-100".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 1499.00,
                tax_amount: 75.0,
                note: None,
            },
        )
        .unwrap();
        add_vendor_bill_order_impl(&mut conn, "tnt_test", &b2.bill.id, "po_002").unwrap();
        let disp2 = post_vendor_bill_impl(&mut conn, "tnt_test", "usr_admin", &b2.bill.id).unwrap();
        // Then: |diff| = 1.00 >= 1.0 -> disputed!
        assert_eq!(disp2.bill.status, "disputed");
        assert_eq!(disp2.bill.difference_amount, Some(-1.00));
    }

    #[test]
    fn test_tc_vb_n_13_accept_difference_disputed_to_posted() {
        // Given: Disputed bill with diff = 100.0
        let mut conn = setup_test_db();
        let b = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-ACCEPT-DIFF".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 2100.0,
                tax_amount: 105.0,
                note: None,
            },
        )
        .unwrap();
        add_vendor_bill_order_impl(&mut conn, "tnt_test", &b.bill.id, "po_001").unwrap();
        let disputed =
            post_vendor_bill_impl(&mut conn, "tnt_test", "usr_admin", &b.bill.id).unwrap();
        assert_eq!(disputed.bill.status, "disputed");

        // When: Accepting difference with note
        let accepted = accept_vendor_bill_difference_impl(
            &mut conn,
            "tnt_test",
            "usr_finance",
            &b.bill.id,
            "運費與包材差額，主管核准同意吸收",
        )
        .unwrap();

        // Then: Bill status transitions to posted, records accepted_by and note, creates AP
        assert_eq!(accepted.bill.status, "posted");
        assert_eq!(
            accepted.bill.difference_note,
            Some("運費與包材差額，主管核准同意吸收".to_string())
        );
        assert_eq!(
            accepted.bill.difference_accepted_by,
            Some("usr_finance".to_string())
        );
        assert!(accepted.bill.difference_accepted_at.is_some());
        assert!(accepted.bill.posted_at.is_some());

        // Verify AP created with amount = 2100 + 105 = 2205.0
        let ap_amount: f64 = conn
            .query_row(
                "SELECT amount FROM accounts_payable WHERE source_id = ?1",
                params![b.bill.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(ap_amount, 2205.0);
    }

    #[test]
    fn test_tc_vb_n_14_return_disputed_to_draft() {
        // Given: Disputed bill
        let mut conn = setup_test_db();
        let b = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-RETURN-DRAFT".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 2500.0,
                tax_amount: 125.0,
                note: None,
            },
        )
        .unwrap();
        add_vendor_bill_order_impl(&mut conn, "tnt_test", &b.bill.id, "po_001").unwrap();
        let disp = post_vendor_bill_impl(&mut conn, "tnt_test", "usr_admin", &b.bill.id).unwrap();
        assert_eq!(disp.bill.status, "disputed");

        // When: Returning to draft
        let ret = return_vendor_bill_to_draft_impl(&mut conn, "tnt_test", &b.bill.id).unwrap();

        // Then: Status is draft, basis and difference snapshots are cleared
        assert_eq!(ret.bill.status, "draft");
        assert_eq!(ret.bill.basis_amount, None);
        assert_eq!(ret.bill.difference_amount, None);
        assert_eq!(ret.bill.difference_note, None);
        assert_eq!(ret.bill.difference_accepted_by, None);
        assert_eq!(ret.bill.difference_accepted_at, None);
    }

    #[test]
    fn test_tc_vb_n_15_and_16_cancel_draft_and_disputed() {
        // Given: Draft and Disputed bills
        let mut conn = setup_test_db();

        // TC-VB-N-15: Cancel draft
        let b1 = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-CANCEL-1".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 1000.0,
                tax_amount: 50.0,
                note: None,
            },
        )
        .unwrap();
        let c1 = cancel_vendor_bill_impl(&mut conn, "tnt_test", &b1.bill.id).unwrap();
        assert_eq!(c1.bill.status, "cancelled");
        assert!(c1.bill.cancelled_at.is_some());

        // TC-VB-N-16: Cancel disputed
        let b2 = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-CANCEL-2".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 5000.0,
                tax_amount: 250.0,
                note: None,
            },
        )
        .unwrap();
        add_vendor_bill_order_impl(&mut conn, "tnt_test", &b2.bill.id, "po_001").unwrap();
        post_vendor_bill_impl(&mut conn, "tnt_test", "usr_admin", &b2.bill.id).unwrap();
        let c2 = cancel_vendor_bill_impl(&mut conn, "tnt_test", &b2.bill.id).unwrap();
        assert_eq!(c2.bill.status, "cancelled");
        assert!(c2.bill.cancelled_at.is_some());
    }

    #[test]
    fn test_tc_vb_n_17_and_18_void_posted_bill_and_release_po() {
        // Given: Posted bill covering po_001
        let mut conn = setup_test_db();
        let b = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-VOID-TEST".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 2000.0,
                tax_amount: 100.0,
                note: None,
            },
        )
        .unwrap();
        add_vendor_bill_order_impl(&mut conn, "tnt_test", &b.bill.id, "po_001").unwrap();
        post_vendor_bill_impl(&mut conn, "tnt_test", "usr_admin", &b.bill.id).unwrap();

        // When: Voiding the posted bill with a valid reason
        let voided = void_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_manager",
            &b.bill.id,
            "發票開立錯誤，作廢重開",
        )
        .unwrap();

        // Then: Bill is voided, records voided_by/at/reason
        assert_eq!(voided.bill.status, "voided");
        assert_eq!(voided.bill.voided_by, Some("usr_manager".to_string()));
        assert!(voided.bill.voided_at.is_some());
        assert_eq!(
            voided.bill.void_reason,
            Some("發票開立錯誤，作廢重開".to_string())
        );

        // And: accounts_payable record is also voided
        let ap_status: String = conn
            .query_row(
                "SELECT status FROM accounts_payable WHERE source_id = ?1",
                params![b.bill.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(ap_status, "voided");

        // TC-VB-N-18: po_001 is released and can be added to a new bill
        let new_bill = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-REUSE-PO".to_string(),
                bill_date: "2026-01-02".to_string(),
                due_date: Some("2026-02-01".to_string()),
                untaxed_amount: 2000.0,
                tax_amount: 100.0,
                note: None,
            },
        )
        .unwrap();
        let add_res =
            add_vendor_bill_order_impl(&mut conn, "tnt_test", &new_bill.bill.id, "po_001");
        assert!(
            add_res.is_ok(),
            "Released PO should be addable to a new bill"
        );
    }

    #[test]
    fn test_tc_vb_n_19_and_20_invoice_number_release_and_vendor_independence() {
        // Given: An invoice number used by a bill that is subsequently voided
        let mut conn = setup_test_db();
        let b1 = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-SHARED-001".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 2000.0,
                tax_amount: 100.0,
                note: None,
            },
        )
        .unwrap();
        add_vendor_bill_order_impl(&mut conn, "tnt_test", &b1.bill.id, "po_001").unwrap();
        post_vendor_bill_impl(&mut conn, "tnt_test", "usr_admin", &b1.bill.id).unwrap();
        void_vendor_bill_impl(&mut conn, "tnt_test", "usr_admin", &b1.bill.id, "voiding").unwrap();

        // TC-VB-N-19: Same vendor reuses the invoice number after void
        let b1_reuse = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-SHARED-001".to_string(),
                bill_date: "2026-01-02".to_string(),
                due_date: Some("2026-02-01".to_string()),
                untaxed_amount: 2000.0,
                tax_amount: 100.0,
                note: None,
            },
        );
        assert!(
            b1_reuse.is_ok(),
            "Invoice number can be reused after bill voided"
        );

        // TC-VB-N-20: Different vendor uses the exact same invoice number
        let b2_diff_vendor = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_002".to_string(),
                vendor_invoice_number: "INV-SHARED-001".to_string(),
                bill_date: "2026-01-02".to_string(),
                due_date: Some("2026-02-01".to_string()),
                untaxed_amount: 3000.0,
                tax_amount: 150.0,
                note: None,
            },
        );
        assert!(
            b2_diff_vendor.is_ok(),
            "Different vendor can have identical invoice number"
        );
    }

    #[test]
    fn test_tc_vb_n_21_and_22_basis_calculations_partial_and_null_received_qty() {
        // Given: po_002 with received_quantity 15 < quantity 20, cost 100 -> basis 1500.0
        // And: po_003 with received_quantity NULL, quantity 8, cost 50 -> basis 400.0
        let mut conn = setup_test_db();

        // TC-VB-N-21: Partial delivery basis
        let b1 = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-PARTIAL".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 1500.0, // exactly matches 15 * 100 = 1500
                tax_amount: 75.0,
                note: None,
            },
        )
        .unwrap();
        add_vendor_bill_order_impl(&mut conn, "tnt_test", &b1.bill.id, "po_002").unwrap();
        let posted1 =
            post_vendor_bill_impl(&mut conn, "tnt_test", "usr_admin", &b1.bill.id).unwrap();
        assert_eq!(posted1.bill.status, "posted");
        assert_eq!(posted1.bill.basis_amount, Some(1500.0));

        // TC-VB-N-22: NULL received_quantity defaults to quantity (8 * 50 = 400)
        let b2 = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-NULL-REC".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 400.0,
                tax_amount: 20.0,
                note: None,
            },
        )
        .unwrap();
        add_vendor_bill_order_impl(&mut conn, "tnt_test", &b2.bill.id, "po_003").unwrap();
        let posted2 =
            post_vendor_bill_impl(&mut conn, "tnt_test", "usr_admin", &b2.bill.id).unwrap();
        assert_eq!(posted2.bill.status, "posted");
        assert_eq!(posted2.bill.basis_amount, Some(400.0));
    }

    #[test]
    fn test_tc_vb_n_23_to_25_queries_list_unbilled_and_filters() {
        // Given: Seeded orders and a posted bill covering po_001
        let mut conn = setup_test_db();
        let b = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-QUERY".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 2000.0,
                tax_amount: 100.0,
                note: None,
            },
        )
        .unwrap();
        add_vendor_bill_order_impl(&mut conn, "tnt_test", &b.bill.id, "po_001").unwrap();
        post_vendor_bill_impl(&mut conn, "tnt_test", "usr_admin", &b.bill.id).unwrap();

        // TC-VB-N-23: list_unbilled_received_orders for vnd_001
        // Should return po_002 and po_003 (po_001 is covered, po_004 is ordered)
        let unbilled =
            list_unbilled_received_orders_impl(&conn, "tnt_test", Some("vnd_001".to_string()))
                .unwrap();
        assert_eq!(unbilled.len(), 2);
        let ids: Vec<String> = unbilled
            .iter()
            .map(|u| u.purchase_order_id.clone())
            .collect();
        assert!(ids.contains(&"po_002".to_string()));
        assert!(ids.contains(&"po_003".to_string()));
        assert!(!ids.contains(&"po_001".to_string()));

        // TC-VB-N-24: list_vendor_bills with filter
        let list_all =
            list_vendor_bills_impl(&conn, "tnt_test", ListVendorBillsFilter::default()).unwrap();
        assert_eq!(list_all.len(), 1);
        assert_eq!(list_all[0].order_count, 1);

        let list_posted = list_vendor_bills_impl(
            &conn,
            "tnt_test",
            ListVendorBillsFilter {
                vendor_partner_id: Some("vnd_001".to_string()),
                status: Some("posted".to_string()),
            },
        )
        .unwrap();
        assert_eq!(list_posted.len(), 1);

        let list_draft = list_vendor_bills_impl(
            &conn,
            "tnt_test",
            ListVendorBillsFilter {
                vendor_partner_id: Some("vnd_001".to_string()),
                status: Some("draft".to_string()),
            },
        )
        .unwrap();
        assert_eq!(list_draft.len(), 0);

        // TC-VB-N-25: get_vendor_bill detail
        let detail = get_vendor_bill_impl(&conn, "tnt_test", &b.bill.id).unwrap();
        assert_eq!(detail.bill.bill_number, "BILL-00001");
        assert_eq!(detail.bill.total_amount, 2100.0);
        assert_eq!(detail.orders.len(), 1);
        assert_eq!(detail.orders[0].purchase_order_id, "po_001");
    }

    // ==========================================
    // Error & Boundary Tests (TC-VB-E-01 to E-28, SEC-01)
    // ==========================================

    #[test]
    fn test_tc_vb_e_01_empty_tenant_id() {
        // Given: Empty tenant_id
        let mut conn = setup_test_db();
        let input = CreateVendorBillInput {
            vendor_partner_id: "vnd_001".to_string(),
            vendor_invoice_number: "INV-ERR".to_string(),
            bill_date: "2026-01-01".to_string(),
            due_date: Some("2026-01-31".to_string()),
            untaxed_amount: 1000.0,
            tax_amount: 50.0,
            note: None,
        };

        // When: Creating with empty tenant_id
        let res = create_vendor_bill_impl(&mut conn, "", "usr_admin", input);

        // Then: Fails with EmptyTenantId
        assert_eq!(res.unwrap_err(), VendorBillError::EmptyTenantId);
    }

    #[test]
    fn test_tc_vb_e_02_non_vendor_or_nonexistent_partner() {
        // Given: Nonexistent partner and non-vendor partner (cus_001)
        let mut conn = setup_test_db();

        // When: Nonexistent partner
        let res1 = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_ghost".to_string(),
                vendor_invoice_number: "INV-GHOST".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 1000.0,
                tax_amount: 50.0,
                note: None,
            },
        );
        // Then: Fails with VendorNotFound
        assert_eq!(res1.unwrap_err(), VendorBillError::VendorNotFound);

        // When: Non-vendor customer
        let res2 = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "cus_001".to_string(),
                vendor_invoice_number: "INV-CUS".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 1000.0,
                tax_amount: 50.0,
                note: None,
            },
        );
        // Then: Fails with PartnerNotVendor
        assert_eq!(res2.unwrap_err(), VendorBillError::PartnerNotVendor);
    }

    #[test]
    fn test_tc_vb_e_03_empty_invoice_number() {
        // Given: Empty or whitespace-only invoice number
        let mut conn = setup_test_db();
        let res = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "   ".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 1000.0,
                tax_amount: 50.0,
                note: None,
            },
        );
        // Then: Fails with EmptyVendorInvoiceNumber
        assert_eq!(res.unwrap_err(), VendorBillError::EmptyVendorInvoiceNumber);
    }

    #[test]
    fn test_tc_vb_e_04_and_05_duplicate_invoice_number_trim_and_case() {
        // Given: An existing active bill with invoice "inv-dup-100"
        let mut conn = setup_test_db();
        create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-DUP-100".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 1000.0,
                tax_amount: 50.0,
                note: None,
            },
        )
        .unwrap();

        // TC-VB-E-04: Same exact invoice number
        let res1 = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-DUP-100".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 1000.0,
                tax_amount: 50.0,
                note: None,
            },
        );
        assert_eq!(
            res1.unwrap_err(),
            VendorBillError::DuplicateVendorInvoiceNumber(
                "INV-DUP-100".to_string(),
                "BILL-00001".to_string()
            )
        );

        // TC-VB-E-05: Case-insensitive and trimmed duplicate
        let res2 = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "  inv-dup-100  ".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 1000.0,
                tax_amount: 50.0,
                note: None,
            },
        );
        assert_eq!(
            res2.unwrap_err(),
            VendorBillError::DuplicateVendorInvoiceNumber(
                "inv-dup-100".to_string(),
                "BILL-00001".to_string()
            )
        );
    }

    #[test]
    fn test_tc_vb_e_06_to_08_and_b01_amounts_validation() {
        let mut conn = setup_test_db();

        // TC-VB-E-06: untaxed = 0.0 -> rejected
        let res0 = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-AMT-0".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 0.0,
                tax_amount: 50.0,
                note: None,
            },
        );
        assert_eq!(res0.unwrap_err(), VendorBillError::InvalidUntaxedAmount);

        // TC-VB-E-07: untaxed < 0.0 -> rejected
        let res_neg = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-AMT-NEG".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: -100.0,
                tax_amount: 50.0,
                note: None,
            },
        );
        assert_eq!(res_neg.unwrap_err(), VendorBillError::InvalidUntaxedAmount);

        // TC-VB-E-08: tax < 0.0 -> rejected
        let res_tax_neg = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-TAX-NEG".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 1000.0,
                tax_amount: -1.0,
                note: None,
            },
        );
        assert_eq!(res_tax_neg.unwrap_err(), VendorBillError::InvalidTaxAmount);

        // TC-VB-B-01: tax = 0.0 -> allowed
        let res_tax_0 = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-TAX-0".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 1000.0,
                tax_amount: 0.0,
                note: None,
            },
        );
        assert!(res_tax_0.is_ok());
    }

    #[test]
    fn test_tc_vb_e_09_to_10_and_b02_b03_date_boundaries() {
        let mut conn = setup_test_db();
        let today = get_today_local(&conn).unwrap();
        let (y, m, d) = parse_date(&today).unwrap();
        let (ty, tm, td) = add_days(y, m, d, 1);
        let tomorrow = format_date(ty, tm, td);

        // TC-VB-E-09: bill_date tomorrow -> rejected
        let res_tomorrow = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-TOMORROW".to_string(),
                bill_date: tomorrow,
                due_date: None,
                untaxed_amount: 1000.0,
                tax_amount: 50.0,
                note: None,
            },
        );
        assert_eq!(
            res_tomorrow.unwrap_err(),
            VendorBillError::BillDateCannotBeInFuture
        );

        // TC-VB-B-02: bill_date today -> allowed
        let res_today = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-TODAY".to_string(),
                bill_date: today.clone(),
                due_date: None,
                untaxed_amount: 1000.0,
                tax_amount: 50.0,
                note: None,
            },
        );
        assert!(res_today.is_ok());

        // TC-VB-E-10: due_date earlier than bill_date -> rejected
        let res_due_early = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-DUE-EARLY".to_string(),
                bill_date: "2026-01-15".to_string(),
                due_date: Some("2026-01-14".to_string()),
                untaxed_amount: 1000.0,
                tax_amount: 50.0,
                note: None,
            },
        );
        assert_eq!(
            res_due_early.unwrap_err(),
            VendorBillError::DueDateEarlierThanBillDate
        );

        // TC-VB-B-03: due_date == bill_date -> allowed
        let res_due_same = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-DUE-SAME".to_string(),
                bill_date: "2026-01-15".to_string(),
                due_date: Some("2026-01-15".to_string()),
                untaxed_amount: 1000.0,
                tax_amount: 50.0,
                note: None,
            },
        );
        assert!(res_due_same.is_ok());
    }

    #[test]
    fn test_tc_vb_e_11_to_15_add_po_validations() {
        let mut conn = setup_test_db();
        let b = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-ADD-PO".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 2000.0,
                tax_amount: 100.0,
                note: None,
            },
        )
        .unwrap();

        // TC-VB-E-11: Cross-tenant PO (po_other)
        let res_cross = add_vendor_bill_order_impl(&mut conn, "tnt_test", &b.bill.id, "po_other");
        assert_eq!(res_cross.unwrap_err(), VendorBillError::InvalidOrderForBill);

        // TC-VB-E-12: Non-received PO status (po_004 is ordered)
        let res_not_rec = add_vendor_bill_order_impl(&mut conn, "tnt_test", &b.bill.id, "po_004");
        assert_eq!(
            res_not_rec.unwrap_err(),
            VendorBillError::InvalidOrderForBill
        );

        // TC-VB-E-13: Different vendor (po_005 belongs to vnd_002)
        let res_diff_vnd = add_vendor_bill_order_impl(&mut conn, "tnt_test", &b.bill.id, "po_005");
        assert_eq!(
            res_diff_vnd.unwrap_err(),
            VendorBillError::InvalidOrderForBill
        );

        // TC-VB-E-15: Adding same PO twice
        add_vendor_bill_order_impl(&mut conn, "tnt_test", &b.bill.id, "po_001").unwrap();
        let res_twice = add_vendor_bill_order_impl(&mut conn, "tnt_test", &b.bill.id, "po_001");
        assert_eq!(
            res_twice.unwrap_err(),
            VendorBillError::OrderAlreadyCoveredInBill(
                "PO-00001".to_string(),
                "BILL-00001".to_string()
            )
        );

        // TC-VB-E-14: PO covered in another active bill
        let b2 = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-ADD-PO-2".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 2000.0,
                tax_amount: 100.0,
                note: None,
            },
        )
        .unwrap();
        let res_already_covered =
            add_vendor_bill_order_impl(&mut conn, "tnt_test", &b2.bill.id, "po_001");
        assert_eq!(
            res_already_covered.unwrap_err(),
            VendorBillError::OrderAlreadyCoveredInBill(
                "PO-00001".to_string(),
                "BILL-00001".to_string()
            )
        );
    }

    #[test]
    fn test_tc_vb_e_16_and_17_non_draft_modification_blocked() {
        // Given: A posted bill
        let mut conn = setup_test_db();
        let b = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-MOD-POSTED".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 2000.0,
                tax_amount: 100.0,
                note: None,
            },
        )
        .unwrap();
        add_vendor_bill_order_impl(&mut conn, "tnt_test", &b.bill.id, "po_001").unwrap();
        post_vendor_bill_impl(&mut conn, "tnt_test", "usr_admin", &b.bill.id).unwrap();

        // TC-VB-E-16: Modify header on posted bill
        let res_hdr = update_vendor_bill_header_impl(
            &mut conn,
            "tnt_test",
            UpdateVendorBillHeaderInput {
                bill_id: b.bill.id.clone(),
                vendor_invoice_number: "INV-MOD-NEW".to_string(),
                bill_date: "2026-01-02".to_string(),
                due_date: "2026-02-01".to_string(),
                untaxed_amount: 2000.0,
                tax_amount: 100.0,
                note: None,
            },
        );
        assert_eq!(
            res_hdr.unwrap_err(),
            VendorBillError::InvalidStateForModification("posted".to_string())
        );

        // TC-VB-E-17: Add order on posted bill
        let res_add = add_vendor_bill_order_impl(&mut conn, "tnt_test", &b.bill.id, "po_002");
        assert_eq!(
            res_add.unwrap_err(),
            VendorBillError::InvalidStateForModification("posted".to_string())
        );

        // Remove order on posted bill
        let res_rem = remove_vendor_bill_order_impl(&mut conn, "tnt_test", &b.bill.id, "po_001");
        assert_eq!(
            res_rem.unwrap_err(),
            VendorBillError::InvalidStateForModification("posted".to_string())
        );
    }

    #[test]
    fn test_tc_vb_e_18_post_with_zero_orders_rejected() {
        // Given: Bill with 0 covered POs
        let mut conn = setup_test_db();
        let b = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-NO-PO".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 2000.0,
                tax_amount: 100.0,
                note: None,
            },
        )
        .unwrap();

        // When: Posting without orders
        let res = post_vendor_bill_impl(&mut conn, "tnt_test", "usr_admin", &b.bill.id);

        // Then: Fails with NoOrdersCovered
        assert_eq!(res.unwrap_err(), VendorBillError::NoOrdersCovered);
    }

    #[test]
    fn test_tc_vb_e_19_and_20_accept_difference_validations() {
        let mut conn = setup_test_db();
        let b = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-DIFF-VALIDATION".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 2500.0,
                tax_amount: 125.0,
                note: None,
            },
        )
        .unwrap();
        add_vendor_bill_order_impl(&mut conn, "tnt_test", &b.bill.id, "po_001").unwrap();

        // TC-VB-E-19: Accept difference on draft bill (status != disputed)
        let res_draft = accept_vendor_bill_difference_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            &b.bill.id,
            "說明",
        );
        assert_eq!(
            res_draft.unwrap_err(),
            VendorBillError::InvalidStateTransition {
                from: "draft".to_string(),
                to: "posted".to_string(),
            }
        );

        // Transition to disputed
        post_vendor_bill_impl(&mut conn, "tnt_test", "usr_admin", &b.bill.id).unwrap();

        // TC-VB-E-20: Empty difference_note
        let res_empty_note = accept_vendor_bill_difference_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            &b.bill.id,
            "   ",
        );
        assert_eq!(
            res_empty_note.unwrap_err(),
            VendorBillError::DifferenceNoteRequired
        );
    }

    #[test]
    fn test_tc_vb_e_21_to_23_void_and_return_to_draft_validations() {
        let mut conn = setup_test_db();
        let b = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-VOID-VAL".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 2000.0,
                tax_amount: 100.0,
                note: None,
            },
        )
        .unwrap();
        add_vendor_bill_order_impl(&mut conn, "tnt_test", &b.bill.id, "po_001").unwrap();

        // TC-VB-E-21: Return to draft on draft bill
        let res_ret = return_vendor_bill_to_draft_impl(&mut conn, "tnt_test", &b.bill.id);
        assert_eq!(
            res_ret.unwrap_err(),
            VendorBillError::InvalidStateTransition {
                from: "draft".to_string(),
                to: "draft".to_string(),
            }
        );

        // TC-VB-E-22: Void non-posted (draft) bill
        let res_void_draft =
            void_vendor_bill_impl(&mut conn, "tnt_test", "usr_admin", &b.bill.id, "reason");
        assert_eq!(
            res_void_draft.unwrap_err(),
            VendorBillError::InvalidStateTransition {
                from: "draft".to_string(),
                to: "voided".to_string(),
            }
        );

        // Post the bill
        post_vendor_bill_impl(&mut conn, "tnt_test", "usr_admin", &b.bill.id).unwrap();

        // TC-VB-E-23: Void with empty reason
        let res_void_empty =
            void_vendor_bill_impl(&mut conn, "tnt_test", "usr_admin", &b.bill.id, "   ");
        assert_eq!(
            res_void_empty.unwrap_err(),
            VendorBillError::VoidReasonRequired
        );
    }

    #[test]
    fn test_tc_vb_e_24_void_blocked_by_posted_payment_allocations() {
        // Given: Posted bill with associated AP that has a posted payment allocation (AP-04)
        let mut conn = setup_test_db();
        let b = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-PAID-VOID".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 2000.0,
                tax_amount: 100.0,
                note: None,
            },
        )
        .unwrap();
        add_vendor_bill_order_impl(&mut conn, "tnt_test", &b.bill.id, "po_001").unwrap();
        post_vendor_bill_impl(&mut conn, "tnt_test", "usr_admin", &b.bill.id).unwrap();

        let ap_id: String = conn
            .query_row(
                "SELECT id FROM accounts_payable WHERE source_id = ?1",
                params![b.bill.id],
                |r| r.get(0),
            )
            .unwrap();

        // Insert a posted payment and allocation
        conn.execute(
            "INSERT INTO payments (id, tenant_id, payment_number, vendor_partner_id, payment_date, amount, status, created_by, created_at)
             VALUES ('pay_001', 'tnt_test', 'PAY-00001', 'vnd_001', '2026-01-10', 2100.0, 'posted', 'usr_admin', 1000)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO payment_allocations (id, tenant_id, payment_id, account_payable_id, amount, created_at)
             VALUES ('pa_001', 'tnt_test', 'pay_001', ?1, 2100.0, 1000)",
            params![ap_id],
        ).unwrap();

        // When: Attempting to void the bill
        let res = void_vendor_bill_impl(&mut conn, "tnt_test", "usr_admin", &b.bill.id, "作廢理由");

        // Then: Blocked by HasPostedPaymentAllocations
        assert_eq!(
            res.unwrap_err(),
            VendorBillError::HasPostedPaymentAllocations("PAY-00001".to_string())
        );
    }

    #[test]
    fn test_tc_vb_e_25_and_26_cancel_posted_and_double_post() {
        // Given: Posted bill
        let mut conn = setup_test_db();
        let b = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-DOUBLE-POST".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 2000.0,
                tax_amount: 100.0,
                note: None,
            },
        )
        .unwrap();
        add_vendor_bill_order_impl(&mut conn, "tnt_test", &b.bill.id, "po_001").unwrap();
        post_vendor_bill_impl(&mut conn, "tnt_test", "usr_admin", &b.bill.id).unwrap();

        // TC-VB-E-25: Cancel posted bill rejected
        let res_cancel = cancel_vendor_bill_impl(&mut conn, "tnt_test", &b.bill.id);
        assert_eq!(
            res_cancel.unwrap_err(),
            VendorBillError::InvalidStateTransition {
                from: "posted".to_string(),
                to: "cancelled".to_string(),
            }
        );

        // TC-VB-E-26: Double post (consecutive post) rejected
        let res_double = post_vendor_bill_impl(&mut conn, "tnt_test", "usr_admin", &b.bill.id);
        assert_eq!(
            res_double.unwrap_err(),
            VendorBillError::InvalidStateTransition {
                from: "posted".to_string(),
                to: "posted".to_string(),
            }
        );
    }

    #[test]
    fn test_tc_vb_e_27_illegal_transitions() {
        // Given: Various states
        let mut conn = setup_test_db();
        let b = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-ILLEGAL".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 2000.0,
                tax_amount: 100.0,
                note: None,
            },
        )
        .unwrap();

        // 1. draft -> voided (rejected)
        let res1 = void_vendor_bill_impl(&mut conn, "tnt_test", "usr_admin", &b.bill.id, "reason");
        assert_eq!(
            res1.unwrap_err(),
            VendorBillError::InvalidStateTransition {
                from: "draft".to_string(),
                to: "voided".to_string(),
            }
        );

        // Cancel the draft bill
        cancel_vendor_bill_impl(&mut conn, "tnt_test", &b.bill.id).unwrap();

        // 2. cancelled -> posted (rejected)
        let res2 = post_vendor_bill_impl(&mut conn, "tnt_test", "usr_admin", &b.bill.id);
        assert_eq!(
            res2.unwrap_err(),
            VendorBillError::InvalidStateTransition {
                from: "cancelled".to_string(),
                to: "posted".to_string(),
            }
        );

        // 3. cancelled -> draft (rejected)
        let res3 = return_vendor_bill_to_draft_impl(&mut conn, "tnt_test", &b.bill.id);
        assert_eq!(
            res3.unwrap_err(),
            VendorBillError::InvalidStateTransition {
                from: "cancelled".to_string(),
                to: "draft".to_string(),
            }
        );
    }

    #[test]
    fn test_tc_vb_e_28_atomicity_post_ap_failure_rolls_back() {
        // Given: A draft bill that would match, but we insert a conflicting open AP with same (source_type, source_id)
        let mut conn = setup_test_db();
        let b = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-ATOMIC".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 2000.0,
                tax_amount: 100.0,
                note: None,
            },
        )
        .unwrap();
        add_vendor_bill_order_impl(&mut conn, "tnt_test", &b.bill.id, "po_001").unwrap();

        // Inject existing open AP for this source_id so create_account_payable_in_tx fails with DuplicateOpenSource
        conn.execute(
            "INSERT INTO accounts_payable (
                id, tenant_id, vendor_partner_id, vendor_name_snapshot,
                source_type, source_id, source_number, external_reference,
                document_date, due_date, amount, currency, status, created_by, created_at
            ) VALUES (
                'ap_conflict', 'tnt_test', 'vnd_001', 'Vendor',
                'vendor_bill', ?1, 'BILL-00001', 'REF',
                '2026-01-01', '2026-01-31', 2100.0, 'TWD', 'open', 'usr_admin', 1000
            )",
            params![b.bill.id],
        )
        .unwrap();

        // When: Posting the bill (AP creation will fail)
        let res = post_vendor_bill_impl(&mut conn, "tnt_test", "usr_admin", &b.bill.id);

        // Then: Operation returns error
        assert!(res.is_err());

        // And: Transaction rolled back, bill status is STILL draft!
        let bill_after = get_vendor_bill_impl(&conn, "tnt_test", &b.bill.id).unwrap();
        assert_eq!(bill_after.bill.status, "draft");
        assert_eq!(bill_after.bill.posted_at, None);
    }

    #[test]
    fn test_tc_vb_sec_01_b12_no_inventory_movements_modified() {
        // Given: Starting count of inventory_movements is 0
        let mut conn = setup_test_db();
        let initial_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM inventory_movements", [], |r| r.get(0))
            .unwrap();
        assert_eq!(initial_count, 0);

        // When: Lifecycle operations performed (create, add order, update, post, void)
        let b = create_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorBillInput {
                vendor_partner_id: "vnd_001".to_string(),
                vendor_invoice_number: "INV-NO-INV-MOV".to_string(),
                bill_date: "2026-01-01".to_string(),
                due_date: Some("2026-01-31".to_string()),
                untaxed_amount: 2000.0,
                tax_amount: 100.0,
                note: None,
            },
        )
        .unwrap();
        add_vendor_bill_order_impl(&mut conn, "tnt_test", &b.bill.id, "po_001").unwrap();
        update_vendor_bill_header_impl(
            &mut conn,
            "tnt_test",
            UpdateVendorBillHeaderInput {
                bill_id: b.bill.id.clone(),
                vendor_invoice_number: "INV-NO-INV-MOV".to_string(),
                bill_date: "2026-01-02".to_string(),
                due_date: "2026-02-01".to_string(),
                untaxed_amount: 2000.0,
                tax_amount: 100.0,
                note: None,
            },
        )
        .unwrap();
        post_vendor_bill_impl(&mut conn, "tnt_test", "usr_admin", &b.bill.id).unwrap();
        void_vendor_bill_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            &b.bill.id,
            "test reason",
        )
        .unwrap();

        // Then: inventory_movements count is STILL 0 (B-12)
        let final_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM inventory_movements", [], |r| r.get(0))
            .unwrap();
        assert_eq!(final_count, 0);
    }

    #[test]
    fn test_tc_vb_ensure_guarded_mutation_affected_vendor_bills_whitelisted() {
        // Given: vendor_bills table in DB
        let conn = setup_test_db();

        // When: Invoking ensure_guarded_mutation_affected on vendor_bills with affected = 0 on non-existent row
        let res = crate::ensure_guarded_mutation_affected(
            &conn,
            "vendor_bills",
            "bill_nonexistent",
            "tnt_test",
            0,
            VendorBillError::BillNotFound,
            |_| Ok(()),
        );

        // Then: It does NOT return not_found_err because of unwhitelisted table; it properly queries status and returns BillNotFound
        assert_eq!(res.unwrap_err(), VendorBillError::BillNotFound);
    }
}
