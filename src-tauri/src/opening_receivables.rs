use rusqlite::{params, Connection, Transaction};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static OAR_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

fn current_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

// ==========================================
// Date Helpers
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

pub fn parse_date(date_str: &str) -> Result<(i32, u32, u32), OpeningReceivableError> {
    let trimmed = date_str.trim();
    let parts: Vec<&str> = trimmed.split('-').collect();
    if parts.len() != 3 || parts[0].len() != 4 || parts[1].len() != 2 || parts[2].len() != 2 {
        return Err(OpeningReceivableError::InvalidDateFormat(
            "日期格式需為 YYYY-MM-DD".to_string(),
        ));
    }
    let year: i32 = parts[0]
        .parse()
        .map_err(|_| OpeningReceivableError::InvalidDateFormat("無效的年份".to_string()))?;
    let month: u32 = parts[1]
        .parse()
        .map_err(|_| OpeningReceivableError::InvalidDateFormat("無效的月份".to_string()))?;
    let day: u32 = parts[2]
        .parse()
        .map_err(|_| OpeningReceivableError::InvalidDateFormat("無效的日期".to_string()))?;

    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return Err(OpeningReceivableError::InvalidDateFormat(
            "無效的日期數值".to_string(),
        ));
    }
    let dim = get_days_in_month(year, month);
    if day > dim {
        return Err(OpeningReceivableError::InvalidDateFormat(
            "日期超出該月份天數".to_string(),
        ));
    }
    Ok((year, month, day))
}

pub fn get_today_local(conn: &Connection) -> Result<String, rusqlite::Error> {
    conn.query_row("SELECT date('now', 'localtime')", [], |r| r.get(0))
}

// ==========================================
// Errors
// ==========================================

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum OpeningReceivableError {
    #[error("租戶 ID 不可為空")]
    EmptyTenantId,

    #[error("使用者 ID 不可為空")]
    EmptyUserId,

    #[error("找不到指定的租戶")]
    TenantNotFound,

    #[error("租戶未啟用或已停用")]
    TenantNotActive,

    #[error("找不到指定的期初應收帳款")]
    NotFound,

    #[error("找不到指定的客戶")]
    CustomerNotFound,

    #[error("指定夥伴不是客戶")]
    PartnerNotCustomer,

    #[error("指定客戶已停用")]
    CustomerInactive,

    #[error("原單號或發票號不可為空")]
    EmptyOriginalReference,

    #[error("未付金額必須大於 0")]
    AmountMustBePositive,

    #[error("單據日不可晚於今天")]
    DocumentDateCannotBeInFuture,

    #[error("到期日不可早於單據日")]
    DueDateEarlierThanDocumentDate,

    #[error(
        "期初應收的單據日須早於此客戶在系統中的第一張銷售單（{0}，{1}）；導入後的帳款請走客戶帳單"
    )]
    DocumentDateNotEarlierThanFirstSalesOrder(String, String),

    #[error("此客戶的期初單號 {0} 已登錄於 {1}")]
    DuplicateOriginalReference(String, String),

    #[error("原因必填")]
    VoidReasonRequired,

    #[error("此期初應收已有收款核銷：{0}，請先作廢收款單")]
    HasPostedReceiptAllocations(String),

    #[error("此期初應收已有折讓單：{0}，請先作廢折讓單")]
    HasPostedAllowances(String),

    #[error("無效的狀態轉換：從 {from} 到 {to}")]
    InvalidStateTransition { from: String, to: String },

    #[error("日期格式錯誤: {0}")]
    InvalidDateFormat(String),

    #[error("應收帳款模組錯誤: {0}")]
    AccountsReceivableError(String),

    #[error("資料庫錯誤: {0}")]
    DatabaseError(String),
}

impl From<rusqlite::Error> for OpeningReceivableError {
    fn from(err: rusqlite::Error) -> Self {
        OpeningReceivableError::DatabaseError(err.to_string())
    }
}

// ==========================================
// Data Structures
// ==========================================

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct OpeningReceivable {
    pub id: String,
    pub tenant_id: String,
    pub opening_number: String,
    pub customer_partner_id: String,
    pub customer_name_snapshot: String,
    pub original_reference: String,
    pub document_date: String,
    pub due_date: String,
    pub amount: f64,
    pub note: Option<String>,
    pub status: String,
    pub created_by: String,
    pub created_at: i64,
    pub voided_by: Option<String>,
    pub voided_at: Option<i64>,
    pub void_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct OpeningReceivableDetail {
    pub opening_receivable: OpeningReceivable,
    pub account_receivable_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct OpeningReceivableItem {
    pub id: String,
    pub opening_number: String,
    pub customer_partner_id: String,
    pub customer_name_snapshot: String,
    pub original_reference: String,
    pub document_date: String,
    pub due_date: String,
    pub amount: f64,
    pub status: String,
    pub note: Option<String>,
    pub created_at: i64,
    pub voided_at: Option<i64>,
    pub void_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct CreateOpeningReceivableInput {
    pub customer_partner_id: String,
    pub original_reference: String,
    pub document_date: String,
    pub due_date: String,
    pub amount: f64,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
pub struct ListOpeningReceivablesFilter {
    pub customer_partner_id: Option<String>,
    pub status: Option<String>,
}

// ==========================================
// Table Schema Initialization
// ==========================================

pub fn create_opening_receivables_tables(conn: &Connection) -> Result<(), rusqlite::Error> {
    let _ = conn.execute(
        "ALTER TABLE tenants ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE partners ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1",
        [],
    );

    conn.execute(
        "CREATE TABLE IF NOT EXISTS opening_receivables (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            opening_number TEXT NOT NULL,
            customer_partner_id TEXT NOT NULL,
            customer_name_snapshot TEXT NOT NULL,
            original_reference TEXT NOT NULL,
            document_date TEXT NOT NULL,
            due_date TEXT NOT NULL,
            amount REAL NOT NULL,
            note TEXT,
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
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_oar_tenant_number ON opening_receivables (tenant_id, opening_number)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_oar_tenant_customer ON opening_receivables (tenant_id, customer_partner_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_oar_tenant_status ON opening_receivables (tenant_id, status)",
        [],
    )?;

    Ok(())
}

// ==========================================
// Helper Functions
// ==========================================

fn validate_tenant_active(
    conn: &Connection,
    tenant_id: &str,
) -> Result<(), OpeningReceivableError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(OpeningReceivableError::EmptyTenantId);
    }
    let status_res: Result<String, rusqlite::Error> = conn.query_row(
        "SELECT status FROM tenants WHERE id = ?1",
        params![tid],
        |r| r.get(0),
    );
    match status_res {
        Ok(s) if s == "active" => Ok(()),
        Ok(_) => Err(OpeningReceivableError::TenantNotActive),
        Err(rusqlite::Error::QueryReturnedNoRows) => Err(OpeningReceivableError::TenantNotFound),
        Err(rusqlite::Error::SqliteFailure(_, Some(ref msg)))
            if msg.contains("no such column: status") =>
        {
            let _ = conn.execute(
                "ALTER TABLE tenants ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
                [],
            );
            let count: i64 = conn
                .query_row(
                    "SELECT count(*) FROM tenants WHERE id = ?1",
                    params![tid],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if count == 0 {
                Err(OpeningReceivableError::TenantNotFound)
            } else {
                Ok(())
            }
        }
        Err(e) => Err(OpeningReceivableError::DatabaseError(e.to_string())),
    }
}

fn next_opening_number(tx: &Transaction, tenant_id: &str) -> Result<String, rusqlite::Error> {
    let mut stmt = tx.prepare(
        "SELECT COALESCE(MAX(CAST(SUBSTR(opening_number, 5) AS INTEGER)), 0) + 1 
         FROM opening_receivables WHERE tenant_id = ?1",
    )?;
    let next_seq: i64 = stmt.query_row(params![tenant_id], |row| row.get(0))?;
    Ok(format!("OAR-{:05}", next_seq))
}

fn resolve_customer_snapshot(
    conn: &Connection,
    tenant_id: &str,
    customer_partner_id: &str,
) -> Result<String, OpeningReceivableError> {
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
            .map_err(|e| OpeningReceivableError::DatabaseError(e.to_string()))?
        }
        Err(e) => return Err(OpeningReceivableError::DatabaseError(e.to_string())),
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
                return Err(OpeningReceivableError::PartnerNotCustomer);
            }
            if is_active != 1 {
                return Err(OpeningReceivableError::CustomerInactive);
            }
            Ok(name)
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Err(OpeningReceivableError::CustomerNotFound),
        Err(e) => Err(OpeningReceivableError::DatabaseError(e.to_string())),
    }
}

/// Check duplicate original_reference for same customer among non-voided opening receivables
fn check_duplicate_original_reference(
    conn: &Connection,
    tenant_id: &str,
    customer_partner_id: &str,
    original_reference: &str,
) -> Result<(), OpeningReceivableError> {
    let trimmed = original_reference.trim();
    if trimmed.is_empty() {
        return Err(OpeningReceivableError::EmptyOriginalReference);
    }

    let mut stmt = conn
        .prepare(
            "SELECT opening_number FROM opening_receivables 
             WHERE tenant_id = ?1 AND customer_partner_id = ?2 
               AND LOWER(TRIM(original_reference)) = LOWER(?3) 
               AND status != 'voided' 
             LIMIT 1",
        )
        .map_err(|e| OpeningReceivableError::DatabaseError(e.to_string()))?;

    let existing: Result<String, _> = stmt
        .query_row(params![tenant_id, customer_partner_id, trimmed], |r| {
            r.get(0)
        });

    if let Ok(existing_number) = existing {
        return Err(OpeningReceivableError::DuplicateOriginalReference(
            trimmed.to_string(),
            existing_number,
        ));
    }

    Ok(())
}

/// OR-01: Validate document_date against customer's earliest sales order
fn validate_or01_first_sales_order(
    conn: &Connection,
    tenant_id: &str,
    customer_partner_id: &str,
    doc_date: &str,
) -> Result<(), OpeningReceivableError> {
    let prep_res = conn.prepare(
        "SELECT so_number, date(datetime(created_at, 'unixepoch', 'localtime')) AS so_date 
         FROM sales_orders 
         WHERE tenant_id = ?1 AND customer_partner_id = ?2 
         ORDER BY created_at ASC, so_number ASC 
         LIMIT 1",
    );

    let mut stmt = match prep_res {
        Ok(s) => s,
        Err(rusqlite::Error::SqliteFailure(_, Some(ref msg)))
            if msg.contains("no such table: sales_orders") =>
        {
            return Ok(());
        }
        Err(e) => return Err(OpeningReceivableError::DatabaseError(e.to_string())),
    };

    let earliest: Result<(String, String), _> = stmt
        .query_row(params![tenant_id, customer_partner_id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        });

    if let Ok((so_number, so_date)) = earliest {
        if doc_date >= so_date.as_str() {
            return Err(
                OpeningReceivableError::DocumentDateNotEarlierThanFirstSalesOrder(
                    so_number, so_date,
                ),
            );
        }
    }

    Ok(())
}

fn map_opening_receivable_row(row: &rusqlite::Row) -> Result<OpeningReceivable, rusqlite::Error> {
    Ok(OpeningReceivable {
        id: row.get(0)?,
        tenant_id: row.get(1)?,
        opening_number: row.get(2)?,
        customer_partner_id: row.get(3)?,
        customer_name_snapshot: row.get(4)?,
        original_reference: row.get(5)?,
        document_date: row.get(6)?,
        due_date: row.get(7)?,
        amount: row.get(8)?,
        note: row.get(9)?,
        status: row.get(10)?,
        created_by: row.get(11)?,
        created_at: row.get(12)?,
        voided_by: row.get(13)?,
        voided_at: row.get(14)?,
        void_reason: row.get(15)?,
    })
}

// ==========================================
// Core Business Operations
// ==========================================

pub fn create_opening_receivable_in_tx(
    tx: &Transaction,
    tenant_id: &str,
    user_id: &str,
    input: CreateOpeningReceivableInput,
) -> Result<OpeningReceivableDetail, OpeningReceivableError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(OpeningReceivableError::EmptyTenantId);
    }
    let uid = user_id.trim();
    if uid.is_empty() {
        return Err(OpeningReceivableError::EmptyUserId);
    }

    validate_tenant_active(tx, tid)?;

    let orig_ref = input.original_reference.trim().to_string();
    if orig_ref.is_empty() {
        return Err(OpeningReceivableError::EmptyOriginalReference);
    }

    let customer_id = input.customer_partner_id.trim().to_string();
    if customer_id.is_empty() {
        return Err(OpeningReceivableError::CustomerNotFound);
    }

    let customer_name = resolve_customer_snapshot(tx, tid, &customer_id)?;

    if input.amount <= 0.0 {
        return Err(OpeningReceivableError::AmountMustBePositive);
    }

    let doc_date = input.document_date.trim();
    let due_date = input.due_date.trim();

    let _ = parse_date(doc_date)?;
    let _ = parse_date(due_date)?;

    let today = get_today_local(tx)?;
    if doc_date > today.as_str() {
        return Err(OpeningReceivableError::DocumentDateCannotBeInFuture);
    }

    if due_date < doc_date {
        return Err(OpeningReceivableError::DueDateEarlierThanDocumentDate);
    }

    check_duplicate_original_reference(tx, tid, &customer_id, &orig_ref)?;
    validate_or01_first_sales_order(tx, tid, &customer_id, doc_date)?;

    let now = current_timestamp();
    let opening_number = next_opening_number(tx, tid)?;
    let oar_id = format!(
        "oar_{}_{}",
        now,
        OAR_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    );

    let note_val = input
        .note
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());

    tx.execute(
        "INSERT INTO opening_receivables (
            id, tenant_id, opening_number, customer_partner_id, customer_name_snapshot,
            original_reference, document_date, due_date, amount, note, status,
            created_by, created_at, voided_by, voided_at, void_reason
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'open', ?11, ?12, NULL, NULL, NULL)",
        params![
            oar_id,
            tid,
            opening_number,
            customer_id,
            customer_name,
            orig_ref,
            doc_date,
            due_date,
            input.amount,
            note_val,
            uid,
            now
        ],
    )?;

    // Link Accounts Receivable (#222)
    let ar_input = crate::accounts_receivable::CreateAccountReceivableInput {
        customer_partner_id: customer_id.clone(),
        source_type: "opening_balance".to_string(),
        source_id: oar_id.clone(),
        source_number: opening_number.clone(),
        external_reference: Some(orig_ref.clone()),
        document_date: doc_date.to_string(),
        due_date: due_date.to_string(),
        amount: input.amount,
        currency: Some("TWD".to_string()),
    };

    let ar = crate::accounts_receivable::create_account_receivable_in_tx(tx, tid, uid, ar_input)
        .map_err(|e| OpeningReceivableError::AccountsReceivableError(e.to_string()))?;

    let oar = OpeningReceivable {
        id: oar_id,
        tenant_id: tid.to_string(),
        opening_number,
        customer_partner_id: customer_id,
        customer_name_snapshot: customer_name,
        original_reference: orig_ref,
        document_date: doc_date.to_string(),
        due_date: due_date.to_string(),
        amount: input.amount,
        note: note_val.map(|s| s.to_string()),
        status: "open".to_string(),
        created_by: uid.to_string(),
        created_at: now,
        voided_by: None,
        voided_at: None,
        void_reason: None,
    };

    Ok(OpeningReceivableDetail {
        opening_receivable: oar,
        account_receivable_id: Some(ar.id),
    })
}

pub fn create_opening_receivable_impl(
    conn: &mut Connection,
    tenant_id: &str,
    user_id: &str,
    input: CreateOpeningReceivableInput,
) -> Result<OpeningReceivableDetail, OpeningReceivableError> {
    let tx = conn.transaction()?;
    let detail = create_opening_receivable_in_tx(&tx, tenant_id, user_id, input)?;
    tx.commit()?;
    Ok(detail)
}

pub fn void_opening_receivable_impl(
    conn: &mut Connection,
    tenant_id: &str,
    user_id: &str,
    id: &str,
    void_reason: &str,
) -> Result<OpeningReceivableDetail, OpeningReceivableError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(OpeningReceivableError::EmptyTenantId);
    }
    let uid = user_id.trim();
    if uid.is_empty() {
        return Err(OpeningReceivableError::EmptyUserId);
    }
    let oar_id = id.trim();
    if oar_id.is_empty() {
        return Err(OpeningReceivableError::NotFound);
    }

    validate_tenant_active(conn, tid)?;

    let reason_clean = void_reason.trim();
    if reason_clean.is_empty() {
        return Err(OpeningReceivableError::VoidReasonRequired);
    }

    let (current_status,): (String,) = conn
        .query_row(
            "SELECT status FROM opening_receivables WHERE id = ?1 AND tenant_id = ?2",
            params![oar_id, tid],
            |r| Ok((r.get(0)?,)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => OpeningReceivableError::NotFound,
            other => OpeningReceivableError::DatabaseError(other.to_string()),
        })?;

    if current_status != "open" {
        return Err(OpeningReceivableError::InvalidStateTransition {
            from: current_status,
            to: "voided".to_string(),
        });
    }

    // Find corresponding accounts_receivable
    let ar_row: Result<(String, String), _> = conn.query_row(
        "SELECT id, status FROM accounts_receivable 
         WHERE tenant_id = ?1 AND source_type = 'opening_balance' AND source_id = ?2",
        params![tid, oar_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    );

    let (ar_id, ar_status) = match ar_row {
        Ok(res) => res,
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            return Err(OpeningReceivableError::AccountsReceivableError(
                "找不到對應的應收帳款紀錄".to_string(),
            ))
        }
        Err(e) => return Err(OpeningReceivableError::DatabaseError(e.to_string())),
    };

    let now = current_timestamp();
    let tx = conn.transaction()?;

    if ar_status == "open" {
        let void_res = crate::accounts_receivable::void_account_receivable_in_tx(
            &tx,
            tid,
            uid,
            &ar_id,
            reason_clean,
        );

        match void_res {
            Ok(_) => {}
            Err(
                crate::accounts_receivable::AccountsReceivableError::HasPostedReceiptAllocations(
                    rc_no,
                ),
            ) => {
                return Err(OpeningReceivableError::HasPostedReceiptAllocations(rc_no));
            }
            Err(crate::accounts_receivable::AccountsReceivableError::HasPostedAllowances(
                al_no,
            )) => {
                return Err(OpeningReceivableError::HasPostedAllowances(al_no));
            }
            Err(e) => {
                return Err(OpeningReceivableError::AccountsReceivableError(
                    e.to_string(),
                ))
            }
        }
    }

    let affected = tx.execute(
        "UPDATE opening_receivables 
         SET status = 'voided', voided_by = ?1, voided_at = ?2, void_reason = ?3 
         WHERE id = ?4 AND tenant_id = ?5 AND status = 'open'",
        params![uid, now, reason_clean, oar_id, tid],
    )?;

    crate::ensure_guarded_mutation_affected(
        &tx,
        "opening_receivables",
        oar_id,
        tid,
        affected,
        OpeningReceivableError::NotFound,
        |s| {
            if s != "open" {
                Err(OpeningReceivableError::InvalidStateTransition {
                    from: s,
                    to: "voided".to_string(),
                })
            } else {
                Ok(())
            }
        },
    )?;

    tx.commit()?;

    get_opening_receivable_impl(conn, tid, oar_id)
}

pub fn get_opening_receivable_impl(
    conn: &Connection,
    tenant_id: &str,
    id: &str,
) -> Result<OpeningReceivableDetail, OpeningReceivableError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(OpeningReceivableError::EmptyTenantId);
    }
    let oar_id = id.trim();
    if oar_id.is_empty() {
        return Err(OpeningReceivableError::NotFound);
    }

    validate_tenant_active(conn, tid)?;

    let mut stmt = conn
        .prepare(
            "SELECT id, tenant_id, opening_number, customer_partner_id, customer_name_snapshot,
                    original_reference, document_date, due_date, amount, note, status,
                    created_by, created_at, voided_by, voided_at, void_reason
             FROM opening_receivables 
             WHERE id = ?1 AND tenant_id = ?2",
        )
        .map_err(|e| OpeningReceivableError::DatabaseError(e.to_string()))?;

    let oar = stmt
        .query_row(params![oar_id, tid], map_opening_receivable_row)
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => OpeningReceivableError::NotFound,
            other => OpeningReceivableError::DatabaseError(other.to_string()),
        })?;

    let ar_id: Option<String> = conn
        .query_row(
            "SELECT id FROM accounts_receivable 
             WHERE tenant_id = ?1 AND source_type = 'opening_balance' AND source_id = ?2",
            params![tid, oar_id],
            |r| r.get(0),
        )
        .ok();

    Ok(OpeningReceivableDetail {
        opening_receivable: oar,
        account_receivable_id: ar_id,
    })
}

pub fn list_opening_receivables_impl(
    conn: &Connection,
    tenant_id: &str,
    filter: Option<ListOpeningReceivablesFilter>,
) -> Result<Vec<OpeningReceivableItem>, OpeningReceivableError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(OpeningReceivableError::EmptyTenantId);
    }

    validate_tenant_active(conn, tid)?;

    let mut sql = "SELECT id, opening_number, customer_partner_id, customer_name_snapshot,
                          original_reference, document_date, due_date, amount, status, note,
                          created_at, voided_at, void_reason
                   FROM opening_receivables 
                   WHERE tenant_id = ?1"
        .to_string();

    let mut params_vec: Vec<rusqlite::types::Value> = vec![tid.to_string().into()];

    if let Some(f) = filter {
        if let Some(ref cust) = f.customer_partner_id {
            let cust_clean = cust.trim();
            if !cust_clean.is_empty() {
                params_vec.push(cust_clean.to_string().into());
                sql.push_str(&format!(" AND customer_partner_id = ?{}", params_vec.len()));
            }
        }
        if let Some(ref st) = f.status {
            let st_clean = st.trim();
            if !st_clean.is_empty() {
                params_vec.push(st_clean.to_string().into());
                sql.push_str(&format!(" AND status = ?{}", params_vec.len()));
            }
        }
    }

    sql.push_str(" ORDER BY created_at DESC, opening_number DESC");

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| OpeningReceivableError::DatabaseError(e.to_string()))?;

    let rows = stmt
        .query_map(rusqlite::params_from_iter(params_vec), |row| {
            Ok(OpeningReceivableItem {
                id: row.get(0)?,
                opening_number: row.get(1)?,
                customer_partner_id: row.get(2)?,
                customer_name_snapshot: row.get(3)?,
                original_reference: row.get(4)?,
                document_date: row.get(5)?,
                due_date: row.get(6)?,
                amount: row.get(7)?,
                status: row.get(8)?,
                note: row.get(9)?,
                created_at: row.get(10)?,
                voided_at: row.get(11)?,
                void_reason: row.get(12)?,
            })
        })
        .map_err(|e| OpeningReceivableError::DatabaseError(e.to_string()))?;

    let mut list = Vec::new();
    for item in rows {
        list.push(item?);
    }
    Ok(list)
}

// ==========================================
// Tauri Command Wrappers
// ==========================================

#[tauri::command]
pub async fn create_opening_receivable<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    input: CreateOpeningReceivableInput,
) -> Result<OpeningReceivableDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = "usr_current_user".to_string();

    create_opening_receivable_impl(&mut conn, &active_tid, &active_uid, input)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn void_opening_receivable<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    id: String,
    void_reason: String,
) -> Result<OpeningReceivableDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = "usr_current_user".to_string();

    void_opening_receivable_impl(&mut conn, &active_tid, &active_uid, &id, &void_reason)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_opening_receivables<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    filter: Option<ListOpeningReceivablesFilter>,
) -> Result<Vec<OpeningReceivableItem>, String> {
    let db_path = crate::get_db_path(&app_handle);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;

    list_opening_receivables_impl(&conn, &active_tid, filter).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_opening_receivable<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    id: String,
) -> Result<OpeningReceivableDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;

    get_opening_receivable_impl(&conn, &active_tid, &id).map_err(|e| e.to_string())
}

// ==========================================
// Unit Tests (Test Strategy Compliant)
// ==========================================

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE tenants (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active'
            )",
            [],
        )
        .unwrap();

        conn.execute(
            "CREATE TABLE partners (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                name TEXT NOT NULL,
                is_customer INTEGER NOT NULL DEFAULT 0,
                is_vendor INTEGER NOT NULL DEFAULT 0,
                is_active INTEGER NOT NULL DEFAULT 1
            )",
            [],
        )
        .unwrap();

        conn.execute(
            "CREATE TABLE sales_orders (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                so_number TEXT NOT NULL,
                customer_partner_id TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )",
            [],
        )
        .unwrap();

        create_opening_receivables_tables(&conn).unwrap();
        crate::accounts_receivable::create_accounts_receivable_tables(&conn).unwrap();

        conn.execute(
            "INSERT INTO tenants (id, name, status) VALUES ('tnt_test', '測試租戶', 'active')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tenants (id, name, status) VALUES ('tnt_inactive', '停用租戶', 'inactive')",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO partners (id, tenant_id, name, is_customer, is_vendor, is_active)
             VALUES ('cust_1', 'tnt_test', '測試客戶A', 1, 0, 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO partners (id, tenant_id, name, is_customer, is_vendor, is_active)
             VALUES ('cust_inactive', 'tnt_test', '停用客戶', 1, 0, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO partners (id, tenant_id, name, is_customer, is_vendor, is_active)
             VALUES ('vend_only', 'tnt_test', '純供應商', 0, 1, 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO partners (id, tenant_id, name, is_customer, is_vendor, is_active)
             VALUES ('cust_other', 'tnt_test', '測試客戶B', 1, 0, 1)",
            [],
        )
        .unwrap();

        conn
    }

    #[test]
    fn test_tc_oar_n_01_create_opening_receivable_without_so() {
        // Given: Active customer without sales orders
        let mut conn = setup_test_db();
        let input = CreateOpeningReceivableInput {
            customer_partner_id: "cust_1".to_string(),
            original_reference: "REF-001".to_string(),
            document_date: "2026-01-10".to_string(),
            due_date: "2026-02-10".to_string(),
            amount: 12500.0,
            note: Some("舊帳起點".to_string()),
        };

        // When: Creating opening receivable
        let detail =
            create_opening_receivable_impl(&mut conn, "tnt_test", "usr_admin", input).unwrap();

        // Then: Returns OAR-00001, status open, and creates AR
        assert_eq!(detail.opening_receivable.opening_number, "OAR-00001");
        assert_eq!(detail.opening_receivable.status, "open");
        assert_eq!(detail.opening_receivable.amount, 12500.0);
        assert!(detail.account_receivable_id.is_some());

        let ar_id = detail.account_receivable_id.unwrap();
        let ar_detail =
            crate::accounts_receivable::get_account_receivable_impl(&conn, "tnt_test", &ar_id)
                .unwrap();
        assert_eq!(ar_detail.source_type, "opening_balance");
        assert_eq!(ar_detail.source_number, "OAR-00001");
        assert_eq!(ar_detail.amount, 12500.0);
    }

    #[test]
    fn test_tc_oar_b_01_and_b_02_and_b_03_or01_sales_order_date_boundaries() {
        // Given: Customer has earliest sales order with created_at on 2026-11-05
        let mut conn = setup_test_db();
        let so_timestamp: i64 = 1793872800; // 2026-11-05 10:00:00 UTC (or local)
        let so_date: String = conn
            .query_row(
                "SELECT date(datetime(?1, 'unixepoch', 'localtime'))",
                params![so_timestamp],
                |r| r.get(0),
            )
            .unwrap();

        conn.execute(
            "INSERT INTO sales_orders (id, tenant_id, so_number, customer_partner_id, created_at)
             VALUES ('so_1', 'tnt_test', 'SO-00001', 'cust_1', ?1)",
            params![so_timestamp],
        )
        .unwrap();

        // Case TC-OAR-B-02: Document date exactly equal to earliest SO date is REJECTED
        let input_equal = CreateOpeningReceivableInput {
            customer_partner_id: "cust_1".to_string(),
            original_reference: "REF-SO-EQ".to_string(),
            document_date: so_date.clone(),
            due_date: "2026-11-30".to_string(),
            amount: 5000.0,
            note: None,
        };
        let err_equal =
            create_opening_receivable_impl(&mut conn, "tnt_test", "usr_admin", input_equal)
                .unwrap_err();
        assert_eq!(
            err_equal,
            OpeningReceivableError::DocumentDateNotEarlierThanFirstSalesOrder(
                "SO-00001".to_string(),
                so_date.clone()
            )
        );

        // Case TC-OAR-B-03: Document date after earliest SO date is REJECTED
        let input_after = CreateOpeningReceivableInput {
            customer_partner_id: "cust_1".to_string(),
            original_reference: "REF-SO-AFTER".to_string(),
            document_date: "2026-11-06".to_string(),
            due_date: "2026-11-30".to_string(),
            amount: 5000.0,
            note: None,
        };
        let err_after =
            create_opening_receivable_impl(&mut conn, "tnt_test", "usr_admin", input_after)
                .unwrap_err();
        assert_eq!(
            err_after,
            OpeningReceivableError::DocumentDateNotEarlierThanFirstSalesOrder(
                "SO-00001".to_string(),
                so_date
            )
        );

        // Case TC-OAR-B-01: Document date before earliest SO date (e.g. 2026-11-04) is ACCEPTED
        let input_before = CreateOpeningReceivableInput {
            customer_partner_id: "cust_1".to_string(),
            original_reference: "REF-SO-BEFORE".to_string(),
            document_date: "2026-11-04".to_string(),
            due_date: "2026-11-30".to_string(),
            amount: 5000.0,
            note: None,
        };
        let ok_before =
            create_opening_receivable_impl(&mut conn, "tnt_test", "usr_admin", input_before);
        assert!(ok_before.is_ok());
    }

    #[test]
    fn test_tc_oar_b_04_and_b_05_document_date_today_and_future_boundaries() {
        let mut conn = setup_test_db();
        let today = get_today_local(&conn).unwrap();

        // TC-OAR-B-04: Today is allowed
        let input_today = CreateOpeningReceivableInput {
            customer_partner_id: "cust_1".to_string(),
            original_reference: "REF-TODAY".to_string(),
            document_date: today.clone(),
            due_date: today.clone(),
            amount: 3000.0,
            note: None,
        };
        assert!(
            create_opening_receivable_impl(&mut conn, "tnt_test", "usr_admin", input_today).is_ok()
        );

        // TC-OAR-B-05: Future date is rejected
        let input_future = CreateOpeningReceivableInput {
            customer_partner_id: "cust_1".to_string(),
            original_reference: "REF-FUTURE".to_string(),
            document_date: "2099-12-31".to_string(),
            due_date: "2099-12-31".to_string(),
            amount: 3000.0,
            note: None,
        };
        let err_future =
            create_opening_receivable_impl(&mut conn, "tnt_test", "usr_admin", input_future)
                .unwrap_err();
        assert_eq!(
            err_future,
            OpeningReceivableError::DocumentDateCannotBeInFuture
        );
    }

    #[test]
    fn test_tc_oar_b_06_and_b_07_due_date_boundaries() {
        let mut conn = setup_test_db();

        // TC-OAR-B-06: Due date == document date is allowed
        let input_same = CreateOpeningReceivableInput {
            customer_partner_id: "cust_1".to_string(),
            original_reference: "REF-SAME-DAY".to_string(),
            document_date: "2026-01-15".to_string(),
            due_date: "2026-01-15".to_string(),
            amount: 2000.0,
            note: None,
        };
        assert!(
            create_opening_receivable_impl(&mut conn, "tnt_test", "usr_admin", input_same).is_ok()
        );

        // TC-OAR-B-07: Due date < document date is rejected
        let input_earlier = CreateOpeningReceivableInput {
            customer_partner_id: "cust_1".to_string(),
            original_reference: "REF-EARLIER-DUE".to_string(),
            document_date: "2026-01-15".to_string(),
            due_date: "2026-01-14".to_string(),
            amount: 2000.0,
            note: None,
        };
        let err = create_opening_receivable_impl(&mut conn, "tnt_test", "usr_admin", input_earlier)
            .unwrap_err();
        assert_eq!(err, OpeningReceivableError::DueDateEarlierThanDocumentDate);
    }

    #[test]
    fn test_tc_oar_b_08_and_b_09_and_e_02_amount_boundaries() {
        let mut conn = setup_test_db();

        // TC-OAR-B-08: Amount = 0.0 is rejected
        let input_zero = CreateOpeningReceivableInput {
            customer_partner_id: "cust_1".to_string(),
            original_reference: "REF-ZERO".to_string(),
            document_date: "2026-01-10".to_string(),
            due_date: "2026-01-20".to_string(),
            amount: 0.0,
            note: None,
        };
        assert_eq!(
            create_opening_receivable_impl(&mut conn, "tnt_test", "usr_admin", input_zero)
                .unwrap_err(),
            OpeningReceivableError::AmountMustBePositive
        );

        // TC-OAR-E-02: Negative amount is rejected
        let input_neg = CreateOpeningReceivableInput {
            customer_partner_id: "cust_1".to_string(),
            original_reference: "REF-NEG".to_string(),
            document_date: "2026-01-10".to_string(),
            due_date: "2026-01-20".to_string(),
            amount: -50.0,
            note: None,
        };
        assert_eq!(
            create_opening_receivable_impl(&mut conn, "tnt_test", "usr_admin", input_neg)
                .unwrap_err(),
            OpeningReceivableError::AmountMustBePositive
        );

        // TC-OAR-B-09: Amount = 0.01 is accepted
        let input_min = CreateOpeningReceivableInput {
            customer_partner_id: "cust_1".to_string(),
            original_reference: "REF-MIN".to_string(),
            document_date: "2026-01-10".to_string(),
            due_date: "2026-01-20".to_string(),
            amount: 0.01,
            note: None,
        };
        assert!(
            create_opening_receivable_impl(&mut conn, "tnt_test", "usr_admin", input_min).is_ok()
        );
    }

    #[test]
    fn test_tc_oar_e_01_inactive_tenant_rejected() {
        let mut conn = setup_test_db();
        let input = CreateOpeningReceivableInput {
            customer_partner_id: "cust_1".to_string(),
            original_reference: "REF-INACTIVE-TNT".to_string(),
            document_date: "2026-01-10".to_string(),
            due_date: "2026-01-20".to_string(),
            amount: 1000.0,
            note: None,
        };
        assert_eq!(
            create_opening_receivable_impl(&mut conn, "tnt_inactive", "usr_admin", input)
                .unwrap_err(),
            OpeningReceivableError::TenantNotActive
        );
    }

    #[test]
    fn test_tc_oar_e_03_empty_original_reference_rejected() {
        let mut conn = setup_test_db();
        let input = CreateOpeningReceivableInput {
            customer_partner_id: "cust_1".to_string(),
            original_reference: "   ".to_string(),
            document_date: "2026-01-10".to_string(),
            due_date: "2026-01-20".to_string(),
            amount: 1000.0,
            note: None,
        };
        assert_eq!(
            create_opening_receivable_impl(&mut conn, "tnt_test", "usr_admin", input).unwrap_err(),
            OpeningReceivableError::EmptyOriginalReference
        );
    }

    #[test]
    fn test_tc_oar_e_04_partner_not_customer_or_inactive() {
        let mut conn = setup_test_db();

        // Partner not customer
        let input_vendor = CreateOpeningReceivableInput {
            customer_partner_id: "vend_only".to_string(),
            original_reference: "REF-VEND".to_string(),
            document_date: "2026-01-10".to_string(),
            due_date: "2026-01-20".to_string(),
            amount: 1000.0,
            note: None,
        };
        assert_eq!(
            create_opening_receivable_impl(&mut conn, "tnt_test", "usr_admin", input_vendor)
                .unwrap_err(),
            OpeningReceivableError::PartnerNotCustomer
        );

        // Inactive customer
        let input_inactive = CreateOpeningReceivableInput {
            customer_partner_id: "cust_inactive".to_string(),
            original_reference: "REF-INACT".to_string(),
            document_date: "2026-01-10".to_string(),
            due_date: "2026-01-20".to_string(),
            amount: 1000.0,
            note: None,
        };
        assert_eq!(
            create_opening_receivable_impl(&mut conn, "tnt_test", "usr_admin", input_inactive)
                .unwrap_err(),
            OpeningReceivableError::CustomerInactive
        );
    }

    #[test]
    fn test_tc_oar_e_05_and_e_06_duplicate_original_reference() {
        let mut conn = setup_test_db();
        let input1 = CreateOpeningReceivableInput {
            customer_partner_id: "cust_1".to_string(),
            original_reference: "INV-DUP-01".to_string(),
            document_date: "2026-01-10".to_string(),
            due_date: "2026-01-20".to_string(),
            amount: 1000.0,
            note: None,
        };
        let oar1 =
            create_opening_receivable_impl(&mut conn, "tnt_test", "usr_admin", input1).unwrap();

        // Exact match
        let input_dup = CreateOpeningReceivableInput {
            customer_partner_id: "cust_1".to_string(),
            original_reference: "INV-DUP-01".to_string(),
            document_date: "2026-01-11".to_string(),
            due_date: "2026-01-21".to_string(),
            amount: 2000.0,
            note: None,
        };
        assert_eq!(
            create_opening_receivable_impl(&mut conn, "tnt_test", "usr_admin", input_dup)
                .unwrap_err(),
            OpeningReceivableError::DuplicateOriginalReference(
                "INV-DUP-01".to_string(),
                oar1.opening_receivable.opening_number.clone()
            )
        );

        // Case-insensitive & trimmed match
        let input_dup_case = CreateOpeningReceivableInput {
            customer_partner_id: "cust_1".to_string(),
            original_reference: "  inv-dup-01  ".to_string(),
            document_date: "2026-01-12".to_string(),
            due_date: "2026-01-22".to_string(),
            amount: 3000.0,
            note: None,
        };
        assert_eq!(
            create_opening_receivable_impl(&mut conn, "tnt_test", "usr_admin", input_dup_case)
                .unwrap_err(),
            OpeningReceivableError::DuplicateOriginalReference(
                "inv-dup-01".to_string(),
                oar1.opening_receivable.opening_number
            )
        );

        // Different customer using same ref is allowed
        let input_other_cust = CreateOpeningReceivableInput {
            customer_partner_id: "cust_other".to_string(),
            original_reference: "INV-DUP-01".to_string(),
            document_date: "2026-01-10".to_string(),
            due_date: "2026-01-20".to_string(),
            amount: 1000.0,
            note: None,
        };
        assert!(create_opening_receivable_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            input_other_cust
        )
        .is_ok());
    }

    #[test]
    fn test_tc_oar_n_06_and_e_08_and_e_12_void_lifecycle() {
        let mut conn = setup_test_db();
        let input = CreateOpeningReceivableInput {
            customer_partner_id: "cust_1".to_string(),
            original_reference: "INV-VOID-LIFECYCLE".to_string(),
            document_date: "2026-01-10".to_string(),
            due_date: "2026-01-20".to_string(),
            amount: 1000.0,
            note: None,
        };
        let created =
            create_opening_receivable_impl(&mut conn, "tnt_test", "usr_admin", input).unwrap();
        let oar_id = created.opening_receivable.id;

        // Void with empty reason is rejected
        let err_reason =
            void_opening_receivable_impl(&mut conn, "tnt_test", "usr_admin", &oar_id, "  ")
                .unwrap_err();
        assert_eq!(err_reason, OpeningReceivableError::VoidReasonRequired);

        // Void success
        let voided =
            void_opening_receivable_impl(&mut conn, "tnt_test", "usr_admin", &oar_id, "誤開作廢")
                .unwrap();
        assert_eq!(voided.opening_receivable.status, "voided");
        assert_eq!(
            voided.opening_receivable.void_reason,
            Some("誤開作廢".to_string())
        );

        // Double void rejected
        let err_double =
            void_opening_receivable_impl(&mut conn, "tnt_test", "usr_admin", &oar_id, "再次作廢")
                .unwrap_err();
        assert_eq!(
            err_double,
            OpeningReceivableError::InvalidStateTransition {
                from: "voided".to_string(),
                to: "voided".to_string()
            }
        );

        // After voided, original_reference can be re-used
        let input_reuse = CreateOpeningReceivableInput {
            customer_partner_id: "cust_1".to_string(),
            original_reference: "INV-VOID-LIFECYCLE".to_string(),
            document_date: "2026-01-10".to_string(),
            due_date: "2026-01-20".to_string(),
            amount: 1500.0,
            note: None,
        };
        let recreated =
            create_opening_receivable_impl(&mut conn, "tnt_test", "usr_admin", input_reuse)
                .unwrap();
        assert_eq!(recreated.opening_receivable.status, "open");
    }

    #[test]
    fn test_tc_oar_n_05_list_opening_receivables_with_filter() {
        let mut conn = setup_test_db();
        let input1 = CreateOpeningReceivableInput {
            customer_partner_id: "cust_1".to_string(),
            original_reference: "INV-LIST-1".to_string(),
            document_date: "2026-01-10".to_string(),
            due_date: "2026-01-20".to_string(),
            amount: 1000.0,
            note: None,
        };
        let input2 = CreateOpeningReceivableInput {
            customer_partner_id: "cust_other".to_string(),
            original_reference: "INV-LIST-2".to_string(),
            document_date: "2026-01-11".to_string(),
            due_date: "2026-01-21".to_string(),
            amount: 2000.0,
            note: None,
        };
        create_opening_receivable_impl(&mut conn, "tnt_test", "usr_admin", input1).unwrap();
        create_opening_receivable_impl(&mut conn, "tnt_test", "usr_admin", input2).unwrap();

        let list_all = list_opening_receivables_impl(&conn, "tnt_test", None).unwrap();
        assert_eq!(list_all.len(), 2);

        let list_cust1 = list_opening_receivables_impl(
            &conn,
            "tnt_test",
            Some(ListOpeningReceivablesFilter {
                customer_partner_id: Some("cust_1".to_string()),
                status: None,
            }),
        )
        .unwrap();
        assert_eq!(list_cust1.len(), 1);
        assert_eq!(list_cust1[0].customer_partner_id, "cust_1");
    }
}
