use rusqlite::{params, Connection, Transaction};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static PAYMENT_ID_COUNTER: AtomicU64 = AtomicU64::new(1);
static ALLOC_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

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

fn generate_payment_id(now: i64) -> String {
    format!(
        "pay_{}_{}",
        now,
        PAYMENT_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

fn generate_allocation_id(now: i64) -> String {
    format!(
        "paya_{}_{}",
        now,
        ALLOC_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

// ==========================================
// Errors
// ==========================================

#[derive(Debug, thiserror::Error, PartialEq, Clone)]
pub enum VendorPaymentError {
    #[error("租戶 ID 不可為空")]
    EmptyTenantId,

    #[error("找不到指定的租戶")]
    TenantNotFound,

    #[error("租戶未啟用或已停用")]
    TenantNotActive,

    #[error("無法解析有效使用者 session，操作被拒絕")]
    EmptyUserId,

    #[error("找不到指定的付款單")]
    NotFound,

    #[error("找不到指定的核銷記錄")]
    AllocationNotFound,

    #[error("找不到指定的供應商")]
    VendorNotFound,

    #[error("指定夥伴不是供應商")]
    PartnerNotVendor,

    #[error("指定供應商已停用")]
    VendorInactive,

    #[error("找不到指定的應付帳款")]
    AccountPayableNotFound,

    #[error("付款方式無效，僅支援 bank_transfer、cash、check、other")]
    InvalidPaymentMethod,

    #[error("幣別僅支援 'TWD'")]
    InvalidCurrency,

    #[error("僅能核銷同一供應商的未作廢應付")]
    InvalidAllocationAccountPayable,

    #[error("同一張付款單內同一筆應付只能出現一次")]
    DuplicateAccountPayableAllocation,

    #[error("核銷金額必須大於 0")]
    InvalidAllocationAmount,

    #[error("核銷金額 {0} 超過〔{1}〕未付餘額 {2}")]
    AllocationAmountExceedsOutstanding(String, String, String),

    #[error("付款日不可晚於今天")]
    PaymentDateCannotBeInFuture,

    #[error("付款日不可早於〔{0}〕的單據日")]
    PaymentDateEarlierThanDocumentDate(String),

    #[error("付款單至少需有 1 筆核銷方可過帳")]
    NoAllocationsToPost,

    #[error("〔{0}〕未付餘額已變為 {1}，不足核銷 {2}")]
    InsufficientOutstandingOnPost(String, String, String),

    #[error("付款單狀態為 {0}，不可修改")]
    NotDraftCannotModify(String),

    #[error("作廢需填寫原因")]
    VoidReasonRequired,

    #[error("無效的狀態轉換：不可從 {from} 轉換至 {to}")]
    InvalidStateTransition { from: String, to: String },

    #[error("資料庫錯誤: {0}")]
    DatabaseError(String),
}

impl From<rusqlite::Error> for VendorPaymentError {
    fn from(err: rusqlite::Error) -> Self {
        VendorPaymentError::DatabaseError(err.to_string())
    }
}

// ==========================================
// Domain & Data Models
// ==========================================

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct VendorPayment {
    pub id: String,
    pub tenant_id: String,
    pub payment_number: String,
    pub vendor_partner_id: String,
    pub vendor_name_snapshot: String,
    pub payment_date: String,
    pub payment_method: String,
    pub payment_reference: Option<String>,
    pub note: Option<String>,
    pub currency: String,
    pub status: String,
    pub created_by: String,
    pub created_at: i64,
    pub posted_by: Option<String>,
    pub posted_at: Option<i64>,
    pub cancelled_by: Option<String>,
    pub cancelled_at: Option<i64>,
    pub voided_by: Option<String>,
    pub voided_at: Option<i64>,
    pub void_reason: Option<String>,
    pub task_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct VendorPaymentAllocation {
    pub id: String,
    pub tenant_id: String,
    pub payment_id: String,
    pub account_payable_id: String,
    pub amount: f64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct VendorPaymentAllocationDetail {
    pub id: String,
    pub payment_id: String,
    pub account_payable_id: String,
    pub amount: f64,
    pub created_at: i64,
    pub source_type: String,
    pub source_id: String,
    pub source_number: String,
    pub external_reference: Option<String>,
    pub document_date: String,
    pub due_date: String,
    pub ap_amount: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct VendorPaymentDetail {
    pub id: String,
    pub tenant_id: String,
    pub payment_number: String,
    pub vendor_partner_id: String,
    pub vendor_name_snapshot: String,
    pub payment_date: String,
    pub payment_method: String,
    pub payment_reference: Option<String>,
    pub note: Option<String>,
    pub total_amount: f64,
    pub currency: String,
    pub status: String,
    pub created_by: String,
    pub created_at: i64,
    pub posted_by: Option<String>,
    pub posted_at: Option<i64>,
    pub cancelled_by: Option<String>,
    pub cancelled_at: Option<i64>,
    pub voided_by: Option<String>,
    pub voided_at: Option<i64>,
    pub void_reason: Option<String>,
    pub task_id: Option<String>,
    pub allocations: Vec<VendorPaymentAllocationDetail>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct VendorPaymentItem {
    pub id: String,
    pub tenant_id: String,
    pub payment_number: String,
    pub vendor_partner_id: String,
    pub vendor_name_snapshot: String,
    pub payment_date: String,
    pub payment_method: String,
    pub payment_reference: Option<String>,
    pub note: Option<String>,
    pub total_amount: f64,
    pub currency: String,
    pub status: String,
    pub created_by: String,
    pub created_at: i64,
    pub posted_by: Option<String>,
    pub posted_at: Option<i64>,
    pub cancelled_by: Option<String>,
    pub cancelled_at: Option<i64>,
    pub voided_by: Option<String>,
    pub voided_at: Option<i64>,
    pub void_reason: Option<String>,
    pub task_id: Option<String>,
    pub allocation_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct CreateVendorPaymentInput {
    pub vendor_partner_id: String,
    pub payment_date: String,
    pub payment_method: String,
    pub payment_reference: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct UpdateVendorPaymentHeaderInput {
    pub id: Option<String>,
    pub payment_id: Option<String>,
    pub payment_date: String,
    pub payment_method: String,
    pub payment_reference: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
pub struct ListVendorPaymentsFilter {
    pub vendor_partner_id: Option<String>,
    pub status: Option<String>,
    pub payment_date_from: Option<String>,
    pub payment_date_to: Option<String>,
}

// ==========================================
// Table Schema Initialization
// ==========================================

pub fn create_vendor_payment_tables(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS vendor_payments (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            payment_number TEXT NOT NULL,
            vendor_partner_id TEXT NOT NULL,
            vendor_name_snapshot TEXT NOT NULL,
            payment_date TEXT NOT NULL,
            payment_method TEXT NOT NULL,
            payment_reference TEXT,
            note TEXT,
            currency TEXT NOT NULL DEFAULT 'TWD',
            status TEXT NOT NULL,
            created_by TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            posted_by TEXT,
            posted_at INTEGER,
            cancelled_by TEXT,
            cancelled_at INTEGER,
            voided_by TEXT,
            voided_at INTEGER,
            void_reason TEXT,
            task_id TEXT
        )",
        [],
    )?;

    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_vp_tenant_number ON vendor_payments (tenant_id, payment_number)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_vp_tenant_vendor ON vendor_payments (tenant_id, vendor_partner_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_vp_tenant_date ON vendor_payments (tenant_id, payment_date)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_vp_tenant_status ON vendor_payments (tenant_id, status)",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS vendor_payment_allocations (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            payment_id TEXT NOT NULL,
            account_payable_id TEXT NOT NULL,
            amount REAL NOT NULL,
            created_at INTEGER NOT NULL
        )",
        [],
    )?;

    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_vpa_payment_ap ON vendor_payment_allocations (payment_id, account_payable_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_vpa_tenant_ap ON vendor_payment_allocations (tenant_id, account_payable_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_vpa_tenant_payment ON vendor_payment_allocations (tenant_id, payment_id)",
        [],
    )?;

    Ok(())
}

// ==========================================
// Helper Functions
// ==========================================

pub fn get_today_local(conn: &Connection) -> Result<String, rusqlite::Error> {
    conn.query_row("SELECT date('now', 'localtime')", [], |r| r.get(0))
}

fn validate_tenant_active(conn: &Connection, tenant_id: &str) -> Result<(), VendorPaymentError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(VendorPaymentError::EmptyTenantId);
    }
    let mut stmt = conn
        .prepare("SELECT status FROM tenants WHERE id = ?1")
        .map_err(|e| VendorPaymentError::DatabaseError(e.to_string()))?;
    let status: Result<String, _> = stmt.query_row(params![tid], |r| r.get(0));
    match status {
        Ok(s) if s == "active" => Ok(()),
        Ok(_) => Err(VendorPaymentError::TenantNotActive),
        Err(rusqlite::Error::QueryReturnedNoRows) => Err(VendorPaymentError::TenantNotFound),
        Err(e) => Err(VendorPaymentError::DatabaseError(e.to_string())),
    }
}

fn validate_user_session(user_id: &str) -> Result<&str, VendorPaymentError> {
    let uid = user_id.trim();
    if uid.is_empty() {
        return Err(VendorPaymentError::EmptyUserId);
    }
    Ok(uid)
}

fn validate_payment_method(method: &str) -> Result<&str, VendorPaymentError> {
    let trimmed = method.trim();
    match trimmed {
        "bank_transfer" | "cash" | "check" | "other" => Ok(trimmed),
        _ => Err(VendorPaymentError::InvalidPaymentMethod),
    }
}

fn next_payment_number(tx: &Transaction, tenant_id: &str) -> Result<String, rusqlite::Error> {
    let mut stmt = tx.prepare(
        "SELECT COALESCE(MAX(CAST(SUBSTR(payment_number, 5) AS INTEGER)), 0) + 1 
         FROM vendor_payments WHERE tenant_id = ?1",
    )?;
    let next_seq: i64 = stmt.query_row(params![tenant_id], |row| row.get(0))?;
    Ok(format!("PAY-{:05}", next_seq))
}

fn resolve_vendor_snapshot(
    conn: &Connection,
    tenant_id: &str,
    vendor_partner_id: &str,
) -> Result<String, VendorPaymentError> {
    let mut stmt = conn
        .prepare(
            "SELECT name, is_vendor, is_active 
             FROM partners 
             WHERE id = ?1 AND tenant_id = ?2",
        )
        .map_err(|e| VendorPaymentError::DatabaseError(e.to_string()))?;

    let res = stmt.query_row(params![vendor_partner_id, tenant_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, i64>(2)?,
        ))
    });

    match res {
        Ok((name, is_vendor, is_active)) => {
            if is_vendor != 1 {
                return Err(VendorPaymentError::PartnerNotVendor);
            }
            if is_active != 1 {
                return Err(VendorPaymentError::VendorInactive);
            }
            Ok(name)
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Err(VendorPaymentError::VendorNotFound),
        Err(e) => Err(VendorPaymentError::DatabaseError(e.to_string())),
    }
}

/// Helper to get current AP outstanding balance (AP total amount minus sum of allocations in posted payments)
fn get_ap_info(
    conn: &Connection,
    tenant_id: &str,
    ap_id: &str,
) -> Result<(f64, f64, String, String, String, String), VendorPaymentError> {
    let mut stmt = conn
        .prepare(
            "SELECT amount, source_number, document_date, status, vendor_partner_id, currency
             FROM accounts_payable
             WHERE id = ?1 AND tenant_id = ?2",
        )
        .map_err(|e| VendorPaymentError::DatabaseError(e.to_string()))?;

    let res: Result<(f64, String, String, String, String, String), _> =
        stmt.query_row(params![ap_id, tenant_id], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
            ))
        });

    let (total_amount, source_number, doc_date, status, vnd_id, _currency) = match res {
        Ok(v) => v,
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            return Err(VendorPaymentError::InvalidAllocationAccountPayable)
        }
        Err(e) => return Err(VendorPaymentError::DatabaseError(e.to_string())),
    };

    // Calculate posted allocations sum
    let mut posted_stmt = conn
        .prepare(
            "SELECT COALESCE(SUM(pa.amount), 0.0)
             FROM vendor_payment_allocations pa
             JOIN vendor_payments p ON p.id = pa.payment_id AND p.tenant_id = pa.tenant_id
             WHERE pa.account_payable_id = ?1 AND pa.tenant_id = ?2 AND p.status = 'posted'",
        )
        .map_err(|e| VendorPaymentError::DatabaseError(e.to_string()))?;

    let posted_sum: f64 = posted_stmt.query_row(params![ap_id, tenant_id], |r| r.get(0))?;
    let outstanding = round_2(round_2(total_amount) - round_2(posted_sum)).max(0.0);

    Ok((
        total_amount,
        outstanding,
        source_number,
        doc_date,
        status,
        vnd_id,
    ))
}

// ==========================================
// Core Business Implementations
// ==========================================

pub fn create_vendor_payment_impl(
    conn: &mut Connection,
    tenant_id: &str,
    user_id: &str,
    input: CreateVendorPaymentInput,
) -> Result<VendorPaymentDetail, VendorPaymentError> {
    validate_tenant_active(conn, tenant_id)?;
    let uid = validate_user_session(user_id)?;
    let tid = tenant_id.trim();

    let method = validate_payment_method(&input.payment_method)?;
    let vendor_id = input.vendor_partner_id.trim();
    if vendor_id.is_empty() {
        return Err(VendorPaymentError::VendorNotFound);
    }
    let vendor_snapshot = resolve_vendor_snapshot(conn, tid, vendor_id)?;

    let pay_date = input.payment_date.trim();
    let today = get_today_local(conn)?;
    if pay_date > today.as_str() {
        return Err(VendorPaymentError::PaymentDateCannotBeInFuture);
    }

    let now = current_timestamp();
    let payment_id = generate_payment_id(now);

    let tx = conn.transaction()?;
    let payment_num = next_payment_number(&tx, tid)?;

    let ref_opt = input
        .payment_reference
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let note_opt = input
        .note
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    tx.execute(
        "INSERT INTO vendor_payments (
            id, tenant_id, payment_number, vendor_partner_id, vendor_name_snapshot,
            payment_date, payment_method, payment_reference, note, currency,
            status, created_by, created_at, task_id
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5,
            ?6, ?7, ?8, ?9, 'TWD',
            'draft', ?10, ?11, NULL
        )",
        params![
            payment_id,
            tid,
            payment_num,
            vendor_id,
            vendor_snapshot,
            pay_date,
            method,
            ref_opt,
            note_opt,
            uid,
            now,
        ],
    )?;

    tx.commit()?;

    get_vendor_payment_impl(conn, tid, &payment_id)
}

pub fn update_vendor_payment_header_impl(
    conn: &mut Connection,
    tenant_id: &str,
    payment_id: &str,
    input: UpdateVendorPaymentHeaderInput,
) -> Result<VendorPaymentDetail, VendorPaymentError> {
    validate_tenant_active(conn, tenant_id)?;
    let tid = tenant_id.trim();
    let pid = payment_id.trim();
    if pid.is_empty() {
        return Err(VendorPaymentError::NotFound);
    }

    let method = validate_payment_method(&input.payment_method)?;
    let pay_date = input.payment_date.trim();
    let today = get_today_local(conn)?;
    if pay_date > today.as_str() {
        return Err(VendorPaymentError::PaymentDateCannotBeInFuture);
    }

    // Check payment exists and status is draft
    let (current_status,): (String,) = {
        let mut stmt = conn
            .prepare("SELECT status FROM vendor_payments WHERE id = ?1 AND tenant_id = ?2")
            .map_err(|e| VendorPaymentError::DatabaseError(e.to_string()))?;
        stmt.query_row(params![pid, tid], |r| Ok((r.get(0)?,)))
            .map_err(|_| VendorPaymentError::NotFound)?
    };

    if current_status != "draft" {
        return Err(VendorPaymentError::NotDraftCannotModify(current_status));
    }

    // P-04: payment_date must not be earlier than any allocated AP document_date
    let mut alloc_stmt = conn
        .prepare(
            "SELECT ap.source_number, ap.document_date
             FROM vendor_payment_allocations pa
             JOIN accounts_payable ap ON ap.id = pa.account_payable_id AND ap.tenant_id = pa.tenant_id
             WHERE pa.payment_id = ?1 AND pa.tenant_id = ?2",
        )
        .map_err(|e| VendorPaymentError::DatabaseError(e.to_string()))?;

    let alloc_rows = alloc_stmt
        .query_map(params![pid, tid], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|e| VendorPaymentError::DatabaseError(e.to_string()))?;

    for row in alloc_rows {
        let (src_no, doc_date) = row?;
        if pay_date < doc_date.as_str() {
            return Err(VendorPaymentError::PaymentDateEarlierThanDocumentDate(
                src_no,
            ));
        }
    }

    let ref_opt = input
        .payment_reference
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let note_opt = input
        .note
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    conn.execute(
        "UPDATE vendor_payments
         SET payment_date = ?1, payment_method = ?2, payment_reference = ?3, note = ?4
         WHERE id = ?5 AND tenant_id = ?6 AND status = 'draft'",
        params![pay_date, method, ref_opt, note_opt, pid, tid],
    )?;

    get_vendor_payment_impl(conn, tid, pid)
}

pub fn add_vendor_payment_allocation_impl(
    conn: &mut Connection,
    tenant_id: &str,
    payment_id: &str,
    account_payable_id: &str,
    amount: f64,
) -> Result<VendorPaymentDetail, VendorPaymentError> {
    validate_tenant_active(conn, tenant_id)?;
    let tid = tenant_id.trim();
    let pid = payment_id.trim();
    let ap_id = account_payable_id.trim();

    if pid.is_empty() {
        return Err(VendorPaymentError::NotFound);
    }
    if ap_id.is_empty() {
        return Err(VendorPaymentError::InvalidAllocationAccountPayable);
    }

    // Fetch payment
    let (pay_status, pay_vendor_id, pay_date): (String, String, String) = {
        let mut stmt = conn
            .prepare("SELECT status, vendor_partner_id, payment_date FROM vendor_payments WHERE id = ?1 AND tenant_id = ?2")
            .map_err(|e| VendorPaymentError::DatabaseError(e.to_string()))?;
        stmt.query_row(params![pid, tid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(|_| VendorPaymentError::NotFound)?
    };

    // P-06: Only draft can add allocation
    if pay_status != "draft" {
        return Err(VendorPaymentError::NotDraftCannotModify(pay_status));
    }

    // P-02: Check duplicate in this payment
    let mut dup_stmt = conn.prepare(
        "SELECT COUNT(*) FROM vendor_payment_allocations WHERE payment_id = ?1 AND account_payable_id = ?2",
    )?;
    let count: i64 = dup_stmt.query_row(params![pid, ap_id], |r| r.get(0))?;
    if count > 0 {
        return Err(VendorPaymentError::DuplicateAccountPayableAllocation);
    }

    // P-02 & P-03: AP checks
    let (_total_amount, outstanding, src_no, doc_date, ap_status, ap_vendor_id) =
        get_ap_info(conn, tid, ap_id)?;

    if ap_status != "open" || ap_vendor_id != pay_vendor_id {
        return Err(VendorPaymentError::InvalidAllocationAccountPayable);
    }

    // P-04: payment_date >= doc_date
    if pay_date.as_str() < doc_date.as_str() {
        return Err(VendorPaymentError::PaymentDateEarlierThanDocumentDate(
            src_no,
        ));
    }

    let rounded_amount = round_2(amount);
    if rounded_amount <= 0.0 {
        return Err(VendorPaymentError::InvalidAllocationAmount);
    }

    // P-03: Amount <= outstanding (only considering posted payments)
    if rounded_amount > round_2(outstanding + 1e-6) {
        return Err(VendorPaymentError::AllocationAmountExceedsOutstanding(
            format_amount(rounded_amount),
            src_no,
            format_amount(outstanding),
        ));
    }

    let now = current_timestamp();
    let alloc_id = generate_allocation_id(now);

    conn.execute(
        "INSERT INTO vendor_payment_allocations (
            id, tenant_id, payment_id, account_payable_id, amount, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![alloc_id, tid, pid, ap_id, rounded_amount, now],
    )?;

    get_vendor_payment_impl(conn, tid, pid)
}

pub fn update_vendor_payment_allocation_impl(
    conn: &mut Connection,
    tenant_id: &str,
    payment_id: &str,
    allocation_id: &str,
    amount: f64,
) -> Result<VendorPaymentDetail, VendorPaymentError> {
    validate_tenant_active(conn, tenant_id)?;
    let tid = tenant_id.trim();
    let pid = payment_id.trim();
    let alloc_id = allocation_id.trim();

    if pid.is_empty() {
        return Err(VendorPaymentError::NotFound);
    }
    if alloc_id.is_empty() {
        return Err(VendorPaymentError::AllocationNotFound);
    }

    // Fetch payment status
    let pay_status: String = {
        let mut stmt = conn
            .prepare("SELECT status FROM vendor_payments WHERE id = ?1 AND tenant_id = ?2")
            .map_err(|e| VendorPaymentError::DatabaseError(e.to_string()))?;
        stmt.query_row(params![pid, tid], |r| r.get(0))
            .map_err(|_| VendorPaymentError::NotFound)?
    };

    if pay_status != "draft" {
        return Err(VendorPaymentError::NotDraftCannotModify(pay_status));
    }

    // Fetch allocation
    let ap_id: String = {
        let mut stmt = conn
            .prepare("SELECT account_payable_id FROM vendor_payment_allocations WHERE id = ?1 AND payment_id = ?2 AND tenant_id = ?3")
            .map_err(|e| VendorPaymentError::DatabaseError(e.to_string()))?;
        stmt.query_row(params![alloc_id, pid, tid], |r| r.get(0))
            .map_err(|_| VendorPaymentError::AllocationNotFound)?
    };

    let (_total_amount, outstanding, src_no, _doc_date, _ap_status, _ap_vendor_id) =
        get_ap_info(conn, tid, &ap_id)?;

    let rounded_amount = round_2(amount);
    if rounded_amount <= 0.0 {
        return Err(VendorPaymentError::InvalidAllocationAmount);
    }

    // Check amount <= outstanding
    if rounded_amount > round_2(outstanding + 1e-6) {
        return Err(VendorPaymentError::AllocationAmountExceedsOutstanding(
            format_amount(rounded_amount),
            src_no,
            format_amount(outstanding),
        ));
    }

    conn.execute(
        "UPDATE vendor_payment_allocations
         SET amount = ?1
         WHERE id = ?2 AND payment_id = ?3 AND tenant_id = ?4",
        params![rounded_amount, alloc_id, pid, tid],
    )?;

    get_vendor_payment_impl(conn, tid, pid)
}

pub fn remove_vendor_payment_allocation_impl(
    conn: &mut Connection,
    tenant_id: &str,
    payment_id: &str,
    allocation_id: &str,
) -> Result<VendorPaymentDetail, VendorPaymentError> {
    validate_tenant_active(conn, tenant_id)?;
    let tid = tenant_id.trim();
    let pid = payment_id.trim();
    let alloc_id = allocation_id.trim();

    if pid.is_empty() {
        return Err(VendorPaymentError::NotFound);
    }
    if alloc_id.is_empty() {
        return Err(VendorPaymentError::AllocationNotFound);
    }

    let pay_status: String = {
        let mut stmt = conn
            .prepare("SELECT status FROM vendor_payments WHERE id = ?1 AND tenant_id = ?2")
            .map_err(|e| VendorPaymentError::DatabaseError(e.to_string()))?;
        stmt.query_row(params![pid, tid], |r| r.get(0))
            .map_err(|_| VendorPaymentError::NotFound)?
    };

    if pay_status != "draft" {
        return Err(VendorPaymentError::NotDraftCannotModify(pay_status));
    }

    let affected = conn.execute(
        "DELETE FROM vendor_payment_allocations WHERE id = ?1 AND payment_id = ?2 AND tenant_id = ?3",
        params![alloc_id, pid, tid],
    )?;

    if affected == 0 {
        return Err(VendorPaymentError::AllocationNotFound);
    }

    get_vendor_payment_impl(conn, tid, pid)
}

pub fn post_vendor_payment_impl(
    conn: &mut Connection,
    tenant_id: &str,
    user_id: &str,
    payment_id: &str,
) -> Result<VendorPaymentDetail, VendorPaymentError> {
    validate_tenant_active(conn, tenant_id)?;
    let uid = validate_user_session(user_id)?;
    let tid = tenant_id.trim();
    let pid = payment_id.trim();
    if pid.is_empty() {
        return Err(VendorPaymentError::NotFound);
    }

    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

    // Fetch payment record within transaction
    let (current_status, pay_vendor_id, pay_date): (String, String, String) = {
        let mut stmt = tx
            .prepare("SELECT status, vendor_partner_id, payment_date FROM vendor_payments WHERE id = ?1 AND tenant_id = ?2")
            .map_err(|e| VendorPaymentError::DatabaseError(e.to_string()))?;
        stmt.query_row(params![pid, tid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(|_| VendorPaymentError::NotFound)?
    };

    if current_status != "draft" {
        return Err(VendorPaymentError::InvalidStateTransition {
            from: current_status,
            to: "posted".to_string(),
        });
    }

    // Re-check P-04: payment_date <= today
    let today = get_today_local(&tx)?;
    if pay_date.as_str() > today.as_str() {
        return Err(VendorPaymentError::PaymentDateCannotBeInFuture);
    }

    // Fetch all allocations
    let allocations: Vec<(String, f64)> = {
        let mut stmt = tx.prepare(
            "SELECT account_payable_id, amount FROM vendor_payment_allocations WHERE payment_id = ?1 AND tenant_id = ?2 ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![pid, tid], |r| Ok((r.get(0)?, r.get(1)?)))?;
        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        list
    };

    // P-05: Must have at least 1 allocation
    if allocations.is_empty() {
        return Err(VendorPaymentError::NoAllocationsToPost);
    }

    // Re-check each allocation in transaction
    for (ap_id, alloc_amount) in allocations {
        let (_total_amount, outstanding, src_no, doc_date, ap_status, ap_vendor_id) =
            get_ap_info(&tx, tid, &ap_id)?;

        if ap_status != "open" || ap_vendor_id != pay_vendor_id {
            return Err(VendorPaymentError::InvalidAllocationAccountPayable);
        }

        if pay_date.as_str() < doc_date.as_str() {
            return Err(VendorPaymentError::PaymentDateEarlierThanDocumentDate(
                src_no,
            ));
        }

        let rounded_alloc = round_2(alloc_amount);
        if rounded_alloc > round_2(outstanding + 1e-6) {
            return Err(VendorPaymentError::InsufficientOutstandingOnPost(
                src_no,
                format_amount(outstanding),
                format_amount(rounded_alloc),
            ));
        }
    }

    let now = current_timestamp();
    let affected = tx.execute(
        "UPDATE vendor_payments
         SET status = 'posted', posted_by = ?1, posted_at = ?2
         WHERE id = ?3 AND status = 'draft' AND tenant_id = ?4",
        params![uid, now, pid, tid],
    )?;

    crate::ensure_guarded_mutation_affected(
        &tx,
        "vendor_payments",
        pid,
        tid,
        affected,
        VendorPaymentError::NotFound,
        |s| {
            if s != "draft" {
                Err(VendorPaymentError::InvalidStateTransition {
                    from: s,
                    to: "posted".to_string(),
                })
            } else {
                Ok(())
            }
        },
    )?;

    tx.commit()?;

    get_vendor_payment_impl(conn, tid, pid)
}

pub fn cancel_vendor_payment_impl(
    conn: &mut Connection,
    tenant_id: &str,
    user_id: &str,
    payment_id: &str,
) -> Result<VendorPaymentDetail, VendorPaymentError> {
    validate_tenant_active(conn, tenant_id)?;
    let uid = validate_user_session(user_id)?;
    let tid = tenant_id.trim();
    let pid = payment_id.trim();
    if pid.is_empty() {
        return Err(VendorPaymentError::NotFound);
    }

    let current_status: String = {
        let mut stmt = conn
            .prepare("SELECT status FROM vendor_payments WHERE id = ?1 AND tenant_id = ?2")
            .map_err(|e| VendorPaymentError::DatabaseError(e.to_string()))?;
        stmt.query_row(params![pid, tid], |r| r.get(0))
            .map_err(|_| VendorPaymentError::NotFound)?
    };

    if current_status != "draft" {
        return Err(VendorPaymentError::InvalidStateTransition {
            from: current_status,
            to: "cancelled".to_string(),
        });
    }

    let now = current_timestamp();
    let affected = conn.execute(
        "UPDATE vendor_payments
         SET status = 'cancelled', cancelled_by = ?1, cancelled_at = ?2
         WHERE id = ?3 AND status = 'draft' AND tenant_id = ?4",
        params![uid, now, pid, tid],
    )?;

    crate::ensure_guarded_mutation_affected(
        conn,
        "vendor_payments",
        pid,
        tid,
        affected,
        VendorPaymentError::NotFound,
        |s| {
            if s != "draft" {
                Err(VendorPaymentError::InvalidStateTransition {
                    from: s,
                    to: "cancelled".to_string(),
                })
            } else {
                Ok(())
            }
        },
    )?;

    get_vendor_payment_impl(conn, tid, pid)
}

pub fn void_vendor_payment_impl(
    conn: &mut Connection,
    tenant_id: &str,
    user_id: &str,
    payment_id: &str,
    void_reason: &str,
) -> Result<VendorPaymentDetail, VendorPaymentError> {
    validate_tenant_active(conn, tenant_id)?;
    let uid = validate_user_session(user_id)?;
    let tid = tenant_id.trim();
    let pid = payment_id.trim();
    if pid.is_empty() {
        return Err(VendorPaymentError::NotFound);
    }

    let trimmed_reason = void_reason.trim();
    if trimmed_reason.is_empty() {
        return Err(VendorPaymentError::VoidReasonRequired);
    }

    let current_status: String = {
        let mut stmt = conn
            .prepare("SELECT status FROM vendor_payments WHERE id = ?1 AND tenant_id = ?2")
            .map_err(|e| VendorPaymentError::DatabaseError(e.to_string()))?;
        stmt.query_row(params![pid, tid], |r| r.get(0))
            .map_err(|_| VendorPaymentError::NotFound)?
    };

    if current_status != "posted" {
        return Err(VendorPaymentError::InvalidStateTransition {
            from: current_status,
            to: "voided".to_string(),
        });
    }

    let now = current_timestamp();
    let affected = conn.execute(
        "UPDATE vendor_payments
         SET status = 'voided', voided_by = ?1, voided_at = ?2, void_reason = ?3
         WHERE id = ?4 AND status = 'posted' AND tenant_id = ?5",
        params![uid, now, trimmed_reason, pid, tid],
    )?;

    crate::ensure_guarded_mutation_affected(
        conn,
        "vendor_payments",
        pid,
        tid,
        affected,
        VendorPaymentError::NotFound,
        |s| {
            if s != "posted" {
                Err(VendorPaymentError::InvalidStateTransition {
                    from: s,
                    to: "voided".to_string(),
                })
            } else {
                Ok(())
            }
        },
    )?;

    get_vendor_payment_impl(conn, tid, pid)
}

pub fn get_vendor_payment_impl(
    conn: &Connection,
    tenant_id: &str,
    payment_id: &str,
) -> Result<VendorPaymentDetail, VendorPaymentError> {
    validate_tenant_active(conn, tenant_id)?;
    let tid = tenant_id.trim();
    let pid = payment_id.trim();
    if pid.is_empty() {
        return Err(VendorPaymentError::NotFound);
    }

    let payment = {
        let mut stmt = conn.prepare(
            "SELECT id, tenant_id, payment_number, vendor_partner_id, vendor_name_snapshot,
                    payment_date, payment_method, payment_reference, note, currency,
                    status, created_by, created_at, posted_by, posted_at,
                    cancelled_by, cancelled_at, voided_by, voided_at, void_reason, task_id
             FROM vendor_payments
             WHERE id = ?1 AND tenant_id = ?2",
        )?;
        stmt.query_row(params![pid, tid], |r| {
            Ok(VendorPayment {
                id: r.get(0)?,
                tenant_id: r.get(1)?,
                payment_number: r.get(2)?,
                vendor_partner_id: r.get(3)?,
                vendor_name_snapshot: r.get(4)?,
                payment_date: r.get(5)?,
                payment_method: r.get(6)?,
                payment_reference: r.get(7)?,
                note: r.get(8)?,
                currency: r.get(9)?,
                status: r.get(10)?,
                created_by: r.get(11)?,
                created_at: r.get(12)?,
                posted_by: r.get(13)?,
                posted_at: r.get(14)?,
                cancelled_by: r.get(15)?,
                cancelled_at: r.get(16)?,
                voided_by: r.get(17)?,
                voided_at: r.get(18)?,
                void_reason: r.get(19)?,
                task_id: r.get(20)?,
            })
        })
        .map_err(|_| VendorPaymentError::NotFound)?
    };

    // Query allocations with AP info
    let mut alloc_stmt = conn.prepare(
        "SELECT pa.id, pa.payment_id, pa.account_payable_id, pa.amount, pa.created_at,
                ap.source_type, ap.source_id, ap.source_number, ap.external_reference,
                ap.document_date, ap.due_date, ap.amount
         FROM vendor_payment_allocations pa
         JOIN accounts_payable ap ON ap.id = pa.account_payable_id AND ap.tenant_id = pa.tenant_id
         WHERE pa.payment_id = ?1 AND pa.tenant_id = ?2
         ORDER BY pa.created_at ASC",
    )?;

    let alloc_rows = alloc_stmt.query_map(params![pid, tid], |r| {
        Ok(VendorPaymentAllocationDetail {
            id: r.get(0)?,
            payment_id: r.get(1)?,
            account_payable_id: r.get(2)?,
            amount: round_2(r.get(3)?),
            created_at: r.get(4)?,
            source_type: r.get(5)?,
            source_id: r.get(6)?,
            source_number: r.get(7)?,
            external_reference: r.get(8)?,
            document_date: r.get(9)?,
            due_date: r.get(10)?,
            ap_amount: round_2(r.get(11)?),
        })
    })?;

    let mut allocations = Vec::new();
    let mut total_amount = 0.0;
    for a in alloc_rows {
        let item = a?;
        total_amount += item.amount;
        allocations.push(item);
    }

    Ok(VendorPaymentDetail {
        id: payment.id,
        tenant_id: payment.tenant_id,
        payment_number: payment.payment_number,
        vendor_partner_id: payment.vendor_partner_id,
        vendor_name_snapshot: payment.vendor_name_snapshot,
        payment_date: payment.payment_date,
        payment_method: payment.payment_method,
        payment_reference: payment.payment_reference,
        note: payment.note,
        total_amount: round_2(total_amount),
        currency: payment.currency,
        status: payment.status,
        created_by: payment.created_by,
        created_at: payment.created_at,
        posted_by: payment.posted_by,
        posted_at: payment.posted_at,
        cancelled_by: payment.cancelled_by,
        cancelled_at: payment.cancelled_at,
        voided_by: payment.voided_by,
        voided_at: payment.voided_at,
        void_reason: payment.void_reason,
        task_id: payment.task_id,
        allocations,
    })
}

pub fn list_vendor_payments_impl(
    conn: &Connection,
    tenant_id: &str,
    filter: Option<ListVendorPaymentsFilter>,
) -> Result<Vec<VendorPaymentItem>, VendorPaymentError> {
    validate_tenant_active(conn, tenant_id)?;
    let tid = tenant_id.trim();

    let mut sql = String::from(
        "SELECT p.id, p.tenant_id, p.payment_number, p.vendor_partner_id, p.vendor_name_snapshot,
                p.payment_date, p.payment_method, p.payment_reference, p.note, p.currency,
                p.status, p.created_by, p.created_at, p.posted_by, p.posted_at,
                p.cancelled_by, p.cancelled_at, p.voided_by, p.voided_at, p.void_reason, p.task_id,
                COALESCE(SUM(pa.amount), 0.0) as total_amount,
                COUNT(pa.id) as allocation_count
         FROM vendor_payments p
         LEFT JOIN vendor_payment_allocations pa ON pa.payment_id = p.id AND pa.tenant_id = p.tenant_id
         WHERE p.tenant_id = ?1",
    );

    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(tid.to_string())];
    let mut param_index = 2;

    if let Some(f) = filter {
        if let Some(vnd) = f
            .vendor_partner_id
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
        {
            sql.push_str(&format!(" AND p.vendor_partner_id = ?{}", param_index));
            params_vec.push(Box::new(vnd));
            param_index += 1;
        }

        if let Some(st) = f
            .status
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
        {
            sql.push_str(&format!(" AND p.status = ?{}", param_index));
            params_vec.push(Box::new(st));
            param_index += 1;
        }

        if let Some(df) = f
            .payment_date_from
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
        {
            sql.push_str(&format!(" AND p.payment_date >= ?{}", param_index));
            params_vec.push(Box::new(df));
            param_index += 1;
        }

        if let Some(dt) = f
            .payment_date_to
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
        {
            sql.push_str(&format!(" AND p.payment_date <= ?{}", param_index));
            params_vec.push(Box::new(dt));
            let _ = param_index;
        }
    }

    sql.push_str(
        " GROUP BY p.id ORDER BY p.payment_date DESC, p.created_at DESC, p.payment_number DESC",
    );

    let mut stmt = conn.prepare(&sql)?;
    let slice: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();

    let rows = stmt.query_map(slice.as_slice(), |r| {
        Ok(VendorPaymentItem {
            id: r.get(0)?,
            tenant_id: r.get(1)?,
            payment_number: r.get(2)?,
            vendor_partner_id: r.get(3)?,
            vendor_name_snapshot: r.get(4)?,
            payment_date: r.get(5)?,
            payment_method: r.get(6)?,
            payment_reference: r.get(7)?,
            note: r.get(8)?,
            currency: r.get(9)?,
            status: r.get(10)?,
            created_by: r.get(11)?,
            created_at: r.get(12)?,
            posted_by: r.get(13)?,
            posted_at: r.get(14)?,
            cancelled_by: r.get(15)?,
            cancelled_at: r.get(16)?,
            voided_by: r.get(17)?,
            voided_at: r.get(18)?,
            void_reason: r.get(19)?,
            task_id: r.get(20)?,
            total_amount: round_2(r.get(21)?),
            allocation_count: r.get::<_, i64>(22)? as usize,
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
#[specta::specta]
pub async fn create_vendor_payment<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    input: CreateVendorPaymentInput,
) -> Result<VendorPaymentDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;
    create_vendor_payment_impl(&mut conn, &active_tid, &active_uid, input)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn update_vendor_payment_header<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    input: UpdateVendorPaymentHeaderInput,
) -> Result<VendorPaymentDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let pid = input
        .id
        .clone()
        .or_else(|| input.payment_id.clone())
        .unwrap_or_default();
    update_vendor_payment_header_impl(&mut conn, &active_tid, &pid, input)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn add_vendor_payment_allocation<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    payment_id: String,
    account_payable_id: String,
    amount: f64,
) -> Result<VendorPaymentDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    add_vendor_payment_allocation_impl(
        &mut conn,
        &active_tid,
        &payment_id,
        &account_payable_id,
        amount,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn update_vendor_payment_allocation<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    payment_id: String,
    allocation_id: String,
    amount: f64,
) -> Result<VendorPaymentDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    update_vendor_payment_allocation_impl(
        &mut conn,
        &active_tid,
        &payment_id,
        &allocation_id,
        amount,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn remove_vendor_payment_allocation<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    payment_id: String,
    allocation_id: String,
) -> Result<VendorPaymentDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    remove_vendor_payment_allocation_impl(&mut conn, &active_tid, &payment_id, &allocation_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn post_vendor_payment<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    payment_id: Option<String>,
    id: Option<String>,
) -> Result<VendorPaymentDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;
    let pid = payment_id.or(id).unwrap_or_default();
    post_vendor_payment_impl(&mut conn, &active_tid, &active_uid, &pid).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_vendor_payment<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    payment_id: Option<String>,
    id: Option<String>,
) -> Result<VendorPaymentDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;
    let pid = payment_id.or(id).unwrap_or_default();
    cancel_vendor_payment_impl(&mut conn, &active_tid, &active_uid, &pid).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn void_vendor_payment<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    payment_id: Option<String>,
    id: Option<String>,
    void_reason: String,
) -> Result<VendorPaymentDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;
    let pid = payment_id.or(id).unwrap_or_default();
    void_vendor_payment_impl(&mut conn, &active_tid, &active_uid, &pid, &void_reason)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn get_vendor_payment<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    payment_id: Option<String>,
    id: Option<String>,
) -> Result<VendorPaymentDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let pid = payment_id.or(id).unwrap_or_default();
    get_vendor_payment_impl(&conn, &active_tid, &pid).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn list_vendor_payments<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    filter: Option<ListVendorPaymentsFilter>,
) -> Result<Vec<VendorPaymentItem>, String> {
    let db_path = crate::get_db_path(&app_handle);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    list_vendor_payments_impl(&conn, &active_tid, filter).map_err(|e| e.to_string())
}

// ==========================================
// Unit Tests (Full Coverage of Test Perspectives Table)
// ==========================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::accounts_payable::{
        create_account_payable, create_accounts_payable_tables, get_account_payable_impl,
        CreateAccountPayableInput,
    };

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        // Setup tenants, users, partners
        conn.execute(
            "CREATE TABLE tenants (
                id TEXT PRIMARY KEY,
                code TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                company_name TEXT NOT NULL,
                tax_id TEXT,
                status TEXT NOT NULL DEFAULT 'active'
            )",
            [],
        )
        .unwrap();

        conn.execute(
            "CREATE TABLE users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL,
                name TEXT NOT NULL DEFAULT ''
            )",
            [],
        )
        .unwrap();

        conn.execute(
            "CREATE TABLE partners (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                name TEXT NOT NULL,
                tax_id TEXT,
                is_vendor INTEGER NOT NULL DEFAULT 0,
                is_customer INTEGER NOT NULL DEFAULT 0,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER NOT NULL
            )",
            [],
        )
        .unwrap();

        create_accounts_payable_tables(&conn).unwrap();
        create_vendor_payment_tables(&conn).unwrap();

        // Seed default active tenant & users
        conn.execute(
            "INSERT INTO tenants (id, code, name, company_name, status) VALUES ('tnt_test', 'TEST', 'Test Tenant', 'Test Co.', 'active')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO tenants (id, code, name, company_name, status) VALUES ('tnt_suspended', 'SUSP', 'Suspended Tenant', 'Suspended Co.', 'suspended')",
            [],
        ).unwrap();

        conn.execute(
            "INSERT INTO users (id, email, password, name) VALUES ('usr_admin', 'admin@test.com', 'pass', 'Admin')",
            [],
        ).unwrap();

        // Seed vendors
        conn.execute(
            "INSERT INTO partners (id, tenant_id, name, is_vendor, is_active, created_at) VALUES ('vnd_001', 'tnt_test', 'Vendor 1', 1, 1, 1000)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO partners (id, tenant_id, name, is_vendor, is_active, created_at) VALUES ('vnd_002', 'tnt_test', 'Vendor 2', 1, 1, 1000)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO partners (id, tenant_id, name, is_vendor, is_active, created_at) VALUES ('non_vnd', 'tnt_test', 'Customer Only', 0, 1, 1000)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO partners (id, tenant_id, name, is_vendor, is_active, created_at) VALUES ('vnd_inactive', 'tnt_test', 'Vendor Inactive', 1, 0, 1000)",
            [],
        ).unwrap();

        conn
    }

    fn create_test_ap(
        conn: &mut Connection,
        tenant_id: &str,
        vendor_id: &str,
        src_no: &str,
        doc_date: &str,
        amount: f64,
    ) -> String {
        let input = CreateAccountPayableInput {
            vendor_partner_id: vendor_id.to_string(),
            source_type: "vendor_bill".to_string(),
            source_id: format!("bill_{}", src_no),
            source_number: src_no.to_string(),
            external_reference: None,
            document_date: doc_date.to_string(),
            due_date: doc_date.to_string(),
            amount,
            currency: Some("TWD".to_string()),
        };
        let ap = create_account_payable(conn, tenant_id, "usr_admin", input).unwrap();
        ap.id
    }

    // ----------------------------------------------------
    // P-01 Tests: Active tenant and user validation
    // ----------------------------------------------------

    #[test]
    fn test_tc_pay_p01_n01_and_errors() {
        let mut conn = setup_test_db();
        let today = get_today_local(&conn).unwrap();

        // Given: Valid active tenant and user session
        let input = CreateVendorPaymentInput {
            vendor_partner_id: "vnd_001".to_string(),
            payment_date: today.clone(),
            payment_method: "bank_transfer".to_string(),
            payment_reference: Some("REF123".to_string()),
            note: Some("Normal payment".to_string()),
        };

        // When (TC-PAY-P01-N01): Create payment with valid inputs
        let res = create_vendor_payment_impl(&mut conn, "tnt_test", "usr_admin", input.clone());
        // Then: Successfully created in draft state with PAY-00001
        assert!(res.is_ok());
        let payment = res.unwrap();
        assert_eq!(payment.payment_number, "PAY-00001");
        assert_eq!(payment.status, "draft");
        assert_eq!(payment.total_amount, 0.0);

        // When (TC-PAY-P01-E01): empty tenant_id
        let err1 =
            create_vendor_payment_impl(&mut conn, "", "usr_admin", input.clone()).unwrap_err();
        // Then: Fails with EmptyTenantId
        assert_eq!(err1, VendorPaymentError::EmptyTenantId);

        // When (TC-PAY-P01-E02): whitespace tenant_id
        let err2 =
            create_vendor_payment_impl(&mut conn, "   ", "usr_admin", input.clone()).unwrap_err();
        // Then: Fails with EmptyTenantId
        assert_eq!(err2, VendorPaymentError::EmptyTenantId);

        // When (TC-PAY-P01-E03): non-existent tenant_id
        let err3 =
            create_vendor_payment_impl(&mut conn, "tnt_nonexistent", "usr_admin", input.clone())
                .unwrap_err();
        // Then: Fails with TenantNotFound
        assert_eq!(err3, VendorPaymentError::TenantNotFound);

        // When (TC-PAY-P01-E04): suspended tenant_id
        let err4 =
            create_vendor_payment_impl(&mut conn, "tnt_suspended", "usr_admin", input.clone())
                .unwrap_err();
        // Then: Fails with TenantNotActive
        assert_eq!(err4, VendorPaymentError::TenantNotActive);

        // When (TC-PAY-P01-E05): empty user_id
        let err5 =
            create_vendor_payment_impl(&mut conn, "tnt_test", "", input.clone()).unwrap_err();
        // Then: Fails with EmptyUserId
        assert_eq!(err5, VendorPaymentError::EmptyUserId);
    }

    // ----------------------------------------------------
    // P-02 Tests: Allocation AP matching and single AP constraint
    // ----------------------------------------------------

    #[test]
    fn test_tc_pay_p02_allocations_and_errors() {
        let mut conn = setup_test_db();
        let today = get_today_local(&conn).unwrap();
        let ap1 = create_test_ap(
            &mut conn,
            "tnt_test",
            "vnd_001",
            "BILL-001",
            "2026-10-01",
            1000.0,
        );
        let ap_diff_vnd = create_test_ap(
            &mut conn,
            "tnt_test",
            "vnd_002",
            "BILL-002",
            "2026-10-01",
            500.0,
        );

        let p_input = CreateVendorPaymentInput {
            vendor_partner_id: "vnd_001".to_string(),
            payment_date: today.clone(),
            payment_method: "bank_transfer".to_string(),
            payment_reference: None,
            note: None,
        };
        let payment =
            create_vendor_payment_impl(&mut conn, "tnt_test", "usr_admin", p_input).unwrap();

        // When (TC-PAY-P02-N01): Add allocation for same vendor open AP
        let res1 =
            add_vendor_payment_allocation_impl(&mut conn, "tnt_test", &payment.id, &ap1, 400.0);
        // Then: Success, total_amount becomes 400
        assert!(res1.is_ok());
        let updated = res1.unwrap();
        assert_eq!(updated.total_amount, 400.0);
        assert_eq!(updated.allocations.len(), 1);

        // When (TC-PAY-P02-E01): Add allocation for different vendor AP
        let err1 = add_vendor_payment_allocation_impl(
            &mut conn,
            "tnt_test",
            &payment.id,
            &ap_diff_vnd,
            100.0,
        )
        .unwrap_err();
        // Then: Rejected with InvalidAllocationAccountPayable
        assert_eq!(err1, VendorPaymentError::InvalidAllocationAccountPayable);

        // When (TC-PAY-P02-E04): Add duplicate allocation for same AP
        let err_dup =
            add_vendor_payment_allocation_impl(&mut conn, "tnt_test", &payment.id, &ap1, 100.0)
                .unwrap_err();
        // Then: Rejected with DuplicateAccountPayableAllocation
        assert_eq!(
            err_dup,
            VendorPaymentError::DuplicateAccountPayableAllocation
        );

        // When (TC-PAY-P02-E02): Add allocation for voided AP
        let ap_void = create_test_ap(
            &mut conn,
            "tnt_test",
            "vnd_001",
            "BILL-VOID",
            "2026-10-01",
            300.0,
        );
        crate::accounts_payable::void_account_payable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            &ap_void,
            "test void",
        )
        .unwrap();
        let err_void =
            add_vendor_payment_allocation_impl(&mut conn, "tnt_test", &payment.id, &ap_void, 100.0)
                .unwrap_err();
        // Then: Rejected with InvalidAllocationAccountPayable
        assert_eq!(
            err_void,
            VendorPaymentError::InvalidAllocationAccountPayable
        );

        // When (TC-PAY-P02-E03): Add allocation for nonexistent AP
        let err_notfound = add_vendor_payment_allocation_impl(
            &mut conn,
            "tnt_test",
            &payment.id,
            "ap_nonexistent",
            100.0,
        )
        .unwrap_err();
        // Then: Rejected with InvalidAllocationAccountPayable
        assert_eq!(
            err_notfound,
            VendorPaymentError::InvalidAllocationAccountPayable
        );
    }

    // ----------------------------------------------------
    // P-03 Tests: Allocation Amount Boundaries & AP-06 Rounding
    // ----------------------------------------------------

    #[test]
    fn test_tc_pay_p03_amount_boundaries_and_exceeding() {
        let mut conn = setup_test_db();
        let today = get_today_local(&conn).unwrap();
        let ap = create_test_ap(
            &mut conn,
            "tnt_test",
            "vnd_001",
            "BILL-100",
            "2026-10-01",
            100.0,
        );

        let p_input = CreateVendorPaymentInput {
            vendor_partner_id: "vnd_001".to_string(),
            payment_date: today.clone(),
            payment_method: "cash".to_string(),
            payment_reference: None,
            note: None,
        };
        let p = create_vendor_payment_impl(&mut conn, "tnt_test", "usr_admin", p_input).unwrap();

        // When (TC-PAY-P03-B03): Amount = 0.0
        let err_zero =
            add_vendor_payment_allocation_impl(&mut conn, "tnt_test", &p.id, &ap, 0.0).unwrap_err();
        // Then: Rejected with InvalidAllocationAmount
        assert_eq!(err_zero, VendorPaymentError::InvalidAllocationAmount);

        // When (TC-PAY-P03-B04): Amount = -1.0
        let err_neg = add_vendor_payment_allocation_impl(&mut conn, "tnt_test", &p.id, &ap, -1.0)
            .unwrap_err();
        // Then: Rejected with InvalidAllocationAmount
        assert_eq!(err_neg, VendorPaymentError::InvalidAllocationAmount);

        // When (TC-PAY-P03-B02): Amount = 100.01 (+0.01 boundary exceed)
        let err_exceed =
            add_vendor_payment_allocation_impl(&mut conn, "tnt_test", &p.id, &ap, 100.01)
                .unwrap_err();
        // Then: Rejected with AllocationAmountExceedsOutstanding
        assert_eq!(
            err_exceed,
            VendorPaymentError::AllocationAmountExceedsOutstanding(
                "100.01".to_string(),
                "BILL-100".to_string(),
                "100".to_string(),
            )
        );

        // When (TC-PAY-P03-B01): Amount = 100.00 (exact full amount)
        let res_exact =
            add_vendor_payment_allocation_impl(&mut conn, "tnt_test", &p.id, &ap, 100.0);
        // Then: Success!
        assert!(res_exact.is_ok());

        // When (TC-PAY-P03-B05): Update allocation with rounding edge case
        let alloc_id = res_exact.unwrap().allocations[0].id.clone();
        let res_update_exceed =
            update_vendor_payment_allocation_impl(&mut conn, "tnt_test", &p.id, &alloc_id, 100.006);
        // 100.006 rounds to 100.01 which exceeds 100.00
        assert_eq!(
            res_update_exceed.unwrap_err(),
            VendorPaymentError::AllocationAmountExceedsOutstanding(
                "100.01".to_string(),
                "BILL-100".to_string(),
                "100".to_string(),
            )
        );

        let res_update_ok =
            update_vendor_payment_allocation_impl(&mut conn, "tnt_test", &p.id, &alloc_id, 50.0);
        assert!(res_update_ok.is_ok());
        assert_eq!(res_update_ok.unwrap().total_amount, 50.0);
    }

    // ----------------------------------------------------
    // P-04 Tests: Payment date boundaries
    // ----------------------------------------------------

    #[test]
    fn test_tc_pay_p04_date_boundaries() {
        let mut conn = setup_test_db();
        let today = get_today_local(&conn).unwrap();
        let ap = create_test_ap(
            &mut conn,
            "tnt_test",
            "vnd_001",
            "BILL-D1",
            "2026-10-15",
            500.0,
        );

        // When (TC-PAY-P04-B02): payment_date tomorrow (+1 day in future)
        let tomorrow = "2099-01-01";
        let err_future = create_vendor_payment_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorPaymentInput {
                vendor_partner_id: "vnd_001".to_string(),
                payment_date: tomorrow.to_string(),
                payment_method: "cash".to_string(),
                payment_reference: None,
                note: None,
            },
        )
        .unwrap_err();
        // Then: Fails with PaymentDateCannotBeInFuture
        assert_eq!(err_future, VendorPaymentError::PaymentDateCannotBeInFuture);

        // When (TC-PAY-P04-B01): payment_date today (normal/boundary)
        let p = create_vendor_payment_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorPaymentInput {
                vendor_partner_id: "vnd_001".to_string(),
                payment_date: today.clone(),
                payment_method: "cash".to_string(),
                payment_reference: None,
                note: None,
            },
        )
        .unwrap();
        assert_eq!(p.payment_date, today);

        // When: Try adding allocation when payment_date is earlier than AP document_date
        let p_early = create_vendor_payment_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorPaymentInput {
                vendor_partner_id: "vnd_001".to_string(),
                payment_date: "2026-10-14".to_string(), // 1 day earlier than 2026-10-15
                payment_method: "cash".to_string(),
                payment_reference: None,
                note: None,
            },
        )
        .unwrap();

        // When (TC-PAY-P04-B04): Add allocation to early payment
        let err_early =
            add_vendor_payment_allocation_impl(&mut conn, "tnt_test", &p_early.id, &ap, 100.0)
                .unwrap_err();
        // Then: Rejected with PaymentDateEarlierThanDocumentDate
        assert_eq!(
            err_early,
            VendorPaymentError::PaymentDateEarlierThanDocumentDate("BILL-D1".to_string())
        );

        // When (TC-PAY-P04-B03): payment_date is exact same day as AP document_date (2026-10-15)
        let p_exact_date = create_vendor_payment_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorPaymentInput {
                vendor_partner_id: "vnd_001".to_string(),
                payment_date: "2026-10-15".to_string(),
                payment_method: "cash".to_string(),
                payment_reference: None,
                note: None,
            },
        )
        .unwrap();
        let res_exact_date =
            add_vendor_payment_allocation_impl(&mut conn, "tnt_test", &p_exact_date.id, &ap, 100.0);
        // Then: Success!
        assert!(res_exact_date.is_ok());

        // When (TC-PAY-P04-E01): Update payment header to earlier date while allocation exists
        let err_update_date = update_vendor_payment_header_impl(
            &mut conn,
            "tnt_test",
            &p_exact_date.id,
            UpdateVendorPaymentHeaderInput {
                id: Some(p_exact_date.id.clone()),
                payment_id: None,
                payment_date: "2026-10-14".to_string(),
                payment_method: "cash".to_string(),
                payment_reference: None,
                note: None,
            },
        )
        .unwrap_err();
        assert_eq!(
            err_update_date,
            VendorPaymentError::PaymentDateEarlierThanDocumentDate("BILL-D1".to_string())
        );
    }

    // ----------------------------------------------------
    // P-05 Tests: Post, Concurrency, and Multi-Allocation Atomicity
    // ----------------------------------------------------

    #[test]
    fn test_tc_pay_p05_post_concurrency_and_atomicity() {
        let mut conn = setup_test_db();
        let today = get_today_local(&conn).unwrap();
        let ap = create_test_ap(
            &mut conn,
            "tnt_test",
            "vnd_001",
            "BILL-POST",
            "2026-10-01",
            1000.0,
        );

        // Given: Payment draft without allocations
        let p_empty = create_vendor_payment_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorPaymentInput {
                vendor_partner_id: "vnd_001".to_string(),
                payment_date: today.clone(),
                payment_method: "bank_transfer".to_string(),
                payment_reference: None,
                note: None,
            },
        )
        .unwrap();

        // When (TC-PAY-P05-B01): Post with 0 allocations
        let err_no_alloc =
            post_vendor_payment_impl(&mut conn, "tnt_test", "usr_admin", &p_empty.id).unwrap_err();
        // Then: Fails with NoAllocationsToPost
        assert_eq!(err_no_alloc, VendorPaymentError::NoAllocationsToPost);

        // When (TC-PAY-P05-N02): Concurrent drafts核銷同一應付全額
        let p_draft1 = create_vendor_payment_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorPaymentInput {
                vendor_partner_id: "vnd_001".to_string(),
                payment_date: today.clone(),
                payment_method: "bank_transfer".to_string(),
                payment_reference: None,
                note: None,
            },
        )
        .unwrap();
        add_vendor_payment_allocation_impl(&mut conn, "tnt_test", &p_draft1.id, &ap, 1000.0)
            .unwrap();

        let p_draft2 = create_vendor_payment_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorPaymentInput {
                vendor_partner_id: "vnd_001".to_string(),
                payment_date: today.clone(),
                payment_method: "bank_transfer".to_string(),
                payment_reference: None,
                note: None,
            },
        )
        .unwrap();
        // draft 2 can also allocate 1000 because draft 1 hasn't posted yet (TC-PAY-P03-N02)
        add_vendor_payment_allocation_impl(&mut conn, "tnt_test", &p_draft2.id, &ap, 1000.0)
            .unwrap();

        // First draft posts successfully (TC-PAY-P05-N01)
        let posted1 = post_vendor_payment_impl(&mut conn, "tnt_test", "usr_admin", &p_draft1.id);
        assert!(posted1.is_ok());
        assert_eq!(posted1.unwrap().status, "posted");

        // Second draft posting is blocked in transaction check by P-05
        let err_draft2 =
            post_vendor_payment_impl(&mut conn, "tnt_test", "usr_admin", &p_draft2.id).unwrap_err();
        assert_eq!(
            err_draft2,
            VendorPaymentError::InsufficientOutstandingOnPost(
                "BILL-POST".to_string(),
                "0".to_string(),
                "1000".to_string(),
            )
        );

        // Verify AP is now fully paid in accounts_payable
        let ap_detail = get_account_payable_impl(&conn, "tnt_test", &ap).unwrap();
        assert_eq!(ap_detail.paid_amount, 1000.0);
        assert_eq!(ap_detail.outstanding_amount, 0.0);
        assert_eq!(
            ap_detail.settlement_status,
            crate::accounts_payable::SettlementStatus::Paid
        );

        // When (TC-PAY-P05-N03): Multi-allocation atomicity
        let ap_a = create_test_ap(
            &mut conn,
            "tnt_test",
            "vnd_001",
            "BILL-A",
            "2026-10-01",
            100.0,
        );
        let ap_b = create_test_ap(
            &mut conn,
            "tnt_test",
            "vnd_001",
            "BILL-B",
            "2026-10-01",
            200.0,
        );
        let ap_c = create_test_ap(
            &mut conn,
            "tnt_test",
            "vnd_001",
            "BILL-C",
            "2026-10-01",
            300.0,
        );

        let p_multi = create_vendor_payment_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorPaymentInput {
                vendor_partner_id: "vnd_001".to_string(),
                payment_date: today.clone(),
                payment_method: "cash".to_string(),
                payment_reference: None,
                note: None,
            },
        )
        .unwrap();
        add_vendor_payment_allocation_impl(&mut conn, "tnt_test", &p_multi.id, &ap_a, 100.0)
            .unwrap();
        add_vendor_payment_allocation_impl(&mut conn, "tnt_test", &p_multi.id, &ap_b, 200.0)
            .unwrap();
        add_vendor_payment_allocation_impl(&mut conn, "tnt_test", &p_multi.id, &ap_c, 300.0)
            .unwrap();

        // Someone else pays AP-C in the meantime
        let p_other = create_vendor_payment_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorPaymentInput {
                vendor_partner_id: "vnd_001".to_string(),
                payment_date: today.clone(),
                payment_method: "cash".to_string(),
                payment_reference: None,
                note: None,
            },
        )
        .unwrap();
        add_vendor_payment_allocation_impl(&mut conn, "tnt_test", &p_other.id, &ap_c, 100.0)
            .unwrap();
        post_vendor_payment_impl(&mut conn, "tnt_test", "usr_admin", &p_other.id).unwrap();

        // Now post p_multi: AP-C only has 200 outstanding, but p_multi allocated 300
        let err_multi =
            post_vendor_payment_impl(&mut conn, "tnt_test", "usr_admin", &p_multi.id).unwrap_err();
        assert_eq!(
            err_multi,
            VendorPaymentError::InsufficientOutstandingOnPost(
                "BILL-C".to_string(),
                "200".to_string(),
                "300".to_string(),
            )
        );

        // Verify atomicity: AP-A and AP-B are untouched!
        let ap_a_detail = get_account_payable_impl(&conn, "tnt_test", &ap_a).unwrap();
        assert_eq!(ap_a_detail.paid_amount, 0.0);
        assert_eq!(ap_a_detail.outstanding_amount, 100.0);
        assert_eq!(
            ap_a_detail.settlement_status,
            crate::accounts_payable::SettlementStatus::Unpaid
        );
    }

    // ----------------------------------------------------
    // P-06 Tests: Modifications only allowed in draft
    // ----------------------------------------------------

    #[test]
    fn test_tc_pay_p06_modification_guards() {
        let mut conn = setup_test_db();
        let today = get_today_local(&conn).unwrap();
        let ap = create_test_ap(
            &mut conn,
            "tnt_test",
            "vnd_001",
            "BILL-P06",
            "2026-10-01",
            500.0,
        );

        let p = create_vendor_payment_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorPaymentInput {
                vendor_partner_id: "vnd_001".to_string(),
                payment_date: today.clone(),
                payment_method: "cash".to_string(),
                payment_reference: None,
                note: None,
            },
        )
        .unwrap();

        let alloc =
            add_vendor_payment_allocation_impl(&mut conn, "tnt_test", &p.id, &ap, 200.0).unwrap();
        let alloc_id = alloc.allocations[0].id.clone();

        // Post the payment
        post_vendor_payment_impl(&mut conn, "tnt_test", "usr_admin", &p.id).unwrap();

        // When (TC-PAY-P06-E01): Update header when posted
        let err_hdr = update_vendor_payment_header_impl(
            &mut conn,
            "tnt_test",
            &p.id,
            UpdateVendorPaymentHeaderInput {
                id: Some(p.id.clone()),
                payment_id: None,
                payment_date: today.clone(),
                payment_method: "bank_transfer".to_string(),
                payment_reference: None,
                note: None,
            },
        )
        .unwrap_err();
        // Then: Fails with NotDraftCannotModify
        assert_eq!(
            err_hdr,
            VendorPaymentError::NotDraftCannotModify("posted".to_string())
        );

        // When (TC-PAY-P06-E02): Add / Update / Remove allocation when posted
        let ap2 = create_test_ap(
            &mut conn,
            "tnt_test",
            "vnd_001",
            "BILL-P06-2",
            "2026-10-01",
            500.0,
        );
        let err_add = add_vendor_payment_allocation_impl(&mut conn, "tnt_test", &p.id, &ap2, 100.0)
            .unwrap_err();
        assert_eq!(
            err_add,
            VendorPaymentError::NotDraftCannotModify("posted".to_string())
        );

        let err_upd =
            update_vendor_payment_allocation_impl(&mut conn, "tnt_test", &p.id, &alloc_id, 300.0)
                .unwrap_err();
        assert_eq!(
            err_upd,
            VendorPaymentError::NotDraftCannotModify("posted".to_string())
        );

        let err_rem =
            remove_vendor_payment_allocation_impl(&mut conn, "tnt_test", &p.id, &alloc_id)
                .unwrap_err();
        assert_eq!(
            err_rem,
            VendorPaymentError::NotDraftCannotModify("posted".to_string())
        );
    }

    // ----------------------------------------------------
    // P-07 & P-08 Tests: Voiding, restoration, state machine & idempotency
    // ----------------------------------------------------

    #[test]
    fn test_tc_pay_p07_and_p08_void_and_state_machine() {
        let mut conn = setup_test_db();
        let today = get_today_local(&conn).unwrap();
        let ap = create_test_ap(
            &mut conn,
            "tnt_test",
            "vnd_001",
            "BILL-VOID-TEST",
            "2026-10-01",
            1000.0,
        );

        let p = create_vendor_payment_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorPaymentInput {
                vendor_partner_id: "vnd_001".to_string(),
                payment_date: today.clone(),
                payment_method: "check".to_string(),
                payment_reference: Some("CHK001".to_string()),
                note: None,
            },
        )
        .unwrap();
        add_vendor_payment_allocation_impl(&mut conn, "tnt_test", &p.id, &ap, 600.0).unwrap();

        // When (TC-PAY-P08-E01): draft -> voided illegal
        let err_void_draft =
            void_vendor_payment_impl(&mut conn, "tnt_test", "usr_admin", &p.id, "reason")
                .unwrap_err();
        assert_eq!(
            err_void_draft,
            VendorPaymentError::InvalidStateTransition {
                from: "draft".to_string(),
                to: "voided".to_string(),
            }
        );

        // When (TC-PAY-P08-N02): draft -> cancelled
        let p_cancel = create_vendor_payment_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorPaymentInput {
                vendor_partner_id: "vnd_001".to_string(),
                payment_date: today.clone(),
                payment_method: "cash".to_string(),
                payment_reference: None,
                note: None,
            },
        )
        .unwrap();
        let cancelled =
            cancel_vendor_payment_impl(&mut conn, "tnt_test", "usr_admin", &p_cancel.id).unwrap();
        assert_eq!(cancelled.status, "cancelled");

        // When (TC-PAY-P08-B03): Duplicate cancel
        let err_cancel_again =
            cancel_vendor_payment_impl(&mut conn, "tnt_test", "usr_admin", &p_cancel.id)
                .unwrap_err();
        assert_eq!(
            err_cancel_again,
            VendorPaymentError::InvalidStateTransition {
                from: "cancelled".to_string(),
                to: "cancelled".to_string(),
            }
        );

        // Post payment
        post_vendor_payment_impl(&mut conn, "tnt_test", "usr_admin", &p.id).unwrap();

        // When (TC-PAY-P08-B01): Duplicate post
        let err_post_again =
            post_vendor_payment_impl(&mut conn, "tnt_test", "usr_admin", &p.id).unwrap_err();
        assert_eq!(
            err_post_again,
            VendorPaymentError::InvalidStateTransition {
                from: "posted".to_string(),
                to: "posted".to_string(),
            }
        );

        // Check AP has paid 600, outstanding 400
        let ap_post = get_account_payable_impl(&conn, "tnt_test", &ap).unwrap();
        assert_eq!(ap_post.paid_amount, 600.0);
        assert_eq!(ap_post.outstanding_amount, 400.0);
        assert_eq!(
            ap_post.settlement_status,
            crate::accounts_payable::SettlementStatus::PartiallyPaid
        );

        // When (TC-PAY-P07-B01 & B-02): Void without reason
        let err_reason_empty =
            void_vendor_payment_impl(&mut conn, "tnt_test", "usr_admin", &p.id, "").unwrap_err();
        assert_eq!(err_reason_empty, VendorPaymentError::VoidReasonRequired);
        let err_reason_spaces =
            void_vendor_payment_impl(&mut conn, "tnt_test", "usr_admin", &p.id, "   ").unwrap_err();
        assert_eq!(err_reason_spaces, VendorPaymentError::VoidReasonRequired);

        // When (TC-PAY-P07-N01): Void with valid reason
        let voided = void_vendor_payment_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            &p.id,
            "手民之誤，金額核算錯誤",
        )
        .unwrap();
        assert_eq!(voided.status, "voided");
        assert_eq!(
            voided.void_reason.as_deref(),
            Some("手民之誤，金額核算錯誤")
        );

        // When (TC-PAY-P07-N02): Verify AP balances are restored
        let ap_restored = get_account_payable_impl(&conn, "tnt_test", &ap).unwrap();
        assert_eq!(ap_restored.paid_amount, 0.0);
        assert_eq!(ap_restored.outstanding_amount, 1000.0);
        assert_eq!(
            ap_restored.settlement_status,
            crate::accounts_payable::SettlementStatus::Unpaid
        );

        // When (TC-PAY-P08-B02): Duplicate void
        let err_void_again =
            void_vendor_payment_impl(&mut conn, "tnt_test", "usr_admin", &p.id, "again")
                .unwrap_err();
        assert_eq!(
            err_void_again,
            VendorPaymentError::InvalidStateTransition {
                from: "voided".to_string(),
                to: "voided".to_string(),
            }
        );
    }

    // ----------------------------------------------------
    // P-09 Tests: Tenant Isolation and Query Filtering
    // ----------------------------------------------------

    #[test]
    fn test_tc_pay_p09_tenant_isolation_and_filters() {
        let mut conn = setup_test_db();
        let today = get_today_local(&conn).unwrap();

        // Create 2nd tenant
        conn.execute(
            "INSERT INTO tenants (id, code, name, company_name, status) VALUES ('tnt_other', 'OTHER', 'Other Tenant', 'Other Co.', 'active')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO partners (id, tenant_id, name, is_vendor, is_active, created_at) VALUES ('vnd_other', 'tnt_other', 'Vendor Other', 1, 1, 1000)",
            [],
        ).unwrap();

        let p_tnt1 = create_vendor_payment_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateVendorPaymentInput {
                vendor_partner_id: "vnd_001".to_string(),
                payment_date: "2026-10-10".to_string(),
                payment_method: "bank_transfer".to_string(),
                payment_reference: None,
                note: None,
            },
        )
        .unwrap();

        let p_tnt2 = create_vendor_payment_impl(
            &mut conn,
            "tnt_other",
            "usr_admin",
            CreateVendorPaymentInput {
                vendor_partner_id: "vnd_other".to_string(),
                payment_date: today.clone(),
                payment_method: "cash".to_string(),
                payment_reference: None,
                note: None,
            },
        )
        .unwrap();

        // When (TC-PAY-P09-N01): Cross-tenant get
        let err_get = get_vendor_payment_impl(&conn, "tnt_test", &p_tnt2.id).unwrap_err();
        // Then: Not found
        assert_eq!(err_get, VendorPaymentError::NotFound);

        // When: Cross-tenant list
        let list1 = list_vendor_payments_impl(&conn, "tnt_test", None).unwrap();
        assert_eq!(list1.len(), 1);
        assert_eq!(list1[0].id, p_tnt1.id);

        let list2 = list_vendor_payments_impl(&conn, "tnt_other", None).unwrap();
        assert_eq!(list2.len(), 1);
        assert_eq!(list2[0].id, p_tnt2.id);

        // When (TC-PAY-P09-N02): Filter by vendor and status
        let filter_res = list_vendor_payments_impl(
            &conn,
            "tnt_test",
            Some(ListVendorPaymentsFilter {
                vendor_partner_id: Some("vnd_001".to_string()),
                status: Some("draft".to_string()),
                payment_date_from: Some("2026-10-01".to_string()),
                payment_date_to: Some("2026-10-31".to_string()),
            }),
        )
        .unwrap();
        assert_eq!(filter_res.len(), 1);
        assert_eq!(filter_res[0].id, p_tnt1.id);
    }
}
