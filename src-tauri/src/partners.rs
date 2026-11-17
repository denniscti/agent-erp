use crate::get_db_path;
use rusqlite::params;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static ID_COUNTER: AtomicU64 = AtomicU64::new(1000);

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq, Eq)]
pub struct Partner {
    pub id: String,
    #[serde(default)]
    pub tenant_id: String,
    pub name: String,
    pub is_customer: bool,
    pub is_vendor: bool,
    pub tax_id: Option<String>,
    pub payment_terms_type: Option<String>,
    pub payment_terms_days: Option<i64>,
    pub collection_terms_type: Option<String>,
    pub collection_terms_days: Option<i64>,
    pub requested_collection_terms_note: Option<String>,
    pub invoice_issuance_mode: Option<String>,
    pub created_at: i64,
}

fn current_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

pub fn create_partners_table(conn: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS partners (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL DEFAULT '',
            name TEXT NOT NULL,
            is_customer INTEGER NOT NULL DEFAULT 1,
            is_vendor INTEGER NOT NULL DEFAULT 0,
            is_active INTEGER NOT NULL DEFAULT 1,
            tax_id TEXT,
            payment_terms_type TEXT,
            payment_terms_days INTEGER,
            collection_terms_type TEXT,
            collection_terms_days INTEGER,
            requested_collection_terms_note TEXT,
            invoice_issuance_mode TEXT,
            created_at INTEGER NOT NULL
        )",
        [],
    )?;

    let _ = conn.execute(
        "ALTER TABLE partners ADD COLUMN tenant_id TEXT NOT NULL DEFAULT ''",
        [],
    );

    let _ = conn.execute(
        "ALTER TABLE partners ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1",
        [],
    );

    let _ = conn.execute(
        "ALTER TABLE partners ADD COLUMN payment_terms_type TEXT",
        [],
    );

    let _ = conn.execute(
        "ALTER TABLE partners ADD COLUMN payment_terms_days INTEGER",
        [],
    );

    let _ = conn.execute(
        "ALTER TABLE partners ADD COLUMN collection_terms_type TEXT",
        [],
    );

    let _ = conn.execute(
        "ALTER TABLE partners ADD COLUMN collection_terms_days INTEGER",
        [],
    );

    let _ = conn.execute(
        "ALTER TABLE partners ADD COLUMN requested_collection_terms_note TEXT",
        [],
    );

    let _ = conn.execute(
        "ALTER TABLE partners ADD COLUMN invoice_issuance_mode TEXT",
        [],
    );

    // Backward compatibility: backfill empty tenant_id for pre-existing records
    let has_sessions: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='sessions'",
            [],
            |_| Ok(true),
        )
        .unwrap_or(false);

    if has_sessions {
        let _ = conn.execute(
            "UPDATE partners SET tenant_id = (
                SELECT s.active_tenant_id FROM sessions s
                WHERE s.active_tenant_id IS NOT NULL AND TRIM(s.active_tenant_id) != ''
                ORDER BY ABS(s.created_at - partners.created_at) ASC LIMIT 1
            ) WHERE (tenant_id = '' OR tenant_id IS NULL)
              AND EXISTS (SELECT 1 FROM sessions s WHERE s.active_tenant_id IS NOT NULL AND TRIM(s.active_tenant_id) != '')",
            [],
        );
    }

    let has_tenants: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='tenants'",
            [],
            |_| Ok(true),
        )
        .unwrap_or(false);

    if has_tenants {
        let _ = conn.execute(
            "UPDATE partners SET tenant_id = (
                SELECT id FROM tenants ORDER BY rowid ASC LIMIT 1
            ) WHERE (tenant_id = '' OR tenant_id IS NULL)",
            [],
        );
    }

    Ok(())
}

// Helper: validate_tax_id
pub fn validate_tax_id(tax_id: Option<String>) -> Result<Option<String>, String> {
    let trimmed = match tax_id {
        Some(t) => {
            let s = t.trim().to_string();
            if s.is_empty() {
                return Ok(None);
            }
            s
        }
        None => return Ok(None),
    };

    if trimmed.len() != 8 || !trimmed.chars().all(|c| c.is_ascii_digit()) {
        return Err("統一編號必須為 8 碼半形數字".to_string());
    }

    Ok(Some(trimmed))
}

// Helper: validate_payment_terms (PT-01, PT-02, PT-03)
pub fn validate_payment_terms(
    is_vendor: bool,
    payment_terms_type: Option<String>,
    payment_terms_days: Option<i64>,
) -> Result<(Option<String>, Option<i64>), String> {
    let normalized_type = payment_terms_type
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    match (normalized_type, payment_terms_days) {
        (None, None) => Ok((None, None)),
        (Some(_), None) | (None, Some(_)) => Err("付款條件類型與天數需同時設定".to_string()),
        (Some(t), Some(d)) => {
            if !is_vendor {
                return Err("僅供應商可設定付款條件".to_string());
            }
            if t != "net" && t != "month_end" {
                return Err("付款條件類型需為 net 或 month_end".to_string());
            }
            if !(0..=365).contains(&d) {
                return Err("付款天數需為 0～365 的整數".to_string());
            }
            Ok((Some(t), Some(d)))
        }
    }
}

// Helper: validate_collection_terms (CT-01, CT-02, CT-03, CT-04)
pub fn validate_collection_terms(
    is_customer: bool,
    collection_terms_type: Option<String>,
    collection_terms_days: Option<i64>,
) -> Result<(Option<String>, Option<i64>), String> {
    let normalized_type = collection_terms_type
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    match (normalized_type, collection_terms_days) {
        (None, None) => Ok((None, None)),
        (Some(_), None) | (None, Some(_)) => Err("收款條件類型與天數需同時設定".to_string()),
        (Some(t), Some(d)) => {
            if !is_customer {
                return Err("僅客戶可設定收款條件".to_string());
            }
            if t != "net" && t != "month_end" {
                return Err("收款條件類型需為 net 或 month_end".to_string());
            }
            if !(0..=365).contains(&d) {
                return Err("收款天數需為 0～365 的整數".to_string());
            }
            Ok((Some(t), Some(d)))
        }
    }
}

// Helper: validate_invoice_issuance_mode (CT-05, CT-06)
pub fn validate_invoice_issuance_mode(
    is_customer: bool,
    invoice_issuance_mode: Option<String>,
) -> Result<Option<String>, String> {
    let normalized_mode = invoice_issuance_mode
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    match normalized_mode {
        None => {
            if is_customer {
                Ok(Some("per_order".to_string()))
            } else {
                Ok(None)
            }
        }
        Some(m) => {
            if !is_customer {
                return Err("僅客戶可設定開票模式".to_string());
            }
            if m != "per_order" && m != "monthly_consolidated" {
                return Err("開票模式需為 per_order 或 monthly_consolidated".to_string());
            }
            Ok(Some(m))
        }
    }
}

// Usecase: create_partner
pub fn create_partner_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    name: String,
    is_customer: Option<bool>,
    is_vendor: Option<bool>,
    tax_id: Option<String>,
) -> Result<Partner, String> {
    create_partner_with_all_terms_impl(
        conn,
        tenant_id,
        name,
        is_customer,
        is_vendor,
        tax_id,
        None,
        None,
        None,
        None,
        None,
        None,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn create_partner_with_terms_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    name: String,
    is_customer: Option<bool>,
    is_vendor: Option<bool>,
    tax_id: Option<String>,
    payment_terms_type: Option<String>,
    payment_terms_days: Option<i64>,
) -> Result<Partner, String> {
    create_partner_with_all_terms_impl(
        conn,
        tenant_id,
        name,
        is_customer,
        is_vendor,
        tax_id,
        payment_terms_type,
        payment_terms_days,
        None,
        None,
        None,
        None,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn create_partner_with_all_terms_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    name: String,
    is_customer: Option<bool>,
    is_vendor: Option<bool>,
    tax_id: Option<String>,
    payment_terms_type: Option<String>,
    payment_terms_days: Option<i64>,
    collection_terms_type: Option<String>,
    collection_terms_days: Option<i64>,
    requested_collection_terms_note: Option<String>,
    invoice_issuance_mode: Option<String>,
) -> Result<Partner, String> {
    let trimmed_tenant_id = tenant_id.trim();
    if trimmed_tenant_id.is_empty() {
        return Err("Tenant ID cannot be empty".to_string());
    }

    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("Partner name cannot be empty".to_string());
    }

    let trimmed_tax_id = validate_tax_id(tax_id)?;

    let target_is_vend = is_vendor.unwrap_or(false);
    let target_is_cust = is_customer.unwrap_or(!target_is_vend);

    let mut check_stmt = conn
        .prepare("SELECT id, tenant_id, name, is_customer, is_vendor, tax_id, payment_terms_type, payment_terms_days, collection_terms_type, collection_terms_days, requested_collection_terms_note, invoice_issuance_mode, created_at FROM partners WHERE tenant_id = ?1 AND LOWER(TRIM(name)) = LOWER(?2) LIMIT 1")
        .map_err(|e| format!("Failed to prepare duplicate check query: {}", e))?;

    let mut existing_rows = check_stmt
        .query_map(params![trimmed_tenant_id, trimmed_name], |row| {
            let is_cust_int: i64 = row.get(3)?;
            let is_vend_int: i64 = row.get(4)?;
            Ok(Partner {
                id: row.get(0)?,
                tenant_id: row.get(1)?,
                name: row.get(2)?,
                is_customer: is_cust_int == 1,
                is_vendor: is_vend_int == 1,
                tax_id: row.get(5)?,
                payment_terms_type: row.get(6)?,
                payment_terms_days: row.get(7)?,
                collection_terms_type: row.get(8)?,
                collection_terms_days: row.get(9)?,
                requested_collection_terms_note: row.get(10)?,
                invoice_issuance_mode: row.get(11)?,
                created_at: row.get(12)?,
            })
        })
        .map_err(|e| format!("Failed to check for duplicate partner: {}", e))?;

    if let Some(existing_res) = existing_rows.next() {
        let existing =
            existing_res.map_err(|e| format!("Failed to read existing partner: {}", e))?;

        let need_add_vendor = target_is_vend && !existing.is_vendor;
        let need_add_customer = target_is_cust && !existing.is_customer;

        if need_add_vendor || need_add_customer {
            // Check if provided tax_id is already used by another partner (excluding this existing record)
            if let Some(ref tid) = trimmed_tax_id {
                let mut tax_stmt = conn
                    .prepare("SELECT 1 FROM partners WHERE tenant_id = ?1 AND tax_id = ?2 AND id != ?3 LIMIT 1")
                    .map_err(|e| format!("Failed to prepare tax duplicate query: {}", e))?;
                let is_dup = tax_stmt
                    .query_row(params![trimmed_tenant_id, tid, existing.id], |_| Ok(()))
                    .is_ok();
                if is_dup {
                    return Err(format!("統一編號「{}」已由其他合作夥伴登記", tid));
                }
            }

            // Overlay identity on existing record
            let merged_is_cust = existing.is_customer || target_is_cust;
            let merged_is_vend = existing.is_vendor || target_is_vend;
            let merged_tax_id = trimmed_tax_id.or(existing.tax_id);

            let (final_terms_type, final_terms_days) =
                if payment_terms_type.is_some() || payment_terms_days.is_some() {
                    validate_payment_terms(merged_is_vend, payment_terms_type, payment_terms_days)?
                } else {
                    (existing.payment_terms_type, existing.payment_terms_days)
                };

            let (final_col_type, final_col_days) =
                if collection_terms_type.is_some() || collection_terms_days.is_some() {
                    validate_collection_terms(
                        merged_is_cust,
                        collection_terms_type,
                        collection_terms_days,
                    )?
                } else {
                    (
                        existing.collection_terms_type,
                        existing.collection_terms_days,
                    )
                };

            let final_note = requested_collection_terms_note
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .or(existing.requested_collection_terms_note);

            let final_invoice_mode = if invoice_issuance_mode.is_some() {
                validate_invoice_issuance_mode(merged_is_cust, invoice_issuance_mode)?
            } else {
                existing.invoice_issuance_mode.or(if merged_is_cust {
                    Some("per_order".to_string())
                } else {
                    None
                })
            };

            conn.execute(
                "UPDATE partners SET is_customer = ?1, is_vendor = ?2, tax_id = ?3, payment_terms_type = ?4, payment_terms_days = ?5, collection_terms_type = ?6, collection_terms_days = ?7, requested_collection_terms_note = ?8, invoice_issuance_mode = ?9 WHERE id = ?10",
                params![
                    if merged_is_cust { 1 } else { 0 },
                    if merged_is_vend { 1 } else { 0 },
                    merged_tax_id,
                    final_terms_type,
                    final_terms_days,
                    final_col_type,
                    final_col_days,
                    final_note,
                    final_invoice_mode,
                    existing.id
                ],
            )
            .map_err(|e| format!("Failed to update partner identity: {}", e))?;

            return Ok(Partner {
                id: existing.id,
                tenant_id: existing.tenant_id,
                name: existing.name,
                is_customer: merged_is_cust,
                is_vendor: merged_is_vend,
                tax_id: merged_tax_id,
                payment_terms_type: final_terms_type,
                payment_terms_days: final_terms_days,
                collection_terms_type: final_col_type,
                collection_terms_days: final_col_days,
                requested_collection_terms_note: final_note,
                invoice_issuance_mode: final_invoice_mode,
                created_at: existing.created_at,
            });
        }

        // Already has the requested identity
        let role_label = if target_is_vend && !target_is_cust {
            "供應商"
        } else {
            "客戶"
        };
        return Err(format!(
            "合作夥伴／{}「{}」已存在，請使用不同名稱",
            role_label, trimmed_name
        ));
    }

    // Check tax_id duplicate for new partner in same tenant
    if let Some(ref tid) = trimmed_tax_id {
        let mut tax_stmt = conn
            .prepare("SELECT 1 FROM partners WHERE tenant_id = ?1 AND tax_id = ?2 LIMIT 1")
            .map_err(|e| format!("Failed to prepare tax duplicate query: {}", e))?;
        let is_dup = tax_stmt
            .query_row(params![trimmed_tenant_id, tid], |_| Ok(()))
            .is_ok();
        if is_dup {
            return Err(format!("統一編號「{}」已由其他合作夥伴登記", tid));
        }
    }

    let (final_terms_type, final_terms_days) =
        validate_payment_terms(target_is_vend, payment_terms_type, payment_terms_days)?;

    let (final_col_type, final_col_days) =
        validate_collection_terms(target_is_cust, collection_terms_type, collection_terms_days)?;

    let final_note = requested_collection_terms_note
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let final_invoice_mode = validate_invoice_issuance_mode(target_is_cust, invoice_issuance_mode)?;

    let now = current_timestamp();
    let id = format!(
        "part_{}_{}",
        now,
        ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    );

    conn.execute(
        "INSERT INTO partners (id, tenant_id, name, is_customer, is_vendor, tax_id, payment_terms_type, payment_terms_days, collection_terms_type, collection_terms_days, requested_collection_terms_note, invoice_issuance_mode, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            id,
            trimmed_tenant_id,
            trimmed_name,
            if target_is_cust { 1 } else { 0 },
            if target_is_vend { 1 } else { 0 },
            trimmed_tax_id,
            final_terms_type,
            final_terms_days,
            final_col_type,
            final_col_days,
            final_note,
            final_invoice_mode,
            now
        ],
    )
    .map_err(|e| format!("Failed to insert partner: {}", e))?;

    Ok(Partner {
        id,
        tenant_id: trimmed_tenant_id.to_string(),
        name: trimmed_name.to_string(),
        is_customer: target_is_cust,
        is_vendor: target_is_vend,
        tax_id: trimmed_tax_id,
        payment_terms_type: final_terms_type,
        payment_terms_days: final_terms_days,
        collection_terms_type: final_col_type,
        collection_terms_days: final_col_days,
        requested_collection_terms_note: final_note,
        invoice_issuance_mode: final_invoice_mode,
        created_at: now,
    })
}

// Usecase: update_partner
pub fn update_partner_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    id: String,
    name: Option<String>,
    tax_id: Option<String>,
) -> Result<Partner, String> {
    update_partner_with_all_terms_impl(
        conn, tenant_id, id, name, tax_id, None, None, None, None, None, None, None, None, None,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn update_partner_with_terms_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    id: String,
    name: Option<String>,
    tax_id: Option<String>,
    payment_terms_type: Option<String>,
    payment_terms_days: Option<i64>,
    clear_payment_terms: Option<bool>,
) -> Result<Partner, String> {
    update_partner_with_all_terms_impl(
        conn,
        tenant_id,
        id,
        name,
        tax_id,
        payment_terms_type,
        payment_terms_days,
        clear_payment_terms,
        None,
        None,
        None,
        None,
        None,
        None,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn update_partner_with_all_terms_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    id: String,
    name: Option<String>,
    tax_id: Option<String>,
    payment_terms_type: Option<String>,
    payment_terms_days: Option<i64>,
    clear_payment_terms: Option<bool>,
    collection_terms_type: Option<String>,
    collection_terms_days: Option<i64>,
    clear_collection_terms: Option<bool>,
    requested_collection_terms_note: Option<String>,
    clear_requested_collection_terms_note: Option<bool>,
    invoice_issuance_mode: Option<String>,
) -> Result<Partner, String> {
    let trimmed_tenant_id = tenant_id.trim();
    if trimmed_tenant_id.is_empty() {
        return Err("Tenant ID cannot be empty".to_string());
    }

    let trimmed_id = id.trim();
    if trimmed_id.is_empty() {
        return Err("Partner ID cannot be empty".to_string());
    }

    // Tenant isolation: fetch existing partner strictly within active tenant
    let mut stmt = conn
        .prepare("SELECT id, tenant_id, name, is_customer, is_vendor, tax_id, payment_terms_type, payment_terms_days, collection_terms_type, collection_terms_days, requested_collection_terms_note, invoice_issuance_mode, created_at FROM partners WHERE id = ?1 AND tenant_id = ?2 LIMIT 1")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let existing = stmt
        .query_row(params![trimmed_id, trimmed_tenant_id], |row| {
            let is_cust_int: i64 = row.get(3)?;
            let is_vend_int: i64 = row.get(4)?;
            Ok(Partner {
                id: row.get(0)?,
                tenant_id: row.get(1)?,
                name: row.get(2)?,
                is_customer: is_cust_int == 1,
                is_vendor: is_vend_int == 1,
                tax_id: row.get(5)?,
                payment_terms_type: row.get(6)?,
                payment_terms_days: row.get(7)?,
                collection_terms_type: row.get(8)?,
                collection_terms_days: row.get(9)?,
                requested_collection_terms_note: row.get(10)?,
                invoice_issuance_mode: row.get(11)?,
                created_at: row.get(12)?,
            })
        })
        .map_err(|_| "Partner not found".to_string())?;

    // Handle name update and duplicate checking excluding self
    let new_name = match name {
        Some(n) => {
            let trimmed_n = n.trim().to_string();
            if trimmed_n.is_empty() {
                return Err("合作夥伴名稱不能為空".to_string());
            }
            let mut name_stmt = conn
                .prepare("SELECT 1 FROM partners WHERE tenant_id = ?1 AND LOWER(TRIM(name)) = LOWER(?2) AND id != ?3 LIMIT 1")
                .map_err(|e| format!("Failed to prepare duplicate name query: {}", e))?;
            let has_dup = name_stmt
                .query_row(
                    params![trimmed_tenant_id, trimmed_n, trimmed_id],
                    |_| Ok(()),
                )
                .is_ok();
            if has_dup {
                return Err(format!(
                    "合作夥伴名稱「{}」已存在，請使用不同名稱",
                    trimmed_n
                ));
            }
            trimmed_n
        }
        None => existing.name,
    };

    // Handle tax_id update, normalization, and duplicate checking excluding self
    let new_tax_id = match tax_id {
        Some(t) => {
            let validated = validate_tax_id(Some(t))?;
            if let Some(ref tid) = validated {
                let mut tax_stmt = conn
                    .prepare("SELECT 1 FROM partners WHERE tenant_id = ?1 AND tax_id = ?2 AND id != ?3 LIMIT 1")
                    .map_err(|e| format!("Failed to prepare duplicate tax query: {}", e))?;
                let has_dup = tax_stmt
                    .query_row(params![trimmed_tenant_id, tid, trimmed_id], |_| Ok(()))
                    .is_ok();
                if has_dup {
                    return Err(format!("統一編號「{}」已由其他合作夥伴登記", tid));
                }
            }
            validated
        }
        None => existing.tax_id,
    };

    // Handle payment terms update, clearing, and validation (PT-01, PT-02, PT-03)
    let (new_terms_type, new_terms_days) = if clear_payment_terms == Some(true) {
        (None, None)
    } else if payment_terms_type.is_some() || payment_terms_days.is_some() {
        if payment_terms_type.as_deref().map(str::trim) == Some("") && payment_terms_days.is_none()
        {
            (None, None)
        } else {
            validate_payment_terms(existing.is_vendor, payment_terms_type, payment_terms_days)?
        }
    } else {
        (existing.payment_terms_type, existing.payment_terms_days)
    };

    // Handle collection terms update, clearing, and validation (CT-01, CT-02, CT-03, CT-04)
    let (new_col_type, new_col_days) = if clear_collection_terms == Some(true) {
        (None, None)
    } else if collection_terms_type.is_some() || collection_terms_days.is_some() {
        if collection_terms_type.as_deref().map(str::trim) == Some("")
            && collection_terms_days.is_none()
        {
            (None, None)
        } else {
            validate_collection_terms(
                existing.is_customer,
                collection_terms_type,
                collection_terms_days,
            )?
        }
    } else {
        (
            existing.collection_terms_type,
            existing.collection_terms_days,
        )
    };

    // Handle requested_collection_terms_note
    let new_note = if clear_requested_collection_terms_note == Some(true) {
        None
    } else if let Some(ref note) = requested_collection_terms_note {
        let trimmed = note.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    } else {
        existing.requested_collection_terms_note
    };

    // Handle invoice_issuance_mode (CT-05, CT-06)
    let new_invoice_mode = if let Some(ref mode) = invoice_issuance_mode {
        validate_invoice_issuance_mode(existing.is_customer, Some(mode.clone()))?
    } else {
        existing.invoice_issuance_mode.or(if existing.is_customer {
            Some("per_order".to_string())
        } else {
            None
        })
    };

    conn.execute(
        "UPDATE partners SET name = ?1, tax_id = ?2, payment_terms_type = ?3, payment_terms_days = ?4, collection_terms_type = ?5, collection_terms_days = ?6, requested_collection_terms_note = ?7, invoice_issuance_mode = ?8 WHERE id = ?9 AND tenant_id = ?10",
        params![new_name, new_tax_id, new_terms_type, new_terms_days, new_col_type, new_col_days, new_note, new_invoice_mode, trimmed_id, trimmed_tenant_id],
    )
    .map_err(|e| format!("Failed to update partner: {}", e))?;

    Ok(Partner {
        id: existing.id,
        tenant_id: existing.tenant_id,
        name: new_name,
        is_customer: existing.is_customer,
        is_vendor: existing.is_vendor,
        tax_id: new_tax_id,
        payment_terms_type: new_terms_type,
        payment_terms_days: new_terms_days,
        collection_terms_type: new_col_type,
        collection_terms_days: new_col_days,
        requested_collection_terms_note: new_note,
        invoice_issuance_mode: new_invoice_mode,
        created_at: existing.created_at,
    })
}

// Usecase: list_partners
pub fn list_partners_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    filter_customer: Option<bool>,
    filter_vendor: Option<bool>,
) -> Result<Vec<Partner>, String> {
    let trimmed_tenant_id = tenant_id.trim();
    if trimmed_tenant_id.is_empty() {
        return Ok(Vec::new());
    }

    let mut query =
        "SELECT id, tenant_id, name, is_customer, is_vendor, tax_id, payment_terms_type, payment_terms_days, collection_terms_type, collection_terms_days, requested_collection_terms_note, invoice_issuance_mode, created_at FROM partners WHERE tenant_id = ?1".to_string();
    let mut conditions = Vec::new();

    if let Some(true) = filter_customer {
        conditions.push("is_customer = 1");
    }
    if let Some(true) = filter_vendor {
        conditions.push("is_vendor = 1");
    }

    if !conditions.is_empty() {
        query.push_str(" AND ");
        query.push_str(&conditions.join(" AND "));
    }
    query.push_str(" ORDER BY created_at ASC");

    let mut stmt = conn
        .prepare(&query)
        .map_err(|e| format!("Failed to prepare list_partners query: {}", e))?;

    let rows = stmt
        .query_map(params![trimmed_tenant_id], |row| {
            let is_cust_int: i64 = row.get(3)?;
            let is_vend_int: i64 = row.get(4)?;
            Ok(Partner {
                id: row.get(0)?,
                tenant_id: row.get(1)?,
                name: row.get(2)?,
                is_customer: is_cust_int == 1,
                is_vendor: is_vend_int == 1,
                tax_id: row.get(5)?,
                payment_terms_type: row.get(6)?,
                payment_terms_days: row.get(7)?,
                collection_terms_type: row.get(8)?,
                collection_terms_days: row.get(9)?,
                requested_collection_terms_note: row.get(10)?,
                invoice_issuance_mode: row.get(11)?,
                created_at: row.get(12)?,
            })
        })
        .map_err(|e| format!("Failed to query partners: {}", e))?;

    let mut partners = Vec::new();
    for p_res in rows {
        partners.push(p_res.map_err(|e| format!("Error reading partner row: {}", e))?);
    }

    Ok(partners)
}

// Delivery layer: Tauri Commands
#[allow(clippy::too_many_arguments)]
#[tauri::command]
#[specta::specta]
pub async fn create_partner<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    name: String,
    is_customer: Option<bool>,
    is_vendor: Option<bool>,
    tax_id: Option<String>,
    payment_terms_type: Option<String>,
    payment_terms_days: Option<i64>,
    collection_terms_type: Option<String>,
    collection_terms_days: Option<i64>,
    requested_collection_terms_note: Option<String>,
    invoice_issuance_mode: Option<String>,
) -> Result<Partner, String> {
    let db_path = get_db_path(&app_handle);
    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Failed to open DB: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    create_partner_with_all_terms_impl(
        &conn,
        &active_tid,
        name,
        is_customer,
        is_vendor,
        tax_id,
        payment_terms_type,
        payment_terms_days,
        collection_terms_type,
        collection_terms_days,
        requested_collection_terms_note,
        invoice_issuance_mode,
    )
}

#[tauri::command]
#[specta::specta]
pub async fn list_partners<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    filter_customer: Option<bool>,
    filter_vendor: Option<bool>,
) -> Result<Vec<Partner>, String> {
    let db_path = get_db_path(&app_handle);
    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Failed to open DB: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    list_partners_impl(&conn, &active_tid, filter_customer, filter_vendor)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
#[specta::specta]
pub async fn update_partner<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    id: String,
    name: Option<String>,
    tax_id: Option<String>,
    payment_terms_type: Option<String>,
    payment_terms_days: Option<i64>,
    clear_payment_terms: Option<bool>,
    collection_terms_type: Option<String>,
    collection_terms_days: Option<i64>,
    clear_collection_terms: Option<bool>,
    requested_collection_terms_note: Option<String>,
    clear_requested_collection_terms_note: Option<bool>,
    invoice_issuance_mode: Option<String>,
) -> Result<Partner, String> {
    let db_path = get_db_path(&app_handle);
    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Failed to open DB: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    update_partner_with_all_terms_impl(
        &conn,
        &active_tid,
        id,
        name,
        tax_id,
        payment_terms_type,
        payment_terms_days,
        clear_payment_terms,
        collection_terms_type,
        collection_terms_days,
        clear_collection_terms,
        requested_collection_terms_note,
        clear_requested_collection_terms_note,
        invoice_issuance_mode,
    )
}

#[cfg(test)]
pub mod tests {
    use super::*;

    pub const TEST_TENANT: &str = "tnt_test";
    pub const TEST_TENANT_B: &str = "tnt_other";

    pub fn setup_test_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        create_partners_table(&conn).unwrap();
        conn
    }

    #[test]
    fn test_tc_ptr_n_01_create_partner_name_only_success() {
        // Given: An initialized database and a valid customer name without tax_id
        let conn = setup_test_db();
        let name = "台積電".to_string();

        // When: create_partner_impl is executed with default customer flags
        let result = create_partner_impl(&conn, TEST_TENANT, name.clone(), None, None, None);

        // Then: The partner is created with is_customer=true, is_vendor=false, tax_id=None
        assert!(result.is_ok());
        let partner = result.unwrap();
        assert_eq!(partner.tenant_id, TEST_TENANT);
        assert_eq!(partner.name, name);
        assert!(partner.is_customer);
        assert!(!partner.is_vendor);
        assert_eq!(partner.tax_id, None);
        assert!(partner.created_at > 0);
        assert!(partner.id.starts_with("part_"));
    }

    #[test]
    fn test_tc_ptr_n_02_create_partner_with_tax_id_success() {
        // Given: An initialized database with name and valid tax_id
        let conn = setup_test_db();
        let name = "聯發科技".to_string();
        let tax_id = Some("12345678".to_string());

        // When: create_partner_impl is executed
        let result = create_partner_impl(
            &conn,
            TEST_TENANT,
            name.clone(),
            Some(true),
            Some(false),
            tax_id,
        );

        // Then: Partner is created with tax_id correctly stored
        assert!(result.is_ok());
        let partner = result.unwrap();
        assert_eq!(partner.tenant_id, TEST_TENANT);
        assert_eq!(partner.name, "聯發科技");
        assert_eq!(partner.tax_id, Some("12345678".to_string()));
        assert!(partner.is_customer);
        assert!(!partner.is_vendor);
    }

    #[test]
    fn test_tc_ptr_n_03_list_partners_chronological_order() {
        // Given: Multiple partners created in sequence within TEST_TENANT
        let conn = setup_test_db();
        let p1 = create_partner_impl(
            &conn,
            TEST_TENANT,
            "客戶甲".to_string(),
            Some(true),
            None,
            None,
        )
        .unwrap();
        let p2 = create_partner_impl(
            &conn,
            TEST_TENANT,
            "客戶乙".to_string(),
            Some(true),
            None,
            None,
        )
        .unwrap();
        let p3 = create_partner_impl(
            &conn,
            TEST_TENANT,
            "廠商丙".to_string(),
            Some(false),
            Some(true),
            None,
        )
        .unwrap();

        // When: list_partners_impl is called without filter
        let all = list_partners_impl(&conn, TEST_TENANT, None, None).unwrap();

        // Then: All 3 partners are returned in ascending creation order
        assert_eq!(all.len(), 3);
        assert_eq!(all[0].id, p1.id);
        assert_eq!(all[1].id, p2.id);
        assert_eq!(all[2].id, p3.id);

        // And When: list_partners_impl is called with filter_customer=Some(true)
        let customers = list_partners_impl(&conn, TEST_TENANT, Some(true), None).unwrap();

        // Then: Only 2 customer partners are returned
        assert_eq!(customers.len(), 2);
        assert_eq!(customers[0].id, p1.id);
        assert_eq!(customers[1].id, p2.id);
    }

    #[test]
    fn test_tc_ptr_n_04_dual_identity_partner_success() {
        // Given: A partner that is both customer and vendor (aligned with TPS2 PartnerType)
        let conn = setup_test_db();
        let name = "大同公司".to_string();

        // When: create_partner_impl is executed with is_customer=true and is_vendor=true
        let result = create_partner_impl(
            &conn,
            TEST_TENANT,
            name.clone(),
            Some(true),
            Some(true),
            Some("03080006".to_string()),
        );

        // Then: Both flags are true
        assert!(result.is_ok());
        let partner = result.unwrap();
        assert_eq!(partner.tenant_id, TEST_TENANT);
        assert!(partner.is_customer);
        assert!(partner.is_vendor);
        assert_eq!(partner.tax_id, Some("03080006".to_string()));
    }

    #[test]
    fn test_tc_ptr_b_01_create_partner_trims_whitespace() {
        // Given: Partner name with leading and trailing whitespace
        let conn = setup_test_db();
        let raw_name = "   華碩電腦   ".to_string();

        // When: create_partner_impl is executed
        let result = create_partner_impl(&conn, TEST_TENANT, raw_name, None, None, None).unwrap();

        // Then: The stored name is trimmed
        assert_eq!(result.name, "華碩電腦");
    }

    #[test]
    fn test_tc_ptr_b_02_create_partner_normalizes_empty_tax_id() {
        // Given: tax_id with empty string or whitespace
        let conn = setup_test_db();

        // When: create_partner_impl is executed with whitespace tax_id
        let res1 = create_partner_impl(
            &conn,
            TEST_TENANT,
            "客戶A".to_string(),
            None,
            None,
            Some("".to_string()),
        )
        .unwrap();
        let res2 = create_partner_impl(
            &conn,
            TEST_TENANT,
            "客戶B".to_string(),
            None,
            None,
            Some("   ".to_string()),
        )
        .unwrap();

        // Then: tax_id is normalized to None
        assert_eq!(res1.tax_id, None);
        assert_eq!(res2.tax_id, None);
    }

    #[test]
    fn test_tc_ptr_b_03_and_04_create_partner_empty_name_error() {
        // Given: An initialized database
        let conn = setup_test_db();

        // When: create_partner_impl is called with empty string and whitespace-only string
        let err_empty = create_partner_impl(&conn, TEST_TENANT, "".to_string(), None, None, None);
        let err_whitespace =
            create_partner_impl(&conn, TEST_TENANT, "    ".to_string(), None, None, None);

        // Then: Both return validation errors
        assert!(err_empty.is_err());
        assert_eq!(err_empty.unwrap_err(), "Partner name cannot be empty");
        assert!(err_whitespace.is_err());
        assert_eq!(err_whitespace.unwrap_err(), "Partner name cannot be empty");
    }

    #[test]
    fn test_tc_ptr_b_05_list_partners_empty() {
        // Given: Empty database
        let conn = setup_test_db();

        // When: list_partners_impl is called
        let list = list_partners_impl(&conn, TEST_TENANT, None, None).unwrap();

        // Then: Empty vector is returned
        assert_eq!(list.len(), 0);
    }

    #[test]
    fn test_tc_ptr_e_01_duplicate_name_error() {
        // Given: Existing partner "台積電" in TEST_TENANT
        let conn = setup_test_db();
        create_partner_impl(&conn, TEST_TENANT, "台積電".to_string(), None, None, None).unwrap();

        // When: Attempting to create another partner with identical name "台積電" in the same tenant
        let result =
            create_partner_impl(&conn, TEST_TENANT, "台積電".to_string(), None, None, None);

        // Then: Duplicate error is returned
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            "合作夥伴／客戶「台積電」已存在，請使用不同名稱"
        );
    }

    #[test]
    fn test_tc_ptr_e_02_duplicate_case_insensitive_and_trimmed_error() {
        // Given: Existing partner "TSMC" in TEST_TENANT
        let conn = setup_test_db();
        create_partner_impl(&conn, TEST_TENANT, "TSMC".to_string(), None, None, None).unwrap();

        // When: Attempting to create partner with "  tsmc  " in the same tenant
        let result =
            create_partner_impl(&conn, TEST_TENANT, "  tsmc  ".to_string(), None, None, None);

        // Then: Duplicate check detects match case-insensitively and returns error
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            "合作夥伴／客戶「tsmc」已存在，請使用不同名稱"
        );
    }

    #[test]
    fn test_tc_vnd_n_01_create_vendor_name_only_success() {
        // Given: An initialized database and a vendor name without tax_id
        let conn = setup_test_db();
        let name = "日月光半導體".to_string();

        // When: create_partner_impl is executed with is_vendor=Some(true)
        let result = create_partner_impl(&conn, TEST_TENANT, name.clone(), None, Some(true), None);

        // Then: Partner is created with is_vendor=true, is_customer=false, tax_id=None
        assert!(result.is_ok());
        let partner = result.unwrap();
        assert_eq!(partner.name, name);
        assert!(!partner.is_customer);
        assert!(partner.is_vendor);
        assert_eq!(partner.tax_id, None);
    }

    #[test]
    fn test_tc_vnd_n_02_create_vendor_with_tax_id_success() {
        // Given: An initialized database with vendor name and tax_id
        let conn = setup_test_db();
        let name = "欣興電子".to_string();
        let tax_id = Some("11223344".to_string());

        // When: create_partner_impl is executed with vendor flag and tax_id
        let result = create_partner_impl(
            &conn,
            TEST_TENANT,
            name.clone(),
            Some(false),
            Some(true),
            tax_id,
        );

        // Then: Partner is created with is_vendor=true, tax_id stored
        assert!(result.is_ok());
        let partner = result.unwrap();
        assert_eq!(partner.name, "欣興電子");
        assert_eq!(partner.tax_id, Some("11223344".to_string()));
        assert!(!partner.is_customer);
        assert!(partner.is_vendor);
    }

    #[test]
    fn test_tc_vnd_n_03_existing_customer_overlay_vendor_identity() {
        // Given: Existing customer "台積電" (is_customer=true, is_vendor=false)
        let conn = setup_test_db();
        let original = create_partner_impl(
            &conn,
            TEST_TENANT,
            "台積電".to_string(),
            Some(true),
            Some(false),
            None,
        )
        .unwrap();
        assert!(original.is_customer);
        assert!(!original.is_vendor);

        // When: Registering the same partner as a vendor
        let overlay_result = create_partner_impl(
            &conn,
            TEST_TENANT,
            "台積電".to_string(),
            None,
            Some(true),
            None,
        );

        // Then: The existing record is updated with is_vendor=true, retaining is_customer=true and original id
        assert!(overlay_result.is_ok());
        let updated = overlay_result.unwrap();
        assert_eq!(updated.id, original.id);
        assert_eq!(updated.name, "台積電");
        assert!(updated.is_customer);
        assert!(updated.is_vendor);

        // And: Total count in database remains 1
        let all = list_partners_impl(&conn, TEST_TENANT, None, None).unwrap();
        assert_eq!(all.len(), 1);
    }

    #[test]
    fn test_tc_vnd_n_04_existing_vendor_overlay_customer_identity() {
        // Given: Existing vendor "穩懋半導體" (is_customer=false, is_vendor=true)
        let conn = setup_test_db();
        let original = create_partner_impl(
            &conn,
            TEST_TENANT,
            "穩懋半導體".to_string(),
            Some(false),
            Some(true),
            None,
        )
        .unwrap();

        // When: Registering the same partner as a customer
        let overlay_result = create_partner_impl(
            &conn,
            TEST_TENANT,
            "穩懋半導體".to_string(),
            Some(true),
            None,
            None,
        );

        // Then: Existing record is updated with is_customer=true, retaining is_vendor=true
        assert!(overlay_result.is_ok());
        let updated = overlay_result.unwrap();
        assert_eq!(updated.id, original.id);
        assert!(updated.is_customer);
        assert!(updated.is_vendor);

        // And: Total count in database remains 1
        let all = list_partners_impl(&conn, TEST_TENANT, None, None).unwrap();
        assert_eq!(all.len(), 1);
    }

    #[test]
    fn test_tc_vnd_n_05_overlay_identity_merges_tax_id() {
        // Given: Existing customer without tax_id
        let conn = setup_test_db();
        let p = create_partner_impl(
            &conn,
            TEST_TENANT,
            "華邦電".to_string(),
            Some(true),
            None,
            None,
        )
        .unwrap();
        assert_eq!(p.tax_id, None);

        // When: Overlaying vendor identity with a new tax_id
        let updated = create_partner_impl(
            &conn,
            TEST_TENANT,
            "華邦電".to_string(),
            None,
            Some(true),
            Some("22334455".to_string()),
        )
        .unwrap();

        // Then: tax_id is updated and both flags are true
        assert_eq!(updated.tax_id, Some("22334455".to_string()));
        assert!(updated.is_customer);
        assert!(updated.is_vendor);
    }

    #[test]
    fn test_tc_vnd_n_06_list_partners_filter_vendor() {
        // Given: 1 pure customer, 1 pure vendor, 1 dual identity partner
        let conn = setup_test_db();
        create_partner_impl(
            &conn,
            TEST_TENANT,
            "客戶A".to_string(),
            Some(true),
            Some(false),
            None,
        )
        .unwrap();
        create_partner_impl(
            &conn,
            TEST_TENANT,
            "廠商B".to_string(),
            Some(false),
            Some(true),
            None,
        )
        .unwrap();
        create_partner_impl(
            &conn,
            TEST_TENANT,
            "綜合C".to_string(),
            Some(true),
            Some(true),
            None,
        )
        .unwrap();

        // When: Querying with filter_vendor=Some(true)
        let vendors = list_partners_impl(&conn, TEST_TENANT, None, Some(true)).unwrap();

        // Then: Only 2 vendors are returned
        assert_eq!(vendors.len(), 2);
        assert_eq!(vendors[0].name, "廠商B");
        assert_eq!(vendors[1].name, "綜合C");
    }

    #[test]
    fn test_tc_vnd_e_01_duplicate_vendor_error() {
        // Given: Existing vendor "日月光"
        let conn = setup_test_db();
        create_partner_impl(
            &conn,
            TEST_TENANT,
            "日月光".to_string(),
            Some(false),
            Some(true),
            None,
        )
        .unwrap();

        // When: Attempting to register "日月光" as vendor again
        let result = create_partner_impl(
            &conn,
            TEST_TENANT,
            "日月光".to_string(),
            Some(false),
            Some(true),
            None,
        );

        // Then: Duplicate vendor error is returned
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            "合作夥伴／供應商「日月光」已存在，請使用不同名稱"
        );
    }

    #[test]
    fn test_tc_vnd_e_02_duplicate_vendor_case_insensitive_error() {
        // Given: Existing vendor "ASE"
        let conn = setup_test_db();
        create_partner_impl(
            &conn,
            TEST_TENANT,
            "ASE".to_string(),
            Some(false),
            Some(true),
            None,
        )
        .unwrap();

        // When: Attempting to register "  ase  " as vendor
        let result = create_partner_impl(
            &conn,
            TEST_TENANT,
            "  ase  ".to_string(),
            Some(false),
            Some(true),
            None,
        );

        // Then: Duplicate vendor error is returned
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            "合作夥伴／供應商「ase」已存在，請使用不同名稱"
        );
    }

    #[test]
    fn test_tc_ptr_iso_01_cross_tenant_same_name_success() {
        // Given: Partner "台積電" registered in TEST_TENANT
        let conn = setup_test_db();
        let res_a = create_partner_impl(
            &conn,
            TEST_TENANT,
            "台積電".to_string(),
            Some(true),
            None,
            Some("22099131".to_string()),
        );
        assert!(res_a.is_ok());

        // When: Attempting to register the same partner name "台積電" in TEST_TENANT_B
        let res_b = create_partner_impl(
            &conn,
            TEST_TENANT_B,
            "台積電".to_string(),
            Some(true),
            None,
            Some("22099131".to_string()),
        );

        // Then: Registration succeeds independently without duplicate conflict
        assert!(res_b.is_ok());
        let partner_b = res_b.unwrap();
        assert_eq!(partner_b.tenant_id, TEST_TENANT_B);
        assert_eq!(partner_b.name, "台積電");
        assert_ne!(res_a.unwrap().id, partner_b.id);
    }

    #[test]
    fn test_tc_ptr_iso_02_list_partners_tenant_isolation() {
        // Given: 2 partners in TEST_TENANT and 1 partner in TEST_TENANT_B
        let conn = setup_test_db();
        create_partner_impl(
            &conn,
            TEST_TENANT,
            "租戶A客戶1".to_string(),
            Some(true),
            None,
            None,
        )
        .unwrap();
        create_partner_impl(
            &conn,
            TEST_TENANT,
            "租戶A廠商2".to_string(),
            None,
            Some(true),
            None,
        )
        .unwrap();
        create_partner_impl(
            &conn,
            TEST_TENANT_B,
            "租戶B客戶1".to_string(),
            Some(true),
            None,
            None,
        )
        .unwrap();

        // When: Querying partners for TEST_TENANT
        let list_a = list_partners_impl(&conn, TEST_TENANT, None, None).unwrap();
        // And When: Querying partners for TEST_TENANT_B
        let list_b = list_partners_impl(&conn, TEST_TENANT_B, None, None).unwrap();
        // And When: Querying partners for unknown tenant
        let list_unknown = list_partners_impl(&conn, "tnt_non_existent", None, None).unwrap();

        // Then: Each query strictly isolates data by tenant
        assert_eq!(list_a.len(), 2);
        assert!(list_a.iter().all(|p| p.tenant_id == TEST_TENANT));
        assert_eq!(list_b.len(), 1);
        assert_eq!(list_b[0].tenant_id, TEST_TENANT_B);
        assert_eq!(list_b[0].name, "租戶B客戶1");
        assert_eq!(list_unknown.len(), 0);
    }

    #[test]
    fn test_tc_ptr_iso_03_cross_tenant_overlay_not_affected() {
        // Given: Customer "華碩" registered in TEST_TENANT
        let conn = setup_test_db();
        create_partner_impl(
            &conn,
            TEST_TENANT,
            "華碩".to_string(),
            Some(true),
            Some(false),
            None,
        )
        .unwrap();

        // When: Vendor "華碩" is registered in TEST_TENANT_B
        let res_b = create_partner_impl(
            &conn,
            TEST_TENANT_B,
            "華碩".to_string(),
            Some(false),
            Some(true),
            None,
        )
        .unwrap();

        // Then: TEST_TENANT_B's record has vendor flag only
        assert!(!res_b.is_customer);
        assert!(res_b.is_vendor);

        // And: TEST_TENANT's record remains unaffected (still customer only, not overlaid)
        let list_a = list_partners_impl(&conn, TEST_TENANT, None, None).unwrap();
        assert_eq!(list_a.len(), 1);
        assert!(list_a[0].is_customer);
        assert!(!list_a[0].is_vendor);
    }

    #[test]
    fn test_tc_ptr_iso_b01_and_b02_empty_tenant_id_error() {
        // Given: Initialized database
        let conn = setup_test_db();

        // When: Creating partner with empty string or whitespace tenant_id
        let err_empty = create_partner_impl(&conn, "", "台積電".to_string(), None, None, None);
        let err_space = create_partner_impl(&conn, "   ", "台積電".to_string(), None, None, None);

        // Then: Validation error is returned
        assert!(err_empty.is_err());
        assert_eq!(err_empty.unwrap_err(), "Tenant ID cannot be empty");
        assert!(err_space.is_err());
        assert_eq!(err_space.unwrap_err(), "Tenant ID cannot be empty");
    }

    #[test]
    fn test_tc_ptr_iso_b03_empty_tenant_id_list_returns_empty() {
        // Given: Initialized database with a partner
        let conn = setup_test_db();
        create_partner_impl(&conn, TEST_TENANT, "台積電".to_string(), None, None, None).unwrap();

        // When: Listing partners with empty or whitespace tenant_id
        let list_empty = list_partners_impl(&conn, "", None, None).unwrap();
        let list_space = list_partners_impl(&conn, "   ", None, None).unwrap();

        // Then: Empty list is returned without error
        assert_eq!(list_empty.len(), 0);
        assert_eq!(list_space.len(), 0);
    }

    // --- Issue #147 Test Cases ---

    #[test]
    fn test_tc_part_pos_01_update_tax_id_success() {
        // Given: Pre-existing customer without tax ID
        let conn = setup_test_db();
        let created =
            create_partner_impl(&conn, TEST_TENANT, "台積電".to_string(), None, None, None)
                .unwrap();
        assert_eq!(created.tax_id, None);

        // When: update_partner_impl is called with valid 8-digit tax_id
        let updated = update_partner_impl(
            &conn,
            TEST_TENANT,
            created.id.clone(),
            None,
            Some("22099131".to_string()),
        )
        .unwrap();

        // Then: tax_id is successfully updated to "22099131"
        assert_eq!(updated.id, created.id);
        assert_eq!(updated.name, "台積電");
        assert_eq!(updated.tax_id, Some("22099131".to_string()));
    }

    #[test]
    fn test_tc_part_pos_02_overwrite_tax_id_success() {
        // Given: Pre-existing customer with old tax ID
        let conn = setup_test_db();
        let created = create_partner_impl(
            &conn,
            TEST_TENANT,
            "台積電".to_string(),
            None,
            None,
            Some("22099131".to_string()),
        )
        .unwrap();
        assert_eq!(created.tax_id, Some("22099131".to_string()));

        // When: update_partner_impl is called with a new valid tax_id
        let updated = update_partner_impl(
            &conn,
            TEST_TENANT,
            created.id.clone(),
            None,
            Some("03795172".to_string()),
        )
        .unwrap();

        // Then: tax_id is updated to new tax ID
        assert_eq!(updated.tax_id, Some("03795172".to_string()));
    }

    #[test]
    fn test_tc_part_pos_03_update_name_only_keeps_other_fields() {
        // Given: Partner with name and tax ID
        let conn = setup_test_db();
        let created = create_partner_impl(
            &conn,
            TEST_TENANT,
            "聯發科".to_string(),
            None,
            None,
            Some("22099131".to_string()),
        )
        .unwrap();

        // When: Updating name only (tax_id is None)
        let updated = update_partner_impl(
            &conn,
            TEST_TENANT,
            created.id.clone(),
            Some("聯發科技".to_string()),
            None,
        )
        .unwrap();

        // Then: Name is updated and other fields (tax_id, identity flags) are preserved
        assert_eq!(updated.name, "聯發科技");
        assert_eq!(updated.tax_id, Some("22099131".to_string()));
        assert_eq!(updated.is_customer, true);
        assert_eq!(updated.is_vendor, false);
    }

    #[test]
    fn test_tc_part_pos_04_update_trims_whitespace() {
        // Given: Pre-existing partner
        let conn = setup_test_db();
        let created =
            create_partner_impl(&conn, TEST_TENANT, "華碩".to_string(), None, None, None).unwrap();

        // When: Updating with untrimmed name and untrimmed tax ID
        let updated = update_partner_impl(
            &conn,
            TEST_TENANT,
            created.id.clone(),
            Some("   華碩電腦   ".to_string()),
            Some("   22099131   ".to_string()),
        )
        .unwrap();

        // Then: Values are trimmed properly
        assert_eq!(updated.name, "華碩電腦");
        assert_eq!(updated.tax_id, Some("22099131".to_string()));
    }

    #[test]
    fn test_tc_part_pos_05_clear_tax_id_normalizes_to_none() {
        // Given: Partner with existing tax ID
        let conn = setup_test_db();
        let created = create_partner_impl(
            &conn,
            TEST_TENANT,
            "台積電".to_string(),
            None,
            None,
            Some("22099131".to_string()),
        )
        .unwrap();

        // When: Passing empty string or whitespace string as tax_id
        let updated_empty = update_partner_impl(
            &conn,
            TEST_TENANT,
            created.id.clone(),
            None,
            Some("".to_string()),
        )
        .unwrap();
        assert_eq!(updated_empty.tax_id, None);

        // When: Re-setting and passing whitespace only
        update_partner_impl(
            &conn,
            TEST_TENANT,
            created.id.clone(),
            None,
            Some("22099131".to_string()),
        )
        .unwrap();
        let updated_ws = update_partner_impl(
            &conn,
            TEST_TENANT,
            created.id.clone(),
            None,
            Some("   ".to_string()),
        )
        .unwrap();

        // Then: tax_id is normalized to None
        assert_eq!(updated_ws.tax_id, None);
    }

    #[test]
    fn test_tc_part_pos_06_update_with_same_values_excludes_self() {
        // Given: Partner with name and tax ID
        let conn = setup_test_db();
        let created = create_partner_impl(
            &conn,
            TEST_TENANT,
            "台積電".to_string(),
            None,
            None,
            Some("22099131".to_string()),
        )
        .unwrap();

        // When: Updating with the exact same name and tax ID
        let res = update_partner_impl(
            &conn,
            TEST_TENANT,
            created.id.clone(),
            Some("台積電".to_string()),
            Some("22099131".to_string()),
        );

        // Then: Self-exclusion works and update succeeds without duplicate error
        assert!(res.is_ok());
        let p = res.unwrap();
        assert_eq!(p.name, "台積電");
        assert_eq!(p.tax_id, Some("22099131".to_string()));
    }

    #[test]
    fn test_tc_part_neg_01_and_02_tax_id_format_errors() {
        // Given: Pre-existing partner
        let conn = setup_test_db();
        let created =
            create_partner_impl(&conn, TEST_TENANT, "測試夥伴".to_string(), None, None, None)
                .unwrap();

        // When: 7 digits
        let err_7 = update_partner_impl(
            &conn,
            TEST_TENANT,
            created.id.clone(),
            None,
            Some("1234567".to_string()),
        );
        // When: 9 digits
        let err_9 = update_partner_impl(
            &conn,
            TEST_TENANT,
            created.id.clone(),
            None,
            Some("123456789".to_string()),
        );
        // When: Non-digit characters
        let err_alpha = update_partner_impl(
            &conn,
            TEST_TENANT,
            created.id.clone(),
            None,
            Some("2209913A".to_string()),
        );
        let err_symbol = update_partner_impl(
            &conn,
            TEST_TENANT,
            created.id.clone(),
            None,
            Some("22-99131".to_string()),
        );

        // Then: All fail with tax ID format error
        assert_eq!(err_7.unwrap_err(), "統一編號必須為 8 碼半形數字");
        assert_eq!(err_9.unwrap_err(), "統一編號必須為 8 碼半形數字");
        assert_eq!(err_alpha.unwrap_err(), "統一編號必須為 8 碼半形數字");
        assert_eq!(err_symbol.unwrap_err(), "統一編號必須為 8 碼半形數字");
    }

    #[test]
    fn test_tc_part_neg_03_update_empty_name_error() {
        // Given: Pre-existing partner
        let conn = setup_test_db();
        let created =
            create_partner_impl(&conn, TEST_TENANT, "聯發科".to_string(), None, None, None)
                .unwrap();

        // When: Updating name to empty string or whitespace
        let err_empty = update_partner_impl(
            &conn,
            TEST_TENANT,
            created.id.clone(),
            Some("".to_string()),
            None,
        );
        let err_space = update_partner_impl(
            &conn,
            TEST_TENANT,
            created.id.clone(),
            Some("   ".to_string()),
            None,
        );

        // Then: Fails with empty name error
        assert_eq!(err_empty.unwrap_err(), "合作夥伴名稱不能為空");
        assert_eq!(err_space.unwrap_err(), "合作夥伴名稱不能為空");
    }

    #[test]
    fn test_tc_part_neg_04_create_duplicate_name_error() {
        // Given: Partner "台積電" exists
        let conn = setup_test_db();
        create_partner_impl(&conn, TEST_TENANT, "台積電".to_string(), None, None, None).unwrap();

        // When: Creating another partner with same name (with customer flag)
        let err = create_partner_impl(&conn, TEST_TENANT, "台積電".to_string(), None, None, None);

        // Then: Duplicate name error is returned
        assert!(err.is_err());
        assert!(err.unwrap_err().contains("已存在，請使用不同名稱"));
    }

    #[test]
    fn test_tc_part_neg_05_create_duplicate_tax_id_error() {
        // Given: Partner with tax_id "22099131" exists
        let conn = setup_test_db();
        create_partner_impl(
            &conn,
            TEST_TENANT,
            "台積電".to_string(),
            None,
            None,
            Some("22099131".to_string()),
        )
        .unwrap();

        // When: Creating another partner with different name but identical tax_id
        let err = create_partner_impl(
            &conn,
            TEST_TENANT,
            "聯發科".to_string(),
            None,
            None,
            Some("22099131".to_string()),
        );

        // Then: Rejected with specific duplicate tax_id error
        assert!(err.is_err());
        assert_eq!(err.unwrap_err(), "統一編號「22099131」已由其他合作夥伴登記");
    }

    #[test]
    fn test_tc_part_neg_06_update_duplicate_name_error() {
        // Given: Two partners exist in TEST_TENANT
        let conn = setup_test_db();
        create_partner_impl(&conn, TEST_TENANT, "台積電".to_string(), None, None, None).unwrap();
        let p2 = create_partner_impl(&conn, TEST_TENANT, "聯發科".to_string(), None, None, None)
            .unwrap();

        // When: Updating p2's name to "台積電" (case-insensitive & trimmed)
        let err = update_partner_impl(
            &conn,
            TEST_TENANT,
            p2.id.clone(),
            Some("  台積電  ".to_string()),
            None,
        );

        // Then: Rejected with duplicate name error
        assert!(err.is_err());
        assert_eq!(
            err.unwrap_err(),
            "合作夥伴名稱「台積電」已存在，請使用不同名稱"
        );
    }

    #[test]
    fn test_tc_part_neg_07_update_duplicate_tax_id_error() {
        // Given: Partner A with tax_id "22099131" and Partner B without tax_id
        let conn = setup_test_db();
        create_partner_impl(
            &conn,
            TEST_TENANT,
            "台積電".to_string(),
            None,
            None,
            Some("22099131".to_string()),
        )
        .unwrap();
        let p_b = create_partner_impl(&conn, TEST_TENANT, "聯發科".to_string(), None, None, None)
            .unwrap();

        // When: Updating p_b's tax_id to "22099131"
        let err = update_partner_impl(
            &conn,
            TEST_TENANT,
            p_b.id.clone(),
            None,
            Some("22099131".to_string()),
        );

        // Then: Rejected with duplicate tax_id error
        assert!(err.is_err());
        assert_eq!(err.unwrap_err(), "統一編號「22099131」已由其他合作夥伴登記");
    }

    #[test]
    fn test_tc_part_neg_08_update_nonexistent_partner_not_found() {
        // Given: Initialized database
        let conn = setup_test_db();

        // When: Updating non-existent partner ID
        let err = update_partner_impl(
            &conn,
            TEST_TENANT,
            "part_nonexistent".to_string(),
            Some("新名稱".to_string()),
            None,
        );

        // Then: Partner not found is returned
        assert!(err.is_err());
        assert_eq!(err.unwrap_err(), "Partner not found");
    }

    #[test]
    fn test_tc_part_bnd_01_cross_tenant_same_name_success() {
        // Given: Partner "台積電" in TEST_TENANT
        let conn = setup_test_db();
        create_partner_impl(&conn, TEST_TENANT, "台積電".to_string(), None, None, None).unwrap();

        // When: Creating/updating partner with same name "台積電" in TEST_TENANT_B
        let p_b = create_partner_impl(&conn, TEST_TENANT_B, "台積電".to_string(), None, None, None);

        // Then: Both succeed independently
        assert!(p_b.is_ok());
    }

    #[test]
    fn test_tc_part_bnd_02_cross_tenant_same_tax_id_success() {
        // Given: Partner with tax_id "22099131" in TEST_TENANT
        let conn = setup_test_db();
        create_partner_impl(
            &conn,
            TEST_TENANT,
            "台積電".to_string(),
            None,
            None,
            Some("22099131".to_string()),
        )
        .unwrap();

        // When: Partner in TEST_TENANT_B registers the same tax_id "22099131"
        let p_b = create_partner_impl(
            &conn,
            TEST_TENANT_B,
            "分公司".to_string(),
            None,
            None,
            Some("22099131".to_string()),
        );

        // Then: Succeeds because tax_id is scoped to tenant_id
        assert!(p_b.is_ok());
    }

    #[test]
    fn test_tc_part_bnd_03_cross_tenant_update_enumeration_defense() {
        // Given: Partner exists in TEST_TENANT_B
        let conn = setup_test_db();
        let p_b = create_partner_impl(
            &conn,
            TEST_TENANT_B,
            "秘密客戶".to_string(),
            None,
            None,
            None,
        )
        .unwrap();

        // When: Tenant TEST_TENANT attempts to update p_b using p_b.id
        let err = update_partner_impl(
            &conn,
            TEST_TENANT,
            p_b.id.clone(),
            Some("篡改名稱".to_string()),
            Some("22099131".to_string()),
        );

        // Then: Denied with "Partner not found" to prevent enumeration
        assert!(err.is_err());
        assert_eq!(err.unwrap_err(), "Partner not found");

        // Verify record in TEST_TENANT_B remains unchanged
        let list_b = list_partners_impl(&conn, TEST_TENANT_B, None, None).unwrap();
        assert_eq!(list_b.len(), 1);
        assert_eq!(list_b[0].name, "秘密客戶");
        assert_eq!(list_b[0].tax_id, None);
    }

    #[test]
    fn test_tc_pt_n_01_create_and_update_vendor_payment_terms_success() {
        // Given: Clean database
        let conn = setup_test_db();

        // When: create_partner_with_terms_impl is called with vendor and net 30
        let created = create_partner_with_terms_impl(
            &conn,
            TEST_TENANT,
            "優質供應商".to_string(),
            None,
            Some(true),
            None,
            Some("net".to_string()),
            Some(30),
        )
        .unwrap();

        // Then: Successfully saved with payment terms
        assert_eq!(created.payment_terms_type, Some("net".to_string()));
        assert_eq!(created.payment_terms_days, Some(30));

        // When: update_partner_with_terms_impl is called with month_end 60
        let updated = update_partner_with_terms_impl(
            &conn,
            TEST_TENANT,
            created.id.clone(),
            None,
            None,
            Some("month_end".to_string()),
            Some(60),
            None,
        )
        .unwrap();

        // Then: Successfully updated
        assert_eq!(updated.payment_terms_type, Some("month_end".to_string()));
        assert_eq!(updated.payment_terms_days, Some(60));
    }

    #[test]
    fn test_tc_pt_n_02_and_03_payment_terms_boundaries_0_and_365() {
        // Given: Clean database
        let conn = setup_test_db();

        // When: Creating vendor with month_end 0 days (boundary: 0)
        let p1 = create_partner_with_terms_impl(
            &conn,
            TEST_TENANT,
            "廠商A".to_string(),
            None,
            Some(true),
            None,
            Some("month_end".to_string()),
            Some(0),
        )
        .unwrap();

        // Then: Succeeds with 0 days
        assert_eq!(p1.payment_terms_type, Some("month_end".to_string()));
        assert_eq!(p1.payment_terms_days, Some(0));

        // When: Creating vendor with net 365 days (boundary: 365)
        let p2 = create_partner_with_terms_impl(
            &conn,
            TEST_TENANT,
            "廠商B".to_string(),
            None,
            Some(true),
            None,
            Some("net".to_string()),
            Some(365),
        )
        .unwrap();

        // Then: Succeeds with 365 days
        assert_eq!(p2.payment_terms_type, Some("net".to_string()));
        assert_eq!(p2.payment_terms_days, Some(365));
    }

    #[test]
    fn test_tc_pt_n_04_default_unconfigured_payment_terms() {
        // Given: Clean database
        let conn = setup_test_db();

        // When: Creating partner without payment terms
        let p = create_partner_impl(
            &conn,
            TEST_TENANT,
            "無條件廠商".to_string(),
            None,
            Some(true),
            None,
        )
        .unwrap();

        // Then: payment terms are None
        assert_eq!(p.payment_terms_type, None);
        assert_eq!(p.payment_terms_days, None);
    }

    #[test]
    fn test_tc_pt_n_05_clear_payment_terms() {
        // Given: Vendor with configured payment terms
        let conn = setup_test_db();
        let created = create_partner_with_terms_impl(
            &conn,
            TEST_TENANT,
            "待清空廠商".to_string(),
            None,
            Some(true),
            None,
            Some("net".to_string()),
            Some(30),
        )
        .unwrap();
        assert_eq!(created.payment_terms_type, Some("net".to_string()));

        // When: Updating with clear_payment_terms = Some(true)
        let cleared = update_partner_with_terms_impl(
            &conn,
            TEST_TENANT,
            created.id.clone(),
            None,
            None,
            None,
            None,
            Some(true),
        )
        .unwrap();

        // Then: Payment terms are reset to None
        assert_eq!(cleared.payment_terms_type, None);
        assert_eq!(cleared.payment_terms_days, None);
    }

    #[test]
    fn test_tc_pt_e_01_and_02_pt01_must_set_both_or_neither() {
        // Given: Clean database
        let conn = setup_test_db();

        // When: Only type provided, days is None
        let err1 = create_partner_with_terms_impl(
            &conn,
            TEST_TENANT,
            "廠商_缺天數".to_string(),
            None,
            Some(true),
            None,
            Some("net".to_string()),
            None,
        );

        // Then: Fails with PT-01 error message
        assert!(err1.is_err());
        assert_eq!(err1.unwrap_err(), "付款條件類型與天數需同時設定");

        // When: Only days provided, type is None
        let err2 = create_partner_with_terms_impl(
            &conn,
            TEST_TENANT,
            "廠商_缺類型".to_string(),
            None,
            Some(true),
            None,
            None,
            Some(30),
        );

        // Then: Fails with PT-01 error message
        assert!(err2.is_err());
        assert_eq!(err2.unwrap_err(), "付款條件類型與天數需同時設定");
    }

    #[test]
    fn test_tc_pt_e_03_to_05_pt02_invalid_type_and_days_boundaries() {
        // Given: Clean database
        let conn = setup_test_db();

        // When: Invalid type "quarterly"
        let err_type = create_partner_with_terms_impl(
            &conn,
            TEST_TENANT,
            "廠商_非法類型".to_string(),
            None,
            Some(true),
            None,
            Some("quarterly".to_string()),
            Some(30),
        );
        // Then: Fails with type error
        assert!(err_type.is_err());
        assert_eq!(err_type.unwrap_err(), "付款條件類型需為 net 或 month_end");

        // When: Days < 0 (-1)
        let err_neg = create_partner_with_terms_impl(
            &conn,
            TEST_TENANT,
            "廠商_負數天數".to_string(),
            None,
            Some(true),
            None,
            Some("net".to_string()),
            Some(-1),
        );
        // Then: Fails with days error
        assert!(err_neg.is_err());
        assert_eq!(err_neg.unwrap_err(), "付款天數需為 0～365 的整數");

        // When: Days > 365 (366)
        let err_over = create_partner_with_terms_impl(
            &conn,
            TEST_TENANT,
            "廠商_超長天數".to_string(),
            None,
            Some(true),
            None,
            Some("net".to_string()),
            Some(366),
        );
        // Then: Fails with days error
        assert!(err_over.is_err());
        assert_eq!(err_over.unwrap_err(), "付款天數需為 0～365 的整數");
    }

    #[test]
    fn test_tc_pt_e_06_pt03_non_vendor_cannot_set_payment_terms() {
        // Given: Clean database
        let conn = setup_test_db();

        // When: Customer (is_vendor = false) tries to create partner with payment terms
        let err = create_partner_with_terms_impl(
            &conn,
            TEST_TENANT,
            "純客戶".to_string(),
            Some(true),
            Some(false),
            None,
            Some("net".to_string()),
            Some(30),
        );

        // Then: Fails with PT-03 error message
        assert!(err.is_err());
        assert_eq!(err.unwrap_err(), "僅供應商可設定付款條件");

        // When: Existing customer tries to update with payment terms
        let cust = create_partner_impl(
            &conn,
            TEST_TENANT,
            "現有純客戶".to_string(),
            Some(true),
            Some(false),
            None,
        )
        .unwrap();

        let err_update = update_partner_with_terms_impl(
            &conn,
            TEST_TENANT,
            cust.id,
            None,
            None,
            Some("net".to_string()),
            Some(30),
            None,
        );

        // Then: Fails with PT-03 error message
        assert!(err_update.is_err());
        assert_eq!(err_update.unwrap_err(), "僅供應商可設定付款條件");
    }

    #[test]
    fn test_tc_pt_b_01_backward_compatibility_legacy_records() {
        // Given: Database table created with legacy schema without payment terms columns
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE partners (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL DEFAULT '',
                name TEXT NOT NULL,
                is_customer INTEGER NOT NULL DEFAULT 1,
                is_vendor INTEGER NOT NULL DEFAULT 0,
                tax_id TEXT,
                created_at INTEGER NOT NULL
            )",
            [],
        )
        .unwrap();

        // Insert legacy partner
        conn.execute(
            "INSERT INTO partners (id, tenant_id, name, is_customer, is_vendor, tax_id, created_at)
             VALUES ('legacy_1', 'tnt_1', '舊時代廠商', 0, 1, '12345678', 100000)",
            [],
        )
        .unwrap();

        // When: Running table upgrade / migrations
        create_partners_table(&conn).unwrap();

        // Then: Querying legacy partner returns None for both new fields
        let partners = list_partners_impl(&conn, "tnt_1", None, None).unwrap();
        assert_eq!(partners.len(), 1);
        assert_eq!(partners[0].name, "舊時代廠商");
        assert_eq!(partners[0].payment_terms_type, None);
        assert_eq!(partners[0].payment_terms_days, None);
    }

    #[test]
    fn test_tc_ct_n_01_create_customer_collection_terms_and_invoice_mode() {
        // Given: Test database and valid customer with net 30, requested note, and per_order invoice mode
        let conn = setup_test_db();

        // When: create_partner_with_all_terms_impl is called
        let created = create_partner_with_all_terms_impl(
            &conn,
            TEST_TENANT,
            "台積電客戶".to_string(),
            Some(true),
            Some(false),
            None,
            None,
            None,
            Some("net".to_string()),
            Some(30),
            Some("業務提出月結30天申請".to_string()),
            Some("per_order".to_string()),
        )
        .unwrap();

        // Then: Partner is created with collection terms and invoice mode
        assert_eq!(created.collection_terms_type, Some("net".to_string()));
        assert_eq!(created.collection_terms_days, Some(30));
        assert_eq!(
            created.requested_collection_terms_note,
            Some("業務提出月結30天申請".to_string())
        );
        assert_eq!(created.invoice_issuance_mode, Some("per_order".to_string()));
    }

    #[test]
    fn test_tc_ct_n_02_and_03_collection_terms_boundaries_0_and_365() {
        // Given: Test database
        let conn = setup_test_db();

        // When: Creating customer with month_end 0 days (boundary 0)
        let c1 = create_partner_with_all_terms_impl(
            &conn,
            TEST_TENANT,
            "客戶A".to_string(),
            Some(true),
            Some(false),
            None,
            None,
            None,
            Some("month_end".to_string()),
            Some(0),
            None,
            Some("monthly_consolidated".to_string()),
        )
        .unwrap();

        // When: Creating customer with net 365 days (boundary 365)
        let c2 = create_partner_with_all_terms_impl(
            &conn,
            TEST_TENANT,
            "客戶B".to_string(),
            Some(true),
            Some(false),
            None,
            None,
            None,
            Some("net".to_string()),
            Some(365),
            None,
            None,
        )
        .unwrap();

        // Then: Boundaries succeed and values are preserved
        assert_eq!(c1.collection_terms_type, Some("month_end".to_string()));
        assert_eq!(c1.collection_terms_days, Some(0));
        assert_eq!(
            c1.invoice_issuance_mode,
            Some("monthly_consolidated".to_string())
        );

        assert_eq!(c2.collection_terms_type, Some("net".to_string()));
        assert_eq!(c2.collection_terms_days, Some(365));
        assert_eq!(c2.invoice_issuance_mode, Some("per_order".to_string())); // CT-06 default
    }

    #[test]
    fn test_tc_ct_n_04_default_unconfigured_collection_terms() {
        // Given: Test database
        let conn = setup_test_db();

        // When: Creating customer without any terms
        let cust = create_partner_impl(
            &conn,
            TEST_TENANT,
            "新客戶".to_string(),
            Some(true),
            Some(false),
            None,
        )
        .unwrap();

        // Then: Collection terms are None and invoice_issuance_mode defaults to per_order
        assert_eq!(cust.collection_terms_type, None);
        assert_eq!(cust.collection_terms_days, None);
        assert_eq!(cust.requested_collection_terms_note, None);
        assert_eq!(cust.invoice_issuance_mode, Some("per_order".to_string()));
    }

    #[test]
    fn test_tc_ct_n_05_and_06_note_and_clear_collection_terms() {
        // Given: Customer with collection terms
        let conn = setup_test_db();
        let cust = create_partner_with_all_terms_impl(
            &conn,
            TEST_TENANT,
            "測試客戶".to_string(),
            Some(true),
            Some(false),
            None,
            None,
            None,
            Some("net".to_string()),
            Some(60),
            Some("備註紀錄".to_string()),
            Some("per_order".to_string()),
        )
        .unwrap();

        // When: Clearing collection terms via update
        let updated = update_partner_with_all_terms_impl(
            &conn,
            TEST_TENANT,
            cust.id,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(true), // clear_collection_terms
            None,
            None,
            None,
        )
        .unwrap();

        // Then: Terms are cleared to None while note is kept
        assert_eq!(updated.collection_terms_type, None);
        assert_eq!(updated.collection_terms_days, None);
        assert_eq!(
            updated.requested_collection_terms_note,
            Some("備註紀錄".to_string())
        );
    }

    #[test]
    fn test_tc_ct_n_07_dual_identity_independent_terms() {
        // Given: Partner that is both customer and vendor
        let conn = setup_test_db();
        let partner = create_partner_with_all_terms_impl(
            &conn,
            TEST_TENANT,
            "雙重夥伴股份有限公司".to_string(),
            Some(true),
            Some(true),
            None,
            Some("net".to_string()),
            Some(30), // payment terms (vendor)
            Some("month_end".to_string()),
            Some(15), // collection terms (customer)
            Some("業務備註".to_string()),
            Some("monthly_consolidated".to_string()),
        )
        .unwrap();

        // Then: Both payment and collection terms are set independently
        assert_eq!(partner.payment_terms_type, Some("net".to_string()));
        assert_eq!(partner.payment_terms_days, Some(30));
        assert_eq!(partner.collection_terms_type, Some("month_end".to_string()));
        assert_eq!(partner.collection_terms_days, Some(15));
        assert_eq!(
            partner.requested_collection_terms_note,
            Some("業務備註".to_string())
        );
        assert_eq!(
            partner.invoice_issuance_mode,
            Some("monthly_consolidated".to_string())
        );

        // When: Updating only vendor payment terms
        let updated = update_partner_with_all_terms_impl(
            &conn,
            TEST_TENANT,
            partner.id.clone(),
            None,
            None,
            Some("month_end".to_string()),
            Some(45),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();

        // Then: Vendor payment terms updated, customer collection terms remain untouched
        assert_eq!(updated.payment_terms_type, Some("month_end".to_string()));
        assert_eq!(updated.payment_terms_days, Some(45));
        assert_eq!(updated.collection_terms_type, Some("month_end".to_string()));
        assert_eq!(updated.collection_terms_days, Some(15));
        assert_eq!(
            updated.requested_collection_terms_note,
            Some("業務備註".to_string())
        );
        assert_eq!(
            updated.invoice_issuance_mode,
            Some("monthly_consolidated".to_string())
        );
    }

    #[test]
    fn test_tc_ct_e_01_and_02_ct01_must_set_both_or_neither() {
        // Given: Test database
        let conn = setup_test_db();

        // When: Setting type without days
        let err1 = create_partner_with_all_terms_impl(
            &conn,
            TEST_TENANT,
            "客戶1".to_string(),
            Some(true),
            Some(false),
            None,
            None,
            None,
            Some("net".to_string()),
            None,
            None,
            None,
        );

        // When: Setting days without type
        let err2 = create_partner_with_all_terms_impl(
            &conn,
            TEST_TENANT,
            "客戶2".to_string(),
            Some(true),
            Some(false),
            None,
            None,
            None,
            None,
            Some(30),
            None,
            None,
        );

        // Then: CT-01 error
        assert_eq!(err1.unwrap_err(), "收款條件類型與天數需同時設定");
        assert_eq!(err2.unwrap_err(), "收款條件類型與天數需同時設定");
    }

    #[test]
    fn test_tc_ct_e_03_ct02_non_customer_cannot_set_collection_terms() {
        // Given: Pure vendor (is_customer = false)
        let conn = setup_test_db();

        // When: Trying to set collection terms
        let err = create_partner_with_all_terms_impl(
            &conn,
            TEST_TENANT,
            "純供應商".to_string(),
            Some(false),
            Some(true),
            None,
            None,
            None,
            Some("net".to_string()),
            Some(30),
            None,
            None,
        );

        // Then: CT-02 error
        assert_eq!(err.unwrap_err(), "僅客戶可設定收款條件");
    }

    #[test]
    fn test_tc_ct_e_04_to_06_ct03_and_ct04_invalid_type_and_days() {
        // Given: Test database
        let conn = setup_test_db();

        // When: Invalid type
        let err_type = create_partner_with_all_terms_impl(
            &conn,
            TEST_TENANT,
            "客戶_非法類型".to_string(),
            Some(true),
            Some(false),
            None,
            None,
            None,
            Some("quarterly".to_string()),
            Some(30),
            None,
            None,
        );
        // Then: CT-03 error
        assert_eq!(err_type.unwrap_err(), "收款條件類型需為 net 或 month_end");

        // When: Negative days (boundary -1)
        let err_neg = create_partner_with_all_terms_impl(
            &conn,
            TEST_TENANT,
            "客戶_負數天數".to_string(),
            Some(true),
            Some(false),
            None,
            None,
            None,
            Some("net".to_string()),
            Some(-1),
            None,
            None,
        );
        // Then: CT-04 error
        assert_eq!(err_neg.unwrap_err(), "收款天數需為 0～365 的整數");

        // When: Exceeding max days (boundary 366)
        let err_over = create_partner_with_all_terms_impl(
            &conn,
            TEST_TENANT,
            "客戶_超過365天".to_string(),
            Some(true),
            Some(false),
            None,
            None,
            None,
            Some("net".to_string()),
            Some(366),
            None,
            None,
        );
        // Then: CT-04 error
        assert_eq!(err_over.unwrap_err(), "收款天數需為 0～365 的整數");
    }

    #[test]
    fn test_tc_ct_e_07_and_08_ct05_invoice_issuance_mode_errors() {
        // Given: Test database
        let conn = setup_test_db();

        // When: Pure vendor sets invoice_issuance_mode
        let err_vnd = create_partner_with_all_terms_impl(
            &conn,
            TEST_TENANT,
            "廠商開票".to_string(),
            Some(false),
            Some(true),
            None,
            None,
            None,
            None,
            None,
            None,
            Some("per_order".to_string()),
        );
        // Then: CT-05 non-customer error
        assert_eq!(err_vnd.unwrap_err(), "僅客戶可設定開票模式");

        // When: Invalid mode value
        let err_val = create_partner_with_all_terms_impl(
            &conn,
            TEST_TENANT,
            "客戶開票".to_string(),
            Some(true),
            Some(false),
            None,
            None,
            None,
            None,
            None,
            None,
            Some("yearly".to_string()),
        );
        // Then: CT-05 value error
        assert_eq!(
            err_val.unwrap_err(),
            "開票模式需為 per_order 或 monthly_consolidated"
        );
    }
}
