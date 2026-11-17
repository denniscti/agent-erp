use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
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

    #[error("起日不可晚於迄日")]
    InvalidDateRange,

    #[error("無效的日期格式，需為 YYYY-MM-DD")]
    InvalidDateFormat,

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub enum AgingBucket {
    #[serde(rename = "current")]
    Current,
    #[serde(rename = "1-30")]
    Overdue1To30,
    #[serde(rename = "31-60")]
    Overdue31To60,
    #[serde(rename = "61-90")]
    Overdue61To90,
    #[serde(rename = "90+")]
    Overdue90Plus,
}

impl AgingBucket {
    pub fn from_overdue_days(days: i32) -> Self {
        if days <= 0 {
            AgingBucket::Current
        } else if days <= 30 {
            AgingBucket::Overdue1To30
        } else if days <= 60 {
            AgingBucket::Overdue31To60
        } else if days <= 90 {
            AgingBucket::Overdue61To90
        } else {
            AgingBucket::Overdue90Plus
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            AgingBucket::Current => "current",
            AgingBucket::Overdue1To30 => "1-30",
            AgingBucket::Overdue31To60 => "31-60",
            AgingBucket::Overdue61To90 => "61-90",
            AgingBucket::Overdue90Plus => "90+",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct PayableAgingItem {
    pub account_payable_id: String,
    pub source_id: String,
    pub source_type: String,
    pub source_number: String,
    pub vendor_partner_id: String,
    pub vendor_name_snapshot: String,
    pub external_reference: Option<String>,
    pub document_date: String,
    pub due_date: String,
    pub overdue_days: i32,
    pub bucket: String,
    pub amount: f64,
    pub paid_amount: f64,
    pub outstanding_amount: f64,
    pub settlement_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, Default)]
pub struct VendorPayablesAging {
    pub vendor_partner_id: String,
    pub vendor_name: String,
    pub current: f64,
    pub overdue_1_30: f64,
    pub overdue_31_60: f64,
    pub overdue_61_90: f64,
    pub overdue_90_plus: f64,
    pub total_outstanding: f64,
    pub unbilled_received_amount: f64,
    pub items: Vec<PayableAgingItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, Default)]
pub struct AgingBucketTotals {
    pub current: f64,
    pub overdue_1_30: f64,
    pub overdue_31_60: f64,
    pub overdue_61_90: f64,
    pub overdue_90_plus: f64,
    pub total_outstanding: f64,
    pub unbilled_received_amount: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct PayablesAgingReport {
    pub as_of_date: String,
    pub vendors: Vec<VendorPayablesAging>,
    pub totals: AgingBucketTotals,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct StatementPayableItem {
    pub account_payable_id: String,
    pub document_date: String,
    pub source_type: String,
    pub source_id: String,
    pub source_number: String,
    pub external_reference: Option<String>,
    pub due_date: String,
    pub amount: f64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct StatementPaymentAllocation {
    pub account_payable_id: String,
    pub source_type: String,
    pub source_id: String,
    pub source_number: String,
    pub amount: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct StatementPaymentItem {
    pub payment_id: String,
    pub payment_number: String,
    pub payment_date: String,
    pub payment_method: String,
    pub payment_reference: Option<String>,
    pub amount: f64,
    pub note: Option<String>,
    pub allocations: Vec<StatementPaymentAllocation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct VendorStatement {
    pub tenant_id: String,
    pub vendor_partner_id: String,
    pub vendor_name: String,
    pub start_date: String,
    pub end_date: String,
    pub opening_balance: f64,
    pub current_payables_total: f64,
    pub current_payments_total: f64,
    pub closing_balance: f64,
    pub payables: Vec<StatementPayableItem>,
    pub payments: Vec<StatementPaymentItem>,
}

pub fn parse_ymd(s: &str) -> Option<(i32, i32, i32)> {
    let parts: Vec<&str> = s.trim().split('-').collect();
    if parts.len() != 3 {
        return None;
    }
    let y = parts[0].parse::<i32>().ok()?;
    let m = parts[1].parse::<i32>().ok()?;
    let d = parts[2].parse::<i32>().ok()?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    Some((y, m, d))
}

pub fn ymd_to_jdn(y: i32, m: i32, d: i32) -> i32 {
    let (y, m) = if m <= 2 { (y - 1, m + 12) } else { (y, m) };
    let a = y / 100;
    let b = 2 - a + a / 4;
    (1461 * (y + 4716)) / 4 + (153 * (m + 1)) / 5 + d + b - 1524
}

/// Calculate day difference: to_date - from_date
/// Returns positive integer if to_date is after from_date
pub fn calendar_day_diff(from_date: &str, to_date: &str) -> Option<i32> {
    let (fy, fm, fd) = parse_ymd(from_date)?;
    let (ty, tm, td) = parse_ymd(to_date)?;
    Some(ymd_to_jdn(ty, tm, td) - ymd_to_jdn(fy, fm, fd))
}

pub fn is_valid_ymd_string(s: &str) -> bool {
    let trimmed = s.trim();
    if trimmed.len() != 10 {
        return false;
    }
    let parts: Vec<&str> = trimmed.split('-').collect();
    if parts.len() != 3 || parts[0].len() != 4 || parts[1].len() != 2 || parts[2].len() != 2 {
        return false;
    }
    parse_ymd(trimmed).is_some()
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
         FROM vendor_payment_allocations pa
         JOIN vendor_payments p ON p.id = pa.payment_id AND p.tenant_id = pa.tenant_id
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
         FROM vendor_payment_allocations pa
         JOIN vendor_payments p ON p.id = pa.payment_id AND p.tenant_id = pa.tenant_id
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

    // Call unified get_ap_info for outstanding balance
    let (_tot, outstanding_amount, _, _, _, _) =
        crate::vendor_payments::get_ap_info(conn, tid, target_id).map_err(|e| match e {
            crate::vendor_payments::VendorPaymentError::InvalidAllocationAccountPayable => {
                AccountsPayableError::NotFound
            }
            _ => AccountsPayableError::DatabaseError(e.to_string()),
        })?;

    let (paid_amount, _, settlement_status) =
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
                 FROM vendor_payment_allocations pa
                 JOIN vendor_payments p ON p.id = pa.payment_id AND p.tenant_id = pa.tenant_id
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

pub fn get_payables_aging_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    as_of_date: Option<String>,
) -> Result<PayablesAgingReport, AccountsPayableError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(AccountsPayableError::EmptyTenantId);
    }

    // Determine as_of_date (strictly calendar date YYYY-MM-DD)
    let as_of = match as_of_date {
        Some(ref d) if !d.trim().is_empty() => d.trim().to_string(),
        _ => conn
            .query_row("SELECT date('now', 'localtime')", [], |r| {
                r.get::<_, String>(0)
            })
            .unwrap_or_else(|_| "2026-11-05".to_string()),
    };

    // 1. Unbilled received orders (reference column, untaxed total)
    let unbilled_list =
        match crate::vendor_bills::list_unbilled_received_orders_impl(conn, tid, None) {
            Ok(list) => list,
            Err(crate::vendor_bills::VendorBillError::EmptyTenantId) => {
                return Err(AccountsPayableError::EmptyTenantId)
            }
            Err(_) => Vec::new(),
        };

    let mut unbilled_map: BTreeMap<String, (String, f64)> = BTreeMap::new();
    for u in unbilled_list {
        let entry = unbilled_map
            .entry(u.vendor_partner_id.clone())
            .or_insert((u.vendor_name_snapshot.clone(), 0.0));
        entry.1 += u.received_total_amount;
    }

    // 2. Open accounts payable with outstanding_amount > 0
    let open_aps = list_accounts_payable_impl(
        conn,
        tid,
        ListAccountsPayableFilter {
            status: Some("open".to_string()),
            ..Default::default()
        },
    )?;

    let mut vendor_map: BTreeMap<String, VendorPayablesAging> = BTreeMap::new();

    for ap in open_aps {
        if ap.outstanding_amount <= 0.0 {
            continue;
        }

        // overdue_days = as_of - due_date
        let overdue_days = calendar_day_diff(&ap.due_date, &as_of).unwrap_or(0);
        let bucket = AgingBucket::from_overdue_days(overdue_days);

        let vendor_entry = vendor_map
            .entry(ap.vendor_partner_id.clone())
            .or_insert_with(|| VendorPayablesAging {
                vendor_partner_id: ap.vendor_partner_id.clone(),
                vendor_name: ap.vendor_name_snapshot.clone(),
                current: 0.0,
                overdue_1_30: 0.0,
                overdue_31_60: 0.0,
                overdue_61_90: 0.0,
                overdue_90_plus: 0.0,
                total_outstanding: 0.0,
                unbilled_received_amount: 0.0,
                items: Vec::new(),
            });

        match bucket {
            AgingBucket::Current => vendor_entry.current += ap.outstanding_amount,
            AgingBucket::Overdue1To30 => vendor_entry.overdue_1_30 += ap.outstanding_amount,
            AgingBucket::Overdue31To60 => vendor_entry.overdue_31_60 += ap.outstanding_amount,
            AgingBucket::Overdue61To90 => vendor_entry.overdue_61_90 += ap.outstanding_amount,
            AgingBucket::Overdue90Plus => vendor_entry.overdue_90_plus += ap.outstanding_amount,
        }
        vendor_entry.total_outstanding += ap.outstanding_amount;

        vendor_entry.items.push(PayableAgingItem {
            account_payable_id: ap.id,
            source_id: ap.source_id,
            source_type: ap.source_type,
            source_number: ap.source_number,
            vendor_partner_id: ap.vendor_partner_id,
            vendor_name_snapshot: ap.vendor_name_snapshot,
            external_reference: ap.external_reference,
            document_date: ap.document_date,
            due_date: ap.due_date,
            overdue_days,
            bucket: bucket.as_str().to_string(),
            amount: ap.amount,
            paid_amount: ap.paid_amount,
            outstanding_amount: ap.outstanding_amount,
            settlement_status: ap.settlement_status.as_str().to_string(),
        });
    }

    // Merge unbilled received orders
    for (v_id, (v_name, unbilled_amt)) in unbilled_map {
        let vendor_entry = vendor_map
            .entry(v_id.clone())
            .or_insert_with(|| VendorPayablesAging {
                vendor_partner_id: v_id,
                vendor_name: v_name,
                current: 0.0,
                overdue_1_30: 0.0,
                overdue_31_60: 0.0,
                overdue_61_90: 0.0,
                overdue_90_plus: 0.0,
                total_outstanding: 0.0,
                unbilled_received_amount: 0.0,
                items: Vec::new(),
            });
        vendor_entry.unbilled_received_amount = round_2(unbilled_amt);
    }

    // Round vendor sums and filter vendors: only keep total_outstanding > 0 || unbilled_received_amount > 0
    let mut filtered_vendors: Vec<VendorPayablesAging> = Vec::new();
    for mut v in vendor_map.into_values() {
        v.current = round_2(v.current);
        v.overdue_1_30 = round_2(v.overdue_1_30);
        v.overdue_31_60 = round_2(v.overdue_31_60);
        v.overdue_61_90 = round_2(v.overdue_61_90);
        v.overdue_90_plus = round_2(v.overdue_90_plus);
        v.total_outstanding = round_2(v.total_outstanding);
        v.unbilled_received_amount = round_2(v.unbilled_received_amount);

        if v.total_outstanding > 0.0 || v.unbilled_received_amount > 0.0 {
            filtered_vendors.push(v);
        }
    }

    filtered_vendors.sort_by(|a, b| a.vendor_name.cmp(&b.vendor_name));

    // Calculate totals across all qualifying vendors
    let mut totals = AgingBucketTotals::default();
    for v in &filtered_vendors {
        totals.current += v.current;
        totals.overdue_1_30 += v.overdue_1_30;
        totals.overdue_31_60 += v.overdue_31_60;
        totals.overdue_61_90 += v.overdue_61_90;
        totals.overdue_90_plus += v.overdue_90_plus;
        totals.total_outstanding += v.total_outstanding;
        totals.unbilled_received_amount += v.unbilled_received_amount;
    }

    totals.current = round_2(totals.current);
    totals.overdue_1_30 = round_2(totals.overdue_1_30);
    totals.overdue_31_60 = round_2(totals.overdue_31_60);
    totals.overdue_61_90 = round_2(totals.overdue_61_90);
    totals.overdue_90_plus = round_2(totals.overdue_90_plus);
    totals.total_outstanding = round_2(totals.total_outstanding);
    totals.unbilled_received_amount = round_2(totals.unbilled_received_amount);

    Ok(PayablesAgingReport {
        as_of_date: as_of,
        vendors: filtered_vendors,
        totals,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn get_payables_aging<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    as_of_date: Option<String>,
) -> Result<PayablesAgingReport, String> {
    let db_path = crate::get_db_path(&app_handle);
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    get_payables_aging_impl(&conn, &active_tid, as_of_date).map_err(|e| e.to_string())
}

pub fn get_vendor_statement_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    vendor_partner_id: &str,
    start_date: &str,
    end_date: &str,
) -> Result<VendorStatement, AccountsPayableError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(AccountsPayableError::EmptyTenantId);
    }

    let vid = vendor_partner_id.trim();
    if vid.is_empty() {
        return Err(AccountsPayableError::VendorNotFound);
    }

    let vendor_name = resolve_vendor_snapshot(conn, tid, vid)?;

    let s_date = start_date.trim();
    let e_date = end_date.trim();
    if !is_valid_ymd_string(s_date) || !is_valid_ymd_string(e_date) {
        return Err(AccountsPayableError::InvalidDateFormat);
    }
    if s_date > e_date {
        return Err(AccountsPayableError::InvalidDateRange);
    }

    // 1. Calculate opening balance:
    // Σ(document_date < start_date of non-voided AP) - Σ(payment_date < start_date of posted payment allocations)
    let opening_ap: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0.0)
         FROM accounts_payable
         WHERE tenant_id = ?1
           AND vendor_partner_id = ?2
           AND status != 'voided'
           AND document_date < ?3",
        params![tid, vid, s_date],
        |row| row.get(0),
    )?;

    let opening_paid: f64 = conn.query_row(
        "SELECT COALESCE(SUM(pa.amount), 0.0)
         FROM vendor_payment_allocations pa
         JOIN vendor_payments p ON p.id = pa.payment_id AND p.tenant_id = pa.tenant_id
         JOIN accounts_payable ap ON ap.id = pa.account_payable_id AND ap.tenant_id = pa.tenant_id
         WHERE pa.tenant_id = ?1
           AND p.vendor_partner_id = ?2
           AND p.status = 'posted'
           AND ap.status != 'voided'
           AND p.payment_date < ?3",
        params![tid, vid, s_date],
        |row| row.get(0),
    )?;

    let opening_balance = round_2(opening_ap - opening_paid);

    // 2. Query current period payables [start_date, end_date]
    let mut ap_stmt = conn.prepare(
        "SELECT id, source_type, source_id, source_number, external_reference, document_date, due_date, amount, status
         FROM accounts_payable
         WHERE tenant_id = ?1
           AND vendor_partner_id = ?2
           AND status != 'voided'
           AND document_date >= ?3
           AND document_date <= ?4
         ORDER BY document_date ASC, created_at ASC, id ASC",
    )?;

    let payables_rows = ap_stmt.query_map(params![tid, vid, s_date, e_date], |row| {
        Ok(StatementPayableItem {
            account_payable_id: row.get(0)?,
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

    let mut payables = Vec::new();
    let mut current_payables_total = 0.0;
    for p in payables_rows {
        let item = p?;
        current_payables_total += item.amount;
        payables.push(item);
    }
    current_payables_total = round_2(current_payables_total);

    // 3. Query current period posted payments [start_date, end_date]
    let mut pay_stmt = conn.prepare(
        "SELECT id, payment_number, payment_date, payment_method, payment_reference, note
         FROM vendor_payments
         WHERE tenant_id = ?1
           AND vendor_partner_id = ?2
           AND status = 'posted'
           AND payment_date >= ?3
           AND payment_date <= ?4
         ORDER BY payment_date ASC, created_at ASC, id ASC",
    )?;

    struct RawPaymentHeader {
        id: String,
        payment_number: String,
        payment_date: String,
        payment_method: String,
        payment_reference: Option<String>,
        note: Option<String>,
    }

    let payment_headers = pay_stmt.query_map(params![tid, vid, s_date, e_date], |row| {
        Ok(RawPaymentHeader {
            id: row.get(0)?,
            payment_number: row.get(1)?,
            payment_date: row.get(2)?,
            payment_method: row.get(3)?,
            payment_reference: row.get(4)?,
            note: row.get(5)?,
        })
    })?;

    let mut alloc_stmt = conn.prepare(
        "SELECT pa.account_payable_id, ap.source_type, ap.source_id, ap.source_number, pa.amount
         FROM vendor_payment_allocations pa
         JOIN accounts_payable ap ON ap.id = pa.account_payable_id AND ap.tenant_id = pa.tenant_id
         WHERE pa.tenant_id = ?1
           AND pa.payment_id = ?2
           AND ap.status != 'voided'
         ORDER BY pa.created_at ASC, pa.id ASC",
    )?;

    let mut payments = Vec::new();
    let mut current_payments_total = 0.0;
    for ph_res in payment_headers {
        let ph = ph_res?;
        let alloc_rows = alloc_stmt.query_map(params![tid, &ph.id], |arow| {
            Ok(StatementPaymentAllocation {
                account_payable_id: arow.get(0)?,
                source_type: arow.get(1)?,
                source_id: arow.get(2)?,
                source_number: arow.get(3)?,
                amount: round_2(arow.get(4)?),
            })
        })?;

        let mut allocations = Vec::new();
        let mut payment_amount = 0.0;
        for a in alloc_rows {
            let item = a?;
            payment_amount += item.amount;
            allocations.push(item);
        }
        payment_amount = round_2(payment_amount);
        current_payments_total += payment_amount;

        payments.push(StatementPaymentItem {
            payment_id: ph.id,
            payment_number: ph.payment_number,
            payment_date: ph.payment_date,
            payment_method: ph.payment_method,
            payment_reference: ph.payment_reference,
            amount: payment_amount,
            note: ph.note,
            allocations,
        });
    }
    current_payments_total = round_2(current_payments_total);

    // 4. Closing balance
    let closing_balance =
        round_2(opening_balance + current_payables_total - current_payments_total);

    Ok(VendorStatement {
        tenant_id: tid.to_string(),
        vendor_partner_id: vid.to_string(),
        vendor_name,
        start_date: s_date.to_string(),
        end_date: e_date.to_string(),
        opening_balance,
        current_payables_total,
        current_payments_total,
        closing_balance,
        payables,
        payments,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn get_vendor_statement<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    vendor_partner_id: String,
    start_date: String,
    end_date: String,
) -> Result<VendorStatement, String> {
    let db_path = crate::get_db_path(&app_handle);
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    get_vendor_statement_impl(
        &conn,
        &active_tid,
        &vendor_partner_id,
        &start_date,
        &end_date,
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
        crate::vendor_payments::create_vendor_payment_tables(&conn).unwrap();

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
            "INSERT INTO vendor_payments (id, tenant_id, payment_number, vendor_partner_id, vendor_name_snapshot, payment_date, payment_method, currency, status, created_by, created_at)
             VALUES ('pay_001', 'tnt_test', 'PAY-00001', 'vnd_001', '測試供應商股份公司', '2026-11-05', 'bank_transfer', 'TWD', 'posted', 'usr_admin', 2000)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO vendor_payment_allocations (id, tenant_id, payment_id, account_payable_id, amount, created_at)
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
            "UPDATE vendor_payments SET status = 'voided' WHERE id = 'pay_001'",
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
            "INSERT INTO vendor_payments (id, tenant_id, payment_number, vendor_partner_id, vendor_name_snapshot, payment_date, payment_method, currency, status, created_by, created_at)
             VALUES ('pay_real_1', 'tnt_test', 'PAY-REAL-1', 'vnd_001', '測試供應商股份公司', '2026-11-05', 'bank_transfer', 'TWD', 'posted', 'usr_admin', 2000),
                    ('pay_real_2', 'tnt_test', 'PAY-REAL-2', 'vnd_001', '測試供應商股份公司', '2026-11-05', 'bank_transfer', 'TWD', 'posted', 'usr_admin', 2000),
                    ('pay_real_3', 'tnt_test', 'PAY-REAL-3', 'vnd_001', '測試供應商股份公司', '2026-11-05', 'bank_transfer', 'TWD', 'posted', 'usr_admin', 2000),
                    ('pay_real_4', 'tnt_test', 'PAY-REAL-4', 'vnd_001', '測試供應商股份公司', '2026-11-05', 'bank_transfer', 'TWD', 'posted', 'usr_admin', 2000)",
            [],
        ).unwrap();

        // Three 33.33 and one 0.01
        conn.execute(
            "INSERT INTO vendor_payment_allocations (id, tenant_id, payment_id, account_payable_id, amount, created_at) VALUES
             ('pa_1', 'tnt_test', 'pay_real_1', ?1, 33.33, 2001),
             ('pa_2', 'tnt_test', 'pay_real_2', ?1, 33.33, 2002),
             ('pa_3', 'tnt_test', 'pay_real_3', ?1, 33.33, 2003),
             ('pa_4', 'tnt_test', 'pay_real_4', ?1, 0.01, 2004)",
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
            "INSERT INTO vendor_payments (id, tenant_id, payment_number, vendor_partner_id, vendor_name_snapshot, payment_date, payment_method, currency, status, created_by, created_at)
             VALUES ('pay_part', 'tnt_test', 'PAY-PART', 'vnd_001', '測試供應商股份公司', '2026-11-05', 'bank_transfer', 'TWD', 'posted', 'usr_admin', 2000)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO vendor_payment_allocations (id, tenant_id, payment_id, account_payable_id, amount, created_at)
             VALUES ('pa_part', 'tnt_test', 'pay_part', ?1, 40.0, 2000)",
            params![ap.id],
        ).unwrap();
        let d2 = get_account_payable_impl(&conn, "tnt_test", &ap.id).unwrap();
        assert_eq!(d2.paid_amount, 40.0);
        assert_eq!(d2.outstanding_amount, 60.0);
        assert_eq!(d2.settlement_status, SettlementStatus::PartiallyPaid);

        // Case DER-03: Full allocation (+60.00) -> Paid
        conn.execute(
            "INSERT INTO vendor_payments (id, tenant_id, payment_number, vendor_partner_id, vendor_name_snapshot, payment_date, payment_method, currency, status, created_by, created_at)
             VALUES ('pay_full', 'tnt_test', 'PAY-FULL', 'vnd_001', '測試供應商股份公司', '2026-11-06', 'bank_transfer', 'TWD', 'posted', 'usr_admin', 2010)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO vendor_payment_allocations (id, tenant_id, payment_id, account_payable_id, amount, created_at)
             VALUES ('pa_full', 'tnt_test', 'pay_full', ?1, 60.0, 2010)",
            params![ap.id],
        ).unwrap();
        let d3 = get_account_payable_impl(&conn, "tnt_test", &ap.id).unwrap();
        assert_eq!(d3.paid_amount, 100.0);
        assert_eq!(d3.outstanding_amount, 0.0);
        assert_eq!(d3.settlement_status, SettlementStatus::Paid);

        // Case DER-04: Voiding both payments restores outstanding amount and returns to Unpaid
        conn.execute(
            "UPDATE vendor_payments SET status = 'voided' WHERE id IN ('pay_part', 'pay_full')",
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

    #[test]
    fn test_tc_ap_aging_b01_to_b11_date_diff_and_boundaries() {
        // Given: Fixed as_of_date "2026-03-02"
        let as_of = "2026-03-02";

        // When & Then (TC-AGING-B01): due_date = as_of -> overdue_days = 0, bucket = Current
        let diff_0 = calendar_day_diff("2026-03-02", as_of).unwrap();
        assert_eq!(diff_0, 0);
        assert_eq!(AgingBucket::from_overdue_days(diff_0), AgingBucket::Current);
        assert_eq!(AgingBucket::from_overdue_days(diff_0).as_str(), "current");

        // When & Then (TC-AGING-B02): due_date = tomorrow ("2026-03-03") -> overdue_days = -1, bucket = Current
        let diff_neg1 = calendar_day_diff("2026-03-03", as_of).unwrap();
        assert_eq!(diff_neg1, -1);
        assert_eq!(
            AgingBucket::from_overdue_days(diff_neg1),
            AgingBucket::Current
        );

        // When & Then (TC-AGING-B03): due_date = 1 day ago ("2026-03-01") -> overdue_days = 1, bucket = 1-30
        let diff_1 = calendar_day_diff("2026-03-01", as_of).unwrap();
        assert_eq!(diff_1, 1);
        assert_eq!(
            AgingBucket::from_overdue_days(diff_1),
            AgingBucket::Overdue1To30
        );
        assert_eq!(AgingBucket::from_overdue_days(diff_1).as_str(), "1-30");

        // When & Then (TC-AGING-B10 & B04): cross-month "2026-01-31" to "2026-03-02" -> exactly 30 days, bucket = 1-30
        let diff_30 = calendar_day_diff("2026-01-31", as_of).unwrap();
        assert_eq!(diff_30, 30);
        assert_eq!(
            AgingBucket::from_overdue_days(diff_30),
            AgingBucket::Overdue1To30
        );

        // When & Then (TC-AGING-B05): due_date 31 days ago ("2026-01-30") -> 31 days, bucket = 31-60
        let diff_31 = calendar_day_diff("2026-01-30", as_of).unwrap();
        assert_eq!(diff_31, 31);
        assert_eq!(
            AgingBucket::from_overdue_days(diff_31),
            AgingBucket::Overdue31To60
        );
        assert_eq!(AgingBucket::from_overdue_days(diff_31).as_str(), "31-60");

        // When & Then (TC-AGING-B06): due_date 60 days ago ("2026-01-01") -> 60 days, bucket = 31-60
        let diff_60 = calendar_day_diff("2026-01-01", as_of).unwrap();
        assert_eq!(diff_60, 60);
        assert_eq!(
            AgingBucket::from_overdue_days(diff_60),
            AgingBucket::Overdue31To60
        );

        // When & Then (TC-AGING-B07 & B11): cross-year "2025-12-31" to "2026-03-02" -> 61 days, bucket = 61-90
        let diff_61 = calendar_day_diff("2025-12-31", as_of).unwrap();
        assert_eq!(diff_61, 61);
        assert_eq!(
            AgingBucket::from_overdue_days(diff_61),
            AgingBucket::Overdue61To90
        );
        assert_eq!(AgingBucket::from_overdue_days(diff_61).as_str(), "61-90");

        // When & Then (TC-AGING-B08): due_date 90 days ago ("2025-12-02") -> 90 days, bucket = 61-90
        let diff_90 = calendar_day_diff("2025-12-02", as_of).unwrap();
        assert_eq!(diff_90, 90);
        assert_eq!(
            AgingBucket::from_overdue_days(diff_90),
            AgingBucket::Overdue61To90
        );

        // When & Then (TC-AGING-B09): due_date 91 days ago ("2025-12-01") -> 91 days, bucket = 90+
        let diff_91 = calendar_day_diff("2025-12-01", as_of).unwrap();
        assert_eq!(diff_91, 91);
        assert_eq!(
            AgingBucket::from_overdue_days(diff_91),
            AgingBucket::Overdue90Plus
        );
        assert_eq!(AgingBucket::from_overdue_days(diff_91).as_str(), "90+");

        // When & Then (TC-AGING-B11 cross-year 1 day): "2025-12-31" to "2026-01-01" -> 1 day
        let diff_cy = calendar_day_diff("2025-12-31", "2026-01-01").unwrap();
        assert_eq!(diff_cy, 1);
    }

    #[test]
    fn test_tc_ap_aging_n01_to_n03_b12_report_buckets_and_totals() {
        // Given: Seed database with APs across all 5 buckets
        let mut conn = setup_test_db();
        let as_of = Some("2026-03-02".to_string());

        // AP 1: Current (due today 2026-03-02), amount 1000
        create_account_payable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateAccountPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                source_type: "vendor_bill".to_string(),
                source_id: "bill_001".to_string(),
                source_number: "BILL-001".to_string(),
                external_reference: Some("INV-001".to_string()),
                document_date: "2026-02-01".to_string(),
                due_date: "2026-03-02".to_string(),
                amount: 1000.0,
                currency: None,
            },
        )
        .unwrap();

        // AP 2: Overdue 1-30 (due 2026-01-31 = 30 days), amount 2000
        create_account_payable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateAccountPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                source_type: "vendor_bill".to_string(),
                source_id: "bill_002".to_string(),
                source_number: "BILL-002".to_string(),
                external_reference: None,
                document_date: "2026-01-01".to_string(),
                due_date: "2026-01-31".to_string(),
                amount: 2000.0,
                currency: None,
            },
        )
        .unwrap();

        // AP 3: Overdue 31-60 (due 2026-01-30 = 31 days), amount 3000
        create_account_payable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateAccountPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                source_type: "opening_balance".to_string(),
                source_id: "oap_001".to_string(),
                source_number: "OAP-001".to_string(),
                external_reference: None,
                document_date: "2026-01-01".to_string(),
                due_date: "2026-01-30".to_string(),
                amount: 3000.0,
                currency: None,
            },
        )
        .unwrap();

        // AP 4: Overdue 61-90 (due 2025-12-31 = 61 days), amount 4000
        create_account_payable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateAccountPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                source_type: "opening_balance".to_string(),
                source_id: "oap_002".to_string(),
                source_number: "OAP-002".to_string(),
                external_reference: None,
                document_date: "2025-12-01".to_string(),
                due_date: "2025-12-31".to_string(),
                amount: 4000.0,
                currency: None,
            },
        )
        .unwrap();

        // AP 5: Overdue 90+ (due 2025-12-01 = 91 days), amount 5000, with partial payment 4999.99 (TC-AGING-B12)
        let ap5 = create_account_payable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateAccountPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                source_type: "opening_balance".to_string(),
                source_id: "oap_003".to_string(),
                source_number: "OAP-003".to_string(),
                external_reference: None,
                document_date: "2025-11-01".to_string(),
                due_date: "2025-12-01".to_string(),
                amount: 5000.0,
                currency: None,
            },
        )
        .unwrap();

        // Simulate partial payment of 4999.99 on ap5
        conn.execute(
            "INSERT INTO vendor_payments (id, tenant_id, payment_number, vendor_partner_id, vendor_name_snapshot, payment_date, payment_method, currency, status, created_by, created_at)
             VALUES ('pay_part', 'tnt_test', 'PAY-PART', 'vnd_001', '測試供應商股份公司', '2026-02-15', 'bank_transfer', 'TWD', 'posted', 'usr_admin', 1000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO vendor_payment_allocations (id, tenant_id, payment_id, account_payable_id, amount, created_at)
             VALUES ('paya_part', 'tnt_test', 'pay_part', ?1, 4999.99, 1000)",
            params![ap5.id],
        )
        .unwrap();

        // When: Generating aging report as of 2026-03-02
        let report = get_payables_aging_impl(&conn, "tnt_test", as_of).unwrap();

        // Then (TC-AGING-N01 & N02): Check vnd_001 buckets
        assert_eq!(report.vendors.len(), 1);
        let v = &report.vendors[0];
        assert_eq!(v.vendor_partner_id, "vnd_001");
        assert_eq!(v.current, 1000.0);
        assert_eq!(v.overdue_1_30, 2000.0);
        assert_eq!(v.overdue_31_60, 3000.0);
        assert_eq!(v.overdue_61_90, 4000.0);
        assert_eq!(v.overdue_90_plus, 0.01); // 5000.0 - 4999.99 = 0.01

        let expected_total = 1000.0 + 2000.0 + 3000.0 + 4000.0 + 0.01;
        assert_eq!(v.total_outstanding, round_2(expected_total));

        // Then (TC-AGING-N03): Totals match vendor sum
        assert_eq!(report.totals.current, v.current);
        assert_eq!(report.totals.overdue_1_30, v.overdue_1_30);
        assert_eq!(report.totals.overdue_31_60, v.overdue_31_60);
        assert_eq!(report.totals.overdue_61_90, v.overdue_61_90);
        assert_eq!(report.totals.overdue_90_plus, v.overdue_90_plus);
        assert_eq!(report.totals.total_outstanding, v.total_outstanding);

        // Then (TC-AGING-N08): Items detail list contains all 5 open APs
        assert_eq!(v.items.len(), 5);
        let item1 = v
            .items
            .iter()
            .find(|i| i.source_number == "BILL-001")
            .unwrap();
        assert_eq!(item1.overdue_days, 0);
        assert_eq!(item1.bucket, "current");
        assert_eq!(item1.external_reference, Some("INV-001".to_string()));

        let item5 = v
            .items
            .iter()
            .find(|i| i.source_number == "OAP-003")
            .unwrap();
        assert_eq!(item5.overdue_days, 91);
        assert_eq!(item5.bucket, "90+");
        assert_eq!(item5.amount, 5000.0);
        assert_eq!(item5.paid_amount, 4999.99);
        assert_eq!(item5.outstanding_amount, 0.01);
        assert_eq!(item5.settlement_status, "partially_paid");
    }

    #[test]
    fn test_tc_ap_aging_e01_to_e06_n04_to_n07_exclusions_unbilled_and_isolation() {
        // Given: Database with multiple tenants, voided APs, fully paid APs, and unbilled purchase orders
        let mut conn = setup_test_db();
        crate::purchase_orders::create_purchase_orders_tables(&conn).unwrap();
        crate::vendor_bills::create_vendor_bills_tables(&conn).unwrap();

        // 1. Fully paid AP (outstanding = 0) -> should be excluded (TC-AGING-E04)
        let ap_paid = create_account_payable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateAccountPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                source_type: "vendor_bill".to_string(),
                source_id: "bill_paid".to_string(),
                source_number: "BILL-PAID".to_string(),
                external_reference: None,
                document_date: "2026-01-01".to_string(),
                due_date: "2026-01-31".to_string(),
                amount: 800.0,
                currency: None,
            },
        )
        .unwrap();
        conn.execute(
            "INSERT INTO vendor_payments (id, tenant_id, payment_number, vendor_partner_id, vendor_name_snapshot, payment_date, payment_method, currency, status, created_by, created_at)
             VALUES ('pay_full', 'tnt_test', 'PAY-FULL', 'vnd_001', '測試供應商股份公司', '2026-02-01', 'bank_transfer', 'TWD', 'posted', 'usr_admin', 1000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO vendor_payment_allocations (id, tenant_id, payment_id, account_payable_id, amount, created_at)
             VALUES ('paya_full', 'tnt_test', 'pay_full', ?1, 800.0, 1000)",
            params![ap_paid.id],
        )
        .unwrap();

        // 2. Voided AP -> should be excluded (TC-AGING-E03)
        let ap_void = create_account_payable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateAccountPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                source_type: "vendor_bill".to_string(),
                source_id: "bill_void".to_string(),
                source_number: "BILL-VOID".to_string(),
                external_reference: None,
                document_date: "2026-01-01".to_string(),
                due_date: "2026-01-31".to_string(),
                amount: 500.0,
                currency: None,
            },
        )
        .unwrap();
        void_account_payable(&mut conn, "tnt_test", "usr_admin", &ap_void.id, "作廢測試").unwrap();

        // 3. AP in another tenant (tnt_other) -> should be excluded by tenant isolation (TC-AGING-E06)
        create_account_payable(
            &mut conn,
            "tnt_other",
            "usr_other",
            CreateAccountPayableInput {
                vendor_partner_id: "vnd_other".to_string(),
                source_type: "vendor_bill".to_string(),
                source_id: "bill_other".to_string(),
                source_number: "BILL-OTHER".to_string(),
                external_reference: None,
                document_date: "2026-01-01".to_string(),
                due_date: "2026-01-31".to_string(),
                amount: 9999.0,
                currency: None,
            },
        )
        .unwrap();

        // 4. Seed an unbilled received purchase order for vnd_001 (TC-AGING-N04, N06)
        conn.execute(
            "INSERT INTO purchase_orders (id, tenant_id, po_number, vendor_partner_id, vendor_name_snapshot, status, ordered_at, received_at, created_by, created_at)
             VALUES ('po_rec_1', 'tnt_test', 'PO-001', 'vnd_001', '測試供應商股份公司', 'received', 1000, 2000, 'usr_admin', 1000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO purchase_order_lines (id, purchase_order_id, line_no, unit_id, product_name_snapshot, variant_name_snapshot, unit_name_snapshot, quantity, received_quantity, purchase_cost, created_at)
             VALUES ('pol_1', 'po_rec_1', 1, 'unit_1', '商品1', '預設', '個', 10.0, 10.0, 150.0, 1000)",
            [],
        )
        .unwrap(); // received_total_amount = 10 * 150 = 1500.0

        // When: Querying aging for tnt_test
        let report =
            get_payables_aging_impl(&conn, "tnt_test", Some("2026-03-02".to_string())).unwrap();

        // Then (TC-AGING-N04 & N06):
        // vnd_001 has 0 open AP (paid & voided were excluded), but unbilled_received_amount = 1500.0!
        // Therefore, it appears in the list!
        assert_eq!(report.vendors.len(), 1);
        let v = &report.vendors[0];
        assert_eq!(v.vendor_partner_id, "vnd_001");
        assert_eq!(v.total_outstanding, 0.0);
        assert_eq!(v.unbilled_received_amount, 1500.0);
        assert_eq!(report.totals.total_outstanding, 0.0);
        assert_eq!(report.totals.unbilled_received_amount, 1500.0);

        // When & Then (TC-AGING-E01 & E02): Empty and whitespace tenant_id return EmptyTenantId
        assert_eq!(
            get_payables_aging_impl(&conn, "", None).unwrap_err(),
            AccountsPayableError::EmptyTenantId
        );
        assert_eq!(
            get_payables_aging_impl(&conn, "   ", None).unwrap_err(),
            AccountsPayableError::EmptyTenantId
        );
    }

    #[test]
    fn test_vendor_statement_perspective_cases() {
        let mut conn = setup_test_db();

        // ----------------------------------------------------
        // TC-STMT-E01 ~ E06: Error and Validation Perspectives
        // ----------------------------------------------------
        // Given: Empty or invalid parameters
        // When & Then (TC-STMT-E01): Empty or whitespace tenant
        assert_eq!(
            get_vendor_statement_impl(&conn, "", "vnd_001", "2026-03-01", "2026-03-31")
                .unwrap_err(),
            AccountsPayableError::EmptyTenantId
        );
        assert_eq!(
            get_vendor_statement_impl(&conn, "   ", "vnd_001", "2026-03-01", "2026-03-31")
                .unwrap_err(),
            AccountsPayableError::EmptyTenantId
        );

        // When & Then (TC-STMT-E02): Empty or whitespace vendor_partner_id
        assert_eq!(
            get_vendor_statement_impl(&conn, "tnt_test", "", "2026-03-01", "2026-03-31")
                .unwrap_err(),
            AccountsPayableError::VendorNotFound
        );
        assert_eq!(
            get_vendor_statement_impl(&conn, "tnt_test", "   ", "2026-03-01", "2026-03-31")
                .unwrap_err(),
            AccountsPayableError::VendorNotFound
        );

        // When & Then (TC-STMT-E03): Non-existent vendor partner
        assert_eq!(
            get_vendor_statement_impl(&conn, "tnt_test", "vnd_ghost", "2026-03-01", "2026-03-31")
                .unwrap_err(),
            AccountsPayableError::VendorNotFound
        );

        // When & Then (TC-STMT-E04): Partner exists but is_vendor != 1
        assert_eq!(
            get_vendor_statement_impl(&conn, "tnt_test", "cus_001", "2026-03-01", "2026-03-31")
                .unwrap_err(),
            AccountsPayableError::PartnerNotVendor
        );

        // When & Then (TC-STMT-E05): start_date > end_date
        assert_eq!(
            get_vendor_statement_impl(&conn, "tnt_test", "vnd_001", "2026-03-31", "2026-03-01")
                .unwrap_err(),
            AccountsPayableError::InvalidDateRange
        );

        // When & Then (TC-STMT-E06): Invalid date formats
        assert_eq!(
            get_vendor_statement_impl(&conn, "tnt_test", "vnd_001", "2026/03/01", "2026-03-31")
                .unwrap_err(),
            AccountsPayableError::InvalidDateFormat
        );
        assert_eq!(
            get_vendor_statement_impl(&conn, "tnt_test", "vnd_001", "2026-03-01", "invalid")
                .unwrap_err(),
            AccountsPayableError::InvalidDateFormat
        );

        // ----------------------------------------------------
        // TC-STMT-N03: Brand new vendor with 0 transactions
        // ----------------------------------------------------
        // Given: Seed brand new vendor with no AP or payments
        conn.execute(
            "INSERT INTO partners (id, tenant_id, name, is_vendor, is_customer, created_at)
             VALUES ('vnd_new', 'tnt_test', '全新供應商', 1, 0, 1000)",
            [],
        )
        .unwrap();
        // When: Querying statement
        let empty_stmt =
            get_vendor_statement_impl(&conn, "tnt_test", "vnd_new", "2026-03-01", "2026-03-31")
                .unwrap();
        // Then: All numbers are zero
        assert_eq!(empty_stmt.opening_balance, 0.0);
        assert_eq!(empty_stmt.current_payables_total, 0.0);
        assert_eq!(empty_stmt.current_payments_total, 0.0);
        assert_eq!(empty_stmt.closing_balance, 0.0);
        assert_eq!(empty_stmt.payables.len(), 0);
        assert_eq!(empty_stmt.payments.len(), 0);

        // ----------------------------------------------------
        // TC-STMT-N01, B01, B02, B03, B04, B05, B06, B07, B08, B09
        // ----------------------------------------------------
        // Given:
        // Period is [2026-03-01, 2026-03-31]
        // B02: AP prior to start_date (2026-02-28, doc_date < start_date) -> Opening AP = 1000.0
        create_account_payable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateAccountPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                source_type: "opening_balance".to_string(),
                source_id: "oap_prior".to_string(),
                source_number: "OAP-PRIOR".to_string(),
                external_reference: Some("REF-PRIOR".to_string()),
                document_date: "2026-02-28".to_string(),
                due_date: "2026-03-15".to_string(),
                amount: 1000.0,
                currency: None,
            },
        )
        .unwrap();

        // B06: Payment prior to start_date (2026-02-28, payment_date < start_date) paying 200.0 of oap_prior -> Opening Paid = 200.0
        // Net opening_balance = 1000.0 - 200.0 = 800.0
        conn.execute(
            "INSERT INTO vendor_payments (id, tenant_id, payment_number, vendor_partner_id, vendor_name_snapshot, payment_date, payment_method, payment_reference, note, currency, status, created_by, created_at, posted_by, posted_at)
             VALUES ('pay_prior', 'tnt_test', 'PAY-PRIOR', 'vnd_001', '測試供應商股份公司', '2026-02-28', 'bank_transfer', 'REF-PAY-0', '期初核銷', 'TWD', 'posted', 'usr_admin', 1000, 'usr_admin', 1000)",
            [],
        ).unwrap();
        let ap_prior = conn
            .query_row(
                "SELECT id FROM accounts_payable WHERE source_id = 'oap_prior'",
                [],
                |r| r.get::<_, String>(0),
            )
            .unwrap();
        conn.execute(
            "INSERT INTO vendor_payment_allocations (id, tenant_id, payment_id, account_payable_id, amount, created_at)
             VALUES ('pa_prior', 'tnt_test', 'pay_prior', ?1, 200.0, 1000)",
            params![ap_prior],
        ).unwrap();

        // B01: AP on start_date (2026-03-01) -> Current AP = 300.0
        create_account_payable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateAccountPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                source_type: "vendor_bill".to_string(),
                source_id: "bill_sdate".to_string(),
                source_number: "BILL-SDATE".to_string(),
                external_reference: Some("EXT-SDATE".to_string()),
                document_date: "2026-03-01".to_string(),
                due_date: "2026-03-31".to_string(),
                amount: 300.0,
                currency: None,
            },
        )
        .unwrap();

        // B03 & B09: AP on end_date (2026-03-31) with 0.01 precision -> Current AP = 500.55
        create_account_payable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateAccountPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                source_type: "vendor_bill".to_string(),
                source_id: "bill_edate".to_string(),
                source_number: "BILL-EDATE".to_string(),
                external_reference: None,
                document_date: "2026-03-31".to_string(),
                due_date: "2026-04-30".to_string(),
                amount: 500.55,
                currency: None,
            },
        )
        .unwrap();

        // B04: AP after end_date (2026-04-01) -> Excluded from this period
        create_account_payable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateAccountPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                source_type: "vendor_bill".to_string(),
                source_id: "bill_future".to_string(),
                source_number: "BILL-FUTURE".to_string(),
                external_reference: None,
                document_date: "2026-04-01".to_string(),
                due_date: "2026-04-30".to_string(),
                amount: 999.0,
                currency: None,
            },
        )
        .unwrap();

        // B05 & TC-STMT-N06: Payment on start_date (2026-03-01) with multi-allocations (150 to ap_prior, 100 to bill_sdate) -> Total 250.0
        conn.execute(
            "INSERT INTO vendor_payments (id, tenant_id, payment_number, vendor_partner_id, vendor_name_snapshot, payment_date, payment_method, payment_reference, note, currency, status, created_by, created_at, posted_by, posted_at)
             VALUES ('pay_sdate', 'tnt_test', 'PAY-SDATE', 'vnd_001', '測試供應商股份公司', '2026-03-01', 'cash', 'REF-CASH', '起日付款', 'TWD', 'posted', 'usr_admin', 2000, 'usr_admin', 2000)",
            [],
        ).unwrap();
        let ap_sdate = conn
            .query_row(
                "SELECT id FROM accounts_payable WHERE source_id = 'bill_sdate'",
                [],
                |r| r.get::<_, String>(0),
            )
            .unwrap();
        conn.execute(
            "INSERT INTO vendor_payment_allocations (id, tenant_id, payment_id, account_payable_id, amount, created_at)
             VALUES ('pa_sd_1', 'tnt_test', 'pay_sdate', ?1, 150.0, 2001)",
            params![ap_prior],
        ).unwrap();
        conn.execute(
            "INSERT INTO vendor_payment_allocations (id, tenant_id, payment_id, account_payable_id, amount, created_at)
             VALUES ('pa_sd_2', 'tnt_test', 'pay_sdate', ?1, 100.0, 2002)",
            params![ap_sdate],
        ).unwrap();

        // B07: Payment on end_date (2026-03-31) -> 50.55
        conn.execute(
            "INSERT INTO vendor_payments (id, tenant_id, payment_number, vendor_partner_id, vendor_name_snapshot, payment_date, payment_method, payment_reference, note, currency, status, created_by, created_at, posted_by, posted_at)
             VALUES ('pay_edate', 'tnt_test', 'PAY-EDATE', 'vnd_001', '測試供應商股份公司', '2026-03-31', 'check', 'CHK-001', '迄日付款', 'TWD', 'posted', 'usr_admin', 3000, 'usr_admin', 3000)",
            [],
        ).unwrap();
        let ap_edate = conn
            .query_row(
                "SELECT id FROM accounts_payable WHERE source_id = 'bill_edate'",
                [],
                |r| r.get::<_, String>(0),
            )
            .unwrap();
        conn.execute(
            "INSERT INTO vendor_payment_allocations (id, tenant_id, payment_id, account_payable_id, amount, created_at)
             VALUES ('pa_ed_1', 'tnt_test', 'pay_edate', ?1, 50.55, 3001)",
            params![ap_edate],
        ).unwrap();

        // TC-STMT-E07: Voided AP in period -> must be completely excluded
        let void_ap = create_account_payable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateAccountPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                source_type: "vendor_bill".to_string(),
                source_id: "bill_void".to_string(),
                source_number: "BILL-VOID".to_string(),
                external_reference: None,
                document_date: "2026-03-15".to_string(),
                due_date: "2026-04-15".to_string(),
                amount: 777.0,
                currency: None,
            },
        )
        .unwrap();
        void_account_payable(
            &mut conn,
            "tnt_test",
            "usr_admin",
            &void_ap.id,
            "作廢排除測試",
        )
        .unwrap();

        // TC-STMT-E08: Voided payment in period -> excluded
        conn.execute(
            "INSERT INTO vendor_payments (id, tenant_id, payment_number, vendor_partner_id, vendor_name_snapshot, payment_date, payment_method, status, created_by, created_at, posted_by, posted_at, voided_by, voided_at, void_reason)
             VALUES ('pay_voided', 'tnt_test', 'PAY-VOID', 'vnd_001', '測試供應商股份公司', '2026-03-15', 'bank_transfer', 'voided', 'usr_admin', 4000, 'usr_admin', 4000, 'usr_admin', 4001, '作廢付款')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO vendor_payment_allocations (id, tenant_id, payment_id, account_payable_id, amount, created_at)
             VALUES ('pa_void_1', 'tnt_test', 'pay_voided', ?1, 100.0, 4000)",
            params![ap_edate],
        ).unwrap();

        // TC-STMT-E09: Draft & Cancelled payments in period -> excluded
        conn.execute(
            "INSERT INTO vendor_payments (id, tenant_id, payment_number, vendor_partner_id, vendor_name_snapshot, payment_date, payment_method, status, created_by, created_at)
             VALUES ('pay_draft', 'tnt_test', 'PAY-DRAFT', 'vnd_001', '測試供應商股份公司', '2026-03-20', 'bank_transfer', 'draft', 'usr_admin', 5000)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO vendor_payments (id, tenant_id, payment_number, vendor_partner_id, vendor_name_snapshot, payment_date, payment_method, status, created_by, created_at, cancelled_by, cancelled_at)
             VALUES ('pay_canc', 'tnt_test', 'PAY-CANC', 'vnd_001', '測試供應商股份公司', '2026-03-22', 'bank_transfer', 'cancelled', 'usr_admin', 5000, 'usr_admin', 5001)",
            [],
        ).unwrap();

        // TC-STMT-E10: Other tenant records in period -> isolated
        create_account_payable(
            &mut conn,
            "tnt_other",
            "usr_other",
            CreateAccountPayableInput {
                vendor_partner_id: "vnd_other".to_string(),
                source_type: "vendor_bill".to_string(),
                source_id: "bill_tnt2".to_string(),
                source_number: "BILL-TNT2".to_string(),
                external_reference: None,
                document_date: "2026-03-10".to_string(),
                due_date: "2026-04-10".to_string(),
                amount: 8888.0,
                currency: None,
            },
        )
        .unwrap();

        // When: Query statement for [2026-03-01, 2026-03-31]
        let stmt =
            get_vendor_statement_impl(&conn, "tnt_test", "vnd_001", "2026-03-01", "2026-03-31")
                .unwrap();

        // Then:
        // Opening balance: 1000 - 200 = 800.00
        assert_eq!(stmt.opening_balance, 800.0);
        // Current payables: 300.0 (bill_sdate) + 500.55 (bill_edate) = 800.55 (bill_void & bill_future excluded)
        assert_eq!(stmt.current_payables_total, 800.55);
        assert_eq!(stmt.payables.len(), 2);
        assert_eq!(stmt.payables[0].source_number, "BILL-SDATE");
        assert_eq!(stmt.payables[1].source_number, "BILL-EDATE");
        // Current payments: 250.0 (pay_sdate) + 50.55 (pay_edate) = 300.55 (pay_voided, draft, canc excluded)
        assert_eq!(stmt.current_payments_total, 300.55);
        assert_eq!(stmt.payments.len(), 2);
        assert_eq!(stmt.payments[0].allocations.len(), 2); // multi-allocation checked
        assert_eq!(stmt.payments[0].amount, 250.0);
        assert_eq!(stmt.payments[1].amount, 50.55);
        // Closing balance: 800.00 + 800.55 - 300.55 = 1300.00
        assert_eq!(stmt.closing_balance, 1300.0);
        // Identity: Opening + Current AP - Current Pay = Closing
        assert_eq!(
            round_2(
                stmt.opening_balance + stmt.current_payables_total - stmt.current_payments_total
            ),
            stmt.closing_balance
        );

        // ----------------------------------------------------
        // TC-STMT-N04: Adjacent period transition
        // Period 1: [2026-02-01, 2026-02-28]
        // Period 2: [2026-03-01, 2026-03-31]
        // ----------------------------------------------------
        // When: Query Period 1 statement
        let p1_stmt =
            get_vendor_statement_impl(&conn, "tnt_test", "vnd_001", "2026-02-01", "2026-02-28")
                .unwrap();
        // Then: Period 1 closing balance must equal Period 2 opening balance (800.0)
        assert_eq!(p1_stmt.closing_balance, stmt.opening_balance);

        // ----------------------------------------------------
        // TC-STMT-N02: Period with no changes
        // Period: [2026-05-01, 2026-05-31]
        // ----------------------------------------------------
        let quiet_stmt =
            get_vendor_statement_impl(&conn, "tnt_test", "vnd_001", "2026-05-01", "2026-05-31")
                .unwrap();
        assert_eq!(quiet_stmt.current_payables_total, 0.0);
        assert_eq!(quiet_stmt.current_payments_total, 0.0);
        assert_eq!(quiet_stmt.opening_balance, quiet_stmt.closing_balance);

        // ----------------------------------------------------
        // TC-STMT-B08: Single-day range (start_date == end_date)
        // ----------------------------------------------------
        let single_stmt =
            get_vendor_statement_impl(&conn, "tnt_test", "vnd_001", "2026-03-01", "2026-03-01")
                .unwrap();
        assert_eq!(single_stmt.payables.len(), 1);
        assert_eq!(single_stmt.payables[0].source_number, "BILL-SDATE");
        assert_eq!(single_stmt.payments.len(), 1);
        assert_eq!(single_stmt.payments[0].payment_number, "PAY-SDATE");
        assert_eq!(
            round_2(
                single_stmt.opening_balance + single_stmt.current_payables_total
                    - single_stmt.current_payments_total
            ),
            single_stmt.closing_balance
        );
    }

    #[test]
    fn test_tc_pay_conv_old_tables_removed_and_convergence() {
        // Given: A fresh in-memory database initialized only with create_accounts_payable_tables
        let conn = Connection::open_in_memory().unwrap();
        create_accounts_payable_tables(&conn).unwrap();

        // When: Querying sqlite_master for legacy tables "payments" and "payment_allocations"
        let legacy_tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('payments', 'payment_allocations')")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();

        // Then (TC-PAY-CONV-N02): Neither "payments" nor "payment_allocations" exist
        assert_eq!(legacy_tables.len(), 0);

        // Given: Database with vendor_payments tables also initialized
        crate::partners::create_partners_table(&conn).unwrap();
        crate::vendor_payments::create_vendor_payment_tables(&conn).unwrap();

        conn.execute(
            "INSERT INTO partners (id, tenant_id, name, is_vendor, is_customer, created_at)
             VALUES ('vnd_conv', 'tnt_test', '收斂測試供應商', 1, 0, 1000)",
            [],
        )
        .unwrap();

        let mut mut_conn = conn;
        let ap = create_account_payable(
            &mut mut_conn,
            "tnt_test",
            "usr_admin",
            CreateAccountPayableInput {
                vendor_partner_id: "vnd_conv".to_string(),
                source_type: "vendor_bill".to_string(),
                source_id: "bill_conv_1".to_string(),
                source_number: "BILL-CONV-1".to_string(),
                external_reference: None,
                document_date: "2026-11-01".to_string(),
                due_date: "2026-11-30".to_string(),
                amount: 1000.0,
                currency: None,
            },
        )
        .unwrap();

        // When (TC-PAY-CONV-N01): Query AP balance before any payment
        let ap_info_init =
            crate::vendor_payments::get_ap_info(&mut_conn, "tnt_test", &ap.id).unwrap();
        let detail_init = get_account_payable_impl(&mut_conn, "tnt_test", &ap.id).unwrap();

        // Then: Outstanding equals total amount (1000.0)
        assert_eq!(ap_info_init.1, 1000.0);
        assert_eq!(detail_init.outstanding_amount, 1000.0);
        assert_eq!(detail_init.paid_amount, 0.0);
        assert_eq!(detail_init.settlement_status, SettlementStatus::Unpaid);

        // When (TC-PAY-CONV-B02 & B04): Post full payment with allocations in vendor_payments
        mut_conn.execute(
            "INSERT INTO vendor_payments (id, tenant_id, payment_number, vendor_partner_id, vendor_name_snapshot, payment_date, payment_method, currency, status, created_by, created_at)
             VALUES ('pay_conv_1', 'tnt_test', 'PAY-CONV-001', 'vnd_conv', '收斂測試供應商', '2026-11-05', 'bank_transfer', 'TWD', 'posted', 'usr_admin', 2000),
                    ('pay_conv_2', 'tnt_test', 'PAY-CONV-002', 'vnd_conv', '收斂測試供應商', '2026-11-05', 'bank_transfer', 'TWD', 'posted', 'usr_admin', 2000)",
            [],
        ).unwrap();
        mut_conn.execute(
            "INSERT INTO vendor_payment_allocations (id, tenant_id, payment_id, account_payable_id, amount, created_at)
             VALUES ('pa_conv_1', 'tnt_test', 'pay_conv_1', ?1, 999.99, 2000),
                    ('pa_conv_2', 'tnt_test', 'pay_conv_2', ?1, 0.01, 2001)",
            params![ap.id],
        ).unwrap();

        let ap_info_paid =
            crate::vendor_payments::get_ap_info(&mut_conn, "tnt_test", &ap.id).unwrap();
        let detail_paid = get_account_payable_impl(&mut_conn, "tnt_test", &ap.id).unwrap();

        // Then: Outstanding equals 0.0, settlement_status is Paid
        assert_eq!(ap_info_paid.1, 0.0);
        assert_eq!(detail_paid.outstanding_amount, 0.0);
        assert_eq!(detail_paid.paid_amount, 1000.0);
        assert_eq!(detail_paid.settlement_status, SettlementStatus::Paid);

        // When (TC-PAY-CONV-N04): Attempt to void AP with posted payment allocation
        let void_err =
            void_account_payable(&mut mut_conn, "tnt_test", "usr_admin", &ap.id, "嘗試作廢");

        // Then: Blocked by AP-04
        assert_eq!(
            void_err.unwrap_err(),
            AccountsPayableError::HasPostedPaymentAllocations("PAY-CONV-001".to_string())
        );

        // When (TC-PAY-CONV-B01): Voiding AP without payments returns outstanding 0.0 in get_ap_info
        let ap_to_void = create_account_payable(
            &mut mut_conn,
            "tnt_test",
            "usr_admin",
            CreateAccountPayableInput {
                vendor_partner_id: "vnd_conv".to_string(),
                source_type: "vendor_bill".to_string(),
                source_id: "bill_conv_void".to_string(),
                source_number: "BILL-CONV-VOID".to_string(),
                external_reference: None,
                document_date: "2026-11-01".to_string(),
                due_date: "2026-11-30".to_string(),
                amount: 500.0,
                currency: None,
            },
        )
        .unwrap();
        void_account_payable(
            &mut mut_conn,
            "tnt_test",
            "usr_admin",
            &ap_to_void.id,
            "測試正常作廢",
        )
        .unwrap();
        let ap_info_voided =
            crate::vendor_payments::get_ap_info(&mut_conn, "tnt_test", &ap_to_void.id).unwrap();
        assert_eq!(ap_info_voided.1, 0.0);

        // When & Then (TC-PAY-CONV-E01): Non-existent AP ID
        let err_not_found =
            crate::vendor_payments::get_ap_info(&mut_conn, "tnt_test", "non_existent_ap");
        assert_eq!(
            err_not_found.unwrap_err(),
            crate::vendor_payments::VendorPaymentError::InvalidAllocationAccountPayable
        );
    }
}
