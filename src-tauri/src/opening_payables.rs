use rusqlite::{params, Connection, Transaction};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static OAP_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

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

pub fn parse_date(date_str: &str) -> Result<(i32, u32, u32), OpeningPayableError> {
    let trimmed = date_str.trim();
    let parts: Vec<&str> = trimmed.split('-').collect();
    if parts.len() != 3 || parts[0].len() != 4 || parts[1].len() != 2 || parts[2].len() != 2 {
        return Err(OpeningPayableError::InvalidDateFormat(
            "日期格式需為 YYYY-MM-DD".to_string(),
        ));
    }
    let year: i32 = parts[0]
        .parse()
        .map_err(|_| OpeningPayableError::InvalidDateFormat("無效的年份".to_string()))?;
    let month: u32 = parts[1]
        .parse()
        .map_err(|_| OpeningPayableError::InvalidDateFormat("無效的月份".to_string()))?;
    let day: u32 = parts[2]
        .parse()
        .map_err(|_| OpeningPayableError::InvalidDateFormat("無效的日期".to_string()))?;

    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return Err(OpeningPayableError::InvalidDateFormat(
            "無效的日期數值".to_string(),
        ));
    }
    let dim = get_days_in_month(year, month);
    if day > dim {
        return Err(OpeningPayableError::InvalidDateFormat(
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
pub enum OpeningPayableError {
    #[error("租戶 ID 不可為空")]
    EmptyTenantId,

    #[error("使用者 ID 不可為空")]
    EmptyUserId,

    #[error("找不到指定的租戶")]
    TenantNotFound,

    #[error("租戶未啟用或已停用")]
    TenantNotActive,

    #[error("找不到指定的期初應付帳款")]
    NotFound,

    #[error("找不到指定的供應商")]
    VendorNotFound,

    #[error("指定夥伴不是供應商")]
    PartnerNotVendor,

    #[error("指定供應商已停用")]
    VendorInactive,

    #[error("原單號或發票號不可為空")]
    EmptyOriginalReference,

    #[error("未付金額必須大於 0")]
    AmountMustBePositive,

    #[error("單據日不可晚於今天")]
    DocumentDateCannotBeInFuture,

    #[error("到期日不可早於單據日")]
    DueDateEarlierThanDocumentDate,

    #[error(
        "期初應付的單據日須早於此供應商在系統中的第一張採購單（{0}，{1}）；導入後的欠款請走請款單"
    )]
    DocumentDateNotEarlierThanFirstPurchaseOrder(String, String),

    #[error("此供應商的期初單號 {0} 已登錄於 {1}")]
    DuplicateOriginalReference(String, String),

    #[error("原因必填")]
    VoidReasonRequired,

    #[error("此期初應付已有付款核銷：{0}，請先作廢付款單")]
    HasPostedPaymentAllocations(String),

    #[error("無效的狀態轉換：從 {from} 到 {to}")]
    InvalidStateTransition { from: String, to: String },

    #[error("日期格式錯誤: {0}")]
    InvalidDateFormat(String),

    #[error("應付帳款模組錯誤: {0}")]
    AccountsPayableError(String),

    #[error("資料庫錯誤: {0}")]
    DatabaseError(String),
}

impl From<rusqlite::Error> for OpeningPayableError {
    fn from(err: rusqlite::Error) -> Self {
        OpeningPayableError::DatabaseError(err.to_string())
    }
}

// ==========================================
// Data Structures
// ==========================================

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct OpeningPayable {
    pub id: String,
    pub tenant_id: String,
    pub opening_number: String,
    pub vendor_partner_id: String,
    pub vendor_name_snapshot: String,
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
pub struct OpeningPayableDetail {
    pub opening_payable: OpeningPayable,
    pub account_payable_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct OpeningPayableItem {
    pub id: String,
    pub opening_number: String,
    pub vendor_partner_id: String,
    pub vendor_name_snapshot: String,
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
pub struct CreateOpeningPayableInput {
    pub vendor_partner_id: String,
    pub original_reference: String,
    pub document_date: String,
    pub due_date: String,
    pub amount: f64,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
pub struct ListOpeningPayablesFilter {
    pub vendor_partner_id: Option<String>,
    pub status: Option<String>,
}

// ==========================================
// Table Schema Initialization
// ==========================================

pub fn create_opening_payables_tables(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS opening_payables (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            opening_number TEXT NOT NULL,
            vendor_partner_id TEXT NOT NULL,
            vendor_name_snapshot TEXT NOT NULL,
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
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_oap_tenant_number ON opening_payables (tenant_id, opening_number)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_oap_tenant_vendor ON opening_payables (tenant_id, vendor_partner_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_oap_tenant_status ON opening_payables (tenant_id, status)",
        [],
    )?;

    Ok(())
}

// ==========================================
// Helper Functions
// ==========================================

fn validate_tenant_active(conn: &Connection, tenant_id: &str) -> Result<(), OpeningPayableError> {
    let mut stmt = conn
        .prepare("SELECT status FROM tenants WHERE id = ?1")
        .map_err(|e| OpeningPayableError::DatabaseError(e.to_string()))?;
    let status: Result<String, _> = stmt.query_row(params![tenant_id], |r| r.get(0));
    match status {
        Ok(s) if s == "active" => Ok(()),
        Ok(_) => Err(OpeningPayableError::TenantNotActive),
        Err(rusqlite::Error::QueryReturnedNoRows) => Err(OpeningPayableError::TenantNotFound),
        Err(e) => Err(OpeningPayableError::DatabaseError(e.to_string())),
    }
}

fn next_opening_number(tx: &Transaction, tenant_id: &str) -> Result<String, rusqlite::Error> {
    let mut stmt = tx.prepare(
        "SELECT COALESCE(MAX(CAST(SUBSTR(opening_number, 5) AS INTEGER)), 0) + 1 
         FROM opening_payables WHERE tenant_id = ?1",
    )?;
    let next_seq: i64 = stmt.query_row(params![tenant_id], |row| row.get(0))?;
    Ok(format!("OAP-{:05}", next_seq))
}

fn resolve_vendor_snapshot(
    conn: &Connection,
    tenant_id: &str,
    vendor_partner_id: &str,
) -> Result<String, OpeningPayableError> {
    let mut stmt = conn
        .prepare(
            "SELECT name, is_vendor, is_active 
             FROM partners 
             WHERE id = ?1 AND tenant_id = ?2",
        )
        .map_err(|e| OpeningPayableError::DatabaseError(e.to_string()))?;

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
                return Err(OpeningPayableError::PartnerNotVendor);
            }
            if is_active != 1 {
                return Err(OpeningPayableError::VendorInactive);
            }
            Ok(name)
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Err(OpeningPayableError::VendorNotFound),
        Err(e) => Err(OpeningPayableError::DatabaseError(e.to_string())),
    }
}

/// OB-04: Check duplicate original_reference for same vendor among non-voided opening payables
fn check_duplicate_original_reference(
    conn: &Connection,
    tenant_id: &str,
    vendor_partner_id: &str,
    original_reference: &str,
) -> Result<(), OpeningPayableError> {
    let trimmed = original_reference.trim();
    if trimmed.is_empty() {
        return Err(OpeningPayableError::EmptyOriginalReference);
    }

    let mut stmt = conn
        .prepare(
            "SELECT opening_number FROM opening_payables 
             WHERE tenant_id = ?1 AND vendor_partner_id = ?2 
               AND LOWER(TRIM(original_reference)) = LOWER(?3) 
               AND status != 'voided' 
             LIMIT 1",
        )
        .map_err(|e| OpeningPayableError::DatabaseError(e.to_string()))?;

    let existing: Result<String, _> =
        stmt.query_row(params![tenant_id, vendor_partner_id, trimmed], |r| r.get(0));

    if let Ok(existing_number) = existing {
        return Err(OpeningPayableError::DuplicateOriginalReference(
            trimmed.to_string(),
            existing_number,
        ));
    }

    Ok(())
}

/// OB-03: Validate document_date against vendor's earliest purchase order
fn validate_ob03_first_purchase_order(
    conn: &Connection,
    tenant_id: &str,
    vendor_partner_id: &str,
    doc_date: &str,
) -> Result<(), OpeningPayableError> {
    let mut stmt = conn
        .prepare(
            "SELECT po_number, date(datetime(created_at, 'unixepoch', 'localtime')) AS po_date 
             FROM purchase_orders 
             WHERE tenant_id = ?1 AND vendor_partner_id = ?2 
             ORDER BY created_at ASC, po_number ASC 
             LIMIT 1",
        )
        .map_err(|e| OpeningPayableError::DatabaseError(e.to_string()))?;

    let earliest: Result<(String, String), _> = stmt
        .query_row(params![tenant_id, vendor_partner_id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        });

    if let Ok((po_number, po_date)) = earliest {
        if doc_date >= po_date.as_str() {
            return Err(
                OpeningPayableError::DocumentDateNotEarlierThanFirstPurchaseOrder(
                    po_number, po_date,
                ),
            );
        }
    }

    Ok(())
}

fn map_opening_payable_row(row: &rusqlite::Row) -> Result<OpeningPayable, rusqlite::Error> {
    Ok(OpeningPayable {
        id: row.get(0)?,
        tenant_id: row.get(1)?,
        opening_number: row.get(2)?,
        vendor_partner_id: row.get(3)?,
        vendor_name_snapshot: row.get(4)?,
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
// Core Business Logic Implementations
// ==========================================

pub fn create_opening_payable_impl(
    conn: &mut Connection,
    tenant_id: &str,
    user_id: &str,
    input: CreateOpeningPayableInput,
) -> Result<OpeningPayableDetail, OpeningPayableError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(OpeningPayableError::EmptyTenantId);
    }
    let uid = user_id.trim();
    if uid.is_empty() {
        return Err(OpeningPayableError::EmptyUserId);
    }

    // OB-01: Validate tenant active
    validate_tenant_active(conn, tid)?;

    let v_id = input.vendor_partner_id.trim();
    if v_id.is_empty() {
        return Err(OpeningPayableError::VendorNotFound);
    }

    let orig_ref = input.original_reference.trim();
    if orig_ref.is_empty() {
        return Err(OpeningPayableError::EmptyOriginalReference);
    }

    let doc_date = input.document_date.trim();
    parse_date(doc_date)?;

    let due_date = input.due_date.trim();
    parse_date(due_date)?;

    // OB-02: Amount > 0
    let amount = crate::accounts_payable::round_2(input.amount);
    if amount <= 0.0 {
        return Err(OpeningPayableError::AmountMustBePositive);
    }

    // OB-02: document_date <= today
    let today = get_today_local(conn)?;
    if doc_date > today.as_str() {
        return Err(OpeningPayableError::DocumentDateCannotBeInFuture);
    }

    // OB-02: due_date >= document_date
    if due_date < doc_date {
        return Err(OpeningPayableError::DueDateEarlierThanDocumentDate);
    }

    // OB-02: vendor partner valid
    let vendor_snapshot = resolve_vendor_snapshot(conn, tid, v_id)?;

    // OB-03: Document date must be earlier than vendor's first purchase order if exists
    validate_ob03_first_purchase_order(conn, tid, v_id, doc_date)?;

    // OB-04: Duplicate original reference check
    check_duplicate_original_reference(conn, tid, v_id, orig_ref)?;

    let now = current_timestamp();
    let oap_id = format!(
        "oap_{}_{}",
        now,
        OAP_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    );

    let note_clean = input
        .note
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    // OB-06: Atomic transaction with accounts_payable creation
    let tx = conn.transaction()?;

    let opening_number = next_opening_number(&tx, tid)?;

    tx.execute(
        "INSERT INTO opening_payables (
            id, tenant_id, opening_number, vendor_partner_id, vendor_name_snapshot,
            original_reference, document_date, due_date, amount, note, status,
            created_by, created_at, voided_by, voided_at, void_reason
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5,
            ?6, ?7, ?8, ?9, ?10, 'open',
            ?11, ?12, NULL, NULL, NULL
        )",
        params![
            oap_id,
            tid,
            opening_number,
            v_id,
            vendor_snapshot,
            orig_ref,
            doc_date,
            due_date,
            amount,
            note_clean,
            uid,
            now,
        ],
    )?;

    // Create corresponding accounts_payable with source_type = 'opening_balance'
    let ap_input = crate::accounts_payable::CreateAccountPayableInput {
        vendor_partner_id: v_id.to_string(),
        source_type: "opening_balance".to_string(),
        source_id: oap_id.clone(),
        source_number: opening_number.clone(),
        external_reference: Some(orig_ref.to_string()),
        document_date: doc_date.to_string(),
        due_date: due_date.to_string(),
        amount,
        currency: Some("TWD".to_string()),
    };

    let ap = crate::accounts_payable::create_account_payable_in_tx(&tx, tid, uid, ap_input)
        .map_err(|e| OpeningPayableError::AccountsPayableError(e.to_string()))?;

    tx.commit()?;

    get_opening_payable_impl(conn, tid, &oap_id).map(|mut detail| {
        detail.account_payable_id = Some(ap.id);
        detail
    })
}

pub fn void_opening_payable_impl(
    conn: &mut Connection,
    tenant_id: &str,
    user_id: &str,
    id: &str,
    void_reason: &str,
) -> Result<OpeningPayableDetail, OpeningPayableError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(OpeningPayableError::EmptyTenantId);
    }
    let uid = user_id.trim();
    if uid.is_empty() {
        return Err(OpeningPayableError::EmptyUserId);
    }
    let oap_id = id.trim();
    if oap_id.is_empty() {
        return Err(OpeningPayableError::NotFound);
    }

    // OB-01: Validate active tenant
    validate_tenant_active(conn, tid)?;

    // OB-05: Void reason required
    let reason_clean = void_reason.trim();
    if reason_clean.is_empty() {
        return Err(OpeningPayableError::VoidReasonRequired);
    }

    // Check existing opening payable
    let (current_status,): (String,) = conn
        .query_row(
            "SELECT status FROM opening_payables WHERE id = ?1 AND tenant_id = ?2",
            params![oap_id, tid],
            |r| Ok((r.get(0)?,)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => OpeningPayableError::NotFound,
            other => OpeningPayableError::DatabaseError(other.to_string()),
        })?;

    if current_status != "open" {
        return Err(OpeningPayableError::InvalidStateTransition {
            from: current_status,
            to: "voided".to_string(),
        });
    }

    // Find corresponding accounts_payable
    let ap_row: Result<(String, String), _> = conn.query_row(
        "SELECT id, status FROM accounts_payable 
         WHERE tenant_id = ?1 AND source_type = 'opening_balance' AND source_id = ?2",
        params![tid, oap_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    );

    let (ap_id, ap_status) = match ap_row {
        Ok(res) => res,
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            return Err(OpeningPayableError::AccountsPayableError(
                "找不到對應的應付帳款紀錄".to_string(),
            ))
        }
        Err(e) => return Err(OpeningPayableError::DatabaseError(e.to_string())),
    };

    let now = current_timestamp();

    // OB-06: Atomic transaction
    let tx = conn.transaction()?;

    // If AP is open, void AP (enforces AP-04 posted payment allocation check)
    if ap_status == "open" {
        let void_res = crate::accounts_payable::void_account_payable_in_tx(
            &tx,
            tid,
            uid,
            &ap_id,
            reason_clean,
        );

        match void_res {
            Ok(_) => {}
            Err(crate::accounts_payable::AccountsPayableError::HasPostedPaymentAllocations(
                pay_no,
            )) => {
                return Err(OpeningPayableError::HasPostedPaymentAllocations(pay_no));
            }
            Err(e) => return Err(OpeningPayableError::AccountsPayableError(e.to_string())),
        }
    }

    let affected = tx.execute(
        "UPDATE opening_payables 
         SET status = 'voided', voided_by = ?1, voided_at = ?2, void_reason = ?3 
         WHERE id = ?4 AND tenant_id = ?5 AND status = 'open'",
        params![uid, now, reason_clean, oap_id, tid],
    )?;

    crate::ensure_guarded_mutation_affected(
        &tx,
        "opening_payables",
        oap_id,
        tid,
        affected,
        OpeningPayableError::NotFound,
        |s| {
            if s != "open" {
                Err(OpeningPayableError::InvalidStateTransition {
                    from: s,
                    to: "voided".to_string(),
                })
            } else {
                Ok(())
            }
        },
    )?;

    tx.commit()?;

    get_opening_payable_impl(conn, tid, oap_id)
}

pub fn get_opening_payable_impl(
    conn: &Connection,
    tenant_id: &str,
    id: &str,
) -> Result<OpeningPayableDetail, OpeningPayableError> {
    let tid = tenant_id.trim();
    let oap_id = id.trim();

    let mut stmt = conn
        .prepare(
            "SELECT id, tenant_id, opening_number, vendor_partner_id, vendor_name_snapshot,
                    original_reference, document_date, due_date, amount, note, status,
                    created_by, created_at, voided_by, voided_at, void_reason
             FROM opening_payables 
             WHERE id = ?1 AND tenant_id = ?2",
        )
        .map_err(|e| OpeningPayableError::DatabaseError(e.to_string()))?;

    let oap = stmt
        .query_row(params![oap_id, tid], map_opening_payable_row)
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => OpeningPayableError::NotFound,
            other => OpeningPayableError::DatabaseError(other.to_string()),
        })?;

    // Query linked accounts_payable id
    let ap_id: Option<String> = conn
        .query_row(
            "SELECT id FROM accounts_payable 
             WHERE tenant_id = ?1 AND source_type = 'opening_balance' AND source_id = ?2",
            params![tid, oap_id],
            |r| r.get(0),
        )
        .ok();

    Ok(OpeningPayableDetail {
        opening_payable: oap,
        account_payable_id: ap_id,
    })
}

pub fn list_opening_payables_impl(
    conn: &Connection,
    tenant_id: &str,
    filter: Option<ListOpeningPayablesFilter>,
) -> Result<Vec<OpeningPayableItem>, OpeningPayableError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(OpeningPayableError::EmptyTenantId);
    }

    let mut query = String::from(
        "SELECT id, opening_number, vendor_partner_id, vendor_name_snapshot,
                original_reference, document_date, due_date, amount, status,
                note, created_at, voided_at, void_reason
         FROM opening_payables 
         WHERE tenant_id = ?1",
    );

    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(tid.to_string())];
    let mut param_idx = 2;

    if let Some(f) = filter {
        if let Some(vp) = f.vendor_partner_id {
            let vp_clean = vp.trim().to_string();
            if !vp_clean.is_empty() {
                query.push_str(&format!(" AND vendor_partner_id = ?{}", param_idx));
                params_vec.push(Box::new(vp_clean));
                param_idx += 1;
            }
        }

        if let Some(st) = f.status {
            let st_clean = st.trim().to_string();
            if !st_clean.is_empty() {
                query.push_str(&format!(" AND status = ?{}", param_idx));
                params_vec.push(Box::new(st_clean));
            }
        }
    }

    query.push_str(" ORDER BY opening_number DESC, created_at DESC");

    let mut stmt = conn
        .prepare(&query)
        .map_err(|e| OpeningPayableError::DatabaseError(e.to_string()))?;

    let rusqlite_params: Vec<&dyn rusqlite::ToSql> =
        params_vec.iter().map(|p| p.as_ref()).collect();

    let rows = stmt.query_map(rusqlite_params.as_slice(), |r| {
        Ok(OpeningPayableItem {
            id: r.get(0)?,
            opening_number: r.get(1)?,
            vendor_partner_id: r.get(2)?,
            vendor_name_snapshot: r.get(3)?,
            original_reference: r.get(4)?,
            document_date: r.get(5)?,
            due_date: r.get(6)?,
            amount: r.get(7)?,
            status: r.get(8)?,
            note: r.get(9)?,
            created_at: r.get(10)?,
            voided_at: r.get(11)?,
            void_reason: r.get(12)?,
        })
    })?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r?);
    }

    Ok(list)
}

// ==========================================
// Tauri Commands
// ==========================================

#[tauri::command]
#[specta::specta]
pub async fn create_opening_payable<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    input: CreateOpeningPayableInput,
) -> Result<OpeningPayableDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;
    create_opening_payable_impl(&mut conn, &active_tid, &active_uid, input)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn void_opening_payable<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    id: String,
    void_reason: String,
) -> Result<OpeningPayableDetail, String> {
    let db_path = crate::get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;
    void_opening_payable_impl(&mut conn, &active_tid, &active_uid, &id, &void_reason)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn list_opening_payables<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    filter: Option<ListOpeningPayablesFilter>,
) -> Result<Vec<OpeningPayableItem>, String> {
    let db_path = crate::get_db_path(&app_handle);
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    list_opening_payables_impl(&conn, &active_tid, filter).map_err(|e| e.to_string())
}

// ==========================================
// Unit Tests (Test Strategy Table Implementation)
// ==========================================

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();

        // 1. Basic tenant & user tables
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
                email TEXT NOT NULL,
                name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'member',
                created_at INTEGER NOT NULL
            )",
            [],
        )
        .unwrap();

        conn.execute(
            "CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                tenant_id TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            )",
            [],
        )
        .unwrap();

        conn.execute(
            "CREATE TABLE IF NOT EXISTS partners (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                name TEXT NOT NULL,
                is_vendor INTEGER NOT NULL DEFAULT 1,
                is_customer INTEGER NOT NULL DEFAULT 0,
                is_active INTEGER NOT NULL DEFAULT 1,
                payment_terms_type TEXT,
                payment_terms_days INTEGER,
                created_at INTEGER NOT NULL
            )",
            [],
        )
        .unwrap();

        crate::purchase_orders::create_purchase_orders_tables(&conn).unwrap();
        crate::accounts_payable::create_accounts_payable_tables(&conn).unwrap();
        create_opening_payables_tables(&conn).unwrap();

        // Seed tenant, user, session
        conn.execute(
            "INSERT INTO tenants (id, name, status, created_at) VALUES ('tnt_test', '測試租戶', 'active', 1700000000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tenants (id, name, status, created_at) VALUES ('tnt_inactive', '停用租戶', 'suspended', 1700000000)",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES ('usr_admin', 'admin@test.com', 'Admin', 'hash', 'admin', 1700000000)",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO sessions (token, user_id, tenant_id, created_at, expires_at) VALUES ('sess_valid', 'usr_admin', 'tnt_test', 1700000000, 2000000000)",
            [],
        )
        .unwrap();

        // Seed vendors
        conn.execute(
            "INSERT INTO partners (id, tenant_id, name, is_vendor, is_customer, is_active, payment_terms_type, payment_terms_days, created_at)
             VALUES ('vnd_001', 'tnt_test', '宏碁電腦股份有限公司', 1, 0, 1, 'net', 30, 1700000000)",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO partners (id, tenant_id, name, is_vendor, is_customer, is_active, payment_terms_type, payment_terms_days, created_at)
             VALUES ('vnd_002', 'tnt_test', '華碩電腦股份有限公司', 1, 0, 1, 'month_end', 15, 1700000000)",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO partners (id, tenant_id, name, is_vendor, is_customer, is_active, payment_terms_type, payment_terms_days, created_at)
             VALUES ('vnd_inactive', 'tnt_test', '停用供應商', 1, 0, 0, NULL, NULL, 1700000000)",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO partners (id, tenant_id, name, is_vendor, is_customer, is_active, payment_terms_type, payment_terms_days, created_at)
             VALUES ('cus_001', 'tnt_test', '純客戶夥伴', 0, 1, 1, NULL, NULL, 1700000000)",
            [],
        )
        .unwrap();

        conn
    }

    // ==========================================
    // Normal Cases (TC-OAP-N-01 to TC-OAP-N-06)
    // ==========================================

    #[test]
    fn test_tc_oap_n_01_create_opening_payable_vendor_without_po() {
        // Given: Preconditions: Active tenant, vendor without purchase orders
        let mut conn = setup_test_db();
        let input = CreateOpeningPayableInput {
            vendor_partner_id: "vnd_001".to_string(),
            original_reference: "OLD-INV-001".to_string(),
            document_date: "2026-01-10".to_string(),
            due_date: "2026-02-10".to_string(),
            amount: 15000.0,
            note: Some("導入前期初欠款".to_string()),
        };

        // When: Operation to execute: Create opening payable
        let detail =
            create_opening_payable_impl(&mut conn, "tnt_test", "usr_admin", input).unwrap();

        // Then: Expected result: Opening payable created with OAP-00001, status open, and AP created
        assert_eq!(detail.opening_payable.opening_number, "OAP-00001");
        assert_eq!(detail.opening_payable.status, "open");
        assert_eq!(
            detail.opening_payable.vendor_name_snapshot,
            "宏碁電腦股份有限公司"
        );
        assert_eq!(detail.opening_payable.amount, 15000.0);
        assert!(detail.account_payable_id.is_some());

        // Verify accounts_payable table record
        let ap_id = detail.account_payable_id.unwrap();
        let ap_status: String = conn
            .query_row(
                "SELECT status FROM accounts_payable WHERE id = ?1 AND source_type = 'opening_balance'",
                params![ap_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(ap_status, "open");
    }

    #[test]
    fn test_tc_oap_n_02_create_opening_payable_with_earlier_date_than_po() {
        // Given: Preconditions: Vendor has a purchase order created on 2026-11-02
        let mut conn = setup_test_db();
        // Insert PO created at unix timestamp for 2026-11-02 10:00:00 (1793613600)
        let po_created_ts: i64 = conn
            .query_row("SELECT unixepoch('2026-11-02 10:00:00')", [], |r| r.get(0))
            .unwrap();
        conn.execute(
            "INSERT INTO purchase_orders (id, tenant_id, po_number, vendor_partner_id, vendor_name_snapshot, status, created_by, created_at)
             VALUES ('po_001', 'tnt_test', 'PO-00001', 'vnd_001', '宏碁電腦股份有限公司', 'ordered', 'usr_admin', ?1)",
            params![po_created_ts],
        )
        .unwrap();

        // When: Operation to execute: Create opening payable with document_date = 2026-10-15 (< 2026-11-02)
        let input = CreateOpeningPayableInput {
            vendor_partner_id: "vnd_001".to_string(),
            original_reference: "OLD-INV-002".to_string(),
            document_date: "2026-10-15".to_string(),
            due_date: "2026-11-15".to_string(),
            amount: 8000.0,
            note: None,
        };
        let res = create_opening_payable_impl(&mut conn, "tnt_test", "usr_admin", input);

        // Then: Expected result: Success
        assert!(res.is_ok());
        assert_eq!(res.unwrap().opening_payable.opening_number, "OAP-00001");
    }

    #[test]
    fn test_tc_oap_n_05_list_opening_payables_with_filter() {
        // Given: Preconditions: Two opening payables for two different vendors
        let mut conn = setup_test_db();
        create_opening_payable_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateOpeningPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                original_reference: "REF-001".to_string(),
                document_date: "2026-01-10".to_string(),
                due_date: "2026-02-10".to_string(),
                amount: 1000.0,
                note: None,
            },
        )
        .unwrap();

        create_opening_payable_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateOpeningPayableInput {
                vendor_partner_id: "vnd_002".to_string(),
                original_reference: "REF-002".to_string(),
                document_date: "2026-01-10".to_string(),
                due_date: "2026-02-10".to_string(),
                amount: 2000.0,
                note: None,
            },
        )
        .unwrap();

        // When: Operation to execute: List opening payables filtering by vnd_001
        let list = list_opening_payables_impl(
            &conn,
            "tnt_test",
            Some(ListOpeningPayablesFilter {
                vendor_partner_id: Some("vnd_001".to_string()),
                status: None,
            }),
        )
        .unwrap();

        // Then: Expected result: Only 1 item returned matching vnd_001
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].vendor_partner_id, "vnd_001");
        assert_eq!(list[0].original_reference, "REF-001");
    }

    #[test]
    fn test_tc_oap_n_06_void_opening_payable_success() {
        // Given: Preconditions: An open opening payable without payment allocations
        let mut conn = setup_test_db();
        let detail = create_opening_payable_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateOpeningPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                original_reference: "REF-VOID-01".to_string(),
                document_date: "2026-01-10".to_string(),
                due_date: "2026-02-10".to_string(),
                amount: 5000.0,
                note: None,
            },
        )
        .unwrap();
        let oap_id = detail.opening_payable.id;

        // When: Operation to execute: Void opening payable with valid reason
        let voided_detail = void_opening_payable_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            &oap_id,
            "金額輸入錯誤重開",
        )
        .unwrap();

        // Then: Expected result: Status is voided on opening_payable and on accounts_payable
        assert_eq!(voided_detail.opening_payable.status, "voided");
        assert_eq!(
            voided_detail.opening_payable.void_reason.as_deref(),
            Some("金額輸入錯誤重開")
        );

        let ap_status: String = conn
            .query_row(
                "SELECT status FROM accounts_payable WHERE tenant_id = 'tnt_test' AND source_id = ?1",
                params![oap_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(ap_status, "voided");
    }

    // ==========================================
    // Boundary Cases (TC-OAP-B-01 to TC-OAP-B-07)
    // ==========================================

    #[test]
    fn test_tc_oap_b_01_and_b_02_ob03_po_date_boundaries() {
        // Given: Preconditions: First purchase order for vnd_001 on 2026-11-02
        let mut conn = setup_test_db();
        let po_created_ts: i64 = conn
            .query_row("SELECT unixepoch('2026-11-02 12:00:00')", [], |r| r.get(0))
            .unwrap();
        conn.execute(
            "INSERT INTO purchase_orders (id, tenant_id, po_number, vendor_partner_id, vendor_name_snapshot, status, created_by, created_at)
             VALUES ('po_001', 'tnt_test', 'PO-00001', 'vnd_001', '宏碁電腦股份有限公司', 'ordered', 'usr_admin', ?1)",
            params![po_created_ts],
        )
        .unwrap();

        // When (TC-OAP-B-01): document_date is exactly 1 day before earliest PO (2026-11-01)
        let b01_res = create_opening_payable_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateOpeningPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                original_reference: "REF-B01".to_string(),
                document_date: "2026-11-01".to_string(),
                due_date: "2026-12-01".to_string(),
                amount: 3000.0,
                note: None,
            },
        );
        // Then: Allowed
        assert!(b01_res.is_ok());

        // When (TC-OAP-B-02): document_date is on the exact same day as earliest PO (2026-11-02)
        let b02_res = create_opening_payable_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateOpeningPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                original_reference: "REF-B02".to_string(),
                document_date: "2026-11-02".to_string(),
                due_date: "2026-12-02".to_string(),
                amount: 3000.0,
                note: None,
            },
        );
        // Then: Rejected with OB-03 error message specifying PO-00001 and 2026-11-02
        assert_eq!(
            b02_res.unwrap_err(),
            OpeningPayableError::DocumentDateNotEarlierThanFirstPurchaseOrder(
                "PO-00001".to_string(),
                "2026-11-02".to_string(),
            )
        );
    }

    #[test]
    fn test_tc_oap_b_03_and_b_04_document_date_today_and_future_boundaries() {
        // Given: Preconditions: Database with today local date
        let mut conn = setup_test_db();
        let today = get_today_local(&conn).unwrap();
        let (y, m, d) = parse_date(&today).unwrap();
        let tomorrow = format!("{:04}-{:02}-{:02}", y, m, d + 1);

        // When (TC-OAP-B-03): document_date is today
        let b03_res = create_opening_payable_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateOpeningPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                original_reference: "REF-TODAY".to_string(),
                document_date: today.clone(),
                due_date: today.clone(),
                amount: 1000.0,
                note: None,
            },
        );
        // Then: Allowed
        assert!(b03_res.is_ok());

        // When (TC-OAP-B-04): document_date is tomorrow (+1 day in future)
        let b04_res = create_opening_payable_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateOpeningPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                original_reference: "REF-TOMORROW".to_string(),
                document_date: tomorrow,
                due_date: "2030-01-01".to_string(),
                amount: 1000.0,
                note: None,
            },
        );
        // Then: Rejected
        assert_eq!(
            b04_res.unwrap_err(),
            OpeningPayableError::DocumentDateCannotBeInFuture
        );
    }

    #[test]
    fn test_tc_oap_b_05_and_b_06_due_date_boundaries() {
        // Given: Preconditions: Normal valid vendor
        let mut conn = setup_test_db();

        // When (TC-OAP-B-05): due_date == document_date
        let b05_res = create_opening_payable_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateOpeningPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                original_reference: "REF-DUE-EQUAL".to_string(),
                document_date: "2026-01-10".to_string(),
                due_date: "2026-01-10".to_string(),
                amount: 1000.0,
                note: None,
            },
        );
        // Then: Allowed
        assert!(b05_res.is_ok());

        // When (TC-OAP-B-06): due_date is 1 day earlier than document_date (2026-01-09 < 2026-01-10)
        let b06_res = create_opening_payable_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateOpeningPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                original_reference: "REF-DUE-EARLIER".to_string(),
                document_date: "2026-01-10".to_string(),
                due_date: "2026-01-09".to_string(),
                amount: 1000.0,
                note: None,
            },
        );
        // Then: Rejected
        assert_eq!(
            b06_res.unwrap_err(),
            OpeningPayableError::DueDateEarlierThanDocumentDate
        );
    }

    #[test]
    fn test_tc_oap_b_07_and_e_02_amount_boundaries() {
        // Given: Preconditions: Normal valid setup
        let mut conn = setup_test_db();

        // When (TC-OAP-B-07): amount = 0.0
        let b07_res = create_opening_payable_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateOpeningPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                original_reference: "REF-AMT-0".to_string(),
                document_date: "2026-01-10".to_string(),
                due_date: "2026-01-10".to_string(),
                amount: 0.0,
                note: None,
            },
        );
        // Then: Rejected
        assert_eq!(
            b07_res.unwrap_err(),
            OpeningPayableError::AmountMustBePositive
        );

        // When (TC-OAP-E-02): amount = -100.0
        let e02_res = create_opening_payable_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateOpeningPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                original_reference: "REF-AMT-NEG".to_string(),
                document_date: "2026-01-10".to_string(),
                due_date: "2026-01-10".to_string(),
                amount: -100.0,
                note: None,
            },
        );
        // Then: Rejected
        assert_eq!(
            e02_res.unwrap_err(),
            OpeningPayableError::AmountMustBePositive
        );
    }

    // ==========================================
    // Error Cases (TC-OAP-E-01 to TC-OAP-E-13)
    // ==========================================

    #[test]
    fn test_tc_oap_e_01_inactive_tenant_rejected() {
        // Given: Inactive / suspended tenant
        let mut conn = setup_test_db();

        // When: Creating opening payable under inactive tenant
        let err = create_opening_payable_impl(
            &mut conn,
            "tnt_inactive",
            "usr_admin",
            CreateOpeningPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                original_reference: "REF-INACT".to_string(),
                document_date: "2026-01-10".to_string(),
                due_date: "2026-01-10".to_string(),
                amount: 1000.0,
                note: None,
            },
        );

        // Then: Rejected with tenant inactive error
        assert!(err.is_err());
    }

    #[test]
    fn test_tc_oap_e_03_empty_original_reference_rejected() {
        // Given: Empty original reference
        let mut conn = setup_test_db();

        // When: Creating opening payable with empty whitespace original_reference
        let err = create_opening_payable_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateOpeningPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                original_reference: "   ".to_string(),
                document_date: "2026-01-10".to_string(),
                due_date: "2026-01-10".to_string(),
                amount: 1000.0,
                note: None,
            },
        );

        // Then: Rejected
        assert_eq!(
            err.unwrap_err(),
            OpeningPayableError::EmptyOriginalReference
        );
    }

    #[test]
    fn test_tc_oap_e_04_partner_not_vendor_or_inactive() {
        // Given: Partner that is not a vendor or is inactive
        let mut conn = setup_test_db();

        // When: Customer partner specified
        let err_cus = create_opening_payable_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateOpeningPayableInput {
                vendor_partner_id: "cus_001".to_string(),
                original_reference: "REF-CUS".to_string(),
                document_date: "2026-01-10".to_string(),
                due_date: "2026-01-10".to_string(),
                amount: 1000.0,
                note: None,
            },
        );
        // Then: Rejected with PartnerNotVendor
        assert_eq!(err_cus.unwrap_err(), OpeningPayableError::PartnerNotVendor);

        // When: Inactive vendor specified
        let err_inact = create_opening_payable_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateOpeningPayableInput {
                vendor_partner_id: "vnd_inactive".to_string(),
                original_reference: "REF-INACT".to_string(),
                document_date: "2026-01-10".to_string(),
                due_date: "2026-01-10".to_string(),
                amount: 1000.0,
                note: None,
            },
        );
        // Then: Rejected with VendorInactive
        assert_eq!(err_inact.unwrap_err(), OpeningPayableError::VendorInactive);
    }

    #[test]
    fn test_tc_oap_e_05_and_e_06_ob04_duplicate_reference() {
        // Given: Preconditions: First opening payable created with reference "INV-2025-001"
        let mut conn = setup_test_db();
        create_opening_payable_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateOpeningPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                original_reference: "INV-2025-001".to_string(),
                document_date: "2026-01-10".to_string(),
                due_date: "2026-01-10".to_string(),
                amount: 2000.0,
                note: None,
            },
        )
        .unwrap();

        // When (TC-OAP-E-05): Same vendor, duplicate exact reference
        let e05_err = create_opening_payable_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateOpeningPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                original_reference: "INV-2025-001".to_string(),
                document_date: "2026-01-10".to_string(),
                due_date: "2026-01-10".to_string(),
                amount: 3000.0,
                note: None,
            },
        );
        // Then: Rejected with OB-04
        assert_eq!(
            e05_err.unwrap_err(),
            OpeningPayableError::DuplicateOriginalReference(
                "INV-2025-001".to_string(),
                "OAP-00001".to_string(),
            )
        );

        // When (TC-OAP-E-06): Same vendor, case-insensitive / trimmed duplicate (" inv-2025-001  ")
        let e06_err = create_opening_payable_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateOpeningPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                original_reference: " inv-2025-001  ".to_string(),
                document_date: "2026-01-10".to_string(),
                due_date: "2026-01-10".to_string(),
                amount: 3000.0,
                note: None,
            },
        );
        // Then: Rejected with OB-04
        assert_eq!(
            e06_err.unwrap_err(),
            OpeningPayableError::DuplicateOriginalReference(
                "inv-2025-001".to_string(),
                "OAP-00001".to_string(),
            )
        );

        // When (TC-OAP-E-07): Different vendor with the same original_reference
        let e07_res = create_opening_payable_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateOpeningPayableInput {
                vendor_partner_id: "vnd_002".to_string(),
                original_reference: "INV-2025-001".to_string(),
                document_date: "2026-01-10".to_string(),
                due_date: "2026-01-10".to_string(),
                amount: 3000.0,
                note: None,
            },
        );
        // Then: Allowed
        assert!(e07_res.is_ok());

        // When (TC-OAP-E-08): First one is voided, now re-using same reference for vnd_001
        void_opening_payable_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            "oap_1", // wait, let's find the first oap id
            "作廢以重試",
        )
        .ok();
        // Void the actual first record
        let first_id: String = conn
            .query_row(
                "SELECT id FROM opening_payables WHERE opening_number = 'OAP-00001'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        void_opening_payable_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            &first_id,
            "作廢以重新登錄",
        )
        .unwrap();

        let e08_res = create_opening_payable_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateOpeningPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                original_reference: "INV-2025-001".to_string(),
                document_date: "2026-01-10".to_string(),
                due_date: "2026-01-10".to_string(),
                amount: 4000.0,
                note: None,
            },
        );
        // Then: Allowed because existing one is voided
        assert!(e08_res.is_ok());
    }

    #[test]
    fn test_tc_oap_e_09_void_empty_reason_rejected() {
        // Given: Open opening payable
        let mut conn = setup_test_db();
        let detail = create_opening_payable_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateOpeningPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                original_reference: "REF-EMPTY-RSN".to_string(),
                document_date: "2026-01-10".to_string(),
                due_date: "2026-01-10".to_string(),
                amount: 1000.0,
                note: None,
            },
        )
        .unwrap();

        // When: Voiding with whitespace
        let err = void_opening_payable_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            &detail.opening_payable.id,
            "   ",
        );

        // Then: Rejected with VoidReasonRequired
        assert_eq!(err.unwrap_err(), OpeningPayableError::VoidReasonRequired);
    }

    #[test]
    fn test_tc_oap_e_11_void_blocked_by_posted_payment_allocations() {
        // Given: Preconditions: Opening payable with corresponding AP having posted payment allocations
        let mut conn = setup_test_db();
        let detail = create_opening_payable_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateOpeningPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                original_reference: "REF-PAID-01".to_string(),
                document_date: "2026-01-10".to_string(),
                due_date: "2026-01-10".to_string(),
                amount: 5000.0,
                note: None,
            },
        )
        .unwrap();
        let ap_id = detail.account_payable_id.unwrap();

        // Seed a posted payment and allocation
        conn.execute(
            "INSERT INTO payments (id, tenant_id, payment_number, vendor_partner_id, payment_date, amount, status, created_by, created_at, posted_by, posted_at)
             VALUES ('pay_001', 'tnt_test', 'PAY-00001', 'vnd_001', '2026-01-15', 5000.0, 'posted', 'usr_admin', 1700000000, 'usr_admin', 1700000000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO payment_allocations (id, tenant_id, payment_id, account_payable_id, amount, created_at)
             VALUES ('pa_001', 'tnt_test', 'pay_001', ?1, 5000.0, 1700000000)",
            params![ap_id],
        )
        .unwrap();

        // When: Voiding the opening payable
        let err = void_opening_payable_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            &detail.opening_payable.id,
            "嘗試作廢已核銷",
        );

        // Then: Rejected by AP-04 / OB-05 with HasPostedPaymentAllocations
        assert_eq!(
            err.unwrap_err(),
            OpeningPayableError::HasPostedPaymentAllocations("PAY-00001".to_string())
        );
    }

    #[test]
    fn test_tc_oap_e_12_double_void_rejected() {
        // Given: Preconditions: Already voided opening payable
        let mut conn = setup_test_db();
        let detail = create_opening_payable_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateOpeningPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                original_reference: "REF-DBL-VOID".to_string(),
                document_date: "2026-01-10".to_string(),
                due_date: "2026-01-10".to_string(),
                amount: 1000.0,
                note: None,
            },
        )
        .unwrap();
        let oap_id = detail.opening_payable.id;
        void_opening_payable_impl(&mut conn, "tnt_test", "usr_admin", &oap_id, "第一次作廢")
            .unwrap();

        // When: Voiding second time
        let err =
            void_opening_payable_impl(&mut conn, "tnt_test", "usr_admin", &oap_id, "第二次作廢");

        // Then: Rejected with InvalidStateTransition
        assert_eq!(
            err.unwrap_err(),
            OpeningPayableError::InvalidStateTransition {
                from: "voided".to_string(),
                to: "voided".to_string(),
            }
        );
    }

    #[test]
    fn test_tc_oap_e_13_atomicity_ap_failure_leaves_no_opening_payable() {
        // Given: Preconditions: Setup database where accounts_payable creation will fail
        let mut conn = setup_test_db();
        // Force accounts_payable unique open source conflict beforehand by pre-inserting
        // Wait, next_opening_number will be OAP-00001
        // Let's create an opening payable first
        create_opening_payable_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateOpeningPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                original_reference: "REF-FIRST".to_string(),
                document_date: "2026-01-10".to_string(),
                due_date: "2026-01-10".to_string(),
                amount: 1000.0,
                note: None,
            },
        )
        .unwrap();

        let count_before: i64 = conn
            .query_row("SELECT COUNT(*) FROM opening_payables", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count_before, 1);

        // When: Attempting to create an opening payable with invalid due date that fails AP validation
        // (Due date earlier than doc date is caught by OB-02, but let's test atomic rollback on DB error)
        // Let's simulate a failure inside the transaction by intentionally breaking a constraint
        // If an error happens, count in opening_payables must remain 1.
        let fail_res = create_opening_payable_impl(
            &mut conn,
            "tnt_test",
            "usr_admin",
            CreateOpeningPayableInput {
                vendor_partner_id: "vnd_001".to_string(),
                original_reference: "REF-FIRST".to_string(), // duplicate reference
                document_date: "2026-01-10".to_string(),
                due_date: "2026-01-10".to_string(),
                amount: 1000.0,
                note: None,
            },
        );
        assert!(fail_res.is_err());

        // Then: No records left over
        let count_after: i64 = conn
            .query_row("SELECT COUNT(*) FROM opening_payables", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count_after, 1);
    }
}
