use rusqlite::{params, Connection, Transaction};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::accounts_receivable;

static RECEIPT_ID_COUNTER: AtomicU64 = AtomicU64::new(1);
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

fn generate_receipt_id(now: i64) -> String {
    format!(
        "rcpt_{}_{}",
        now,
        RECEIPT_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

fn generate_allocation_id(now: i64) -> String {
    format!(
        "rcpta_{}_{}",
        now,
        ALLOC_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

// ==========================================
// Errors
// ==========================================

#[derive(Debug, thiserror::Error, PartialEq, Clone)]
pub enum CustomerReceiptError {
    #[error("租戶 ID 不可為空")]
    EmptyTenantId,

    #[error("找不到指定的租戶")]
    TenantNotFound,

    #[error("租戶未啟用或已停用")]
    TenantNotActive,

    #[error("無法解析有效使用者 session，操作被拒絕")]
    EmptyUserId,

    #[error("找不到指定的收款單")]
    NotFound,

    #[error("找不到指定的核銷記錄")]
    AllocationNotFound,

    #[error("找不到指定的客戶")]
    CustomerNotFound,

    #[error("指定夥伴不是客戶")]
    PartnerNotCustomer,

    #[error("指定客戶已停用")]
    CustomerInactive,

    #[error("找不到指定的應收帳款")]
    AccountReceivableNotFound,

    #[error("收款方式無效，僅支援 bank_transfer、cash、check、other")]
    InvalidReceiptMethod,

    #[error("幣別僅支援 'TWD'")]
    InvalidCurrency,

    #[error("僅能核銷同一客戶的未作廢應收")]
    InvalidAllocationAccountReceivable,

    #[error("同一張收款單內同一筆應收只能出現一次")]
    DuplicateAccountReceivableAllocation,

    #[error("核銷金額必須大於 0")]
    InvalidAllocationAmount,

    #[error("核銷金額 {0} 超過〔{1}〕未收餘額 {2}")]
    AllocationAmountExceedsOutstanding(String, String, String),

    #[error("收款日不可晚於今天")]
    ReceiptDateCannotBeInFuture,

    #[error("收款日不可早於〔{0}〕的單據日")]
    ReceiptDateEarlierThanDocumentDate(String),

    #[error("收款單至少需有 1 筆核銷方可過帳")]
    NoAllocationsToPost,

    #[error("〔{0}〕未收餘額已變為 {1}，不足核銷 {2}")]
    InsufficientOutstandingOnPost(String, String, String),

    #[error("收款單狀態為 {0}，不可修改")]
    NotDraftCannotModify(String),

    #[error("作廢需填寫原因")]
    VoidReasonRequired,

    #[error("無效的狀態轉換：不可從 {from} 轉換至 {to}")]
    InvalidStateTransition { from: String, to: String },

    #[error("資料庫錯誤: {0}")]
    DatabaseError(String),
}

impl From<rusqlite::Error> for CustomerReceiptError {
    fn from(err: rusqlite::Error) -> Self {
        CustomerReceiptError::DatabaseError(err.to_string())
    }
}

// ==========================================
// Domain & Data Models
// ==========================================

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct CustomerReceipt {
    pub id: String,
    pub tenant_id: String,
    pub receipt_number: String,
    pub customer_partner_id: String,
    pub customer_name_snapshot: String,
    pub receipt_date: String,
    pub receipt_method: String,
    pub receipt_reference: Option<String>,
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
pub struct CustomerReceiptAllocation {
    pub id: String,
    pub tenant_id: String,
    pub receipt_id: String,
    pub account_receivable_id: String,
    pub amount: f64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct CustomerReceiptAllocationDetail {
    pub id: String,
    pub receipt_id: String,
    pub account_receivable_id: String,
    pub amount: f64,
    pub created_at: i64,
    pub source_type: String,
    pub source_id: String,
    pub source_number: String,
    pub external_reference: Option<String>,
    pub document_date: String,
    pub due_date: String,
    pub ar_amount: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct CustomerReceiptDetail {
    pub id: String,
    pub tenant_id: String,
    pub receipt_number: String,
    pub customer_partner_id: String,
    pub customer_name_snapshot: String,
    pub receipt_date: String,
    pub receipt_method: String,
    pub receipt_reference: Option<String>,
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
    pub allocations: Vec<CustomerReceiptAllocationDetail>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct CustomerReceiptItem {
    pub id: String,
    pub tenant_id: String,
    pub receipt_number: String,
    pub customer_partner_id: String,
    pub customer_name_snapshot: String,
    pub receipt_date: String,
    pub receipt_method: String,
    pub receipt_reference: Option<String>,
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
pub struct CreateCustomerReceiptInput {
    pub customer_partner_id: String,
    pub receipt_date: String,
    pub receipt_method: String,
    pub receipt_reference: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct UpdateCustomerReceiptHeaderInput {
    pub id: Option<String>,
    pub receipt_id: Option<String>,
    pub receipt_date: String,
    pub receipt_method: String,
    pub receipt_reference: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
pub struct ListCustomerReceiptsFilter {
    pub customer_partner_id: Option<String>,
    pub status: Option<String>,
    pub receipt_method: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
}

// ==========================================
// Database Tables
// ==========================================

pub fn create_customer_receipt_tables(conn: &Connection) -> Result<(), rusqlite::Error> {
    let _ = conn.execute(
        "ALTER TABLE partners ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1",
        [],
    );

    conn.execute(
        "CREATE TABLE IF NOT EXISTS customer_receipts (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            receipt_number TEXT NOT NULL,
            customer_partner_id TEXT NOT NULL,
            customer_name_snapshot TEXT NOT NULL,
            receipt_date TEXT NOT NULL,
            receipt_method TEXT NOT NULL,
            receipt_reference TEXT,
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
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_cr_tenant_number ON customer_receipts (tenant_id, receipt_number)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_cr_tenant_customer ON customer_receipts (tenant_id, customer_partner_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_cr_tenant_date ON customer_receipts (tenant_id, receipt_date)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_cr_tenant_status ON customer_receipts (tenant_id, status)",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS customer_receipt_allocations (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            receipt_id TEXT NOT NULL,
            account_receivable_id TEXT NOT NULL,
            amount REAL NOT NULL,
            created_at INTEGER NOT NULL
        )",
        [],
    )?;

    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_cra_receipt_ar ON customer_receipt_allocations (receipt_id, account_receivable_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_cra_tenant_ar ON customer_receipt_allocations (tenant_id, account_receivable_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_cra_tenant_receipt ON customer_receipt_allocations (tenant_id, receipt_id)",
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

fn validate_tenant_active(conn: &Connection, tenant_id: &str) -> Result<(), CustomerReceiptError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(CustomerReceiptError::EmptyTenantId);
    }
    let status_res: Result<String, rusqlite::Error> = conn.query_row(
        "SELECT status FROM tenants WHERE id = ?1",
        params![tid],
        |r| r.get(0),
    );
    match status_res {
        Ok(s) if s == "active" => Ok(()),
        Ok(_) => Err(CustomerReceiptError::TenantNotActive),
        Err(rusqlite::Error::QueryReturnedNoRows) => Err(CustomerReceiptError::TenantNotFound),
        Err(rusqlite::Error::SqliteFailure(_, Some(ref msg)))
            if msg.contains("no such column: status") =>
        {
            let _ = conn.execute(
                "ALTER TABLE tenants ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
                [],
            );
            Ok(())
        }
        Err(e) => Err(CustomerReceiptError::DatabaseError(e.to_string())),
    }
}

fn validate_user_id(user_id: &str) -> Result<&str, CustomerReceiptError> {
    let uid = user_id.trim();
    if uid.is_empty() {
        Err(CustomerReceiptError::EmptyUserId)
    } else {
        Ok(uid)
    }
}

fn validate_receipt_method(method: &str) -> Result<&str, CustomerReceiptError> {
    let trimmed = method.trim();
    match trimmed {
        "bank_transfer" | "cash" | "check" | "other" => Ok(trimmed),
        _ => Err(CustomerReceiptError::InvalidReceiptMethod),
    }
}

fn next_receipt_number(tx: &Transaction, tenant_id: &str) -> Result<String, rusqlite::Error> {
    let mut stmt = tx.prepare(
        "SELECT COALESCE(MAX(CAST(SUBSTR(receipt_number, 6) AS INTEGER)), 0) + 1 
         FROM customer_receipts WHERE tenant_id = ?1",
    )?;
    let next_seq: i64 = stmt.query_row(params![tenant_id], |row| row.get(0))?;
    Ok(format!("RCPT-{:05}", next_seq))
}

fn resolve_customer_snapshot(
    conn: &Connection,
    tenant_id: &str,
    customer_partner_id: &str,
) -> Result<String, CustomerReceiptError> {
    let prep_res = conn.prepare(
        "SELECT name, is_customer, is_active 
         FROM partners 
         WHERE id = ?1 AND tenant_id = ?2",
    );

    let mut stmt = match prep_res {
        Ok(s) => s,
        Err(rusqlite::Error::SqliteFailure(_, Some(ref msg)))
            if msg.contains("no such column: is_active") =>
        {
            let _ = conn.execute(
                "ALTER TABLE partners ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1",
                [],
            );
            conn.prepare(
                "SELECT name, is_customer, is_active 
                 FROM partners 
                 WHERE id = ?1 AND tenant_id = ?2",
            )
            .map_err(|e| CustomerReceiptError::DatabaseError(e.to_string()))?
        }
        Err(e) => return Err(CustomerReceiptError::DatabaseError(e.to_string())),
    };

    let res = stmt.query_row(params![customer_partner_id, tenant_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, i64>(2)?,
        ))
    });

    match res {
        Ok((name, is_customer, is_active)) => {
            if is_customer != 1 {
                return Err(CustomerReceiptError::PartnerNotCustomer);
            }
            if is_active != 1 {
                return Err(CustomerReceiptError::CustomerInactive);
            }
            Ok(name)
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Err(CustomerReceiptError::CustomerNotFound),
        Err(e) => Err(CustomerReceiptError::DatabaseError(e.to_string())),
    }
}

/// Helper to get current AR info and dynamic outstanding balance (calling #222 shared calculation)
pub fn get_ar_info(
    conn: &Connection,
    tenant_id: &str,
    ar_id: &str,
) -> Result<(f64, f64, String, String, String, String), CustomerReceiptError> {
    let ar = match accounts_receivable::get_account_receivable_impl(conn, tenant_id, ar_id) {
        Ok(ar) => ar,
        Err(accounts_receivable::AccountsReceivableError::NotFound) => {
            return Err(CustomerReceiptError::AccountReceivableNotFound);
        }
        Err(e) => return Err(CustomerReceiptError::DatabaseError(e.to_string())),
    };

    Ok((
        ar.amount,
        ar.outstanding_amount,
        ar.source_number,
        ar.document_date,
        ar.status,
        ar.customer_partner_id,
    ))
}

// ==========================================
// Core Operations Implementation
// ==========================================

pub fn create_customer_receipt_impl(
    conn: &mut Connection,
    tenant_id: &str,
    user_id: &str,
    input: CreateCustomerReceiptInput,
) -> Result<CustomerReceiptDetail, CustomerReceiptError> {
    validate_tenant_active(conn, tenant_id)?;
    let uid = validate_user_id(user_id)?;
    let tid = tenant_id.trim();

    let customer_id = input.customer_partner_id.trim();
    if customer_id.is_empty() {
        return Err(CustomerReceiptError::CustomerNotFound);
    }

    validate_receipt_method(&input.receipt_method)?;
    let customer_snapshot = resolve_customer_snapshot(conn, tid, customer_id)?;

    let rcpt_date = input.receipt_date.trim();
    let today = get_today_local(conn)?;
    if rcpt_date > today.as_str() {
        return Err(CustomerReceiptError::ReceiptDateCannotBeInFuture);
    }

    let now = current_timestamp();
    let receipt_id = generate_receipt_id(now);

    let tx = conn.transaction()?;
    let receipt_num = next_receipt_number(&tx, tid)?;

    let ref_opt = input
        .receipt_reference
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let note_opt = input
        .note
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    tx.execute(
        "INSERT INTO customer_receipts (
            id, tenant_id, receipt_number, customer_partner_id, customer_name_snapshot,
            receipt_date, receipt_method, receipt_reference, note, currency,
            status, created_by, created_at, task_id
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5,
            ?6, ?7, ?8, ?9, 'TWD',
            'draft', ?10, ?11, NULL
        )",
        params![
            receipt_id,
            tid,
            receipt_num,
            customer_id,
            customer_snapshot,
            rcpt_date,
            input.receipt_method.trim(),
            ref_opt,
            note_opt,
            uid,
            now
        ],
    )?;

    tx.commit()?;

    get_customer_receipt_impl(conn, tid, &receipt_id)
}

pub fn update_customer_receipt_header_impl(
    conn: &mut Connection,
    tenant_id: &str,
    receipt_id: &str,
    input: UpdateCustomerReceiptHeaderInput,
) -> Result<CustomerReceiptDetail, CustomerReceiptError> {
    validate_tenant_active(conn, tenant_id)?;
    let tid = tenant_id.trim();
    let rid = receipt_id.trim();

    if rid.is_empty() {
        return Err(CustomerReceiptError::NotFound);
    }

    let status: String = conn
        .query_row(
            "SELECT status FROM customer_receipts WHERE id = ?1 AND tenant_id = ?2",
            params![rid, tid],
            |r| r.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => CustomerReceiptError::NotFound,
            _ => CustomerReceiptError::DatabaseError(e.to_string()),
        })?;

    if status != "draft" {
        return Err(CustomerReceiptError::NotDraftCannotModify(status));
    }

    validate_receipt_method(&input.receipt_method)?;

    let rcpt_date = input.receipt_date.trim();
    let today = get_today_local(conn)?;
    if rcpt_date > today.as_str() {
        return Err(CustomerReceiptError::ReceiptDateCannotBeInFuture);
    }

    let ref_opt = input
        .receipt_reference
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let note_opt = input
        .note
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    conn.execute(
        "UPDATE customer_receipts 
         SET receipt_date = ?1, receipt_method = ?2, receipt_reference = ?3, note = ?4
         WHERE id = ?5 AND tenant_id = ?6",
        params![
            rcpt_date,
            input.receipt_method.trim(),
            ref_opt,
            note_opt,
            rid,
            tid
        ],
    )?;

    get_customer_receipt_impl(conn, tid, rid)
}

pub fn add_customer_receipt_allocation_impl(
    conn: &mut Connection,
    tenant_id: &str,
    receipt_id: &str,
    account_receivable_id: &str,
    amount: f64,
) -> Result<CustomerReceiptDetail, CustomerReceiptError> {
    validate_tenant_active(conn, tenant_id)?;
    let tid = tenant_id.trim();
    let rid = receipt_id.trim();
    let ar_id = account_receivable_id.trim();

    if rid.is_empty() {
        return Err(CustomerReceiptError::NotFound);
    }
    if ar_id.is_empty() {
        return Err(CustomerReceiptError::AccountReceivableNotFound);
    }

    // Check receipt exists and is draft
    let (rcpt_status, rcpt_customer_id): (String, String) = conn
        .query_row(
            "SELECT status, customer_partner_id FROM customer_receipts WHERE id = ?1 AND tenant_id = ?2",
            params![rid, tid],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => CustomerReceiptError::NotFound,
            _ => CustomerReceiptError::DatabaseError(e.to_string()),
        })?;

    if rcpt_status != "draft" {
        return Err(CustomerReceiptError::NotDraftCannotModify(rcpt_status));
    }

    // RC-01: Same AR only once per receipt
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM customer_receipt_allocations WHERE receipt_id = ?1 AND account_receivable_id = ?2",
        params![rid, ar_id],
        |r| r.get(0),
    )?;

    if count > 0 {
        return Err(CustomerReceiptError::DuplicateAccountReceivableAllocation);
    }

    // RC-01: AR checks (same customer and open)
    let (_total_amount, outstanding, src_no, _doc_date, ar_status, ar_customer_id) =
        get_ar_info(conn, tid, ar_id)?;

    if ar_status != "open" || ar_customer_id != rcpt_customer_id {
        return Err(CustomerReceiptError::InvalidAllocationAccountReceivable);
    }

    // RC-02: Allocation amount > 0
    let rounded_amount = round_2(amount);
    if rounded_amount <= 0.0 {
        return Err(CustomerReceiptError::InvalidAllocationAmount);
    }

    // RC-02: Amount <= outstanding (only considering posted receipts)
    if rounded_amount > round_2(outstanding + 1e-6) {
        return Err(CustomerReceiptError::AllocationAmountExceedsOutstanding(
            format_amount(rounded_amount),
            src_no,
            format_amount(outstanding),
        ));
    }

    let now = current_timestamp();
    let alloc_id = generate_allocation_id(now);

    conn.execute(
        "INSERT INTO customer_receipt_allocations (
            id, tenant_id, receipt_id, account_receivable_id, amount, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![alloc_id, tid, rid, ar_id, rounded_amount, now],
    )?;

    get_customer_receipt_impl(conn, tid, rid)
}

pub fn update_customer_receipt_allocation_impl(
    conn: &mut Connection,
    tenant_id: &str,
    receipt_id: &str,
    allocation_id: &str,
    amount: f64,
) -> Result<CustomerReceiptDetail, CustomerReceiptError> {
    validate_tenant_active(conn, tenant_id)?;
    let tid = tenant_id.trim();
    let rid = receipt_id.trim();
    let alloc_id = allocation_id.trim();

    if rid.is_empty() {
        return Err(CustomerReceiptError::NotFound);
    }
    if alloc_id.is_empty() {
        return Err(CustomerReceiptError::AllocationNotFound);
    }

    let (rcpt_status, _): (String, String) = conn
        .query_row(
            "SELECT status, customer_partner_id FROM customer_receipts WHERE id = ?1 AND tenant_id = ?2",
            params![rid, tid],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => CustomerReceiptError::NotFound,
            _ => CustomerReceiptError::DatabaseError(e.to_string()),
        })?;

    if rcpt_status != "draft" {
        return Err(CustomerReceiptError::NotDraftCannotModify(rcpt_status));
    }

    let ar_id: String = {
        let mut stmt = conn
            .prepare(
                "SELECT account_receivable_id FROM customer_receipt_allocations WHERE id = ?1 AND receipt_id = ?2 AND tenant_id = ?3",
            )
            .map_err(|e| CustomerReceiptError::DatabaseError(e.to_string()))?;
        stmt.query_row(params![alloc_id, rid, tid], |r| r.get(0))
            .map_err(|_| CustomerReceiptError::AllocationNotFound)?
    };

    let (_total_amount, outstanding, src_no, _doc_date, _ar_status, _ar_customer_id) =
        get_ar_info(conn, tid, &ar_id)?;

    let rounded_amount = round_2(amount);
    if rounded_amount <= 0.0 {
        return Err(CustomerReceiptError::InvalidAllocationAmount);
    }

    // Check amount <= outstanding
    if rounded_amount > round_2(outstanding + 1e-6) {
        return Err(CustomerReceiptError::AllocationAmountExceedsOutstanding(
            format_amount(rounded_amount),
            src_no,
            format_amount(outstanding),
        ));
    }

    conn.execute(
        "UPDATE customer_receipt_allocations
         SET amount = ?1
         WHERE id = ?2 AND receipt_id = ?3 AND tenant_id = ?4",
        params![rounded_amount, alloc_id, rid, tid],
    )?;

    get_customer_receipt_impl(conn, tid, rid)
}

pub fn remove_customer_receipt_allocation_impl(
    conn: &mut Connection,
    tenant_id: &str,
    receipt_id: &str,
    allocation_id: &str,
) -> Result<CustomerReceiptDetail, CustomerReceiptError> {
    validate_tenant_active(conn, tenant_id)?;
    let tid = tenant_id.trim();
    let rid = receipt_id.trim();
    let alloc_id = allocation_id.trim();

    if rid.is_empty() {
        return Err(CustomerReceiptError::NotFound);
    }
    if alloc_id.is_empty() {
        return Err(CustomerReceiptError::AllocationNotFound);
    }

    let status: String = conn
        .query_row(
            "SELECT status FROM customer_receipts WHERE id = ?1 AND tenant_id = ?2",
            params![rid, tid],
            |r| r.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => CustomerReceiptError::NotFound,
            _ => CustomerReceiptError::DatabaseError(e.to_string()),
        })?;

    if status != "draft" {
        return Err(CustomerReceiptError::NotDraftCannotModify(status));
    }

    let affected = conn.execute(
        "DELETE FROM customer_receipt_allocations WHERE id = ?1 AND receipt_id = ?2 AND tenant_id = ?3",
        params![alloc_id, rid, tid],
    )?;

    if affected == 0 {
        return Err(CustomerReceiptError::AllocationNotFound);
    }

    get_customer_receipt_impl(conn, tid, rid)
}

pub fn post_customer_receipt_impl(
    conn: &mut Connection,
    tenant_id: &str,
    user_id: &str,
    receipt_id: &str,
) -> Result<CustomerReceiptDetail, CustomerReceiptError> {
    validate_tenant_active(conn, tenant_id)?;
    let uid = validate_user_id(user_id)?;
    let tid = tenant_id.trim();
    let rid = receipt_id.trim();

    if rid.is_empty() {
        return Err(CustomerReceiptError::NotFound);
    }

    let (current_status, rcpt_date, rcpt_customer_id): (String, String, String) = conn
        .query_row(
            "SELECT status, receipt_date, customer_partner_id FROM customer_receipts WHERE id = ?1 AND tenant_id = ?2",
            params![rid, tid],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => CustomerReceiptError::NotFound,
            _ => CustomerReceiptError::DatabaseError(e.to_string()),
        })?;

    if current_status == "posted" {
        return Err(CustomerReceiptError::InvalidStateTransition {
            from: "posted".to_string(),
            to: "posted".to_string(),
        });
    }

    if current_status != "draft" {
        return Err(CustomerReceiptError::InvalidStateTransition {
            from: current_status,
            to: "posted".to_string(),
        });
    }

    // RC-03: Receipt date cannot be in future
    let today = get_today_local(conn)?;
    if rcpt_date > today {
        return Err(CustomerReceiptError::ReceiptDateCannotBeInFuture);
    }

    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

    // Fetch allocations
    let allocations: Vec<(String, f64)> = {
        let mut stmt = tx.prepare(
            "SELECT account_receivable_id, amount 
             FROM customer_receipt_allocations 
             WHERE receipt_id = ?1 AND tenant_id = ?2",
        )?;
        let rows = stmt.query_map(params![rid, tid], |r| Ok((r.get(0)?, r.get(1)?)))?;
        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        list
    };

    // RC-03: At least 1 allocation to post
    if allocations.is_empty() {
        return Err(CustomerReceiptError::NoAllocationsToPost);
    }

    // Re-check each allocation in transaction
    for (ar_id, alloc_amount) in allocations {
        let (_total_amount, outstanding, src_no, doc_date, ar_status, ar_customer_id) =
            get_ar_info(&tx, tid, &ar_id)?;

        if ar_status != "open" || ar_customer_id != rcpt_customer_id {
            return Err(CustomerReceiptError::InvalidAllocationAccountReceivable);
        }

        // RC-03: Receipt date cannot be earlier than document date
        if rcpt_date < doc_date {
            return Err(CustomerReceiptError::ReceiptDateEarlierThanDocumentDate(
                src_no,
            ));
        }

        let rounded_alloc = round_2(alloc_amount);
        if rounded_alloc > round_2(outstanding + 1e-6) {
            return Err(CustomerReceiptError::InsufficientOutstandingOnPost(
                src_no,
                format_amount(outstanding),
                format_amount(rounded_alloc),
            ));
        }
    }

    let now = current_timestamp();
    tx.execute(
        "UPDATE customer_receipts 
         SET status = 'posted', posted_by = ?1, posted_at = ?2
         WHERE id = ?3 AND tenant_id = ?4",
        params![uid, now, rid, tid],
    )?;

    tx.commit()?;

    get_customer_receipt_impl(conn, tid, rid)
}

pub fn cancel_customer_receipt_impl(
    conn: &mut Connection,
    tenant_id: &str,
    user_id: &str,
    receipt_id: &str,
) -> Result<CustomerReceiptDetail, CustomerReceiptError> {
    validate_tenant_active(conn, tenant_id)?;
    let uid = validate_user_id(user_id)?;
    let tid = tenant_id.trim();
    let rid = receipt_id.trim();

    if rid.is_empty() {
        return Err(CustomerReceiptError::NotFound);
    }

    let current_status: String = conn
        .query_row(
            "SELECT status FROM customer_receipts WHERE id = ?1 AND tenant_id = ?2",
            params![rid, tid],
            |r| r.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => CustomerReceiptError::NotFound,
            _ => CustomerReceiptError::DatabaseError(e.to_string()),
        })?;

    if current_status == "cancelled" {
        return Err(CustomerReceiptError::InvalidStateTransition {
            from: "cancelled".to_string(),
            to: "cancelled".to_string(),
        });
    }

    if current_status != "draft" {
        return Err(CustomerReceiptError::InvalidStateTransition {
            from: current_status,
            to: "cancelled".to_string(),
        });
    }

    let now = current_timestamp();
    conn.execute(
        "UPDATE customer_receipts 
         SET status = 'cancelled', cancelled_by = ?1, cancelled_at = ?2
         WHERE id = ?3 AND tenant_id = ?4",
        params![uid, now, rid, tid],
    )?;

    get_customer_receipt_impl(conn, tid, rid)
}

pub fn void_customer_receipt_impl(
    conn: &mut Connection,
    tenant_id: &str,
    user_id: &str,
    receipt_id: &str,
    void_reason: &str,
) -> Result<CustomerReceiptDetail, CustomerReceiptError> {
    validate_tenant_active(conn, tenant_id)?;
    let uid = validate_user_id(user_id)?;
    let tid = tenant_id.trim();
    let rid = receipt_id.trim();

    if rid.is_empty() {
        return Err(CustomerReceiptError::NotFound);
    }

    let reason_trimmed = void_reason.trim();
    if reason_trimmed.is_empty() {
        return Err(CustomerReceiptError::VoidReasonRequired);
    }

    let current_status: String = conn
        .query_row(
            "SELECT status FROM customer_receipts WHERE id = ?1 AND tenant_id = ?2",
            params![rid, tid],
            |r| r.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => CustomerReceiptError::NotFound,
            _ => CustomerReceiptError::DatabaseError(e.to_string()),
        })?;

    if current_status == "voided" {
        return Err(CustomerReceiptError::InvalidStateTransition {
            from: "voided".to_string(),
            to: "voided".to_string(),
        });
    }

    if current_status != "posted" {
        return Err(CustomerReceiptError::InvalidStateTransition {
            from: current_status,
            to: "voided".to_string(),
        });
    }

    let now = current_timestamp();
    conn.execute(
        "UPDATE customer_receipts 
         SET status = 'voided', voided_by = ?1, voided_at = ?2, void_reason = ?3
         WHERE id = ?4 AND tenant_id = ?5",
        params![uid, now, reason_trimmed, rid, tid],
    )?;

    get_customer_receipt_impl(conn, tid, rid)
}

pub fn get_customer_receipt_impl(
    conn: &Connection,
    tenant_id: &str,
    receipt_id: &str,
) -> Result<CustomerReceiptDetail, CustomerReceiptError> {
    validate_tenant_active(conn, tenant_id)?;
    let tid = tenant_id.trim();
    let rid = receipt_id.trim();

    if rid.is_empty() {
        return Err(CustomerReceiptError::NotFound);
    }

    let receipt: CustomerReceipt = {
        let mut stmt = conn.prepare(
            "SELECT id, tenant_id, receipt_number, customer_partner_id, customer_name_snapshot,
                    receipt_date, receipt_method, receipt_reference, note, currency,
                    status, created_by, created_at, posted_by, posted_at,
                    cancelled_by, cancelled_at, voided_by, voided_at, void_reason, task_id
             FROM customer_receipts
             WHERE id = ?1 AND tenant_id = ?2",
        )?;
        stmt.query_row(params![rid, tid], |r| {
            Ok(CustomerReceipt {
                id: r.get(0)?,
                tenant_id: r.get(1)?,
                receipt_number: r.get(2)?,
                customer_partner_id: r.get(3)?,
                customer_name_snapshot: r.get(4)?,
                receipt_date: r.get(5)?,
                receipt_method: r.get(6)?,
                receipt_reference: r.get(7)?,
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
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => CustomerReceiptError::NotFound,
            _ => CustomerReceiptError::DatabaseError(e.to_string()),
        })?
    };

    let mut alloc_stmt = conn.prepare(
        "SELECT ra.id, ra.receipt_id, ra.account_receivable_id, ra.amount, ra.created_at,
                ar.source_type, ar.source_id, ar.source_number, ar.external_reference,
                ar.document_date, ar.due_date, ar.amount
         FROM customer_receipt_allocations ra
         JOIN accounts_receivable ar ON ar.id = ra.account_receivable_id AND ar.tenant_id = ra.tenant_id
         WHERE ra.receipt_id = ?1 AND ra.tenant_id = ?2
         ORDER BY ra.created_at ASC, ra.id ASC",
    )?;

    let alloc_rows = alloc_stmt.query_map(params![rid, tid], |r| {
        Ok(CustomerReceiptAllocationDetail {
            id: r.get(0)?,
            receipt_id: r.get(1)?,
            account_receivable_id: r.get(2)?,
            amount: round_2(r.get(3)?),
            created_at: r.get(4)?,
            source_type: r.get(5)?,
            source_id: r.get(6)?,
            source_number: r.get(7)?,
            external_reference: r.get(8)?,
            document_date: r.get(9)?,
            due_date: r.get(10)?,
            ar_amount: round_2(r.get(11)?),
        })
    })?;

    let mut allocations = Vec::new();
    let mut total_amount = 0.0;
    for a in alloc_rows {
        let item = a?;
        total_amount += item.amount;
        allocations.push(item);
    }

    Ok(CustomerReceiptDetail {
        id: receipt.id,
        tenant_id: receipt.tenant_id,
        receipt_number: receipt.receipt_number,
        customer_partner_id: receipt.customer_partner_id,
        customer_name_snapshot: receipt.customer_name_snapshot,
        receipt_date: receipt.receipt_date,
        receipt_method: receipt.receipt_method,
        receipt_reference: receipt.receipt_reference,
        note: receipt.note,
        total_amount: round_2(total_amount),
        currency: receipt.currency,
        status: receipt.status,
        created_by: receipt.created_by,
        created_at: receipt.created_at,
        posted_by: receipt.posted_by,
        posted_at: receipt.posted_at,
        cancelled_by: receipt.cancelled_by,
        cancelled_at: receipt.cancelled_at,
        voided_by: receipt.voided_by,
        voided_at: receipt.voided_at,
        void_reason: receipt.void_reason,
        task_id: receipt.task_id,
        allocations,
    })
}

pub fn list_customer_receipts_impl(
    conn: &Connection,
    tenant_id: &str,
    filter: Option<ListCustomerReceiptsFilter>,
) -> Result<Vec<CustomerReceiptItem>, CustomerReceiptError> {
    validate_tenant_active(conn, tenant_id)?;
    let tid = tenant_id.trim();

    let mut sql = String::from(
        "SELECT r.id, r.tenant_id, r.receipt_number, r.customer_partner_id, r.customer_name_snapshot,
                r.receipt_date, r.receipt_method, r.receipt_reference, r.note, r.currency,
                r.status, r.created_by, r.created_at, r.posted_by, r.posted_at,
                r.cancelled_by, r.cancelled_at, r.voided_by, r.voided_at, r.void_reason, r.task_id,
                COALESCE(SUM(ra.amount), 0.0) as total_amount,
                COUNT(ra.id) as allocation_count
         FROM customer_receipts r
         LEFT JOIN customer_receipt_allocations ra ON ra.receipt_id = r.id AND ra.tenant_id = r.tenant_id
         WHERE r.tenant_id = ?1",
    );

    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(tid.to_string())];
    let mut param_index = 2;

    if let Some(f) = filter {
        if let Some(ref cid) = f
            .customer_partner_id
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
        {
            sql.push_str(&format!(" AND r.customer_partner_id = ?{}", param_index));
            params_vec.push(Box::new(cid.clone()));
            param_index += 1;
        }

        if let Some(ref st) = f
            .status
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
        {
            sql.push_str(&format!(" AND r.status = ?{}", param_index));
            params_vec.push(Box::new(st.clone()));
            param_index += 1;
        }

        if let Some(ref m) = f
            .receipt_method
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
        {
            sql.push_str(&format!(" AND r.receipt_method = ?{}", param_index));
            params_vec.push(Box::new(m.clone()));
            param_index += 1;
        }

        if let Some(dt) = f
            .start_date
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
        {
            sql.push_str(&format!(" AND r.receipt_date >= ?{}", param_index));
            params_vec.push(Box::new(dt));
            param_index += 1;
        }

        if let Some(dt) = f
            .end_date
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
        {
            sql.push_str(&format!(" AND r.receipt_date <= ?{}", param_index));
            params_vec.push(Box::new(dt));
            let _ = param_index;
        }
    }

    sql.push_str(
        " GROUP BY r.id ORDER BY r.receipt_date DESC, r.created_at DESC, r.receipt_number DESC",
    );

    let mut stmt = conn.prepare(&sql)?;
    let slice: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();

    let rows = stmt.query_map(slice.as_slice(), |r| {
        Ok(CustomerReceiptItem {
            id: r.get(0)?,
            tenant_id: r.get(1)?,
            receipt_number: r.get(2)?,
            customer_partner_id: r.get(3)?,
            customer_name_snapshot: r.get(4)?,
            receipt_date: r.get(5)?,
            receipt_method: r.get(6)?,
            receipt_reference: r.get(7)?,
            note: r.get(8)?,
            total_amount: round_2(r.get(21)?),
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
            allocation_count: r.get::<_, i64>(22)? as usize,
        })
    })?;

    let mut list = Vec::new();
    for row in rows {
        list.push(row?);
    }
    Ok(list)
}

// ==========================================
// Tauri Commands
// ==========================================

#[tauri::command]
#[specta::specta]
pub async fn create_customer_receipt<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    input: CreateCustomerReceiptInput,
) -> Result<CustomerReceiptDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;
    create_customer_receipt_impl(&mut conn, &active_tid, &active_uid, input)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn update_customer_receipt_header<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    input: UpdateCustomerReceiptHeaderInput,
) -> Result<CustomerReceiptDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let rid = input
        .id
        .clone()
        .or_else(|| input.receipt_id.clone())
        .unwrap_or_default();
    update_customer_receipt_header_impl(&mut conn, &active_tid, &rid, input)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn add_customer_receipt_allocation<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    receipt_id: String,
    account_receivable_id: String,
    amount: f64,
) -> Result<CustomerReceiptDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    add_customer_receipt_allocation_impl(
        &mut conn,
        &active_tid,
        &receipt_id,
        &account_receivable_id,
        amount,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn update_customer_receipt_allocation<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    receipt_id: String,
    allocation_id: String,
    amount: f64,
) -> Result<CustomerReceiptDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    update_customer_receipt_allocation_impl(
        &mut conn,
        &active_tid,
        &receipt_id,
        &allocation_id,
        amount,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn remove_customer_receipt_allocation<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    receipt_id: String,
    allocation_id: String,
) -> Result<CustomerReceiptDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    remove_customer_receipt_allocation_impl(&mut conn, &active_tid, &receipt_id, &allocation_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn post_customer_receipt<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    receipt_id: Option<String>,
    id: Option<String>,
) -> Result<CustomerReceiptDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;
    let rid = receipt_id.or(id).unwrap_or_default();
    post_customer_receipt_impl(&mut conn, &active_tid, &active_uid, &rid).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_customer_receipt<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    receipt_id: Option<String>,
    id: Option<String>,
) -> Result<CustomerReceiptDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;
    let rid = receipt_id.or(id).unwrap_or_default();
    cancel_customer_receipt_impl(&mut conn, &active_tid, &active_uid, &rid)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn void_customer_receipt<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    receipt_id: Option<String>,
    id: Option<String>,
    void_reason: String,
) -> Result<CustomerReceiptDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;
    let rid = receipt_id.or(id).unwrap_or_default();
    void_customer_receipt_impl(&mut conn, &active_tid, &active_uid, &rid, &void_reason)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn get_customer_receipt<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    receipt_id: Option<String>,
    id: Option<String>,
) -> Result<CustomerReceiptDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let rid = receipt_id.or(id).unwrap_or_default();
    get_customer_receipt_impl(&conn, &active_tid, &rid).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn list_customer_receipts<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    filter: Option<ListCustomerReceiptsFilter>,
) -> Result<Vec<CustomerReceiptItem>, String> {
    let db_path = crate::get_db_path(&app_handle);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    list_customer_receipts_impl(&conn, &active_tid, filter).map_err(|e| e.to_string())
}

// ==========================================
// Unit & Integration Tests (Test Perspectives Table)
// ==========================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::accounts_receivable::{
        create_accounts_receivable_tables, get_account_receivable_impl,
    };

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE IF NOT EXISTS tenants (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                created_at INTEGER NOT NULL
            )",
            [],
        )
        .unwrap();

        conn.execute(
            "CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                username TEXT NOT NULL,
                display_name TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )",
            [],
        )
        .unwrap();

        conn.execute(
            "CREATE TABLE IF NOT EXISTS partners (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                name TEXT NOT NULL,
                is_customer INTEGER NOT NULL DEFAULT 1,
                is_vendor INTEGER NOT NULL DEFAULT 0,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER NOT NULL
            )",
            [],
        )
        .unwrap();

        create_accounts_receivable_tables(&conn).unwrap();
        create_customer_receipt_tables(&conn).unwrap();

        // Seed tenant & user
        conn.execute(
            "INSERT INTO tenants (id, name, status, created_at) VALUES ('tnt_test', 'Test Tenant', 'active', 1000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tenants (id, name, status, created_at) VALUES ('tnt_suspended', 'Suspended Tenant', 'suspended', 1000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO users (id, tenant_id, username, display_name, created_at) VALUES ('usr_admin', 'tnt_test', 'admin', 'Admin', 1000)",
            [],
        )
        .unwrap();

        // Seed partners
        conn.execute(
            "INSERT INTO partners (id, tenant_id, name, is_customer, is_vendor, is_active, created_at)
             VALUES ('cus_valid', 'tnt_test', '優良客戶有限公司', 1, 0, 1, 1000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO partners (id, tenant_id, name, is_customer, is_vendor, is_active, created_at)
             VALUES ('cus_inactive', 'tnt_test', '停用客戶', 1, 0, 0, 1000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO partners (id, tenant_id, name, is_customer, is_vendor, is_active, created_at)
             VALUES ('ven_not_customer', 'tnt_test', '純供應商', 0, 1, 1, 1000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO partners (id, tenant_id, name, is_customer, is_vendor, is_active, created_at)
             VALUES ('cus_other', 'tnt_test', '另一位客戶', 1, 0, 1, 1000)",
            [],
        )
        .unwrap();

        conn
    }

    fn insert_ar(
        conn: &Connection,
        tenant_id: &str,
        id: &str,
        customer_id: &str,
        source_number: &str,
        doc_date: &str,
        due_date: &str,
        amount: f64,
        status: &str,
    ) {
        conn.execute(
            "INSERT INTO accounts_receivable (
                id, tenant_id, customer_partner_id, customer_name_snapshot,
                source_type, source_id, source_number, external_reference,
                document_date, due_date, amount, currency, status,
                created_by, created_at
            ) VALUES (?1, ?2, ?3, '快照', 'customer_invoice', ?1, ?4, NULL, ?5, ?6, ?7, 'TWD', ?8, 'usr_admin', 1000)",
            params![id, tenant_id, customer_id, source_number, doc_date, due_date, amount, status],
        )
        .unwrap();
    }

    #[test]
    fn test_create_customer_receipt_and_basic_validations() {
        let mut conn = setup_test_db();
        let today = get_today_local(&conn).unwrap();

        let input = CreateCustomerReceiptInput {
            customer_partner_id: "cus_valid".to_string(),
            receipt_date: today.clone(),
            receipt_method: "bank_transfer".to_string(),
            receipt_reference: Some("REF-123".to_string()),
            note: Some("一般收款".to_string()),
        };

        // Given: Valid input and active tenant
        // When: Creating customer receipt
        let res = create_customer_receipt_impl(&mut conn, "tnt_test", "usr_admin", input.clone());
        // Then: Successfully created in draft state with RCPT-00001
        assert!(res.is_ok());
        let rcpt = res.unwrap();
        assert_eq!(rcpt.receipt_number, "RCPT-00001");
        assert_eq!(rcpt.status, "draft");
        assert_eq!(rcpt.total_amount, 0.0);
        assert_eq!(rcpt.customer_name_snapshot, "優良客戶有限公司");

        // When (TC-RC-01-E01): Empty tenant_id
        let err1 =
            create_customer_receipt_impl(&mut conn, "", "usr_admin", input.clone()).unwrap_err();
        // Then: Fails with EmptyTenantId
        assert_eq!(err1, CustomerReceiptError::EmptyTenantId);

        // When: Suspended tenant
        let err2 =
            create_customer_receipt_impl(&mut conn, "tnt_suspended", "usr_admin", input.clone())
                .unwrap_err();
        // Then: Fails with TenantNotActive
        assert_eq!(err2, CustomerReceiptError::TenantNotActive);

        // When: Empty user id
        let err3 =
            create_customer_receipt_impl(&mut conn, "tnt_test", "", input.clone()).unwrap_err();
        // Then: Fails with EmptyUserId
        assert_eq!(err3, CustomerReceiptError::EmptyUserId);

        // When: Inactive customer
        let err_inactive = create_customer_receipt_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateCustomerReceiptInput {
                customer_partner_id: "cus_inactive".to_string(),
                ..input.clone()
            },
        )
        .unwrap_err();
        // Then: Fails with CustomerInactive
        assert_eq!(err_inactive, CustomerReceiptError::CustomerInactive);

        // When: Partner not customer
        let err_not_cus = create_customer_receipt_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateCustomerReceiptInput {
                customer_partner_id: "ven_not_customer".to_string(),
                ..input.clone()
            },
        )
        .unwrap_err();
        // Then: Fails with PartnerNotCustomer
        assert_eq!(err_not_cus, CustomerReceiptError::PartnerNotCustomer);

        // When (TC-RC-03-E01): Future receipt date
        let err_future = create_customer_receipt_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateCustomerReceiptInput {
                receipt_date: "2099-12-31".to_string(),
                ..input.clone()
            },
        )
        .unwrap_err();
        // Then: Fails with ReceiptDateCannotBeInFuture
        assert_eq!(
            err_future,
            CustomerReceiptError::ReceiptDateCannotBeInFuture
        );
    }

    #[test]
    fn test_rc_01_allocation_partner_and_duplicate_guard() {
        let mut conn = setup_test_db();
        let today = get_today_local(&conn).unwrap();

        insert_ar(
            &conn,
            "tnt_test",
            "ar_valid",
            "cus_valid",
            "INV-001",
            "2026-01-01",
            "2026-01-10",
            1000.0,
            "open",
        );
        insert_ar(
            &conn,
            "tnt_test",
            "ar_other_cus",
            "cus_other",
            "INV-002",
            "2026-01-01",
            "2026-01-10",
            500.0,
            "open",
        );
        insert_ar(
            &conn,
            "tnt_test",
            "ar_voided",
            "cus_valid",
            "INV-003",
            "2026-01-01",
            "2026-01-10",
            300.0,
            "voided",
        );

        let rcpt = create_customer_receipt_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateCustomerReceiptInput {
                customer_partner_id: "cus_valid".to_string(),
                receipt_date: today.clone(),
                receipt_method: "bank_transfer".to_string(),
                receipt_reference: None,
                note: None,
            },
        )
        .unwrap();

        // When (TC-RC-01-E01): Adding AR of different customer
        let err_diff = add_customer_receipt_allocation_impl(
            &mut conn,
            "tnt_test",
            &rcpt.id,
            "ar_other_cus",
            100.0,
        )
        .unwrap_err();
        // Then: Rejected with InvalidAllocationAccountReceivable
        assert_eq!(
            err_diff,
            CustomerReceiptError::InvalidAllocationAccountReceivable
        );

        // When (TC-RC-01-E02): Adding voided AR
        let err_voided = add_customer_receipt_allocation_impl(
            &mut conn,
            "tnt_test",
            &rcpt.id,
            "ar_voided",
            100.0,
        )
        .unwrap_err();
        // Then: Rejected with InvalidAllocationAccountReceivable
        assert_eq!(
            err_voided,
            CustomerReceiptError::InvalidAllocationAccountReceivable
        );

        // When (TC-RC-01-E03): Nonexistent AR
        let err_nonexistent = add_customer_receipt_allocation_impl(
            &mut conn,
            "tnt_test",
            &rcpt.id,
            "ar_not_found",
            100.0,
        )
        .unwrap_err();
        // Then: Rejected with AccountReceivableNotFound
        assert_eq!(
            err_nonexistent,
            CustomerReceiptError::AccountReceivableNotFound
        );

        // When (TC-RC-01-N01): Adding valid AR
        let updated = add_customer_receipt_allocation_impl(
            &mut conn, "tnt_test", &rcpt.id, "ar_valid", 400.0,
        )
        .unwrap();
        // Then: Allocation added and total amount updated
        assert_eq!(updated.allocations.len(), 1);
        assert_eq!(updated.total_amount, 400.0);

        // When (TC-RC-01-E04): Adding same AR duplicate time
        let err_dup = add_customer_receipt_allocation_impl(
            &mut conn, "tnt_test", &rcpt.id, "ar_valid", 200.0,
        )
        .unwrap_err();
        // Then: Rejected with DuplicateAccountReceivableAllocation
        assert_eq!(
            err_dup,
            CustomerReceiptError::DuplicateAccountReceivableAllocation
        );
    }

    #[test]
    fn test_rc_02_amount_boundaries_and_exceed_checks() {
        let mut conn = setup_test_db();
        let today = get_today_local(&conn).unwrap();

        insert_ar(
            &conn,
            "tnt_test",
            "ar_1000",
            "cus_valid",
            "INV-1000",
            "2026-01-01",
            "2026-01-10",
            1000.0,
            "open",
        );

        let rcpt = create_customer_receipt_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateCustomerReceiptInput {
                customer_partner_id: "cus_valid".to_string(),
                receipt_date: today.clone(),
                receipt_method: "cash".to_string(),
                receipt_reference: None,
                note: None,
            },
        )
        .unwrap();

        // When (TC-RC-02-E01): 0 amount
        let err_zero =
            add_customer_receipt_allocation_impl(&mut conn, "tnt_test", &rcpt.id, "ar_1000", 0.0)
                .unwrap_err();
        // Then: Rejected with InvalidAllocationAmount
        assert_eq!(err_zero, CustomerReceiptError::InvalidAllocationAmount);

        // When (TC-RC-02-E02): Negative amount (-1)
        let err_neg =
            add_customer_receipt_allocation_impl(&mut conn, "tnt_test", &rcpt.id, "ar_1000", -1.0)
                .unwrap_err();
        // Then: Rejected with InvalidAllocationAmount
        assert_eq!(err_neg, CustomerReceiptError::InvalidAllocationAmount);

        // When (TC-RC-02-E03): 0.004 rounding to 0
        let err_round_zero =
            add_customer_receipt_allocation_impl(&mut conn, "tnt_test", &rcpt.id, "ar_1000", 0.004)
                .unwrap_err();
        // Then: Rejected with InvalidAllocationAmount
        assert_eq!(
            err_round_zero,
            CustomerReceiptError::InvalidAllocationAmount
        );

        // When (TC-RC-02-E04): Exceeds outstanding by 1 (1001)
        let err_exceed = add_customer_receipt_allocation_impl(
            &mut conn, "tnt_test", &rcpt.id, "ar_1000", 1001.0,
        )
        .unwrap_err();
        // Then: Rejected with AllocationAmountExceedsOutstanding
        assert_eq!(
            err_exceed,
            CustomerReceiptError::AllocationAmountExceedsOutstanding(
                "1001".to_string(),
                "INV-1000".to_string(),
                "1000".to_string()
            )
        );

        // When (TC-RC-02-N01): Exactly 1000.0 (full payment)
        let ok_alloc = add_customer_receipt_allocation_impl(
            &mut conn, "tnt_test", &rcpt.id, "ar_1000", 1000.0,
        );
        // Then: Successfully added
        assert!(ok_alloc.is_ok());
        assert_eq!(ok_alloc.unwrap().total_amount, 1000.0);
    }

    #[test]
    fn test_rc_03_post_date_and_zero_allocations_check() {
        let mut conn = setup_test_db();
        let today = get_today_local(&conn).unwrap();

        insert_ar(
            &conn,
            "tnt_test",
            "ar_dated",
            "cus_valid",
            "INV-DATE",
            "2026-06-15",
            "2026-06-30",
            500.0,
            "open",
        );

        // Given: Receipt with no allocations
        let rcpt_empty = create_customer_receipt_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateCustomerReceiptInput {
                customer_partner_id: "cus_valid".to_string(),
                receipt_date: today.clone(),
                receipt_method: "cash".to_string(),
                receipt_reference: None,
                note: None,
            },
        )
        .unwrap();

        // When (TC-RC-03-E03): Attempting to post empty receipt
        let err_empty =
            post_customer_receipt_impl(&mut conn, "tnt_test", "usr_admin", &rcpt_empty.id)
                .unwrap_err();
        // Then: Rejected with NoAllocationsToPost
        assert_eq!(err_empty, CustomerReceiptError::NoAllocationsToPost);

        // Given: Receipt date earlier than AR document date (2026-06-14 vs 2026-06-15)
        let rcpt_early = create_customer_receipt_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateCustomerReceiptInput {
                customer_partner_id: "cus_valid".to_string(),
                receipt_date: "2026-06-14".to_string(),
                receipt_method: "check".to_string(),
                receipt_reference: None,
                note: None,
            },
        )
        .unwrap();
        add_customer_receipt_allocation_impl(
            &mut conn,
            "tnt_test",
            &rcpt_early.id,
            "ar_dated",
            300.0,
        )
        .unwrap();

        // When (TC-RC-03-E02): Attempting to post early receipt
        let err_early =
            post_customer_receipt_impl(&mut conn, "tnt_test", "usr_admin", &rcpt_early.id)
                .unwrap_err();
        // Then: Rejected with ReceiptDateEarlierThanDocumentDate
        assert_eq!(
            err_early,
            CustomerReceiptError::ReceiptDateEarlierThanDocumentDate("INV-DATE".to_string())
        );

        // Given (TC-RC-03-N02): Receipt date exactly matches AR document date (2026-06-15)
        let rcpt_match_date = create_customer_receipt_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateCustomerReceiptInput {
                customer_partner_id: "cus_valid".to_string(),
                receipt_date: "2026-06-15".to_string(),
                receipt_method: "check".to_string(),
                receipt_reference: None,
                note: None,
            },
        )
        .unwrap();
        add_customer_receipt_allocation_impl(
            &mut conn,
            "tnt_test",
            &rcpt_match_date.id,
            "ar_dated",
            300.0,
        )
        .unwrap();

        // When: Posting receipt with receipt_date == document_date
        let posted =
            post_customer_receipt_impl(&mut conn, "tnt_test", "usr_admin", &rcpt_match_date.id);
        // Then: Successfully posted
        assert!(posted.is_ok());
        assert_eq!(posted.unwrap().status, "posted");
    }

    #[test]
    fn test_concurrent_drafts_and_atomic_post_recheck() {
        let mut conn = setup_test_db();
        let today = get_today_local(&conn).unwrap();

        insert_ar(
            &conn,
            "tnt_test",
            "ar_conc",
            "cus_valid",
            "INV-CONC",
            "2026-01-01",
            "2026-01-10",
            600.0,
            "open",
        );

        // Given: Two drafts allocating full balance
        let d1 = create_customer_receipt_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateCustomerReceiptInput {
                customer_partner_id: "cus_valid".to_string(),
                receipt_date: today.clone(),
                receipt_method: "bank_transfer".to_string(),
                receipt_reference: None,
                note: None,
            },
        )
        .unwrap();
        add_customer_receipt_allocation_impl(&mut conn, "tnt_test", &d1.id, "ar_conc", 600.0)
            .unwrap();

        let d2 = create_customer_receipt_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateCustomerReceiptInput {
                customer_partner_id: "cus_valid".to_string(),
                receipt_date: today.clone(),
                receipt_method: "cash".to_string(),
                receipt_reference: None,
                note: None,
            },
        )
        .unwrap();
        add_customer_receipt_allocation_impl(&mut conn, "tnt_test", &d2.id, "ar_conc", 600.0)
            .unwrap();

        // When: Draft 1 posts successfully
        let posted1 =
            post_customer_receipt_impl(&mut conn, "tnt_test", "usr_admin", &d1.id).unwrap();
        assert_eq!(posted1.status, "posted");

        // When (TC-RC-02-E05): Draft 2 attempts to post
        let err2 =
            post_customer_receipt_impl(&mut conn, "tnt_test", "usr_admin", &d2.id).unwrap_err();
        // Then: Blocked with InsufficientOutstandingOnPost because balance is now 0
        assert_eq!(
            err2,
            CustomerReceiptError::InsufficientOutstandingOnPost(
                "INV-CONC".to_string(),
                "0".to_string(),
                "600".to_string()
            )
        );

        // Then: AR is fully paid and settlement_status is Paid
        let ar_detail = get_account_receivable_impl(&conn, "tnt_test", "ar_conc").unwrap();
        assert_eq!(ar_detail.received_amount, 600.0);
        assert_eq!(ar_detail.outstanding_amount, 0.0);
        assert_eq!(
            ar_detail.settlement_status,
            accounts_receivable::SettlementStatus::Paid
        );
    }

    #[test]
    fn test_void_receipt_restores_ar_balance() {
        let mut conn = setup_test_db();
        let today = get_today_local(&conn).unwrap();

        insert_ar(
            &conn,
            "tnt_test",
            "ar_void_test",
            "cus_valid",
            "INV-RESTORE",
            "2026-01-01",
            "2026-01-10",
            1000.0,
            "open",
        );

        let rcpt = create_customer_receipt_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateCustomerReceiptInput {
                customer_partner_id: "cus_valid".to_string(),
                receipt_date: today.clone(),
                receipt_method: "bank_transfer".to_string(),
                receipt_reference: None,
                note: None,
            },
        )
        .unwrap();
        add_customer_receipt_allocation_impl(
            &mut conn,
            "tnt_test",
            &rcpt.id,
            "ar_void_test",
            400.0,
        )
        .unwrap();

        // Post receipt
        post_customer_receipt_impl(&mut conn, "tnt_test", "usr_admin", &rcpt.id).unwrap();

        // Check AR partially paid
        let ar_mid = get_account_receivable_impl(&conn, "tnt_test", "ar_void_test").unwrap();
        assert_eq!(ar_mid.received_amount, 400.0);
        assert_eq!(ar_mid.outstanding_amount, 600.0);
        assert_eq!(
            ar_mid.settlement_status,
            accounts_receivable::SettlementStatus::PartiallyPaid
        );

        // When (TC-RC-P07-E01): Voiding without reason
        let err_no_reason =
            void_customer_receipt_impl(&mut conn, "tnt_test", "usr_admin", &rcpt.id, "   ")
                .unwrap_err();
        assert_eq!(err_no_reason, CustomerReceiptError::VoidReasonRequired);

        // When (TC-RC-P07-N01): Voiding with reason
        let voided = void_customer_receipt_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            &rcpt.id,
            "客戶要求退回重新開立",
        )
        .unwrap();
        assert_eq!(voided.status, "voided");
        assert_eq!(voided.void_reason.as_deref(), Some("客戶要求退回重新開立"));

        // Then: AR balance is fully restored to 1000 outstanding, 0 received, Unpaid status!
        let ar_restored = get_account_receivable_impl(&conn, "tnt_test", "ar_void_test").unwrap();
        assert_eq!(ar_restored.received_amount, 0.0);
        assert_eq!(ar_restored.outstanding_amount, 1000.0);
        assert_eq!(
            ar_restored.settlement_status,
            accounts_receivable::SettlementStatus::Unpaid
        );

        // When (TC-RC-P08-E02): Double voiding
        let err_double_void =
            void_customer_receipt_impl(&mut conn, "tnt_test", "usr_admin", &rcpt.id, "再次作廢")
                .unwrap_err();
        assert_eq!(
            err_double_void,
            CustomerReceiptError::InvalidStateTransition {
                from: "voided".to_string(),
                to: "voided".to_string()
            }
        );
    }

    #[test]
    fn test_modify_guard_and_cancel_state_machine() {
        let mut conn = setup_test_db();
        let today = get_today_local(&conn).unwrap();

        insert_ar(
            &conn,
            "tnt_test",
            "ar_guard",
            "cus_valid",
            "INV-GUARD",
            "2026-01-01",
            "2026-01-10",
            800.0,
            "open",
        );

        let rcpt = create_customer_receipt_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateCustomerReceiptInput {
                customer_partner_id: "cus_valid".to_string(),
                receipt_date: today.clone(),
                receipt_method: "cash".to_string(),
                receipt_reference: None,
                note: None,
            },
        )
        .unwrap();
        let alloc_rcpt = add_customer_receipt_allocation_impl(
            &mut conn, "tnt_test", &rcpt.id, "ar_guard", 300.0,
        )
        .unwrap();
        let alloc_id = alloc_rcpt.allocations[0].id.clone();

        // When: Cancel draft
        let cancelled =
            cancel_customer_receipt_impl(&mut conn, "tnt_test", "usr_admin", &rcpt.id).unwrap();
        assert_eq!(cancelled.status, "cancelled");

        // When (TC-RC-P06-E01): Modify cancelled receipt
        let err_modify = update_customer_receipt_header_impl(
            &mut conn,
            "tnt_test",
            &rcpt.id,
            UpdateCustomerReceiptHeaderInput {
                id: Some(rcpt.id.clone()),
                receipt_id: None,
                receipt_date: today.clone(),
                receipt_method: "cash".to_string(),
                receipt_reference: None,
                note: None,
            },
        )
        .unwrap_err();
        assert_eq!(
            err_modify,
            CustomerReceiptError::NotDraftCannotModify("cancelled".to_string())
        );

        // When: Add allocation to cancelled receipt
        let err_add = add_customer_receipt_allocation_impl(
            &mut conn, "tnt_test", &rcpt.id, "ar_guard", 100.0,
        )
        .unwrap_err();
        assert_eq!(
            err_add,
            CustomerReceiptError::NotDraftCannotModify("cancelled".to_string())
        );

        // When: Update allocation of cancelled receipt
        let err_upd = update_customer_receipt_allocation_impl(
            &mut conn, "tnt_test", &rcpt.id, &alloc_id, 200.0,
        )
        .unwrap_err();
        assert_eq!(
            err_upd,
            CustomerReceiptError::NotDraftCannotModify("cancelled".to_string())
        );

        // When: Remove allocation of cancelled receipt
        let err_rem =
            remove_customer_receipt_allocation_impl(&mut conn, "tnt_test", &rcpt.id, &alloc_id)
                .unwrap_err();
        assert_eq!(
            err_rem,
            CustomerReceiptError::NotDraftCannotModify("cancelled".to_string())
        );
    }
}
