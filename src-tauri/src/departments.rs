use crate::get_db_path;
use rusqlite::params;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static ID_COUNTER: AtomicU64 = AtomicU64::new(1000);

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq, Eq)]
pub struct Department {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    #[serde(default)]
    pub skills: Vec<String>,
    pub created_at: i64,
}

fn current_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

pub fn create_departments_table(conn: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS departments (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            parent_id TEXT,
            skills TEXT DEFAULT '[]',
            created_at INTEGER NOT NULL
        )",
        [],
    )?;

    // Backward compatibility migration for pre-existing tables
    let _ = conn.execute(
        "ALTER TABLE departments ADD COLUMN skills TEXT DEFAULT '[]'",
        [],
    );

    Ok(())
}

// Usecase: create_department
pub fn create_department_impl(
    conn: &rusqlite::Connection,
    name: String,
    parent_id: Option<String>,
) -> Result<Department, String> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("Department name cannot be empty".to_string());
    }

    let mut check_stmt = conn
        .prepare("SELECT 1 FROM departments WHERE LOWER(TRIM(name)) = LOWER(?1) LIMIT 1")
        .map_err(|e| format!("Failed to prepare duplicate check query: {}", e))?;
    let exists = check_stmt
        .exists(params![trimmed_name])
        .map_err(|e| format!("Failed to check for duplicate department: {}", e))?;

    if exists {
        return Err(format!("部門「{}」已存在，請使用不同名稱", trimmed_name));
    }

    let trimmed_parent_id = parent_id
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty());

    let now = current_timestamp();
    let id = format!(
        "dept_{}_{}",
        now,
        ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    );

    conn.execute(
        "INSERT INTO departments (id, name, parent_id, skills, created_at)
         VALUES (?1, ?2, ?3, '[]', ?4)",
        params![id, trimmed_name, trimmed_parent_id, now],
    )
    .map_err(|e| format!("Failed to insert department: {}", e))?;

    Ok(Department {
        id,
        name: trimmed_name.to_string(),
        parent_id: trimmed_parent_id,
        skills: vec![],
        created_at: now,
    })
}

// Usecase: list_departments
pub fn list_departments_impl(conn: &rusqlite::Connection) -> Result<Vec<Department>, String> {
    let mut stmt = conn
        .prepare("SELECT id, name, parent_id, skills, created_at FROM departments ORDER BY created_at ASC")
        .map_err(|e| format!("Failed to prepare list_departments query: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            let skills_str: Option<String> = row.get(3).ok();
            let skills: Vec<String> = skills_str
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default();

            Ok(Department {
                id: row.get(0)?,
                name: row.get(1)?,
                parent_id: row.get(2)?,
                skills,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| format!("Failed to query departments: {}", e))?;

    let mut departments = Vec::new();
    for dept_res in rows {
        departments.push(dept_res.map_err(|e| format!("Error reading department row: {}", e))?);
    }

    Ok(departments)
}

// Usecase: update_department_skills
pub fn update_department_skills_impl(
    conn: &rusqlite::Connection,
    department_id: &str,
    skills: Vec<String>,
) -> Result<Department, String> {
    let trimmed_id = department_id.trim();
    if trimmed_id.is_empty() {
        return Err("Department ID cannot be empty".to_string());
    }

    let mut check_stmt = conn
        .prepare("SELECT id, name, parent_id, created_at FROM departments WHERE id = ?1 LIMIT 1")
        .map_err(|e| format!("Failed to prepare department check query: {}", e))?;

    let dept_info = check_stmt
        .query_row(params![trimmed_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })
        .map_err(|_| format!("Department not found: {}", trimmed_id))?;

    let unique_skills: Vec<String> = {
        let mut set = std::collections::BTreeSet::new();
        for s in skills {
            let trimmed = s.trim().to_string();
            if !trimmed.is_empty() {
                set.insert(trimmed);
            }
        }
        set.into_iter().collect()
    };

    let skills_json = serde_json::to_string(&unique_skills)
        .map_err(|e| format!("Failed to serialize skills: {}", e))?;

    conn.execute(
        "UPDATE departments SET skills = ?1 WHERE id = ?2",
        params![skills_json, trimmed_id],
    )
    .map_err(|e| format!("Failed to update department skills: {}", e))?;

    Ok(Department {
        id: dept_info.0,
        name: dept_info.1,
        parent_id: dept_info.2,
        skills: unique_skills,
        created_at: dept_info.3,
    })
}

// Delivery layer: Tauri Commands
#[tauri::command]
#[specta::specta]
pub async fn create_department<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    name: String,
    parent_id: Option<String>,
) -> Result<Department, String> {
    let db_path = get_db_path(&app_handle);
    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Failed to open DB: {}", e))?;
    create_department_impl(&conn, name, parent_id)
}

#[tauri::command]
#[specta::specta]
pub async fn list_departments<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<Vec<Department>, String> {
    let db_path = get_db_path(&app_handle);
    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Failed to open DB: {}", e))?;
    list_departments_impl(&conn)
}

#[tauri::command]
#[specta::specta]
pub async fn update_department_skills<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    department_id: String,
    skills: Vec<String>,
) -> Result<Department, String> {
    let db_path = get_db_path(&app_handle);
    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Failed to open DB: {}", e))?;
    update_department_skills_impl(&conn, &department_id, skills)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_test_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        create_departments_table(&conn).unwrap();
        conn
    }

    #[test]
    fn test_tc_dept_01_create_top_level_department_success() {
        // Given: An initialized database and a valid department name without parent_id
        let conn = setup_test_db();
        let name = "銷售部".to_string();
        let parent_id = None;

        // When: create_department_impl is executed
        let result = create_department_impl(&conn, name.clone(), parent_id);

        // Then: The department is created successfully with no parent_id and empty skills
        assert!(result.is_ok());
        let dept = result.unwrap();
        assert_eq!(dept.name, name);
        assert_eq!(dept.parent_id, None);
        assert_eq!(dept.skills, Vec::<String>::new());
        assert!(dept.created_at > 0);
        assert!(dept.id.starts_with("dept_"));
    }

    #[test]
    fn test_tc_dept_02_create_nested_department_success() {
        // Given: An existing parent department
        let conn = setup_test_db();
        let parent = create_department_impl(&conn, "銷售部".to_string(), None).unwrap();

        // When: create_department_impl is executed with parent_id
        let sub_result =
            create_department_impl(&conn, "銷售一組".to_string(), Some(parent.id.clone()));

        // Then: The sub-department is created and correctly references the parent_id
        assert!(sub_result.is_ok());
        let sub_dept = sub_result.unwrap();
        assert_eq!(sub_dept.name, "銷售一組");
        assert_eq!(sub_dept.parent_id, Some(parent.id));
    }

    #[test]
    fn test_tc_dept_03_and_04_create_department_empty_name_error() {
        // Given: An initialized database
        let conn = setup_test_db();

        // When: create_department_impl is called with empty string
        let err_empty = create_department_impl(&conn, "".to_string(), None);
        // And: create_department_impl is called with whitespace only
        let err_whitespace = create_department_impl(&conn, "   ".to_string(), None);

        // Then: Both return validation errors
        assert!(err_empty.is_err());
        assert_eq!(err_empty.unwrap_err(), "Department name cannot be empty");
        assert!(err_whitespace.is_err());
        assert_eq!(
            err_whitespace.unwrap_err(),
            "Department name cannot be empty"
        );
    }

    #[test]
    fn test_tc_dept_05_create_department_trims_whitespace() {
        // Given: Department name with surrounding whitespace
        let conn = setup_test_db();
        let raw_name = "  技術研發部  ".to_string();

        // When: create_department_impl is executed
        let result = create_department_impl(&conn, raw_name, None).unwrap();

        // Then: The stored department name is trimmed
        assert_eq!(result.name, "技術研發部");
    }

    #[test]
    fn test_tc_dept_06_create_department_normalizes_empty_parent_id() {
        // Given: parent_id containing only whitespace
        let conn = setup_test_db();

        // When: create_department_impl is executed with whitespace parent_id
        let result =
            create_department_impl(&conn, "財務部".to_string(), Some("   ".to_string())).unwrap();

        // Then: parent_id is normalized to None
        assert_eq!(result.parent_id, None);
    }

    #[test]
    fn test_tc_dept_07_list_departments_empty() {
        // Given: An initialized database with no departments
        let conn = setup_test_db();

        // When: list_departments_impl is called
        let list = list_departments_impl(&conn).unwrap();

        // Then: An empty list is returned without error
        assert_eq!(list.len(), 0);
    }

    #[test]
    fn test_tc_dept_08_list_departments_chronological_order() {
        // Given: Multiple departments created sequentially
        let conn = setup_test_db();
        let dept1 = create_department_impl(&conn, "人事部".to_string(), None).unwrap();
        let dept2 = create_department_impl(&conn, "研發部".to_string(), None).unwrap();
        let dept3 =
            create_department_impl(&conn, "前端小組".to_string(), Some(dept2.id.clone())).unwrap();

        // When: list_departments_impl is called
        let list = list_departments_impl(&conn).unwrap();

        // Then: All 3 departments are returned in ascending creation order
        assert_eq!(list.len(), 3);
        assert_eq!(list[0].id, dept1.id);
        assert_eq!(list[0].name, "人事部");
        assert_eq!(list[1].id, dept2.id);
        assert_eq!(list[1].name, "研發部");
        assert_eq!(list[2].id, dept3.id);
        assert_eq!(list[2].name, "前端小組");
        assert_eq!(list[2].parent_id, Some(dept2.id));
    }

    #[test]
    fn test_tc_dept_dup_01_duplicate_chinese_name_error() {
        // Given: An initialized database with an existing department "行銷部"
        let conn = setup_test_db();
        create_department_impl(&conn, "行銷部".to_string(), None).unwrap();

        // When: create_department_impl is called with the exact same name "行銷部"
        let result = create_department_impl(&conn, "行銷部".to_string(), None);

        // Then: It returns a validation error indicating duplicate department name
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "部門「行銷部」已存在，請使用不同名稱");
    }

    #[test]
    fn test_tc_dept_dup_02_duplicate_with_whitespace_trim_error() {
        // Given: An initialized database with an existing department "行銷部"
        let conn = setup_test_db();
        create_department_impl(&conn, "行銷部".to_string(), None).unwrap();

        // When: create_department_impl is called with surrounding whitespace "  行銷部  "
        let result = create_department_impl(&conn, "  行銷部  ".to_string(), None);

        // Then: It is trimmed and detected as duplicate, returning the expected error message
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "部門「行銷部」已存在，請使用不同名稱");
    }

    #[test]
    fn test_tc_dept_dup_03_duplicate_case_insensitive_error() {
        // Given: An initialized database with an existing department "HR"
        let conn = setup_test_db();
        create_department_impl(&conn, "HR".to_string(), None).unwrap();

        // When: create_department_impl is called with lower-case "hr"
        let result = create_department_impl(&conn, "hr".to_string(), None);

        // Then: It is matched case-insensitively and rejected
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "部門「hr」已存在，請使用不同名稱");
    }

    #[test]
    fn test_tc_dept_dup_04_different_name_success() {
        // Given: An initialized database with an existing department "行銷部"
        let conn = setup_test_db();
        create_department_impl(&conn, "行銷部".to_string(), None).unwrap();

        // When: create_department_impl is called with a distinct department name "研發部"
        let result = create_department_impl(&conn, "研發部".to_string(), None);

        // Then: The new department is created successfully
        assert!(result.is_ok());
        let dept = result.unwrap();
        assert_eq!(dept.name, "研發部");
    }

    #[test]
    fn test_tc_dept_dup_05_duplicate_subdepartment_name_error() {
        // Given: An existing department "銷售部"
        let conn = setup_test_db();
        let parent = create_department_impl(&conn, "銷售部".to_string(), None).unwrap();

        // When: create_department_impl is called with same name "銷售部" even if under parent_id
        let result = create_department_impl(&conn, "銷售部".to_string(), Some(parent.id));

        // Then: Duplicate check is global and rejects creation
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "部門「銷售部」已存在，請使用不同名稱");
    }

    #[test]
    fn test_tc_dept_skills_01_update_department_skills_success() {
        // Given: An existing department
        let conn = setup_test_db();
        let dept = create_department_impl(&conn, "資訊部".to_string(), None).unwrap();
        assert_eq!(dept.skills, Vec::<String>::new());

        // When: update_department_skills_impl is called with skills
        let skills = vec!["department.manage".to_string(), "customer.view".to_string()];
        let updated = update_department_skills_impl(&conn, &dept.id, skills.clone()).unwrap();

        // Then: Department skills are updated and deduplicated
        assert_eq!(
            updated.skills,
            vec!["customer.view".to_string(), "department.manage".to_string()]
        );

        // And: list_departments_impl returns the updated skills
        let list = list_departments_impl(&conn).unwrap();
        let found = list.into_iter().find(|d| d.id == dept.id).unwrap();
        assert_eq!(
            found.skills,
            vec!["customer.view".to_string(), "department.manage".to_string()]
        );
    }

    #[test]
    fn test_tc_dept_skills_02_update_department_skills_not_found() {
        // Given: Empty database
        let conn = setup_test_db();

        // When: update_department_skills_impl is called with nonexistent department ID
        let result = update_department_skills_impl(
            &conn,
            "nonexistent_id",
            vec!["customer.view".to_string()],
        );

        // Then: Error is returned
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Department not found: nonexistent_id");
    }

    #[test]
    fn test_tc_dept_skills_03_update_department_skills_empty_id() {
        // Given: An initialized database
        let conn = setup_test_db();

        // When: update_department_skills_impl is called with empty department ID
        let result = update_department_skills_impl(&conn, "   ", vec!["customer.view".to_string()]);

        // Then: Validation error is returned
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Department ID cannot be empty");
    }
}
