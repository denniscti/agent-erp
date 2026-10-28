use crate::get_db_path;
use rusqlite::params;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static PO_ID_COUNTER: AtomicU64 = AtomicU64::new(1000);

fn current_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq)]
pub struct PurchaseOrder {
    pub id: String,
    pub tenant_id: String,
    pub po_number: String,
    pub vendor_partner_id: String,
    pub vendor_name_snapshot: String,
    pub currency: String,
    pub status: String, // "draft" | "ordered" | "received" | "cancelled"
    pub expected_date: Option<i64>,
    pub note: Option<String>,
    pub created_by: String,
    pub created_at: i64,
    pub ordered_at: Option<i64>,
    pub received_at: Option<i64>,
    pub cancelled_at: Option<i64>,
    pub task_id: Option<String>,
    pub total_amount: f64,
    pub warehouse_id: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq)]
pub struct PurchaseOrderLine {
    pub id: String,
    pub purchase_order_id: String,
    pub line_no: i64,
    pub unit_id: String,
    pub supply_source_id: Option<String>,
    pub product_name_snapshot: String,
    pub variant_name_snapshot: String,
    pub sku_snapshot: Option<String>,
    pub unit_name_snapshot: String,
    pub quantity: f64,
    pub received_quantity: Option<f64>,
    pub purchase_cost: f64,
    pub created_at: i64,
    pub subtotal: f64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq)]
pub struct PurchaseOrderDetail {
    pub order: PurchaseOrder,
    pub lines: Vec<PurchaseOrderLine>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq)]
pub struct InventoryMovement {
    pub id: String,
    pub tenant_id: String,
    pub unit_id: String,
    pub quantity_delta: f64,
    pub unit_cost: Option<f64>,
    pub reason: String,         // "purchase_receipt" | "opening_balance"
    pub reference_type: String, // "purchase_order" | "opening_balance"
    pub reference_id: Option<String>,
    pub created_by: String,
    pub created_at: i64,
    pub warehouse_id: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq)]
pub struct InventoryLevel {
    pub unit_id: String,
    pub current_quantity: f64,
    pub product_name: Option<String>,
    pub variant_name: Option<String>,
    pub sku: Option<String>,
    pub unit_name: Option<String>,
    pub warehouse_id: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq)]
pub struct CreatePurchaseOrderLineInput {
    pub unit_id: String,
    pub quantity: f64,
    pub purchase_cost: Option<f64>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq)]
pub struct ReceivedLineInput {
    pub line_id: String,
    pub received_quantity: f64,
}

pub fn create_purchase_orders_tables(conn: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS purchase_orders (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            po_number TEXT NOT NULL,
            vendor_partner_id TEXT NOT NULL,
            vendor_name_snapshot TEXT NOT NULL,
            currency TEXT NOT NULL DEFAULT 'TWD',
            status TEXT NOT NULL,
            expected_date INTEGER,
            note TEXT,
            created_by TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            ordered_at INTEGER,
            received_at INTEGER,
            cancelled_at INTEGER,
            task_id TEXT,
            warehouse_id TEXT
        )",
        [],
    )?;

    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_po_tenant_number ON purchase_orders (tenant_id, po_number)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_po_tenant ON purchase_orders (tenant_id)",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS purchase_order_lines (
            id TEXT PRIMARY KEY,
            purchase_order_id TEXT NOT NULL,
            line_no INTEGER NOT NULL,
            unit_id TEXT NOT NULL,
            supply_source_id TEXT,
            product_name_snapshot TEXT NOT NULL,
            variant_name_snapshot TEXT NOT NULL,
            sku_snapshot TEXT,
            unit_name_snapshot TEXT NOT NULL,
            quantity REAL NOT NULL,
            received_quantity REAL,
            purchase_cost REAL NOT NULL,
            created_at INTEGER NOT NULL
        )",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_pol_order ON purchase_order_lines (purchase_order_id)",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS inventory_movements (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            unit_id TEXT NOT NULL,
            quantity_delta REAL NOT NULL,
            unit_cost REAL,
            reason TEXT NOT NULL,
            reference_type TEXT NOT NULL,
            reference_id TEXT,
            created_by TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            warehouse_id TEXT
        )",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_im_tenant_unit ON inventory_movements (tenant_id, unit_id)",
        [],
    )?;

    // Idempotent migrations for existing tables (shared helper)
    crate::warehouses::ensure_warehouse_columns_and_indices(conn)?;

    Ok(())
}

/// Helper: Resolve active user ID from token store matching sessions.user_id.
/// Strictly does NOT fallback to other sessions if no valid session is found.
pub fn resolve_active_user_id_from_store<T: crate::auth::TokenStore>(
    conn: &rusqlite::Connection,
    token_store: &T,
) -> Result<String, String> {
    if let Ok(Some(pair)) = token_store.load() {
        let mut stmt = conn
            .prepare("SELECT user_id FROM sessions WHERE token = ?1")
            .map_err(|e| e.to_string())?;
        if let Ok(user_id) = stmt.query_row([&pair.access_token], |row| row.get::<_, String>(0)) {
            let trimmed = user_id.trim().to_string();
            if !trimmed.is_empty() {
                return Ok(trimmed);
            }
        }
    }
    Err("無法解析有效使用者 session，操作被拒絕".to_string())
}

pub fn resolve_active_user_id(conn: &rusqlite::Connection) -> Result<String, String> {
    let token_store = crate::auth::KeyringTokenStore::new();
    resolve_active_user_id_from_store(conn, &token_store)
}

struct UnitSnapshot {
    unit_name: String,
    variant_name: String,
    sku: Option<String>,
    product_name: String,
    is_purchasable: bool,
}

fn resolve_unit_snapshot(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    unit_id: &str,
) -> Result<UnitSnapshot, String> {
    let mut stmt = conn
        .prepare(
            "SELECT 
                u.id, u.unit_name,
                v.name, v.sku,
                p.name, p.is_purchasable
             FROM product_units u
             JOIN product_variants v ON u.variant_id = v.id
             JOIN products p ON v.product_id = p.id
             WHERE u.id = ?1 AND p.tenant_id = ?2",
        )
        .map_err(|e| e.to_string())?;

    let res = stmt.query_row(params![unit_id, tenant_id], |row| {
        Ok(UnitSnapshot {
            unit_name: row.get(1)?,
            variant_name: row.get(2)?,
            sku: row.get(3)?,
            product_name: row.get(4)?,
            is_purchasable: row.get::<_, i64>(5)? == 1,
        })
    });

    match res {
        Ok(snapshot) => Ok(snapshot),
        Err(_) => Err("找不到指定的商品單位 (unit_id) 或不屬於目前租戶".to_string()),
    }
}

fn resolve_vendor_snapshot(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    vendor_partner_id: &str,
) -> Result<String, String> {
    let mut stmt = conn
        .prepare("SELECT name, is_vendor FROM partners WHERE id = ?1 AND tenant_id = ?2")
        .map_err(|e| e.to_string())?;

    let vendor_res = stmt.query_row(params![vendor_partner_id, tenant_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    });

    match vendor_res {
        Ok((name, is_vendor)) => {
            if is_vendor != 1 {
                return Err("指定的合作夥伴不是供應商 (is_vendor != 1)".to_string());
            }
            Ok(name)
        }
        Err(_) => Err("找不到指定的供應商或不屬於目前租戶".to_string()),
    }
}

fn next_po_number(tx: &rusqlite::Transaction, tenant_id: &str) -> Result<String, String> {
    let mut stmt = tx
        .prepare(
            "SELECT COALESCE(MAX(CAST(SUBSTR(po_number, 4) AS INTEGER)), 0) + 1 
             FROM purchase_orders WHERE tenant_id = ?1",
        )
        .map_err(|e| e.to_string())?;
    let next_seq: i64 = stmt
        .query_row(params![tenant_id], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    Ok(format!("PO-{:05}", next_seq))
}

fn row_to_order(row: &rusqlite::Row) -> Result<PurchaseOrder, rusqlite::Error> {
    Ok(PurchaseOrder {
        id: row.get(0)?,
        tenant_id: row.get(1)?,
        po_number: row.get(2)?,
        vendor_partner_id: row.get(3)?,
        vendor_name_snapshot: row.get(4)?,
        currency: row.get(5)?,
        status: row.get(6)?,
        expected_date: row.get(7)?,
        note: row.get(8)?,
        created_by: row.get(9)?,
        created_at: row.get(10)?,
        ordered_at: row.get(11)?,
        received_at: row.get(12)?,
        cancelled_at: row.get(13)?,
        task_id: row.get(14)?,
        total_amount: 0.0,
        warehouse_id: row.get::<_, Option<String>>(15)?.unwrap_or_default(),
    })
}

fn row_to_line(row: &rusqlite::Row) -> Result<PurchaseOrderLine, rusqlite::Error> {
    let quantity: f64 = row.get(9)?;
    let purchase_cost: f64 = row.get(11)?;
    Ok(PurchaseOrderLine {
        id: row.get(0)?,
        purchase_order_id: row.get(1)?,
        line_no: row.get(2)?,
        unit_id: row.get(3)?,
        supply_source_id: row.get(4)?,
        product_name_snapshot: row.get(5)?,
        variant_name_snapshot: row.get(6)?,
        sku_snapshot: row.get(7)?,
        unit_name_snapshot: row.get(8)?,
        quantity,
        received_quantity: row.get(10)?,
        purchase_cost,
        created_at: row.get(12)?,
        subtotal: quantity * purchase_cost,
    })
}

// ==========================================
// Usecase Implementations
// ==========================================

#[allow(clippy::too_many_arguments)]
pub fn create_purchase_order_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    user_id: &str,
    vendor_partner_id: &str,
    currency: Option<String>,
    expected_date: Option<i64>,
    note: Option<String>,
    task_id: Option<String>,
    initial_lines: Option<Vec<CreatePurchaseOrderLineInput>>,
    warehouse_id: Option<String>,
) -> Result<PurchaseOrderDetail, String> {
    if tenant_id.trim().is_empty() {
        return Err("Tenant ID cannot be empty".to_string());
    }
    let trimmed_uid = user_id.trim();
    if trimmed_uid.is_empty() {
        return Err("無法解析有效使用者 session，操作被拒絕".to_string());
    }

    let currency_str = currency.unwrap_or_else(|| "TWD".to_string());
    if currency_str.trim().to_uppercase() != "TWD" {
        return Err("幣別僅支援 'TWD'".to_string());
    }

    // P-01 & W-00 & W-04: Resolve warehouse
    let target_wh_id = match warehouse_id {
        Some(ref wid) if !wid.trim().is_empty() => {
            crate::warehouses::validate_warehouse_active(conn, tenant_id, wid)?.id
        }
        _ => crate::warehouses::resolve_default_warehouse(conn, tenant_id)?.id,
    };

    let vendor_snapshot = resolve_vendor_snapshot(conn, tenant_id, vendor_partner_id)?;

    let now = current_timestamp();
    let po_id = format!(
        "po_{}_{}",
        now,
        PO_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    );

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let po_num = next_po_number(&tx, tenant_id)?;

    tx.execute(
        "INSERT INTO purchase_orders (
            id, tenant_id, po_number, vendor_partner_id, vendor_name_snapshot,
            currency, status, expected_date, note, created_by, created_at,
            ordered_at, received_at, cancelled_at, task_id, warehouse_id
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'draft', ?7, ?8, ?9, ?10, NULL, NULL, NULL, ?11, ?12)",
        params![
            po_id,
            tenant_id,
            po_num,
            vendor_partner_id,
            vendor_snapshot,
            currency_str,
            expected_date,
            note,
            trimmed_uid,
            now,
            task_id,
            target_wh_id
        ],
    )
    .map_err(|e| e.to_string())?;

    let mut lines = Vec::new();
    if let Some(items) = initial_lines {
        let mut seen_units = std::collections::HashSet::new();
        for (idx, item) in items.into_iter().enumerate() {
            let unit_id = item.unit_id.trim();
            if !seen_units.insert(unit_id.to_string()) {
                return Err("同一採購單內商品單位不可重複，若需調整數量請修改既有明細".to_string());
            }

            let unit_snapshot = resolve_unit_snapshot(&tx, tenant_id, unit_id)?;
            if !unit_snapshot.is_purchasable {
                return Err(format!(
                    "商品「{}」設定為不可採購 (is_purchasable = 0)",
                    unit_snapshot.product_name
                ));
            }

            if item.quantity <= 0.0 {
                return Err("採購數量必須大於 0".to_string());
            }

            let mut final_cost = item.purchase_cost;
            let mut supply_source_id = None;

            let mut src_stmt = tx
                .prepare(
                    "SELECT id, purchase_cost, currency FROM product_supply_sources
                 WHERE unit_id = ?1 AND vendor_partner_id = ?2
                 ORDER BY is_primary DESC, created_at DESC LIMIT 1",
                )
                .map_err(|e| e.to_string())?;

            let src_opt = src_stmt
                .query_row(params![unit_id, vendor_partner_id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, f64>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                })
                .ok();

            if let Some((sid, scost, scurr)) = src_opt {
                if scurr.trim().to_uppercase() == "TWD" {
                    supply_source_id = Some(sid);
                    if final_cost.is_none() {
                        final_cost = Some(scost);
                    }
                }
            }

            let cost = match final_cost {
                Some(c) => {
                    if c < 0.0 {
                        return Err("採購單價不可為負數".to_string());
                    }
                    c
                }
                None => {
                    return Err("查無此供應商的預設供應來源成本，請手動指定單價".to_string());
                }
            };

            let pol_id = format!(
                "pol_{}_{}",
                now,
                PO_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
            );
            let line_no = (idx + 1) as i64;

            tx.execute(
                "INSERT INTO purchase_order_lines (
                    id, purchase_order_id, line_no, unit_id, supply_source_id,
                    product_name_snapshot, variant_name_snapshot, sku_snapshot,
                    unit_name_snapshot, quantity, received_quantity, purchase_cost, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11, ?12)",
                params![
                    pol_id,
                    po_id,
                    line_no,
                    unit_id,
                    supply_source_id,
                    unit_snapshot.product_name,
                    unit_snapshot.variant_name,
                    unit_snapshot.sku,
                    unit_snapshot.unit_name,
                    item.quantity,
                    cost,
                    now
                ],
            )
            .map_err(|e| e.to_string())?;

            lines.push(PurchaseOrderLine {
                id: pol_id,
                purchase_order_id: po_id.clone(),
                line_no,
                unit_id: unit_id.to_string(),
                supply_source_id,
                product_name_snapshot: unit_snapshot.product_name,
                variant_name_snapshot: unit_snapshot.variant_name,
                sku_snapshot: unit_snapshot.sku,
                unit_name_snapshot: unit_snapshot.unit_name,
                quantity: item.quantity,
                received_quantity: None,
                purchase_cost: cost,
                created_at: now,
                subtotal: item.quantity * cost,
            });
        }
    }

    tx.commit().map_err(|e| e.to_string())?;

    let total_amount = lines.iter().map(|l| l.subtotal).sum::<f64>();
    let order = PurchaseOrder {
        id: po_id,
        tenant_id: tenant_id.to_string(),
        po_number: po_num,
        vendor_partner_id: vendor_partner_id.to_string(),
        vendor_name_snapshot: vendor_snapshot,
        currency: currency_str,
        status: "draft".to_string(),
        expected_date,
        note,
        created_by: trimmed_uid.to_string(),
        created_at: now,
        ordered_at: None,
        received_at: None,
        cancelled_at: None,
        task_id,
        total_amount,
        warehouse_id: target_wh_id,
    };

    Ok(PurchaseOrderDetail { order, lines })
}

pub fn update_purchase_order_header_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    order_id: &str,
    vendor_partner_id: Option<String>,
    expected_date: Option<Option<i64>>,
    note: Option<Option<String>>,
    warehouse_id: Option<String>,
) -> Result<PurchaseOrderDetail, String> {
    if tenant_id.trim().is_empty() {
        return Err("Tenant ID cannot be empty".to_string());
    }

    let (status, current_vendor): (String, String) = {
        let mut stmt = conn
            .prepare("SELECT status, vendor_partner_id FROM purchase_orders WHERE id = ?1 AND tenant_id = ?2")
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![order_id, tenant_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map_err(|_| "找不到採購單或不屬於目前租戶".to_string())?
    };

    if status == "received" || status == "cancelled" {
        return Err(format!("採購單狀態為 {}，不允許修改表頭", status));
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    if let Some(ref new_vendor) = vendor_partner_id {
        if new_vendor.trim() != current_vendor {
            if status != "draft" {
                return Err("僅有草稿 (draft) 狀態的採購單可修改供應商".to_string());
            }
            let line_count: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM purchase_order_lines WHERE purchase_order_id = ?1",
                    params![order_id],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            if line_count > 0 {
                return Err("採購單已有明細，不可修改供應商".to_string());
            }
            let vendor_snapshot = resolve_vendor_snapshot(&tx, tenant_id, new_vendor)?;
            tx.execute(
                "UPDATE purchase_orders SET vendor_partner_id = ?1, vendor_name_snapshot = ?2 WHERE id = ?3",
                params![new_vendor, vendor_snapshot, order_id],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    if let Some(exp_dt) = expected_date {
        tx.execute(
            "UPDATE purchase_orders SET expected_date = ?1 WHERE id = ?2",
            params![exp_dt, order_id],
        )
        .map_err(|e| e.to_string())?;
    }

    if let Some(n) = note {
        tx.execute(
            "UPDATE purchase_orders SET note = ?1 WHERE id = ?2",
            params![n, order_id],
        )
        .map_err(|e| e.to_string())?;
    }

    // P-02: warehouse_id only allowed in draft or ordered, must pass W-04
    if let Some(ref new_wh) = warehouse_id {
        let trimmed_wh = new_wh.trim();
        if !trimmed_wh.is_empty() {
            crate::warehouses::validate_warehouse_active(&tx, tenant_id, trimmed_wh)?;
            tx.execute(
                "UPDATE purchase_orders SET warehouse_id = ?1 WHERE id = ?2",
                params![trimmed_wh, order_id],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;

    get_purchase_order_impl(conn, tenant_id, order_id)
}

pub fn add_purchase_order_line_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    order_id: &str,
    unit_id: &str,
    quantity: f64,
    purchase_cost: Option<f64>,
) -> Result<PurchaseOrderDetail, String> {
    if tenant_id.trim().is_empty() {
        return Err("Tenant ID cannot be empty".to_string());
    }

    let mut stmt = conn
        .prepare("SELECT status, vendor_partner_id, currency FROM purchase_orders WHERE id = ?1 AND tenant_id = ?2")
        .map_err(|e| e.to_string())?;
    let (status, vendor_partner_id, po_currency): (String, String, String) = stmt
        .query_row(params![order_id, tenant_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .map_err(|_| "找不到採購單或不屬於目前租戶".to_string())?;

    if status != "draft" {
        return Err(format!("採購單狀態為 {}，僅草稿狀態可新增明細", status));
    }

    let unit_snapshot = resolve_unit_snapshot(conn, tenant_id, unit_id)?;
    if !unit_snapshot.is_purchasable {
        return Err(format!(
            "商品「{}」設定為不可採購 (is_purchasable = 0)",
            unit_snapshot.product_name
        ));
    }

    if quantity <= 0.0 {
        return Err("採購數量必須大於 0".to_string());
    }

    let dup: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM purchase_order_lines WHERE purchase_order_id = ?1 AND unit_id = ?2",
            params![order_id, unit_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if dup > 0 {
        return Err("同一採購單內商品單位不可重複，若需調整數量請修改既有明細".to_string());
    }

    let mut final_cost = purchase_cost;
    let mut supply_source_id = None;

    let mut src_stmt = conn
        .prepare(
            "SELECT id, purchase_cost, currency FROM product_supply_sources
             WHERE unit_id = ?1 AND vendor_partner_id = ?2
             ORDER BY is_primary DESC, created_at DESC LIMIT 1",
        )
        .map_err(|e| e.to_string())?;

    let src_opt = src_stmt
        .query_row(params![unit_id, vendor_partner_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, f64>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .ok();

    if let Some((sid, scost, scurr)) = src_opt {
        if scurr.trim().to_uppercase() == po_currency.trim().to_uppercase() {
            supply_source_id = Some(sid);
            if final_cost.is_none() {
                final_cost = Some(scost);
            }
        }
    }

    let cost = match final_cost {
        Some(c) => {
            if c < 0.0 {
                return Err("採購單價不可為負數".to_string());
            }
            c
        }
        None => {
            return Err("查無此供應商的預設供應來源成本，請手動指定單價".to_string());
        }
    };

    let max_line_no: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(line_no), 0) FROM purchase_order_lines WHERE purchase_order_id = ?1",
            params![order_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let line_no = max_line_no + 1;

    let now = current_timestamp();
    let pol_id = format!(
        "pol_{}_{}",
        now,
        PO_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    );

    conn.execute(
        "INSERT INTO purchase_order_lines (
            id, purchase_order_id, line_no, unit_id, supply_source_id,
            product_name_snapshot, variant_name_snapshot, sku_snapshot,
            unit_name_snapshot, quantity, received_quantity, purchase_cost, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11, ?12)",
        params![
            pol_id,
            order_id,
            line_no,
            unit_id,
            supply_source_id,
            unit_snapshot.product_name,
            unit_snapshot.variant_name,
            unit_snapshot.sku,
            unit_snapshot.unit_name,
            quantity,
            cost,
            now
        ],
    )
    .map_err(|e| e.to_string())?;

    get_purchase_order_impl(conn, tenant_id, order_id)
}

pub fn update_purchase_order_line_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    line_id: &str,
    quantity: Option<f64>,
    purchase_cost: Option<f64>,
) -> Result<PurchaseOrderDetail, String> {
    if tenant_id.trim().is_empty() {
        return Err("Tenant ID cannot be empty".to_string());
    }

    let mut stmt = conn
        .prepare(
            "SELECT pol.purchase_order_id, po.status 
             FROM purchase_order_lines pol
             JOIN purchase_orders po ON pol.purchase_order_id = po.id
             WHERE pol.id = ?1 AND po.tenant_id = ?2",
        )
        .map_err(|e| e.to_string())?;

    let (order_id, status): (String, String) = stmt
        .query_row(params![line_id, tenant_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map_err(|_| "找不到明細項目或不屬於目前租戶".to_string())?;

    if status != "draft" {
        return Err(format!("採購單狀態為 {}，僅草稿狀態可修改明細", status));
    }

    if let Some(qty) = quantity {
        if qty <= 0.0 {
            return Err("採購數量必須大於 0".to_string());
        }
        conn.execute(
            "UPDATE purchase_order_lines SET quantity = ?1 WHERE id = ?2",
            params![qty, line_id],
        )
        .map_err(|e| e.to_string())?;
    }

    if let Some(cost) = purchase_cost {
        if cost < 0.0 {
            return Err("採購單價不可為負數".to_string());
        }
        conn.execute(
            "UPDATE purchase_order_lines SET purchase_cost = ?1 WHERE id = ?2",
            params![cost, line_id],
        )
        .map_err(|e| e.to_string())?;
    }

    get_purchase_order_impl(conn, tenant_id, &order_id)
}

pub fn remove_purchase_order_line_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    line_id: &str,
) -> Result<PurchaseOrderDetail, String> {
    if tenant_id.trim().is_empty() {
        return Err("Tenant ID cannot be empty".to_string());
    }

    let (order_id, status): (String, String) = {
        let mut stmt = conn
            .prepare(
                "SELECT pol.purchase_order_id, po.status 
                 FROM purchase_order_lines pol
                 JOIN purchase_orders po ON pol.purchase_order_id = po.id
                 WHERE pol.id = ?1 AND po.tenant_id = ?2",
            )
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![line_id, tenant_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map_err(|_| "找不到明細項目或不屬於目前租戶".to_string())?
    };

    if status != "draft" {
        return Err(format!("採購單狀態為 {}，僅草稿狀態可刪除明細", status));
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM purchase_order_lines WHERE id = ?1",
        params![line_id],
    )
    .map_err(|e| e.to_string())?;

    // Re-index line_no
    let remaining_ids: Vec<String> = {
        let mut q_stmt = tx
            .prepare("SELECT id FROM purchase_order_lines WHERE purchase_order_id = ?1 ORDER BY line_no ASC, created_at ASC")
            .map_err(|e| e.to_string())?;
        let rows = q_stmt
            .query_map(params![order_id], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        let mut ids = Vec::new();
        for r in rows {
            ids.push(r.map_err(|e| e.to_string())?);
        }
        ids
    };

    for (new_idx, id) in remaining_ids.iter().enumerate() {
        tx.execute(
            "UPDATE purchase_order_lines SET line_no = ?1 WHERE id = ?2",
            params![(new_idx + 1) as i64, id],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;

    get_purchase_order_impl(conn, tenant_id, &order_id)
}

pub fn submit_purchase_order_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    order_id: &str,
) -> Result<PurchaseOrderDetail, String> {
    if tenant_id.trim().is_empty() {
        return Err("Tenant ID cannot be empty".to_string());
    }

    let status: String = {
        let mut stmt = conn
            .prepare("SELECT status FROM purchase_orders WHERE id = ?1 AND tenant_id = ?2")
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![order_id, tenant_id], |row| row.get(0))
            .map_err(|_| "找不到採購單或不屬於目前租戶".to_string())?
    };

    if status != "draft" {
        return Err(format!("無效的狀態轉換：不可從 {} 轉換至 ordered", status));
    }

    let detail = get_purchase_order_impl(conn, tenant_id, order_id)?;
    if detail.lines.is_empty() {
        return Err("採購單至少需有 1 筆明細方可下單".to_string());
    }

    // Re-validate R-03 ~ R-06
    for line in &detail.lines {
        let snap = resolve_unit_snapshot(conn, tenant_id, &line.unit_id)?;
        if !snap.is_purchasable {
            return Err(format!(
                "明細項目「{}」設定為不可採購 (is_purchasable = 0)",
                snap.product_name
            ));
        }
        if line.quantity <= 0.0 {
            return Err("明細項目採購數量必須大於 0".to_string());
        }
        if line.purchase_cost < 0.0 {
            return Err("明細項目採購單價不可為負數".to_string());
        }
    }

    let now = current_timestamp();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // Atomic update with status guard for idempotency
    let affected = tx
        .execute(
            "UPDATE purchase_orders SET status = 'ordered', ordered_at = ?1 
         WHERE id = ?2 AND status = 'draft' AND tenant_id = ?3",
            params![now, order_id, tenant_id],
        )
        .map_err(|e| e.to_string())?;

    if affected == 0 {
        return Err("下單失敗：訂單狀態已變更或已被處理".to_string());
    }

    tx.commit().map_err(|e| e.to_string())?;

    get_purchase_order_impl(conn, tenant_id, order_id)
}

pub fn confirm_purchase_order_received_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    user_id: &str,
    order_id: &str,
    line_received_quantities: Option<HashMap<String, f64>>,
) -> Result<PurchaseOrderDetail, String> {
    if tenant_id.trim().is_empty() {
        return Err("Tenant ID cannot be empty".to_string());
    }
    let trimmed_uid = user_id.trim();
    if trimmed_uid.is_empty() {
        return Err("無法解析有效使用者 session，操作被拒絕".to_string());
    }

    let (status, po_warehouse_id): (String, String) = {
        let mut stmt = conn
            .prepare(
                "SELECT status, warehouse_id FROM purchase_orders WHERE id = ?1 AND tenant_id = ?2",
            )
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![order_id, tenant_id], |row| {
            Ok((
                row.get(0)?,
                row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            ))
        })
        .map_err(|_| "找不到採購單或不屬於目前租戶".to_string())?
    };

    if status != "ordered" {
        return Err(format!("無效的狀態轉換：不可從 {} 轉換至 received", status));
    }

    // P-03: Re-validate warehouse is active upon receipt
    crate::warehouses::validate_warehouse_active(conn, tenant_id, &po_warehouse_id)?;

    let rec_map = line_received_quantities.unwrap_or_default();
    let now = current_timestamp();

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // 1. Idempotency status guard
    let affected = tx
        .execute(
            "UPDATE purchase_orders SET status = 'received', received_at = ?1 
         WHERE id = ?2 AND status = 'ordered' AND tenant_id = ?3",
            params![now, order_id, tenant_id],
        )
        .map_err(|e| e.to_string())?;

    if affected == 0 {
        return Err("確認到貨失敗：訂單狀態已非 ordered 或已被其他處理完成".to_string());
    }

    // 2. Query lines
    let lines_data: Vec<(String, String, f64, f64)> = {
        let mut lines_stmt = tx.prepare(
            "SELECT id, unit_id, quantity, purchase_cost FROM purchase_order_lines WHERE purchase_order_id = ?1"
        ).map_err(|e| e.to_string())?;
        let rows = lines_stmt
            .query_map(params![order_id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })
            .map_err(|e| e.to_string())?;
        let mut list = Vec::new();
        for r in rows {
            list.push(r.map_err(|e| e.to_string())?);
        }
        list
    };

    for (lid, uid, ordered_qty, cost) in lines_data {
        let actual_qty = match rec_map.get(&lid) {
            Some(&q) => {
                if q < 0.0 {
                    return Err("實到數量不可為負數".to_string());
                }
                q
            }
            None => ordered_qty,
        };

        // Update line received_quantity
        tx.execute(
            "UPDATE purchase_order_lines SET received_quantity = ?1 WHERE id = ?2",
            params![actual_qty, lid],
        )
        .map_err(|e| e.to_string())?;

        // Insert inventory movement with warehouse_id
        let im_id = format!(
            "im_{}_{}",
            now,
            PO_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
        );
        tx.execute(
            "INSERT INTO inventory_movements (
                id, tenant_id, unit_id, quantity_delta, unit_cost, reason, reference_type, reference_id, created_by, created_at, warehouse_id
            ) VALUES (?1, ?2, ?3, ?4, ?5, 'purchase_receipt', 'purchase_order', ?6, ?7, ?8, ?9)",
            params![
                im_id,
                tenant_id,
                uid,
                actual_qty,
                cost,
                order_id,
                trimmed_uid,
                now,
                po_warehouse_id
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;

    get_purchase_order_impl(conn, tenant_id, order_id)
}

pub fn cancel_purchase_order_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    order_id: &str,
) -> Result<PurchaseOrderDetail, String> {
    if tenant_id.trim().is_empty() {
        return Err("Tenant ID cannot be empty".to_string());
    }

    let status: String = {
        let mut stmt = conn
            .prepare("SELECT status FROM purchase_orders WHERE id = ?1 AND tenant_id = ?2")
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![order_id, tenant_id], |row| row.get(0))
            .map_err(|_| "找不到採購單或不屬於目前租戶".to_string())?
    };

    if status != "draft" && status != "ordered" {
        return Err(format!(
            "無效的狀態轉換：不可從 {} 轉換至 cancelled",
            status
        ));
    }

    let now = current_timestamp();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let affected = tx
        .execute(
            "UPDATE purchase_orders SET status = 'cancelled', cancelled_at = ?1 
         WHERE id = ?2 AND (status = 'draft' OR status = 'ordered') AND tenant_id = ?3",
            params![now, order_id, tenant_id],
        )
        .map_err(|e| e.to_string())?;

    if affected == 0 {
        return Err("取消採購單失敗：狀態已被修改".to_string());
    }

    tx.commit().map_err(|e| e.to_string())?;

    get_purchase_order_impl(conn, tenant_id, order_id)
}

pub fn get_purchase_order_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    order_id: &str,
) -> Result<PurchaseOrderDetail, String> {
    if tenant_id.trim().is_empty() {
        return Err("Tenant ID cannot be empty".to_string());
    }

    let mut stmt = conn
        .prepare(
            "SELECT 
                id, tenant_id, po_number, vendor_partner_id, vendor_name_snapshot,
                currency, status, expected_date, note, created_by, created_at,
                ordered_at, received_at, cancelled_at, task_id, warehouse_id
             FROM purchase_orders WHERE id = ?1 AND tenant_id = ?2",
        )
        .map_err(|e| e.to_string())?;

    let mut order = stmt
        .query_row(params![order_id, tenant_id], row_to_order)
        .map_err(|_| "找不到採購單或不屬於目前租戶".to_string())?;

    let mut lines_stmt = conn
        .prepare(
            "SELECT 
                id, purchase_order_id, line_no, unit_id, supply_source_id,
                product_name_snapshot, variant_name_snapshot, sku_snapshot,
                unit_name_snapshot, quantity, received_quantity, purchase_cost, created_at
             FROM purchase_order_lines 
             WHERE purchase_order_id = ?1
             ORDER BY line_no ASC, created_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let lines: Vec<PurchaseOrderLine> = lines_stmt
        .query_map(params![order_id], row_to_line)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    order.total_amount = lines.iter().map(|l| l.subtotal).sum::<f64>();

    Ok(PurchaseOrderDetail { order, lines })
}

pub fn list_purchase_orders_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    filter_status: Option<String>,
    filter_vendor_partner_id: Option<String>,
) -> Result<Vec<PurchaseOrder>, String> {
    if tenant_id.trim().is_empty() {
        return Err("Tenant ID cannot be empty".to_string());
    }

    let mut query = "SELECT 
                        id, tenant_id, po_number, vendor_partner_id, vendor_name_snapshot,
                        currency, status, expected_date, note, created_by, created_at,
                        ordered_at, received_at, cancelled_at, task_id, warehouse_id
                     FROM purchase_orders WHERE tenant_id = ?1"
        .to_string();

    let mut sql_params: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(tenant_id.to_string())];

    if let Some(ref st) = filter_status {
        if !st.trim().is_empty() {
            query.push_str(" AND status = ?");
            sql_params.push(Box::new(st.trim().to_string()));
        }
    }

    if let Some(ref v) = filter_vendor_partner_id {
        if !v.trim().is_empty() {
            query.push_str(" AND vendor_partner_id = ?");
            sql_params.push(Box::new(v.trim().to_string()));
        }
    }

    query.push_str(" ORDER BY created_at DESC, id DESC");

    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
    let param_refs: Vec<&dyn rusqlite::ToSql> = sql_params.iter().map(|p| p.as_ref()).collect();

    let orders_iter = stmt
        .query_map(param_refs.as_slice(), row_to_order)
        .map_err(|e| e.to_string())?;

    let mut orders = Vec::new();
    for ord_res in orders_iter {
        let mut ord = ord_res.map_err(|e| e.to_string())?;
        // Calculate total_amount
        let total: f64 = conn
            .query_row(
                "SELECT COALESCE(SUM(quantity * purchase_cost), 0.0) 
                 FROM purchase_order_lines WHERE purchase_order_id = ?1",
                params![ord.id],
                |r| r.get(0),
            )
            .unwrap_or(0.0);
        ord.total_amount = total;
        orders.push(ord);
    }

    Ok(orders)
}

pub fn record_opening_inventory_balance_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: &str,
    user_id: &str,
    unit_id: &str,
    quantity_delta: f64,
    unit_cost: f64,
    warehouse_id: Option<String>,
) -> Result<InventoryMovement, String> {
    if tenant_id.trim().is_empty() {
        return Err("Tenant ID cannot be empty".to_string());
    }
    let trimmed_uid = user_id.trim();
    if trimmed_uid.is_empty() {
        return Err("無法解析有效使用者 session，操作被拒絕".to_string());
    }

    let _unit_snapshot = resolve_unit_snapshot(conn, tenant_id, unit_id)?;

    if quantity_delta <= 0.0 {
        return Err("期初開帳數量必須大於 0".to_string());
    }
    if unit_cost < 0.0 {
        return Err("期初開帳成本不可為負數".to_string());
    }

    // O-01 & W-00 & W-04: Resolve warehouse
    let (target_wh_id, target_wh_name) = match warehouse_id {
        Some(ref wid) if !wid.trim().is_empty() => {
            let wh = crate::warehouses::validate_warehouse_active(conn, tenant_id, wid)?;
            (wh.id, wh.name)
        }
        _ => {
            let wh = crate::warehouses::resolve_default_warehouse(conn, tenant_id)?;
            (wh.id, wh.name)
        }
    };

    // O-01: Check duplicate opening balance per (tenant_id, unit_id, warehouse_id)
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM inventory_movements 
             WHERE tenant_id = ?1 AND unit_id = ?2 AND warehouse_id = ?3 AND reason = 'opening_balance'",
            params![tenant_id, unit_id, target_wh_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    if exists > 0 {
        return Err(format!(
            "此商品單位在〔{}〕已開帳，數量更正請用庫存調整（原因：期初更正）",
            target_wh_name
        ));
    }

    let now = current_timestamp();
    let im_id = format!(
        "im_{}_{}",
        now,
        PO_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    );

    conn.execute(
        "INSERT INTO inventory_movements (
            id, tenant_id, unit_id, quantity_delta, unit_cost, reason, reference_type, reference_id, created_by, created_at, warehouse_id
        ) VALUES (?1, ?2, ?3, ?4, ?5, 'opening_balance', 'opening_balance', NULL, ?6, ?7, ?8)",
        params![
            im_id,
            tenant_id,
            unit_id,
            quantity_delta,
            unit_cost,
            trimmed_uid,
            now,
            target_wh_id
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(InventoryMovement {
        id: im_id,
        tenant_id: tenant_id.to_string(),
        unit_id: unit_id.to_string(),
        quantity_delta,
        unit_cost: Some(unit_cost),
        reason: "opening_balance".to_string(),
        reference_type: "opening_balance".to_string(),
        reference_id: None,
        created_by: trimmed_uid.to_string(),
        created_at: now,
        warehouse_id: target_wh_id,
    })
}

pub fn get_inventory_level_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    unit_id: &str,
    warehouse_id: Option<&str>,
) -> Result<InventoryLevel, String> {
    if tenant_id.trim().is_empty() {
        return Err("Tenant ID cannot be empty".to_string());
    }

    // Rule Q-01: Zero warehouse tenant returns level with 0 quantity
    if !crate::warehouses::has_any_warehouses(conn, tenant_id)? {
        let snap = resolve_unit_snapshot(conn, tenant_id, unit_id)?;
        return Ok(InventoryLevel {
            unit_id: unit_id.to_string(),
            current_quantity: 0.0,
            product_name: Some(snap.product_name),
            variant_name: Some(snap.variant_name),
            sku: snap.sku,
            unit_name: Some(snap.unit_name),
            warehouse_id: warehouse_id
                .map(|w| w.trim().to_string())
                .filter(|w| !w.is_empty()),
        });
    }

    let snap = resolve_unit_snapshot(conn, tenant_id, unit_id)?;

    let (current_quantity, effective_wh) = match warehouse_id {
        Some(wid) if !wid.trim().is_empty() => {
            let qty: f64 = conn
                .query_row(
                    "SELECT COALESCE(SUM(quantity_delta), 0.0) FROM inventory_movements WHERE tenant_id = ?1 AND unit_id = ?2 AND warehouse_id = ?3",
                    params![tenant_id, unit_id, wid.trim()],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            (qty, Some(wid.trim().to_string()))
        }
        _ => {
            let qty: f64 = conn
                .query_row(
                    "SELECT COALESCE(SUM(quantity_delta), 0.0) FROM inventory_movements WHERE tenant_id = ?1 AND unit_id = ?2",
                    params![tenant_id, unit_id],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            (qty, None)
        }
    };

    Ok(InventoryLevel {
        unit_id: unit_id.to_string(),
        current_quantity,
        product_name: Some(snap.product_name),
        variant_name: Some(snap.variant_name),
        sku: snap.sku,
        unit_name: Some(snap.unit_name),
        warehouse_id: effective_wh,
    })
}

pub fn list_inventory_levels_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    warehouse_id: Option<&str>,
) -> Result<Vec<InventoryLevel>, String> {
    if tenant_id.trim().is_empty() {
        return Err("Tenant ID cannot be empty".to_string());
    }

    // Rule Q-01: Zero warehouse tenant returns empty list
    if !crate::warehouses::has_any_warehouses(conn, tenant_id)? {
        return Ok(Vec::new());
    }

    let filter_wh = warehouse_id.map(|w| w.trim()).filter(|w| !w.is_empty());

    let (query, effective_wh) = if let Some(wid) = filter_wh {
        (
            "SELECT 
                u.id,
                COALESCE((SELECT SUM(im.quantity_delta) FROM inventory_movements im WHERE im.tenant_id = ?1 AND im.unit_id = u.id AND im.warehouse_id = ?2), 0.0),
                p.name,
                v.name,
                v.sku,
                u.unit_name
             FROM product_units u
             JOIN product_variants v ON u.variant_id = v.id
             JOIN products p ON v.product_id = p.id
             WHERE p.tenant_id = ?1
             ORDER BY p.name ASC, v.name ASC, u.unit_name ASC".to_string(),
            Some(wid.to_string()),
        )
    } else {
        (
            "SELECT 
                u.id,
                COALESCE((SELECT SUM(im.quantity_delta) FROM inventory_movements im WHERE im.tenant_id = ?1 AND im.unit_id = u.id), 0.0),
                p.name,
                v.name,
                v.sku,
                u.unit_name
             FROM product_units u
             JOIN product_variants v ON u.variant_id = v.id
             JOIN products p ON v.product_id = p.id
             WHERE p.tenant_id = ?1
             ORDER BY p.name ASC, v.name ASC, u.unit_name ASC".to_string(),
            None,
        )
    };

    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;

    let map_fn = |r: &rusqlite::Row| {
        Ok(InventoryLevel {
            unit_id: r.get(0)?,
            current_quantity: r.get(1)?,
            product_name: Some(r.get(2)?),
            variant_name: Some(r.get(3)?),
            sku: r.get(4)?,
            unit_name: Some(r.get(5)?),
            warehouse_id: effective_wh.clone(),
        })
    };

    let rows = if let Some(wid) = filter_wh {
        stmt.query_map(params![tenant_id, wid], map_fn)
    } else {
        stmt.query_map(params![tenant_id], map_fn)
    }
    .map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r.map_err(|e| e.to_string())?);
    }
    Ok(list)
}

pub fn list_inventory_movements_impl(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    unit_id: Option<&str>,
    warehouse_id: Option<&str>,
) -> Result<Vec<InventoryMovement>, String> {
    if tenant_id.trim().is_empty() {
        return Err("Tenant ID cannot be empty".to_string());
    }

    // Rule Q-01: Zero warehouse tenant returns empty list
    if !crate::warehouses::has_any_warehouses(conn, tenant_id)? {
        return Ok(Vec::new());
    }

    let mut query = "SELECT id, tenant_id, unit_id, quantity_delta, unit_cost, reason, reference_type, reference_id, created_by, created_at, warehouse_id FROM inventory_movements WHERE tenant_id = ?1".to_string();
    let mut sql_params: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(tenant_id.to_string())];

    if let Some(u) = unit_id {
        let trimmed = u.trim();
        if !trimmed.is_empty() {
            query.push_str(&format!(" AND unit_id = ?{}", sql_params.len() + 1));
            sql_params.push(Box::new(trimmed.to_string()));
        }
    }

    if let Some(w) = warehouse_id {
        let trimmed = w.trim();
        if !trimmed.is_empty() {
            query.push_str(&format!(" AND warehouse_id = ?{}", sql_params.len() + 1));
            sql_params.push(Box::new(trimmed.to_string()));
        }
    }

    query.push_str(" ORDER BY created_at ASC");

    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;

    let map_fn = |r: &rusqlite::Row| {
        Ok(InventoryMovement {
            id: r.get(0)?,
            tenant_id: r.get(1)?,
            unit_id: r.get(2)?,
            quantity_delta: r.get(3)?,
            unit_cost: r.get(4)?,
            reason: r.get(5)?,
            reference_type: r.get(6)?,
            reference_id: r.get(7)?,
            created_by: r.get(8)?,
            created_at: r.get(9)?,
            warehouse_id: r.get::<_, Option<String>>(10)?.unwrap_or_default(),
        })
    };

    let param_refs: Vec<&dyn rusqlite::ToSql> = sql_params.iter().map(|p| p.as_ref()).collect();
    let rows = stmt
        .query_map(param_refs.as_slice(), map_fn)
        .map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r.map_err(|e| e.to_string())?);
    }
    Ok(list)
}

// ==========================================
// Delivery Layer (Tauri Commands)
// ==========================================

#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn create_purchase_order<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    vendor_partner_id: String,
    currency: Option<String>,
    expected_date: Option<i64>,
    note: Option<String>,
    task_id: Option<String>,
    initial_lines: Option<Vec<CreatePurchaseOrderLineInput>>,
    warehouse_id: Option<String>,
) -> Result<PurchaseOrderDetail, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = resolve_active_user_id(&conn)?;
    create_purchase_order_impl(
        &mut conn,
        &active_tid,
        &active_uid,
        &vendor_partner_id,
        currency,
        expected_date,
        note,
        task_id,
        initial_lines,
        warehouse_id,
    )
}

#[tauri::command]
#[specta::specta]
pub async fn update_purchase_order_header<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    order_id: String,
    vendor_partner_id: Option<String>,
    expected_date: Option<Option<i64>>,
    note: Option<Option<String>>,
    warehouse_id: Option<String>,
) -> Result<PurchaseOrderDetail, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    update_purchase_order_header_impl(
        &mut conn,
        &active_tid,
        &order_id,
        vendor_partner_id,
        expected_date,
        note,
        warehouse_id,
    )
}

#[tauri::command]
#[specta::specta]
pub async fn add_purchase_order_line<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    order_id: String,
    unit_id: String,
    quantity: f64,
    purchase_cost: Option<f64>,
) -> Result<PurchaseOrderDetail, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    add_purchase_order_line_impl(
        &mut conn,
        &active_tid,
        &order_id,
        &unit_id,
        quantity,
        purchase_cost,
    )
}

#[tauri::command]
#[specta::specta]
pub async fn update_purchase_order_line<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    line_id: String,
    quantity: Option<f64>,
    purchase_cost: Option<f64>,
) -> Result<PurchaseOrderDetail, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    update_purchase_order_line_impl(&mut conn, &active_tid, &line_id, quantity, purchase_cost)
}

#[tauri::command]
#[specta::specta]
pub async fn remove_purchase_order_line<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    line_id: String,
) -> Result<PurchaseOrderDetail, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    remove_purchase_order_line_impl(&mut conn, &active_tid, &line_id)
}

#[tauri::command]
#[specta::specta]
pub async fn submit_purchase_order<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    order_id: String,
) -> Result<PurchaseOrderDetail, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    submit_purchase_order_impl(&mut conn, &active_tid, &order_id)
}

#[tauri::command]
#[specta::specta]
pub async fn confirm_purchase_order_received<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    order_id: String,
    line_received_quantities: Option<Vec<ReceivedLineInput>>,
) -> Result<PurchaseOrderDetail, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = resolve_active_user_id(&conn)?;
    let rec_map = line_received_quantities.map(|list| {
        list.into_iter()
            .map(|item| (item.line_id, item.received_quantity))
            .collect::<HashMap<String, f64>>()
    });
    confirm_purchase_order_received_impl(&mut conn, &active_tid, &active_uid, &order_id, rec_map)
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_purchase_order<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    order_id: String,
) -> Result<PurchaseOrderDetail, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    cancel_purchase_order_impl(&mut conn, &active_tid, &order_id)
}

#[tauri::command]
#[specta::specta]
pub async fn get_purchase_order<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    order_id: String,
) -> Result<PurchaseOrderDetail, String> {
    let db_path = get_db_path(&app_handle);
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    get_purchase_order_impl(&conn, &active_tid, &order_id)
}

#[tauri::command]
#[specta::specta]
pub async fn list_purchase_orders<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    filter_status: Option<String>,
    filter_vendor_partner_id: Option<String>,
) -> Result<Vec<PurchaseOrder>, String> {
    let db_path = get_db_path(&app_handle);
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    list_purchase_orders_impl(&conn, &active_tid, filter_status, filter_vendor_partner_id)
}

#[tauri::command]
#[specta::specta]
pub async fn record_opening_inventory_balance<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    unit_id: String,
    quantity_delta: f64,
    unit_cost: f64,
    warehouse_id: Option<String>,
) -> Result<InventoryMovement, String> {
    let db_path = get_db_path(&app_handle);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    let active_uid = resolve_active_user_id(&conn)?;
    record_opening_inventory_balance_impl(
        &mut conn,
        &active_tid,
        &active_uid,
        &unit_id,
        quantity_delta,
        unit_cost,
        warehouse_id,
    )
}

#[tauri::command]
#[specta::specta]
pub async fn get_inventory_level<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    unit_id: String,
    warehouse_id: Option<String>,
) -> Result<InventoryLevel, String> {
    let db_path = get_db_path(&app_handle);
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    get_inventory_level_impl(&conn, &active_tid, &unit_id, warehouse_id.as_deref())
}

#[tauri::command]
#[specta::specta]
pub async fn list_inventory_levels<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    warehouse_id: Option<String>,
) -> Result<Vec<InventoryLevel>, String> {
    let db_path = get_db_path(&app_handle);
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    list_inventory_levels_impl(&conn, &active_tid, warehouse_id.as_deref())
}

#[tauri::command]
#[specta::specta]
pub async fn list_inventory_movements<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    unit_id: Option<String>,
    warehouse_id: Option<String>,
) -> Result<Vec<InventoryMovement>, String> {
    let db_path = get_db_path(&app_handle);
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    list_inventory_movements_impl(
        &conn,
        &active_tid,
        unit_id.as_deref(),
        warehouse_id.as_deref(),
    )
}

// ==========================================
// Unit and Integration Tests (Layer 1)
// ==========================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{InMemoryTokenStore, TokenStore};
    use crate::partners::create_partner_impl;
    use crate::products::{add_supply_source_impl, create_product_impl};

    fn setup_test_db() -> rusqlite::Connection {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();

        conn.execute(
            "CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL,
                name TEXT NOT NULL DEFAULT ''
            )",
            [],
        )
        .unwrap();

        conn.execute(
            "CREATE TABLE IF NOT EXISTS tenants (
                id TEXT PRIMARY KEY,
                code TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                company_name TEXT NOT NULL,
                tax_id TEXT
            )",
            [],
        )
        .unwrap();

        conn.execute(
            "CREATE TABLE IF NOT EXISTS user_tenants (
                user_id TEXT NOT NULL,
                tenant_id TEXT NOT NULL,
                role TEXT NOT NULL,
                PRIMARY KEY (user_id, tenant_id)
            )",
            [],
        )
        .unwrap();

        conn.execute(
            "CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                active_tenant_id TEXT,
                created_at INTEGER NOT NULL
            )",
            [],
        )
        .unwrap();

        crate::partners::create_partners_table(&conn).unwrap();
        crate::products::create_products_tables(&conn).unwrap();
        crate::warehouses::create_warehouses_tables(&conn).unwrap();
        create_purchase_orders_tables(&conn).unwrap();

        conn.execute(
            "INSERT INTO tenants (id, code, name, company_name) VALUES ('tnt_test', 'test', 'Test Tenant', 'Test Inc.')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO tenants (id, code, name, company_name) VALUES ('tnt_other', 'other', 'Other Tenant', 'Other Inc.')",
            [],
        ).unwrap();

        let _ = crate::warehouses::create_warehouse_impl(&mut conn, "tnt_test", "MAIN", "主倉");

        conn.execute(
            "INSERT INTO users (id, email, password, name) VALUES ('usr_1', 'u1@example.com', 'hash', 'User One')",
            [],
        ).unwrap();

        conn.execute(
            "INSERT INTO sessions (token, user_id, active_tenant_id, created_at) VALUES ('tok_valid', 'usr_1', 'tnt_test', 123456)",
            [],
        ).unwrap();

        conn
    }

    #[test]
    fn test_tc_po_n_01_create_draft_order_and_sequence_number() {
        // Given: Active tenant and a valid vendor partner
        let mut conn = setup_test_db();
        let vendor = create_partner_impl(
            &conn,
            "tnt_test",
            "欣興電子".to_string(),
            None,
            Some(true),
            Some("11223344".to_string()),
        )
        .unwrap();

        // When: Creating first purchase order
        let detail1 = create_purchase_order_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            &vendor.id,
            Some("TWD".to_string()),
            Some(1700000000),
            Some("第一筆採購備註".to_string()),
            Some("task_1".to_string()),
            None,
            None,
        )
        .unwrap();

        // Then: Order is in draft, po_number is PO-00001, total_amount is 0.0
        assert_eq!(detail1.order.po_number, "PO-00001");
        assert_eq!(detail1.order.status, "draft");
        assert_eq!(detail1.order.vendor_name_snapshot, "欣興電子");
        assert_eq!(detail1.order.created_by, "usr_1");
        assert_eq!(detail1.order.total_amount, 0.0);
        assert_eq!(detail1.order.task_id, Some("task_1".to_string()));
        assert!(detail1.lines.is_empty());

        // When: Creating second purchase order in the same tenant
        let detail2 = create_purchase_order_impl(
            &mut conn, "tnt_test", "usr_1", &vendor.id, None, None, None, None, None, None,
        )
        .unwrap();

        // Then: Sequence increments to PO-00002
        assert_eq!(detail2.order.po_number, "PO-00002");
    }

    #[test]
    fn test_tc_po_n_02_and_n_03_add_lines_with_supply_source_prefill_and_snapshots() {
        // Given: Product with base unit and supply source
        let mut conn = setup_test_db();
        let vendor = create_partner_impl(
            &conn,
            "tnt_test",
            "台積電".to_string(),
            None,
            Some(true),
            None,
        )
        .unwrap();

        let prod = create_product_impl(
            &conn,
            "tnt_test",
            "晶圓晶片".to_string(),
            "resale".to_string(),
            Some("CHIP-01".to_string()),
            Some("片".to_string()),
            Some(500.0),
        )
        .unwrap();
        let unit_id = &prod.units[0].id;

        // Add supply source for this vendor + unit at 320 TWD
        let src = add_supply_source_impl(
            &mut conn,
            "tnt_test",
            unit_id,
            &vendor.id,
            320.0,
            Some("TWD".to_string()),
            Some(true),
        )
        .unwrap();

        let detail = create_purchase_order_impl(
            &mut conn, "tnt_test", "usr_1", &vendor.id, None, None, None, None, None, None,
        )
        .unwrap();

        // When: Adding line without purchase_cost (should prefill from supply source)
        let updated = add_purchase_order_line_impl(
            &mut conn,
            "tnt_test",
            &detail.order.id,
            unit_id,
            10.0,
            None,
        )
        .unwrap();

        // Then: Auto-prefills cost 320.0, records supply_source_id, snapshots product/variant/unit
        assert_eq!(updated.lines.len(), 1);
        let line = &updated.lines[0];
        assert_eq!(line.purchase_cost, 320.0);
        assert_eq!(line.supply_source_id, Some(src.id));
        assert_eq!(line.product_name_snapshot, "晶圓晶片");
        assert_eq!(line.unit_name_snapshot, "片");
        assert_eq!(line.subtotal, 3200.0);
        assert_eq!(updated.order.total_amount, 3200.0);

        // When: Product is renamed in master data
        conn.execute(
            "UPDATE products SET name = '改名後的晶片' WHERE id = ?1",
            params![prod.product.id],
        )
        .unwrap();

        // Then: Snapshot in purchase order line remains unchanged (R-12)
        let reloaded = get_purchase_order_impl(&conn, "tnt_test", &detail.order.id).unwrap();
        assert_eq!(reloaded.lines[0].product_name_snapshot, "晶圓晶片");
    }

    #[test]
    fn test_tc_po_n_04_n_05_n_06_lifecycle_from_submit_to_receipt_with_differing_quantity() {
        // Given: Draft order with two lines
        let mut conn = setup_test_db();
        let vendor = create_partner_impl(
            &conn,
            "tnt_test",
            "供應商甲".to_string(),
            None,
            Some(true),
            None,
        )
        .unwrap();

        let prod1 = create_product_impl(
            &conn,
            "tnt_test",
            "品項A".to_string(),
            "resale".to_string(),
            None,
            Some("個".to_string()),
            Some(100.0),
        )
        .unwrap();
        let prod2 = create_product_impl(
            &conn,
            "tnt_test",
            "品項B".to_string(),
            "resale".to_string(),
            None,
            Some("支".to_string()),
            Some(200.0),
        )
        .unwrap();

        let u1 = &prod1.units[0].id;
        let u2 = &prod2.units[0].id;

        let detail = create_purchase_order_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            &vendor.id,
            None,
            None,
            None,
            None,
            Some(vec![
                CreatePurchaseOrderLineInput {
                    unit_id: u1.clone(),
                    quantity: 10.0,
                    purchase_cost: Some(50.0),
                },
                CreatePurchaseOrderLineInput {
                    unit_id: u2.clone(),
                    quantity: 20.0,
                    purchase_cost: Some(80.0),
                },
            ]),
            None,
        )
        .unwrap();

        // When: Submitting order (draft -> ordered)
        let ordered = submit_purchase_order_impl(&mut conn, "tnt_test", &detail.order.id).unwrap();

        // Then: Status becomes ordered with ordered_at set
        assert_eq!(ordered.order.status, "ordered");
        assert!(ordered.order.ordered_at.is_some());

        // When: Confirming receipt with differing received quantity (line 1 ordered 10, received 8; line 2 ordered 20, default received 20)
        let line1_id = &ordered.lines[0].id;
        let mut rec_map = HashMap::new();
        rec_map.insert(line1_id.clone(), 8.0);

        let received = confirm_purchase_order_received_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            &ordered.order.id,
            Some(rec_map),
        )
        .unwrap();

        // Then: Order is received, received_quantity recorded accurately
        assert_eq!(received.order.status, "received");
        assert!(received.order.received_at.is_some());
        assert_eq!(received.lines[0].received_quantity, Some(8.0));
        assert_eq!(received.lines[1].received_quantity, Some(20.0));

        // Then: Inventory movements written with actual received quantities
        let inv1 = get_inventory_level_impl(&conn, "tnt_test", u1, None).unwrap();
        assert_eq!(inv1.current_quantity, 8.0);

        let inv2 = get_inventory_level_impl(&conn, "tnt_test", u2, None).unwrap();
        assert_eq!(inv2.current_quantity, 20.0);
    }

    #[test]
    fn test_tc_po_n_07_cancel_draft_and_ordered_order() {
        let mut conn = setup_test_db();
        let vendor = create_partner_impl(
            &conn,
            "tnt_test",
            "供應商乙".to_string(),
            None,
            Some(true),
            None,
        )
        .unwrap();

        let prod = create_product_impl(
            &conn,
            "tnt_test",
            "取消測試商品".to_string(),
            "resale".to_string(),
            None,
            Some("個".to_string()),
            Some(100.0),
        )
        .unwrap();
        let unit_id = &prod.units[0].id;

        // --- Scenario 1: Cancel draft purchase order ---
        // Given: Draft order
        let detail1 = create_purchase_order_impl(
            &mut conn, "tnt_test", "usr_1", &vendor.id, None, None, None, None, None, None,
        )
        .unwrap();

        // When: Cancelling draft order
        let cancelled1 =
            cancel_purchase_order_impl(&mut conn, "tnt_test", &detail1.order.id).unwrap();
        // Then: Status is cancelled with cancelled_at set
        assert_eq!(cancelled1.order.status, "cancelled");
        assert!(cancelled1.order.cancelled_at.is_some());

        // --- Scenario 2: Cancel ordered purchase order ---
        // Given: Purchase order submitted to 'ordered' status
        let detail2 = create_purchase_order_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            &vendor.id,
            None,
            None,
            None,
            None,
            Some(vec![CreatePurchaseOrderLineInput {
                unit_id: unit_id.clone(),
                quantity: 10.0,
                purchase_cost: Some(50.0),
            }]),
            None,
        )
        .unwrap();
        let ordered2 =
            submit_purchase_order_impl(&mut conn, "tnt_test", &detail2.order.id).unwrap();
        assert_eq!(ordered2.order.status, "ordered");

        // When: Cancelling ordered purchase order
        let cancelled2 =
            cancel_purchase_order_impl(&mut conn, "tnt_test", &ordered2.order.id).unwrap();
        // Then: Status is cancelled with cancelled_at set
        assert_eq!(cancelled2.order.status, "cancelled");
        assert!(cancelled2.order.cancelled_at.is_some());
    }

    #[test]
    fn test_tc_po_n_08_and_e_11_opening_balance_and_duplicate_rejection() {
        // Given: Product with base unit
        let mut conn = setup_test_db();
        let prod = create_product_impl(
            &conn,
            "tnt_test",
            "庫存原物料".to_string(),
            "raw_material".to_string(),
            None,
            Some("公斤".to_string()),
            None,
        )
        .unwrap();
        let unit_id = &prod.units[0].id;

        // When: Recording opening balance for the first time
        let mov = record_opening_inventory_balance_impl(
            &mut conn, "tnt_test", "usr_1", unit_id, 150.0, 45.0, None,
        )
        .unwrap();

        // Then: Inventory movement created and level equals 150.0
        assert_eq!(mov.quantity_delta, 150.0);
        assert_eq!(mov.unit_cost, Some(45.0));
        assert_eq!(mov.reason, "opening_balance");

        let level = get_inventory_level_impl(&conn, "tnt_test", unit_id, None).unwrap();
        assert_eq!(level.current_quantity, 150.0);

        // When: Trying to record opening balance a second time for the same unit
        let err = record_opening_inventory_balance_impl(
            &mut conn, "tnt_test", "usr_1", unit_id, 50.0, 45.0, None,
        )
        .unwrap_err();

        // Then: Rejected with exact specification message
        assert!(err.contains("此商品單位在〔主倉〕已開帳，數量更正請用庫存調整（原因：期初更正）"));
    }

    #[test]
    fn test_tc_po_b_and_e_boundaries_and_validations() {
        let mut conn = setup_test_db();
        let vendor = create_partner_impl(
            &conn,
            "tnt_test",
            "合規供應商".to_string(),
            None,
            Some(true),
            None,
        )
        .unwrap();
        let non_vendor = create_partner_impl(
            &conn,
            "tnt_test",
            "單純客戶".to_string(),
            Some(true),
            Some(false),
            None,
        )
        .unwrap();

        let prod = create_product_impl(
            &conn,
            "tnt_test",
            "標準物料".to_string(),
            "raw_material".to_string(),
            None,
            Some("包".to_string()),
            None,
        )
        .unwrap();
        let unit_id = &prod.units[0].id;

        // TC-PO-E-01: Non-TWD currency rejected (R-18)
        let err_curr = create_purchase_order_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            &vendor.id,
            Some("USD".to_string()),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap_err();
        assert!(err_curr.contains("幣別僅支援 'TWD'"));

        // TC-PO-E-02: Non-vendor partner rejected (R-02)
        let err_vnd = create_purchase_order_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            &non_vendor.id,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap_err();
        assert!(err_vnd.contains("不是供應商"));

        // TC-PO-E-12: Empty user_id rejected
        let err_uid = create_purchase_order_impl(
            &mut conn, "tnt_test", "   ", &vendor.id, None, None, None, None, None, None,
        )
        .unwrap_err();
        assert!(err_uid.contains("無法解析有效使用者 session"));

        let order = create_purchase_order_impl(
            &mut conn, "tnt_test", "usr_1", &vendor.id, None, None, None, None, None, None,
        )
        .unwrap();

        // TC-PO-B-01: Quantity <= 0 rejected (R-05)
        let err_q0 = add_purchase_order_line_impl(
            &mut conn,
            "tnt_test",
            &order.order.id,
            unit_id,
            0.0,
            Some(10.0),
        )
        .unwrap_err();
        assert!(err_q0.contains("採購數量必須大於 0"));

        let err_q_neg = add_purchase_order_line_impl(
            &mut conn,
            "tnt_test",
            &order.order.id,
            unit_id,
            -1.0,
            Some(10.0),
        )
        .unwrap_err();
        assert!(err_q_neg.contains("採購數量必須大於 0"));

        // TC-PO-B-02 & B-03: Cost 0.0 allowed; Cost < 0.0 rejected (R-06)
        let err_c_neg = add_purchase_order_line_impl(
            &mut conn,
            "tnt_test",
            &order.order.id,
            unit_id,
            5.0,
            Some(-0.5),
        )
        .unwrap_err();
        assert!(err_c_neg.contains("採購單價不可為負數"));

        // Free sample cost = 0.0 succeeds
        let with_line = add_purchase_order_line_impl(
            &mut conn,
            "tnt_test",
            &order.order.id,
            unit_id,
            5.0,
            Some(0.0),
        )
        .unwrap();
        assert_eq!(with_line.lines[0].purchase_cost, 0.0);

        // TC-PO-E-05: Duplicate unit_id in same purchase order rejected (R-09)
        let err_dup = add_purchase_order_line_impl(
            &mut conn,
            "tnt_test",
            &order.order.id,
            unit_id,
            2.0,
            Some(10.0),
        )
        .unwrap_err();
        assert!(err_dup.contains("同一採購單內商品單位不可重複"));

        // TC-PO-E-06: Modifying vendor when lines exist is rejected (R-10)
        let vendor2 = create_partner_impl(
            &conn,
            "tnt_test",
            "第二供應商".to_string(),
            None,
            Some(true),
            None,
        )
        .unwrap();
        let err_mod_vnd = update_purchase_order_header_impl(
            &mut conn,
            "tnt_test",
            &order.order.id,
            Some(vendor2.id),
            None,
            None,
            None,
        )
        .unwrap_err();
        assert!(err_mod_vnd.contains("採購單已有明細，不可修改供應商"));

        // TC-PO-E-03: Passing variant_id as unit_id rejected (Strict unit_id R-03)
        let err_strict_unit = add_purchase_order_line_impl(
            &mut conn,
            "tnt_test",
            &order.order.id,
            &prod.variants[0].id,
            1.0,
            Some(10.0),
        )
        .unwrap_err();
        assert!(err_strict_unit.contains("找不到指定的商品單位"));
    }

    #[test]
    fn test_tc_po_e_04_non_purchasable_product_rejected() {
        // Given: Manufactured product (is_purchasable = false)
        let mut conn = setup_test_db();
        let vendor = create_partner_impl(
            &conn,
            "tnt_test",
            "某供應商".to_string(),
            None,
            Some(true),
            None,
        )
        .unwrap();
        let mfg_prod = create_product_impl(
            &conn,
            "tnt_test",
            "自製蛋糕".to_string(),
            "manufactured".to_string(),
            None,
            Some("個".to_string()),
            Some(300.0),
        )
        .unwrap();
        let unit_id = &mfg_prod.units[0].id;

        let order = create_purchase_order_impl(
            &mut conn, "tnt_test", "usr_1", &vendor.id, None, None, None, None, None, None,
        )
        .unwrap();

        // When: Adding non-purchasable product unit to purchase order
        let err = add_purchase_order_line_impl(
            &mut conn,
            "tnt_test",
            &order.order.id,
            unit_id,
            1.0,
            Some(100.0),
        )
        .unwrap_err();

        // Then: Rejected by R-04
        assert!(err.contains("設定為不可採購"));
    }

    #[test]
    fn test_tc_po_e_09_and_e_10_empty_order_submit_and_illegal_transitions() {
        let mut conn = setup_test_db();
        let vendor = create_partner_impl(
            &conn,
            "tnt_test",
            "供應商".to_string(),
            None,
            Some(true),
            None,
        )
        .unwrap();

        let prod = create_product_impl(
            &conn,
            "tnt_test",
            "狀態測試商品".to_string(),
            "resale".to_string(),
            None,
            Some("個".to_string()),
            Some(100.0),
        )
        .unwrap();
        let unit_id = &prod.units[0].id;

        let empty_order = create_purchase_order_impl(
            &mut conn, "tnt_test", "usr_1", &vendor.id, None, None, None, None, None, None,
        )
        .unwrap();

        // --- TC-PO-E-09: Empty draft order submission rejected ---
        // Given: Empty draft purchase order without lines
        // When: Submitting empty draft order
        let err_empty =
            submit_purchase_order_impl(&mut conn, "tnt_test", &empty_order.order.id).unwrap_err();
        // Then: Rejected because at least 1 line is required
        assert!(err_empty.contains("採購單至少需有 1 筆明細方可下單"));

        // --- TC-PO-E-10: Illegal state transition draft -> received directly rejected ---
        // Given: Draft order
        // When: Attempting illegal jump draft -> received directly
        let err_jump = confirm_purchase_order_received_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            &empty_order.order.id,
            None,
        )
        .unwrap_err();
        // Then: Rejected with invalid state transition error
        assert!(err_jump.contains("無效的狀態轉換"));

        // --- TC-PO-E-13: Illegal state transition received -> cancelled rejected ---
        // Given: A purchase order that has already reached the terminal 'received' state
        let po_to_receive = create_purchase_order_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            &vendor.id,
            None,
            None,
            None,
            None,
            Some(vec![CreatePurchaseOrderLineInput {
                unit_id: unit_id.clone(),
                quantity: 5.0,
                purchase_cost: Some(30.0),
            }]),
            None,
        )
        .unwrap();
        submit_purchase_order_impl(&mut conn, "tnt_test", &po_to_receive.order.id).unwrap();
        let received = confirm_purchase_order_received_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            &po_to_receive.order.id,
            None,
        )
        .unwrap();
        assert_eq!(received.order.status, "received");

        // When: Attempting to cancel an order already received
        let err_cancel_received =
            cancel_purchase_order_impl(&mut conn, "tnt_test", &received.order.id).unwrap_err();
        // Then: Rejected because 'received' is a terminal state with no permitted transitions
        assert!(err_cancel_received.contains("無效的狀態轉換：不可從 received 轉換至 cancelled"));
    }

    #[test]
    fn test_tc_po_idem_idempotency_and_double_call_protection() {
        let mut conn = setup_test_db();
        let vendor = create_partner_impl(
            &conn,
            "tnt_test",
            "供應商".to_string(),
            None,
            Some(true),
            None,
        )
        .unwrap();
        let prod = create_product_impl(
            &conn,
            "tnt_test",
            "原料X".to_string(),
            "raw_material".to_string(),
            None,
            Some("公斤".to_string()),
            None,
        )
        .unwrap();
        let unit_id = &prod.units[0].id;

        // --- Idempotency Test 1: submit_purchase_order_impl double call protection ---
        // Given: A draft order with 1 line
        let po_submit = create_purchase_order_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            &vendor.id,
            None,
            None,
            None,
            None,
            Some(vec![CreatePurchaseOrderLineInput {
                unit_id: unit_id.clone(),
                quantity: 20.0,
                purchase_cost: Some(10.0),
            }]),
            None,
        )
        .unwrap();

        // When: First call to submit_purchase_order
        let sub1_res = submit_purchase_order_impl(&mut conn, "tnt_test", &po_submit.order.id);
        // Then: Succeeds, status is ordered
        assert!(sub1_res.is_ok());
        assert_eq!(sub1_res.unwrap().order.status, "ordered");

        // When: Second call to submit_purchase_order (retry simulation)
        let sub2_res = submit_purchase_order_impl(&mut conn, "tnt_test", &po_submit.order.id);
        // Then: Rejected, order remains in ordered state
        assert!(sub2_res.is_err());
        let check_sub = get_purchase_order_impl(&conn, "tnt_test", &po_submit.order.id).unwrap();
        assert_eq!(check_sub.order.status, "ordered");

        // --- Idempotency Test 2: confirm_purchase_order_received_impl double call protection ---
        // Given: An ordered purchase order
        let detail = create_purchase_order_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            &vendor.id,
            None,
            None,
            None,
            None,
            Some(vec![CreatePurchaseOrderLineInput {
                unit_id: unit_id.clone(),
                quantity: 100.0,
                purchase_cost: Some(15.0),
            }]),
            None,
        )
        .unwrap();
        submit_purchase_order_impl(&mut conn, "tnt_test", &detail.order.id).unwrap();

        // When: First call to confirm_received
        let first_res = confirm_purchase_order_received_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            &detail.order.id,
            None,
        );
        assert!(first_res.is_ok());

        // When: Second call to confirm_received (retry simulation)
        let second_res = confirm_purchase_order_received_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            &detail.order.id,
            None,
        );
        // Then: Second call is rejected, inventory movement remains exactly 1, quantity does not double
        assert!(second_res.is_err());
        let inv = get_inventory_level_impl(&conn, "tnt_test", unit_id, None).unwrap();
        assert_eq!(inv.current_quantity, 100.0);

        let mov_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM inventory_movements WHERE reference_id = ?1",
                params![detail.order.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(mov_count, 1);

        // --- Idempotency Test 3: cancel_purchase_order_impl double call protection ---
        // Given: A draft purchase order
        let po_cancel = create_purchase_order_impl(
            &mut conn, "tnt_test", "usr_1", &vendor.id, None, None, None, None, None, None,
        )
        .unwrap();

        // When: First call to cancel_purchase_order
        let canc1_res = cancel_purchase_order_impl(&mut conn, "tnt_test", &po_cancel.order.id);
        // Then: Succeeds, status is cancelled
        assert!(canc1_res.is_ok());
        assert_eq!(canc1_res.unwrap().order.status, "cancelled");

        // When: Second call to cancel_purchase_order (retry simulation)
        let canc2_res = cancel_purchase_order_impl(&mut conn, "tnt_test", &po_cancel.order.id);
        // Then: Rejected, order remains in cancelled state
        assert!(canc2_res.is_err());
        let check_canc = get_purchase_order_impl(&conn, "tnt_test", &po_cancel.order.id).unwrap();
        assert_eq!(check_canc.order.status, "cancelled");
    }

    #[test]
    fn test_tc_po_iso_tenant_isolation() {
        // Given: Orders and products in two separate tenants
        let mut conn = setup_test_db();
        let _ =
            crate::warehouses::create_warehouse_impl(&mut conn, "tnt_other", "OTHER_WH", "其他倉");
        let vendor1 = create_partner_impl(
            &conn,
            "tnt_test",
            "租戶一供應商".to_string(),
            None,
            Some(true),
            None,
        )
        .unwrap();
        let vendor2 = create_partner_impl(
            &conn,
            "tnt_other",
            "租戶二供應商".to_string(),
            None,
            Some(true),
            None,
        )
        .unwrap();

        let order1 = create_purchase_order_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            &vendor1.id,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let order2 = create_purchase_order_impl(
            &mut conn,
            "tnt_other",
            "usr_1",
            &vendor2.id,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();

        // When: Listing purchase orders for tnt_test
        let list1 = list_purchase_orders_impl(&conn, "tnt_test", None, None).unwrap();
        // Then: Only order1 is returned
        assert_eq!(list1.len(), 1);
        assert_eq!(list1[0].id, order1.order.id);

        // When: tnt_test queries order2 from tnt_other
        let cross_get = get_purchase_order_impl(&conn, "tnt_test", &order2.order.id);
        // Then: Access is rejected
        assert!(cross_get.is_err());
    }

    #[test]
    fn test_resolve_active_user_id_security_and_no_fallback() {
        // Given: SQLite with session for tok_valid -> usr_1
        let conn = setup_test_db();
        let store = InMemoryTokenStore::new();

        // When: Token store is empty
        let err_empty = resolve_active_user_id_from_store(&conn, &store).unwrap_err();
        // Then: Fails immediately, does NOT fallback to other existing sessions
        assert!(err_empty.contains("無法解析有效使用者 session"));

        // When: Token store has invalid token not present in sessions
        store.save("invalid_tok", "invalid_ref").unwrap();
        let err_invalid = resolve_active_user_id_from_store(&conn, &store).unwrap_err();
        // Then: Fails immediately without fallback
        assert!(err_invalid.contains("無法解析有效使用者 session"));

        // When: Token store has valid token matching sessions table
        store.save("tok_valid", "ref").unwrap();
        let user_id = resolve_active_user_id_from_store(&conn, &store).unwrap();
        // Then: Successfully returns usr_1
        assert_eq!(user_id, "usr_1");
    }

    #[test]
    fn test_tc_po_tx_01_confirm_received_transaction_atomicity() {
        // Given: An ordered purchase order with two lines
        let mut conn = setup_test_db();
        let vendor = create_partner_impl(
            &conn,
            "tnt_test",
            "原子性測試供應商".to_string(),
            None,
            Some(true),
            None,
        )
        .unwrap();
        let prod1 = create_product_impl(
            &conn,
            "tnt_test",
            "物料A".to_string(),
            "raw_material".to_string(),
            None,
            Some("個".to_string()),
            None,
        )
        .unwrap();
        let prod2 = create_product_impl(
            &conn,
            "tnt_test",
            "物料B".to_string(),
            "raw_material".to_string(),
            None,
            Some("個".to_string()),
            None,
        )
        .unwrap();

        let detail = create_purchase_order_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            &vendor.id,
            None,
            None,
            None,
            None,
            Some(vec![
                CreatePurchaseOrderLineInput {
                    unit_id: prod1.units[0].id.clone(),
                    quantity: 10.0,
                    purchase_cost: Some(50.0),
                },
                CreatePurchaseOrderLineInput {
                    unit_id: prod2.units[0].id.clone(),
                    quantity: 20.0,
                    purchase_cost: Some(100.0),
                },
            ]),
            None,
        )
        .unwrap();

        submit_purchase_order_impl(&mut conn, "tnt_test", &detail.order.id).unwrap();

        // When: Simulating failure mid-transaction (line 1 is valid, but line 2 has negative received quantity)
        let line2_id = &detail.lines[1].id;
        let mut rec_map = HashMap::new();
        rec_map.insert(line2_id.clone(), -5.0);

        let res = confirm_purchase_order_received_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            &detail.order.id,
            Some(rec_map),
        );

        // Then: Operation returns error
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("實到數量不可為負數"));

        // Then: Transaction rolled back completely: order status remains 'ordered', and zero inventory movements inserted
        let order_check = get_purchase_order_impl(&conn, "tnt_test", &detail.order.id).unwrap();
        assert_eq!(order_check.order.status, "ordered");
        assert!(order_check.order.received_at.is_none());

        let movement_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM inventory_movements WHERE reference_id = ?1",
                params![detail.order.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(movement_count, 0);
    }

    #[test]
    fn test_tc_im_n_01_list_inventory_movements_and_filter() {
        // Given: Setup test DB and opening balance for unit1 and unit2
        let mut conn = setup_test_db();
        let prod1 = create_product_impl(
            &conn,
            "tnt_test",
            "原料A".to_string(),
            "raw_material".to_string(),
            None,
            Some("公斤".to_string()),
            None,
        )
        .unwrap();
        let unit_test_1 = &prod1.units[0].id;

        let prod2 = create_product_impl(
            &conn,
            "tnt_test",
            "原料B".to_string(),
            "raw_material".to_string(),
            None,
            Some("公克".to_string()),
            None,
        )
        .unwrap();
        let unit_test_2 = &prod2.units[0].id;

        // When: Recording opening balance for unit_test_1 and unit_test_2
        record_opening_inventory_balance_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            unit_test_1,
            12.0,
            100.0,
            None,
        )
        .unwrap();

        record_opening_inventory_balance_impl(
            &mut conn,
            "tnt_test",
            "usr_1",
            unit_test_2,
            8.0,
            50.0,
            None,
        )
        .unwrap();

        // Then: list_inventory_movements without unit filter returns all movements for tenant
        let all_movs = list_inventory_movements_impl(&conn, "tnt_test", None, None).unwrap();
        assert_eq!(all_movs.len(), 2);

        // Then: filter by unit_test_1 returns only 1 movement
        let unit1_movs =
            list_inventory_movements_impl(&conn, "tnt_test", Some(unit_test_1), None).unwrap();
        assert_eq!(unit1_movs.len(), 1);
        assert_eq!(&unit1_movs[0].unit_id, unit_test_1);
        assert_eq!(unit1_movs[0].quantity_delta, 12.0);
        assert_eq!(unit1_movs[0].reason, "opening_balance");

        // Then: boundary - empty tenant_id returns error
        let err = list_inventory_movements_impl(&conn, "", None, None);
        assert!(err.is_err());
        assert!(err.unwrap_err().contains("Tenant ID cannot be empty"));

        // Then: isolated tenant returns empty
        let other = list_inventory_movements_impl(&conn, "tnt_other", None, None).unwrap();
        assert_eq!(other.len(), 0);
    }
}
