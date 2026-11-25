use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::accounts_payable::{calendar_day_diff, is_valid_ymd_string, AgingBucket};

static AR_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

fn current_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

pub fn round_2(val: f64) -> f64 {
    (val * 100.0).round() / 100.0
}

fn generate_ar_id(now: i64) -> String {
    format!(
        "ar_{}_{}",
        now,
        AR_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

// ==========================================
// Errors
// ==========================================

#[derive(Debug, thiserror::Error, PartialEq, Clone)]
pub enum AccountsReceivableError {
    #[error("Tenant ID cannot be empty")]
    EmptyTenantId,

    #[error("無法解析有效使用者 session，操作被拒絕")]
    EmptyUserId,

    #[error("應收帳款 ID 不可為空")]
    EmptyAccountReceivableId,

    #[error("找不到指定的應收帳款或不屬於目前租戶")]
    NotFound,

    #[error("找不到指定的客戶或不屬於目前租戶")]
    CustomerNotFound,

    #[error("指定的合作夥伴不是客戶 (is_customer != 1)")]
    PartnerNotCustomer,

    #[error("應收金額必須大於 0")]
    InvalidAmount,

    #[error("到期日不可早於單據日")]
    DueDateEarlierThanDocumentDate,

    #[error("幣別僅支援 'TWD'")]
    InvalidCurrency,

    #[error("來源類型必須為 'customer_invoice' 或 'opening_balance'")]
    InvalidSourceType,

    #[error("來源單號不可為空")]
    EmptySourceNumber,

    #[error("同一個來源單據最多只能有一筆未結案 (open) 的應收帳款")]
    DuplicateOpenSource,

    #[error("此應收已有收款核銷：{0}，請先作廢收款單")]
    HasPostedReceiptAllocations(String),

    #[error("此應收已有折讓單：{0}，請先作廢折讓單")]
    HasPostedAllowances(String),

    #[error("此應收已有銷退單：{0}，請先作廢退回單")]
    HasPostedReturns(String),

    #[error("原因必填")]
    VoidReasonRequired,

    #[error("起日不可晚於迄日")]
    InvalidDateRange,

    #[error("無效的日期格式，需為 YYYY-MM-DD")]
    InvalidDateFormat,

    #[error("無效的狀態轉換")]
    InvalidStateTransition { from: String, to: String },

    #[error("資料庫錯誤: {0}")]
    DatabaseError(String),
}

impl From<rusqlite::Error> for AccountsReceivableError {
    fn from(err: rusqlite::Error) -> Self {
        AccountsReceivableError::DatabaseError(err.to_string())
    }
}

// ==========================================
// Domain & Data Models
// ==========================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum SettlementStatus {
    #[serde(alias = "未收")]
    Unpaid,
    #[serde(alias = "partial", alias = "部分收款")]
    PartiallyPaid,
    #[serde(alias = "已收清")]
    Paid,
}

impl SettlementStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            SettlementStatus::Unpaid => "unpaid",
            SettlementStatus::PartiallyPaid => "partially_paid",
            SettlementStatus::Paid => "paid",
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            SettlementStatus::Unpaid => "未收",
            SettlementStatus::PartiallyPaid => "部分收款",
            SettlementStatus::Paid => "已收清",
        }
    }

    pub fn from_filter_str(s: &str) -> Option<Self> {
        let trimmed = s.trim();
        if trimmed.eq_ignore_ascii_case("unpaid") || trimmed == "未收" {
            Some(SettlementStatus::Unpaid)
        } else if trimmed.eq_ignore_ascii_case("partially_paid")
            || trimmed.eq_ignore_ascii_case("partial")
            || trimmed == "部分收款"
        {
            Some(SettlementStatus::PartiallyPaid)
        } else if trimmed.eq_ignore_ascii_case("paid") || trimmed == "已收清" {
            Some(SettlementStatus::Paid)
        } else {
            None
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct AccountReceivable {
    pub id: String,
    pub tenant_id: String,
    pub customer_partner_id: String,
    pub customer_name_snapshot: String,
    pub source_type: String,
    pub source_id: String,
    pub source_number: String,
    pub external_reference: Option<String>,
    pub document_date: String,
    pub due_date: String,
    pub amount: f64,
    pub currency: String,
    pub status: String,
    pub created_by: String,
    pub created_at: i64,
    pub voided_by: Option<String>,
    pub voided_at: Option<i64>,
    pub void_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct ReceiptAllocationDetail {
    pub id: String,
    pub receipt_id: String,
    pub receipt_number: String,
    pub amount: f64,
    pub receipt_date: String,
    pub receipt_status: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct AccountReceivableDetail {
    pub id: String,
    pub tenant_id: String,
    pub customer_partner_id: String,
    pub customer_name_snapshot: String,
    pub source_type: String,
    pub source_id: String,
    pub source_number: String,
    pub external_reference: Option<String>,
    pub document_date: String,
    pub due_date: String,
    pub amount: f64,
    pub currency: String,
    pub status: String,
    pub created_by: String,
    pub created_at: i64,
    pub voided_by: Option<String>,
    pub voided_at: Option<i64>,
    pub void_reason: Option<String>,
    // Derived values
    pub received_amount: f64,
    pub allowance_amount: f64,
    pub outstanding_amount: f64,
    pub settlement_status: SettlementStatus,
    // Allocations
    pub allocations: Vec<ReceiptAllocationDetail>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct AccountReceivableItem {
    pub id: String,
    pub tenant_id: String,
    pub customer_partner_id: String,
    pub customer_name_snapshot: String,
    pub source_type: String,
    pub source_id: String,
    pub source_number: String,
    pub external_reference: Option<String>,
    pub document_date: String,
    pub due_date: String,
    pub amount: f64,
    pub currency: String,
    pub status: String,
    pub created_by: String,
    pub created_at: i64,
    pub voided_by: Option<String>,
    pub voided_at: Option<i64>,
    pub void_reason: Option<String>,
    // Derived values
    pub received_amount: f64,
    pub allowance_amount: f64,
    pub outstanding_amount: f64,
    pub settlement_status: SettlementStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAccountReceivableInput {
    pub customer_partner_id: String,
    pub source_type: String,
    pub source_id: String,
    pub source_number: String,
    pub external_reference: Option<String>,
    pub document_date: String,
    pub due_date: String,
    pub amount: f64,
    pub currency: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ListAccountsReceivableFilter {
    pub customer_partner_id: Option<String>,
    pub settlement_status: Option<String>,
    pub status: Option<String>,
    pub due_date_from: Option<String>,
    pub due_date_to: Option<String>,
}

// ==========================================
// Statement Models (Issue #229)
// ==========================================

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct StatementReceivableItem {
    pub account_receivable_id: String,
    pub source_type: String,
    pub source_id: String,
    pub source_number: String,
    pub external_reference: Option<String>,
    pub document_date: String,
    pub due_date: String,
    pub amount: f64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct StatementReceiptAllocation {
    pub account_receivable_id: String,
    pub source_type: String,
    pub source_id: String,
    pub source_number: String,
    pub amount: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct StatementReceiptItem {
    pub receipt_id: String,
    pub receipt_number: String,
    pub receipt_date: String,
    pub receipt_method: String,
    pub receipt_reference: Option<String>,
    pub amount: f64,
    pub note: Option<String>,
    pub allocations: Vec<StatementReceiptAllocation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct StatementAllowanceItem {
    pub allowance_id: String,
    pub allowance_number: String,
    pub allowance_date: String,
    pub customer_invoice_id: String,
    pub invoice_number_snapshot: String,
    pub account_receivable_id: String,
    pub reason_type: String,
    pub untaxed_amount: f64,
    pub tax_amount: f64,
    pub total_amount: f64,
    pub external_reference: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct CustomerStatement {
    pub tenant_id: String,
    pub customer_partner_id: String,
    pub customer_name: String,
    pub start_date: String,
    pub end_date: String,
    pub opening_balance: f64,
    pub current_receivables_total: f64,
    pub current_receipts_total: f64,
    pub current_allowances_total: f64,
    pub closing_balance: f64,
    pub receivables: Vec<StatementReceivableItem>,
    pub receipts: Vec<StatementReceiptItem>,
    pub allowances: Vec<StatementAllowanceItem>,
}

// ==========================================
// Table Schema Initialization
// ==========================================

pub fn create_accounts_receivable_tables(
    conn: &rusqlite::Connection,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS accounts_receivable (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            customer_partner_id TEXT NOT NULL,
            customer_name_snapshot TEXT NOT NULL,
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
        )",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ar_tenant_status ON accounts_receivable (tenant_id, status)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ar_tenant_customer ON accounts_receivable (tenant_id, customer_partner_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ar_tenant_due_date ON accounts_receivable (tenant_id, due_date)",
        [],
    )?;
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_ar_unique_open_source ON accounts_receivable (tenant_id, source_type, source_id) WHERE status = 'open'",
        [],
    )?;

    Ok(())
}

// ==========================================
// Helpers
// ==========================================

fn table_exists(conn: &rusqlite::Connection, table_name: &str) -> bool {
    let count: Result<i64, _> = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
        params![table_name],
        |r| r.get(0),
    );
    count.unwrap_or(0) > 0
}

fn resolve_customer_snapshot(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    customer_partner_id: &str,
) -> Result<String, AccountsReceivableError> {
    let mut stmt = conn
        .prepare("SELECT name, is_customer FROM partners WHERE id = ?1 AND tenant_id = ?2")
        .map_err(|e| AccountsReceivableError::DatabaseError(e.to_string()))?;

    let customer_res = stmt.query_row(params![customer_partner_id, tenant_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    });

    match customer_res {
        Ok((name, is_customer)) => {
            if is_customer != 1 {
                return Err(AccountsReceivableError::PartnerNotCustomer);
            }
            Ok(name)
        }
        Err(_) => Err(AccountsReceivableError::CustomerNotFound),
    }
}

/// Calculate derived values: received_amount, allowance_amount, outstanding_amount, settlement_status
/// Outstanding amount = amount - received_amount - (allowance_amount + return_amount)
/// For voided accounts, outstanding is 0.0 and settlement status is Unpaid.
pub fn calculate_derived_amounts(
    status: &str,
    total_amount: f64,
    raw_received_amount: f64,
    raw_allowance_amount: f64,
    raw_return_amount: f64,
) -> (f64, f64, f64, SettlementStatus) {
    let rounded_total = round_2(total_amount);
    let rounded_received = round_2(raw_received_amount);
    let rounded_allowance = round_2(raw_allowance_amount);
    let rounded_return = round_2(raw_return_amount);

    if status == "voided" {
        return (0.0, 0.0, 0.0, SettlementStatus::Unpaid);
    }

    let total_offset = round_2(rounded_allowance + rounded_return);
    let settled = round_2(rounded_received + total_offset);
    let outstanding = round_2(rounded_total - settled);

    if outstanding <= 0.0 {
        (rounded_received, total_offset, 0.0, SettlementStatus::Paid)
    } else if settled <= 0.0 {
        (0.0, 0.0, rounded_total, SettlementStatus::Unpaid)
    } else {
        (
            rounded_received,
            total_offset,
            outstanding,
            SettlementStatus::PartiallyPaid,
        )
    }
}

fn row_to_account_receivable(row: &rusqlite::Row) -> Result<AccountReceivable, rusqlite::Error> {
    Ok(AccountReceivable {
        id: row.get(0)?,
        tenant_id: row.get(1)?,
        customer_partner_id: row.get(2)?,
        customer_name_snapshot: row.get(3)?,
        source_type: row.get(4)?,
        source_id: row.get(5)?,
        source_number: row.get(6)?,
        external_reference: row.get(7)?,
        document_date: row.get(8)?,
        due_date: row.get(9)?,
        amount: round_2(row.get(10)?),
        currency: row.get(11)?,
        status: row.get(12)?,
        created_by: row.get(13)?,
        created_at: row.get(14)?,
        voided_by: row.get(15)?,
        voided_at: row.get(16)?,
        void_reason: row.get(17)?,
    })
}

// ==========================================
// Core Operations
// ==========================================

pub fn create_account_receivable_in_tx(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    user_id: &str,
    input: CreateAccountReceivableInput,
) -> Result<AccountReceivable, AccountsReceivableError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(AccountsReceivableError::EmptyTenantId);
    }
    let uid = user_id.trim();
    if uid.is_empty() {
        return Err(AccountsReceivableError::EmptyUserId);
    }

    let rounded_amount = round_2(input.amount);
    if rounded_amount <= 0.0 {
        return Err(AccountsReceivableError::InvalidAmount);
    }

    let doc_date = input.document_date.trim();
    let due_date = input.due_date.trim();
    if due_date < doc_date {
        return Err(AccountsReceivableError::DueDateEarlierThanDocumentDate);
    }

    let source_type = input.source_type.trim();
    if source_type != "customer_invoice" && source_type != "opening_balance" {
        return Err(AccountsReceivableError::InvalidSourceType);
    }

    let source_id = input.source_id.trim();
    let source_number = input.source_number.trim();
    if source_number.is_empty() {
        return Err(AccountsReceivableError::EmptySourceNumber);
    }

    let currency_str = input
        .currency
        .map(|c| c.trim().to_uppercase())
        .unwrap_or_else(|| "TWD".to_string());
    if currency_str != "TWD" {
        return Err(AccountsReceivableError::InvalidCurrency);
    }

    let customer_snapshot = resolve_customer_snapshot(conn, tid, input.customer_partner_id.trim())?;

    // AR-04: Max one open AR per (source_type, source_id)
    let open_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM accounts_receivable WHERE tenant_id = ?1 AND source_type = ?2 AND source_id = ?3 AND status = 'open'",
        params![tid, source_type, source_id],
        |r| r.get(0),
    )?;
    if open_count > 0 {
        return Err(AccountsReceivableError::DuplicateOpenSource);
    }

    let now = current_timestamp();
    let ar_id = generate_ar_id(now);

    conn.execute(
        "INSERT INTO accounts_receivable (
            id, tenant_id, customer_partner_id, customer_name_snapshot,
            source_type, source_id, source_number, external_reference,
            document_date, due_date, amount, currency, status,
            created_by, created_at, voided_by, voided_at, void_reason
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'open', ?13, ?14, NULL, NULL, NULL)",
        params![
            ar_id,
            tid,
            input.customer_partner_id.trim(),
            customer_snapshot,
            source_type,
            source_id,
            source_number,
            input.external_reference.as_ref().map(|s| s.trim()),
            doc_date,
            due_date,
            rounded_amount,
            currency_str,
            uid,
            now
        ],
    )?;

    Ok(AccountReceivable {
        id: ar_id,
        tenant_id: tid.to_string(),
        customer_partner_id: input.customer_partner_id.trim().to_string(),
        customer_name_snapshot: customer_snapshot,
        source_type: source_type.to_string(),
        source_id: source_id.to_string(),
        source_number: source_number.to_string(),
        external_reference: input.external_reference.map(|s| s.trim().to_string()),
        document_date: doc_date.to_string(),
        due_date: due_date.to_string(),
        amount: rounded_amount,
        currency: currency_str,
        status: "open".to_string(),
        created_by: uid.to_string(),
        created_at: now,
        voided_by: None,
        voided_at: None,
        void_reason: None,
    })
}

pub fn create_account_receivable(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    user_id: &str,
    input: CreateAccountReceivableInput,
) -> Result<AccountReceivable, AccountsReceivableError> {
    let tx = conn.transaction()?;
    let ar = create_account_receivable_in_tx(&tx, tenant_id, user_id, input)?;
    tx.commit()?;
    Ok(ar)
}

pub fn void_account_receivable_in_tx(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    user_id: &str,
    ar_id: &str,
    void_reason: &str,
) -> Result<AccountReceivable, AccountsReceivableError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(AccountsReceivableError::EmptyTenantId);
    }
    let uid = user_id.trim();
    if uid.is_empty() {
        return Err(AccountsReceivableError::EmptyUserId);
    }
    let ar_id_trimmed = ar_id.trim();
    if ar_id_trimmed.is_empty() {
        return Err(AccountsReceivableError::EmptyAccountReceivableId);
    }
    let reason_trimmed = void_reason.trim();
    if reason_trimmed.is_empty() {
        return Err(AccountsReceivableError::VoidReasonRequired);
    }

    // Check existing record
    let current_status: String = {
        let mut stmt = conn
            .prepare("SELECT status FROM accounts_receivable WHERE id = ?1 AND tenant_id = ?2")
            .map_err(|e| AccountsReceivableError::DatabaseError(e.to_string()))?;
        stmt.query_row(params![ar_id_trimmed, tid], |row| row.get(0))
            .map_err(|_| AccountsReceivableError::NotFound)?
    };

    if current_status != "open" {
        return Err(AccountsReceivableError::InvalidStateTransition {
            from: current_status,
            to: "voided".to_string(),
        });
    }

    // AR-05: Check receipt allocations (if table exists)
    if table_exists(conn, "customer_receipt_allocations") && table_exists(conn, "customer_receipts")
    {
        let posted_receipt_res: Result<String, _> = conn.query_row(
            "SELECT r.receipt_number
             FROM customer_receipt_allocations ra
             JOIN customer_receipts r ON r.id = ra.receipt_id AND r.tenant_id = ra.tenant_id
             WHERE ra.account_receivable_id = ?1 AND ra.tenant_id = ?2 AND r.status = 'posted'
             ORDER BY ra.created_at ASC LIMIT 1",
            params![ar_id_trimmed, tid],
            |row| row.get(0),
        );

        if let Ok(receipt_number) = posted_receipt_res {
            return Err(AccountsReceivableError::HasPostedReceiptAllocations(
                receipt_number,
            ));
        }
    }

    // AR-05: Check sales allowances (if table exists)
    if table_exists(conn, "sales_allowances") {
        let posted_allowance_res: Result<String, _> = conn.query_row(
            "SELECT allowance_number
             FROM sales_allowances
             WHERE account_receivable_id = ?1 AND tenant_id = ?2 AND status = 'posted'
             ORDER BY created_at ASC LIMIT 1",
            params![ar_id_trimmed, tid],
            |row| row.get(0),
        );

        if let Ok(allowance_number) = posted_allowance_res {
            return Err(AccountsReceivableError::HasPostedAllowances(
                allowance_number,
            ));
        }
    }

    // Check sales returns (if table exists)
    if table_exists(conn, "sales_returns") {
        let posted_return_res: Result<String, _> = conn.query_row(
            "SELECT return_number
             FROM sales_returns
             WHERE account_receivable_id = ?1 AND tenant_id = ?2 AND status = 'posted'
             ORDER BY created_at ASC LIMIT 1",
            params![ar_id_trimmed, tid],
            |row| row.get(0),
        );

        if let Ok(return_number) = posted_return_res {
            return Err(AccountsReceivableError::HasPostedReturns(return_number));
        }
    }

    let now = current_timestamp();
    let affected = conn.execute(
        "UPDATE accounts_receivable
         SET status = 'voided', voided_by = ?1, voided_at = ?2, void_reason = ?3
         WHERE id = ?4 AND status = 'open' AND tenant_id = ?5",
        params![uid, now, reason_trimmed, ar_id_trimmed, tid],
    )?;

    crate::ensure_guarded_mutation_affected(
        conn,
        "accounts_receivable",
        ar_id_trimmed,
        tid,
        affected,
        AccountsReceivableError::NotFound,
        |s| {
            if s != "open" {
                Err(AccountsReceivableError::InvalidStateTransition {
                    from: s,
                    to: "voided".to_string(),
                })
            } else {
                Ok(())
            }
        },
    )?;

    // Fetch updated record
    let mut stmt = conn.prepare(
        "SELECT id, tenant_id, customer_partner_id, customer_name_snapshot,
                source_type, source_id, source_number, external_reference,
                document_date, due_date, amount, currency, status,
                created_by, created_at, voided_by, voided_at, void_reason
         FROM accounts_receivable
         WHERE id = ?1 AND tenant_id = ?2",
    )?;
    let ar = stmt.query_row(params![ar_id_trimmed, tid], row_to_account_receivable)?;
    Ok(ar)
}

pub fn void_account_receivable(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    user_id: &str,
    ar_id: &str,
    void_reason: &str,
) -> Result<AccountReceivable, AccountsReceivableError> {
    let tx = conn.transaction()?;
    let ar = void_account_receivable_in_tx(&tx, tenant_id, user_id, ar_id, void_reason)?;
    tx.commit()?;
    Ok(ar)
}

// ==========================================
// Query Operations
// ==========================================

pub fn get_account_receivable_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    ar_id: &str,
) -> Result<AccountReceivableDetail, AccountsReceivableError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(AccountsReceivableError::EmptyTenantId);
    }
    let target_id = ar_id.trim();
    if target_id.is_empty() {
        return Err(AccountsReceivableError::EmptyAccountReceivableId);
    }

    let ar: AccountReceivable = {
        let mut stmt = conn.prepare(
            "SELECT id, tenant_id, customer_partner_id, customer_name_snapshot,
                    source_type, source_id, source_number, external_reference,
                    document_date, due_date, amount, currency, status,
                    created_by, created_at, voided_by, voided_at, void_reason
             FROM accounts_receivable
             WHERE id = ?1 AND tenant_id = ?2",
        )?;
        stmt.query_row(params![target_id, tid], row_to_account_receivable)
            .map_err(|_| AccountsReceivableError::NotFound)?
    };

    let mut allocations = Vec::new();
    let mut raw_received_amount = 0.0;

    if table_exists(conn, "customer_receipt_allocations") && table_exists(conn, "customer_receipts")
    {
        let mut alloc_stmt = conn.prepare(
            "SELECT ra.id, ra.receipt_id, r.receipt_number, ra.amount, r.receipt_date, r.status, ra.created_at
             FROM customer_receipt_allocations ra
             JOIN customer_receipts r ON r.id = ra.receipt_id AND r.tenant_id = ra.tenant_id
             WHERE ra.account_receivable_id = ?1 AND ra.tenant_id = ?2
             ORDER BY ra.created_at ASC",
        )?;

        let alloc_rows = alloc_stmt.query_map(params![target_id, tid], |row| {
            Ok(ReceiptAllocationDetail {
                id: row.get(0)?,
                receipt_id: row.get(1)?,
                receipt_number: row.get(2)?,
                amount: round_2(row.get(3)?),
                receipt_date: row.get(4)?,
                receipt_status: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?;

        for a in alloc_rows {
            let detail = a?;
            if detail.receipt_status == "posted" {
                raw_received_amount += detail.amount;
            }
            allocations.push(detail);
        }
    }

    let raw_allowance_amount = if table_exists(conn, "sales_allowances") {
        let sum_res: Result<Option<f64>, _> = conn.query_row(
            "SELECT SUM(untaxed_amount + tax_amount)
             FROM sales_allowances
             WHERE account_receivable_id = ?1 AND tenant_id = ?2 AND status = 'posted'",
            params![target_id, tid],
            |r| r.get(0),
        );
        sum_res.unwrap_or(None).unwrap_or(0.0)
    } else {
        0.0
    };

    let raw_return_amount = if table_exists(conn, "sales_returns") {
        let sum_res: Result<Option<f64>, _> = conn.query_row(
            "SELECT SUM(total_amount)
             FROM sales_returns
             WHERE account_receivable_id = ?1 AND tenant_id = ?2 AND status = 'posted'",
            params![target_id, tid],
            |r| r.get(0),
        );
        sum_res.unwrap_or(None).unwrap_or(0.0)
    } else {
        0.0
    };

    let (received_amount, allowance_amount, outstanding_amount, settlement_status) =
        calculate_derived_amounts(
            &ar.status,
            ar.amount,
            raw_received_amount,
            raw_allowance_amount,
            raw_return_amount,
        );

    Ok(AccountReceivableDetail {
        id: ar.id,
        tenant_id: ar.tenant_id,
        customer_partner_id: ar.customer_partner_id,
        customer_name_snapshot: ar.customer_name_snapshot,
        source_type: ar.source_type,
        source_id: ar.source_id,
        source_number: ar.source_number,
        external_reference: ar.external_reference,
        document_date: ar.document_date,
        due_date: ar.due_date,
        amount: ar.amount,
        currency: ar.currency,
        status: ar.status,
        created_by: ar.created_by,
        created_at: ar.created_at,
        voided_by: ar.voided_by,
        voided_at: ar.voided_at,
        void_reason: ar.void_reason,
        received_amount,
        allowance_amount,
        outstanding_amount,
        settlement_status,
        allocations,
    })
}

pub fn list_accounts_receivable_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    filter: ListAccountsReceivableFilter,
) -> Result<Vec<AccountReceivableItem>, AccountsReceivableError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(AccountsReceivableError::EmptyTenantId);
    }

    let has_receipts = table_exists(conn, "customer_receipt_allocations")
        && table_exists(conn, "customer_receipts");
    let has_allowances = table_exists(conn, "sales_allowances");
    let has_returns = table_exists(conn, "sales_returns");

    let received_subquery = if has_receipts {
        "COALESCE(
            (SELECT SUM(ra.amount)
             FROM customer_receipt_allocations ra
             JOIN customer_receipts r ON r.id = ra.receipt_id AND r.tenant_id = ra.tenant_id
             WHERE ra.account_receivable_id = ar.id
               AND ra.tenant_id = ar.tenant_id
               AND r.status = 'posted'),
            0.0
        )"
    } else {
        "0.0"
    };

    let allowance_subquery = if has_allowances {
        "COALESCE(
            (SELECT SUM(sa.untaxed_amount + sa.tax_amount)
             FROM sales_allowances sa
             WHERE sa.account_receivable_id = ar.id
               AND sa.tenant_id = ar.tenant_id
               AND sa.status = 'posted'),
            0.0
        )"
    } else {
        "0.0"
    };

    let return_subquery = if has_returns {
        "COALESCE(
            (SELECT SUM(sr.total_amount)
             FROM sales_returns sr
             WHERE sr.account_receivable_id = ar.id
               AND sr.tenant_id = ar.tenant_id
               AND sr.status = 'posted'),
            0.0
        )"
    } else {
        "0.0"
    };

    let mut query = format!(
        "SELECT
            ar.id, ar.tenant_id, ar.customer_partner_id, ar.customer_name_snapshot,
            ar.source_type, ar.source_id, ar.source_number, ar.external_reference,
            ar.document_date, ar.due_date, ar.amount, ar.currency, ar.status,
            ar.created_by, ar.created_at, ar.voided_by, ar.voided_at, ar.void_reason,
            {} AS raw_received_amount,
            {} AS raw_allowance_amount,
            {} AS raw_return_amount
        FROM accounts_receivable ar
        WHERE ar.tenant_id = ?1",
        received_subquery, allowance_subquery, return_subquery
    );

    let mut param_values: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(tid.to_string())];

    if let Some(ref cid) = filter.customer_partner_id {
        let c = cid.trim();
        if !c.is_empty() {
            param_values.push(Box::new(c.to_string()));
            query.push_str(&format!(
                " AND ar.customer_partner_id = ?{}",
                param_values.len()
            ));
        }
    }

    if let Some(ref st) = filter.status {
        let s = st.trim();
        if !s.is_empty() {
            param_values.push(Box::new(s.to_string()));
            query.push_str(&format!(" AND ar.status = ?{}", param_values.len()));
        }
    }

    if let Some(ref from) = filter.due_date_from {
        let f = from.trim();
        if !f.is_empty() {
            param_values.push(Box::new(f.to_string()));
            query.push_str(&format!(" AND ar.due_date >= ?{}", param_values.len()));
        }
    }

    if let Some(ref to) = filter.due_date_to {
        let t = to.trim();
        if !t.is_empty() {
            param_values.push(Box::new(t.to_string()));
            query.push_str(&format!(" AND ar.due_date <= ?{}", param_values.len()));
        }
    }

    query.push_str(" ORDER BY ar.document_date DESC, ar.created_at DESC");

    let mut stmt = conn
        .prepare(&query)
        .map_err(|e| AccountsReceivableError::DatabaseError(e.to_string()))?;

    let params_slice: Vec<&dyn rusqlite::ToSql> = param_values.iter().map(|b| b.as_ref()).collect();

    let target_settlement = filter
        .settlement_status
        .as_deref()
        .and_then(SettlementStatus::from_filter_str);

    let rows = stmt.query_map(params_slice.as_slice(), |row| {
        let ar = row_to_account_receivable(row)?;
        let raw_received: f64 = row.get(18)?;
        let raw_allowance: f64 = row.get(19)?;
        let raw_return: f64 = row.get(20)?;
        Ok((ar, raw_received, raw_allowance, raw_return))
    })?;

    let mut items = Vec::new();
    for r in rows {
        let (ar, raw_received, raw_allowance, raw_return) = r?;
        let (received_amount, allowance_amount, outstanding_amount, settlement_status) =
            calculate_derived_amounts(
                &ar.status,
                ar.amount,
                raw_received,
                raw_allowance,
                raw_return,
            );

        if let Some(expected_status) = target_settlement {
            if settlement_status != expected_status {
                continue;
            }
        }

        items.push(AccountReceivableItem {
            id: ar.id,
            tenant_id: ar.tenant_id,
            customer_partner_id: ar.customer_partner_id,
            customer_name_snapshot: ar.customer_name_snapshot,
            source_type: ar.source_type,
            source_id: ar.source_id,
            source_number: ar.source_number,
            external_reference: ar.external_reference,
            document_date: ar.document_date,
            due_date: ar.due_date,
            amount: ar.amount,
            currency: ar.currency,
            status: ar.status,
            created_by: ar.created_by,
            created_at: ar.created_at,
            voided_by: ar.voided_by,
            voided_at: ar.voided_at,
            void_reason: ar.void_reason,
            received_amount,
            allowance_amount,
            outstanding_amount,
            settlement_status,
        });
    }

    Ok(items)
}

// ==========================================
// Tauri Commands
// ==========================================

#[tauri::command]
#[specta::specta]
pub async fn get_account_receivable<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    id: Option<String>,
    ar_id: Option<String>,
) -> Result<AccountReceivableDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let target_id = id
        .or(ar_id)
        .ok_or_else(|| "缺少應收帳款 ID (id 或 ar_id)".to_string())?;
    get_account_receivable_impl(&conn, &active_tid, &target_id).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn list_accounts_receivable<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    customer_partner_id: Option<String>,
    settlement_status: Option<String>,
    status: Option<String>,
    due_date_from: Option<String>,
    due_date_to: Option<String>,
) -> Result<Vec<AccountReceivableItem>, String> {
    let db_path = crate::get_db_path(&app_handle);
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let filter = ListAccountsReceivableFilter {
        customer_partner_id,
        settlement_status,
        status,
        due_date_from,
        due_date_to,
    };
    list_accounts_receivable_impl(&conn, &active_tid, filter).map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ReceivableAgingItem {
    pub account_receivable_id: String,
    pub source_id: String,
    pub source_type: String,
    pub source_number: String,
    pub customer_partner_id: String,
    pub customer_name_snapshot: String,
    pub external_reference: Option<String>,
    pub document_date: String,
    pub due_date: String,
    pub overdue_days: i32,
    pub bucket: String,
    pub amount: f64,
    pub received_amount: f64,
    pub allowance_amount: f64,
    pub outstanding_amount: f64,
    pub settlement_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct CustomerReceivablesAging {
    pub customer_partner_id: String,
    pub customer_name: String,
    pub current: f64,
    pub overdue_1_30: f64,
    pub overdue_31_60: f64,
    pub overdue_61_90: f64,
    pub overdue_90_plus: f64,
    pub total_outstanding: f64,
    pub uninvoiced_amount: f64,
    pub uninvoiced_group_a: f64,
    pub uninvoiced_group_b: f64,
    pub uninvoiced_group_c: f64,
    pub items: Vec<ReceivableAgingItem>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
pub struct ReceivablesAgingTotals {
    pub current: f64,
    pub overdue_1_30: f64,
    pub overdue_31_60: f64,
    pub overdue_61_90: f64,
    pub overdue_90_plus: f64,
    pub total_outstanding: f64,
    pub uninvoiced_amount: f64,
    pub uninvoiced_group_a: f64,
    pub uninvoiced_group_b: f64,
    pub uninvoiced_group_c: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ReceivablesAgingReport {
    pub as_of_date: String,
    pub customers: Vec<CustomerReceivablesAging>,
    pub totals: ReceivablesAgingTotals,
}

pub fn get_receivables_aging_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    as_of_date: Option<String>,
) -> Result<ReceivablesAgingReport, AccountsReceivableError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(AccountsReceivableError::EmptyTenantId);
    }

    let as_of = match as_of_date {
        Some(ref d) if !d.trim().is_empty() => d.trim().to_string(),
        _ => conn
            .query_row("SELECT date('now', 'localtime')", [], |r| {
                r.get::<_, String>(0)
            })
            .unwrap_or_else(|_| "2026-11-23".to_string()),
    };

    // 1. Uninvoiced sales orders reference column (#226)
    let uninvoiced_list =
        match crate::customer_invoices::list_uninvoiced_sales_orders_impl(conn, tid, None) {
            Ok(list) => list,
            Err(crate::customer_invoices::CustomerInvoiceError::EmptyTenantId) => {
                return Err(AccountsReceivableError::EmptyTenantId);
            }
            Err(_) => Vec::new(),
        };

    let mut uninvoiced_map: BTreeMap<String, (String, f64, f64, f64, f64)> = BTreeMap::new();
    for u in uninvoiced_list {
        let entry = uninvoiced_map
            .entry(u.customer_partner_id.clone())
            .or_insert((u.customer_name_snapshot.clone(), 0.0, 0.0, 0.0, 0.0));
        match u.group.as_str() {
            "per_order_confirmed" => entry.1 += u.uninvoiced_amount,
            "per_order_shipped" => entry.2 += u.uninvoiced_amount,
            "monthly_consolidated" => entry.3 += u.uninvoiced_amount,
            _ => {}
        }
        entry.4 += u.uninvoiced_amount;
    }

    // 2. Open accounts receivable with outstanding_amount > 0
    let open_ars = list_accounts_receivable_impl(
        conn,
        tid,
        ListAccountsReceivableFilter {
            status: Some("open".to_string()),
            ..Default::default()
        },
    )?;

    let mut customer_map: BTreeMap<String, CustomerReceivablesAging> = BTreeMap::new();

    for ar in open_ars {
        if ar.outstanding_amount <= 0.0 {
            continue;
        }

        let overdue_days = calendar_day_diff(&ar.due_date, &as_of).unwrap_or(0);
        let bucket = AgingBucket::from_overdue_days(overdue_days);

        let customer_entry = customer_map
            .entry(ar.customer_partner_id.clone())
            .or_insert_with(|| CustomerReceivablesAging {
                customer_partner_id: ar.customer_partner_id.clone(),
                customer_name: ar.customer_name_snapshot.clone(),
                current: 0.0,
                overdue_1_30: 0.0,
                overdue_31_60: 0.0,
                overdue_61_90: 0.0,
                overdue_90_plus: 0.0,
                total_outstanding: 0.0,
                uninvoiced_amount: 0.0,
                uninvoiced_group_a: 0.0,
                uninvoiced_group_b: 0.0,
                uninvoiced_group_c: 0.0,
                items: Vec::new(),
            });

        match bucket {
            AgingBucket::Current => customer_entry.current += ar.outstanding_amount,
            AgingBucket::Overdue1To30 => customer_entry.overdue_1_30 += ar.outstanding_amount,
            AgingBucket::Overdue31To60 => customer_entry.overdue_31_60 += ar.outstanding_amount,
            AgingBucket::Overdue61To90 => customer_entry.overdue_61_90 += ar.outstanding_amount,
            AgingBucket::Overdue90Plus => customer_entry.overdue_90_plus += ar.outstanding_amount,
        }
        customer_entry.total_outstanding += ar.outstanding_amount;

        customer_entry.items.push(ReceivableAgingItem {
            account_receivable_id: ar.id,
            source_id: ar.source_id,
            source_type: ar.source_type,
            source_number: ar.source_number,
            customer_partner_id: ar.customer_partner_id,
            customer_name_snapshot: ar.customer_name_snapshot,
            external_reference: ar.external_reference,
            document_date: ar.document_date,
            due_date: ar.due_date,
            overdue_days,
            bucket: bucket.as_str().to_string(),
            amount: ar.amount,
            received_amount: ar.received_amount,
            allowance_amount: ar.allowance_amount,
            outstanding_amount: ar.outstanding_amount,
            settlement_status: ar.settlement_status.as_str().to_string(),
        });
    }

    // 3. Merge uninvoiced sales orders
    for (c_id, (c_name, ga, gb, gc, total_u)) in uninvoiced_map {
        let customer_entry =
            customer_map
                .entry(c_id.clone())
                .or_insert_with(|| CustomerReceivablesAging {
                    customer_partner_id: c_id,
                    customer_name: c_name,
                    current: 0.0,
                    overdue_1_30: 0.0,
                    overdue_31_60: 0.0,
                    overdue_61_90: 0.0,
                    overdue_90_plus: 0.0,
                    total_outstanding: 0.0,
                    uninvoiced_amount: 0.0,
                    uninvoiced_group_a: 0.0,
                    uninvoiced_group_b: 0.0,
                    uninvoiced_group_c: 0.0,
                    items: Vec::new(),
                });
        customer_entry.uninvoiced_group_a = round_2(ga);
        customer_entry.uninvoiced_group_b = round_2(gb);
        customer_entry.uninvoiced_group_c = round_2(gc);
        customer_entry.uninvoiced_amount = round_2(total_u);
    }

    // 4. Round sums and filter customers: keep total_outstanding > 0 || uninvoiced_amount > 0
    let mut filtered_customers: Vec<CustomerReceivablesAging> = Vec::new();
    for mut c in customer_map.into_values() {
        c.current = round_2(c.current);
        c.overdue_1_30 = round_2(c.overdue_1_30);
        c.overdue_31_60 = round_2(c.overdue_31_60);
        c.overdue_61_90 = round_2(c.overdue_61_90);
        c.overdue_90_plus = round_2(c.overdue_90_plus);
        c.total_outstanding = round_2(c.total_outstanding);
        c.uninvoiced_amount = round_2(c.uninvoiced_amount);
        c.uninvoiced_group_a = round_2(c.uninvoiced_group_a);
        c.uninvoiced_group_b = round_2(c.uninvoiced_group_b);
        c.uninvoiced_group_c = round_2(c.uninvoiced_group_c);

        if c.total_outstanding > 0.0 || c.uninvoiced_amount > 0.0 {
            filtered_customers.push(c);
        }
    }

    filtered_customers.sort_by(|a, b| a.customer_name.cmp(&b.customer_name));

    // 5. Calculate totals
    let mut totals = ReceivablesAgingTotals::default();
    for c in &filtered_customers {
        totals.current += c.current;
        totals.overdue_1_30 += c.overdue_1_30;
        totals.overdue_31_60 += c.overdue_31_60;
        totals.overdue_61_90 += c.overdue_61_90;
        totals.overdue_90_plus += c.overdue_90_plus;
        totals.total_outstanding += c.total_outstanding;
        totals.uninvoiced_amount += c.uninvoiced_amount;
        totals.uninvoiced_group_a += c.uninvoiced_group_a;
        totals.uninvoiced_group_b += c.uninvoiced_group_b;
        totals.uninvoiced_group_c += c.uninvoiced_group_c;
    }

    totals.current = round_2(totals.current);
    totals.overdue_1_30 = round_2(totals.overdue_1_30);
    totals.overdue_31_60 = round_2(totals.overdue_31_60);
    totals.overdue_61_90 = round_2(totals.overdue_61_90);
    totals.overdue_90_plus = round_2(totals.overdue_90_plus);
    totals.total_outstanding = round_2(totals.total_outstanding);
    totals.uninvoiced_amount = round_2(totals.uninvoiced_amount);
    totals.uninvoiced_group_a = round_2(totals.uninvoiced_group_a);
    totals.uninvoiced_group_b = round_2(totals.uninvoiced_group_b);
    totals.uninvoiced_group_c = round_2(totals.uninvoiced_group_c);

    Ok(ReceivablesAgingReport {
        as_of_date: as_of,
        customers: filtered_customers,
        totals,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn get_receivables_aging<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    as_of_date: Option<String>,
) -> Result<ReceivablesAgingReport, String> {
    let db_path = crate::get_db_path(&app_handle);
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    get_receivables_aging_impl(&conn, &active_tid, as_of_date).map_err(|e| e.to_string())
}

// ==========================================
// Customer Statement Implementation (Issue #229)
// ==========================================

pub fn get_customer_statement_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    customer_partner_id: &str,
    start_date: &str,
    end_date: &str,
) -> Result<CustomerStatement, AccountsReceivableError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(AccountsReceivableError::EmptyTenantId);
    }

    let cid = customer_partner_id.trim();
    if cid.is_empty() {
        return Err(AccountsReceivableError::CustomerNotFound);
    }

    let customer_name = resolve_customer_snapshot(conn, tid, cid)?;

    let s_date = start_date.trim();
    let e_date = end_date.trim();
    if !is_valid_ymd_string(s_date) || !is_valid_ymd_string(e_date) {
        return Err(AccountsReceivableError::InvalidDateFormat);
    }
    if s_date > e_date {
        return Err(AccountsReceivableError::InvalidDateRange);
    }

    // 1. Calculate opening balance:
    // Σ(document_date < start_date of non-voided AR)
    // − Σ(receipt_date < start_date of posted receipt allocations to non-voided AR)
    // − Σ(allowance_date < start_date of posted allowances to non-voided AR)
    let opening_ar: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0.0)
         FROM accounts_receivable
         WHERE tenant_id = ?1
           AND customer_partner_id = ?2
           AND status != 'voided'
           AND document_date < ?3",
        params![tid, cid, s_date],
        |row| row.get(0),
    )?;

    let opening_receipts: f64 = if table_exists(conn, "customer_receipt_allocations")
        && table_exists(conn, "customer_receipts")
    {
        conn.query_row(
            "SELECT COALESCE(SUM(ra.amount), 0.0)
             FROM customer_receipt_allocations ra
             JOIN customer_receipts r ON r.id = ra.receipt_id AND r.tenant_id = ra.tenant_id
             JOIN accounts_receivable ar ON ar.id = ra.account_receivable_id AND ar.tenant_id = ra.tenant_id
             WHERE ra.tenant_id = ?1
               AND r.customer_partner_id = ?2
               AND r.status = 'posted'
               AND ar.status != 'voided'
               AND r.receipt_date < ?3",
            params![tid, cid, s_date],
            |row| row.get(0),
        )?
    } else {
        0.0
    };

    let opening_allowances: f64 = if table_exists(conn, "sales_allowances") {
        conn.query_row(
            "SELECT COALESCE(SUM(sa.untaxed_amount + sa.tax_amount), 0.0)
             FROM sales_allowances sa
             JOIN accounts_receivable ar ON ar.id = sa.account_receivable_id AND ar.tenant_id = sa.tenant_id
             WHERE sa.tenant_id = ?1
               AND sa.customer_partner_id = ?2
               AND sa.status = 'posted'
               AND ar.status != 'voided'
               AND sa.allowance_date < ?3",
            params![tid, cid, s_date],
            |row| row.get(0),
        )?
    } else {
        0.0
    };

    let opening_balance = round_2(opening_ar - opening_receipts - opening_allowances);

    // 2. Query current period receivables [start_date, end_date]
    let mut ar_stmt = conn.prepare(
        "SELECT id, source_type, source_id, source_number, external_reference, document_date, due_date, amount, status
         FROM accounts_receivable
         WHERE tenant_id = ?1
           AND customer_partner_id = ?2
           AND status != 'voided'
           AND document_date >= ?3
           AND document_date <= ?4
         ORDER BY document_date ASC, created_at ASC, id ASC",
    )?;

    let ar_rows = ar_stmt.query_map(params![tid, cid, s_date, e_date], |row| {
        Ok(StatementReceivableItem {
            account_receivable_id: row.get(0)?,
            source_type: row.get(1)?,
            source_id: row.get(2)?,
            source_number: row.get(3)?,
            external_reference: row.get(4)?,
            document_date: row.get(5)?,
            due_date: row.get(6)?,
            amount: round_2(row.get(7)?),
            status: row.get(8)?,
        })
    })?;

    let mut receivables = Vec::new();
    let mut current_receivables_total = 0.0;
    for r in ar_rows {
        let item = r?;
        current_receivables_total += item.amount;
        receivables.push(item);
    }
    current_receivables_total = round_2(current_receivables_total);

    // 3. Query current period posted receipts [start_date, end_date]
    let mut receipts = Vec::new();
    let mut current_receipts_total = 0.0;

    if table_exists(conn, "customer_receipt_allocations") && table_exists(conn, "customer_receipts")
    {
        let mut rcpt_stmt = conn.prepare(
            "SELECT id, receipt_number, receipt_date, receipt_method, receipt_reference, note
             FROM customer_receipts
             WHERE tenant_id = ?1
               AND customer_partner_id = ?2
               AND status = 'posted'
               AND receipt_date >= ?3
               AND receipt_date <= ?4
             ORDER BY receipt_date ASC, created_at ASC, id ASC",
        )?;

        struct RawReceiptHeader {
            id: String,
            receipt_number: String,
            receipt_date: String,
            receipt_method: String,
            receipt_reference: Option<String>,
            note: Option<String>,
        }

        let receipt_headers = rcpt_stmt.query_map(params![tid, cid, s_date, e_date], |row| {
            Ok(RawReceiptHeader {
                id: row.get(0)?,
                receipt_number: row.get(1)?,
                receipt_date: row.get(2)?,
                receipt_method: row.get(3)?,
                receipt_reference: row.get(4)?,
                note: row.get(5)?,
            })
        })?;

        let mut alloc_stmt = conn.prepare(
            "SELECT ra.account_receivable_id, ar.source_type, ar.source_id, ar.source_number, ra.amount
             FROM customer_receipt_allocations ra
             JOIN accounts_receivable ar ON ar.id = ra.account_receivable_id AND ar.tenant_id = ra.tenant_id
             WHERE ra.tenant_id = ?1
               AND ra.receipt_id = ?2
               AND ar.status != 'voided'
             ORDER BY ra.created_at ASC, ra.id ASC",
        )?;

        for rh_res in receipt_headers {
            let rh = rh_res?;
            let alloc_rows = alloc_stmt.query_map(params![tid, &rh.id], |arow| {
                Ok(StatementReceiptAllocation {
                    account_receivable_id: arow.get(0)?,
                    source_type: arow.get(1)?,
                    source_id: arow.get(2)?,
                    source_number: arow.get(3)?,
                    amount: round_2(arow.get(4)?),
                })
            })?;

            let mut allocations = Vec::new();
            let mut receipt_amount = 0.0;
            for a in alloc_rows {
                let item = a?;
                receipt_amount += item.amount;
                allocations.push(item);
            }
            receipt_amount = round_2(receipt_amount);
            current_receipts_total += receipt_amount;

            receipts.push(StatementReceiptItem {
                receipt_id: rh.id,
                receipt_number: rh.receipt_number,
                receipt_date: rh.receipt_date,
                receipt_method: rh.receipt_method,
                receipt_reference: rh.receipt_reference,
                amount: receipt_amount,
                note: rh.note,
                allocations,
            });
        }
    }
    current_receipts_total = round_2(current_receipts_total);

    // 4. Query current period posted allowances [start_date, end_date]
    let mut allowances = Vec::new();
    let mut current_allowances_total = 0.0;

    if table_exists(conn, "sales_allowances") {
        let mut alw_stmt = conn.prepare(
            "SELECT sa.id, sa.allowance_number, sa.allowance_date, sa.customer_invoice_id, sa.invoice_number_snapshot, sa.account_receivable_id, sa.reason_type, sa.untaxed_amount, sa.tax_amount, sa.external_reference, sa.note
             FROM sales_allowances sa
             JOIN accounts_receivable ar ON ar.id = sa.account_receivable_id AND ar.tenant_id = sa.tenant_id
             WHERE sa.tenant_id = ?1
               AND sa.customer_partner_id = ?2
               AND sa.status = 'posted'
               AND ar.status != 'voided'
               AND sa.allowance_date >= ?3
               AND sa.allowance_date <= ?4
             ORDER BY sa.allowance_date ASC, sa.created_at ASC, sa.id ASC",
        )?;

        let alw_rows = alw_stmt.query_map(params![tid, cid, s_date, e_date], |row| {
            let untaxed: f64 = row.get(7)?;
            let tax: f64 = row.get(8)?;
            Ok(StatementAllowanceItem {
                allowance_id: row.get(0)?,
                allowance_number: row.get(1)?,
                allowance_date: row.get(2)?,
                customer_invoice_id: row.get(3)?,
                invoice_number_snapshot: row.get(4)?,
                account_receivable_id: row.get(5)?,
                reason_type: row.get(6)?,
                untaxed_amount: round_2(untaxed),
                tax_amount: round_2(tax),
                total_amount: round_2(untaxed + tax),
                external_reference: row.get(9)?,
                note: row.get(10)?,
            })
        })?;

        for a in alw_rows {
            let item = a?;
            current_allowances_total += item.total_amount;
            allowances.push(item);
        }
    }
    current_allowances_total = round_2(current_allowances_total);

    // 5. Closing balance:
    // Opening + Current Receivables − Current Receipts − Current Allowances = Closing
    let closing_balance = round_2(
        opening_balance + current_receivables_total
            - current_receipts_total
            - current_allowances_total,
    );

    Ok(CustomerStatement {
        tenant_id: tid.to_string(),
        customer_partner_id: cid.to_string(),
        customer_name,
        start_date: s_date.to_string(),
        end_date: e_date.to_string(),
        opening_balance,
        current_receivables_total,
        current_receipts_total,
        current_allowances_total,
        closing_balance,
        receivables,
        receipts,
        allowances,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn get_customer_statement<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    customer_partner_id: String,
    start_date: String,
    end_date: String,
) -> Result<CustomerStatement, String> {
    let db_path = crate::get_db_path(&app_handle);
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    get_customer_statement_impl(
        &conn,
        &active_tid,
        &customer_partner_id,
        &start_date,
        &end_date,
    )
    .map_err(|e| e.to_string())
}

// ==========================================
// Tests
// ==========================================

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::partners::create_partners_table(&conn).unwrap();
        create_accounts_receivable_tables(&conn).unwrap();

        // Seed a valid customer partner
        conn.execute(
            "INSERT INTO partners (id, tenant_id, name, is_vendor, is_customer, created_at)
             VALUES ('cus_001', 'tnt_test', '測試客戶股份有限公司', 0, 1, 1000)",
            [],
        )
        .unwrap();

        // Seed a non-customer partner
        conn.execute(
            "INSERT INTO partners (id, tenant_id, name, is_vendor, is_customer, created_at)
             VALUES ('vnd_001', 'tnt_test', '純供應商企業行', 1, 0, 1000)",
            [],
        )
        .unwrap();

        // Seed a customer in another tenant
        conn.execute(
            "INSERT INTO partners (id, tenant_id, name, is_vendor, is_customer, created_at)
             VALUES ('cus_other', 'tnt_other', '其他租戶客戶', 0, 1, 1000)",
            [],
        )
        .unwrap();

        conn
    }

    #[test]
    fn test_tc_ar_01_n1_and_e1_e2_tenant_isolation_and_empty_tenant() {
        // Given: Empty tenant_id and valid tenant_id
        let conn = setup_test_db();

        // When: Querying with empty tenant_id
        let err_res =
            list_accounts_receivable_impl(&conn, "", ListAccountsReceivableFilter::default());
        // Then: Fails with EmptyTenantId
        assert_eq!(err_res.unwrap_err(), AccountsReceivableError::EmptyTenantId);

        // When: Querying with valid tenant_id
        let ok_res = list_accounts_receivable_impl(
            &conn,
            "tnt_test",
            ListAccountsReceivableFilter::default(),
        );
        // Then: Succeeds with empty list initially
        assert!(ok_res.is_ok());
        assert_eq!(ok_res.unwrap().len(), 0);
    }

    #[test]
    fn test_tc_ar_02_n1_create_account_receivable_success() {
        // Given: Valid customer, positive amount, due_date >= document_date
        let mut conn = setup_test_db();
        let input = CreateAccountReceivableInput {
            customer_partner_id: "cus_001".to_string(),
            source_type: "customer_invoice".to_string(),
            source_id: "inv_001".to_string(),
            source_number: "INV-202611001".to_string(),
            external_reference: Some("AB-12345678".to_string()),
            document_date: "2026-11-10".to_string(),
            due_date: "2026-12-10".to_string(),
            amount: 5250.0,
            currency: Some("TWD".to_string()),
        };

        // When: Creating account receivable
        let ar = create_account_receivable(&mut conn, "tnt_test", "usr_admin", input).unwrap();

        // Then: Record created with ar_ prefix, open status, and customer snapshot
        assert!(ar.id.starts_with("ar_"));
        assert_eq!(ar.customer_partner_id, "cus_001");
        assert_eq!(ar.customer_name_snapshot, "測試客戶股份有限公司");
        assert_eq!(ar.status, "open");
        assert_eq!(ar.amount, 5250.0);
        assert_eq!(ar.currency, "TWD");
        assert_eq!(ar.created_by, "usr_admin");
    }

    #[test]
    fn test_tc_ar_02_b1_b2_amount_boundaries() {
        // Given: Input with amount = 0.0 and amount = -10.0
        let mut conn = setup_test_db();
        let mut input_zero = CreateAccountReceivableInput {
            customer_partner_id: "cus_001".to_string(),
            source_type: "customer_invoice".to_string(),
            source_id: "inv_zero".to_string(),
            source_number: "INV-ZERO".to_string(),
            external_reference: None,
            document_date: "2026-11-10".to_string(),
            due_date: "2026-11-10".to_string(),
            amount: 0.0,
            currency: None,
        };

        // When: Amount is 0.0
        let res_zero =
            create_account_receivable(&mut conn, "tnt_test", "usr_admin", input_zero.clone());
        // Then: Rejected with InvalidAmount
        assert_eq!(
            res_zero.unwrap_err(),
            AccountsReceivableError::InvalidAmount
        );

        // When: Amount is -10.0
        input_zero.amount = -10.0;
        let res_neg = create_account_receivable(&mut conn, "tnt_test", "usr_admin", input_zero);
        // Then: Rejected with InvalidAmount
        assert_eq!(res_neg.unwrap_err(), AccountsReceivableError::InvalidAmount);
    }

    #[test]
    fn test_tc_ar_02_b3_b4_rounding_boundaries() {
        // Given: Inputs with amounts needing 2 decimal rounding
        let mut conn = setup_test_db();
        let input_below = CreateAccountReceivableInput {
            customer_partner_id: "cus_001".to_string(),
            source_type: "customer_invoice".to_string(),
            source_id: "inv_round_0".to_string(),
            source_number: "INV-ROUND-0".to_string(),
            external_reference: None,
            document_date: "2026-11-10".to_string(),
            due_date: "2026-11-10".to_string(),
            amount: 0.004, // rounds to 0.00
            currency: None,
        };

        // When: Amount rounds to 0.00
        let res_below = create_account_receivable(&mut conn, "tnt_test", "usr_admin", input_below);
        // Then: Rejected as <= 0.0
        assert_eq!(
            res_below.unwrap_err(),
            AccountsReceivableError::InvalidAmount
        );

        // Given: Amount rounds to 0.01
        let input_above = CreateAccountReceivableInput {
            customer_partner_id: "cus_001".to_string(),
            source_type: "customer_invoice".to_string(),
            source_id: "inv_round_1".to_string(),
            source_number: "INV-ROUND-1".to_string(),
            external_reference: None,
            document_date: "2026-11-10".to_string(),
            due_date: "2026-11-10".to_string(),
            amount: 0.006, // rounds to 0.01
            currency: None,
        };
        // When: Creating with 0.006
        let ar_ok =
            create_account_receivable(&mut conn, "tnt_test", "usr_admin", input_above).unwrap();
        // Then: Rounded amount is 0.01
        assert_eq!(ar_ok.amount, 0.01);
    }

    #[test]
    fn test_tc_ar_03_b1_b2_date_string_comparisons() {
        // Given: due_date == document_date and due_date < document_date
        let mut conn = setup_test_db();

        // Case B1: due_date == document_date (same date string is valid)
        let input_same = CreateAccountReceivableInput {
            customer_partner_id: "cus_001".to_string(),
            source_type: "customer_invoice".to_string(),
            source_id: "inv_same_date".to_string(),
            source_number: "INV-SAME".to_string(),
            external_reference: None,
            document_date: "2026-11-10".to_string(),
            due_date: "2026-11-10".to_string(),
            amount: 100.0,
            currency: None,
        };
        // When: Creating with identical dates
        let ar_same = create_account_receivable(&mut conn, "tnt_test", "usr_admin", input_same);
        // Then: Successfully created
        assert!(ar_same.is_ok());

        // Case B2: due_date < document_date (earlier date string rejected)
        let input_earlier = CreateAccountReceivableInput {
            customer_partner_id: "cus_001".to_string(),
            source_type: "customer_invoice".to_string(),
            source_id: "inv_earlier_date".to_string(),
            source_number: "INV-EARLIER".to_string(),
            external_reference: None,
            document_date: "2026-11-10".to_string(),
            due_date: "2026-11-09".to_string(),
            amount: 100.0,
            currency: None,
        };
        // When: Creating with earlier due_date
        let res_earlier =
            create_account_receivable(&mut conn, "tnt_test", "usr_admin", input_earlier);
        // Then: Rejected with DueDateEarlierThanDocumentDate
        assert_eq!(
            res_earlier.unwrap_err(),
            AccountsReceivableError::DueDateEarlierThanDocumentDate
        );
    }

    #[test]
    fn test_tc_ar_04_source_types_and_duplicate_open_guard() {
        // Given: Valid opening_balance source and invalid source
        let mut conn = setup_test_db();

        let input_opening = CreateAccountReceivableInput {
            customer_partner_id: "cus_001".to_string(),
            source_type: "opening_balance".to_string(),
            source_id: "op_001".to_string(),
            source_number: "OP-202611001".to_string(),
            external_reference: Some("OLD-999".to_string()),
            document_date: "2026-11-01".to_string(),
            due_date: "2026-11-30".to_string(),
            amount: 3000.0,
            currency: None,
        };
        // When: Creating opening_balance source
        let ar1 =
            create_account_receivable(&mut conn, "tnt_test", "usr_admin", input_opening.clone())
                .unwrap();
        // Then: Successfully created
        assert_eq!(ar1.source_type, "opening_balance");

        // When: Attempting duplicate open with same source_type and source_id
        let res_dup =
            create_account_receivable(&mut conn, "tnt_test", "usr_admin", input_opening.clone());
        // Then: Rejected with DuplicateOpenSource
        assert_eq!(
            res_dup.unwrap_err(),
            AccountsReceivableError::DuplicateOpenSource
        );

        // When: Attempting invalid source type
        let mut input_inv_type = input_opening;
        input_inv_type.source_type = "vendor_bill".to_string();
        input_inv_type.source_id = "other_id".to_string();
        let res_type =
            create_account_receivable(&mut conn, "tnt_test", "usr_admin", input_inv_type);
        // Then: Rejected with InvalidSourceType
        assert_eq!(
            res_type.unwrap_err(),
            AccountsReceivableError::InvalidSourceType
        );
    }

    #[test]
    fn test_tc_ar_04_n2_voiding_allows_recreating_open_source() {
        // Given: An open AR
        let mut conn = setup_test_db();
        let input = CreateAccountReceivableInput {
            customer_partner_id: "cus_001".to_string(),
            source_type: "customer_invoice".to_string(),
            source_id: "inv_reopen".to_string(),
            source_number: "INV-REOPEN".to_string(),
            external_reference: None,
            document_date: "2026-11-10".to_string(),
            due_date: "2026-11-20".to_string(),
            amount: 2000.0,
            currency: None,
        };
        let ar =
            create_account_receivable(&mut conn, "tnt_test", "usr_admin", input.clone()).unwrap();

        // When: Voiding the open AR
        let voided =
            void_account_receivable(&mut conn, "tnt_test", "usr_admin", &ar.id, "重新開立")
                .unwrap();
        // Then: Status is voided
        assert_eq!(voided.status, "voided");

        // When: Recreating open AR with the same source_id and source_type
        let ar_new = create_account_receivable(&mut conn, "tnt_test", "usr_admin", input);
        // Then: Allowed because the previous record is no longer 'open'
        assert!(ar_new.is_ok());
    }

    #[test]
    fn test_tc_ar_05_customer_validation_errors() {
        // Given: Nonexistent customer and partner who is not a customer
        let mut conn = setup_test_db();

        let input_missing = CreateAccountReceivableInput {
            customer_partner_id: "cus_nonexistent".to_string(),
            source_type: "customer_invoice".to_string(),
            source_id: "inv_missing".to_string(),
            source_number: "INV-M".to_string(),
            external_reference: None,
            document_date: "2026-11-10".to_string(),
            due_date: "2026-11-10".to_string(),
            amount: 1000.0,
            currency: None,
        };
        // When: Customer does not exist
        let res_missing =
            create_account_receivable(&mut conn, "tnt_test", "usr_admin", input_missing);
        // Then: Rejected with CustomerNotFound
        assert_eq!(
            res_missing.unwrap_err(),
            AccountsReceivableError::CustomerNotFound
        );

        let input_vendor_only = CreateAccountReceivableInput {
            customer_partner_id: "vnd_001".to_string(),
            source_type: "customer_invoice".to_string(),
            source_id: "inv_vendor".to_string(),
            source_number: "INV-V".to_string(),
            external_reference: None,
            document_date: "2026-11-10".to_string(),
            due_date: "2026-11-10".to_string(),
            amount: 1000.0,
            currency: None,
        };
        // When: Partner is vendor only (is_customer == 0)
        let res_vendor =
            create_account_receivable(&mut conn, "tnt_test", "usr_admin", input_vendor_only);
        // Then: Rejected with PartnerNotCustomer
        assert_eq!(
            res_vendor.unwrap_err(),
            AccountsReceivableError::PartnerNotCustomer
        );
    }

    #[test]
    fn test_tc_ar_06_void_validation_and_guards() {
        // Given: An open AR
        let mut conn = setup_test_db();
        let input = CreateAccountReceivableInput {
            customer_partner_id: "cus_001".to_string(),
            source_type: "customer_invoice".to_string(),
            source_id: "inv_void_test".to_string(),
            source_number: "INV-VT".to_string(),
            external_reference: None,
            document_date: "2026-11-10".to_string(),
            due_date: "2026-11-10".to_string(),
            amount: 1500.0,
            currency: None,
        };
        let ar = create_account_receivable(&mut conn, "tnt_test", "usr_admin", input).unwrap();

        // When: Voiding with empty reason
        let err_reason = void_account_receivable(&mut conn, "tnt_test", "usr_admin", &ar.id, "   ");
        // Then: Fails with VoidReasonRequired
        assert_eq!(
            err_reason.unwrap_err(),
            AccountsReceivableError::VoidReasonRequired
        );

        // When: Voiding with valid reason
        let ok_void =
            void_account_receivable(&mut conn, "tnt_test", "usr_admin", &ar.id, "客戶要求作廢")
                .unwrap();
        // Then: Succeeded with audit fields
        assert_eq!(ok_void.status, "voided");
        assert_eq!(ok_void.voided_by.as_deref(), Some("usr_admin"));
        assert_eq!(ok_void.void_reason.as_deref(), Some("客戶要求作廢"));

        // When: Attempting to void already voided record
        let err_again =
            void_account_receivable(&mut conn, "tnt_test", "usr_admin", &ar.id, "再次作廢");
        // Then: Fails with InvalidStateTransition
        assert_eq!(
            err_again.unwrap_err(),
            AccountsReceivableError::InvalidStateTransition {
                from: "voided".to_string(),
                to: "voided".to_string()
            }
        );
    }

    #[test]
    fn test_tc_ar_06_e3_void_blocked_by_posted_receipt_allocations() {
        // Given: Tables customer_receipts and customer_receipt_allocations exist
        let mut conn = setup_test_db();
        conn.execute(
            "CREATE TABLE customer_receipts (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                receipt_number TEXT NOT NULL,
                receipt_date TEXT NOT NULL,
                status TEXT NOT NULL
            )",
            [],
        )
        .unwrap();

        conn.execute(
            "CREATE TABLE customer_receipt_allocations (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                receipt_id TEXT NOT NULL,
                account_receivable_id TEXT NOT NULL,
                amount REAL NOT NULL,
                created_at INTEGER NOT NULL
            )",
            [],
        )
        .unwrap();

        let input = CreateAccountReceivableInput {
            customer_partner_id: "cus_001".to_string(),
            source_type: "customer_invoice".to_string(),
            source_id: "inv_alloc_test".to_string(),
            source_number: "INV-ALLOC".to_string(),
            external_reference: None,
            document_date: "2026-11-10".to_string(),
            due_date: "2026-11-10".to_string(),
            amount: 2000.0,
            currency: None,
        };
        let ar = create_account_receivable(&mut conn, "tnt_test", "usr_admin", input).unwrap();

        // Seed posted receipt and allocation
        conn.execute(
            "INSERT INTO customer_receipts (id, tenant_id, receipt_number, receipt_date, status)
             VALUES ('rcpt_01', 'tnt_test', 'RCPT-202611001', '2026-11-11', 'posted')",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO customer_receipt_allocations (id, tenant_id, receipt_id, account_receivable_id, amount, created_at)
             VALUES ('alloc_01', 'tnt_test', 'rcpt_01', ?1, 500.0, 1000)",
            params![ar.id],
        )
        .unwrap();

        // When: Querying AR with posted receipt allocation
        let detail_posted = get_account_receivable_impl(&conn, "tnt_test", &ar.id).unwrap();
        // Then: received_amount == 500.0, outstanding_amount == 1500.0, settlement_status == PartiallyPaid
        assert_eq!(detail_posted.received_amount, 500.0);
        assert_eq!(detail_posted.outstanding_amount, 1500.0);
        assert_eq!(
            detail_posted.settlement_status,
            SettlementStatus::PartiallyPaid
        );

        let list_posted = list_accounts_receivable_impl(
            &conn,
            "tnt_test",
            ListAccountsReceivableFilter::default(),
        )
        .unwrap();
        assert_eq!(list_posted.len(), 1);
        assert_eq!(list_posted[0].received_amount, 500.0);
        assert_eq!(list_posted[0].outstanding_amount, 1500.0);
        assert_eq!(
            list_posted[0].settlement_status,
            SettlementStatus::PartiallyPaid
        );

        // When: Attempting to void AR with posted allocation
        let res_void =
            void_account_receivable(&mut conn, "tnt_test", "usr_admin", &ar.id, "嘗試作廢");
        // Then: Blocked by AR-05
        assert_eq!(
            res_void.unwrap_err(),
            AccountsReceivableError::HasPostedReceiptAllocations("RCPT-202611001".to_string())
        );

        // When: Receipt is voided (status = 'voided')
        conn.execute(
            "UPDATE customer_receipts SET status = 'voided' WHERE id = 'rcpt_01'",
            [],
        )
        .unwrap();

        // Then: Outstanding and settlement status correctly recover (received_amount = 0.0, outstanding = 2000.0, Unpaid)
        let detail_recovered = get_account_receivable_impl(&conn, "tnt_test", &ar.id).unwrap();
        assert_eq!(detail_recovered.received_amount, 0.0);
        assert_eq!(detail_recovered.outstanding_amount, 2000.0);
        assert_eq!(detail_recovered.settlement_status, SettlementStatus::Unpaid);

        let list_recovered = list_accounts_receivable_impl(
            &conn,
            "tnt_test",
            ListAccountsReceivableFilter::default(),
        )
        .unwrap();
        assert_eq!(list_recovered.len(), 1);
        assert_eq!(list_recovered[0].received_amount, 0.0);
        assert_eq!(list_recovered[0].outstanding_amount, 2000.0);
        assert_eq!(
            list_recovered[0].settlement_status,
            SettlementStatus::Unpaid
        );

        // Then: AR can now be voided
        let res_ok = void_account_receivable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            &ar.id,
            "收款單已作廢後作廢應收",
        );
        assert!(res_ok.is_ok());

        // And after AR itself is voided, outstanding_amount is 0.0
        let detail_voided = get_account_receivable_impl(&conn, "tnt_test", &ar.id).unwrap();
        assert_eq!(detail_voided.status, "voided");
        assert_eq!(detail_voided.outstanding_amount, 0.0);
        assert_eq!(detail_voided.settlement_status, SettlementStatus::Unpaid);
    }

    #[test]
    fn test_tc_ar_06_e4_void_blocked_by_posted_allowance() {
        // Given: Table sales_allowances exists
        let mut conn = setup_test_db();
        conn.execute(
            "CREATE TABLE sales_allowances (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                allowance_number TEXT NOT NULL,
                account_receivable_id TEXT NOT NULL,
                untaxed_amount REAL NOT NULL,
                tax_amount REAL NOT NULL,
                status TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )",
            [],
        )
        .unwrap();

        let input = CreateAccountReceivableInput {
            customer_partner_id: "cus_001".to_string(),
            source_type: "customer_invoice".to_string(),
            source_id: "inv_allow_test".to_string(),
            source_number: "INV-ALLOW".to_string(),
            external_reference: None,
            document_date: "2026-11-10".to_string(),
            due_date: "2026-11-10".to_string(),
            amount: 3000.0,
            currency: None,
        };
        let ar = create_account_receivable(&mut conn, "tnt_test", "usr_admin", input).unwrap();

        conn.execute(
            "INSERT INTO sales_allowances (id, tenant_id, allowance_number, account_receivable_id, untaxed_amount, tax_amount, status, created_at)
             VALUES ('alw_01', 'tnt_test', 'ALW-202611001', ?1, 200.0, 10.0, 'posted', 1000)",
            params![ar.id],
        )
        .unwrap();

        // When: Attempting to void AR with posted allowance
        let res_void =
            void_account_receivable(&mut conn, "tnt_test", "usr_admin", &ar.id, "嘗試作廢");
        // Then: Blocked by AR-05
        assert_eq!(
            res_void.unwrap_err(),
            AccountsReceivableError::HasPostedAllowances("ALW-202611001".to_string())
        );
    }

    #[test]
    fn test_tc_ar_07_calculate_derived_amounts_scenarios() {
        // Given: Normal open invoice with amount 1000.0

        // Case N1: Unpaid, no allowance, no return
        let (rec1, alw1, out1, st1) = calculate_derived_amounts("open", 1000.0, 0.0, 0.0, 0.0);
        assert_eq!(rec1, 0.0);
        assert_eq!(alw1, 0.0);
        assert_eq!(out1, 1000.0);
        assert_eq!(st1, SettlementStatus::Unpaid);

        // Case N2: Partially paid, no allowance, no return
        let (rec2, alw2, out2, st2) = calculate_derived_amounts("open", 1000.0, 300.0, 0.0, 0.0);
        assert_eq!(rec2, 300.0);
        assert_eq!(alw2, 0.0);
        assert_eq!(out2, 700.0);
        assert_eq!(st2, SettlementStatus::PartiallyPaid);

        // Case N3: Fully paid, no allowance, no return
        let (rec3, alw3, out3, st3) = calculate_derived_amounts("open", 1000.0, 1000.0, 0.0, 0.0);
        assert_eq!(rec3, 1000.0);
        assert_eq!(alw3, 0.0);
        assert_eq!(out3, 0.0);
        assert_eq!(st3, SettlementStatus::Paid);

        // Case N4: Partially paid with allowance
        let (rec4, alw4, out4, st4) = calculate_derived_amounts("open", 1000.0, 400.0, 100.0, 0.0);
        assert_eq!(rec4, 400.0);
        assert_eq!(alw4, 100.0);
        assert_eq!(out4, 500.0);
        assert_eq!(st4, SettlementStatus::PartiallyPaid);

        // Case N5: Fully settled via payment + allowance
        let (rec5, alw5, out5, st5) = calculate_derived_amounts("open", 1000.0, 800.0, 200.0, 0.0);
        assert_eq!(rec5, 800.0);
        assert_eq!(alw5, 200.0);
        assert_eq!(out5, 0.0);
        assert_eq!(st5, SettlementStatus::Paid);

        // Case N6: Partially paid with return (no allowance)
        let (rec6, off6, out6, st6) = calculate_derived_amounts("open", 1000.0, 300.0, 0.0, 200.0);
        assert_eq!(rec6, 300.0);
        assert_eq!(off6, 200.0);
        assert_eq!(out6, 500.0);
        assert_eq!(st6, SettlementStatus::PartiallyPaid);

        // Case N7: Fully settled via payment + allowance + return
        let (rec7, off7, out7, st7) =
            calculate_derived_amounts("open", 1000.0, 500.0, 200.0, 300.0);
        assert_eq!(rec7, 500.0);
        assert_eq!(off7, 500.0);
        assert_eq!(out7, 0.0);
        assert_eq!(st7, SettlementStatus::Paid);

        // Case B1: Voided account receivable
        let (rec8, alw8, out8, st8) = calculate_derived_amounts("voided", 1000.0, 0.0, 0.0, 0.0);
        assert_eq!(rec8, 0.0);
        assert_eq!(alw8, 0.0);
        assert_eq!(out8, 0.0);
        assert_eq!(st8, SettlementStatus::Unpaid);
    }

    #[test]
    fn test_tc_ar_08_get_and_list_accounts_receivable() {
        // Given: Multiple AR records
        let mut conn = setup_test_db();
        let ar1 = create_account_receivable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateAccountReceivableInput {
                customer_partner_id: "cus_001".to_string(),
                source_type: "customer_invoice".to_string(),
                source_id: "inv_101".to_string(),
                source_number: "INV-101".to_string(),
                external_reference: None,
                document_date: "2026-11-01".to_string(),
                due_date: "2026-11-15".to_string(),
                amount: 1000.0,
                currency: None,
            },
        )
        .unwrap();

        let ar2 = create_account_receivable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateAccountReceivableInput {
                customer_partner_id: "cus_001".to_string(),
                source_type: "opening_balance".to_string(),
                source_id: "op_102".to_string(),
                source_number: "OP-102".to_string(),
                external_reference: None,
                document_date: "2026-11-05".to_string(),
                due_date: "2026-11-25".to_string(),
                amount: 2500.0,
                currency: None,
            },
        )
        .unwrap();

        // When: Getting detail of ar1
        let detail = get_account_receivable_impl(&conn, "tnt_test", &ar1.id).unwrap();
        // Then: Returns correct detail and derived values
        assert_eq!(detail.id, ar1.id);
        assert_eq!(detail.amount, 1000.0);
        assert_eq!(detail.outstanding_amount, 1000.0);
        assert_eq!(detail.settlement_status, SettlementStatus::Unpaid);

        // When: Listing all for tenant
        let list = list_accounts_receivable_impl(
            &conn,
            "tnt_test",
            ListAccountsReceivableFilter::default(),
        )
        .unwrap();
        // Then: Returns 2 items sorted by document_date desc
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, ar2.id); // 2026-11-05
        assert_eq!(list[1].id, ar1.id); // 2026-11-01

        // When: Filtering by due_date range
        let filtered = list_accounts_receivable_impl(
            &conn,
            "tnt_test",
            ListAccountsReceivableFilter {
                due_date_from: Some("2026-11-20".to_string()),
                ..Default::default()
            },
        )
        .unwrap();
        // Then: Returns only ar2
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].id, ar2.id);
    }

    #[test]
    fn test_tc_228_b01_to_b09_and_allowance_equality() {
        // Given: Fixed as_of_date "2026-03-02" and multiple ARs spanning boundaries
        let mut conn = setup_test_db();
        let as_of = Some("2026-03-02".to_string());

        // B01: due_date = today (2026-03-02) -> overdue_days = 0 -> current
        create_account_receivable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateAccountReceivableInput {
                customer_partner_id: "cus_001".to_string(),
                source_type: "customer_invoice".to_string(),
                source_id: "inv_b01".to_string(),
                source_number: "INV-B01".to_string(),
                external_reference: None,
                document_date: "2026-02-01".to_string(),
                due_date: "2026-03-02".to_string(),
                amount: 100.0,
                currency: None,
            },
        )
        .unwrap();

        // B02: due_date = tomorrow (2026-03-03) -> overdue_days = -1 -> current
        create_account_receivable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateAccountReceivableInput {
                customer_partner_id: "cus_001".to_string(),
                source_type: "customer_invoice".to_string(),
                source_id: "inv_b02".to_string(),
                source_number: "INV-B02".to_string(),
                external_reference: None,
                document_date: "2026-02-01".to_string(),
                due_date: "2026-03-03".to_string(),
                amount: 200.0,
                currency: None,
            },
        )
        .unwrap();

        // B03: due_date = 1 day ago (2026-03-01) -> overdue_days = 1 -> 1-30
        create_account_receivable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateAccountReceivableInput {
                customer_partner_id: "cus_001".to_string(),
                source_type: "customer_invoice".to_string(),
                source_id: "inv_b03".to_string(),
                source_number: "INV-B03".to_string(),
                external_reference: None,
                document_date: "2026-02-01".to_string(),
                due_date: "2026-03-01".to_string(),
                amount: 300.0,
                currency: None,
            },
        )
        .unwrap();

        // B04: due_date = 30 days ago (2026-01-31) -> overdue_days = 30 -> 1-30
        create_account_receivable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateAccountReceivableInput {
                customer_partner_id: "cus_001".to_string(),
                source_type: "customer_invoice".to_string(),
                source_id: "inv_b04".to_string(),
                source_number: "INV-B04".to_string(),
                external_reference: None,
                document_date: "2026-01-01".to_string(),
                due_date: "2026-01-31".to_string(),
                amount: 400.0,
                currency: None,
            },
        )
        .unwrap();

        // B05: due_date = 31 days ago (2026-01-30) -> overdue_days = 31 -> 31-60
        create_account_receivable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateAccountReceivableInput {
                customer_partner_id: "cus_001".to_string(),
                source_type: "customer_invoice".to_string(),
                source_id: "inv_b05".to_string(),
                source_number: "INV-B05".to_string(),
                external_reference: None,
                document_date: "2026-01-01".to_string(),
                due_date: "2026-01-30".to_string(),
                amount: 500.0,
                currency: None,
            },
        )
        .unwrap();

        // B06: due_date = 60 days ago (2026-01-01) -> overdue_days = 60 -> 31-60
        create_account_receivable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateAccountReceivableInput {
                customer_partner_id: "cus_001".to_string(),
                source_type: "customer_invoice".to_string(),
                source_id: "inv_b06".to_string(),
                source_number: "INV-B06".to_string(),
                external_reference: None,
                document_date: "2025-12-01".to_string(),
                due_date: "2026-01-01".to_string(),
                amount: 600.0,
                currency: None,
            },
        )
        .unwrap();

        // B07: due_date = 61 days ago (2025-12-31) -> overdue_days = 61 -> 61-90
        create_account_receivable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateAccountReceivableInput {
                customer_partner_id: "cus_001".to_string(),
                source_type: "customer_invoice".to_string(),
                source_id: "inv_b07".to_string(),
                source_number: "INV-B07".to_string(),
                external_reference: None,
                document_date: "2025-11-01".to_string(),
                due_date: "2025-12-31".to_string(),
                amount: 700.0,
                currency: None,
            },
        )
        .unwrap();

        // B08: due_date = 90 days ago (2025-12-02) -> overdue_days = 90 -> 61-90
        create_account_receivable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateAccountReceivableInput {
                customer_partner_id: "cus_001".to_string(),
                source_type: "customer_invoice".to_string(),
                source_id: "inv_b08".to_string(),
                source_number: "INV-B08".to_string(),
                external_reference: None,
                document_date: "2025-11-01".to_string(),
                due_date: "2025-12-02".to_string(),
                amount: 800.0,
                currency: None,
            },
        )
        .unwrap();

        // B09: due_date = 91 days ago (2025-12-01) -> overdue_days = 91 -> 90+
        let ar_b09 = create_account_receivable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateAccountReceivableInput {
                customer_partner_id: "cus_001".to_string(),
                source_type: "customer_invoice".to_string(),
                source_id: "inv_b09".to_string(),
                source_number: "INV-B09".to_string(),
                external_reference: None,
                document_date: "2025-10-01".to_string(),
                due_date: "2025-12-01".to_string(),
                amount: 900.0,
                currency: None,
            },
        )
        .unwrap();

        // Add a posted sales allowance for ar_b09 of 100.0 (untaxed 95 + tax 5)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS sales_allowances (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                allowance_number TEXT NOT NULL,
                account_receivable_id TEXT NOT NULL,
                untaxed_amount REAL NOT NULL,
                tax_amount REAL NOT NULL,
                status TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sales_allowances (id, tenant_id, allowance_number, account_receivable_id, untaxed_amount, tax_amount, status, created_at)
             VALUES ('alw_test_01', 'tnt_test', 'ALW-202611001', ?1, 95.0, 5.0, 'posted', 1000)",
            params![ar_b09.id],
        )
        .unwrap();

        // When: Generating aging report
        let report = get_receivables_aging_impl(&conn, "tnt_test", as_of).unwrap();

        // Then: Customer buckets are correctly populated
        assert_eq!(report.customers.len(), 1);
        let c = &report.customers[0];
        assert_eq!(c.customer_partner_id, "cus_001");
        // current = 100 + 200 = 300
        assert_eq!(c.current, 300.0);
        // 1-30 = 300 + 400 = 700
        assert_eq!(c.overdue_1_30, 700.0);
        // 31-60 = 500 + 600 = 1100
        assert_eq!(c.overdue_31_60, 1100.0);
        // 61-90 = 700 + 800 = 1500
        assert_eq!(c.overdue_61_90, 1500.0);
        // 90+ = 900 - 100 (allowance) = 800
        assert_eq!(c.overdue_90_plus, 800.0);

        // Verification of acceptance criteria:
        // 有折讓時帳齡各桶合計精確等於未收餘額
        let bucket_sum = round_2(
            c.current + c.overdue_1_30 + c.overdue_31_60 + c.overdue_61_90 + c.overdue_90_plus,
        );
        assert_eq!(bucket_sum, c.total_outstanding);
        assert_eq!(c.total_outstanding, 4400.0);

        // Totals match customer
        assert_eq!(report.totals.total_outstanding, 4400.0);
        assert_eq!(report.totals.current, 300.0);
        assert_eq!(report.totals.overdue_1_30, 700.0);
        assert_eq!(report.totals.overdue_31_60, 1100.0);
        assert_eq!(report.totals.overdue_61_90, 1500.0);
        assert_eq!(report.totals.overdue_90_plus, 800.0);
    }

    #[test]
    fn test_tc_228_b10_b11_and_empty_tenant() {
        // Given: Empty tenant
        let conn = setup_test_db();
        let err = get_receivables_aging_impl(&conn, "", None).unwrap_err();
        assert_eq!(err, AccountsReceivableError::EmptyTenantId);

        let err_ws = get_receivables_aging_impl(&conn, "   ", None).unwrap_err();
        assert_eq!(err_ws, AccountsReceivableError::EmptyTenantId);

        // Given: Cross-month date calculation
        let mut conn_mut = setup_test_db();
        create_account_receivable(
            &mut conn_mut,
            "tnt_test",
            "usr_admin",
            CreateAccountReceivableInput {
                customer_partner_id: "cus_001".to_string(),
                source_type: "customer_invoice".to_string(),
                source_id: "inv_month".to_string(),
                source_number: "INV-MONTH".to_string(),
                external_reference: None,
                document_date: "2026-01-01".to_string(),
                due_date: "2026-01-31".to_string(),
                amount: 150.0,
                currency: None,
            },
        )
        .unwrap();

        // When: as_of_date = "2026-03-02" (30 days overdue in non-leap year)
        let rep = get_receivables_aging_impl(&conn_mut, "tnt_test", Some("2026-03-02".to_string()))
            .unwrap();
        assert_eq!(rep.customers.len(), 1);
        assert_eq!(rep.customers[0].items[0].overdue_days, 30);
        assert_eq!(rep.customers[0].items[0].bucket, "1-30");
        assert_eq!(rep.customers[0].overdue_1_30, 150.0);

        // When: as_of_date is None, defaults to current local date without panic
        let rep_default = get_receivables_aging_impl(&conn_mut, "tnt_test", None).unwrap();
        assert!(!rep_default.as_of_date.is_empty());
    }

    #[test]
    fn test_customer_statement_perspective_cases() {
        let mut conn = setup_test_db();
        let now = current_timestamp();

        // 1. Error cases
        // E01: Empty tenant
        let err_t = get_customer_statement_impl(&conn, "", "cus_001", "2026-03-01", "2026-03-31")
            .unwrap_err();
        assert_eq!(err_t, AccountsReceivableError::EmptyTenantId);

        // E02: Empty customer
        let err_c = get_customer_statement_impl(&conn, "tnt_test", "", "2026-03-01", "2026-03-31")
            .unwrap_err();
        assert_eq!(err_c, AccountsReceivableError::CustomerNotFound);

        // E03: Non-existent customer
        let err_ghost =
            get_customer_statement_impl(&conn, "tnt_test", "cus_ghost", "2026-03-01", "2026-03-31")
                .unwrap_err();
        assert_eq!(err_ghost, AccountsReceivableError::CustomerNotFound);

        // E04: Partner is vendor, not customer
        conn.execute(
            "INSERT INTO partners (id, tenant_id, name, is_customer, is_vendor, created_at)
             VALUES ('vnd_999', 'tnt_test', '測試供應商', 0, 1, ?1)",
            params![now],
        )
        .unwrap();
        let err_not_cus =
            get_customer_statement_impl(&conn, "tnt_test", "vnd_999", "2026-03-01", "2026-03-31")
                .unwrap_err();
        assert_eq!(err_not_cus, AccountsReceivableError::PartnerNotCustomer);

        // E05: Invalid date format
        let err_fmt =
            get_customer_statement_impl(&conn, "tnt_test", "cus_001", "2026/03/01", "2026-03-31")
                .unwrap_err();
        assert_eq!(err_fmt, AccountsReceivableError::InvalidDateFormat);

        // E06: Invalid date range (start > end)
        let err_rng =
            get_customer_statement_impl(&conn, "tnt_test", "cus_001", "2026-03-31", "2026-03-01")
                .unwrap_err();
        assert_eq!(err_rng, AccountsReceivableError::InvalidDateRange);

        // 2. Set up auxiliary tables: customer_receipts, customer_receipt_allocations, sales_allowances
        conn.execute(
            "CREATE TABLE customer_receipts (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                receipt_number TEXT NOT NULL,
                customer_partner_id TEXT NOT NULL,
                receipt_date TEXT NOT NULL,
                receipt_method TEXT NOT NULL,
                receipt_reference TEXT,
                note TEXT,
                status TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )",
            [],
        )
        .unwrap();

        conn.execute(
            "CREATE TABLE customer_receipt_allocations (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                receipt_id TEXT NOT NULL,
                account_receivable_id TEXT NOT NULL,
                amount REAL NOT NULL,
                created_at INTEGER NOT NULL
            )",
            [],
        )
        .unwrap();

        conn.execute(
            "CREATE TABLE sales_allowances (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                allowance_number TEXT NOT NULL,
                customer_invoice_id TEXT NOT NULL,
                invoice_number_snapshot TEXT NOT NULL,
                account_receivable_id TEXT NOT NULL,
                customer_partner_id TEXT NOT NULL,
                reason_type TEXT NOT NULL,
                allowance_date TEXT NOT NULL,
                untaxed_amount REAL NOT NULL,
                tax_amount REAL NOT NULL,
                external_reference TEXT,
                status TEXT NOT NULL,
                note TEXT,
                created_at INTEGER NOT NULL
            )",
            [],
        )
        .unwrap();

        // 3. Populate test scenario data
        // Prior AR in Feb: 1000.0, paid 200.0, allowance 100.0 -> Opening balance for March = 700.0
        let ar_prior = create_account_receivable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateAccountReceivableInput {
                customer_partner_id: "cus_001".to_string(),
                source_type: "customer_invoice".to_string(),
                source_id: "inv_prior".to_string(),
                source_number: "INV-PRIOR".to_string(),
                external_reference: None,
                document_date: "2026-02-10".to_string(),
                due_date: "2026-03-10".to_string(),
                amount: 1000.0,
                currency: None,
            },
        )
        .unwrap();

        // Prior receipt (2026-02-20): 200.0
        conn.execute(
            "INSERT INTO customer_receipts (id, tenant_id, receipt_number, customer_partner_id, receipt_date, receipt_method, status, created_at)
             VALUES ('rcpt_p1', 'tnt_test', 'CR-001', 'cus_001', '2026-02-20', 'bank_transfer', 'posted', ?1)",
            params![now],
        ).unwrap();
        conn.execute(
            "INSERT INTO customer_receipt_allocations (id, tenant_id, receipt_id, account_receivable_id, amount, created_at)
             VALUES ('cra_p1', 'tnt_test', 'rcpt_p1', ?1, 200.0, ?2)",
            params![ar_prior.id, now],
        ).unwrap();

        // Prior allowance (2026-02-25): untaxed 95.24 + tax 4.76 = 100.0
        conn.execute(
            "INSERT INTO sales_allowances (id, tenant_id, allowance_number, customer_invoice_id, invoice_number_snapshot, account_receivable_id, customer_partner_id, reason_type, allowance_date, untaxed_amount, tax_amount, status, created_at)
             VALUES ('alw_p1', 'tnt_test', 'SALW-001', 'inv_prior', 'INV-PRIOR', ?1, 'cus_001', 'shipment_shortfall', '2026-02-25', 95.24, 4.76, 'posted', ?2)",
            params![ar_prior.id, now],
        ).unwrap();

        // Current period ARs in March:
        // AR1 (2026-03-05): 500.0
        let ar_cur1 = create_account_receivable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateAccountReceivableInput {
                customer_partner_id: "cus_001".to_string(),
                source_type: "customer_invoice".to_string(),
                source_id: "inv_cur1".to_string(),
                source_number: "INV-CUR1".to_string(),
                external_reference: None,
                document_date: "2026-03-05".to_string(),
                due_date: "2026-04-05".to_string(),
                amount: 500.0,
                currency: None,
            },
        )
        .unwrap();

        // AR2 (2026-03-20): 300.0
        let ar_cur2 = create_account_receivable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateAccountReceivableInput {
                customer_partner_id: "cus_001".to_string(),
                source_type: "customer_invoice".to_string(),
                source_id: "inv_cur2".to_string(),
                source_number: "INV-CUR2".to_string(),
                external_reference: None,
                document_date: "2026-03-20".to_string(),
                due_date: "2026-04-20".to_string(),
                amount: 300.0,
                currency: None,
            },
        )
        .unwrap();

        // Voided AR in March (should be excluded): 999.0
        let ar_void = create_account_receivable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateAccountReceivableInput {
                customer_partner_id: "cus_001".to_string(),
                source_type: "customer_invoice".to_string(),
                source_id: "inv_void".to_string(),
                source_number: "INV-VOID".to_string(),
                external_reference: None,
                document_date: "2026-03-15".to_string(),
                due_date: "2026-04-15".to_string(),
                amount: 999.0,
                currency: None,
            },
        )
        .unwrap();
        void_account_receivable(&mut conn, "tnt_test", "usr_admin", &ar_void.id, "作廢測試")
            .unwrap();

        // Current period receipt in March (2026-03-10): 250.0 allocating 150 to ar_prior and 100 to ar_cur1
        conn.execute(
            "INSERT INTO customer_receipts (id, tenant_id, receipt_number, customer_partner_id, receipt_date, receipt_method, status, created_at)
             VALUES ('rcpt_c1', 'tnt_test', 'CR-002', 'cus_001', '2026-03-10', 'bank_transfer', 'posted', ?1)",
            params![now],
        ).unwrap();
        conn.execute(
            "INSERT INTO customer_receipt_allocations (id, tenant_id, receipt_id, account_receivable_id, amount, created_at)
             VALUES ('cra_c1', 'tnt_test', 'rcpt_c1', ?1, 150.0, ?2)",
            params![ar_prior.id, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO customer_receipt_allocations (id, tenant_id, receipt_id, account_receivable_id, amount, created_at)
             VALUES ('cra_c2', 'tnt_test', 'rcpt_c1', ?1, 100.0, ?2)",
            params![ar_cur1.id, now],
        ).unwrap();

        // Draft receipt in March (should be excluded): 500.0
        conn.execute(
            "INSERT INTO customer_receipts (id, tenant_id, receipt_number, customer_partner_id, receipt_date, receipt_method, status, created_at)
             VALUES ('rcpt_draft', 'tnt_test', 'CR-DRAFT', 'cus_001', '2026-03-12', 'bank_transfer', 'draft', ?1)",
            params![now],
        ).unwrap();
        conn.execute(
            "INSERT INTO customer_receipt_allocations (id, tenant_id, receipt_id, account_receivable_id, amount, created_at)
             VALUES ('cra_draft', 'tnt_test', 'rcpt_draft', ?1, 500.0, ?2)",
            params![ar_cur1.id, now],
        ).unwrap();

        // Current period allowance in March (2026-03-25): untaxed 47.62 + tax 2.38 = 50.0
        conn.execute(
            "INSERT INTO sales_allowances (id, tenant_id, allowance_number, customer_invoice_id, invoice_number_snapshot, account_receivable_id, customer_partner_id, reason_type, allowance_date, untaxed_amount, tax_amount, status, created_at)
             VALUES ('alw_c1', 'tnt_test', 'SALW-002', 'inv_cur1', 'INV-CUR1', ?1, 'cus_001', 'shipment_shortfall', '2026-03-25', 47.62, 2.38, 'posted', ?2)",
            params![ar_cur1.id, now],
        ).unwrap();

        // Cancelled allowance in March (should be excluded): 80.0
        conn.execute(
            "INSERT INTO sales_allowances (id, tenant_id, allowance_number, customer_invoice_id, invoice_number_snapshot, account_receivable_id, customer_partner_id, reason_type, allowance_date, untaxed_amount, tax_amount, status, created_at)
             VALUES ('alw_cancel', 'tnt_test', 'SALW-CANCEL', 'inv_cur2', 'INV-CUR2', ?1, 'cus_001', 'shipment_shortfall', '2026-03-26', 76.19, 3.81, 'cancelled', ?2)",
            params![ar_cur2.id, now],
        ).unwrap();

        // 4. Query March Statement
        let stmt_mar =
            get_customer_statement_impl(&conn, "tnt_test", "cus_001", "2026-03-01", "2026-03-31")
                .unwrap();

        // Verification:
        // Opening = 1000.0 - 200.0 - 100.0 = 700.0
        assert_eq!(stmt_mar.opening_balance, 700.0);

        // Current Receivables: 500.0 + 300.0 = 800.0 (voided 999 excluded)
        assert_eq!(stmt_mar.current_receivables_total, 800.0);
        assert_eq!(stmt_mar.receivables.len(), 2);

        // Current Receipts: 250.0 (draft 500 excluded)
        assert_eq!(stmt_mar.current_receipts_total, 250.0);
        assert_eq!(stmt_mar.receipts.len(), 1);
        assert_eq!(stmt_mar.receipts[0].allocations.len(), 2);

        // Current Allowances: 50.0 (cancelled 80 excluded)
        assert_eq!(stmt_mar.current_allowances_total, 50.0);
        assert_eq!(stmt_mar.allowances.len(), 1);

        // Closing Balance: 700.0 + 800.0 - 250.0 - 50.0 = 1200.0
        assert_eq!(stmt_mar.closing_balance, 1200.0);

        // Identity verification: Opening + Receivables - Receipts - Allowances == Closing
        assert_eq!(
            round_2(
                stmt_mar.opening_balance + stmt_mar.current_receivables_total
                    - stmt_mar.current_receipts_total
                    - stmt_mar.current_allowances_total
            ),
            stmt_mar.closing_balance
        );

        // 5. Query April Statement (Period Continuity: March Closing == April Opening)
        let stmt_apr =
            get_customer_statement_impl(&conn, "tnt_test", "cus_001", "2026-04-01", "2026-04-30")
                .unwrap();
        assert_eq!(stmt_apr.opening_balance, stmt_mar.closing_balance);
        assert_eq!(stmt_apr.current_receivables_total, 0.0);
        assert_eq!(stmt_apr.current_receipts_total, 0.0);
        assert_eq!(stmt_apr.current_allowances_total, 0.0);
        assert_eq!(stmt_apr.closing_balance, stmt_apr.opening_balance);
    }
}
