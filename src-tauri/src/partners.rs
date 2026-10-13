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
            tax_id TEXT,
            created_at INTEGER NOT NULL
        )",
        [],
    )?;

    let _ = conn.execute(
        "ALTER TABLE partners ADD COLUMN tenant_id TEXT NOT NULL DEFAULT ''",
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

// Usecase: create_partner
pub fn create_partner_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    name: String,
    is_customer: Option<bool>,
    is_vendor: Option<bool>,
    tax_id: Option<String>,
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
        .prepare("SELECT id, tenant_id, name, is_customer, is_vendor, tax_id, created_at FROM partners WHERE tenant_id = ?1 AND LOWER(TRIM(name)) = LOWER(?2) LIMIT 1")
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
                created_at: row.get(6)?,
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

            conn.execute(
                "UPDATE partners SET is_customer = ?1, is_vendor = ?2, tax_id = ?3 WHERE id = ?4",
                params![
                    if merged_is_cust { 1 } else { 0 },
                    if merged_is_vend { 1 } else { 0 },
                    merged_tax_id,
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

    let now = current_timestamp();
    let id = format!(
        "part_{}_{}",
        now,
        ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    );

    conn.execute(
        "INSERT INTO partners (id, tenant_id, name, is_customer, is_vendor, tax_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            trimmed_tenant_id,
            trimmed_name,
            if target_is_cust { 1 } else { 0 },
            if target_is_vend { 1 } else { 0 },
            trimmed_tax_id,
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
        .prepare("SELECT id, tenant_id, name, is_customer, is_vendor, tax_id, created_at FROM partners WHERE id = ?1 AND tenant_id = ?2 LIMIT 1")
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
                created_at: row.get(6)?,
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

    conn.execute(
        "UPDATE partners SET name = ?1, tax_id = ?2 WHERE id = ?3 AND tenant_id = ?4",
        params![new_name, new_tax_id, trimmed_id, trimmed_tenant_id],
    )
    .map_err(|e| format!("Failed to update partner: {}", e))?;

    Ok(Partner {
        id: existing.id,
        tenant_id: existing.tenant_id,
        name: new_name,
        is_customer: existing.is_customer,
        is_vendor: existing.is_vendor,
        tax_id: new_tax_id,
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
        "SELECT id, tenant_id, name, is_customer, is_vendor, tax_id, created_at FROM partners WHERE tenant_id = ?1".to_string();
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
                created_at: row.get(6)?,
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
#[tauri::command]
#[specta::specta]
pub async fn create_partner<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    name: String,
    is_customer: Option<bool>,
    is_vendor: Option<bool>,
    tax_id: Option<String>,
) -> Result<Partner, String> {
    let db_path = get_db_path(&app_handle);
    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Failed to open DB: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    create_partner_impl(&conn, &active_tid, name, is_customer, is_vendor, tax_id)
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

#[tauri::command]
#[specta::specta]
pub async fn update_partner<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    id: String,
    name: Option<String>,
    tax_id: Option<String>,
) -> Result<Partner, String> {
    let db_path = get_db_path(&app_handle);
    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Failed to open DB: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    update_partner_impl(&conn, &active_tid, id, name, tax_id)
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
}
