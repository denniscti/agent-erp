use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static AP_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

fn current_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

pub fn round_2(val: f64) -> f64 {
    (val * 100.0).round() / 100.0
}

fn generate_ap_id(now: i64) -> String {
    format!(
        "ap_{}_{}",
        now,
        AP_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

// ==========================================
// Errors
// ==========================================

#[derive(Debug, thiserror::Error, PartialEq, Clone)]
pub enum AccountsPayableError {
    #[error("Tenant ID cannot be empty")]
    EmptyTenantId,

    #[error("無法解析有效使用者 session，操作被拒絕")]
    EmptyUserId,

    #[error("應付帳款 ID 不可為空")]
    EmptyAccountPayableId,

    #[error("找不到指定的應付帳款或不屬於目前租戶")]
    NotFound,

    #[error("找不到指定的供應商或不屬於目前租戶")]
    VendorNotFound,

    #[error("指定的合作夥伴不是供應商 (is_vendor != 1)")]
    PartnerNotVendor,

    #[error("應付金額必須大於 0")]
    InvalidAmount,

    #[error("到期日不可早於單據日")]
    DueDateEarlierThanDocumentDate,

    #[error("幣別僅支援 'TWD'")]
    InvalidCurrency,

    #[error("來源類型必須為 'vendor_bill' 或 'opening_balance'")]
    InvalidSourceType,

    #[error("來源單號不可為空")]
    EmptySourceNumber,

    #[error("同一個來源單據最多只能有一筆未結案 (open) 的應付帳款")]
    DuplicateOpenSource,

    #[error("此應付已有付款核銷：{0}，請先作廢付款單")]
    HasPostedPaymentAllocations(String),

    #[error("原因必填")]
    VoidReasonRequired,

    #[error("無效的狀態轉換")]
    InvalidStateTransition { from: String, to: String },

    #[error("資料庫錯誤: {0}")]
    DatabaseError(String),
}

impl From<rusqlite::Error> for AccountsPayableError {
    fn from(err: rusqlite::Error) -> Self {
        AccountsPayableError::DatabaseError(err.to_string())
    }
}

// ==========================================
// Domain & Data Models
// ==========================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum SettlementStatus {
    #[serde(alias = "未付")]
    Unpaid,
    #[serde(alias = "partial", alias = "部分付款")]
    PartiallyPaid,
    #[serde(alias = "已付清")]
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
            SettlementStatus::Unpaid => "未付",
            SettlementStatus::PartiallyPaid => "部分付款",
            SettlementStatus::Paid => "已付清",
        }
    }

    pub fn from_filter_str(s: &str) -> Option<Self> {
        let trimmed = s.trim();
        if trimmed.eq_ignore_ascii_case("unpaid") || trimmed == "未付" {
            Some(SettlementStatus::Unpaid)
        } else if trimmed.eq_ignore_ascii_case("partially_paid")
            || trimmed.eq_ignore_ascii_case("partial")
            || trimmed == "部分付款"
        {
            Some(SettlementStatus::PartiallyPaid)
        } else if trimmed.eq_ignore_ascii_case("paid") || trimmed == "已付清" {
            Some(SettlementStatus::Paid)
        } else {
            None
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct AccountPayable {
    pub id: String,
    pub tenant_id: String,
    pub vendor_partner_id: String,
    pub vendor_name_snapshot: String,
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
pub struct PaymentAllocationDetail {
    pub id: String,
    pub payment_id: String,
    pub payment_number: String,
    pub amount: f64,
    pub payment_date: String,
    pub payment_status: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct AccountPayableDetail {
    pub id: String,
    pub tenant_id: String,
    pub vendor_partner_id: String,
    pub vendor_name_snapshot: String,
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
    pub paid_amount: f64,
    pub outstanding_amount: f64,
    pub settlement_status: SettlementStatus,
    // Allocations
    pub allocations: Vec<PaymentAllocationDetail>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct AccountPayableItem {
    pub id: String,
    pub tenant_id: String,
    pub vendor_partner_id: String,
    pub vendor_name_snapshot: String,
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
    pub paid_amount: f64,
    pub outstanding_amount: f64,
    pub settlement_status: SettlementStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAccountPayableInput {
    pub vendor_partner_id: String,
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
pub struct ListAccountsPayableFilter {
    pub vendor_partner_id: Option<String>,
    pub settlement_status: Option<String>,
    pub status: Option<String>,
    pub due_date_from: Option<String>,
    pub due_date_to: Option<String>,
}

// ==========================================
// Table Schema Initialization
// ==========================================

pub fn create_accounts_payable_tables(conn: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    conn.execute(
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
        )",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ap_tenant_status ON accounts_payable (tenant_id, status)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ap_tenant_vendor ON accounts_payable (tenant_id, vendor_partner_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ap_tenant_due_date ON accounts_payable (tenant_id, due_date)",
        [],
    )?;
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_ap_unique_open_source ON accounts_payable (tenant_id, source_type, source_id) WHERE status = 'open'",
        [],
    )?;

    // Payments and payment_allocations tables for settlements and AP-04 checks
    conn.execute(
        "CREATE TABLE IF NOT EXISTS payments (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            payment_number TEXT NOT NULL,
            vendor_partner_id TEXT NOT NULL,
            payment_date TEXT NOT NULL,
            amount REAL NOT NULL,
            currency TEXT NOT NULL DEFAULT 'TWD',
            status TEXT NOT NULL,
            created_by TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            posted_by TEXT,
            posted_at INTEGER,
            voided_by TEXT,
            voided_at INTEGER,
            void_reason TEXT
        )",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_payments_tenant_vendor ON payments (tenant_id, vendor_partner_id)",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS payment_allocations (
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
        "CREATE INDEX IF NOT EXISTS idx_pa_ap_id ON payment_allocations (tenant_id, account_payable_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_pa_payment_id ON payment_allocations (tenant_id, payment_id)",
        [],
    )?;

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

    Ok(())
}

// ==========================================
// Helpers
// ==========================================

fn resolve_vendor_snapshot(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    vendor_partner_id: &str,
) -> Result<String, AccountsPayableError> {
    let mut stmt = conn
        .prepare("SELECT name, is_vendor FROM partners WHERE id = ?1 AND tenant_id = ?2")
        .map_err(|e| AccountsPayableError::DatabaseError(e.to_string()))?;

    let vendor_res = stmt.query_row(params![vendor_partner_id, tenant_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    });

    match vendor_res {
        Ok((name, is_vendor)) => {
            if is_vendor != 1 {
                return Err(AccountsPayableError::PartnerNotVendor);
            }
            Ok(name)
        }
        Err(_) => Err(AccountsPayableError::VendorNotFound),
    }
}

pub fn calculate_derived_amounts(
    status: &str,
    total_amount: f64,
    raw_paid_amount: f64,
) -> (f64, f64, SettlementStatus) {
    let rounded_total = round_2(total_amount);
    let rounded_paid = round_2(raw_paid_amount);

    if status == "voided" {
        return (0.0, 0.0, SettlementStatus::Unpaid);
    }

    let outstanding = round_2(rounded_total - rounded_paid);
    if outstanding <= 0.0 {
        (rounded_paid, 0.0, SettlementStatus::Paid)
    } else if outstanding >= rounded_total {
        (0.0, rounded_total, SettlementStatus::Unpaid)
    } else {
        (rounded_paid, outstanding, SettlementStatus::PartiallyPaid)
    }
}

// ==========================================
// Internal Functions (for source transactions)
// ==========================================

pub fn create_account_payable_in_tx(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    user_id: &str,
    input: CreateAccountPayableInput,
) -> Result<AccountPayable, AccountsPayableError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(AccountsPayableError::EmptyTenantId);
    }
    let uid = user_id.trim();
    if uid.is_empty() {
        return Err(AccountsPayableError::EmptyUserId);
    }

    let rounded_amount = round_2(input.amount);
    if rounded_amount <= 0.0 {
        return Err(AccountsPayableError::InvalidAmount);
    }

    let doc_date = input.document_date.trim();
    let due_date = input.due_date.trim();
    if due_date < doc_date {
        return Err(AccountsPayableError::DueDateEarlierThanDocumentDate);
    }

    let source_type = input.source_type.trim();
    if source_type != "vendor_bill" && source_type != "opening_balance" {
        return Err(AccountsPayableError::InvalidSourceType);
    }

    let source_id = input.source_id.trim();
    let source_number = input.source_number.trim();
    if source_number.is_empty() {
        return Err(AccountsPayableError::EmptySourceNumber);
    }

    let currency_str = input
        .currency
        .map(|c| c.trim().to_uppercase())
        .unwrap_or_else(|| "TWD".to_string());
    if currency_str != "TWD" {
        return Err(AccountsPayableError::InvalidCurrency);
    }

    let vendor_snapshot = resolve_vendor_snapshot(conn, tid, input.vendor_partner_id.trim())?;

    // AP-03: Max one open AP per (source_type, source_id)
    let open_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM accounts_payable WHERE tenant_id = ?1 AND source_type = ?2 AND source_id = ?3 AND status = 'open'",
        params![tid, source_type, source_id],
        |r| r.get(0),
    )?;
    if open_count > 0 {
        return Err(AccountsPayableError::DuplicateOpenSource);
    }

    let now = current_timestamp();
    let ap_id = generate_ap_id(now);

    conn.execute(
        "INSERT INTO accounts_payable (
            id, tenant_id, vendor_partner_id, vendor_name_snapshot,
            source_type, source_id, source_number, external_reference,
            document_date, due_date, amount, currency, status,
            created_by, created_at, voided_by, voided_at, void_reason
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'open', ?13, ?14, NULL, NULL, NULL)",
        params![
            ap_id,
            tid,
            input.vendor_partner_id.trim(),
            vendor_snapshot,
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

    Ok(AccountPayable {
        id: ap_id,
        tenant_id: tid.to_string(),
        vendor_partner_id: input.vendor_partner_id.trim().to_string(),
        vendor_name_snapshot: vendor_snapshot,
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

pub fn create_account_payable(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    user_id: &str,
    input: CreateAccountPayableInput,
) -> Result<AccountPayable, AccountsPayableError> {
    let tx = conn.transaction()?;
    let ap = create_account_payable_in_tx(&tx, tenant_id, user_id, input)?;
    tx.commit()?;
    Ok(ap)
}

pub fn void_account_payable_in_tx(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    user_id: &str,
    ap_id: &str,
    void_reason: &str,
) -> Result<AccountPayable, AccountsPayableError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(AccountsPayableError::EmptyTenantId);
    }
    let uid = user_id.trim();
    if uid.is_empty() {
        return Err(AccountsPayableError::EmptyUserId);
    }
    let ap_id_trimmed = ap_id.trim();
    if ap_id_trimmed.is_empty() {
        return Err(AccountsPayableError::EmptyAccountPayableId);
    }
    let reason_trimmed = void_reason.trim();
    if reason_trimmed.is_empty() {
        return Err(AccountsPayableError::VoidReasonRequired);
    }

    // Check existing record
    let current_status: String = {
        let mut stmt = conn
            .prepare("SELECT status FROM accounts_payable WHERE id = ?1 AND tenant_id = ?2")
            .map_err(|e| AccountsPayableError::DatabaseError(e.to_string()))?;
        stmt.query_row(params![ap_id_trimmed, tid], |row| row.get(0))
            .map_err(|_| AccountsPayableError::NotFound)?
    };

    if current_status != "open" {
        return Err(AccountsPayableError::InvalidStateTransition {
            from: current_status,
            to: "voided".to_string(),
        });
    }

    // AP-04: Cannot void if there are any allocations from posted payments
    let posted_payment_res: Result<String, _> = conn.query_row(
        "SELECT p.payment_number
         FROM (
             SELECT id, tenant_id, payment_id, account_payable_id, created_at FROM vendor_payment_allocations
             UNION ALL
             SELECT id, tenant_id, payment_id, account_payable_id, created_at FROM payment_allocations
         ) pa
         JOIN (
             SELECT id, tenant_id, payment_number, status FROM vendor_payments
             UNION ALL
             SELECT id, tenant_id, payment_number, status FROM payments
         ) p ON p.id = pa.payment_id AND p.tenant_id = pa.tenant_id
         WHERE pa.account_payable_id = ?1 AND pa.tenant_id = ?2 AND p.status = 'posted'
         ORDER BY pa.created_at ASC LIMIT 1",
        params![ap_id_trimmed, tid],
        |row| row.get(0),
    );

    if let Ok(payment_number) = posted_payment_res {
        return Err(AccountsPayableError::HasPostedPaymentAllocations(
            payment_number,
        ));
    }

    let now = current_timestamp();
    let affected = conn.execute(
        "UPDATE accounts_payable
         SET status = 'voided', voided_by = ?1, voided_at = ?2, void_reason = ?3
         WHERE id = ?4 AND status = 'open' AND tenant_id = ?5",
        params![uid, now, reason_trimmed, ap_id_trimmed, tid],
    )?;

    crate::ensure_guarded_mutation_affected(
        conn,
        "accounts_payable",
        ap_id_trimmed,
        tid,
        affected,
        AccountsPayableError::NotFound,
        |s| {
            if s != "open" {
                Err(AccountsPayableError::InvalidStateTransition {
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
        "SELECT id, tenant_id, vendor_partner_id, vendor_name_snapshot,
                source_type, source_id, source_number, external_reference,
                document_date, due_date, amount, currency, status,
                created_by, created_at, voided_by, voided_at, void_reason
         FROM accounts_payable
         WHERE id = ?1 AND tenant_id = ?2",
    )?;
    let ap = stmt.query_row(params![ap_id_trimmed, tid], row_to_account_payable)?;
    Ok(ap)
}

pub fn void_account_payable(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    user_id: &str,
    ap_id: &str,
    void_reason: &str,
) -> Result<AccountPayable, AccountsPayableError> {
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let ap = void_account_payable_in_tx(&tx, tenant_id, user_id, ap_id, void_reason)?;
    tx.commit()?;
    Ok(ap)
}

fn row_to_account_payable(row: &rusqlite::Row) -> Result<AccountPayable, rusqlite::Error> {
    Ok(AccountPayable {
        id: row.get(0)?,
        tenant_id: row.get(1)?,
        vendor_partner_id: row.get(2)?,
        vendor_name_snapshot: row.get(3)?,
        source_type: row.get(4)?,
        source_id: row.get(5)?,
        source_number: row.get(6)?,
        external_reference: row.get(7)?,
        document_date: row.get(8)?,
        due_date: row.get(9)?,
        amount: row.get(10)?,
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
// Query Implementations
// ==========================================

pub fn get_account_payable_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    ap_id: &str,
) -> Result<AccountPayableDetail, AccountsPayableError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(AccountsPayableError::EmptyTenantId);
    }
    let target_id = ap_id.trim();
    if target_id.is_empty() {
        return Err(AccountsPayableError::EmptyAccountPayableId);
    }

    let ap: AccountPayable = {
        let mut stmt = conn.prepare(
            "SELECT id, tenant_id, vendor_partner_id, vendor_name_snapshot,
                    source_type, source_id, source_number, external_reference,
                    document_date, due_date, amount, currency, status,
                    created_by, created_at, voided_by, voided_at, void_reason
             FROM accounts_payable
             WHERE id = ?1 AND tenant_id = ?2",
        )?;
        stmt.query_row(params![target_id, tid], row_to_account_payable)
            .map_err(|_| AccountsPayableError::NotFound)?
    };

    // Query allocations
    let mut alloc_stmt = conn.prepare(
        "SELECT pa.id, pa.payment_id, p.payment_number, pa.amount, p.payment_date, p.status, pa.created_at
         FROM (
             SELECT id, tenant_id, payment_id, account_payable_id, amount, created_at FROM vendor_payment_allocations
             UNION ALL
             SELECT id, tenant_id, payment_id, account_payable_id, amount, created_at FROM payment_allocations
         ) pa
         JOIN (
             SELECT id, tenant_id, payment_number, payment_date, status FROM vendor_payments
             UNION ALL
             SELECT id, tenant_id, payment_number, payment_date, status FROM payments
         ) p ON p.id = pa.payment_id AND p.tenant_id = pa.tenant_id
         WHERE pa.account_payable_id = ?1 AND pa.tenant_id = ?2
         ORDER BY pa.created_at ASC",
    )?;

    let alloc_rows = alloc_stmt.query_map(params![target_id, tid], |row| {
        Ok(PaymentAllocationDetail {
            id: row.get(0)?,
            payment_id: row.get(1)?,
            payment_number: row.get(2)?,
            amount: round_2(row.get(3)?),
            payment_date: row.get(4)?,
            payment_status: row.get(5)?,
            created_at: row.get(6)?,
        })
    })?;

    let mut allocations = Vec::new();
    let mut raw_paid_amount = 0.0;
    for a in alloc_rows {
        let detail = a?;
        if detail.payment_status == "posted" {
            raw_paid_amount += detail.amount;
        }
        allocations.push(detail);
    }

    let (paid_amount, outstanding_amount, settlement_status) =
        calculate_derived_amounts(&ap.status, ap.amount, raw_paid_amount);

    Ok(AccountPayableDetail {
        id: ap.id,
        tenant_id: ap.tenant_id,
        vendor_partner_id: ap.vendor_partner_id,
        vendor_name_snapshot: ap.vendor_name_snapshot,
        source_type: ap.source_type,
        source_id: ap.source_id,
        source_number: ap.source_number,
        external_reference: ap.external_reference,
        document_date: ap.document_date,
        due_date: ap.due_date,
        amount: ap.amount,
        currency: ap.currency,
        status: ap.status,
        created_by: ap.created_by,
        created_at: ap.created_at,
        voided_by: ap.voided_by,
        voided_at: ap.voided_at,
        void_reason: ap.void_reason,
        paid_amount,
        outstanding_amount,
        settlement_status,
        allocations,
    })
}

pub fn list_accounts_payable_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    filter: ListAccountsPayableFilter,
) -> Result<Vec<AccountPayableItem>, AccountsPayableError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(AccountsPayableError::EmptyTenantId);
    }

    let mut query = String::from(
        "SELECT
            ap.id, ap.tenant_id, ap.vendor_partner_id, ap.vendor_name_snapshot,
            ap.source_type, ap.source_id, ap.source_number, ap.external_reference,
            ap.document_date, ap.due_date, ap.amount, ap.currency, ap.status,
            ap.created_by, ap.created_at, ap.voided_by, ap.voided_at, ap.void_reason,
            COALESCE(
                (SELECT SUM(pa.amount)
                 FROM (
                     SELECT tenant_id, payment_id, account_payable_id, amount FROM vendor_payment_allocations
                     UNION ALL
                     SELECT tenant_id, payment_id, account_payable_id, amount FROM payment_allocations
                 ) pa
                 JOIN (
                     SELECT id, tenant_id, status FROM vendor_payments
                     UNION ALL
                     SELECT id, tenant_id, status FROM payments
                 ) p ON p.id = pa.payment_id AND p.tenant_id = pa.tenant_id
                 WHERE pa.account_payable_id = ap.id
                   AND pa.tenant_id = ap.tenant_id
                   AND p.status = 'posted'),
                0.0
            ) AS raw_paid_amount
        FROM accounts_payable ap
        WHERE ap.tenant_id = ?1",
    );

    let mut param_values: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(tid.to_string())];

    if let Some(ref vid) = filter.vendor_partner_id {
        let v = vid.trim();
        if !v.is_empty() {
            param_values.push(Box::new(v.to_string()));
            query.push_str(&format!(
                " AND ap.vendor_partner_id = ?{}",
                param_values.len()
            ));
        }
    }

    if let Some(ref st) = filter.status {
        let s = st.trim();
        if !s.is_empty() {
            param_values.push(Box::new(s.to_string()));
            query.push_str(&format!(" AND ap.status = ?{}", param_values.len()));
        }
    }

    if let Some(ref from) = filter.due_date_from {
        let f = from.trim();
        if !f.is_empty() {
            param_values.push(Box::new(f.to_string()));
            query.push_str(&format!(" AND ap.due_date >= ?{}", param_values.len()));
        }
    }

    if let Some(ref to) = filter.due_date_to {
        let t = to.trim();
        if !t.is_empty() {
            param_values.push(Box::new(t.to_string()));
            query.push_str(&format!(" AND ap.due_date <= ?{}", param_values.len()));
        }
    }

    query.push_str(" ORDER BY ap.document_date DESC, ap.created_at DESC");

    let params_slice: Vec<&dyn rusqlite::ToSql> = param_values.iter().map(|b| b.as_ref()).collect();
    let mut stmt = conn.prepare(&query)?;

    let rows = stmt.query_map(params_slice.as_slice(), |row| {
        let raw_paid: f64 = row.get(18)?;
        Ok((row_to_account_payable(row)?, raw_paid))
    })?;

    let settlement_filter = filter
        .settlement_status
        .as_deref()
        .and_then(SettlementStatus::from_filter_str);

    let mut items = Vec::new();
    for r in rows {
        let (ap, raw_paid) = r?;
        let (paid_amount, outstanding_amount, settlement_status) =
            calculate_derived_amounts(&ap.status, ap.amount, raw_paid);

        if let Some(expected_ss) = settlement_filter {
            if settlement_status != expected_ss {
                continue;
            }
        }

        items.push(AccountPayableItem {
            id: ap.id,
            tenant_id: ap.tenant_id,
            vendor_partner_id: ap.vendor_partner_id,
            vendor_name_snapshot: ap.vendor_name_snapshot,
            source_type: ap.source_type,
            source_id: ap.source_id,
            source_number: ap.source_number,
            external_reference: ap.external_reference,
            document_date: ap.document_date,
            due_date: ap.due_date,
            amount: ap.amount,
            currency: ap.currency,
            status: ap.status,
            created_by: ap.created_by,
            created_at: ap.created_at,
            voided_by: ap.voided_by,
            voided_at: ap.voided_at,
            void_reason: ap.void_reason,
            paid_amount,
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
pub async fn get_account_payable<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    id: Option<String>,
    ap_id: Option<String>,
) -> Result<AccountPayableDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let target_id = id
        .or(ap_id)
        .ok_or_else(|| "缺少應付帳款 ID (id 或 ap_id)".to_string())?;
    get_account_payable_impl(&conn, &active_tid, &target_id).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn list_accounts_payable<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    vendor_partner_id: Option<String>,
    settlement_status: Option<String>,
    status: Option<String>,
    due_date_from: Option<String>,
    due_date_to: Option<String>,
) -> Result<Vec<AccountPayableItem>, String> {
    let db_path = crate::get_db_path(&app_handle);
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    list_accounts_payable_impl(
        &conn,
        &active_tid,
        ListAccountsPayableFilter {
            vendor_partner_id,
            settlement_status,
            status,
            due_date_from,
            due_date_to,
        },
    )
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
        create_accounts_payable_tables(&conn).unwrap();

        // Seed a valid vendor partner
        conn.execute(
            "INSERT INTO partners (id, tenant_id, name, is_vendor, is_customer, created_at)
             VALUES ('vnd_001', 'tnt_test', '測試供應商股份公司', 1, 0, 1000)",
            [],
        )
        .unwrap();

        // Seed a non-vendor partner
        conn.execute(
            "INSERT INTO partners (id, tenant_id, name, is_vendor, is_customer, created_at)
             VALUES ('cus_001', 'tnt_test', '純客戶企業行', 0, 1, 1000)",
            [],
        )
        .unwrap();

        // Seed a vendor in another tenant
        conn.execute(
            "INSERT INTO partners (id, tenant_id, name, is_vendor, is_customer, created_at)
             VALUES ('vnd_other', 'tnt_other', '其他租戶供應商', 1, 0, 1000)",
            [],
        )
        .unwrap();

        conn
    }

    #[test]
    fn test_tc_ap_01_n_and_e_tenant_isolation_and_empty_tenant() {
        // Given: Empty tenant_id and valid tenant_id
        let conn = setup_test_db();

        // When: Querying with empty tenant_id
        let err_res = list_accounts_payable_impl(&conn, "", ListAccountsPayableFilter::default());
        // Then: Fails with EmptyTenantId
        assert_eq!(err_res.unwrap_err(), AccountsPayableError::EmptyTenantId);

        // When: Querying with valid tenant_id
        let ok_res =
            list_accounts_payable_impl(&conn, "tnt_test", ListAccountsPayableFilter::default());
        // Then: Succeeds with empty list initially
        assert!(ok_res.is_ok());
        assert_eq!(ok_res.unwrap().len(), 0);
    }

    #[test]
    fn test_tc_ap_02_n1_create_account_payable_success() {
        // Given: Valid vendor, positive amount, due_date >= document_date
        let mut conn = setup_test_db();
        let input = CreateAccountPayableInput {
            vendor_partner_id: "vnd_001".to_string(),
            source_type: "vendor_bill".to_string(),
            source_id: "bill_001".to_string(),
            source_number: "BILL-202611001".to_string(),
            external_reference: Some("INV-9988".to_string()),
            document_date: "2026-11-04".to_string(),
            due_date: "2026-12-04".to_string(),
            amount: 5250.0,
            currency: Some("TWD".to_string()),
        };

        // When: Creating account payable
        let ap = create_account_payable(&mut conn, "tnt_test", "usr_admin", input).unwrap();

        // Then: Record created with ap_ prefix, open status, and vendor snapshot
        assert!(ap.id.starts_with("ap_"));
        assert_eq!(ap.vendor_partner_id, "vnd_001");
        assert_eq!(ap.vendor_name_snapshot, "測試供應商股份公司");
        assert_eq!(ap.status, "open");
        assert_eq!(ap.amount, 5250.0);
        assert_eq!(ap.currency, "TWD");
        assert_eq!(ap.created_by, "usr_admin");
    }

    #[test]
    fn test_tc_ap_02_b1_b2_amount_boundaries() {
        // Given: Input with amount = 0.0 and amount = -10.0
        let mut conn = setup_test_db();
        let mut input_zero = CreateAccountPayableInput {
            vendor_partner_id: "vnd_001".to_string(),
            source_type: "vendor_bill".to_string(),
            source_id: "bill_zero".to_string(),
            source_number: "BILL-ZERO".to_string(),
            external_reference: None,
            document_date: "2026-11-04".to_string(),
            due_date: "2026-11-04".to_string(),
            amount: 0.0,
            currency: None,
        };

        // When: Amount is 0.0
        let res_zero =
            create_account_payable(&mut conn, "tnt_test", "usr_admin", input_zero.clone());
        // Then: Rejected with InvalidAmount
        assert_eq!(res_zero.unwrap_err(), AccountsPayableError::InvalidAmount);

        // When: Amount is -10.0
        input_zero.amount = -10.0;
        let res_neg = create_account_payable(&mut conn, "tnt_test", "usr_admin", input_zero);
        // Then: Rejected with InvalidAmount
        assert_eq!(res_neg.unwrap_err(), AccountsPayableError::InvalidAmount);
    }

    #[test]
    fn test_tc_ap_02_b3_b4_date_string_comparisons() {
        // Given: due_date == document_date and due_date < document_date
        let mut conn = setup_test_db();

        // Case B3: due_date == document_date (same date string is valid)
        let input_same = CreateAccountPayableInput {
            vendor_partner_id: "vnd_001".to_string(),
            source_type: "vendor_bill".to_string(),
            source_id: "bill_same_date".to_string(),
            source_number: "BILL-SAME".to_string(),
            external_reference: None,
            document_date: "2026-11-04".to_string(),
            due_date: "2026-11-04".to_string(),
            amount: 100.0,
            currency: None,
        };
        // When: Creating with identical dates
        let ap_same = create_account_payable(&mut conn, "tnt_test", "usr_admin", input_same);
        // Then: Successfully created
        assert!(ap_same.is_ok());

        // Case B4: due_date < document_date (earlier date string rejected)
        let input_earlier = CreateAccountPayableInput {
            vendor_partner_id: "vnd_001".to_string(),
            source_type: "vendor_bill".to_string(),
            source_id: "bill_earlier_date".to_string(),
            source_number: "BILL-EARLIER".to_string(),
            external_reference: None,
            document_date: "2026-11-04".to_string(),
            due_date: "2026-11-03".to_string(),
            amount: 100.0,
            currency: None,
        };
        // When: Creating with earlier due_date
        let res_earlier = create_account_payable(&mut conn, "tnt_test", "usr_admin", input_earlier);
        // Then: Rejected with DueDateEarlierThanDocumentDate
        assert_eq!(
            res_earlier.unwrap_err(),
            AccountsPayableError::DueDateEarlierThanDocumentDate
        );
    }

    #[test]
    fn test_tc_ap_02_e1_e2_e3_vendor_and_currency_validations() {
        // Given: Nonexistent vendor, non-vendor partner, and USD currency
        let mut conn = setup_test_db();

        // E1: Vendor not found
        let input_no_vendor = CreateAccountPayableInput {
            vendor_partner_id: "vnd_nonexistent".to_string(),
            source_type: "vendor_bill".to_string(),
            source_id: "bill_e1".to_string(),
            source_number: "BILL-E1".to_string(),
            external_reference: None,
            document_date: "2026-11-04".to_string(),
            due_date: "2026-11-10".to_string(),
            amount: 100.0,
            currency: None,
        };
        let res_no_vendor =
            create_account_payable(&mut conn, "tnt_test", "usr_admin", input_no_vendor);
        assert_eq!(
            res_no_vendor.unwrap_err(),
            AccountsPayableError::VendorNotFound
        );

        // E2: Partner is not a vendor (is_vendor = 0)
        let input_not_vendor = CreateAccountPayableInput {
            vendor_partner_id: "cus_001".to_string(),
            source_type: "vendor_bill".to_string(),
            source_id: "bill_e2".to_string(),
            source_number: "BILL-E2".to_string(),
            external_reference: None,
            document_date: "2026-11-04".to_string(),
            due_date: "2026-11-10".to_string(),
            amount: 100.0,
            currency: None,
        };
        let res_not_vendor =
            create_account_payable(&mut conn, "tnt_test", "usr_admin", input_not_vendor);
        assert_eq!(
            res_not_vendor.unwrap_err(),
            AccountsPayableError::PartnerNotVendor
        );

        // E3: Unsupported currency
        let input_usd = CreateAccountPayableInput {
            vendor_partner_id: "vnd_001".to_string(),
            source_type: "vendor_bill".to_string(),
            source_id: "bill_e3".to_string(),
            source_number: "BILL-E3".to_string(),
            external_reference: None,
            document_date: "2026-11-04".to_string(),
            due_date: "2026-11-10".to_string(),
            amount: 100.0,
            currency: Some("USD".to_string()),
        };
        let res_usd = create_account_payable(&mut conn, "tnt_test", "usr_admin", input_usd);
        assert_eq!(res_usd.unwrap_err(), AccountsPayableError::InvalidCurrency);
    }

    #[test]
    fn test_tc_ap_03_n_and_e_max_one_open_ap_per_source() {
        // Given: An AP already created for bill_001
        let mut conn = setup_test_db();
        let input1 = CreateAccountPayableInput {
            vendor_partner_id: "vnd_001".to_string(),
            source_type: "vendor_bill".to_string(),
            source_id: "bill_unique_01".to_string(),
            source_number: "BILL-U01".to_string(),
            external_reference: None,
            document_date: "2026-11-04".to_string(),
            due_date: "2026-11-10".to_string(),
            amount: 1000.0,
            currency: None,
        };
        let ap1 =
            create_account_payable(&mut conn, "tnt_test", "usr_admin", input1.clone()).unwrap();

        // When: Attempting to create a second open AP for the same (source_type, source_id)
        let dup_res = create_account_payable(&mut conn, "tnt_test", "usr_admin", input1.clone());
        // Then: Blocked by AP-03
        assert_eq!(
            dup_res.unwrap_err(),
            AccountsPayableError::DuplicateOpenSource
        );

        // When: Voiding the first AP
        void_account_payable(&mut conn, "tnt_test", "usr_admin", &ap1.id, "來源作廢重開").unwrap();

        // Then: Creating a new AP for the same source succeeds because previous one is voided
        let ap2 = create_account_payable(&mut conn, "tnt_test", "usr_admin", input1).unwrap();
        assert_eq!(ap2.status, "open");
    }

    #[test]
    fn test_tc_ap_04_e_and_n_void_blocked_by_posted_payment_allocation() {
        // Given: AP with an allocated payment
        let mut conn = setup_test_db();
        let input = CreateAccountPayableInput {
            vendor_partner_id: "vnd_001".to_string(),
            source_type: "vendor_bill".to_string(),
            source_id: "bill_pay_check".to_string(),
            source_number: "BILL-PAY".to_string(),
            external_reference: None,
            document_date: "2026-11-04".to_string(),
            due_date: "2026-11-20".to_string(),
            amount: 3000.0,
            currency: None,
        };
        let ap = create_account_payable(&mut conn, "tnt_test", "usr_admin", input).unwrap();

        // Insert a posted payment and allocation
        conn.execute(
            "INSERT INTO payments (id, tenant_id, payment_number, vendor_partner_id, payment_date, amount, currency, status, created_by, created_at)
             VALUES ('pay_001', 'tnt_test', 'PAY-00001', 'vnd_001', '2026-11-05', 1000.0, 'TWD', 'posted', 'usr_admin', 2000)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO payment_allocations (id, tenant_id, payment_id, account_payable_id, amount, created_at)
             VALUES ('pa_001', 'tnt_test', 'pay_001', ?1, 1000.0, 2000)",
            params![ap.id],
        ).unwrap();

        // When: Attempting to void AP while payment is posted
        let void_err = void_account_payable(&mut conn, "tnt_test", "usr_admin", &ap.id, "測試作廢");
        // Then: Blocked by AP-04 with payment_number in error
        assert_eq!(
            void_err.unwrap_err(),
            AccountsPayableError::HasPostedPaymentAllocations("PAY-00001".to_string())
        );

        // When: Voiding the payment itself
        conn.execute(
            "UPDATE payments SET status = 'voided' WHERE id = 'pay_001'",
            [],
        )
        .unwrap();

        // Then: AP can now be successfully voided
        let void_ok = void_account_payable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            &ap.id,
            "付款作廢後重新作廢應付",
        );
        assert!(void_ok.is_ok());
        assert_eq!(void_ok.unwrap().status, "voided");
    }

    #[test]
    fn test_tc_ap_05_n_b1_e1_void_reasons_and_idempotency() {
        // Given: An open AP
        let mut conn = setup_test_db();
        let input = CreateAccountPayableInput {
            vendor_partner_id: "vnd_001".to_string(),
            source_type: "vendor_bill".to_string(),
            source_id: "bill_void_test".to_string(),
            source_number: "BILL-VTEST".to_string(),
            external_reference: None,
            document_date: "2026-11-04".to_string(),
            due_date: "2026-11-20".to_string(),
            amount: 500.0,
            currency: None,
        };
        let ap = create_account_payable(&mut conn, "tnt_test", "usr_admin", input).unwrap();

        // B1: Empty or whitespace void reason
        let empty_res = void_account_payable(&mut conn, "tnt_test", "usr_admin", &ap.id, "   ");
        assert_eq!(
            empty_res.unwrap_err(),
            AccountsPayableError::VoidReasonRequired
        );

        // N: Successful void with valid reason
        let voided =
            void_account_payable(&mut conn, "tnt_test", "usr_admin", &ap.id, "訂單取消作廢")
                .unwrap();
        assert_eq!(voided.status, "voided");
        assert_eq!(voided.void_reason.as_deref(), Some("訂單取消作廢"));
        assert_eq!(voided.voided_by.as_deref(), Some("usr_admin"));
        assert!(voided.voided_at.is_some());

        // E1: Attempt to void an already voided AP (idempotency guard)
        let second_void =
            void_account_payable(&mut conn, "tnt_test", "usr_admin", &ap.id, "重複作廢");
        assert_eq!(
            second_void.unwrap_err(),
            AccountsPayableError::InvalidStateTransition {
                from: "voided".to_string(),
                to: "voided".to_string(),
            }
        );
    }

    #[test]
    fn test_tc_ap_06_b1_floating_point_real_rounding_settled() {
        // Given: AP of amount 100.00 and 3 allocations of 33.33 + 0.01
        let mut conn = setup_test_db();
        let input = CreateAccountPayableInput {
            vendor_partner_id: "vnd_001".to_string(),
            source_type: "vendor_bill".to_string(),
            source_id: "bill_real_precision".to_string(),
            source_number: "BILL-PRECISION".to_string(),
            external_reference: None,
            document_date: "2026-11-04".to_string(),
            due_date: "2026-11-20".to_string(),
            amount: 100.00,
            currency: None,
        };
        let ap = create_account_payable(&mut conn, "tnt_test", "usr_admin", input).unwrap();

        conn.execute(
            "INSERT INTO payments (id, tenant_id, payment_number, vendor_partner_id, payment_date, amount, currency, status, created_by, created_at)
             VALUES ('pay_real', 'tnt_test', 'PAY-REAL', 'vnd_001', '2026-11-05', 100.0, 'TWD', 'posted', 'usr_admin', 2000)",
            [],
        ).unwrap();

        // Three 33.33 and one 0.01
        conn.execute(
            "INSERT INTO payment_allocations (id, tenant_id, payment_id, account_payable_id, amount, created_at) VALUES
             ('pa_1', 'tnt_test', 'pay_real', ?1, 33.33, 2001),
             ('pa_2', 'tnt_test', 'pay_real', ?1, 33.33, 2002),
             ('pa_3', 'tnt_test', 'pay_real', ?1, 33.33, 2003),
             ('pa_4', 'tnt_test', 'pay_real', ?1, 0.01, 2004)",
            params![ap.id],
        ).unwrap();

        // When: Getting AP details
        let detail = get_account_payable_impl(&conn, "tnt_test", &ap.id).unwrap();

        // Then: Due to round_2, paid is 100.00, outstanding is 0.00, and settlement_status is Paid
        assert_eq!(detail.paid_amount, 100.00);
        assert_eq!(detail.outstanding_amount, 0.0);
        assert_eq!(detail.settlement_status, SettlementStatus::Paid);
    }

    #[test]
    fn test_tc_ap_der_01_to_04_derived_values_and_voided_payment_restoration() {
        // Given: AP of 100.00
        let mut conn = setup_test_db();
        let input = CreateAccountPayableInput {
            vendor_partner_id: "vnd_001".to_string(),
            source_type: "vendor_bill".to_string(),
            source_id: "bill_der".to_string(),
            source_number: "BILL-DER".to_string(),
            external_reference: None,
            document_date: "2026-11-04".to_string(),
            due_date: "2026-11-20".to_string(),
            amount: 100.00,
            currency: None,
        };
        let ap = create_account_payable(&mut conn, "tnt_test", "usr_admin", input).unwrap();

        // Case DER-01: No allocations -> Unpaid
        let d1 = get_account_payable_impl(&conn, "tnt_test", &ap.id).unwrap();
        assert_eq!(d1.paid_amount, 0.0);
        assert_eq!(d1.outstanding_amount, 100.0);
        assert_eq!(d1.settlement_status, SettlementStatus::Unpaid);

        // Case DER-02: Partial allocation (40.00) -> PartiallyPaid
        conn.execute(
            "INSERT INTO payments (id, tenant_id, payment_number, vendor_partner_id, payment_date, amount, currency, status, created_by, created_at)
             VALUES ('pay_part', 'tnt_test', 'PAY-PART', 'vnd_001', '2026-11-05', 40.0, 'TWD', 'posted', 'usr_admin', 2000)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO payment_allocations (id, tenant_id, payment_id, account_payable_id, amount, created_at)
             VALUES ('pa_part', 'tnt_test', 'pay_part', ?1, 40.0, 2000)",
            params![ap.id],
        ).unwrap();
        let d2 = get_account_payable_impl(&conn, "tnt_test", &ap.id).unwrap();
        assert_eq!(d2.paid_amount, 40.0);
        assert_eq!(d2.outstanding_amount, 60.0);
        assert_eq!(d2.settlement_status, SettlementStatus::PartiallyPaid);

        // Case DER-03: Full allocation (+60.00) -> Paid
        conn.execute(
            "INSERT INTO payments (id, tenant_id, payment_number, vendor_partner_id, payment_date, amount, currency, status, created_by, created_at)
             VALUES ('pay_full', 'tnt_test', 'PAY-FULL', 'vnd_001', '2026-11-06', 60.0, 'TWD', 'posted', 'usr_admin', 2010)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO payment_allocations (id, tenant_id, payment_id, account_payable_id, amount, created_at)
             VALUES ('pa_full', 'tnt_test', 'pay_full', ?1, 60.0, 2010)",
            params![ap.id],
        ).unwrap();
        let d3 = get_account_payable_impl(&conn, "tnt_test", &ap.id).unwrap();
        assert_eq!(d3.paid_amount, 100.0);
        assert_eq!(d3.outstanding_amount, 0.0);
        assert_eq!(d3.settlement_status, SettlementStatus::Paid);

        // Case DER-04: Voiding both payments restores outstanding amount and returns to Unpaid
        conn.execute(
            "UPDATE payments SET status = 'voided' WHERE id IN ('pay_part', 'pay_full')",
            [],
        )
        .unwrap();
        let d4 = get_account_payable_impl(&conn, "tnt_test", &ap.id).unwrap();
        assert_eq!(d4.paid_amount, 0.0);
        assert_eq!(d4.outstanding_amount, 100.0);
        assert_eq!(d4.settlement_status, SettlementStatus::Unpaid);
    }

    #[test]
    fn test_tc_ap_07_n1_n2_b1_tenant_isolation_filter_and_voided_balance() {
        // Given: Two APs in tnt_test and one in tnt_other
        let mut conn = setup_test_db();
        let ap1 = create_account_payable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateAccountPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                source_type: "vendor_bill".to_string(),
                source_id: "bill_t1".to_string(),
                source_number: "BILL-T1".to_string(),
                external_reference: None,
                document_date: "2026-11-01".to_string(),
                due_date: "2026-11-15".to_string(),
                amount: 1000.0,
                currency: None,
            },
        )
        .unwrap();

        let ap2 = create_account_payable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateAccountPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                source_type: "vendor_bill".to_string(),
                source_id: "bill_t2".to_string(),
                source_number: "BILL-T2".to_string(),
                external_reference: None,
                document_date: "2026-11-02".to_string(),
                due_date: "2026-11-25".to_string(),
                amount: 2000.0,
                currency: None,
            },
        )
        .unwrap();

        // Create AP in another tenant
        create_account_payable(
            &mut conn,
            "tnt_other",
            "usr_admin",
            CreateAccountPayableInput {
                vendor_partner_id: "vnd_other".to_string(),
                source_type: "vendor_bill".to_string(),
                source_id: "bill_other".to_string(),
                source_number: "BILL-OTHER".to_string(),
                external_reference: None,
                document_date: "2026-11-01".to_string(),
                due_date: "2026-11-15".to_string(),
                amount: 9999.0,
                currency: None,
            },
        )
        .unwrap();

        // When: Querying tnt_test
        let list_tnt_test =
            list_accounts_payable_impl(&conn, "tnt_test", ListAccountsPayableFilter::default())
                .unwrap();
        // Then: Cross-tenant isolation (only 2 records returned, tnt_other excluded)
        assert_eq!(list_tnt_test.len(), 2);

        // When: Filtering by due_date_from / due_date_to
        let list_filtered_date = list_accounts_payable_impl(
            &conn,
            "tnt_test",
            ListAccountsPayableFilter {
                due_date_from: Some("2026-11-20".to_string()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(list_filtered_date.len(), 1);
        assert_eq!(list_filtered_date[0].id, ap2.id);

        // When: Voiding ap1
        void_account_payable(&mut conn, "tnt_test", "usr_admin", &ap1.id, "作廢 ap1").unwrap();
        let detail_voided = get_account_payable_impl(&conn, "tnt_test", &ap1.id).unwrap();
        // Then: AP-07: voided AP does not contribute to balance (outstanding is 0.0)
        assert_eq!(detail_voided.outstanding_amount, 0.0);
        assert_eq!(detail_voided.status, "voided");
    }

    #[test]
    fn test_tc_ap_edge_cases_source_type_user_id_and_settlement_status_filters() {
        // Given: DB with test vendor
        let mut conn = setup_test_db();

        // Edge 1: Empty user_id on create
        let res_no_user = create_account_payable(
            &mut conn,
            "tnt_test",
            "   ",
            CreateAccountPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                source_type: "vendor_bill".to_string(),
                source_id: "bill_x1".to_string(),
                source_number: "BILL-X1".to_string(),
                external_reference: None,
                document_date: "2026-11-01".to_string(),
                due_date: "2026-11-15".to_string(),
                amount: 100.0,
                currency: None,
            },
        );
        assert_eq!(res_no_user.unwrap_err(), AccountsPayableError::EmptyUserId);

        // Edge 2: Invalid source_type
        let res_invalid_source = create_account_payable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateAccountPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                source_type: "invalid_type".to_string(),
                source_id: "bill_x2".to_string(),
                source_number: "BILL-X2".to_string(),
                external_reference: None,
                document_date: "2026-11-01".to_string(),
                due_date: "2026-11-15".to_string(),
                amount: 100.0,
                currency: None,
            },
        );
        assert_eq!(
            res_invalid_source.unwrap_err(),
            AccountsPayableError::InvalidSourceType
        );

        // Edge 3: Empty source_number
        let res_empty_source_num = create_account_payable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateAccountPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                source_type: "vendor_bill".to_string(),
                source_id: "bill_x3".to_string(),
                source_number: "  ".to_string(),
                external_reference: None,
                document_date: "2026-11-01".to_string(),
                due_date: "2026-11-15".to_string(),
                amount: 100.0,
                currency: None,
            },
        );
        assert_eq!(
            res_empty_source_num.unwrap_err(),
            AccountsPayableError::EmptySourceNumber
        );

        // Edge 4: Nonexistent AP on get
        let res_get_missing = get_account_payable_impl(&conn, "tnt_test", "ap_nonexistent");
        assert_eq!(res_get_missing.unwrap_err(), AccountsPayableError::NotFound);

        // Edge 5: Nonexistent AP on void
        let res_void_missing = void_account_payable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            "ap_nonexistent",
            "測試作廢",
        );
        assert_eq!(
            res_void_missing.unwrap_err(),
            AccountsPayableError::NotFound
        );

        // Edge 6: Filter list by settlement_status using both Chinese and English alias
        let ap_open = create_account_payable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateAccountPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                source_type: "opening_balance".to_string(),
                source_id: "oap_001".to_string(),
                source_number: "OAP-00001".to_string(),
                external_reference: None,
                document_date: "2026-11-01".to_string(),
                due_date: "2026-11-01".to_string(),
                amount: 500.0,
                currency: None,
            },
        )
        .unwrap();

        let list_unpaid_en = list_accounts_payable_impl(
            &conn,
            "tnt_test",
            ListAccountsPayableFilter {
                settlement_status: Some("unpaid".to_string()),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(list_unpaid_en.iter().any(|item| item.id == ap_open.id));

        let list_unpaid_zh = list_accounts_payable_impl(
            &conn,
            "tnt_test",
            ListAccountsPayableFilter {
                settlement_status: Some("未付".to_string()),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(list_unpaid_zh.iter().any(|item| item.id == ap_open.id));

        let list_paid_filter = list_accounts_payable_impl(
            &conn,
            "tnt_test",
            ListAccountsPayableFilter {
                settlement_status: Some("paid".to_string()),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(!list_paid_filter.iter().any(|item| item.id == ap_open.id));
    }
}
