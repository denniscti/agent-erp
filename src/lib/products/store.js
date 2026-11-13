// @ts-check
import { invoke } from '../tauri.js';
import { appState, showToast } from '../store.svelte.js';

/**
 * Resolve category string to standard category name and sellable/purchasable flags
 * @param {string} rawCategory
 * @returns {{ category: string, is_sellable: boolean, is_purchasable: boolean }}
 */
export function resolveCategoryFlags(rawCategory) {
  const norm = String(rawCategory || '').trim().toLowerCase();
  if (norm === 'resale' || norm === '轉售商品' || norm === '轉售') {
    return { category: 'resale', is_sellable: true, is_purchasable: true };
  }
  if (norm === 'manufactured' || norm === '自製成品' || norm === '自製') {
    return { category: 'manufactured', is_sellable: true, is_purchasable: false };
  }
  if (norm === 'raw_material' || norm === '原物料' || norm === '原料') {
    return { category: 'raw_material', is_sellable: false, is_purchasable: true };
  }
  throw new Error(`無效的商品類別「${rawCategory}」，僅允許：轉售商品、自製成品、原物料`);
}

/**
 * Fetch products list
 * @param {any} [filters]
 * @returns {Promise<any[]>}
 */
export async function fetchProducts(filters = {}) {
  try {
    const payload = {};
    if (filters.filter_category !== undefined || filters.filterCategory !== undefined) {
      payload.filter_category = filters.filter_category !== undefined ? filters.filter_category : filters.filterCategory;
      payload.filterCategory = payload.filter_category;
    }
    if (filters.filter_sellable !== undefined || filters.filterSellable !== undefined) {
      payload.filter_sellable = filters.filter_sellable !== undefined ? filters.filter_sellable : filters.filterSellable;
      payload.filterSellable = payload.filter_sellable;
    }
    if (filters.filter_purchasable !== undefined || filters.filterPurchasable !== undefined) {
      payload.filter_purchasable = filters.filter_purchasable !== undefined ? filters.filter_purchasable : filters.filterPurchasable;
      payload.filterPurchasable = payload.filter_purchasable;
    }
    const list = await invoke('list_products', payload);
    appState.products = list || [];
    return appState.products;
  } catch (err) {
    console.error("Failed to fetch products:", err);
    return [];
  }
}

/**
 * Get product detail (including variants, units, supply sources, BOM)
 * @param {string} productId
 * @returns {Promise<any>}
 */
export async function getProductDetailAction(productId) {
  const trimmedId = (productId || '').trim();
  if (!trimmedId) {
    throw new Error('商品 ID 為必填項目');
  }
  try {
    const detail = await invoke('get_product_detail', {
      product_id: trimmedId,
      productId: trimmedId
    });
    appState.currentProductDetail = detail;
    return detail;
  } catch (err) {
    console.error("Failed to get product detail:", err);
    throw err;
  }
}

/**
 * Create a new product
 * @param {{ name: string, category: string, sku?: string, unit_name?: string, unitName?: string, baseUnit?: string, base_unit?: string, selling_price?: number, sellingPrice?: number, initialBomItems?: any[], initial_bom_items?: any[], bomItems?: any[], bom_items?: any[] }} input
 * @returns {Promise<any>}
 */
export async function createProductAction(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('商品資訊無效');
  }
  const name = (input.name || '').trim();
  if (!name) {
    throw new Error('商品名稱不能為空');
  }
  const category = (input.category || '').trim();
  if (!category) {
    throw new Error('商品類別為必填項目');
  }
  const sku = input.sku ? String(input.sku).trim() : undefined;
  const unitName = (input.unit_name || input.unitName || input.baseUnit || input.base_unit || '').trim() || undefined;
  const sellingPrice = input.selling_price !== undefined ? input.selling_price : input.sellingPrice;

  try {
    const created = await invoke('create_product', {
      name,
      category,
      sku,
      unit_name: unitName,
      unitName,
      selling_price: sellingPrice,
      sellingPrice
    });

    const initialBom = input.initialBomItems || input.initial_bom_items || input.bomItems || input.bom_items;
    if (Array.isArray(initialBom) && initialBom.length > 0) {
      const parentVarId = (created.variants && created.variants[0]) ? created.variants[0].id : (created.product ? created.product.id : created.id);
      const validItems = initialBom
        .map(item => ({
          childId: item.materialVariantId || item.material_variant_id || item.childVariantId || item.child_variant_id,
          qty: Number(item.quantity)
        }))
        .filter(item => item.childId && !isNaN(item.qty) && item.qty > 0);

      if (validItems.length > 0) {
        try {
          await Promise.all(validItems.map(item => addBomItemAction(parentVarId, item.childId, item.qty)));
        } catch (bomErr) {
          await fetchProducts();
          throw bomErr;
        }
      }
    }

    await fetchProducts();
    showToast(`已成功建立商品「${name}」！`);
    return created;
  } catch (err) {
    console.error("Failed to create product:", err);
    throw err;
  }
}

/**
 * Add a variant to an existing product
 * @param {string} productId
 * @param {string} name
 * @param {string} [sku]
 * @param {object} [specAttributes={}]
 * @returns {Promise<any>}
 */
export async function addProductVariantAction(productId, name, sku = undefined, specAttributes = {}) {
  const prodId = (productId || '').trim();
  const variantName = (name || '').trim();
  if (!prodId) throw new Error('商品 ID 為必填項目');
  if (!variantName && (!specAttributes || Object.keys(specAttributes).length === 0)) {
    throw new Error('變體名稱不能為空');
  }

  try {
    const v = await invoke('add_product_variant', {
      product_id: prodId,
      productId: prodId,
      name: variantName,
      sku: sku ? String(sku).trim() : undefined,
      spec_attributes: specAttributes || {},
      specAttributes: specAttributes || {}
    });
    if (appState.currentProductDetail && appState.currentProductDetail.product.id === prodId) {
      await getProductDetailAction(prodId);
    }
    showToast(`已成功新增變體「${v.name || variantName}」！`);
    return v;
  } catch (err) {
    console.error("Failed to add product variant:", err);
    throw err;
  }
}

/**
 * Update an existing product variant
 * @param {string} variantId
 * @param {object} updates
 * @param {string} [updates.name]
 * @param {string} [updates.sku]
 * @param {object} [updates.spec_attributes]
 * @param {object} [updates.specAttributes]
 * @param {string} [updates.productId] Optional product ID to reload currentProductDetail
 * @returns {Promise<any>}
 */
export async function updateProductVariantAction(variantId, { name, sku, spec_attributes, specAttributes, productId } = {}) {
  const vId = (variantId || '').trim();
  if (!vId) throw new Error('變體 ID 為必填項目');

  const payload = {
    variant_id: vId,
    variantId: vId
  };
  if (name !== undefined) {
    payload.name = name;
  }
  if (sku !== undefined) {
    payload.sku = sku;
  }
  const spec = spec_attributes !== undefined ? spec_attributes : specAttributes;
  if (spec !== undefined) {
    payload.spec_attributes = spec;
    payload.specAttributes = spec;
  }

  try {
    const updated = await invoke('update_product_variant', payload);
    const prodId = productId || (appState.currentProductDetail?.product?.id);
    if (prodId) {
      await getProductDetailAction(prodId);
    }
    showToast(`已成功更新規格變體「${updated.name}」！`);
    return updated;
  } catch (err) {
    console.error("Failed to update product variant:", err);
    throw err;
  }
}

/**
 * Add a unit to an existing variant
 * @param {string} variantId
 * @param {string} unitName
 * @param {number} conversionRatio
 * @param {boolean} [isBaseUnit=false]
 * @param {number} [sellingPrice=0.0]
 * @returns {Promise<any>}
 */
export async function addProductUnitAction(variantId, unitName, conversionRatio, isBaseUnit = false, sellingPrice = 0.0) {
  const varId = (variantId || '').trim();
  const uName = (unitName || '').trim();
  if (!varId) throw new Error('規格變體 ID 為必填項目');
  if (!uName) throw new Error('單位名稱不能為空');

  try {
    const unit = await invoke('add_product_unit', {
      variant_id: varId,
      variantId: varId,
      unit_name: uName,
      unitName: uName,
      conversion_ratio: conversionRatio,
      conversionRatio,
      is_base_unit: isBaseUnit,
      isBaseUnit,
      selling_price: sellingPrice,
      sellingPrice,
      sell_price: sellingPrice,
      sellPrice: sellingPrice
    });
    if (appState.currentProductDetail) {
      await getProductDetailAction(appState.currentProductDetail.product.id);
    }
    showToast(`已成功新增包裝單位「${uName}」！`);
    return unit;
  } catch (err) {
    console.error("Failed to add product unit:", err);
    throw err;
  }
}

/**
 * Update an existing product sales unit
 * @param {string} unitId
 * @param {object} updates
 * @param {string} [updates.unit_name]
 * @param {string} [updates.unitName]
 * @param {number} [updates.conversion_ratio]
 * @param {number} [updates.conversionRatio]
 * @param {boolean} [updates.is_base_unit]
 * @param {boolean} [updates.isBaseUnit]
 * @param {number} [updates.selling_price]
 * @param {number} [updates.sellingPrice]
 * @param {number} [updates.sell_price]
 * @param {number} [updates.sellPrice]
 * @param {string} [updates.productId] Optional product ID to reload currentProductDetail
 * @returns {Promise<any>}
 */
export async function updateProductUnitAction(unitId, {
  unit_name,
  unitName,
  conversion_ratio,
  conversionRatio,
  is_base_unit,
  isBaseUnit,
  selling_price,
  sellingPrice,
  sell_price,
  sellPrice,
  productId
} = {}) {
  const uId = (unitId || '').trim();
  if (!uId) throw new Error('單位 ID 為必填項目');

  const payload = {
    unit_id: uId,
    unitId: uId
  };

  const name = unit_name !== undefined ? unit_name : unitName;
  if (name !== undefined) {
    payload.unit_name = name;
    payload.unitName = name;
  }

  const ratio = conversion_ratio !== undefined ? conversion_ratio : conversionRatio;
  if (ratio !== undefined) {
    payload.conversion_ratio = Number(ratio);
    payload.conversionRatio = Number(ratio);
  }

  const isBase = is_base_unit !== undefined ? is_base_unit : isBaseUnit;
  if (isBase !== undefined) {
    payload.is_base_unit = Boolean(isBase);
    payload.isBaseUnit = Boolean(isBase);
  }

  const price = selling_price !== undefined ? selling_price : (sellingPrice !== undefined ? sellingPrice : (sell_price !== undefined ? sell_price : sellPrice));
  if (price !== undefined) {
    payload.selling_price = Number(price);
    payload.sellingPrice = Number(price);
    payload.sell_price = Number(price);
    payload.sellPrice = Number(price);
  }

  try {
    const updated = await invoke('update_product_unit', payload);
    const prodId = productId || (appState.currentProductDetail?.product?.id);
    if (prodId) {
      await getProductDetailAction(prodId);
    }
    showToast(`已成功更新包裝單位「${updated.unit_name}」！`);
    return updated;
  } catch (err) {
    console.error("Failed to update product unit:", err);
    throw err;
  }
}

/**
 * Add a vendor supply source to a product sales unit
 * @param {string|any} unitId - Unit ID string or source options object
 * @param {string} [vendorPartnerId]
 * @param {number} [purchaseCost]
 * @param {string} [currency='TWD']
 * @param {boolean} [isPrimary=false]
 * @returns {Promise<any>}
 */
export async function addSupplySourceAction(unitId, vendorPartnerId, purchaseCost = 0, currency = 'TWD', isPrimary = false) {
  let uId = '';
  let vendorId = '';
  let cost = 0;
  let cur = currency;
  let prim = isPrimary;

  if (typeof unitId === 'object' && unitId !== null) {
    uId = (unitId.unit_id || unitId.unitId || '').trim();
    vendorId = (unitId.vendor_partner_id || unitId.vendorPartnerId || '').trim();
    cost = unitId.purchase_cost !== undefined ? unitId.purchase_cost : (unitId.cost !== undefined ? unitId.cost : 0);
    cur = unitId.currency || 'TWD';
    prim = unitId.is_primary !== undefined ? unitId.is_primary : (unitId.isPrimary || false);
  } else {
    uId = (unitId || '').trim();
    vendorId = (vendorPartnerId || '').trim();
    cost = purchaseCost !== undefined ? purchaseCost : 0;
  }

  if (!uId) throw new Error('包裝銷售單位 ID 為必填項目');
  if (!vendorId) throw new Error('供應商 ID 為必填項目');

  try {
    const src = await invoke('add_supply_source', {
      unit_id: uId,
      unitId: uId,
      variant_id: uId,
      variantId: uId,
      vendor_partner_id: vendorId,
      vendorPartnerId: vendorId,
      purchase_cost: cost,
      purchaseCost: cost,
      cost,
      currency: cur,
      is_primary: prim,
      isPrimary: prim
    });
    if (appState.currentProductDetail) {
      await getProductDetailAction(appState.currentProductDetail.product.id);
    }
    showToast('已成功新增供應來源！');
    return src;
  } catch (err) {
    console.error("Failed to add supply source:", err);
    throw err;
  }
}

/**
 * Update an existing product supply source
 * @param {string} sourceId
 * @param {Object} [updates={}]
 * @returns {Promise<any>}
 */
export async function updateSupplySourceAction(sourceId, updates = {}) {
  const sId = (sourceId || '').trim();
  if (!sId) throw new Error('供應來源 ID 為必填項目');

  const effectiveCost = updates.purchase_cost !== undefined ? updates.purchase_cost : updates.cost;
  const payload = {
    source_id: sId,
    sourceId: sId,
    id: sId,
    purchase_cost: effectiveCost !== undefined ? Number(effectiveCost) : undefined,
    purchaseCost: effectiveCost !== undefined ? Number(effectiveCost) : undefined,
    cost: effectiveCost !== undefined ? Number(effectiveCost) : undefined,
    vendor_partner_id: updates.vendor_partner_id !== undefined ? updates.vendor_partner_id : updates.vendorPartnerId,
    vendorPartnerId: updates.vendor_partner_id !== undefined ? updates.vendor_partner_id : updates.vendorPartnerId,
    currency: updates.currency,
    is_primary: updates.is_primary !== undefined ? updates.is_primary : updates.isPrimary,
    isPrimary: updates.is_primary !== undefined ? updates.is_primary : updates.isPrimary
  };

  try {
    const updated = await invoke('update_supply_source', payload);
    if (appState.currentProductDetail) {
      await getProductDetailAction(appState.currentProductDetail.product.id);
    }
    showToast('已成功更新供應來源！');
    return updated;
  } catch (err) {
    console.error("Failed to update supply source:", err);
    throw err;
  }
}

/**
 * Add a BOM item to a manufactured product variant
 * @param {string|object} parentVariantIdOrOptions Parent variant ID (or product ID) or options object
 * @param {string} [childVariantId] Child variant ID (or material variant ID)
 * @param {number} [quantity] BOM quantity
 * @returns {Promise<any>}
 */
export async function addBomItemAction(parentVariantIdOrOptions, childVariantId, quantity) {
  let parentVid = '';
  let childVid = '';
  let qty = quantity;

  if (typeof parentVariantIdOrOptions === 'object' && parentVariantIdOrOptions !== null) {
    parentVid = (parentVariantIdOrOptions.parent_variant_id || parentVariantIdOrOptions.parentVariantId || parentVariantIdOrOptions.product_id || parentVariantIdOrOptions.productId || '').trim();
    childVid = (parentVariantIdOrOptions.child_variant_id || parentVariantIdOrOptions.childVariantId || parentVariantIdOrOptions.material_variant_id || parentVariantIdOrOptions.materialVariantId || '').trim();
    qty = parentVariantIdOrOptions.quantity;
  } else {
    parentVid = (parentVariantIdOrOptions || '').trim();
    childVid = (childVariantId || '').trim();
  }

  if (!parentVid || !childVid) throw new Error('母規格變體與子物料變體為必填項目');

  try {
    const bom = await invoke('add_bom_item', {
      parent_variant_id: parentVid,
      parentVariantId: parentVid,
      product_id: parentVid,
      productId: parentVid,
      child_variant_id: childVid,
      childVariantId: childVid,
      material_variant_id: childVid,
      materialVariantId: childVid,
      quantity: Number(qty)
    });
    if (appState.currentProductDetail) {
      await getProductDetailAction(appState.currentProductDetail.product.id);
    }
    showToast('已成功新增 BOM 組成項目！');
    return bom;
  } catch (err) {
    console.error("Failed to add BOM item:", err);
    throw err;
  }
}

