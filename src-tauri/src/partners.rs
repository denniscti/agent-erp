use crate::get_db_path;
use rusqlite::params;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static ID_COUNTER: AtomicU64 = AtomicU64::new(1000);

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq, Eq)]
pub struct Partner {
    pub id: String,
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
            name TEXT NOT NULL,
            is_customer INTEGER NOT NULL DEFAULT 1,
            is_vendor INTEGER NOT NULL DEFAULT 0,
            tax_id TEXT,
            created_at INTEGER NOT NULL
        )",
        [],
    )?;

    Ok(())
}

// Usecase: create_partner
pub fn create_partner_impl(
    conn: &rusqlite::Connection,
    name: String,
    is_customer: Option<bool>,
    is_vendor: Option<bool>,
    tax_id: Option<String>,
) -> Result<Partner, String> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("Partner name cannot be empty".to_string());
    }

    let trimmed_tax_id = tax_id
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty());

    let target_is_vend = is_vendor.unwrap_or(false);
    let target_is_cust = is_customer.unwrap_or(!target_is_vend);

    let mut check_stmt = conn
        .prepare("SELECT id, name, is_customer, is_vendor, tax_id, created_at FROM partners WHERE LOWER(TRIM(name)) = LOWER(?1) LIMIT 1")
        .map_err(|e| format!("Failed to prepare duplicate check query: {}", e))?;

    let mut existing_rows = check_stmt
        .query_map(params![trimmed_name], |row| {
            let is_cust_int: i64 = row.get(2)?;
            let is_vend_int: i64 = row.get(3)?;
            Ok(Partner {
                id: row.get(0)?,
                name: row.get(1)?,
                is_customer: is_cust_int == 1,
                is_vendor: is_vend_int == 1,
                tax_id: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| format!("Failed to check for duplicate partner: {}", e))?;

    if let Some(existing_res) = existing_rows.next() {
        let existing =
            existing_res.map_err(|e| format!("Failed to read existing partner: {}", e))?;

        let need_add_vendor = target_is_vend && !existing.is_vendor;
        let need_add_customer = target_is_cust && !existing.is_customer;

        if need_add_vendor || need_add_customer {
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

    let now = current_timestamp();
    let id = format!(
        "part_{}_{}",
        now,
        ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    );

    conn.execute(
        "INSERT INTO partners (id, name, is_customer, is_vendor, tax_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            id,
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
        name: trimmed_name.to_string(),
        is_customer: target_is_cust,
        is_vendor: target_is_vend,
        tax_id: trimmed_tax_id,
        created_at: now,
    })
}

// Usecase: list_partners
pub fn list_partners_impl(
    conn: &rusqlite::Connection,
    filter_customer: Option<bool>,
    filter_vendor: Option<bool>,
) -> Result<Vec<Partner>, String> {
    let mut query =
        "SELECT id, name, is_customer, is_vendor, tax_id, created_at FROM partners".to_string();
    let mut conditions = Vec::new();

    if let Some(true) = filter_customer {
        conditions.push("is_customer = 1");
    }
    if let Some(true) = filter_vendor {
        conditions.push("is_vendor = 1");
    }

    if !conditions.is_empty() {
        query.push_str(" WHERE ");
        query.push_str(&conditions.join(" AND "));
    }
    query.push_str(" ORDER BY created_at ASC");

    let mut stmt = conn
        .prepare(&query)
        .map_err(|e| format!("Failed to prepare list_partners query: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            let is_cust_int: i64 = row.get(2)?;
            let is_vend_int: i64 = row.get(3)?;
            Ok(Partner {
                id: row.get(0)?,
                name: row.get(1)?,
                is_customer: is_cust_int == 1,
                is_vendor: is_vend_int == 1,
                tax_id: row.get(4)?,
                created_at: row.get(5)?,
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
    create_partner_impl(&conn, name, is_customer, is_vendor, tax_id)
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
    list_partners_impl(&conn, filter_customer, filter_vendor)
}

#[cfg(test)]
pub mod tests {
    use super::*;

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
        let result = create_partner_impl(&conn, name.clone(), None, None, None);

        // Then: The partner is created with is_customer=true, is_vendor=false, tax_id=None
        assert!(result.is_ok());
        let partner = result.unwrap();
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
        let result = create_partner_impl(&conn, name.clone(), Some(true), Some(false), tax_id);

        // Then: Partner is created with tax_id correctly stored
        assert!(result.is_ok());
        let partner = result.unwrap();
        assert_eq!(partner.name, "聯發科技");
        assert_eq!(partner.tax_id, Some("12345678".to_string()));
        assert!(partner.is_customer);
        assert!(!partner.is_vendor);
    }

    #[test]
    fn test_tc_ptr_n_03_list_partners_chronological_order() {
        // Given: Multiple partners created in sequence
        let conn = setup_test_db();
        let p1 = create_partner_impl(&conn, "客戶甲".to_string(), Some(true), None, None).unwrap();
        let p2 = create_partner_impl(&conn, "客戶乙".to_string(), Some(true), None, None).unwrap();
        let p3 = create_partner_impl(&conn, "廠商丙".to_string(), Some(false), Some(true), None)
            .unwrap();

        // When: list_partners_impl is called without filter
        let all = list_partners_impl(&conn, None, None).unwrap();

        // Then: All 3 partners are returned in ascending creation order
        assert_eq!(all.len(), 3);
        assert_eq!(all[0].id, p1.id);
        assert_eq!(all[1].id, p2.id);
        assert_eq!(all[2].id, p3.id);

        // And When: list_partners_impl is called with filter_customer=Some(true)
        let customers = list_partners_impl(&conn, Some(true), None).unwrap();

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
            name.clone(),
            Some(true),
            Some(true),
            Some("03080006".to_string()),
        );

        // Then: Both flags are true
        assert!(result.is_ok());
        let partner = result.unwrap();
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
        let result = create_partner_impl(&conn, raw_name, None, None, None).unwrap();

        // Then: The stored name is trimmed
        assert_eq!(result.name, "華碩電腦");
    }

    #[test]
    fn test_tc_ptr_b_02_create_partner_normalizes_empty_tax_id() {
        // Given: tax_id with empty string or whitespace
        let conn = setup_test_db();

        // When: create_partner_impl is executed with whitespace tax_id
        let res1 =
            create_partner_impl(&conn, "客戶A".to_string(), None, None, Some("".to_string()))
                .unwrap();
        let res2 = create_partner_impl(
            &conn,
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
        let err_empty = create_partner_impl(&conn, "".to_string(), None, None, None);
        let err_whitespace = create_partner_impl(&conn, "    ".to_string(), None, None, None);

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
        let list = list_partners_impl(&conn, None, None).unwrap();

        // Then: Empty vector is returned
        assert_eq!(list.len(), 0);
    }

    #[test]
    fn test_tc_ptr_e_01_duplicate_name_error() {
        // Given: Existing partner "台積電"
        let conn = setup_test_db();
        create_partner_impl(&conn, "台積電".to_string(), None, None, None).unwrap();

        // When: Attempting to create another partner with identical name "台積電"
        let result = create_partner_impl(&conn, "台積電".to_string(), None, None, None);

        // Then: Duplicate error is returned
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            "合作夥伴／客戶「台積電」已存在，請使用不同名稱"
        );
    }

    #[test]
    fn test_tc_ptr_e_02_duplicate_case_insensitive_and_trimmed_error() {
        // Given: Existing partner "TSMC"
        let conn = setup_test_db();
        create_partner_impl(&conn, "TSMC".to_string(), None, None, None).unwrap();

        // When: Attempting to create partner with "  tsmc  "
        let result = create_partner_impl(&conn, "  tsmc  ".to_string(), None, None, None);

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
        let result = create_partner_impl(&conn, name.clone(), None, Some(true), None);

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
        let result = create_partner_impl(&conn, name.clone(), Some(false), Some(true), tax_id);

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
        let original =
            create_partner_impl(&conn, "台積電".to_string(), Some(true), Some(false), None)
                .unwrap();
        assert!(original.is_customer);
        assert!(!original.is_vendor);

        // When: Registering the same partner as a vendor
        let overlay_result =
            create_partner_impl(&conn, "台積電".to_string(), None, Some(true), None);

        // Then: The existing record is updated with is_vendor=true, retaining is_customer=true and original id
        assert!(overlay_result.is_ok());
        let updated = overlay_result.unwrap();
        assert_eq!(updated.id, original.id);
        assert_eq!(updated.name, "台積電");
        assert!(updated.is_customer);
        assert!(updated.is_vendor);

        // And: Total count in database remains 1
        let all = list_partners_impl(&conn, None, None).unwrap();
        assert_eq!(all.len(), 1);
    }

    #[test]
    fn test_tc_vnd_n_04_existing_vendor_overlay_customer_identity() {
        // Given: Existing vendor "穩懋半導體" (is_customer=false, is_vendor=true)
        let conn = setup_test_db();
        let original = create_partner_impl(
            &conn,
            "穩懋半導體".to_string(),
            Some(false),
            Some(true),
            None,
        )
        .unwrap();

        // When: Registering the same partner as a customer
        let overlay_result =
            create_partner_impl(&conn, "穩懋半導體".to_string(), Some(true), None, None);

        // Then: Existing record is updated with is_customer=true, retaining is_vendor=true
        assert!(overlay_result.is_ok());
        let updated = overlay_result.unwrap();
        assert_eq!(updated.id, original.id);
        assert!(updated.is_customer);
        assert!(updated.is_vendor);

        // And: Total count in database remains 1
        let all = list_partners_impl(&conn, None, None).unwrap();
        assert_eq!(all.len(), 1);
    }

    #[test]
    fn test_tc_vnd_n_05_overlay_identity_merges_tax_id() {
        // Given: Existing customer without tax_id
        let conn = setup_test_db();
        let p = create_partner_impl(&conn, "華邦電".to_string(), Some(true), None, None).unwrap();
        assert_eq!(p.tax_id, None);

        // When: Overlaying vendor identity with a new tax_id
        let updated = create_partner_impl(
            &conn,
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
        create_partner_impl(&conn, "客戶A".to_string(), Some(true), Some(false), None).unwrap();
        create_partner_impl(&conn, "廠商B".to_string(), Some(false), Some(true), None).unwrap();
        create_partner_impl(&conn, "綜合C".to_string(), Some(true), Some(true), None).unwrap();

        // When: Querying with filter_vendor=Some(true)
        let vendors = list_partners_impl(&conn, None, Some(true)).unwrap();

        // Then: Only 2 vendors are returned
        assert_eq!(vendors.len(), 2);
        assert_eq!(vendors[0].name, "廠商B");
        assert_eq!(vendors[1].name, "綜合C");
    }

    #[test]
    fn test_tc_vnd_e_01_duplicate_vendor_error() {
        // Given: Existing vendor "日月光"
        let conn = setup_test_db();
        create_partner_impl(&conn, "日月光".to_string(), Some(false), Some(true), None).unwrap();

        // When: Attempting to register "日月光" as vendor again
        let result =
            create_partner_impl(&conn, "日月光".to_string(), Some(false), Some(true), None);

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
        create_partner_impl(&conn, "ASE".to_string(), Some(false), Some(true), None).unwrap();

        // When: Attempting to register "  ase  " as vendor
        let result =
            create_partner_impl(&conn, "  ase  ".to_string(), Some(false), Some(true), None);

        // Then: Duplicate vendor error is returned
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            "合作夥伴／供應商「ase」已存在，請使用不同名稱"
        );
    }
}
