use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

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
/// Outstanding amount = amount - received_amount - allowance_amount
/// For voided accounts, outstanding is 0.0 and settlement status is Unpaid.
pub fn calculate_derived_amounts(
    status: &str,
    total_amount: f64,
    raw_received_amount: f64,
    raw_allowance_amount: f64,
) -> (f64, f64, f64, SettlementStatus) {
    let rounded_total = round_2(total_amount);
    let rounded_received = round_2(raw_received_amount);
    let rounded_allowance = round_2(raw_allowance_amount);

    if status == "voided" {
        return (0.0, 0.0, 0.0, SettlementStatus::Unpaid);
    }

    let settled = round_2(rounded_received + rounded_allowance);
    let outstanding = round_2(rounded_total - settled);

    if outstanding <= 0.0 {
        (
            rounded_received,
            rounded_allowance,
            0.0,
            SettlementStatus::Paid,
        )
    } else if settled <= 0.0 {
        (0.0, 0.0, rounded_total, SettlementStatus::Unpaid)
    } else {
        (
            rounded_received,
            rounded_allowance,
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
            "SELECT SUM(amount_untaxed + tax_amount)
             FROM sales_allowances
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
            (SELECT SUM(sa.amount_untaxed + sa.tax_amount)
             FROM sales_allowances sa
             WHERE sa.account_receivable_id = ar.id
               AND sa.tenant_id = ar.tenant_id
               AND sa.status = 'posted'),
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
            {} AS raw_allowance_amount
        FROM accounts_receivable ar
        WHERE ar.tenant_id = ?1",
        received_subquery, allowance_subquery
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
        Ok((ar, raw_received, raw_allowance))
    })?;

    let mut items = Vec::new();
    for r in rows {
        let (ar, raw_received, raw_allowance) = r?;
        let (received_amount, allowance_amount, outstanding_amount, settlement_status) =
            calculate_derived_amounts(&ar.status, ar.amount, raw_received, raw_allowance);

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
                amount_untaxed REAL NOT NULL,
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
            "INSERT INTO sales_allowances (id, tenant_id, allowance_number, account_receivable_id, amount_untaxed, tax_amount, status, created_at)
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

        // Case N1: Unpaid, no allowance
        let (rec1, alw1, out1, st1) = calculate_derived_amounts("open", 1000.0, 0.0, 0.0);
        assert_eq!(rec1, 0.0);
        assert_eq!(alw1, 0.0);
        assert_eq!(out1, 1000.0);
        assert_eq!(st1, SettlementStatus::Unpaid);

        // Case N2: Partially paid, no allowance
        let (rec2, alw2, out2, st2) = calculate_derived_amounts("open", 1000.0, 300.0, 0.0);
        assert_eq!(rec2, 300.0);
        assert_eq!(alw2, 0.0);
        assert_eq!(out2, 700.0);
        assert_eq!(st2, SettlementStatus::PartiallyPaid);

        // Case N3: Fully paid, no allowance
        let (rec3, alw3, out3, st3) = calculate_derived_amounts("open", 1000.0, 1000.0, 0.0);
        assert_eq!(rec3, 1000.0);
        assert_eq!(alw3, 0.0);
        assert_eq!(out3, 0.0);
        assert_eq!(st3, SettlementStatus::Paid);

        // Case N4: Partially paid with allowance
        let (rec4, alw4, out4, st4) = calculate_derived_amounts("open", 1000.0, 400.0, 100.0);
        assert_eq!(rec4, 400.0);
        assert_eq!(alw4, 100.0);
        assert_eq!(out4, 500.0);
        assert_eq!(st4, SettlementStatus::PartiallyPaid);

        // Case N5: Fully settled via payment + allowance
        let (rec5, alw5, out5, st5) = calculate_derived_amounts("open", 1000.0, 800.0, 200.0);
        assert_eq!(rec5, 800.0);
        assert_eq!(alw5, 200.0);
        assert_eq!(out5, 0.0);
        assert_eq!(st5, SettlementStatus::Paid);

        // Case B1: Voided account receivable
        let (rec6, alw6, out6, st6) = calculate_derived_amounts("voided", 1000.0, 0.0, 0.0);
        assert_eq!(rec6, 0.0);
        assert_eq!(alw6, 0.0);
        assert_eq!(out6, 0.0);
        assert_eq!(st6, SettlementStatus::Unpaid);
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
}
