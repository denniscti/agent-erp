use crate::get_db_path;
use rusqlite::params;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static ID_COUNTER: AtomicU64 = AtomicU64::new(1000);

fn current_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq, Eq)]
pub struct Product {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub category: String, // "resale" | "manufactured" | "raw_material"
    pub is_sellable: bool,
    pub is_purchasable: bool,
    pub created_at: i64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq, Eq)]
pub struct ProductVariant {
    pub id: String,
    pub product_id: String,
    pub sku: Option<String>,
    pub name: String,
    pub spec_attributes: serde_json::Value,
    pub is_default: bool,
    pub created_at: i64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq)]
pub struct ProductUnit {
    pub id: String,
    pub variant_id: String,
    pub unit_name: String,
    pub conversion_ratio: f64,
    pub is_base_unit: bool,
    #[serde(alias = "sell_price")]
    pub selling_price: f64,
    pub created_at: i64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq)]
pub struct ProductSupplySource {
    pub id: String,
    pub unit_id: String,
    pub vendor_partner_id: String,
    pub purchase_cost: f64,
    pub currency: String,
    pub is_primary: bool,
    pub created_at: i64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq)]
pub struct ProductBomItem {
    pub id: String,
    pub parent_variant_id: String,
    pub child_variant_id: String,
    pub quantity: f64,
    pub created_at: i64,
    #[serde(default)]
    pub child_product_name: Option<String>,
    #[serde(default)]
    pub child_variant_name: Option<String>,
    #[serde(default)]
    pub child_sku: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq)]
pub struct ProductDetail {
    pub product: Product,
    pub variants: Vec<ProductVariant>,
    pub units: Vec<ProductUnit>,
    pub supply_sources: Vec<ProductSupplySource>,
    pub bom_items: Vec<ProductBomItem>,
}

pub fn create_products_tables(conn: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS products (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            is_sellable INTEGER NOT NULL DEFAULT 1,
            is_purchasable INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL
        )",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_products_tenant ON products (tenant_id)",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS product_variants (
            id TEXT PRIMARY KEY,
            product_id TEXT NOT NULL,
            sku TEXT,
            name TEXT NOT NULL,
            spec_attributes TEXT NOT NULL DEFAULT '{}',
            is_default INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        )",
        [],
    )?;

    let _ = conn.execute(
        "ALTER TABLE product_variants ADD COLUMN spec_attributes TEXT NOT NULL DEFAULT '{}'",
        [],
    );

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants (product_id)",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS product_units (
            id TEXT PRIMARY KEY,
            variant_id TEXT NOT NULL,
            unit_name TEXT NOT NULL,
            conversion_ratio REAL NOT NULL DEFAULT 1.0,
            is_base_unit INTEGER NOT NULL DEFAULT 0,
            selling_price REAL NOT NULL DEFAULT 0.0,
            created_at INTEGER NOT NULL
        )",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_units_variant ON product_units (variant_id)",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS product_supply_sources (
            id TEXT PRIMARY KEY,
            unit_id TEXT NOT NULL,
            vendor_partner_id TEXT NOT NULL,
            purchase_cost REAL NOT NULL DEFAULT 0.0,
            currency TEXT NOT NULL DEFAULT 'TWD',
            is_primary INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        )",
        [],
    )?;

    // Backward compatibility migration for pre-existing product_supply_sources table (migrating variant_id to unit_id)
    let _ = conn.execute(
        "ALTER TABLE product_supply_sources ADD COLUMN unit_id TEXT",
        [],
    );
    let _ = conn.execute(
        "UPDATE product_supply_sources
         SET unit_id = COALESCE(
             (SELECT u.id FROM product_units u WHERE u.variant_id = product_supply_sources.variant_id ORDER BY u.is_base_unit DESC LIMIT 1),
             variant_id
         )
         WHERE unit_id IS NULL OR unit_id = ''",
        [],
    );
    let _ = conn.execute("DROP INDEX IF EXISTS idx_supply_variant", []);

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_supply_unit ON product_supply_sources (unit_id)",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS product_bom_items (
            id TEXT PRIMARY KEY,
            parent_variant_id TEXT NOT NULL,
            child_variant_id TEXT NOT NULL,
            quantity REAL NOT NULL DEFAULT 1.0,
            created_at INTEGER NOT NULL
        )",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_bom_parent ON product_bom_items (parent_variant_id)",
        [],
    )?;

    Ok(())
}

pub fn resolve_category_flags(raw_category: &str) -> Result<(&'static str, bool, bool), String> {
    match raw_category.trim().to_lowercase().as_str() {
        "resale" | "轉售商品" | "轉售" => Ok(("resale", true, true)),
        "manufactured" | "自製成品" | "自製" => Ok(("manufactured", true, false)),
        "raw_material" | "原物料" | "原料" => Ok(("raw_material", false, true)),
        other => Err(format!(
            "無效的商品類別「{}」，僅允許：轉售商品、自製成品、原物料",
            other
        )),
    }
}

// Usecase: create_product
pub fn create_product_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    name: String,
    category: String,
    sku: Option<String>,
    unit_name: Option<String>,
    selling_price: Option<f64>,
) -> Result<ProductDetail, String> {
    let trimmed_tenant_id = tenant_id.trim();
    if trimmed_tenant_id.is_empty() {
        return Err("Tenant ID cannot be empty".to_string());
    }

    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("商品名稱不能為空".to_string());
    }

    let (std_category, is_sellable, is_purchasable) = resolve_category_flags(&category)?;

    if let Some(price) = selling_price {
        if price < 0.0 {
            return Err("售價不能為負數".to_string());
        }
    }

    // Tenant-isolated duplicate name check (case-insensitive & trimmed)
    let mut check_stmt = conn
        .prepare(
            "SELECT 1 FROM products WHERE tenant_id = ?1 AND LOWER(TRIM(name)) = LOWER(?2) LIMIT 1",
        )
        .map_err(|e| format!("Failed to prepare duplicate check query: {}", e))?;

    let exists = check_stmt
        .query_row(params![trimmed_tenant_id, trimmed_name], |_| Ok(()))
        .is_ok();

    if exists {
        return Err(format!("商品「{}」已存在，請使用不同名稱", trimmed_name));
    }

    let now = current_timestamp();
    let prod_id = format!(
        "prod_{}_{}",
        now,
        ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    );

    conn.execute(
        "INSERT INTO products (id, tenant_id, name, category, is_sellable, is_purchasable, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            prod_id,
            trimmed_tenant_id,
            trimmed_name,
            std_category,
            if is_sellable { 1 } else { 0 },
            if is_purchasable { 1 } else { 0 },
            now
        ],
    )
    .map_err(|e| format!("Failed to insert product: {}", e))?;

    let product = Product {
        id: prod_id.clone(),
        tenant_id: trimmed_tenant_id.to_string(),
        name: trimmed_name.to_string(),
        category: std_category.to_string(),
        is_sellable,
        is_purchasable,
        created_at: now,
    };

    // Auto-create default variant
    let var_id = format!("var_{}_{}", now, ID_COUNTER.fetch_add(1, Ordering::Relaxed));
    let trimmed_sku = sku.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

    conn.execute(
        "INSERT INTO product_variants (id, product_id, sku, name, spec_attributes, is_default, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![var_id, prod_id, trimmed_sku, "標準", "{}", 1, now],
    )
    .map_err(|e| format!("Failed to insert default product variant: {}", e))?;

    let default_variant = ProductVariant {
        id: var_id.clone(),
        product_id: prod_id.clone(),
        sku: trimmed_sku,
        name: "標準".to_string(),
        spec_attributes: serde_json::json!({}),
        is_default: true,
        created_at: now,
    };

    // Auto-create base unit
    let clean_unit_name = match unit_name {
        Some(u) => {
            let tr = u.trim().to_string();
            if tr.is_empty() {
                "個".to_string()
            } else {
                tr
            }
        }
        None => "個".to_string(),
    };
    let price = selling_price.unwrap_or(0.0);

    let unit_id = format!(
        "unit_{}_{}",
        now,
        ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    conn.execute(
        "INSERT INTO product_units (id, variant_id, unit_name, conversion_ratio, is_base_unit, selling_price, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![unit_id, var_id, clean_unit_name, 1.0, 1, price, now],
    )
    .map_err(|e| format!("Failed to insert default product unit: {}", e))?;

    let base_unit = ProductUnit {
        id: unit_id,
        variant_id: var_id,
        unit_name: clean_unit_name,
        conversion_ratio: 1.0,
        is_base_unit: true,
        selling_price: price,
        created_at: now,
    };

    Ok(ProductDetail {
        product,
        variants: vec![default_variant],
        units: vec![base_unit],
        supply_sources: Vec::new(),
        bom_items: Vec::new(),
    })
}

// Usecase: list_products
pub fn list_products_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    filter_category: Option<String>,
    filter_sellable: Option<bool>,
    filter_purchasable: Option<bool>,
) -> Result<Vec<Product>, String> {
    let trimmed_tenant_id = tenant_id.trim();
    if trimmed_tenant_id.is_empty() {
        return Ok(Vec::new());
    }

    let mut query = "SELECT id, tenant_id, name, category, is_sellable, is_purchasable, created_at FROM products WHERE tenant_id = ?1".to_string();
    let mut conditions = Vec::new();
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> =
        vec![Box::new(trimmed_tenant_id.to_string())];

    if let Some(cat) = filter_category {
        let cat_trimmed = cat.trim().to_string();
        if !cat_trimmed.is_empty() {
            conditions.push(format!("category = ?{}", params_vec.len() + 1));
            params_vec.push(Box::new(cat_trimmed));
        }
    }
    if let Some(sellable) = filter_sellable {
        conditions.push(format!("is_sellable = ?{}", params_vec.len() + 1));
        params_vec.push(Box::new(if sellable { 1 } else { 0 }));
    }
    if let Some(purchasable) = filter_purchasable {
        conditions.push(format!("is_purchasable = ?{}", params_vec.len() + 1));
        params_vec.push(Box::new(if purchasable { 1 } else { 0 }));
    }

    if !conditions.is_empty() {
        query.push_str(" AND ");
        query.push_str(&conditions.join(" AND "));
    }
    query.push_str(" ORDER BY created_at ASC");

    let mut stmt = conn
        .prepare(&query)
        .map_err(|e| format!("Failed to prepare list_products query: {}", e))?;

    let params_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();
    let rows = stmt
        .query_map(params_refs.as_slice(), |row| {
            let sellable_int: i64 = row.get(4)?;
            let purchasable_int: i64 = row.get(5)?;
            Ok(Product {
                id: row.get(0)?,
                tenant_id: row.get(1)?,
                name: row.get(2)?,
                category: row.get(3)?,
                is_sellable: sellable_int == 1,
                is_purchasable: purchasable_int == 1,
                created_at: row.get(6)?,
            })
        })
        .map_err(|e| format!("Failed to query products: {}", e))?;

    let mut products = Vec::new();
    for p_res in rows {
        products.push(p_res.map_err(|e| format!("Error reading product row: {}", e))?);
    }

    Ok(products)
}

// Usecase: get_product_detail
pub fn get_product_detail_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    product_id: &str,
) -> Result<ProductDetail, String> {
    let trimmed_tenant_id = tenant_id.trim();
    let trimmed_prod_id = product_id.trim();
    if trimmed_tenant_id.is_empty() || trimmed_prod_id.is_empty() {
        return Err("Product not found".to_string());
    }

    let mut prod_stmt = conn
        .prepare("SELECT id, tenant_id, name, category, is_sellable, is_purchasable, created_at FROM products WHERE id = ?1 AND tenant_id = ?2 LIMIT 1")
        .map_err(|e| format!("Failed to prepare get_product query: {}", e))?;

    let product = prod_stmt
        .query_row(params![trimmed_prod_id, trimmed_tenant_id], |row| {
            let sellable_int: i64 = row.get(4)?;
            let purchasable_int: i64 = row.get(5)?;
            Ok(Product {
                id: row.get(0)?,
                tenant_id: row.get(1)?,
                name: row.get(2)?,
                category: row.get(3)?,
                is_sellable: sellable_int == 1,
                is_purchasable: purchasable_int == 1,
                created_at: row.get(6)?,
            })
        })
        .map_err(|_| "Product not found".to_string())?;

    // Load variants
    let mut var_stmt = conn
        .prepare("SELECT id, product_id, sku, name, spec_attributes, is_default, created_at FROM product_variants WHERE product_id = ?1 ORDER BY is_default DESC, created_at ASC")
        .map_err(|e| format!("Failed to prepare query variants: {}", e))?;

    let var_rows = var_stmt
        .query_map(params![trimmed_prod_id], |row| {
            let is_default_int: i64 = row.get(5)?;
            let raw_spec: String = row.get(4).unwrap_or_else(|_| "{}".to_string());
            let spec_val = serde_json::from_str::<serde_json::Value>(&raw_spec)
                .unwrap_or(serde_json::json!({}));
            Ok(ProductVariant {
                id: row.get(0)?,
                product_id: row.get(1)?,
                sku: row.get(2)?,
                name: row.get(3)?,
                spec_attributes: spec_val,
                is_default: is_default_int == 1,
                created_at: row.get(6)?,
            })
        })
        .map_err(|e| format!("Failed to query variants: {}", e))?;

    let mut variants = Vec::new();
    let mut variant_ids = Vec::new();
    for v_res in var_rows {
        let v = v_res.map_err(|e| format!("Error reading variant: {}", e))?;
        variant_ids.push(v.id.clone());
        variants.push(v);
    }

    let mut units = Vec::new();
    let mut supply_sources = Vec::new();
    let mut bom_items = Vec::new();

    if !variant_ids.is_empty() {
        // Query units
        for vid in &variant_ids {
            let mut unit_stmt = conn
                .prepare("SELECT id, variant_id, unit_name, conversion_ratio, is_base_unit, selling_price, created_at FROM product_units WHERE variant_id = ?1 ORDER BY is_base_unit DESC, created_at ASC")
                .map_err(|e| format!("Failed to prepare units query: {}", e))?;
            let u_rows = unit_stmt
                .query_map(params![vid], |row| {
                    let base_int: i64 = row.get(4)?;
                    Ok(ProductUnit {
                        id: row.get(0)?,
                        variant_id: row.get(1)?,
                        unit_name: row.get(2)?,
                        conversion_ratio: row.get(3)?,
                        is_base_unit: base_int == 1,
                        selling_price: row.get(5)?,
                        created_at: row.get(6)?,
                    })
                })
                .map_err(|e| format!("Failed to query units: {}", e))?;
            for u in u_rows {
                units.push(u.map_err(|e| format!("Error reading unit: {}", e))?);
            }

            // Query bom items with joined product and variant names
            let mut bom_stmt = conn
                .prepare(
                    "SELECT b.id, b.parent_variant_id, b.child_variant_id, b.quantity, b.created_at,
                            p.name, v.name, v.sku
                     FROM product_bom_items b
                     LEFT JOIN product_variants v ON b.child_variant_id = v.id
                     LEFT JOIN products p ON v.product_id = p.id
                     WHERE b.parent_variant_id = ?1
                     ORDER BY b.created_at ASC",
                )
                .map_err(|e| format!("Failed to prepare bom query: {}", e))?;
            let b_rows = bom_stmt
                .query_map(params![vid], |row| {
                    Ok(ProductBomItem {
                        id: row.get(0)?,
                        parent_variant_id: row.get(1)?,
                        child_variant_id: row.get(2)?,
                        quantity: row.get(3)?,
                        created_at: row.get(4)?,
                        child_product_name: row.get(5)?,
                        child_variant_name: row.get(6)?,
                        child_sku: row.get(7)?,
                    })
                })
                .map_err(|e| format!("Failed to query bom items: {}", e))?;
            for b in b_rows {
                bom_items.push(b.map_err(|e| format!("Error reading bom item: {}", e))?);
            }
        }

        // Query supply sources for all collected units
        for u in &units {
            let mut src_stmt = conn
                .prepare("SELECT id, unit_id, vendor_partner_id, purchase_cost, currency, is_primary, created_at FROM product_supply_sources WHERE unit_id = ?1 ORDER BY is_primary DESC, created_at ASC")
                .map_err(|e| format!("Failed to prepare supply query: {}", e))?;
            let s_rows = src_stmt
                .query_map(params![&u.id], |row| {
                    let prim_int: i64 = row.get(5)?;
                    Ok(ProductSupplySource {
                        id: row.get(0)?,
                        unit_id: row.get(1)?,
                        vendor_partner_id: row.get(2)?,
                        purchase_cost: row.get(3)?,
                        currency: row.get(4)?,
                        is_primary: prim_int == 1,
                        created_at: row.get(6)?,
                    })
                })
                .map_err(|e| format!("Failed to query sources: {}", e))?;
            for s in s_rows {
                supply_sources.push(s.map_err(|e| format!("Error reading supply source: {}", e))?);
            }
        }
    }

    Ok(ProductDetail {
        product,
        variants,
        units,
        supply_sources,
        bom_items,
    })
}

// Usecase: add_product_variant
pub fn add_product_variant_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    product_id: &str,
    name: String,
    sku: Option<String>,
    spec_attributes: Option<serde_json::Value>,
) -> Result<ProductVariant, String> {
    let trimmed_tenant_id = tenant_id.trim();
    let trimmed_prod_id = product_id.trim();
    let trimmed_name = name.trim();

    if trimmed_tenant_id.is_empty() {
        return Err("Tenant ID cannot be empty".to_string());
    }
    if trimmed_prod_id.is_empty() {
        return Err("Product not found".to_string());
    }

    let clean_spec_attributes = match spec_attributes {
        Some(val) => {
            if !val.is_object() {
                return Err("規格屬性必須為 JSON 物件格式".to_string());
            }
            val
        }
        None => serde_json::json!({}),
    };

    let effective_name = if trimmed_name.is_empty() {
        if let Some(obj) = clean_spec_attributes.as_object() {
            let derived: Vec<&str> = obj
                .values()
                .filter_map(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
                .collect();
            if !derived.is_empty() {
                derived.join(" / ")
            } else {
                return Err("變體名稱不能為空".to_string());
            }
        } else {
            return Err("變體名稱不能為空".to_string());
        }
    } else {
        trimmed_name.to_string()
    };

    // Verify product exists in active tenant
    let mut check_prod = conn
        .prepare("SELECT 1 FROM products WHERE id = ?1 AND tenant_id = ?2 LIMIT 1")
        .map_err(|e| format!("Failed to prepare product check: {}", e))?;
    let has_prod = check_prod
        .query_row(params![trimmed_prod_id, trimmed_tenant_id], |_| Ok(()))
        .is_ok();
    if !has_prod {
        return Err("Product not found".to_string());
    }

    // Check duplicate variant name in this product
    let mut check_var = conn
        .prepare("SELECT 1 FROM product_variants WHERE product_id = ?1 AND LOWER(TRIM(name)) = LOWER(?2) LIMIT 1")
        .map_err(|e| format!("Failed to prepare variant duplicate check: {}", e))?;
    let has_dup = check_var
        .query_row(params![trimmed_prod_id, effective_name], |_| Ok(()))
        .is_ok();
    if has_dup {
        return Err(format!("變體「{}」已存在", effective_name));
    }

    let now = current_timestamp();
    let var_id = format!("var_{}_{}", now, ID_COUNTER.fetch_add(1, Ordering::Relaxed));
    let trimmed_sku = sku.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let spec_str =
        serde_json::to_string(&clean_spec_attributes).unwrap_or_else(|_| "{}".to_string());

    conn.execute(
        "INSERT INTO product_variants (id, product_id, sku, name, spec_attributes, is_default, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![var_id, trimmed_prod_id, trimmed_sku, effective_name, spec_str, 0, now],
    )
    .map_err(|e| format!("Failed to insert variant: {}", e))?;

    // Auto-create base unit for the new variant (satisfying "每個變體至少要有一個基礎單位")
    let mut default_unit_stmt = conn
        .prepare(
            "SELECT u.unit_name, u.selling_price
             FROM product_units u
             JOIN product_variants v ON u.variant_id = v.id
             WHERE v.product_id = ?1 AND u.is_base_unit = 1
             ORDER BY v.is_default DESC
             LIMIT 1",
        )
        .map_err(|e| format!("Failed to prepare default unit lookup: {}", e))?;
    let default_unit_row: Result<(String, f64), _> = default_unit_stmt
        .query_row(params![trimmed_prod_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        });

    let (base_unit_name, base_selling_price) = match default_unit_row {
        Ok((u_name, u_price)) => (u_name, u_price),
        Err(_) => ("個".to_string(), 0.0),
    };

    let base_unit_id = format!(
        "unit_{}_{}",
        now,
        ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    conn.execute(
        "INSERT INTO product_units (id, variant_id, unit_name, conversion_ratio, is_base_unit, selling_price, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![base_unit_id, var_id, base_unit_name, 1.0, 1, base_selling_price, now],
    )
    .map_err(|e| format!("Failed to insert base unit for variant: {}", e))?;

    Ok(ProductVariant {
        id: var_id,
        product_id: trimmed_prod_id.to_string(),
        sku: trimmed_sku,
        name: effective_name,
        spec_attributes: clean_spec_attributes,
        is_default: false,
        created_at: now,
    })
}

// Usecase: update_product_variant
pub fn update_product_variant_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    variant_id: &str,
    name: Option<String>,
    sku: Option<String>,
    spec_attributes: Option<serde_json::Value>,
) -> Result<ProductVariant, String> {
    let trimmed_tenant_id = tenant_id.trim();
    let trimmed_var_id = variant_id.trim();

    if trimmed_tenant_id.is_empty() {
        return Err("Tenant ID cannot be empty".to_string());
    }
    if trimmed_var_id.is_empty() {
        return Err("Variant not found".to_string());
    }

    // Verify variant exists and belongs to active tenant
    let mut check_var = conn
        .prepare(
            "SELECT v.id, v.product_id, v.sku, v.name, v.spec_attributes, v.is_default, v.created_at
             FROM product_variants v
             JOIN products p ON v.product_id = p.id
             WHERE v.id = ?1 AND p.tenant_id = ?2
             LIMIT 1",
        )
        .map_err(|e| format!("Failed to prepare variant lookup: {}", e))?;

    let existing = check_var
        .query_row(params![trimmed_var_id, trimmed_tenant_id], |row| {
            let is_default_int: i64 = row.get(5)?;
            let raw_spec: String = row.get(4).unwrap_or_else(|_| "{}".to_string());
            let spec_val = serde_json::from_str::<serde_json::Value>(&raw_spec)
                .unwrap_or(serde_json::json!({}));
            Ok(ProductVariant {
                id: row.get(0)?,
                product_id: row.get(1)?,
                sku: row.get(2)?,
                name: row.get(3)?,
                spec_attributes: spec_val,
                is_default: is_default_int == 1,
                created_at: row.get(6)?,
            })
        })
        .map_err(|_| "Variant not found".to_string())?;

    // Determine target name
    let new_name = match name {
        Some(n) => {
            let tr = n.trim().to_string();
            if tr.is_empty() {
                return Err("變體名稱不能為空".to_string());
            }
            tr
        }
        None => existing.name,
    };

    // Check duplicate name within this product excluding self
    let mut dup_stmt = conn
        .prepare(
            "SELECT 1 FROM product_variants
             WHERE product_id = ?1 AND id != ?2 AND LOWER(TRIM(name)) = LOWER(?3)
             LIMIT 1",
        )
        .map_err(|e| format!("Failed to prepare variant name duplicate check: {}", e))?;
    let has_dup = dup_stmt
        .query_row(params![existing.product_id, existing.id, new_name], |_| {
            Ok(())
        })
        .is_ok();
    if has_dup {
        return Err(format!("變體名稱「{}」已存在", new_name));
    }

    // Determine target SKU
    let new_sku = match sku {
        Some(s) => {
            let tr = s.trim().to_string();
            if tr.is_empty() {
                None
            } else {
                Some(tr)
            }
        }
        None => existing.sku,
    };

    // Determine target spec_attributes
    let new_spec_attributes = match spec_attributes {
        Some(val) => {
            if !val.is_object() {
                return Err("規格屬性必須為 JSON 物件格式".to_string());
            }
            val
        }
        None => existing.spec_attributes,
    };

    let spec_str = serde_json::to_string(&new_spec_attributes).unwrap_or_else(|_| "{}".to_string());

    conn.execute(
        "UPDATE product_variants
         SET name = ?1, sku = ?2, spec_attributes = ?3
         WHERE id = ?4",
        params![new_name, new_sku, spec_str, existing.id],
    )
    .map_err(|e| format!("Failed to update product variant: {}", e))?;

    Ok(ProductVariant {
        id: existing.id,
        product_id: existing.product_id,
        sku: new_sku,
        name: new_name,
        spec_attributes: new_spec_attributes,
        is_default: existing.is_default,
        created_at: existing.created_at,
    })
}

// Usecase: add_product_unit
pub fn add_product_unit_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    variant_id: &str,
    unit_name: String,
    conversion_ratio: f64,
    is_base_unit: Option<bool>,
    selling_price: f64,
) -> Result<ProductUnit, String> {
    let trimmed_tenant_id = tenant_id.trim();
    let trimmed_var_id = variant_id.trim();
    let trimmed_unit_name = unit_name.trim();

    if trimmed_tenant_id.is_empty() {
        return Err("Tenant ID cannot be empty".to_string());
    }
    if trimmed_var_id.is_empty() {
        return Err("Product variant not found".to_string());
    }
    if trimmed_unit_name.is_empty() {
        return Err("單位名稱不能為空".to_string());
    }
    if conversion_ratio <= 0.0 {
        return Err("換算比例必須大於 0".to_string());
    }
    if selling_price < 0.0 {
        return Err("售價不能為負數".to_string());
    }

    // Verify variant belongs to product in active tenant (support variant_id or fallback to default variant if prod_id)
    let mut check_stmt = conn
        .prepare("SELECT v.id FROM product_variants v JOIN products p ON v.product_id = p.id WHERE (v.id = ?1 OR v.product_id = ?1) AND p.tenant_id = ?2 ORDER BY v.is_default DESC LIMIT 1")
        .map_err(|e| format!("Failed to prepare variant ownership check: {}", e))?;
    let resolved_var_id: Result<String, _> =
        check_stmt.query_row(params![trimmed_var_id, trimmed_tenant_id], |row| row.get(0));
    let actual_var_id = match resolved_var_id {
        Ok(id) => id,
        Err(_) => return Err("Product variant not found".to_string()),
    };

    // Check if duplicate unit_name exists in this variant
    let mut check_dup_unit = conn
        .prepare("SELECT 1 FROM product_units WHERE variant_id = ?1 AND LOWER(TRIM(unit_name)) = LOWER(?2) LIMIT 1")
        .map_err(|e| format!("Failed to prepare unit duplicate check: {}", e))?;
    let has_dup = check_dup_unit
        .query_row(params![actual_var_id, trimmed_unit_name], |_| Ok(()))
        .is_ok();
    if has_dup {
        return Err(format!("單位「{}」已存在", trimmed_unit_name));
    }

    let now = current_timestamp();
    let unit_id = format!(
        "unit_{}_{}",
        now,
        ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let is_base = is_base_unit.unwrap_or(false);
    let effective_ratio = if is_base { 1.0 } else { conversion_ratio };

    if is_base {
        conn.execute(
            "UPDATE product_units SET is_base_unit = 0 WHERE variant_id = ?1",
            params![actual_var_id],
        )
        .map_err(|e| format!("Failed to unset other base units: {}", e))?;
    }

    conn.execute(
        "INSERT INTO product_units (id, variant_id, unit_name, conversion_ratio, is_base_unit, selling_price, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            unit_id,
            actual_var_id,
            trimmed_unit_name,
            effective_ratio,
            if is_base { 1 } else { 0 },
            selling_price,
            now
        ],
    )
    .map_err(|e| format!("Failed to insert unit: {}", e))?;

    Ok(ProductUnit {
        id: unit_id,
        variant_id: actual_var_id,
        unit_name: trimmed_unit_name.to_string(),
        conversion_ratio: effective_ratio,
        is_base_unit: is_base,
        selling_price,
        created_at: now,
    })
}

// Usecase: update_product_unit
pub fn update_product_unit_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    unit_id: &str,
    unit_name: Option<String>,
    conversion_ratio: Option<f64>,
    is_base_unit: Option<bool>,
    selling_price: Option<f64>,
) -> Result<ProductUnit, String> {
    let trimmed_tenant_id = tenant_id.trim();
    let trimmed_unit_id = unit_id.trim();

    if trimmed_tenant_id.is_empty() {
        return Err("Tenant ID cannot be empty".to_string());
    }
    if trimmed_unit_id.is_empty() {
        return Err("Product unit not found".to_string());
    }

    // Verify unit ownership and fetch current values
    let mut query_stmt = conn
        .prepare(
            "SELECT u.id, u.variant_id, u.unit_name, u.conversion_ratio, u.is_base_unit, u.selling_price, u.created_at, p.id
             FROM product_units u
             JOIN product_variants v ON u.variant_id = v.id
             JOIN products p ON v.product_id = p.id
             WHERE u.id = ?1 AND p.tenant_id = ?2",
        )
        .map_err(|e| format!("Failed to prepare unit lookup: {}", e))?;

    let current = query_stmt.query_row(params![trimmed_unit_id, trimmed_tenant_id], |row| {
        let is_base_int: i64 = row.get(4)?;
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, f64>(3)?,
            is_base_int == 1,
            row.get::<_, f64>(5)?,
            row.get::<_, i64>(6)?,
        ))
    });

    let (cur_id, var_id, cur_name, cur_ratio, cur_is_base, cur_price, cur_created_at) =
        match current {
            Ok(c) => c,
            Err(_) => return Err("Product unit not found".to_string()),
        };

    // 1. Process unit_name
    let effective_name = if let Some(n) = unit_name {
        let trimmed = n.trim().to_string();
        if trimmed.is_empty() {
            return Err("單位名稱不能為空".to_string());
        }
        // Duplicate check in same variant excluding self
        let mut dup_stmt = conn
            .prepare("SELECT 1 FROM product_units WHERE variant_id = ?1 AND LOWER(TRIM(unit_name)) = LOWER(?2) AND id != ?3 LIMIT 1")
            .map_err(|e| format!("Failed to prepare duplicate check: {}", e))?;
        if dup_stmt
            .query_row(params![var_id, trimmed, cur_id], |_| Ok(()))
            .is_ok()
        {
            return Err(format!("單位「{}」已存在", trimmed));
        }
        trimmed
    } else {
        cur_name
    };

    // 2. Process is_base_unit & conversion_ratio
    let target_is_base = is_base_unit.unwrap_or(cur_is_base);

    // If trying to demote the only base unit
    if cur_is_base && !target_is_base {
        let mut count_base = conn
            .prepare("SELECT COUNT(*) FROM product_units WHERE variant_id = ?1 AND is_base_unit = 1 AND id != ?2")
            .map_err(|e| format!("Failed to count other base units: {}", e))?;
        let other_base_count: i64 = count_base
            .query_row(params![var_id, cur_id], |row| row.get(0))
            .unwrap_or(0);
        if other_base_count == 0 {
            return Err("每個變體至少要有一個基準單位".to_string());
        }
    }

    let effective_ratio = if target_is_base {
        // Base unit ratio is always locked to 1.0
        if let Some(r) = conversion_ratio {
            if (r - 1.0).abs() > f64::EPSILON {
                return Err("基準單位換算比例必須為 1".to_string());
            }
        }
        1.0
    } else if let Some(r) = conversion_ratio {
        if r <= 0.0 {
            return Err("換算比例必須大於 0".to_string());
        }
        r
    } else {
        cur_ratio
    };

    // 3. Process selling_price
    let effective_price = if let Some(p) = selling_price {
        if p < 0.0 {
            return Err("售價不能為負數".to_string());
        }
        p
    } else {
        cur_price
    };

    // If target is now base unit, unset other units in this variant
    if target_is_base && !cur_is_base {
        conn.execute(
            "UPDATE product_units SET is_base_unit = 0 WHERE variant_id = ?1 AND id != ?2",
            params![var_id, cur_id],
        )
        .map_err(|e| format!("Failed to unset other base units: {}", e))?;
    }

    conn.execute(
        "UPDATE product_units SET unit_name = ?1, conversion_ratio = ?2, is_base_unit = ?3, selling_price = ?4 WHERE id = ?5",
        params![
            effective_name,
            effective_ratio,
            if target_is_base { 1 } else { 0 },
            effective_price,
            cur_id
        ],
    )
    .map_err(|e| format!("Failed to update unit: {}", e))?;

    Ok(ProductUnit {
        id: cur_id,
        variant_id: var_id,
        unit_name: effective_name,
        conversion_ratio: effective_ratio,
        is_base_unit: target_is_base,
        selling_price: effective_price,
        created_at: cur_created_at,
    })
}

// Usecase: add_supply_source
pub fn add_supply_source_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    unit_id: &str,
    vendor_partner_id: &str,
    purchase_cost: f64,
    currency: Option<String>,
    is_primary: Option<bool>,
) -> Result<ProductSupplySource, String> {
    let trimmed_tenant_id = tenant_id.trim();
    let trimmed_unit_id = unit_id.trim();
    let trimmed_vendor_id = vendor_partner_id.trim();

    if trimmed_tenant_id.is_empty() {
        return Err("Tenant ID cannot be empty".to_string());
    }
    if trimmed_unit_id.is_empty() {
        return Err("Product unit not found".to_string());
    }
    if trimmed_vendor_id.is_empty() {
        return Err("供應商不存在或無效".to_string());
    }
    if purchase_cost < 0.0 {
        return Err("採購成本不能為負數".to_string());
    }

    // Verify unit belongs to product in active tenant.
    // Resilient resolution: supports direct unit_id, or fallback via variant_id/product_id
    // to find that variant's base unit (is_base_unit = 1).
    let mut check_unit = conn
        .prepare(
            "SELECT u.id \
             FROM product_units u \
             JOIN product_variants v ON u.variant_id = v.id \
             JOIN products p ON v.product_id = p.id \
             WHERE (u.id = ?1 OR u.variant_id = ?1 OR v.product_id = ?1) \
               AND p.tenant_id = ?2 \
             ORDER BY u.is_base_unit DESC, v.is_default DESC \
             LIMIT 1",
        )
        .map_err(|e| format!("Failed to prepare unit ownership check: {}", e))?;
    let resolved_unit_id: Result<String, _> = check_unit
        .query_row(params![trimmed_unit_id, trimmed_tenant_id], |row| {
            row.get(0)
        });
    let actual_unit_id = match resolved_unit_id {
        Ok(id) => id,
        Err(_) => return Err("Product unit not found".to_string()),
    };

    // Verify vendor partner exists in same tenant and is_vendor = 1
    let mut check_vendor = conn
        .prepare(
            "SELECT 1 FROM partners WHERE id = ?1 AND tenant_id = ?2 AND is_vendor = 1 LIMIT 1",
        )
        .map_err(|e| format!("Failed to prepare vendor check: {}", e))?;
    let has_vendor = check_vendor
        .query_row(params![trimmed_vendor_id, trimmed_tenant_id], |_| Ok(()))
        .is_ok();
    if !has_vendor {
        return Err("供應商不存在或無效".to_string());
    }

    let now = current_timestamp();
    let src_id = format!("src_{}_{}", now, ID_COUNTER.fetch_add(1, Ordering::Relaxed));
    let cur = currency
        .map(|c| c.trim().to_string())
        .filter(|c| !c.is_empty())
        .unwrap_or_else(|| "TWD".to_string());
    let is_prim = is_primary.unwrap_or(false);

    conn.execute(
        "INSERT INTO product_supply_sources (id, unit_id, vendor_partner_id, purchase_cost, currency, is_primary, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            src_id,
            actual_unit_id,
            trimmed_vendor_id,
            purchase_cost,
            cur,
            if is_prim { 1 } else { 0 },
            now
        ],
    )
    .map_err(|e| format!("Failed to insert supply source: {}", e))?;

    Ok(ProductSupplySource {
        id: src_id,
        unit_id: actual_unit_id,
        vendor_partner_id: trimmed_vendor_id.to_string(),
        purchase_cost,
        currency: cur,
        is_primary: is_prim,
        created_at: now,
    })
}

// Usecase: add_bom_item
pub fn add_bom_item_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    parent_variant_id: &str,
    child_variant_id: &str,
    quantity: f64,
) -> Result<ProductBomItem, String> {
    let trimmed_tenant_id = tenant_id.trim();
    let trimmed_parent_vid = parent_variant_id.trim();
    let trimmed_child_vid = child_variant_id.trim();

    if trimmed_tenant_id.is_empty() {
        return Err("Tenant ID cannot be empty".to_string());
    }
    if trimmed_parent_vid.is_empty() || trimmed_child_vid.is_empty() {
        return Err("母規格變體不存在或子物料變體不存在".to_string());
    }
    if quantity <= 0.0 {
        return Err("BOM 用量必須大於 0".to_string());
    }

    // Verify parent variant belongs to manufactured product in active tenant (support variant_id or fallback to default variant if prod_id)
    let mut check_parent = conn
        .prepare("SELECT v.id, p.category FROM product_variants v JOIN products p ON v.product_id = p.id WHERE (v.id = ?1 OR v.product_id = ?1) AND p.tenant_id = ?2 ORDER BY v.is_default DESC LIMIT 1")
        .map_err(|e| format!("Failed to prepare parent variant check: {}", e))?;
    let parent_info: Result<(String, String), _> = check_parent
        .query_row(params![trimmed_parent_vid, trimmed_tenant_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        });

    let (actual_parent_vid, cat) = match parent_info {
        Ok(info) => info,
        Err(_) => return Err("母規格變體不存在".to_string()),
    };

    if cat != "manufactured" {
        return Err("非自製成品不可建立 BOM 組成".to_string());
    }

    let potential_child_pid =
        if trimmed_child_vid.starts_with("var_") && trimmed_child_vid.ends_with("_std") {
            &trimmed_child_vid[4..trimmed_child_vid.len() - 4]
        } else {
            trimmed_child_vid
        };

    // Verify child variant belongs to product in active tenant (support variant_id or product_id or synthetic ID)
    let mut check_child = conn
        .prepare("SELECT v.id, p.name, v.name, v.sku FROM product_variants v JOIN products p ON v.product_id = p.id WHERE (v.id = ?1 OR v.product_id = ?1 OR v.product_id = ?2) AND p.tenant_id = ?3 ORDER BY v.is_default DESC LIMIT 1")
        .map_err(|e| format!("Failed to prepare child variant check: {}", e))?;
    let resolved_child: Result<(String, String, String, Option<String>), _> = check_child
        .query_row(
            params![trimmed_child_vid, potential_child_pid, trimmed_tenant_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        );
    let (actual_child_vid, child_pname, child_vname, child_sku) = match resolved_child {
        Ok(info) => info,
        Err(_) => return Err("子物料變體不存在或不屬於同一租戶".to_string()),
    };

    if actual_parent_vid == actual_child_vid {
        return Err("BOM 子物料不能為自身".to_string());
    }

    let now = current_timestamp();
    let bom_id = format!("bom_{}_{}", now, ID_COUNTER.fetch_add(1, Ordering::Relaxed));

    conn.execute(
        "INSERT INTO product_bom_items (id, parent_variant_id, child_variant_id, quantity, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![bom_id, actual_parent_vid, actual_child_vid, quantity, now],
    )
    .map_err(|e| format!("Failed to insert bom item: {}", e))?;

    Ok(ProductBomItem {
        id: bom_id,
        parent_variant_id: actual_parent_vid,
        child_variant_id: actual_child_vid,
        quantity,
        created_at: now,
        child_product_name: Some(child_pname),
        child_variant_name: Some(child_vname),
        child_sku,
    })
}

// Delivery layer: Tauri Commands
#[tauri::command]
#[specta::specta]
pub async fn create_product<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    name: String,
    category: String,
    sku: Option<String>,
    unit_name: Option<String>,
    selling_price: Option<f64>,
) -> Result<ProductDetail, String> {
    let db_path = get_db_path(&app_handle);
    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Failed to open DB: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    create_product_impl(
        &conn,
        &active_tid,
        name,
        category,
        sku,
        unit_name,
        selling_price,
    )
}

#[tauri::command]
#[specta::specta]
pub async fn list_products<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    filter_category: Option<String>,
    filter_sellable: Option<bool>,
    filter_purchasable: Option<bool>,
) -> Result<Vec<Product>, String> {
    let db_path = get_db_path(&app_handle);
    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Failed to open DB: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    list_products_impl(
        &conn,
        &active_tid,
        filter_category,
        filter_sellable,
        filter_purchasable,
    )
}

#[tauri::command]
#[specta::specta]
pub async fn get_product_detail<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    product_id: String,
) -> Result<ProductDetail, String> {
    let db_path = get_db_path(&app_handle);
    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Failed to open DB: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    get_product_detail_impl(&conn, &active_tid, &product_id)
}

#[tauri::command]
#[specta::specta]
pub async fn add_product_variant<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    product_id: String,
    name: String,
    sku: Option<String>,
    spec_attributes: Option<serde_json::Value>,
) -> Result<ProductVariant, String> {
    let db_path = get_db_path(&app_handle);
    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Failed to open DB: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    add_product_variant_impl(&conn, &active_tid, &product_id, name, sku, spec_attributes)
}

#[tauri::command]
#[specta::specta]
pub async fn update_product_variant<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    variant_id: String,
    name: Option<String>,
    sku: Option<String>,
    spec_attributes: Option<serde_json::Value>,
) -> Result<ProductVariant, String> {
    let db_path = get_db_path(&app_handle);
    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Failed to open DB: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    update_product_variant_impl(&conn, &active_tid, &variant_id, name, sku, spec_attributes)
}

#[tauri::command]
#[specta::specta]
pub async fn add_product_unit<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    variant_id: String,
    unit_name: String,
    conversion_ratio: f64,
    is_base_unit: Option<bool>,
    selling_price: f64,
) -> Result<ProductUnit, String> {
    let db_path = get_db_path(&app_handle);
    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Failed to open DB: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    add_product_unit_impl(
        &conn,
        &active_tid,
        &variant_id,
        unit_name,
        conversion_ratio,
        is_base_unit,
        selling_price,
    )
}

#[tauri::command]
#[specta::specta]
pub async fn update_product_unit<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    unit_id: String,
    unit_name: Option<String>,
    conversion_ratio: Option<f64>,
    is_base_unit: Option<bool>,
    selling_price: Option<f64>,
) -> Result<ProductUnit, String> {
    let db_path = get_db_path(&app_handle);
    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Failed to open DB: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    update_product_unit_impl(
        &conn,
        &active_tid,
        &unit_id,
        unit_name,
        conversion_ratio,
        is_base_unit,
        selling_price,
    )
}

#[tauri::command]
#[specta::specta]
pub async fn add_supply_source<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    unit_id: String,
    vendor_partner_id: String,
    purchase_cost: f64,
    currency: Option<String>,
    is_primary: Option<bool>,
) -> Result<ProductSupplySource, String> {
    let db_path = get_db_path(&app_handle);
    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Failed to open DB: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    add_supply_source_impl(
        &conn,
        &active_tid,
        &unit_id,
        &vendor_partner_id,
        purchase_cost,
        currency,
        is_primary,
    )
}

#[tauri::command]
#[specta::specta]
pub async fn add_bom_item<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    parent_variant_id: String,
    child_variant_id: String,
    quantity: f64,
) -> Result<ProductBomItem, String> {
    let db_path = get_db_path(&app_handle);
    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Failed to open DB: {}", e))?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    add_bom_item_impl(
        &conn,
        &active_tid,
        &parent_variant_id,
        &child_variant_id,
        quantity,
    )
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::partners::create_partners_table;

    pub const TEST_TENANT_A: &str = "tnt_prod_a";
    pub const TEST_TENANT_B: &str = "tnt_prod_b";

    pub fn setup_test_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        create_products_tables(&conn).unwrap();
        create_partners_table(&conn).unwrap();
        conn
    }

    #[test]
    fn test_tc_prod_pos_01_create_resale_product_with_default_variant() {
        // Given: Clean in-memory DB and resale category input
        let conn = setup_test_db();
        let name = "智能核心晶片".to_string();

        // When: create_product_impl is invoked
        let result = create_product_impl(
            &conn,
            TEST_TENANT_A,
            name.clone(),
            "轉售商品".to_string(),
            Some("CHIP-001".to_string()),
            Some("顆".to_string()),
            Some(120.0),
        )
        .unwrap();

        // Then: Product has both sellable and purchasable flags true, auto default variant and base unit
        assert_eq!(result.product.name, name);
        assert_eq!(result.product.category, "resale");
        assert!(result.product.is_sellable);
        assert!(result.product.is_purchasable);
        assert_eq!(result.variants.len(), 1);
        assert_eq!(result.variants[0].name, "標準");
        assert!(result.variants[0].is_default);
        assert_eq!(result.variants[0].sku.as_deref(), Some("CHIP-001"));
        assert_eq!(result.units.len(), 1);
        assert_eq!(result.units[0].unit_name, "顆");
        assert_eq!(result.units[0].selling_price, 120.0);
    }

    #[test]
    fn test_tc_prod_pos_02_create_manufactured_product() {
        // Given: Clean in-memory DB and manufactured category input
        let conn = setup_test_db();
        let name = "AI伺服器機櫃".to_string();

        // When: create_product_impl is invoked
        let result = create_product_impl(
            &conn,
            TEST_TENANT_A,
            name.clone(),
            "自製成品".to_string(),
            None,
            Some("台".to_string()),
            Some(150000.0),
        )
        .unwrap();

        // Then: Product is sellable but NOT purchasable
        assert_eq!(result.product.category, "manufactured");
        assert!(result.product.is_sellable);
        assert!(!result.product.is_purchasable);
    }

    #[test]
    fn test_tc_prod_pos_03_create_raw_material_product() {
        // Given: Clean in-memory DB and raw material category input
        let conn = setup_test_db();
        let name = "散熱鋁片".to_string();

        // When: create_product_impl is invoked
        let result = create_product_impl(
            &conn,
            TEST_TENANT_A,
            name.clone(),
            "原物料".to_string(),
            None,
            None,
            None,
        )
        .unwrap();

        // Then: Product is NOT sellable but purchasable
        assert_eq!(result.product.category, "raw_material");
        assert!(!result.product.is_sellable);
        assert!(result.product.is_purchasable);
        assert_eq!(result.units[0].unit_name, "個");
        assert_eq!(result.units[0].selling_price, 0.0);
    }

    #[test]
    fn test_tc_prod_pos_04_list_products_and_filter() {
        // Given: Multiple products with different categories
        let conn = setup_test_db();
        create_product_impl(
            &conn,
            TEST_TENANT_A,
            "商品1".into(),
            "resale".into(),
            None,
            None,
            None,
        )
        .unwrap();
        create_product_impl(
            &conn,
            TEST_TENANT_A,
            "商品2".into(),
            "manufactured".into(),
            None,
            None,
            None,
        )
        .unwrap();
        create_product_impl(
            &conn,
            TEST_TENANT_A,
            "商品3".into(),
            "raw_material".into(),
            None,
            None,
            None,
        )
        .unwrap();

        // When: list_products_impl with various filters
        let all = list_products_impl(&conn, TEST_TENANT_A, None, None, None).unwrap();
        let resale_only =
            list_products_impl(&conn, TEST_TENANT_A, Some("resale".into()), None, None).unwrap();
        let sellable_only =
            list_products_impl(&conn, TEST_TENANT_A, None, Some(true), None).unwrap();
        let purchasable_only =
            list_products_impl(&conn, TEST_TENANT_A, None, None, Some(true)).unwrap();

        // Then: Filter counts match expectations
        assert_eq!(all.len(), 3);
        assert_eq!(resale_only.len(), 1);
        assert_eq!(sellable_only.len(), 2);
        assert_eq!(purchasable_only.len(), 2);
    }

    #[test]
    fn test_tc_prod_pos_05_add_variant() {
        // Given: An existing product
        let conn = setup_test_db();
        let p = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "晶片".into(),
            "resale".into(),
            None,
            None,
            None,
        )
        .unwrap();

        // When: Adding a new variant
        let v = add_product_variant_impl(
            &conn,
            TEST_TENANT_A,
            &p.product.id,
            "512GB 灰色".into(),
            Some("CHIP-512G-GRY".into()),
            Some(serde_json::json!({"規格": "512GB", "顏色": "灰色"})),
        )
        .unwrap();

        // Then: Variant is added successfully
        assert_eq!(v.name, "512GB 灰色");
        assert_eq!(v.spec_attributes["規格"], "512GB");
        assert_eq!(v.spec_attributes["顏色"], "灰色");
        assert!(!v.is_default);

        let detail = get_product_detail_impl(&conn, TEST_TENANT_A, &p.product.id).unwrap();
        assert_eq!(detail.variants.len(), 2);
    }

    #[test]
    fn test_tc_prod_pos_06_add_packaging_unit() {
        // Given: Product with default variant
        let conn = setup_test_db();
        let p = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "晶片".into(),
            "resale".into(),
            None,
            Some("顆".into()),
            Some(100.0),
        )
        .unwrap();
        let var_id = &p.variants[0].id;

        // When: Adding a packaging unit (box: 24 units, price: 2200)
        let unit = add_product_unit_impl(
            &conn,
            TEST_TENANT_A,
            var_id,
            "盒".into(),
            24.0,
            Some(false),
            2200.0,
        )
        .unwrap();

        // Then: Unit is recorded properly
        assert_eq!(unit.unit_name, "盒");
        assert_eq!(unit.conversion_ratio, 24.0);
        assert_eq!(unit.selling_price, 2200.0);

        let detail = get_product_detail_impl(&conn, TEST_TENANT_A, &p.product.id).unwrap();
        assert_eq!(detail.units.len(), 2);
    }

    #[test]
    fn test_tc_prod_pos_07_add_supply_source() {
        // Given: Product with default unit and vendor partner in same tenant
        let conn = setup_test_db();
        let p = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "晶片".into(),
            "resale".into(),
            None,
            Some("個".into()),
            Some(100.0),
        )
        .unwrap();
        let vendor = crate::partners::create_partner_impl(
            &conn,
            TEST_TENANT_A,
            "台積電".into(),
            None,
            Some(true),
            Some("22099131".into()),
        )
        .unwrap();

        // When: Adding supply source with valid vendor for base unit "個"
        let base_unit_id = &p.units[0].id;
        let src_base = add_supply_source_impl(
            &conn,
            TEST_TENANT_A,
            base_unit_id,
            &vendor.id,
            85.0,
            Some("TWD".into()),
            Some(true),
        )
        .unwrap();

        // Then: Supply source is linked to base unit
        assert_eq!(src_base.unit_id, *base_unit_id);
        assert_eq!(src_base.vendor_partner_id, vendor.id);
        assert_eq!(src_base.purchase_cost, 85.0);
        assert!(src_base.is_primary);

        // When: Adding packaging unit "箱" (x10) and separate supply cost (800.0)
        let box_unit = add_product_unit_impl(
            &conn,
            TEST_TENANT_A,
            &p.variants[0].id,
            "箱".into(),
            10.0,
            Some(false),
            950.0,
        )
        .unwrap();
        let src_box = add_supply_source_impl(
            &conn,
            TEST_TENANT_A,
            &box_unit.id,
            &vendor.id,
            800.0,
            Some("TWD".into()),
            Some(false),
        )
        .unwrap();

        // Then: Box unit has its own distinct purchase cost
        assert_eq!(src_box.unit_id, box_unit.id);
        assert_eq!(src_box.purchase_cost, 800.0);

        let detail = get_product_detail_impl(&conn, TEST_TENANT_A, &p.product.id).unwrap();
        assert_eq!(detail.supply_sources.len(), 2);
        assert!(detail
            .supply_sources
            .iter()
            .any(|s| s.unit_id == *base_unit_id && s.purchase_cost == 85.0));
        assert!(detail
            .supply_sources
            .iter()
            .any(|s| s.unit_id == box_unit.id && s.purchase_cost == 800.0));
    }

    #[test]
    fn test_tc_prod_pos_08_add_bom_item() {
        // Given: Manufactured parent product and raw material child product
        let conn = setup_test_db();
        let parent = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "伺服器".into(),
            "manufactured".into(),
            None,
            None,
            None,
        )
        .unwrap();
        let child = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "散熱片".into(),
            "raw_material".into(),
            None,
            None,
            None,
        )
        .unwrap();

        // When: Adding BOM item
        let bom = add_bom_item_impl(
            &conn,
            TEST_TENANT_A,
            &parent.variants[0].id,
            &child.variants[0].id,
            4.0,
        )
        .unwrap();

        // Then: BOM item is linked with correct quantity and child names
        assert_eq!(bom.parent_variant_id, parent.variants[0].id);
        assert_eq!(bom.child_variant_id, child.variants[0].id);
        assert_eq!(bom.quantity, 4.0);
        assert_eq!(bom.child_product_name, Some("散熱片".to_string()));
        assert_eq!(bom.child_variant_name, Some("標準".to_string()));

        let detail = get_product_detail_impl(&conn, TEST_TENANT_A, &parent.product.id).unwrap();
        assert_eq!(detail.bom_items.len(), 1);
        assert_eq!(
            detail.bom_items[0].child_product_name,
            Some("散熱片".to_string())
        );
        assert_eq!(
            detail.bom_items[0].child_variant_name,
            Some("標準".to_string())
        );
    }

    #[test]
    fn test_tc_prod_neg_01_empty_product_name_error() {
        // Given: Empty or whitespace product name
        let conn = setup_test_db();

        // When: Trying to create product
        let err1 = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "".into(),
            "resale".into(),
            None,
            None,
            None,
        );
        let err2 = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "   ".into(),
            "resale".into(),
            None,
            None,
            None,
        );

        // Then: Validation error is returned
        assert_eq!(err1.unwrap_err(), "商品名稱不能為空");
        assert_eq!(err2.unwrap_err(), "商品名稱不能為空");
    }

    #[test]
    fn test_tc_prod_neg_02_invalid_category_error() {
        // Given: Invalid category string
        let conn = setup_test_db();

        // When: Trying to create product
        let err = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "商品".into(),
            "unknown_cat".into(),
            None,
            None,
            None,
        );

        // Then: Category validation error is returned
        assert!(err.unwrap_err().contains("無效的商品類別"));
    }

    #[test]
    fn test_tc_prod_neg_03_duplicate_product_name_error() {
        // Given: Existing product "智能晶片"
        let conn = setup_test_db();
        create_product_impl(
            &conn,
            TEST_TENANT_A,
            "智能晶片".into(),
            "resale".into(),
            None,
            None,
            None,
        )
        .unwrap();

        // When: Creating duplicate product with same trimmed/case-insensitive name
        let err = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "  智能晶片  ".into(),
            "resale".into(),
            None,
            None,
            None,
        );

        // Then: Duplicate error is returned
        assert_eq!(err.unwrap_err(), "商品「智能晶片」已存在，請使用不同名稱");
    }

    #[test]
    fn test_tc_prod_neg_04_invalid_conversion_ratio_error() {
        // Given: Product with variant
        let conn = setup_test_db();
        let p = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "商品".into(),
            "resale".into(),
            None,
            None,
            None,
        )
        .unwrap();

        // When: Ratio <= 0
        let err1 = add_product_unit_impl(
            &conn,
            TEST_TENANT_A,
            &p.variants[0].id,
            "箱".into(),
            0.0,
            None,
            100.0,
        );
        let err2 = add_product_unit_impl(
            &conn,
            TEST_TENANT_A,
            &p.variants[0].id,
            "箱".into(),
            -1.0,
            None,
            100.0,
        );

        // Then: Validation error
        assert_eq!(err1.unwrap_err(), "換算比例必須大於 0");
        assert_eq!(err2.unwrap_err(), "換算比例必須大於 0");
    }

    #[test]
    fn test_tc_prod_neg_05_negative_selling_price_error() {
        // Given: Product with variant
        let conn = setup_test_db();
        let p = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "商品".into(),
            "resale".into(),
            None,
            None,
            None,
        )
        .unwrap();

        // When: Selling price < 0
        let err = add_product_unit_impl(
            &conn,
            TEST_TENANT_A,
            &p.variants[0].id,
            "箱".into(),
            10.0,
            None,
            -50.0,
        );

        // Then: Validation error
        assert_eq!(err.unwrap_err(), "售價不能為負數");
    }

    #[test]
    fn test_tc_prod_neg_06_negative_purchase_cost_error() {
        // Given: Product with variant and vendor
        let conn = setup_test_db();
        let p = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "商品".into(),
            "resale".into(),
            None,
            None,
            None,
        )
        .unwrap();
        let v = crate::partners::create_partner_impl(
            &conn,
            TEST_TENANT_A,
            "供應商".into(),
            None,
            Some(true),
            None,
        )
        .unwrap();

        // When: Cost < 0
        let err = add_supply_source_impl(
            &conn,
            TEST_TENANT_A,
            &p.units[0].id,
            &v.id,
            -10.0,
            None,
            None,
        );

        // Then: Validation error
        assert_eq!(err.unwrap_err(), "採購成本不能為負數");
    }

    #[test]
    fn test_tc_prod_neg_07_invalid_or_non_vendor_partner_error() {
        // Given: Partner with only customer identity (is_vendor = false)
        let conn = setup_test_db();
        let p = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "商品".into(),
            "resale".into(),
            None,
            None,
            None,
        )
        .unwrap();
        let cust = crate::partners::create_partner_impl(
            &conn,
            TEST_TENANT_A,
            "純客戶".into(),
            Some(true),
            Some(false),
            None,
        )
        .unwrap();

        // When: Trying to bind customer as supply source
        let err = add_supply_source_impl(
            &conn,
            TEST_TENANT_A,
            &p.units[0].id,
            &cust.id,
            50.0,
            None,
            None,
        );

        // Then: Vendor validation error
        assert_eq!(err.unwrap_err(), "供應商不存在或無效");
    }

    #[test]
    fn test_tc_prod_neg_08_non_manufactured_bom_error() {
        // Given: Resale parent product
        let conn = setup_test_db();
        let parent = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "轉售品".into(),
            "resale".into(),
            None,
            None,
            None,
        )
        .unwrap();
        let child = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "原料".into(),
            "raw_material".into(),
            None,
            None,
            None,
        )
        .unwrap();

        // When: Adding BOM to resale product
        let err = add_bom_item_impl(
            &conn,
            TEST_TENANT_A,
            &parent.variants[0].id,
            &child.variants[0].id,
            1.0,
        );

        // Then: Rejection error
        assert_eq!(err.unwrap_err(), "非自製成品不可建立 BOM 組成");
    }

    #[test]
    fn test_tc_prod_neg_09_bom_self_reference_error() {
        // Given: Manufactured product
        let conn = setup_test_db();
        let p = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "自製品".into(),
            "manufactured".into(),
            None,
            None,
            None,
        )
        .unwrap();

        // When: Self referencing BOM item
        let err = add_bom_item_impl(
            &conn,
            TEST_TENANT_A,
            &p.variants[0].id,
            &p.variants[0].id,
            1.0,
        );

        // Then: Self reference error
        assert_eq!(err.unwrap_err(), "BOM 子物料不能為自身");
    }

    #[test]
    fn test_tc_prod_neg_10_bom_invalid_quantity_error() {
        // Given: Manufactured parent and child
        let conn = setup_test_db();
        let parent = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "母成品".into(),
            "manufactured".into(),
            None,
            None,
            None,
        )
        .unwrap();
        let child = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "子物料".into(),
            "raw_material".into(),
            None,
            None,
            None,
        )
        .unwrap();

        // When: Quantity <= 0
        let err1 = add_bom_item_impl(
            &conn,
            TEST_TENANT_A,
            &parent.variants[0].id,
            &child.variants[0].id,
            0.0,
        );
        let err2 = add_bom_item_impl(
            &conn,
            TEST_TENANT_A,
            &parent.variants[0].id,
            &child.variants[0].id,
            -2.0,
        );

        // Then: Quantity error
        assert_eq!(err1.unwrap_err(), "BOM 用量必須大於 0");
        assert_eq!(err2.unwrap_err(), "BOM 用量必須大於 0");
    }

    #[test]
    fn test_tc_prod_bnd_01_and_02_and_03_boundary_values() {
        // Given: Whitespace name and zero price / cost
        let conn = setup_test_db();

        // When: Creating product with whitespace trimming and 0.0 price
        let p = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "   邊界晶片   ".into(),
            "resale".into(),
            None,
            Some("  件  ".into()),
            Some(0.0),
        )
        .unwrap();

        // Then: Name is trimmed, unit is trimmed, 0.0 selling price is allowed
        assert_eq!(p.product.name, "邊界晶片");
        assert_eq!(p.units[0].unit_name, "件");
        assert_eq!(p.units[0].selling_price, 0.0);

        // When: Supply source with 0.0 cost
        let v = crate::partners::create_partner_impl(
            &conn,
            TEST_TENANT_A,
            "免費供應商".into(),
            None,
            Some(true),
            None,
        )
        .unwrap();
        let src =
            add_supply_source_impl(&conn, TEST_TENANT_A, &p.units[0].id, &v.id, 0.0, None, None)
                .unwrap();

        // Then: 0.0 cost is allowed
        assert_eq!(src.purchase_cost, 0.0);
        assert_eq!(src.unit_id, p.units[0].id);
    }

    #[test]
    fn test_tc_prod_iso_01_cross_tenant_same_name_success() {
        // Given: DB with Tenant A and Tenant B
        let conn = setup_test_db();
        let name = "通用處理器".to_string();

        // When: Creating same named product in Tenant A and Tenant B
        let prod_a = create_product_impl(
            &conn,
            TEST_TENANT_A,
            name.clone(),
            "resale".into(),
            None,
            None,
            None,
        )
        .unwrap();
        let prod_b = create_product_impl(
            &conn,
            TEST_TENANT_B,
            name.clone(),
            "resale".into(),
            None,
            None,
            None,
        )
        .unwrap();

        // Then: Both succeed with distinct IDs and isolated tenants
        assert_ne!(prod_a.product.id, prod_b.product.id);
        assert_eq!(prod_a.product.tenant_id, TEST_TENANT_A);
        assert_eq!(prod_b.product.tenant_id, TEST_TENANT_B);
    }

    #[test]
    fn test_tc_prod_iso_02_list_products_tenant_isolation() {
        // Given: Tenant A has 2 products, Tenant B has 1 product
        let conn = setup_test_db();
        create_product_impl(
            &conn,
            TEST_TENANT_A,
            "A-1".into(),
            "resale".into(),
            None,
            None,
            None,
        )
        .unwrap();
        create_product_impl(
            &conn,
            TEST_TENANT_A,
            "A-2".into(),
            "resale".into(),
            None,
            None,
            None,
        )
        .unwrap();
        create_product_impl(
            &conn,
            TEST_TENANT_B,
            "B-1".into(),
            "resale".into(),
            None,
            None,
            None,
        )
        .unwrap();

        // When: Listing products by tenant
        let list_a = list_products_impl(&conn, TEST_TENANT_A, None, None, None).unwrap();
        let list_b = list_products_impl(&conn, TEST_TENANT_B, None, None, None).unwrap();

        // Then: Strict isolation
        assert_eq!(list_a.len(), 2);
        assert_eq!(list_b.len(), 1);
        assert!(list_a.iter().all(|p| p.tenant_id == TEST_TENANT_A));
        assert!(list_b.iter().all(|p| p.tenant_id == TEST_TENANT_B));
    }

    #[test]
    fn test_tc_prod_iso_03_cross_tenant_variant_creation_blocked() {
        // Given: Product created in Tenant A
        let conn = setup_test_db();
        let p_a = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "A-專屬".into(),
            "resale".into(),
            None,
            None,
            None,
        )
        .unwrap();

        // When: Tenant B tries to add variant to Tenant A's product
        let err = add_product_variant_impl(
            &conn,
            TEST_TENANT_B,
            &p_a.product.id,
            "惡意變體".into(),
            None,
            None,
        );

        // Then: Operation rejected with not found
        assert_eq!(err.unwrap_err(), "Product not found");
    }

    #[test]
    fn test_tc_prod_iso_04_cross_tenant_vendor_binding_blocked() {
        // Given: Product in Tenant A, Vendor in Tenant B
        let conn = setup_test_db();
        let p_a = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "A-商品".into(),
            "resale".into(),
            None,
            None,
            None,
        )
        .unwrap();
        let v_b = crate::partners::create_partner_impl(
            &conn,
            TEST_TENANT_B,
            "B-供應商".into(),
            None,
            Some(true),
            None,
        )
        .unwrap();

        // When: Tenant A tries to bind Tenant B's vendor
        let err = add_supply_source_impl(
            &conn,
            TEST_TENANT_A,
            &p_a.units[0].id,
            &v_b.id,
            100.0,
            None,
            None,
        );

        // Then: Operation rejected
        assert_eq!(err.unwrap_err(), "供應商不存在或無效");

        // When: Tenant A tries to bind to Tenant B's unit
        let p_b = create_product_impl(
            &conn,
            TEST_TENANT_B,
            "B-商品".into(),
            "resale".into(),
            None,
            None,
            None,
        )
        .unwrap();
        let v_a = crate::partners::create_partner_impl(
            &conn,
            TEST_TENANT_A,
            "A-供應商".into(),
            None,
            Some(true),
            None,
        )
        .unwrap();
        let err_unit = add_supply_source_impl(
            &conn,
            TEST_TENANT_A,
            &p_b.units[0].id,
            &v_a.id,
            100.0,
            None,
            None,
        );
        assert_eq!(err_unit.unwrap_err(), "Product unit not found");
    }

    #[test]
    fn test_tc_prod_iso_05_cross_tenant_bom_binding_blocked() {
        // Given: Parent in Tenant A, Child in Tenant B
        let conn = setup_test_db();
        let parent_a = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "A-母成品".into(),
            "manufactured".into(),
            None,
            None,
            None,
        )
        .unwrap();
        let child_b = create_product_impl(
            &conn,
            TEST_TENANT_B,
            "B-子原料".into(),
            "raw_material".into(),
            None,
            None,
            None,
        )
        .unwrap();

        // When: Tenant A tries to bind Tenant B's variant into BOM
        let err = add_bom_item_impl(
            &conn,
            TEST_TENANT_A,
            &parent_a.variants[0].id,
            &child_b.variants[0].id,
            1.0,
        );

        // Then: Operation rejected
        assert_eq!(err.unwrap_err(), "子物料變體不存在或不屬於同一租戶");
    }

    #[test]
    fn test_tc_prod_res_01_unit_and_supply_fallback_from_prod_id() {
        // Given: Product created in test db
        let conn = setup_test_db();
        let p = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "防禦測試品".into(),
            "resale".into(),
            None,
            None,
            None,
        )
        .unwrap();
        let vendor = crate::partners::create_partner_impl(
            &conn,
            TEST_TENANT_A,
            "防禦廠商".into(),
            None,
            Some(true),
            Some("12345678".into()),
        )
        .unwrap();

        // When: Adding unit and supply source with product.id instead of variant/unit id
        let unit = add_product_unit_impl(
            &conn,
            TEST_TENANT_A,
            &p.product.id,
            "盒".into(),
            12.0,
            Some(false),
            120.0,
        )
        .unwrap();
        // Calling add_supply_source_impl with product.id -> fallback to default variant's base unit
        let src_from_prod = add_supply_source_impl(
            &conn,
            TEST_TENANT_A,
            &p.product.id,
            &vendor.id,
            65.0,
            None,
            Some(true),
        )
        .unwrap();
        // Calling add_supply_source_impl with variant.id -> fallback to that variant's base unit
        let src_from_var = add_supply_source_impl(
            &conn,
            TEST_TENANT_A,
            &p.variants[0].id,
            &vendor.id,
            70.0,
            None,
            Some(false),
        )
        .unwrap();

        // Then: Correctly resolved to default variant and base unit
        assert_eq!(unit.variant_id, p.variants[0].id);
        assert_eq!(src_from_prod.unit_id, p.units[0].id);
        assert_eq!(src_from_var.unit_id, p.units[0].id);
    }

    #[test]
    fn test_tc_prod_res_02_bom_fallback_from_prod_id() {
        // Given: Manufactured parent and raw material child
        let conn = setup_test_db();
        let parent = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "防禦成品".into(),
            "manufactured".into(),
            None,
            None,
            None,
        )
        .unwrap();
        let child = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "防禦零件".into(),
            "raw_material".into(),
            None,
            None,
            None,
        )
        .unwrap();

        // When: Adding BOM using product.id and synthetic ID
        let bom1 = add_bom_item_impl(
            &conn,
            TEST_TENANT_A,
            &parent.product.id,
            &child.product.id,
            3.0,
        )
        .unwrap();
        let synthetic_child_id = format!("var_{}_std", child.product.id);
        let bom2 = add_bom_item_impl(
            &conn,
            TEST_TENANT_A,
            &parent.variants[0].id,
            &synthetic_child_id,
            1.5,
        )
        .unwrap();

        // Then: Both resolve to actual variants
        assert_eq!(bom1.parent_variant_id, parent.variants[0].id);
        assert_eq!(bom1.child_variant_id, child.variants[0].id);
        assert_eq!(bom2.child_variant_id, child.variants[0].id);
    }

    #[test]
    fn test_tc_prod_pos_05b_update_variant_success() {
        // Given: An existing product with a default variant and an added variant
        let conn = setup_test_db();
        let p = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "多規格服飾".into(),
            "resale".into(),
            None,
            None,
            None,
        )
        .unwrap();

        let v = add_product_variant_impl(
            &conn,
            TEST_TENANT_A,
            &p.product.id,
            "紅色 / M".into(),
            Some("CLOTH-RED-M".into()),
            Some(serde_json::json!({"顏色": "紅色", "尺寸": "M"})),
        )
        .unwrap();

        // When: Updating variant name, sku, and spec_attributes
        let updated = update_product_variant_impl(
            &conn,
            TEST_TENANT_A,
            &v.id,
            Some("紅色 / M 極致版".into()),
            Some("CLOTH-RED-M-V2".into()),
            Some(serde_json::json!({"顏色": "紅色", "尺寸": "M", "材質": "純棉"})),
        )
        .unwrap();

        // Then: Variant is updated correctly
        assert_eq!(updated.id, v.id);
        assert_eq!(updated.name, "紅色 / M 極致版");
        assert_eq!(updated.sku, Some("CLOTH-RED-M-V2".into()));
        assert_eq!(updated.spec_attributes["材質"], "純棉");
        assert_eq!(updated.spec_attributes["顏色"], "紅色");
    }

    #[test]
    fn test_tc_prod_pos_05c_add_variant_auto_derived_name() {
        // Given: Product exists
        let conn = setup_test_db();
        let p = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "運動鞋".into(),
            "resale".into(),
            None,
            None,
            None,
        )
        .unwrap();

        // When: Adding variant with empty name but valid spec_attributes
        let v = add_product_variant_impl(
            &conn,
            TEST_TENANT_A,
            &p.product.id,
            "".into(),
            Some("SHOE-BLK-42".into()),
            Some(serde_json::json!({"顏色": "黑色", "尺碼": "42"})),
        )
        .unwrap();

        // Then: Name is auto-derived from attributes
        assert!(!v.name.is_empty());
        assert!(v.name.contains("黑色"));
        assert!(v.name.contains("42"));
    }

    #[test]
    fn test_tc_prod_neg_11_variant_invalid_spec_attributes_format() {
        // Given: Product exists
        let conn = setup_test_db();
        let p = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "格式測試商品".into(),
            "resale".into(),
            None,
            None,
            None,
        )
        .unwrap();

        // When: Passing array as spec_attributes
        let err = add_product_variant_impl(
            &conn,
            TEST_TENANT_A,
            &p.product.id,
            "測試變體".into(),
            None,
            Some(serde_json::json!(["無效陣列"])),
        );

        // Then: Validation error is returned
        assert_eq!(err.unwrap_err(), "規格屬性必須為 JSON 物件格式");
    }

    #[test]
    fn test_tc_prod_neg_12_update_variant_duplicate_name() {
        // Given: Product with two variants
        let conn = setup_test_db();
        let p = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "手機".into(),
            "resale".into(),
            None,
            None,
            None,
        )
        .unwrap();
        let _v1 = add_product_variant_impl(
            &conn,
            TEST_TENANT_A,
            &p.product.id,
            "黑色 128G".into(),
            None,
            None,
        )
        .unwrap();
        let v2 = add_product_variant_impl(
            &conn,
            TEST_TENANT_A,
            &p.product.id,
            "白色 128G".into(),
            None,
            None,
        )
        .unwrap();

        // When: Trying to rename v2 to v1's name (case-insensitive and trimmed)
        let err = update_product_variant_impl(
            &conn,
            TEST_TENANT_A,
            &v2.id,
            Some("  黑色 128G  ".into()),
            None,
            None,
        );

        // Then: Duplicate name error
        assert_eq!(err.unwrap_err(), "變體名稱「黑色 128G」已存在");
    }

    #[test]
    fn test_tc_prod_neg_13_update_variant_empty_name() {
        // Given: Product with a variant
        let conn = setup_test_db();
        let p = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "耳機".into(),
            "resale".into(),
            None,
            None,
            None,
        )
        .unwrap();
        let v = add_product_variant_impl(
            &conn,
            TEST_TENANT_A,
            &p.product.id,
            "無線版".into(),
            None,
            None,
        )
        .unwrap();

        // When: Updating name to whitespace
        let err = update_product_variant_impl(
            &conn,
            TEST_TENANT_A,
            &v.id,
            Some("   ".into()),
            None,
            None,
        );

        // Then: Empty name error
        assert_eq!(err.unwrap_err(), "變體名稱不能為空");
    }

    #[test]
    fn test_tc_prod_iso_03b_cross_tenant_variant_update_blocked() {
        // Given: Variant belongs to Tenant A
        let conn = setup_test_db();
        let p_a = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "A-專屬-2".into(),
            "resale".into(),
            None,
            None,
            None,
        )
        .unwrap();
        let v_a = add_product_variant_impl(
            &conn,
            TEST_TENANT_A,
            &p_a.product.id,
            "A規格".into(),
            None,
            None,
        )
        .unwrap();

        // When: Tenant B tries to update Tenant A's variant
        let err = update_product_variant_impl(
            &conn,
            TEST_TENANT_B,
            &v_a.id,
            Some("竄改規格".into()),
            None,
            None,
        );

        // Then: Operation rejected with not found
        assert_eq!(err.unwrap_err(), "Variant not found");
    }

    #[test]
    fn test_tc_unit_pos_01_auto_generate_base_unit_on_variant_creation() {
        // Given: Product created with default variant and base unit "顆"
        let conn = setup_test_db();
        let p = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "多包裝處理器".into(),
            "resale".into(),
            None,
            Some("顆".into()),
            Some(200.0),
        )
        .unwrap();

        // When: Adding a new variant "512GB"
        let v = add_product_variant_impl(
            &conn,
            TEST_TENANT_A,
            &p.product.id,
            "512GB".into(),
            Some("CPU-512G".into()),
            Some(serde_json::json!({"容量": "512GB"})),
        )
        .unwrap();

        // Then: Product detail shows new variant has its own base unit (is_base_unit = true, ratio = 1.0)
        let detail = get_product_detail_impl(&conn, TEST_TENANT_A, &p.product.id).unwrap();
        assert_eq!(detail.variants.len(), 2);
        let v_units: Vec<_> = detail
            .units
            .into_iter()
            .filter(|u| u.variant_id == v.id)
            .collect();
        assert_eq!(v_units.len(), 1);
        assert_eq!(v_units[0].unit_name, "顆");
        assert_eq!(v_units[0].conversion_ratio, 1.0);
        assert!(v_units[0].is_base_unit);
        assert_eq!(v_units[0].selling_price, 200.0);

        // When: Updating secondary variant's unit price to 999.0 and adding a 3rd variant
        let _ = update_product_unit_impl(
            &conn,
            TEST_TENANT_A,
            &v_units[0].id,
            None,
            None,
            None,
            Some(999.0),
        )
        .unwrap();

        let v3 = add_product_variant_impl(
            &conn,
            TEST_TENANT_A,
            &p.product.id,
            "1TB".into(),
            Some("CPU-1TB".into()),
            Some(serde_json::json!({"容量": "1TB"})),
        )
        .unwrap();

        // Then: 3rd variant still inherits base unit price from default variant (200.0) via ORDER BY v.is_default DESC
        let detail3 = get_product_detail_impl(&conn, TEST_TENANT_A, &p.product.id).unwrap();
        let v3_units: Vec<_> = detail3
            .units
            .into_iter()
            .filter(|u| u.variant_id == v3.id)
            .collect();
        assert_eq!(v3_units.len(), 1);
        assert_eq!(v3_units[0].selling_price, 200.0);
    }

    #[test]
    fn test_tc_unit_pos_02_update_product_unit_success() {
        // Given: Product with base unit
        let conn = setup_test_db();
        let p = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "包裝測試品".into(),
            "resale".into(),
            None,
            Some("個".into()),
            Some(10.0),
        )
        .unwrap();
        let var_id = &p.variants[0].id;
        let unit = add_product_unit_impl(
            &conn,
            TEST_TENANT_A,
            var_id,
            "盒".into(),
            10.0,
            Some(false),
            90.0,
        )
        .unwrap();

        // When: Updating packaging unit to "大盒", ratio 12, price 100
        let updated = update_product_unit_impl(
            &conn,
            TEST_TENANT_A,
            &unit.id,
            Some("大盒".into()),
            Some(12.0),
            Some(false),
            Some(100.0),
        )
        .unwrap();

        // Then: Values updated correctly
        assert_eq!(updated.unit_name, "大盒");
        assert_eq!(updated.conversion_ratio, 12.0);
        assert_eq!(updated.selling_price, 100.0);
        assert!(!updated.is_base_unit);
    }

    #[test]
    fn test_tc_unit_pos_03_switch_base_unit_success() {
        // Given: Variant with base unit "個" and secondary unit "盒"
        let conn = setup_test_db();
        let p = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "基準切換品".into(),
            "resale".into(),
            None,
            Some("個".into()),
            Some(5.0),
        )
        .unwrap();
        let var_id = &p.variants[0].id;
        let original_base_id = &p.units[0].id;
        let box_unit = add_product_unit_impl(
            &conn,
            TEST_TENANT_A,
            var_id,
            "盒".into(),
            10.0,
            Some(false),
            45.0,
        )
        .unwrap();

        // When: Setting "盒" to base unit
        let updated_box = update_product_unit_impl(
            &conn,
            TEST_TENANT_A,
            &box_unit.id,
            None,
            None,
            Some(true),
            None,
        )
        .unwrap();

        // Then: "盒" becomes base unit (ratio locked to 1.0), and original "個" is no longer base unit
        assert!(updated_box.is_base_unit);
        assert_eq!(updated_box.conversion_ratio, 1.0);

        let detail = get_product_detail_impl(&conn, TEST_TENANT_A, &p.product.id).unwrap();
        let old_base = detail
            .units
            .iter()
            .find(|u| u.id == *original_base_id)
            .unwrap();
        assert!(!old_base.is_base_unit);
    }

    #[test]
    fn test_tc_unit_neg_01_update_unit_empty_name_error() {
        // Given: Product with base unit
        let conn = setup_test_db();
        let p = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "空名測試品".into(),
            "resale".into(),
            None,
            Some("件".into()),
            Some(50.0),
        )
        .unwrap();
        let unit_id = &p.units[0].id;

        // When: Updating unit name to whitespace
        let err = update_product_unit_impl(
            &conn,
            TEST_TENANT_A,
            unit_id,
            Some("   ".into()),
            None,
            None,
            None,
        );

        // Then: Empty name error
        assert_eq!(err.unwrap_err(), "單位名稱不能為空");
    }

    #[test]
    fn test_tc_unit_neg_02_update_unit_duplicate_name_error() {
        // Given: Variant with units "件" and "箱"
        let conn = setup_test_db();
        let p = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "同名測試品".into(),
            "resale".into(),
            None,
            Some("件".into()),
            Some(50.0),
        )
        .unwrap();
        let var_id = &p.variants[0].id;
        let box_unit = add_product_unit_impl(
            &conn,
            TEST_TENANT_A,
            var_id,
            "箱".into(),
            20.0,
            Some(false),
            950.0,
        )
        .unwrap();

        // When: Renaming "箱" to "件"
        let err = update_product_unit_impl(
            &conn,
            TEST_TENANT_A,
            &box_unit.id,
            Some("  件  ".into()),
            None,
            None,
            None,
        );

        // Then: Duplicate name error
        assert_eq!(err.unwrap_err(), "單位「件」已存在");
    }

    #[test]
    fn test_tc_unit_neg_03_update_unit_invalid_ratio_error() {
        // Given: Secondary unit
        let conn = setup_test_db();
        let p = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "比率測試品".into(),
            "resale".into(),
            None,
            Some("個".into()),
            Some(10.0),
        )
        .unwrap();
        let var_id = &p.variants[0].id;
        let unit = add_product_unit_impl(
            &conn,
            TEST_TENANT_A,
            var_id,
            "盒".into(),
            10.0,
            Some(false),
            90.0,
        )
        .unwrap();

        // When: Setting ratio to 0 or negative
        let err_zero =
            update_product_unit_impl(&conn, TEST_TENANT_A, &unit.id, None, Some(0.0), None, None);
        let err_neg =
            update_product_unit_impl(&conn, TEST_TENANT_A, &unit.id, None, Some(-5.0), None, None);

        // Then: Invalid ratio errors
        assert_eq!(err_zero.unwrap_err(), "換算比例必須大於 0");
        assert_eq!(err_neg.unwrap_err(), "換算比例必須大於 0");
    }

    #[test]
    fn test_tc_unit_neg_04_update_unit_negative_price_error() {
        // Given: Unit exists
        let conn = setup_test_db();
        let p = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "負價測試品".into(),
            "resale".into(),
            None,
            Some("個".into()),
            Some(10.0),
        )
        .unwrap();
        let unit_id = &p.units[0].id;

        // When: Setting price to negative
        let err =
            update_product_unit_impl(&conn, TEST_TENANT_A, unit_id, None, None, None, Some(-1.0));

        // Then: Negative price error
        assert_eq!(err.unwrap_err(), "售價不能為負數");
    }

    #[test]
    fn test_tc_unit_neg_05_demote_only_base_unit_error() {
        // Given: Variant with only 1 base unit
        let conn = setup_test_db();
        let p = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "唯基測試品".into(),
            "resale".into(),
            None,
            Some("個".into()),
            Some(10.0),
        )
        .unwrap();
        let unit_id = &p.units[0].id;

        // When: Trying to unset is_base_unit without another base unit existing
        let err =
            update_product_unit_impl(&conn, TEST_TENANT_A, unit_id, None, None, Some(false), None);

        // Then: Demotion rejected
        assert_eq!(err.unwrap_err(), "每個變體至少要有一個基準單位");
    }

    #[test]
    fn test_tc_unit_iso_01_cross_tenant_unit_update_blocked() {
        // Given: Tenant A owns product unit
        let conn = setup_test_db();
        let p_a = create_product_impl(
            &conn,
            TEST_TENANT_A,
            "A專屬單位品".into(),
            "resale".into(),
            None,
            Some("個".into()),
            Some(10.0),
        )
        .unwrap();
        let unit_id_a = &p_a.units[0].id;

        // When: Tenant B tries to update Tenant A's unit
        let err = update_product_unit_impl(
            &conn,
            TEST_TENANT_B,
            unit_id_a,
            Some("惡意改名".into()),
            None,
            None,
            None,
        );

        // Then: Unit not found error
        assert_eq!(err.unwrap_err(), "Product unit not found");
    }
}
