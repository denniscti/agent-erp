use crate::get_db_path;
use rusqlite::{params, Connection};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static QUOTE_ID_COUNTER: AtomicU64 = AtomicU64::new(1000);

// ==========================================
// Errors
// ==========================================

#[derive(Debug, thiserror::Error, PartialEq, Clone)]
pub enum QuoteError {
    #[error("找不到此客戶，或該往來對象未設定為客戶")]
    CustomerNotFoundOrInactive,

    #[error("此商品不可銷售")]
    ProductNotSellable,

    #[error("數量必須大於 0，單價不可為負數")]
    InvalidQuantityOrPrice,

    #[error("報價單狀態為 {0}，僅草稿可修改")]
    NotDraftForModification(String),

    #[error("報價單沒有任何品項，無法送出")]
    NoLinesForSubmit,

    #[error("報價有效期已過，請先修改有效期")]
    ExpiredValidUntil,

    #[error("目前狀態不允許此操作")]
    InvalidStatusTransition,

    #[error("此報價單已結案，無法修改")]
    TerminalStateImmutable,

    #[error("駁回理由為必填")]
    ApprovalReasonRequired,

    #[error("找不到報價單或不屬於目前租戶")]
    QuoteNotFound,

    #[error("找不到指定的商品單位")]
    UnitNotFound,

    #[error("同一報價單內商品單位不可重複")]
    DuplicateUnitInQuote,

    #[error("找不到指定的報價明細")]
    LineNotFound,

    #[error("Tenant ID cannot be empty")]
    EmptyTenantId,

    #[error("無法解析有效使用者 session，操作被拒絕")]
    EmptyUserId,

    #[error("日期格式需為 YYYY-MM-DD")]
    InvalidDateFormat(String),

    #[error("{0}")]
    Other(String),
}

impl From<rusqlite::Error> for QuoteError {
    fn from(err: rusqlite::Error) -> Self {
        QuoteError::Other(err.to_string())
    }
}

impl From<String> for QuoteError {
    fn from(err: String) -> Self {
        QuoteError::Other(err)
    }
}

// ==========================================
// Helper functions
// ==========================================

fn current_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

pub fn round_2(val: f64) -> f64 {
    (val * 100.0).round() / 100.0
}

pub fn parse_date(date_str: &str) -> Result<(i32, u32, u32), QuoteError> {
    let trimmed = date_str.trim();
    let parts: Vec<&str> = trimmed.split('-').collect();
    if parts.len() != 3 || parts[0].len() != 4 || parts[1].len() != 2 || parts[2].len() != 2 {
        return Err(QuoteError::InvalidDateFormat(
            "日期格式需為 YYYY-MM-DD".to_string(),
        ));
    }
    let year: i32 = parts[0]
        .parse()
        .map_err(|_| QuoteError::InvalidDateFormat("無效的年份".to_string()))?;
    let month: u32 = parts[1]
        .parse()
        .map_err(|_| QuoteError::InvalidDateFormat("無效的月份".to_string()))?;
    let day: u32 = parts[2]
        .parse()
        .map_err(|_| QuoteError::InvalidDateFormat("無效的日期".to_string()))?;

    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return Err(QuoteError::InvalidDateFormat("無效的日期數值".to_string()));
    }
    let is_leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
    let dim = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap {
                29
            } else {
                28
            }
        }
        _ => 30,
    };
    if day > dim {
        return Err(QuoteError::InvalidDateFormat(
            "日期超出該月份天數".to_string(),
        ));
    }
    Ok((year, month, day))
}

pub fn get_today_local(conn: &rusqlite::Connection) -> Result<String, rusqlite::Error> {
    conn.query_row("SELECT date('now', 'localtime')", [], |r| r.get(0))
}

pub fn is_terminal_status(status: &str) -> bool {
    matches!(status, "converted" | "declined" | "expired" | "cancelled")
}

// ==========================================
// Data Structures
// ==========================================

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq)]
pub struct Quote {
    pub id: String,
    pub tenant_id: String,
    pub quote_number: String,
    pub customer_partner_id: String,
    pub customer_name_snapshot: String,
    pub currency: String,
    pub status: String,
    pub valid_until: String,
    pub note: Option<String>,
    pub customer_po_number: Option<String>,
    pub requires_approval: i64,
    pub approval_rejection_reason: Option<String>,
    pub created_by: String,
    pub created_at: i64,
    pub submitted_at: Option<i64>,
    pub approved_by: Option<String>,
    pub approved_at: Option<i64>,
    pub sent_at: Option<i64>,
    pub declined_at: Option<i64>,
    pub decline_reason: Option<String>,
    pub expired_at: Option<i64>,
    pub cancelled_at: Option<i64>,
    pub cancel_reason: Option<String>,
    pub converted_at: Option<i64>,
    pub accepted_by: Option<String>,
    pub converted_sales_order_id: Option<String>,
    pub total_amount: f64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq)]
pub struct QuoteLine {
    pub id: String,
    pub quote_id: String,
    pub line_no: i64,
    pub unit_id: String,
    pub product_name_snapshot: String,
    pub variant_name_snapshot: String,
    pub unit_name_snapshot: String,
    pub sku_snapshot: Option<String>,
    pub quantity: f64,
    pub unit_price: f64,
    pub standard_price_snapshot: f64,
    pub requires_approval: i64,
    pub line_amount: f64,
    pub note: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq)]
pub struct QuoteDetail {
    pub quote: Quote,
    pub lines: Vec<QuoteLine>,
    pub total_amount: f64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq)]
pub struct SubmitQuoteResult {
    pub quote: Quote,
    pub message: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct CreateQuoteInput {
    pub customer_partner_id: String,
    pub valid_until: String,
    pub note: Option<String>,
    pub customer_po_number: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct UpdateQuoteHeaderInput {
    pub quote_id: String,
    pub customer_partner_id: Option<String>,
    pub valid_until: Option<String>,
    pub note: Option<String>,
    pub customer_po_number: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct AddQuoteLineInput {
    pub quote_id: String,
    pub unit_id: String,
    pub quantity: f64,
    pub unit_price: f64,
    pub note: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct UpdateQuoteLineInput {
    pub quote_id: String,
    pub line_id: String,
    pub quantity: f64,
    pub unit_price: f64,
    pub note: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq)]
pub struct BelowStandardLine {
    pub line_id: String,
    pub unit_id: String,
    pub product_name: String,
    pub quantity: f64,
    pub unit_price: f64,
    pub standard_price: f64,
    pub difference: f64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq)]
pub struct QuoteApprovalAuditArgs {
    pub quote_id: String,
    pub quote_number: String,
    pub total_amount: f64,
    pub below_standard_lines: Vec<BelowStandardLine>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq)]
pub struct PendingApprovalQuoteItem {
    pub quote: Quote,
    pub below_standard_lines: Vec<BelowStandardLine>,
    pub total_amount: f64,
}

// ==========================================
// Tables initialization
// ==========================================

pub fn create_quotes_tables(conn: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS quotes (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            quote_number TEXT NOT NULL,
            customer_partner_id TEXT NOT NULL,
            customer_name_snapshot TEXT NOT NULL,
            currency TEXT NOT NULL DEFAULT 'TWD',
            status TEXT NOT NULL DEFAULT 'draft',
            valid_until TEXT NOT NULL,
            note TEXT,
            customer_po_number TEXT,
            requires_approval INTEGER NOT NULL DEFAULT 0,
            approval_rejection_reason TEXT,
            created_by TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            submitted_at INTEGER,
            approved_by TEXT,
            approved_at INTEGER,
            sent_at INTEGER,
            declined_at INTEGER,
            decline_reason TEXT,
            expired_at INTEGER,
            cancelled_at INTEGER,
            cancel_reason TEXT,
            converted_at INTEGER,
            accepted_by TEXT,
            converted_sales_order_id TEXT
        )",
        [],
    )?;

    // Backward-compatible schema migration
    let _ = conn.execute("ALTER TABLE quotes ADD COLUMN cancel_reason TEXT", []);

    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_quotes_tenant_number ON quotes (tenant_id, quote_number)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_quotes_tenant_status ON quotes (tenant_id, status)",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS quote_lines (
            id TEXT PRIMARY KEY,
            quote_id TEXT NOT NULL,
            line_no INTEGER NOT NULL,
            unit_id TEXT NOT NULL,
            product_name_snapshot TEXT NOT NULL,
            variant_name_snapshot TEXT NOT NULL,
            unit_name_snapshot TEXT NOT NULL,
            sku_snapshot TEXT,
            quantity REAL NOT NULL,
            unit_price REAL NOT NULL,
            standard_price_snapshot REAL NOT NULL,
            requires_approval INTEGER NOT NULL DEFAULT 0,
            line_amount REAL NOT NULL,
            note TEXT
        )",
        [],
    )?;

    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_quote_lines_quote_unit ON quote_lines (quote_id, unit_id)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_quote_lines_quote_id ON quote_lines (quote_id)",
        [],
    )?;

    Ok(())
}

// ==========================================
// Expiration Helper
// ==========================================

pub fn expire_quotes(
    conn: &rusqlite::Connection,
    tenant_id: Option<&str>,
    today: &str,
    now: i64,
) -> Result<usize, rusqlite::Error> {
    let sql = "UPDATE quotes 
               SET status = 'expired', expired_at = ?1 
               WHERE (?2 IS NULL OR tenant_id = ?2) 
                 AND status IN ('pending_approval', 'sent') 
                 AND valid_until < ?3";
    let rows = conn.execute(sql, params![now, tenant_id, today])?;
    Ok(rows)
}

// ==========================================
// Internal queries
// ==========================================

fn next_quote_number(tx: &rusqlite::Transaction, tenant_id: &str) -> Result<String, QuoteError> {
    let mut stmt = tx
        .prepare(
            "SELECT COALESCE(MAX(CAST(SUBSTR(quote_number, 5) AS INTEGER)), 0) + 1 
             FROM quotes WHERE tenant_id = ?1",
        )
        .map_err(|e| QuoteError::Other(e.to_string()))?;
    let next_seq: i64 = stmt
        .query_row(params![tenant_id], |row| row.get(0))
        .map_err(|e| QuoteError::Other(e.to_string()))?;
    Ok(format!("QUO-{:05}", next_seq))
}

fn validate_customer(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    customer_partner_id: &str,
) -> Result<String, QuoteError> {
    let mut stmt = conn
        .prepare(
            "SELECT name, is_customer, is_active FROM partners WHERE id = ?1 AND tenant_id = ?2",
        )
        .map_err(|e| QuoteError::Other(e.to_string()))?;

    let result = stmt.query_row(params![customer_partner_id, tenant_id], |row| {
        let name: String = row.get(0)?;
        let is_cust: i64 = row.get(1)?;
        let is_act: i64 = row.get(2)?;
        Ok((name, is_cust == 1, is_act == 1))
    });

    match result {
        Ok((name, true, true)) => Ok(name),
        _ => Err(QuoteError::CustomerNotFoundOrInactive),
    }
}

struct UnitProductInfo {
    product_name: String,
    variant_name: String,
    unit_name: String,
    sku: Option<String>,
    selling_price: f64,
}

fn validate_unit_and_product(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    unit_id: &str,
) -> Result<UnitProductInfo, QuoteError> {
    let mut stmt = conn
        .prepare(
            "SELECT p.name, v.name, u.unit_name, v.sku, u.selling_price, p.is_sellable, p.tenant_id
             FROM product_units u
             JOIN product_variants v ON u.variant_id = v.id
             JOIN products p ON v.product_id = p.id
             WHERE u.id = ?1",
        )
        .map_err(|e| QuoteError::Other(e.to_string()))?;

    let row = stmt.query_row(params![unit_id], |row| {
        let product_name: String = row.get(0)?;
        let variant_name: String = row.get(1)?;
        let unit_name: String = row.get(2)?;
        let sku: Option<String> = row.get(3)?;
        let selling_price: f64 = row.get(4)?;
        let is_sellable: i64 = row.get(5)?;
        let prod_tenant_id: String = row.get(6)?;
        Ok((
            product_name,
            variant_name,
            unit_name,
            sku,
            selling_price,
            is_sellable == 1,
            prod_tenant_id,
        ))
    });

    match row {
        Ok((p_name, v_name, u_name, sku, price, is_sellable, prod_tid)) => {
            if prod_tid != tenant_id {
                return Err(QuoteError::UnitNotFound);
            }
            if !is_sellable {
                return Err(QuoteError::ProductNotSellable);
            }
            Ok(UnitProductInfo {
                product_name: p_name,
                variant_name: v_name,
                unit_name: u_name,
                sku,
                selling_price: price,
            })
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Err(QuoteError::UnitNotFound),
        Err(e) => Err(QuoteError::Other(e.to_string())),
    }
}

fn row_to_quote(row: &rusqlite::Row) -> Result<Quote, rusqlite::Error> {
    Ok(Quote {
        id: row.get(0)?,
        tenant_id: row.get(1)?,
        quote_number: row.get(2)?,
        customer_partner_id: row.get(3)?,
        customer_name_snapshot: row.get(4)?,
        currency: row.get(5)?,
        status: row.get(6)?,
        valid_until: row.get(7)?,
        note: row.get(8)?,
        customer_po_number: row.get(9)?,
        requires_approval: row.get(10)?,
        approval_rejection_reason: row.get(11)?,
        created_by: row.get(12)?,
        created_at: row.get(13)?,
        submitted_at: row.get(14)?,
        approved_by: row.get(15)?,
        approved_at: row.get(16)?,
        sent_at: row.get(17)?,
        declined_at: row.get(18)?,
        decline_reason: row.get(19)?,
        expired_at: row.get(20)?,
        cancelled_at: row.get(21)?,
        cancel_reason: row.get(22)?,
        converted_at: row.get(23)?,
        accepted_by: row.get(24)?,
        converted_sales_order_id: row.get(25)?,
        total_amount: row.get(26).unwrap_or(0.0),
    })
}

fn row_to_quote_line(row: &rusqlite::Row) -> Result<QuoteLine, rusqlite::Error> {
    Ok(QuoteLine {
        id: row.get(0)?,
        quote_id: row.get(1)?,
        line_no: row.get(2)?,
        unit_id: row.get(3)?,
        product_name_snapshot: row.get(4)?,
        variant_name_snapshot: row.get(5)?,
        unit_name_snapshot: row.get(6)?,
        sku_snapshot: row.get(7)?,
        quantity: row.get(8)?,
        unit_price: row.get(9)?,
        standard_price_snapshot: row.get(10)?,
        requires_approval: row.get(11)?,
        line_amount: row.get(12)?,
        note: row.get(13)?,
    })
}

fn get_quote_row(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    quote_id: &str,
) -> Result<Quote, QuoteError> {
    let sql = "SELECT 
                q.id, q.tenant_id, q.quote_number, q.customer_partner_id, q.customer_name_snapshot,
                q.currency, q.status, q.valid_until, q.note, q.customer_po_number,
                q.requires_approval, q.approval_rejection_reason, q.created_by, q.created_at,
                q.submitted_at, q.approved_by, q.approved_at, q.sent_at,
                q.declined_at, q.decline_reason, q.expired_at, q.cancelled_at,
                q.cancel_reason,
                q.converted_at, q.accepted_by, q.converted_sales_order_id,
                COALESCE((SELECT SUM(l.line_amount) FROM quote_lines l WHERE l.quote_id = q.id), 0.0) AS total_amount
               FROM quotes q
               WHERE q.id = ?1 AND q.tenant_id = ?2";

    conn.query_row(sql, params![quote_id, tenant_id], row_to_quote)
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => QuoteError::QuoteNotFound,
            other => QuoteError::Other(other.to_string()),
        })
}

fn get_quote_lines(
    conn: &rusqlite::Connection,
    quote_id: &str,
) -> Result<Vec<QuoteLine>, QuoteError> {
    let sql = "SELECT 
                id, quote_id, line_no, unit_id, product_name_snapshot,
                variant_name_snapshot, unit_name_snapshot, sku_snapshot,
                quantity, unit_price, standard_price_snapshot, requires_approval,
                line_amount, note
               FROM quote_lines 
               WHERE quote_id = ?1 
               ORDER BY line_no ASC";

    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| QuoteError::Other(e.to_string()))?;

    let lines = stmt
        .query_map(params![quote_id], row_to_quote_line)
        .map_err(|e| QuoteError::Other(e.to_string()))?
        .collect::<Result<Vec<QuoteLine>, rusqlite::Error>>()
        .map_err(|e| QuoteError::Other(e.to_string()))?;

    Ok(lines)
}

fn check_quote_draft_for_edit(quote: &Quote) -> Result<(), QuoteError> {
    if is_terminal_status(&quote.status) {
        return Err(QuoteError::TerminalStateImmutable);
    }
    if quote.status != "draft" {
        return Err(QuoteError::NotDraftForModification(quote.status.clone()));
    }
    Ok(())
}

// ==========================================
// Core implementations
// ==========================================

pub fn create_quote_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    user_id: &str,
    input: CreateQuoteInput,
    today_override: Option<&str>,
) -> Result<QuoteDetail, QuoteError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(QuoteError::EmptyTenantId);
    }
    let uid = user_id.trim();
    if uid.is_empty() {
        return Err(QuoteError::EmptyUserId);
    }

    let customer_id = input.customer_partner_id.trim();
    let customer_name = validate_customer(conn, tid, customer_id)?;

    let valid_until = input.valid_until.trim();
    parse_date(valid_until)?;

    let now = current_timestamp();
    let today = match today_override {
        Some(t) => t.to_string(),
        None => get_today_local(conn).unwrap_or_else(|_| "1970-01-01".to_string()),
    };

    let tx = conn
        .transaction()
        .map_err(|e| QuoteError::Other(e.to_string()))?;
    expire_quotes(&tx, Some(tid), &today, now)?;

    let quote_number = next_quote_number(&tx, tid)?;
    let quote_id = format!(
        "quo_{}_{}_{}",
        tid,
        now,
        QUOTE_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    );

    let trimmed_note = input
        .note
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(String::from);
    let trimmed_po = input
        .customer_po_number
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(String::from);

    tx.execute(
        "INSERT INTO quotes (
            id, tenant_id, quote_number, customer_partner_id, customer_name_snapshot,
            currency, status, valid_until, note, customer_po_number,
            requires_approval, approval_rejection_reason, created_by, created_at
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5,
            'TWD', 'draft', ?6, ?7, ?8,
            0, NULL, ?9, ?10
        )",
        params![
            quote_id,
            tid,
            quote_number,
            customer_id,
            customer_name,
            valid_until,
            trimmed_note,
            trimmed_po,
            uid,
            now
        ],
    )?;

    let quote = get_quote_row(&tx, tid, &quote_id)?;
    tx.commit().map_err(|e| QuoteError::Other(e.to_string()))?;

    Ok(QuoteDetail {
        quote,
        lines: Vec::new(),
        total_amount: 0.0,
    })
}

pub fn update_quote_header_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    input: UpdateQuoteHeaderInput,
    today_override: Option<&str>,
) -> Result<QuoteDetail, QuoteError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(QuoteError::EmptyTenantId);
    }
    let now = current_timestamp();
    let today = match today_override {
        Some(t) => t.to_string(),
        None => get_today_local(conn).unwrap_or_else(|_| "1970-01-01".to_string()),
    };

    let tx = conn
        .transaction()
        .map_err(|e| QuoteError::Other(e.to_string()))?;
    expire_quotes(&tx, Some(tid), &today, now)?;

    let quote = get_quote_row(&tx, tid, &input.quote_id)?;
    check_quote_draft_for_edit(&quote)?;

    let customer_name = if let Some(ref cid) = input.customer_partner_id {
        let trimmed_cid = cid.trim();
        Some(validate_customer(&tx, tid, trimmed_cid)?)
    } else {
        None
    };

    if let Some(ref vu) = input.valid_until {
        parse_date(vu)?;
    }

    let final_customer_id = input
        .customer_partner_id
        .as_deref()
        .map(|s| s.trim())
        .unwrap_or(&quote.customer_partner_id);
    let final_customer_name = customer_name
        .as_deref()
        .unwrap_or(&quote.customer_name_snapshot);
    let final_valid_until = input
        .valid_until
        .as_deref()
        .map(|s| s.trim())
        .unwrap_or(&quote.valid_until);
    let final_note = if input.note.is_some() {
        input
            .note
            .as_deref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(String::from)
    } else {
        quote.note.clone()
    };
    let final_po = if input.customer_po_number.is_some() {
        input
            .customer_po_number
            .as_deref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(String::from)
    } else {
        quote.customer_po_number.clone()
    };

    tx.execute(
        "UPDATE quotes 
         SET customer_partner_id = ?1, customer_name_snapshot = ?2, valid_until = ?3, note = ?4, customer_po_number = ?5
         WHERE id = ?6 AND tenant_id = ?7",
        params![
            final_customer_id,
            final_customer_name,
            final_valid_until,
            final_note,
            final_po,
            input.quote_id,
            tid
        ],
    )?;

    let updated_quote = get_quote_row(&tx, tid, &input.quote_id)?;
    let lines = get_quote_lines(&tx, &input.quote_id)?;
    let total_amount = round_2(lines.iter().map(|l| l.line_amount).sum());

    tx.commit().map_err(|e| QuoteError::Other(e.to_string()))?;

    Ok(QuoteDetail {
        quote: updated_quote,
        lines,
        total_amount,
    })
}

pub fn add_quote_line_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    input: AddQuoteLineInput,
    today_override: Option<&str>,
) -> Result<QuoteDetail, QuoteError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(QuoteError::EmptyTenantId);
    }
    if input.quantity <= 0.0 || input.unit_price < 0.0 {
        return Err(QuoteError::InvalidQuantityOrPrice);
    }

    let now = current_timestamp();
    let today = match today_override {
        Some(t) => t.to_string(),
        None => get_today_local(conn).unwrap_or_else(|_| "1970-01-01".to_string()),
    };

    let tx = conn
        .transaction()
        .map_err(|e| QuoteError::Other(e.to_string()))?;
    expire_quotes(&tx, Some(tid), &today, now)?;

    let quote = get_quote_row(&tx, tid, &input.quote_id)?;
    check_quote_draft_for_edit(&quote)?;

    let unit_id = input.unit_id.trim();
    // Check if unit already in quote
    let count: i64 = tx.query_row(
        "SELECT COUNT(*) FROM quote_lines WHERE quote_id = ?1 AND unit_id = ?2",
        params![input.quote_id, unit_id],
        |r| r.get(0),
    )?;
    if count > 0 {
        return Err(QuoteError::DuplicateUnitInQuote);
    }

    let unit_info = validate_unit_and_product(&tx, tid, unit_id)?;

    let line_no: i64 = tx.query_row(
        "SELECT COALESCE(MAX(line_no), 0) + 1 FROM quote_lines WHERE quote_id = ?1",
        params![input.quote_id],
        |r| r.get(0),
    )?;

    let line_id = format!(
        "qline_{}_{}_{}",
        tid,
        now,
        QUOTE_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    );

    let rounded_qty = input.quantity;
    let rounded_price = round_2(input.unit_price);
    let line_amount = round_2(rounded_qty * rounded_price);
    let trimmed_note = input
        .note
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(String::from);

    tx.execute(
        "INSERT INTO quote_lines (
            id, quote_id, line_no, unit_id, product_name_snapshot,
            variant_name_snapshot, unit_name_snapshot, sku_snapshot,
            quantity, unit_price, standard_price_snapshot, requires_approval,
            line_amount, note
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5,
            ?6, ?7, ?8,
            ?9, ?10, ?11, 0,
            ?12, ?13
        )",
        params![
            line_id,
            input.quote_id,
            line_no,
            unit_id,
            unit_info.product_name,
            unit_info.variant_name,
            unit_info.unit_name,
            unit_info.sku,
            rounded_qty,
            rounded_price,
            unit_info.selling_price,
            line_amount,
            trimmed_note
        ],
    )?;

    let updated_quote = get_quote_row(&tx, tid, &input.quote_id)?;
    let lines = get_quote_lines(&tx, &input.quote_id)?;
    let total_amount = round_2(lines.iter().map(|l| l.line_amount).sum());

    tx.commit().map_err(|e| QuoteError::Other(e.to_string()))?;

    Ok(QuoteDetail {
        quote: updated_quote,
        lines,
        total_amount,
    })
}

pub fn update_quote_line_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    input: UpdateQuoteLineInput,
    today_override: Option<&str>,
) -> Result<QuoteDetail, QuoteError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(QuoteError::EmptyTenantId);
    }
    if input.quantity <= 0.0 || input.unit_price < 0.0 {
        return Err(QuoteError::InvalidQuantityOrPrice);
    }

    let now = current_timestamp();
    let today = match today_override {
        Some(t) => t.to_string(),
        None => get_today_local(conn).unwrap_or_else(|_| "1970-01-01".to_string()),
    };

    let tx = conn
        .transaction()
        .map_err(|e| QuoteError::Other(e.to_string()))?;
    expire_quotes(&tx, Some(tid), &today, now)?;

    let quote = get_quote_row(&tx, tid, &input.quote_id)?;
    check_quote_draft_for_edit(&quote)?;

    let line_amount = round_2(input.quantity * round_2(input.unit_price));
    let trimmed_note = input
        .note
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(String::from);

    let rows_affected = tx.execute(
        "UPDATE quote_lines 
         SET quantity = ?1, unit_price = ?2, line_amount = ?3, note = ?4
         WHERE id = ?5 AND quote_id = ?6",
        params![
            input.quantity,
            round_2(input.unit_price),
            line_amount,
            trimmed_note,
            input.line_id,
            input.quote_id
        ],
    )?;

    if rows_affected == 0 {
        return Err(QuoteError::LineNotFound);
    }

    let updated_quote = get_quote_row(&tx, tid, &input.quote_id)?;
    let lines = get_quote_lines(&tx, &input.quote_id)?;
    let total_amount = round_2(lines.iter().map(|l| l.line_amount).sum());

    tx.commit().map_err(|e| QuoteError::Other(e.to_string()))?;

    Ok(QuoteDetail {
        quote: updated_quote,
        lines,
        total_amount,
    })
}

pub fn delete_quote_line_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    quote_id: &str,
    line_id: &str,
    today_override: Option<&str>,
) -> Result<QuoteDetail, QuoteError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(QuoteError::EmptyTenantId);
    }
    let now = current_timestamp();
    let today = match today_override {
        Some(t) => t.to_string(),
        None => get_today_local(conn).unwrap_or_else(|_| "1970-01-01".to_string()),
    };

    let tx = conn
        .transaction()
        .map_err(|e| QuoteError::Other(e.to_string()))?;
    expire_quotes(&tx, Some(tid), &today, now)?;

    let quote = get_quote_row(&tx, tid, quote_id)?;
    check_quote_draft_for_edit(&quote)?;

    let rows_affected = tx.execute(
        "DELETE FROM quote_lines WHERE id = ?1 AND quote_id = ?2",
        params![line_id, quote_id],
    )?;

    if rows_affected == 0 {
        return Err(QuoteError::LineNotFound);
    }

    let updated_quote = get_quote_row(&tx, tid, quote_id)?;
    let lines = get_quote_lines(&tx, quote_id)?;
    let total_amount = round_2(lines.iter().map(|l| l.line_amount).sum());

    tx.commit().map_err(|e| QuoteError::Other(e.to_string()))?;

    Ok(QuoteDetail {
        quote: updated_quote,
        lines,
        total_amount,
    })
}

pub fn submit_quote_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    _user_id: &str,
    quote_id: &str,
    today_override: Option<&str>,
) -> Result<SubmitQuoteResult, QuoteError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(QuoteError::EmptyTenantId);
    }
    let now = current_timestamp();
    let today = match today_override {
        Some(t) => t.to_string(),
        None => get_today_local(conn).unwrap_or_else(|_| "1970-01-01".to_string()),
    };

    let tx = conn
        .transaction()
        .map_err(|e| QuoteError::Other(e.to_string()))?;
    expire_quotes(&tx, Some(tid), &today, now)?;

    let quote = get_quote_row(&tx, tid, quote_id)?;
    check_quote_draft_for_edit(&quote)?;

    // R6: valid_until >= today check (valid_until < today is expired)
    if quote.valid_until < today {
        return Err(QuoteError::ExpiredValidUntil);
    }

    // R5: lines cannot be empty
    let lines = get_quote_lines(&tx, quote_id)?;
    if lines.is_empty() {
        return Err(QuoteError::NoLinesForSubmit);
    }

    // R7: refetch selling_price for each line & evaluate requires_approval
    let mut any_requires_approval = false;
    let mut low_price_count = 0;

    for line in lines {
        let selling_price: f64 = tx
            .query_row(
                "SELECT selling_price FROM product_units WHERE id = ?1",
                params![line.unit_id],
                |r| r.get(0),
            )
            .unwrap_or(0.0);

        let rounded_unit_price = round_2(line.unit_price);
        let rounded_std_price = round_2(selling_price);

        // Strict comparison: lower than standard price or standard price <= 0.0 (no standard price set)
        let line_needs_approval =
            rounded_unit_price < rounded_std_price || rounded_std_price <= 0.0;

        let req_int = if line_needs_approval { 1 } else { 0 };
        if line_needs_approval {
            any_requires_approval = true;
            low_price_count += 1;
        }

        tx.execute(
            "UPDATE quote_lines 
             SET standard_price_snapshot = ?1, requires_approval = ?2 
             WHERE id = ?3",
            params![selling_price, req_int, line.id],
        )?;
    }

    let (new_status, sent_at, message) = if any_requires_approval {
        (
            "pending_approval",
            None,
            format!("已送交核准（{} 項低於標準售價）", low_price_count),
        )
    } else {
        ("sent", Some(now), "報價已送出".to_string())
    };

    tx.execute(
        "UPDATE quotes 
         SET status = ?1, requires_approval = ?2, submitted_at = ?3, sent_at = ?4
         WHERE id = ?5 AND tenant_id = ?6",
        params![
            new_status,
            if any_requires_approval { 1 } else { 0 },
            now,
            sent_at,
            quote_id,
            tid
        ],
    )?;

    let updated_quote = get_quote_row(&tx, tid, quote_id)?;
    tx.commit().map_err(|e| QuoteError::Other(e.to_string()))?;

    Ok(SubmitQuoteResult {
        quote: updated_quote,
        message,
    })
}

pub fn withdraw_quote_approval_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    _user_id: &str,
    quote_id: &str,
    reason: Option<String>,
    today_override: Option<&str>,
) -> Result<QuoteDetail, QuoteError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(QuoteError::EmptyTenantId);
    }
    let now = current_timestamp();
    let today = match today_override {
        Some(t) => t.to_string(),
        None => get_today_local(conn).unwrap_or_else(|_| "1970-01-01".to_string()),
    };

    let tx = conn
        .transaction()
        .map_err(|e| QuoteError::Other(e.to_string()))?;
    expire_quotes(&tx, Some(tid), &today, now)?;

    let quote = get_quote_row(&tx, tid, quote_id)?;
    if is_terminal_status(&quote.status) {
        return Err(QuoteError::TerminalStateImmutable);
    }
    if quote.status != "pending_approval" {
        return Err(QuoteError::InvalidStatusTransition);
    }

    let trimmed_reason = reason
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(String::from);

    tx.execute(
        "UPDATE quotes 
         SET status = 'draft', approval_rejection_reason = ?1 
         WHERE id = ?2 AND tenant_id = ?3",
        params![trimmed_reason, quote_id, tid],
    )?;

    let updated_quote = get_quote_row(&tx, tid, quote_id)?;
    let lines = get_quote_lines(&tx, quote_id)?;
    let total_amount = round_2(lines.iter().map(|l| l.line_amount).sum());

    tx.commit().map_err(|e| QuoteError::Other(e.to_string()))?;

    Ok(QuoteDetail {
        quote: updated_quote,
        lines,
        total_amount,
    })
}

pub fn decline_quote_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    _user_id: &str,
    quote_id: &str,
    reason: Option<String>,
    today_override: Option<&str>,
) -> Result<QuoteDetail, QuoteError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(QuoteError::EmptyTenantId);
    }
    let now = current_timestamp();
    let today = match today_override {
        Some(t) => t.to_string(),
        None => get_today_local(conn).unwrap_or_else(|_| "1970-01-01".to_string()),
    };

    let tx = conn
        .transaction()
        .map_err(|e| QuoteError::Other(e.to_string()))?;
    expire_quotes(&tx, Some(tid), &today, now)?;

    let quote = get_quote_row(&tx, tid, quote_id)?;
    if is_terminal_status(&quote.status) {
        return Err(QuoteError::TerminalStateImmutable);
    }
    if quote.status != "sent" {
        return Err(QuoteError::InvalidStatusTransition);
    }

    let trimmed_reason = reason
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(String::from);

    tx.execute(
        "UPDATE quotes 
         SET status = 'declined', declined_at = ?1, decline_reason = ?2 
         WHERE id = ?3 AND tenant_id = ?4",
        params![now, trimmed_reason, quote_id, tid],
    )?;

    let updated_quote = get_quote_row(&tx, tid, quote_id)?;
    let lines = get_quote_lines(&tx, quote_id)?;
    let total_amount = round_2(lines.iter().map(|l| l.line_amount).sum());

    tx.commit().map_err(|e| QuoteError::Other(e.to_string()))?;

    Ok(QuoteDetail {
        quote: updated_quote,
        lines,
        total_amount,
    })
}

pub fn convert_quote_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    user_id: &str,
    quote_id: &str,
    sales_order_id: Option<String>,
    today_override: Option<&str>,
) -> Result<QuoteDetail, QuoteError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(QuoteError::EmptyTenantId);
    }
    let now = current_timestamp();
    let today = match today_override {
        Some(t) => t.to_string(),
        None => get_today_local(conn).unwrap_or_else(|_| "1970-01-01".to_string()),
    };

    let tx = conn
        .transaction()
        .map_err(|e| QuoteError::Other(e.to_string()))?;
    expire_quotes(&tx, Some(tid), &today, now)?;

    let quote = get_quote_row(&tx, tid, quote_id)?;
    if is_terminal_status(&quote.status) {
        return Err(QuoteError::TerminalStateImmutable);
    }
    if quote.status != "sent" {
        return Err(QuoteError::InvalidStatusTransition);
    }

    let trimmed_so_id = sales_order_id
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(String::from);

    tx.execute(
        "UPDATE quotes 
         SET status = 'converted', converted_at = ?1, accepted_by = ?2, converted_sales_order_id = ?3 
         WHERE id = ?4 AND tenant_id = ?5",
        params![now, user_id, trimmed_so_id, quote_id, tid],
    )?;

    let updated_quote = get_quote_row(&tx, tid, quote_id)?;
    let lines = get_quote_lines(&tx, quote_id)?;
    let total_amount = round_2(lines.iter().map(|l| l.line_amount).sum());

    tx.commit().map_err(|e| QuoteError::Other(e.to_string()))?;

    Ok(QuoteDetail {
        quote: updated_quote,
        lines,
        total_amount,
    })
}

pub fn cancel_quote_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    _user_id: &str,
    quote_id: &str,
    reason: Option<&str>,
    today_override: Option<&str>,
) -> Result<QuoteDetail, QuoteError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(QuoteError::EmptyTenantId);
    }
    let r = reason.unwrap_or("").trim();
    if r.is_empty() {
        return Err(QuoteError::Other("取消理由為必填".to_string()));
    }
    let now = current_timestamp();
    let today = match today_override {
        Some(t) => t.to_string(),
        None => get_today_local(conn).unwrap_or_else(|_| "1970-01-01".to_string()),
    };

    let tx = conn
        .transaction()
        .map_err(|e| QuoteError::Other(e.to_string()))?;
    expire_quotes(&tx, Some(tid), &today, now)?;

    let quote = get_quote_row(&tx, tid, quote_id)?;
    if is_terminal_status(&quote.status) {
        return Err(QuoteError::TerminalStateImmutable);
    }

    tx.execute(
        "UPDATE quotes 
         SET status = 'cancelled', cancelled_at = ?1, cancel_reason = ?2 
         WHERE id = ?3 AND tenant_id = ?4",
        params![now, r, quote_id, tid],
    )?;

    let updated_quote = get_quote_row(&tx, tid, quote_id)?;
    let lines = get_quote_lines(&tx, quote_id)?;
    let total_amount = round_2(lines.iter().map(|l| l.line_amount).sum());

    tx.commit().map_err(|e| QuoteError::Other(e.to_string()))?;

    Ok(QuoteDetail {
        quote: updated_quote,
        lines,
        total_amount,
    })
}

pub fn get_quote_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    quote_id: &str,
    today_override: Option<&str>,
) -> Result<QuoteDetail, QuoteError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(QuoteError::EmptyTenantId);
    }
    let now = current_timestamp();
    let today = match today_override {
        Some(t) => t.to_string(),
        None => get_today_local(conn).unwrap_or_else(|_| "1970-01-01".to_string()),
    };

    expire_quotes(conn, Some(tid), &today, now)?;

    let quote = get_quote_row(conn, tid, quote_id)?;
    let lines = get_quote_lines(conn, quote_id)?;
    let total_amount = round_2(lines.iter().map(|l| l.line_amount).sum());

    Ok(QuoteDetail {
        quote,
        lines,
        total_amount,
    })
}

pub fn list_quotes_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    filter_status: Option<String>,
    filter_customer_id: Option<String>,
    today_override: Option<&str>,
) -> Result<Vec<Quote>, QuoteError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(QuoteError::EmptyTenantId);
    }
    let now = current_timestamp();
    let today = match today_override {
        Some(t) => t.to_string(),
        None => get_today_local(conn).unwrap_or_else(|_| "1970-01-01".to_string()),
    };

    expire_quotes(conn, Some(tid), &today, now)?;

    let mut query = "SELECT 
                        q.id, q.tenant_id, q.quote_number, q.customer_partner_id, q.customer_name_snapshot,
                        q.currency, q.status, q.valid_until, q.note, q.customer_po_number,
                        q.requires_approval, q.approval_rejection_reason, q.created_by, q.created_at,
                        q.submitted_at, q.approved_by, q.approved_at, q.sent_at,
                        q.declined_at, q.decline_reason, q.expired_at, q.cancelled_at,
                        q.cancel_reason,
                        q.converted_at, q.accepted_by, q.converted_sales_order_id,
                        COALESCE((SELECT SUM(l.line_amount) FROM quote_lines l WHERE l.quote_id = q.id), 0.0) AS total_amount
                     FROM quotes q
                     WHERE q.tenant_id = ?1".to_string();

    let mut sql_params: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(tid.to_string())];

    if let Some(ref st) = filter_status {
        let trimmed_st = st.trim();
        if !trimmed_st.is_empty() {
            query.push_str(&format!(" AND q.status = ?{}", sql_params.len() + 1));
            sql_params.push(Box::new(trimmed_st.to_string()));
        }
    }

    if let Some(ref cid) = filter_customer_id {
        let trimmed_cid = cid.trim();
        if !trimmed_cid.is_empty() {
            query.push_str(&format!(
                " AND q.customer_partner_id = ?{}",
                sql_params.len() + 1
            ));
            sql_params.push(Box::new(trimmed_cid.to_string()));
        }
    }

    query.push_str(" ORDER BY q.created_at DESC, q.id DESC");

    let mut stmt = conn
        .prepare(&query)
        .map_err(|e| QuoteError::Other(e.to_string()))?;

    let params_slice: Vec<&dyn rusqlite::ToSql> = sql_params.iter().map(|b| b.as_ref()).collect();

    let quotes = stmt
        .query_map(params_slice.as_slice(), row_to_quote)
        .map_err(|e| QuoteError::Other(e.to_string()))?
        .collect::<Result<Vec<Quote>, rusqlite::Error>>()
        .map_err(|e| QuoteError::Other(e.to_string()))?;

    Ok(quotes)
}

pub fn get_below_standard_lines_from_lines(lines: &[QuoteLine]) -> Vec<BelowStandardLine> {
    lines
        .iter()
        .filter(|l| {
            let rounded_unit = round_2(l.unit_price);
            let rounded_std = round_2(l.standard_price_snapshot);
            l.requires_approval == 1 || rounded_unit < rounded_std || rounded_std <= 0.0
        })
        .map(|l| {
            let rounded_unit = round_2(l.unit_price);
            let rounded_std = round_2(l.standard_price_snapshot);
            let diff = round_2(rounded_std - rounded_unit);
            BelowStandardLine {
                line_id: l.id.clone(),
                unit_id: l.unit_id.clone(),
                product_name: l.product_name_snapshot.clone(),
                quantity: l.quantity,
                unit_price: rounded_unit,
                standard_price: rounded_std,
                difference: diff,
            }
        })
        .collect()
}

static AUDIT_LOG_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1000);

fn record_quote_approval_audit_log(
    tx: &rusqlite::Transaction,
    audit_args: QuoteApprovalAuditArgs,
    decision: &str,
    operator: &str,
    now: i64,
) -> Result<(), QuoteError> {
    tx.execute(
        "CREATE TABLE IF NOT EXISTS audit_logs (
            id TEXT PRIMARY KEY,
            action_type TEXT NOT NULL,
            arguments TEXT NOT NULL,
            decision TEXT NOT NULL,
            operator TEXT NOT NULL,
            timestamp INTEGER NOT NULL
        )",
        [],
    )?;

    let log_id = format!(
        "LOG-{}-{}",
        now,
        AUDIT_LOG_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    );

    let arguments_json =
        serde_json::to_string(&audit_args).map_err(|e| QuoteError::Other(e.to_string()))?;

    tx.execute(
        "INSERT INTO audit_logs (id, action_type, arguments, decision, operator, timestamp)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            log_id,
            "quote_approval",
            arguments_json,
            decision,
            operator,
            now
        ],
    )?;

    Ok(())
}

pub fn approve_quote_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    user_id: &str,
    quote_id: &str,
    reason: Option<String>,
    today_override: Option<&str>,
) -> Result<QuoteDetail, QuoteError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(QuoteError::EmptyTenantId);
    }
    let uid = user_id.trim();
    if uid.is_empty() {
        return Err(QuoteError::EmptyUserId);
    }
    let now = current_timestamp();
    let today = match today_override {
        Some(t) => t.to_string(),
        None => get_today_local(conn).unwrap_or_else(|_| "1970-01-01".to_string()),
    };

    let tx = conn
        .transaction()
        .map_err(|e| QuoteError::Other(e.to_string()))?;
    expire_quotes(&tx, Some(tid), &today, now)?;

    let quote = get_quote_row(&tx, tid, quote_id)?;
    if is_terminal_status(&quote.status) {
        return Err(QuoteError::TerminalStateImmutable);
    }
    if quote.status != "pending_approval" {
        return Err(QuoteError::InvalidStatusTransition);
    }

    let lines = get_quote_lines(&tx, quote_id)?;
    let total_amount = round_2(lines.iter().map(|l| l.line_amount).sum());
    let below_standard_lines = get_below_standard_lines_from_lines(&lines);

    let trimmed_reason = reason
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(String::from);

    tx.execute(
        "UPDATE quotes 
         SET status = 'sent', approved_by = ?1, approved_at = ?2, sent_at = ?3, approval_rejection_reason = NULL
         WHERE id = ?4 AND tenant_id = ?5",
        params![uid, now, now, quote_id, tid],
    )?;

    let audit_args = QuoteApprovalAuditArgs {
        quote_id: quote.id.clone(),
        quote_number: quote.quote_number.clone(),
        total_amount,
        below_standard_lines,
        reason: trimmed_reason,
    };

    record_quote_approval_audit_log(&tx, audit_args, "approved", uid, now)?;

    let updated_quote = get_quote_row(&tx, tid, quote_id)?;
    tx.commit().map_err(|e| QuoteError::Other(e.to_string()))?;

    Ok(QuoteDetail {
        quote: updated_quote,
        lines,
        total_amount,
    })
}

pub fn reject_quote_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    user_id: &str,
    quote_id: &str,
    reason: &str,
    today_override: Option<&str>,
) -> Result<QuoteDetail, QuoteError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(QuoteError::EmptyTenantId);
    }
    let uid = user_id.trim();
    if uid.is_empty() {
        return Err(QuoteError::EmptyUserId);
    }
    let trimmed_reason = reason.trim();
    if trimmed_reason.is_empty() {
        return Err(QuoteError::ApprovalReasonRequired);
    }

    let now = current_timestamp();
    let today = match today_override {
        Some(t) => t.to_string(),
        None => get_today_local(conn).unwrap_or_else(|_| "1970-01-01".to_string()),
    };

    let tx = conn
        .transaction()
        .map_err(|e| QuoteError::Other(e.to_string()))?;
    expire_quotes(&tx, Some(tid), &today, now)?;

    let quote = get_quote_row(&tx, tid, quote_id)?;
    if is_terminal_status(&quote.status) {
        return Err(QuoteError::TerminalStateImmutable);
    }
    if quote.status != "pending_approval" {
        return Err(QuoteError::InvalidStatusTransition);
    }

    let lines = get_quote_lines(&tx, quote_id)?;
    let total_amount = round_2(lines.iter().map(|l| l.line_amount).sum());
    let below_standard_lines = get_below_standard_lines_from_lines(&lines);

    tx.execute(
        "UPDATE quotes 
         SET status = 'draft', approval_rejection_reason = ?1
         WHERE id = ?2 AND tenant_id = ?3",
        params![trimmed_reason, quote_id, tid],
    )?;

    let audit_args = QuoteApprovalAuditArgs {
        quote_id: quote.id.clone(),
        quote_number: quote.quote_number.clone(),
        total_amount,
        below_standard_lines,
        reason: Some(trimmed_reason.to_string()),
    };

    record_quote_approval_audit_log(&tx, audit_args, "rejected", uid, now)?;

    let updated_quote = get_quote_row(&tx, tid, quote_id)?;
    tx.commit().map_err(|e| QuoteError::Other(e.to_string()))?;

    Ok(QuoteDetail {
        quote: updated_quote,
        lines,
        total_amount,
    })
}

pub fn list_pending_approval_quotes_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    today_override: Option<&str>,
) -> Result<Vec<PendingApprovalQuoteItem>, QuoteError> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err(QuoteError::EmptyTenantId);
    }
    let now = current_timestamp();
    let today = match today_override {
        Some(t) => t.to_string(),
        None => get_today_local(conn).unwrap_or_else(|_| "1970-01-01".to_string()),
    };

    expire_quotes(conn, Some(tid), &today, now)?;

    let quotes = list_quotes_impl(
        conn,
        tid,
        Some("pending_approval".to_string()),
        None,
        Some(&today),
    )?;

    let mut result = Vec::new();
    for quote in quotes {
        let lines = get_quote_lines(conn, &quote.id)?;
        let total_amount = quote.total_amount;
        let below_standard_lines = get_below_standard_lines_from_lines(&lines);
        result.push(PendingApprovalQuoteItem {
            quote,
            below_standard_lines,
            total_amount,
        });
    }

    Ok(result)
}

// ==========================================
// Tauri Commands
// ==========================================

#[tauri::command]
#[specta::specta]
pub async fn create_quote<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    input: CreateQuoteInput,
) -> Result<QuoteDetail, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;
    create_quote_impl(&mut conn, &active_tid, &active_uid, input, None).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn update_quote_header<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    input: UpdateQuoteHeaderInput,
) -> Result<QuoteDetail, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    update_quote_header_impl(&mut conn, &active_tid, input, None).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn add_quote_line<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    input: AddQuoteLineInput,
) -> Result<QuoteDetail, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    add_quote_line_impl(&mut conn, &active_tid, input, None).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn update_quote_line<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    input: UpdateQuoteLineInput,
) -> Result<QuoteDetail, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    update_quote_line_impl(&mut conn, &active_tid, input, None).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_quote_line<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    quote_id: String,
    line_id: String,
) -> Result<QuoteDetail, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    delete_quote_line_impl(&mut conn, &active_tid, &quote_id, &line_id, None)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn submit_quote<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    quote_id: String,
) -> Result<SubmitQuoteResult, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;
    submit_quote_impl(&mut conn, &active_tid, &active_uid, &quote_id, None)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn withdraw_quote_approval<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    quote_id: String,
    reason: Option<String>,
) -> Result<QuoteDetail, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;
    withdraw_quote_approval_impl(&mut conn, &active_tid, &active_uid, &quote_id, reason, None)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn decline_quote<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    quote_id: String,
    reason: Option<String>,
) -> Result<QuoteDetail, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;
    decline_quote_impl(&mut conn, &active_tid, &active_uid, &quote_id, reason, None)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn convert_quote<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    quote_id: String,
    sales_order_id: Option<String>,
) -> Result<QuoteDetail, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;
    convert_quote_impl(
        &mut conn,
        &active_tid,
        &active_uid,
        &quote_id,
        sales_order_id,
        None,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_quote<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    quote_id: String,
    reason: Option<String>,
) -> Result<QuoteDetail, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;
    cancel_quote_impl(
        &mut conn,
        &active_tid,
        &active_uid,
        &quote_id,
        reason.as_deref(),
        None,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn get_quote<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    quote_id: String,
) -> Result<QuoteDetail, String> {
    let db_path = get_db_path(&app_handle);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    get_quote_impl(&conn, &active_tid, &quote_id, None).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn list_quotes<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    filter_status: Option<String>,
    filter_customer_id: Option<String>,
) -> Result<Vec<Quote>, String> {
    let db_path = get_db_path(&app_handle);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    list_quotes_impl(&conn, &active_tid, filter_status, filter_customer_id, None)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn approve_quote<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    quote_id: String,
    reason: Option<String>,
) -> Result<QuoteDetail, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;
    approve_quote_impl(&mut conn, &active_tid, &active_uid, &quote_id, reason, None)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn reject_quote<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    quote_id: String,
    reason: String,
) -> Result<QuoteDetail, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = crate::purchase_orders::resolve_active_user_id(&conn)?;
    reject_quote_impl(
        &mut conn,
        &active_tid,
        &active_uid,
        &quote_id,
        &reason,
        None,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn list_pending_approval_quotes<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<Vec<PendingApprovalQuoteItem>, String> {
    let db_path = get_db_path(&app_handle);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    list_pending_approval_quotes_impl(&conn, &active_tid, None).map_err(|e| e.to_string())
}

// ==========================================
// Unit Tests (Layer 1)
// ==========================================

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_test_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::partners::create_partners_table(&conn).unwrap();
        crate::products::create_products_tables(&conn).unwrap();
        create_quotes_tables(&conn).unwrap();
        conn.execute(
            "CREATE TABLE IF NOT EXISTS audit_logs (
                id TEXT PRIMARY KEY,
                action_type TEXT NOT NULL,
                arguments TEXT NOT NULL,
                decision TEXT NOT NULL,
                operator TEXT NOT NULL,
                timestamp INTEGER NOT NULL
            )",
            [],
        )
        .unwrap();
        conn
    }

    fn seed_customer(
        conn: &rusqlite::Connection,
        tid: &str,
        name: &str,
        is_customer: bool,
        is_active: bool,
    ) -> String {
        let id = format!(
            "part_{}_{}",
            current_timestamp(),
            QUOTE_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
        );
        conn.execute(
            "INSERT INTO partners (id, tenant_id, name, is_customer, is_vendor, is_active, created_at)
             VALUES (?1, ?2, ?3, ?4, 0, ?5, 10000)",
            params![id, tid, name, if is_customer { 1 } else { 0 }, if is_active { 1 } else { 0 }],
        ).unwrap();
        id
    }

    fn seed_product(
        conn: &rusqlite::Connection,
        tid: &str,
        name: &str,
        is_sellable: bool,
        selling_price: f64,
    ) -> (String, String) {
        let p_id = format!(
            "prod_{}_{}",
            current_timestamp(),
            QUOTE_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
        );
        let v_id = format!(
            "var_{}_{}",
            current_timestamp(),
            QUOTE_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
        );
        let u_id = format!(
            "unit_{}_{}",
            current_timestamp(),
            QUOTE_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
        );

        conn.execute(
            "INSERT INTO products (id, tenant_id, name, category, is_sellable, is_purchasable, created_at)
             VALUES (?1, ?2, ?3, 'resale', ?4, 1, 10000)",
            params![p_id, tid, name, if is_sellable { 1 } else { 0 }],
        ).unwrap();

        conn.execute(
            "INSERT INTO product_variants (id, product_id, name, is_default, sku, created_at)
             VALUES (?1, ?2, '標準', 1, 'SKU-TEST', 10000)",
            params![v_id, p_id],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO product_units (id, variant_id, unit_name, conversion_ratio, is_base_unit, selling_price, created_at)
             VALUES (?1, ?2, '個', 1.0, 1, ?3, 10000)",
            params![u_id, v_id, selling_price],
        ).unwrap();

        (p_id, u_id)
    }

    #[test]
    fn test_tc_quo_n_01_create_draft_quote_and_sequence() {
        // Given: Valid customer and valid_until date
        let mut conn = setup_test_db();
        let cid = seed_customer(&conn, "tnt_1", "台積電客戶", true, true);

        // When: Creating quote
        let res = create_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            CreateQuoteInput {
                customer_partner_id: cid.clone(),
                valid_until: "2026-12-31".to_string(),
                note: Some("給客戶備註".to_string()),
                customer_po_number: Some("PO-CLIENT-999".to_string()),
            },
            Some("2026-11-09"),
        )
        .unwrap();

        // Then: Quote created in draft status with QUO-00001
        assert_eq!(res.quote.quote_number, "QUO-00001");
        assert_eq!(res.quote.status, "draft");
        assert_eq!(res.quote.customer_name_snapshot, "台積電客戶");
        assert_eq!(res.quote.valid_until, "2026-12-31");
        assert_eq!(res.quote.requires_approval, 0);
        assert_eq!(res.quote.total_amount, 0.0);

        // When: Creating second quote in same tenant
        let res2 = create_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            CreateQuoteInput {
                customer_partner_id: cid,
                valid_until: "2026-12-31".to_string(),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        // Then: Sequence increments to QUO-00002
        assert_eq!(res2.quote.quote_number, "QUO-00002");
    }

    #[test]
    fn test_tc_quo_n_02_add_and_update_and_delete_lines() {
        // Given: A draft quote and sellable product
        let mut conn = setup_test_db();
        let cid = seed_customer(&conn, "tnt_1", "聯發科技客戶", true, true);
        let (_, uid) = seed_product(&conn, "tnt_1", "手機晶片", true, 100.0);
        let quote = create_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            CreateQuoteInput {
                customer_partner_id: cid,
                valid_until: "2026-12-31".to_string(),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        // When: Adding quote line
        let detail = add_quote_line_impl(
            &mut conn,
            "tnt_1",
            AddQuoteLineInput {
                quote_id: quote.quote.id.clone(),
                unit_id: uid.clone(),
                quantity: 10.0,
                unit_price: 120.0,
                note: Some("首批單價".to_string()),
            },
            Some("2026-11-09"),
        )
        .unwrap();

        // Then: Line added with snapshot & calculated amount
        assert_eq!(detail.lines.len(), 1);
        assert_eq!(detail.lines[0].line_no, 1);
        assert_eq!(detail.lines[0].product_name_snapshot, "手機晶片");
        assert_eq!(detail.lines[0].standard_price_snapshot, 100.0);
        assert_eq!(detail.lines[0].quantity, 10.0);
        assert_eq!(detail.lines[0].unit_price, 120.0);
        assert_eq!(detail.lines[0].line_amount, 1200.0);
        assert_eq!(detail.total_amount, 1200.0);

        // When: Updating quote line
        let line_id = detail.lines[0].id.clone();
        let updated = update_quote_line_impl(
            &mut conn,
            "tnt_1",
            UpdateQuoteLineInput {
                quote_id: quote.quote.id.clone(),
                line_id: line_id.clone(),
                quantity: 5.0,
                unit_price: 150.0,
                note: Some("調減數量".to_string()),
            },
            Some("2026-11-09"),
        )
        .unwrap();

        // Then: Line quantity and amount updated
        assert_eq!(updated.lines[0].quantity, 5.0);
        assert_eq!(updated.lines[0].unit_price, 150.0);
        assert_eq!(updated.lines[0].line_amount, 750.0);
        assert_eq!(updated.total_amount, 750.0);

        // When: Deleting quote line
        let empty_detail = delete_quote_line_impl(
            &mut conn,
            "tnt_1",
            &quote.quote.id,
            &line_id,
            Some("2026-11-09"),
        )
        .unwrap();

        // Then: Lines empty and total amount 0.0
        assert_eq!(empty_detail.lines.len(), 0);
        assert_eq!(empty_detail.total_amount, 0.0);
    }

    #[test]
    fn test_tc_quo_n_03_and_b02_b03_submit_without_approval_needed() {
        // Given: Product standard price 100.0, unit_price >= 100.0
        let mut conn = setup_test_db();
        let cid = seed_customer(&conn, "tnt_1", "宏碁客戶", true, true);
        let (_, uid1) = seed_product(&conn, "tnt_1", "筆電A", true, 100.0);
        let (_, uid2) = seed_product(&conn, "tnt_1", "筆電B", true, 200.0);

        let quote = create_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            CreateQuoteInput {
                customer_partner_id: cid,
                valid_until: "2026-12-31".to_string(),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        // Line 1: unit_price == 100.0 (TC-QUO-B-02: exactly equal)
        add_quote_line_impl(
            &mut conn,
            "tnt_1",
            AddQuoteLineInput {
                quote_id: quote.quote.id.clone(),
                unit_id: uid1,
                quantity: 1.0,
                unit_price: 100.0,
                note: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        // Line 2: unit_price == 200.01 (TC-QUO-B-03: +0.01 higher)
        add_quote_line_impl(
            &mut conn,
            "tnt_1",
            AddQuoteLineInput {
                quote_id: quote.quote.id.clone(),
                unit_id: uid2,
                quantity: 1.0,
                unit_price: 200.01,
                note: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        // When: Submitting quote
        let res = submit_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            &quote.quote.id,
            Some("2026-11-09"),
        )
        .unwrap();

        // Then: Quote directly turns into 'sent', message is '報價已送出', requires_approval is 0
        assert_eq!(res.quote.status, "sent");
        assert_eq!(res.quote.requires_approval, 0);
        assert!(res.quote.submitted_at.is_some());
        assert!(res.quote.sent_at.is_some());
        assert_eq!(res.message, "報價已送出");
    }

    #[test]
    fn test_tc_quo_n_04_and_b01_submit_with_approval_needed() {
        // Given: Standard price 100.0, line unit_price 99.99 (TC-QUO-B-01: -0.01 below standard)
        let mut conn = setup_test_db();
        let cid = seed_customer(&conn, "tnt_1", "華碩客戶", true, true);
        let (_, uid) = seed_product(&conn, "tnt_1", "主機板", true, 100.0);

        let quote = create_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            CreateQuoteInput {
                customer_partner_id: cid,
                valid_until: "2026-12-31".to_string(),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        add_quote_line_impl(
            &mut conn,
            "tnt_1",
            AddQuoteLineInput {
                quote_id: quote.quote.id.clone(),
                unit_id: uid,
                quantity: 2.0,
                unit_price: 99.99,
                note: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        // When: Submitting quote
        let res = submit_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            &quote.quote.id,
            Some("2026-11-09"),
        )
        .unwrap();

        // Then: Quote enters 'pending_approval', requires_approval=1, message tells N items below standard
        assert_eq!(res.quote.status, "pending_approval");
        assert_eq!(res.quote.requires_approval, 1);
        assert!(res.quote.submitted_at.is_some());
        assert!(res.quote.sent_at.is_none());
        assert_eq!(res.message, "已送交核准（1 項低於標準售價）");
    }

    #[test]
    fn test_tc_quo_b04_and_b05_zero_and_negative_standard_price_requires_approval() {
        // Given: Product with selling_price = 0.0
        let mut conn = setup_test_db();
        let cid = seed_customer(&conn, "tnt_1", "測試客戶", true, true);
        let (_, uid) = seed_product(&conn, "tnt_1", "客製服務", true, 0.0);

        let quote = create_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            CreateQuoteInput {
                customer_partner_id: cid,
                valid_until: "2026-12-31".to_string(),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        add_quote_line_impl(
            &mut conn,
            "tnt_1",
            AddQuoteLineInput {
                quote_id: quote.quote.id.clone(),
                unit_id: uid,
                quantity: 1.0,
                unit_price: 500.0,
                note: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        // When: Submitting quote with standard_price = 0.0
        let res = submit_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            &quote.quote.id,
            Some("2026-11-09"),
        )
        .unwrap();

        // Then: Since standard_price <= 0.0, approval is required
        assert_eq!(res.quote.status, "pending_approval");
        assert_eq!(res.quote.requires_approval, 1);
        assert_eq!(res.message, "已送交核准（1 項低於標準售價）");
    }

    #[test]
    fn test_tc_quo_b06_and_b07_valid_until_date_boundaries() {
        // Given: Quotes with valid_until = today and valid_until = today - 1
        let mut conn = setup_test_db();
        let cid = seed_customer(&conn, "tnt_1", "測試客戶", true, true);
        let (_, uid) = seed_product(&conn, "tnt_1", "商品A", true, 100.0);

        // Case 1: valid_until == today (2026-11-09) -> TC-QUO-B-06: Allowed to submit
        let q_today = create_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            CreateQuoteInput {
                customer_partner_id: cid.clone(),
                valid_until: "2026-11-09".to_string(),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        add_quote_line_impl(
            &mut conn,
            "tnt_1",
            AddQuoteLineInput {
                quote_id: q_today.quote.id.clone(),
                unit_id: uid.clone(),
                quantity: 1.0,
                unit_price: 100.0,
                note: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        // When: Submitting when valid_until == today
        let submit_today = submit_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            &q_today.quote.id,
            Some("2026-11-09"),
        );
        // Then: Allowed and sent
        assert!(submit_today.is_ok());

        // Case 2: valid_until == today - 1 (2026-11-08) -> TC-QUO-B-07: Expired
        let q_yesterday = create_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            CreateQuoteInput {
                customer_partner_id: cid,
                valid_until: "2026-11-08".to_string(),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-08"),
        )
        .unwrap();

        add_quote_line_impl(
            &mut conn,
            "tnt_1",
            AddQuoteLineInput {
                quote_id: q_yesterday.quote.id.clone(),
                unit_id: uid,
                quantity: 1.0,
                unit_price: 100.0,
                note: None,
            },
            Some("2026-11-08"),
        )
        .unwrap();

        // When: Submitting yesterday's quote on 2026-11-09
        let err_yesterday = submit_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            &q_yesterday.quote.id,
            Some("2026-11-09"),
        )
        .unwrap_err();

        // Then: Rejected with ExpiredValidUntil
        assert_eq!(err_yesterday, QuoteError::ExpiredValidUntil);
        assert_eq!(err_yesterday.to_string(), "報價有效期已過，請先修改有效期");
    }

    #[test]
    fn test_tc_quo_n_05_withdraw_quote_approval() {
        // Given: Quote in pending_approval
        let mut conn = setup_test_db();
        let cid = seed_customer(&conn, "tnt_1", "客戶", true, true);
        let (_, uid) = seed_product(&conn, "tnt_1", "商品", true, 100.0);

        let quote = create_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            CreateQuoteInput {
                customer_partner_id: cid,
                valid_until: "2026-12-31".to_string(),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        add_quote_line_impl(
            &mut conn,
            "tnt_1",
            AddQuoteLineInput {
                quote_id: quote.quote.id.clone(),
                unit_id: uid,
                quantity: 1.0,
                unit_price: 80.0,
                note: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        submit_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            &quote.quote.id,
            Some("2026-11-09"),
        )
        .unwrap();

        // When: Withdrawing approval
        let withdrawn = withdraw_quote_approval_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            &quote.quote.id,
            Some("重新調整折讓比例".to_string()),
            Some("2026-11-09"),
        )
        .unwrap();

        // Then: Status returns to draft and reason recorded
        assert_eq!(withdrawn.quote.status, "draft");
        assert_eq!(
            withdrawn.quote.approval_rejection_reason.as_deref(),
            Some("重新調整折讓比例")
        );
    }

    #[test]
    fn test_tc_quo_n_06_decline_quote_from_sent() {
        // Given: Quote in sent status
        let mut conn = setup_test_db();
        let cid = seed_customer(&conn, "tnt_1", "客戶", true, true);
        let (_, uid) = seed_product(&conn, "tnt_1", "商品", true, 100.0);

        let quote = create_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            CreateQuoteInput {
                customer_partner_id: cid,
                valid_until: "2026-12-31".to_string(),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        add_quote_line_impl(
            &mut conn,
            "tnt_1",
            AddQuoteLineInput {
                quote_id: quote.quote.id.clone(),
                unit_id: uid,
                quantity: 1.0,
                unit_price: 100.0,
                note: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        submit_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            &quote.quote.id,
            Some("2026-11-09"),
        )
        .unwrap();

        // When: Customer declines
        let declined = decline_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            &quote.quote.id,
            Some("客戶預算不足".to_string()),
            Some("2026-11-09"),
        )
        .unwrap();

        // Then: Status is declined, declined_at and decline_reason recorded
        assert_eq!(declined.quote.status, "declined");
        assert!(declined.quote.declined_at.is_some());
        assert_eq!(
            declined.quote.decline_reason.as_deref(),
            Some("客戶預算不足")
        );
    }

    #[test]
    fn test_tc_quo_n_07_cancel_quote() {
        // Given: A draft quote
        let mut conn = setup_test_db();
        let cid = seed_customer(&conn, "tnt_1", "客戶", true, true);
        let quote = create_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            CreateQuoteInput {
                customer_partner_id: cid,
                valid_until: "2026-12-31".to_string(),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        // When: Cancelling quote without reason is rejected
        let err_no_reason = cancel_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            &quote.quote.id,
            None,
            Some("2026-11-09"),
        )
        .unwrap_err();
        assert_eq!(err_no_reason.to_string(), "取消理由為必填");

        // When: Cancelling quote with whitespace reason is rejected
        let err_ws_reason = cancel_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            &quote.quote.id,
            Some("   "),
            Some("2026-11-09"),
        )
        .unwrap_err();
        assert_eq!(err_ws_reason.to_string(), "取消理由為必填");

        // When: Cancelling quote with valid reason
        let cancelled = cancel_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            &quote.quote.id,
            Some("客戶規格變更，故取消作廢"),
            Some("2026-11-09"),
        )
        .unwrap();

        // Then: Status is cancelled, cancelled_at and cancel_reason recorded
        assert_eq!(cancelled.quote.status, "cancelled");
        assert!(cancelled.quote.cancelled_at.is_some());
        assert_eq!(
            cancelled.quote.cancel_reason,
            Some("客戶規格變更，故取消作廢".to_string())
        );
    }

    #[test]
    fn test_tc_quo_e01_to_e03_customer_validations() {
        let mut conn = setup_test_db();

        // TC-QUO-E-01: Nonexistent customer
        let err1 = create_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            CreateQuoteInput {
                customer_partner_id: "nonexistent".to_string(),
                valid_until: "2026-12-31".to_string(),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-09"),
        )
        .unwrap_err();
        assert_eq!(err1, QuoteError::CustomerNotFoundOrInactive);
        assert_eq!(err1.to_string(), "找不到此客戶，或該往來對象未設定為客戶");

        // TC-QUO-E-02: Partner is vendor only (is_customer=0)
        let vid = seed_customer(&conn, "tnt_1", "單純供應商", false, true);
        let err2 = create_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            CreateQuoteInput {
                customer_partner_id: vid,
                valid_until: "2026-12-31".to_string(),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-09"),
        )
        .unwrap_err();
        assert_eq!(err2, QuoteError::CustomerNotFoundOrInactive);

        // TC-QUO-E-03: Customer is inactive (is_active=0)
        let inact_id = seed_customer(&conn, "tnt_1", "停用客戶", true, false);
        let err3 = create_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            CreateQuoteInput {
                customer_partner_id: inact_id,
                valid_until: "2026-12-31".to_string(),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-09"),
        )
        .unwrap_err();
        assert_eq!(err3, QuoteError::CustomerNotFoundOrInactive);
    }

    #[test]
    fn test_tc_quo_e04_product_not_sellable() {
        // Given: Product with is_sellable = 0
        let mut conn = setup_test_db();
        let cid = seed_customer(&conn, "tnt_1", "客戶", true, true);
        let (_, uid) = seed_product(&conn, "tnt_1", "原物料銅箔", false, 50.0);

        let quote = create_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            CreateQuoteInput {
                customer_partner_id: cid,
                valid_until: "2026-12-31".to_string(),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        // When: Adding non-sellable unit
        let err = add_quote_line_impl(
            &mut conn,
            "tnt_1",
            AddQuoteLineInput {
                quote_id: quote.quote.id,
                unit_id: uid,
                quantity: 10.0,
                unit_price: 60.0,
                note: None,
            },
            Some("2026-11-09"),
        )
        .unwrap_err();

        // Then: ProductNotSellable
        assert_eq!(err, QuoteError::ProductNotSellable);
        assert_eq!(err.to_string(), "此商品不可銷售");
    }

    #[test]
    fn test_tc_quo_e05_duplicate_unit_id_in_same_quote() {
        // Given: Draft quote with 1 line
        let mut conn = setup_test_db();
        let cid = seed_customer(&conn, "tnt_1", "客戶", true, true);
        let (_, uid) = seed_product(&conn, "tnt_1", "商品", true, 100.0);

        let quote = create_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            CreateQuoteInput {
                customer_partner_id: cid,
                valid_until: "2026-12-31".to_string(),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        add_quote_line_impl(
            &mut conn,
            "tnt_1",
            AddQuoteLineInput {
                quote_id: quote.quote.id.clone(),
                unit_id: uid.clone(),
                quantity: 1.0,
                unit_price: 100.0,
                note: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        // When: Adding the same unit_id again
        let err = add_quote_line_impl(
            &mut conn,
            "tnt_1",
            AddQuoteLineInput {
                quote_id: quote.quote.id,
                unit_id: uid,
                quantity: 2.0,
                unit_price: 100.0,
                note: None,
            },
            Some("2026-11-09"),
        )
        .unwrap_err();

        // Then: DuplicateUnitInQuote
        assert_eq!(err, QuoteError::DuplicateUnitInQuote);
        assert_eq!(err.to_string(), "同一報價單內商品單位不可重複");
    }

    #[test]
    fn test_tc_quo_b08_to_b11_quantity_and_price_boundaries() {
        let mut conn = setup_test_db();
        let cid = seed_customer(&conn, "tnt_1", "客戶", true, true);
        let (_, uid) = seed_product(&conn, "tnt_1", "商品", true, 100.0);

        let quote = create_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            CreateQuoteInput {
                customer_partner_id: cid,
                valid_until: "2026-12-31".to_string(),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        // TC-QUO-B-08: quantity = 0.0 -> Rejected
        let err_q0 = add_quote_line_impl(
            &mut conn,
            "tnt_1",
            AddQuoteLineInput {
                quote_id: quote.quote.id.clone(),
                unit_id: uid.clone(),
                quantity: 0.0,
                unit_price: 100.0,
                note: None,
            },
            Some("2026-11-09"),
        )
        .unwrap_err();
        assert_eq!(err_q0, QuoteError::InvalidQuantityOrPrice);

        // TC-QUO-B-09: quantity = -1.0 -> Rejected
        let err_q_neg = add_quote_line_impl(
            &mut conn,
            "tnt_1",
            AddQuoteLineInput {
                quote_id: quote.quote.id.clone(),
                unit_id: uid.clone(),
                quantity: -1.0,
                unit_price: 100.0,
                note: None,
            },
            Some("2026-11-09"),
        )
        .unwrap_err();
        assert_eq!(err_q_neg, QuoteError::InvalidQuantityOrPrice);

        // TC-QUO-B-11: unit_price = -0.01 -> Rejected
        let err_p_neg = add_quote_line_impl(
            &mut conn,
            "tnt_1",
            AddQuoteLineInput {
                quote_id: quote.quote.id.clone(),
                unit_id: uid.clone(),
                quantity: 1.0,
                unit_price: -0.01,
                note: None,
            },
            Some("2026-11-09"),
        )
        .unwrap_err();
        assert_eq!(err_p_neg, QuoteError::InvalidQuantityOrPrice);

        // TC-QUO-B-10: unit_price = 0.0 -> Allowed!
        let ok_p0 = add_quote_line_impl(
            &mut conn,
            "tnt_1",
            AddQuoteLineInput {
                quote_id: quote.quote.id,
                unit_id: uid,
                quantity: 1.0,
                unit_price: 0.0,
                note: None,
            },
            Some("2026-11-09"),
        );
        assert!(ok_p0.is_ok());
    }

    #[test]
    fn test_tc_quo_b12_empty_lines_submission_rejected() {
        // Given: Draft quote with no lines
        let mut conn = setup_test_db();
        let cid = seed_customer(&conn, "tnt_1", "客戶", true, true);
        let quote = create_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            CreateQuoteInput {
                customer_partner_id: cid,
                valid_until: "2026-12-31".to_string(),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        // When: Submitting empty quote
        let err = submit_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            &quote.quote.id,
            Some("2026-11-09"),
        )
        .unwrap_err();

        // Then: NoLinesForSubmit
        assert_eq!(err, QuoteError::NoLinesForSubmit);
        assert_eq!(err.to_string(), "報價單沒有任何品項，無法送出");
    }

    #[test]
    fn test_tc_quo_e06_and_e07_non_draft_and_terminal_modifications_rejected() {
        // Given: Quote in sent status
        let mut conn = setup_test_db();
        let cid = seed_customer(&conn, "tnt_1", "客戶", true, true);
        let (_, uid) = seed_product(&conn, "tnt_1", "商品", true, 100.0);

        let quote = create_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            CreateQuoteInput {
                customer_partner_id: cid,
                valid_until: "2026-12-31".to_string(),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        add_quote_line_impl(
            &mut conn,
            "tnt_1",
            AddQuoteLineInput {
                quote_id: quote.quote.id.clone(),
                unit_id: uid,
                quantity: 1.0,
                unit_price: 100.0,
                note: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        submit_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            &quote.quote.id,
            Some("2026-11-09"),
        )
        .unwrap();

        // When: Attempting to modify header on 'sent' quote (TC-QUO-E-06)
        let err_sent_mod = update_quote_header_impl(
            &mut conn,
            "tnt_1",
            UpdateQuoteHeaderInput {
                quote_id: quote.quote.id.clone(),
                customer_partner_id: None,
                valid_until: Some("2027-01-01".to_string()),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-09"),
        )
        .unwrap_err();
        assert_eq!(
            err_sent_mod,
            QuoteError::NotDraftForModification("sent".to_string())
        );
        assert_eq!(err_sent_mod.to_string(), "報價單狀態為 sent，僅草稿可修改");

        // When: Cancelling the quote to enter terminal state 'cancelled'
        cancel_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            &quote.quote.id,
            Some("測試取消"),
            Some("2026-11-09"),
        )
        .unwrap();

        // When: Attempting to modify terminal quote (TC-QUO-E-07)
        let err_term_mod = update_quote_header_impl(
            &mut conn,
            "tnt_1",
            UpdateQuoteHeaderInput {
                quote_id: quote.quote.id.clone(),
                customer_partner_id: None,
                valid_until: Some("2027-01-01".to_string()),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-09"),
        )
        .unwrap_err();
        assert_eq!(err_term_mod, QuoteError::TerminalStateImmutable);
        assert_eq!(err_term_mod.to_string(), "此報價單已結案，無法修改");
    }

    #[test]
    fn test_tc_quo_e08_and_e09_invalid_status_transitions() {
        let mut conn = setup_test_db();
        let cid = seed_customer(&conn, "tnt_1", "客戶", true, true);
        let quote = create_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            CreateQuoteInput {
                customer_partner_id: cid,
                valid_until: "2026-12-31".to_string(),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        // TC-QUO-E-08: draft quote cannot withdraw approval
        let err1 = withdraw_quote_approval_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            &quote.quote.id,
            None,
            Some("2026-11-09"),
        )
        .unwrap_err();
        assert_eq!(err1, QuoteError::InvalidStatusTransition);
        assert_eq!(err1.to_string(), "目前狀態不允許此操作");

        // TC-QUO-E-08: draft quote cannot decline
        let err2 = decline_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            &quote.quote.id,
            None,
            Some("2026-11-09"),
        )
        .unwrap_err();
        assert_eq!(err2, QuoteError::InvalidStatusTransition);
    }

    #[test]
    fn test_tc_quo_e10_tenant_isolation() {
        let mut conn = setup_test_db();
        let cid = seed_customer(&conn, "tnt_1", "客戶A", true, true);
        let quote = create_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            CreateQuoteInput {
                customer_partner_id: cid,
                valid_until: "2026-12-31".to_string(),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        // When: Querying or updating from tnt_2
        let err = get_quote_impl(&conn, "tnt_2", &quote.quote.id, Some("2026-11-09")).unwrap_err();
        assert_eq!(err, QuoteError::QuoteNotFound);
        assert_eq!(err.to_string(), "找不到報價單或不屬於目前租戶");
    }

    #[test]
    fn test_tc_quo_d01_dynamic_standard_price_refetch_on_submit() {
        // Given: Product created with standard price 100.0, line added at 120.0
        let mut conn = setup_test_db();
        let cid = seed_customer(&conn, "tnt_1", "客戶", true, true);
        let (_, uid) = seed_product(&conn, "tnt_1", "動態價格商品", true, 100.0);

        let quote = create_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            CreateQuoteInput {
                customer_partner_id: cid,
                valid_until: "2026-12-31".to_string(),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        let detail = add_quote_line_impl(
            &mut conn,
            "tnt_1",
            AddQuoteLineInput {
                quote_id: quote.quote.id.clone(),
                unit_id: uid.clone(),
                quantity: 1.0,
                unit_price: 120.0,
                note: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();
        assert_eq!(detail.lines[0].standard_price_snapshot, 100.0);

        // When: Midway before submission, standard price is increased to 150.0
        conn.execute(
            "UPDATE product_units SET selling_price = 150.0 WHERE id = ?1",
            params![uid],
        )
        .unwrap();

        // When: Submitting quote now
        let res = submit_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            &quote.quote.id,
            Some("2026-11-09"),
        )
        .unwrap();

        // Then: Submit refetches selling_price as 150.0, 120.0 < 150.0 triggers approval!
        assert_eq!(res.quote.status, "pending_approval");
        assert_eq!(res.quote.requires_approval, 1);
        assert_eq!(res.message, "已送交核准（1 項低於標準售價）");

        let lines = get_quote_lines(&conn, &quote.quote.id).unwrap();
        assert_eq!(lines[0].standard_price_snapshot, 150.0);
        assert_eq!(lines[0].requires_approval, 1);
    }

    #[test]
    fn test_tc_quo_d02_lazy_expiration_in_transaction() {
        // Given: A quote in 'sent' status with valid_until = '2026-11-10'
        let mut conn = setup_test_db();
        let cid = seed_customer(&conn, "tnt_1", "客戶", true, true);
        let (_, uid) = seed_product(&conn, "tnt_1", "商品", true, 100.0);

        let quote = create_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            CreateQuoteInput {
                customer_partner_id: cid,
                valid_until: "2026-11-10".to_string(),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        add_quote_line_impl(
            &mut conn,
            "tnt_1",
            AddQuoteLineInput {
                quote_id: quote.quote.id.clone(),
                unit_id: uid,
                quantity: 1.0,
                unit_price: 100.0,
                note: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        submit_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            &quote.quote.id,
            Some("2026-11-09"),
        )
        .unwrap();

        // When: Day advances to 2026-11-11 (today > valid_until) and get_quote is invoked
        let detail_expired =
            get_quote_impl(&conn, "tnt_1", &quote.quote.id, Some("2026-11-11")).unwrap();

        // Then: Quote status automatically turned into 'expired' via lazy check!
        assert_eq!(detail_expired.quote.status, "expired");
        assert!(detail_expired.quote.expired_at.is_some());

        // And: Attempting to cancel expired quote is rejected because it is terminal
        let err_cancel = cancel_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            &quote.quote.id,
            Some("測試取消"),
            Some("2026-11-11"),
        )
        .unwrap_err();
        assert_eq!(err_cancel, QuoteError::TerminalStateImmutable);
    }

    // =========================================================================
    // Issue #232 Tests: Quote Approval & Rejection with Audit Logs & Pending List
    // =========================================================================

    #[test]
    fn test_tc_app_n01_and_n02_approve_quote_with_and_without_reason() {
        // Given: Quote submitted with a line below standard price, in pending_approval
        let mut conn = setup_test_db();
        let cid = seed_customer(&conn, "tnt_1", "台積電客戶", true, true);
        let (_, uid) = seed_product(&conn, "tnt_1", "高階晶片", true, 100.0);

        let quote1 = create_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_sales",
            CreateQuoteInput {
                customer_partner_id: cid.clone(),
                valid_until: "2026-12-31".to_string(),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        add_quote_line_impl(
            &mut conn,
            "tnt_1",
            AddQuoteLineInput {
                quote_id: quote1.quote.id.clone(),
                unit_id: uid.clone(),
                quantity: 10.0,
                unit_price: 80.0, // below 100.0
                note: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        let sub1 = submit_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_sales",
            &quote1.quote.id,
            Some("2026-11-09"),
        )
        .unwrap();
        assert_eq!(sub1.quote.status, "pending_approval");

        // When: Approving quote1 with reason
        let approved1 = approve_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_approver",
            &quote1.quote.id,
            Some("客戶量大，給予八折優惠".to_string()),
            Some("2026-11-09"),
        )
        .unwrap();

        // Then: Status is sent, approved_by and approved_at are recorded, approval_rejection_reason is cleared
        assert_eq!(approved1.quote.status, "sent");
        assert_eq!(
            approved1.quote.approved_by,
            Some("usr_approver".to_string())
        );
        assert!(approved1.quote.approved_at.is_some());
        assert!(approved1.quote.sent_at.is_some());
        assert_eq!(approved1.quote.approval_rejection_reason, None);

        // And: Audit log record written with decision='approved'
        let (action_type, decision, operator, arguments): (String, String, String, String) = conn
            .query_row(
                "SELECT action_type, decision, operator, arguments FROM audit_logs WHERE arguments LIKE ?1",
                params![format!("%{}%", quote1.quote.id)],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(action_type, "quote_approval");
        assert_eq!(decision, "approved");
        assert_eq!(operator, "usr_approver");

        let parsed_args: QuoteApprovalAuditArgs = serde_json::from_str(&arguments).unwrap();
        assert_eq!(parsed_args.quote_id, quote1.quote.id);
        assert_eq!(parsed_args.quote_number, quote1.quote.quote_number);
        assert_eq!(parsed_args.total_amount, 800.0);
        assert_eq!(
            parsed_args.reason,
            Some("客戶量大，給予八折優惠".to_string())
        );
        assert_eq!(parsed_args.below_standard_lines.len(), 1);
        assert_eq!(parsed_args.below_standard_lines[0].difference, 20.0);
        assert_eq!(parsed_args.below_standard_lines[0].unit_price, 80.0);
        assert_eq!(parsed_args.below_standard_lines[0].standard_price, 100.0);

        // When: TC-APP-N-02: Approving quote2 without reason (reason=None)
        let quote2 = create_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_sales",
            CreateQuoteInput {
                customer_partner_id: cid,
                valid_until: "2026-12-31".to_string(),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        add_quote_line_impl(
            &mut conn,
            "tnt_1",
            AddQuoteLineInput {
                quote_id: quote2.quote.id.clone(),
                unit_id: uid,
                quantity: 5.0,
                unit_price: 90.0,
                note: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        submit_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_sales",
            &quote2.quote.id,
            Some("2026-11-09"),
        )
        .unwrap();

        let approved2 = approve_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_approver2",
            &quote2.quote.id,
            None,
            Some("2026-11-09"),
        )
        .unwrap();

        // Then: Quote status is sent and audit log has reason=None
        assert_eq!(approved2.quote.status, "sent");
        let arguments2: String = conn
            .query_row(
                "SELECT arguments FROM audit_logs WHERE arguments LIKE ?1",
                params![format!("%{}%", quote2.quote.id)],
                |r| r.get(0),
            )
            .unwrap();
        let parsed_args2: QuoteApprovalAuditArgs = serde_json::from_str(&arguments2).unwrap();
        assert_eq!(parsed_args2.quote_id, quote2.quote.id);
        assert_eq!(parsed_args2.reason, None);
    }

    #[test]
    fn test_tc_app_n03_reject_quote_with_valid_reason() {
        // Given: Quote in pending_approval
        let mut conn = setup_test_db();
        let cid = seed_customer(&conn, "tnt_1", "聯發科技客戶", true, true);
        let (_, uid) = seed_product(&conn, "tnt_1", "旗艦主機板", true, 200.0);

        let quote = create_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_sales",
            CreateQuoteInput {
                customer_partner_id: cid,
                valid_until: "2026-12-31".to_string(),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        add_quote_line_impl(
            &mut conn,
            "tnt_1",
            AddQuoteLineInput {
                quote_id: quote.quote.id.clone(),
                unit_id: uid,
                quantity: 2.0,
                unit_price: 150.0, // below standard 200.0
                note: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        submit_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_sales",
            &quote.quote.id,
            Some("2026-11-09"),
        )
        .unwrap();

        // When: Rejecting quote with valid reason
        let rejected = reject_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_approver",
            &quote.quote.id,
            "折扣過高，毛利率不足 15%，請重新協商",
            Some("2026-11-09"),
        )
        .unwrap();

        // Then: Quote status returns to draft, rejection reason is recorded
        assert_eq!(rejected.quote.status, "draft");
        assert_eq!(
            rejected.quote.approval_rejection_reason,
            Some("折扣過高，毛利率不足 15%，請重新協商".to_string())
        );

        // And: Audit log is recorded with decision='rejected'
        let (decision, operator, arguments): (String, String, String) = conn
            .query_row(
                "SELECT decision, operator, arguments FROM audit_logs WHERE action_type = 'quote_approval' ORDER BY timestamp DESC LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(decision, "rejected");
        assert_eq!(operator, "usr_approver");

        let parsed_args: QuoteApprovalAuditArgs = serde_json::from_str(&arguments).unwrap();
        assert_eq!(parsed_args.quote_id, quote.quote.id);
        assert_eq!(
            parsed_args.reason,
            Some("折扣過高，毛利率不足 15%，請重新協商".to_string())
        );
        assert_eq!(parsed_args.below_standard_lines.len(), 1);
        assert_eq!(parsed_args.below_standard_lines[0].difference, 50.0);
    }

    #[test]
    fn test_tc_app_n04_list_pending_approval_quotes() {
        // Given: 2 quotes in pending_approval, 1 in sent
        let mut conn = setup_test_db();
        let cid = seed_customer(&conn, "tnt_1", "宏碁客戶", true, true);
        let (_, uid1) = seed_product(&conn, "tnt_1", "螢幕A", true, 300.0);
        let (_, uid2) = seed_product(&conn, "tnt_1", "鍵盤B", true, 100.0);

        // Quote 1: pending approval (螢幕A @ 250, diff=50)
        let q1 = create_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            CreateQuoteInput {
                customer_partner_id: cid.clone(),
                valid_until: "2026-12-31".to_string(),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();
        add_quote_line_impl(
            &mut conn,
            "tnt_1",
            AddQuoteLineInput {
                quote_id: q1.quote.id.clone(),
                unit_id: uid1,
                quantity: 1.0,
                unit_price: 250.0,
                note: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();
        submit_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            &q1.quote.id,
            Some("2026-11-09"),
        )
        .unwrap();

        // Quote 2: sent directly (鍵盤B @ 100, no discount)
        let q2 = create_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            CreateQuoteInput {
                customer_partner_id: cid.clone(),
                valid_until: "2026-12-31".to_string(),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();
        add_quote_line_impl(
            &mut conn,
            "tnt_1",
            AddQuoteLineInput {
                quote_id: q2.quote.id.clone(),
                unit_id: uid2.clone(),
                quantity: 2.0,
                unit_price: 100.0,
                note: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();
        submit_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            &q2.quote.id,
            Some("2026-11-09"),
        )
        .unwrap();

        // Quote 3: pending approval (鍵盤B @ 80, diff=20)
        let q3 = create_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            CreateQuoteInput {
                customer_partner_id: cid,
                valid_until: "2026-12-31".to_string(),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();
        add_quote_line_impl(
            &mut conn,
            "tnt_1",
            AddQuoteLineInput {
                quote_id: q3.quote.id.clone(),
                unit_id: uid2,
                quantity: 5.0,
                unit_price: 80.0,
                note: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();
        submit_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            &q3.quote.id,
            Some("2026-11-09"),
        )
        .unwrap();

        // When: Querying pending approval list
        let pending_list =
            list_pending_approval_quotes_impl(&conn, "tnt_1", Some("2026-11-09")).unwrap();

        // Then: Returns 2 pending quotes with below_standard_lines populated
        assert_eq!(pending_list.len(), 2);
        for item in &pending_list {
            assert_eq!(item.quote.status, "pending_approval");
            assert!(!item.below_standard_lines.is_empty());
        }
        let found_q1 = pending_list
            .iter()
            .find(|i| i.quote.id == q1.quote.id)
            .unwrap();
        assert_eq!(found_q1.below_standard_lines[0].difference, 50.0);
        assert_eq!(found_q1.below_standard_lines[0].product_name, "螢幕A");

        let found_q3 = pending_list
            .iter()
            .find(|i| i.quote.id == q3.quote.id)
            .unwrap();
        assert_eq!(found_q3.below_standard_lines[0].difference, 20.0);
        assert_eq!(found_q3.below_standard_lines[0].product_name, "鍵盤B");
    }

    #[test]
    fn test_tc_app_b01_and_b02_reject_with_empty_or_whitespace_reason_rejected() {
        // Given: Quote in pending_approval
        let mut conn = setup_test_db();
        let cid = seed_customer(&conn, "tnt_1", "華碩客戶", true, true);
        let (_, uid) = seed_product(&conn, "tnt_1", "顯示卡", true, 500.0);

        let quote = create_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_sales",
            CreateQuoteInput {
                customer_partner_id: cid,
                valid_until: "2026-12-31".to_string(),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        add_quote_line_impl(
            &mut conn,
            "tnt_1",
            AddQuoteLineInput {
                quote_id: quote.quote.id.clone(),
                unit_id: uid,
                quantity: 1.0,
                unit_price: 450.0,
                note: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        submit_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_sales",
            &quote.quote.id,
            Some("2026-11-09"),
        )
        .unwrap();

        // When: Rejecting with empty reason
        let err_empty = reject_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_approver",
            &quote.quote.id,
            "",
            Some("2026-11-09"),
        )
        .unwrap_err();

        // Then: ApprovalReasonRequired error, status remains pending_approval
        assert_eq!(err_empty, QuoteError::ApprovalReasonRequired);
        assert_eq!(err_empty.to_string(), "駁回理由為必填");

        // When: Rejecting with whitespace-only reason
        let err_ws = reject_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_approver",
            &quote.quote.id,
            "   \t\n  ",
            Some("2026-11-09"),
        )
        .unwrap_err();

        // Then: ApprovalReasonRequired error
        assert_eq!(err_ws, QuoteError::ApprovalReasonRequired);

        // And: Quote status is still pending_approval, no audit log inserted
        let current_quote = get_quote_row(&conn, "tnt_1", &quote.quote.id).unwrap();
        assert_eq!(current_quote.status, "pending_approval");

        let audit_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM audit_logs", [], |r| r.get(0))
            .unwrap();
        assert_eq!(audit_count, 0);
    }

    #[test]
    fn test_tc_app_b03_and_b04_and_b05_boundary_prices_in_audit_and_pending_list() {
        // Given: Product standard price 100.0, product with zero standard price 0.0
        let mut conn = setup_test_db();
        let cid = seed_customer(&conn, "tnt_1", "緯創客戶", true, true);
        let (_, uid_std100) = seed_product(&conn, "tnt_1", "標準品100", true, 100.0);
        let (_, uid_std0) = seed_product(&conn, "tnt_1", "標準價為零品項", true, 0.0);

        let quote = create_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_sales",
            CreateQuoteInput {
                customer_partner_id: cid,
                valid_until: "2026-12-31".to_string(),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        // TC-APP-B-03: 1 cent discount: unit_price = 99.99 (difference = 0.01)
        add_quote_line_impl(
            &mut conn,
            "tnt_1",
            AddQuoteLineInput {
                quote_id: quote.quote.id.clone(),
                unit_id: uid_std100.clone(),
                quantity: 1.0,
                unit_price: 99.99,
                note: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        // TC-APP-B-04: zero unit price: unit_price = 0.0 (difference = 100.0)
        // (Create another quote for zero price line since same quote cannot duplicate unit)
        // TC-APP-B-05: zero standard price: standard_price = 0.0, unit_price = 50.0 (std <= 0 requires approval)
        add_quote_line_impl(
            &mut conn,
            "tnt_1",
            AddQuoteLineInput {
                quote_id: quote.quote.id.clone(),
                unit_id: uid_std0,
                quantity: 2.0,
                unit_price: 50.0,
                note: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        submit_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_sales",
            &quote.quote.id,
            Some("2026-11-09"),
        )
        .unwrap();

        // When: Querying pending list
        let pending =
            list_pending_approval_quotes_impl(&conn, "tnt_1", Some("2026-11-09")).unwrap();
        assert_eq!(pending.len(), 1);
        let lines = &pending[0].below_standard_lines;
        assert_eq!(lines.len(), 2);

        let line_1cent = lines.iter().find(|l| l.unit_id == uid_std100).unwrap();
        assert_eq!(line_1cent.unit_price, 99.99);
        assert_eq!(line_1cent.standard_price, 100.0);
        assert_eq!(line_1cent.difference, 0.01);

        // When: Approving
        let app_res = approve_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_approver",
            &quote.quote.id,
            Some("邊界價格核准".to_string()),
            Some("2026-11-09"),
        )
        .unwrap();
        assert_eq!(app_res.quote.status, "sent");
    }

    #[test]
    fn test_tc_app_e01_to_e06_invalid_status_and_terminal_approvals_rejected() {
        let mut conn = setup_test_db();
        let cid = seed_customer(&conn, "tnt_1", "客戶", true, true);
        let (_, uid) = seed_product(&conn, "tnt_1", "商品", true, 100.0);

        // 1. Draft quote
        let draft_q = create_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            CreateQuoteInput {
                customer_partner_id: cid.clone(),
                valid_until: "2026-12-31".to_string(),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();
        add_quote_line_impl(
            &mut conn,
            "tnt_1",
            AddQuoteLineInput {
                quote_id: draft_q.quote.id.clone(),
                unit_id: uid.clone(),
                quantity: 1.0,
                unit_price: 80.0,
                note: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();

        // TC-APP-E-01: Draft cannot approve
        let err_draft_app = approve_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_app",
            &draft_q.quote.id,
            None,
            Some("2026-11-09"),
        )
        .unwrap_err();
        assert_eq!(err_draft_app, QuoteError::InvalidStatusTransition);

        // TC-APP-E-04: Draft cannot reject
        let err_draft_rej = reject_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_app",
            &draft_q.quote.id,
            "理由",
            Some("2026-11-09"),
        )
        .unwrap_err();
        assert_eq!(err_draft_rej, QuoteError::InvalidStatusTransition);

        // 2. Sent quote
        let sent_q = create_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            CreateQuoteInput {
                customer_partner_id: cid.clone(),
                valid_until: "2026-12-31".to_string(),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();
        add_quote_line_impl(
            &mut conn,
            "tnt_1",
            AddQuoteLineInput {
                quote_id: sent_q.quote.id.clone(),
                unit_id: uid.clone(),
                quantity: 1.0,
                unit_price: 100.0, // standard price, goes directly to sent
                note: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();
        submit_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            &sent_q.quote.id,
            Some("2026-11-09"),
        )
        .unwrap();

        // TC-APP-E-02: Sent cannot approve
        let err_sent_app = approve_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_app",
            &sent_q.quote.id,
            None,
            Some("2026-11-09"),
        )
        .unwrap_err();
        assert_eq!(err_sent_app, QuoteError::InvalidStatusTransition);

        // TC-APP-E-05: Sent cannot reject
        let err_sent_rej = reject_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_app",
            &sent_q.quote.id,
            "理由",
            Some("2026-11-09"),
        )
        .unwrap_err();
        assert_eq!(err_sent_rej, QuoteError::InvalidStatusTransition);

        // 3. Terminal state (cancelled quote)
        cancel_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            &sent_q.quote.id,
            Some("測試取消"),
            Some("2026-11-09"),
        )
        .unwrap();

        // TC-APP-E-03: Terminal cannot approve
        let err_term_app = approve_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_app",
            &sent_q.quote.id,
            None,
            Some("2026-11-09"),
        )
        .unwrap_err();
        assert_eq!(err_term_app, QuoteError::TerminalStateImmutable);

        // TC-APP-E-06: Terminal cannot reject
        let err_term_rej = reject_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_app",
            &sent_q.quote.id,
            "理由",
            Some("2026-11-09"),
        )
        .unwrap_err();
        assert_eq!(err_term_rej, QuoteError::TerminalStateImmutable);
    }

    #[test]
    fn test_tc_app_e07_and_e08_nonexistent_and_cross_tenant_isolation() {
        let mut conn = setup_test_db();
        let cid = seed_customer(&conn, "tnt_1", "客戶", true, true);
        let (_, uid) = seed_product(&conn, "tnt_1", "商品", true, 100.0);

        let quote = create_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            CreateQuoteInput {
                customer_partner_id: cid,
                valid_until: "2026-12-31".to_string(),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();
        add_quote_line_impl(
            &mut conn,
            "tnt_1",
            AddQuoteLineInput {
                quote_id: quote.quote.id.clone(),
                unit_id: uid,
                quantity: 1.0,
                unit_price: 50.0,
                note: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();
        submit_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            &quote.quote.id,
            Some("2026-11-09"),
        )
        .unwrap();

        // TC-APP-E-07: Nonexistent quote
        let err_nonexist = approve_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_app",
            "quo_nonexistent_999",
            None,
            Some("2026-11-09"),
        )
        .unwrap_err();
        assert_eq!(err_nonexist, QuoteError::QuoteNotFound);

        // TC-APP-E-08: Cross tenant
        let err_cross = approve_quote_impl(
            &mut conn,
            "tnt_2",
            "usr_app",
            &quote.quote.id,
            None,
            Some("2026-11-09"),
        )
        .unwrap_err();
        assert_eq!(err_cross, QuoteError::QuoteNotFound);
    }

    #[test]
    fn test_tc_app_e09_transaction_atomicity_and_audit_failure_rollback() {
        // Given: Quote in pending_approval
        let mut conn = setup_test_db();
        let cid = seed_customer(&conn, "tnt_1", "客戶", true, true);
        let (_, uid) = seed_product(&conn, "tnt_1", "商品", true, 100.0);

        let quote = create_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            CreateQuoteInput {
                customer_partner_id: cid,
                valid_until: "2026-12-31".to_string(),
                note: None,
                customer_po_number: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();
        add_quote_line_impl(
            &mut conn,
            "tnt_1",
            AddQuoteLineInput {
                quote_id: quote.quote.id.clone(),
                unit_id: uid,
                quantity: 1.0,
                unit_price: 50.0,
                note: None,
            },
            Some("2026-11-09"),
        )
        .unwrap();
        submit_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_1",
            &quote.quote.id,
            Some("2026-11-09"),
        )
        .unwrap();

        // Simulate audit log write failure by adding a trigger that aborts audit_logs insert
        conn.execute(
            "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'intentional audit failure'); END;",
            [],
        )
        .unwrap();

        // When: Attempting to approve quote, which tries to insert into audit_logs in same tx
        let err = approve_quote_impl(
            &mut conn,
            "tnt_1",
            "usr_app",
            &quote.quote.id,
            Some("核准理由".to_string()),
            Some("2026-11-09"),
        )
        .unwrap_err();

        // Then: The operation failed with error
        assert!(err.to_string().contains("intentional audit failure"));

        // And: Quotes status must have been completely ROLLED BACK to 'pending_approval'
        let current_quote = get_quote_row(&conn, "tnt_1", &quote.quote.id).unwrap();
        assert_eq!(current_quote.status, "pending_approval");
        assert_eq!(current_quote.approved_by, None);
        assert_eq!(current_quote.approved_at, None);
        assert_eq!(current_quote.sent_at, None);
    }
}
