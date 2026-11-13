// @ts-check
import { loadStorage, saveStorage, resolveMockActiveTenantId, nextMockUid } from '../mockStorage.js';
import { mockPartners } from '../partners/mocks.js';

export const defaultMockProducts = [
  { id: "prod_mock_1", tenant_id: "tnt_mock_1", name: "智能核心晶片 (AI Core Chip)", category: "resale", is_sellable: true, is_purchasable: true, created_at: Math.floor(Date.now() / 1000) - 86400 * 3 },
  { id: "prod_mock_2", tenant_id: "tnt_mock_1", name: "AI 伺服器機櫃 (AI Server Rack)", category: "manufactured", is_sellable: true, is_purchasable: false, created_at: Math.floor(Date.now() / 1000) - 86400 * 2 },
  { id: "prod_mock_3", tenant_id: "tnt_mock_1", name: "散熱鋁片 (Cooling Fin)", category: "raw_material", is_sellable: false, is_purchasable: true, created_at: Math.floor(Date.now() / 1000) - 86400 }
];

export let mockProducts = loadStorage('agent_erp_mock_products', defaultMockProducts);
if (!mockProducts || !Array.isArray(mockProducts)) {
  mockProducts = defaultMockProducts;
  saveStorage('agent_erp_mock_products', mockProducts);
}

export const defaultMockProductVariants = [
  { id: "var_mock_1", product_id: "prod_mock_1", sku: "CHIP-001", name: "標準", spec_attributes: {}, is_default: true, created_at: Math.floor(Date.now() / 1000) - 86400 * 3 },
  { id: "var_mock_2", product_id: "prod_mock_2", sku: "SRV-001", name: "標準", spec_attributes: {}, is_default: true, created_at: Math.floor(Date.now() / 1000) - 86400 * 2 },
  { id: "var_mock_3", product_id: "prod_mock_3", sku: "FIN-001", name: "標準", spec_attributes: {}, is_default: true, created_at: Math.floor(Date.now() / 1000) - 86400 }
];

export let mockProductVariants = loadStorage('agent_erp_mock_product_variants', defaultMockProductVariants);
if (!mockProductVariants || !Array.isArray(mockProductVariants)) {
  mockProductVariants = defaultMockProductVariants;
  saveStorage('agent_erp_mock_product_variants', mockProductVariants);
} else {
  mockProductVariants = mockProductVariants.map(v => ({
    ...v,
    spec_attributes: (v.spec_attributes && typeof v.spec_attributes === 'object' && !Array.isArray(v.spec_attributes)) ? v.spec_attributes : {}
  }));
}

export const defaultMockProductUnits = [
  { id: "unit_mock_1", variant_id: "var_mock_1", unit_name: "顆", conversion_ratio: 1.0, is_base_unit: true, selling_price: 120.0, sell_price: 120.0, created_at: Math.floor(Date.now() / 1000) - 86400 * 3 },
  { id: "unit_mock_2", variant_id: "var_mock_2", unit_name: "台", conversion_ratio: 1.0, is_base_unit: true, selling_price: 150000.0, sell_price: 150000.0, created_at: Math.floor(Date.now() / 1000) - 86400 * 2 },
  { id: "unit_mock_3", variant_id: "var_mock_3", unit_name: "片", conversion_ratio: 1.0, is_base_unit: true, selling_price: 15.0, sell_price: 15.0, created_at: Math.floor(Date.now() / 1000) - 86400 }
];

export let mockProductUnits = loadStorage('agent_erp_mock_product_units', defaultMockProductUnits);
if (!mockProductUnits || !Array.isArray(mockProductUnits)) {
  mockProductUnits = defaultMockProductUnits;
  saveStorage('agent_erp_mock_product_units', mockProductUnits);
} else {
  mockProductUnits = mockProductUnits.map(u => ({
    ...u,
    sell_price: u.sell_price !== undefined ? u.sell_price : u.selling_price,
    selling_price: u.selling_price !== undefined ? u.selling_price : (u.sell_price !== undefined ? u.sell_price : 0.0)
  }));
}

export let mockProductSupplySources = loadStorage('agent_erp_mock_product_supply_sources', []);
if (!mockProductSupplySources || !Array.isArray(mockProductSupplySources)) {
  mockProductSupplySources = [];
  saveStorage('agent_erp_mock_product_supply_sources', mockProductSupplySources);
}

export let mockProductBomItems = loadStorage('agent_erp_mock_product_bom_items', []);
if (!mockProductBomItems || !Array.isArray(mockProductBomItems)) {
  mockProductBomItems = [];
  saveStorage('agent_erp_mock_product_bom_items', mockProductBomItems);
}

export function resolveMockCategoryFlags(rawCategory) {
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

export function checkMockBomCycle(parentProdId, childProdId) {
  if (parentProdId === childProdId) return true;
  const visited = new Set();
  const queue = [childProdId];
  visited.add(childProdId);

  while (queue.length > 0) {
    const currPid = queue.shift();
    const currVarIds = new Set(
      mockProductVariants.filter(v => v.product_id === currPid).map(v => v.id)
    );

    const nextBomEdges = mockProductBomItems.filter(b =>
      b.product_id === currPid || currVarIds.has(b.parent_variant_id)
    );

    for (const edge of nextBomEdges) {
      const childVarId = edge.child_variant_id || edge.material_variant_id;
      const childVar = mockProductVariants.find(v => v.id === childVarId);
      if (childVar) {
        const nextChildProdId = childVar.product_id;
        if (nextChildProdId === parentProdId) {
          return true;
        }
        if (!visited.has(nextChildProdId)) {
          visited.add(nextChildProdId);
          queue.push(nextChildProdId);
        }
      }
    }
  }

  return false;
}

export const productMocks = {
  create_product: async (args) => {
    const { name, category, sku, unit_name, unitName, selling_price, sellingPrice } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    const trimmedName = (name || '').trim();
    if (!trimmedName) {
      throw new Error('商品名稱不能為空');
    }

    const { category: stdCategory, is_sellable, is_purchasable } = resolveMockCategoryFlags(category);

    const rawPrice = selling_price !== undefined ? selling_price : sellingPrice;
    const price = rawPrice !== undefined && rawPrice !== null ? Number(rawPrice) : 0.0;
    if (price < 0.0) {
      throw new Error('售價不能為負數');
    }

    const existing = mockProducts.find(p =>
      (p.tenant_id || 'tnt_mock_1') === targetTenantId &&
      p.name.trim().toLowerCase() === trimmedName.toLowerCase()
    );
    if (existing) {
      throw new Error(`商品「${trimmedName}」已存在，請使用不同名稱`);
    }

    const now = Math.floor(Date.now() / 1000);
    const prodId = nextMockUid('prod');
    const newProduct = {
      id: prodId,
      tenant_id: targetTenantId,
      name: trimmedName,
      category: stdCategory,
      is_sellable,
      is_purchasable,
      created_at: now
    };
    mockProducts.push(newProduct);
    saveStorage('agent_erp_mock_products', mockProducts);

    // Auto-create default variant
    const varId = nextMockUid('var');
    const trimmedSku = sku && String(sku).trim() ? String(sku).trim() : null;
    const defaultVariant = {
      id: varId,
      product_id: prodId,
      sku: trimmedSku,
      name: '標準',
      spec_attributes: {},
      is_default: true,
      created_at: now
    };
    mockProductVariants.push(defaultVariant);
    saveStorage('agent_erp_mock_product_variants', mockProductVariants);

    // Auto-create base unit
    const cleanUnitName = (unit_name || unitName || '').trim() || '個';
    const unitId = nextMockUid('unit');
    const baseUnit = {
      id: unitId,
      variant_id: varId,
      unit_name: cleanUnitName,
      conversion_ratio: 1.0,
      is_base_unit: true,
      selling_price: price,
      sell_price: price,
      created_at: now
    };
    mockProductUnits.push(baseUnit);
    saveStorage('agent_erp_mock_product_units', mockProductUnits);

    return {
      product: newProduct,
      variants: [defaultVariant],
      units: [baseUnit],
      supply_sources: [],
      bom_items: []
    };
  },

  list_product: async (args) => {
    return productMocks.list_products(args);
  },

  list_products: async (args) => {
    const { filter_category, filterCategory, filter_sellable, filterSellable, filter_purchasable, filterPurchasable } = args || {};
    const targetTenantId = resolveMockActiveTenantId();
    let list = mockProducts.filter(p => (p.tenant_id || 'tnt_mock_1') === targetTenantId);

    const catFilter = filter_category || filterCategory;
    if (catFilter && String(catFilter).trim()) {
      const catNorm = String(catFilter).trim().toLowerCase();
      list = list.filter(p => p.category.toLowerCase() === catNorm);
    }

    const sellFilter = filter_sellable !== undefined ? filter_sellable : filterSellable;
    if (sellFilter !== undefined) {
      list = list.filter(p => p.is_sellable === !!sellFilter);
    }

    const purchFilter = filter_purchasable !== undefined ? filter_purchasable : filterPurchasable;
    if (purchFilter !== undefined) {
      list = list.filter(p => p.is_purchasable === !!purchFilter);
    }

    return list.sort((a, b) => a.created_at - b.created_at);
  },

  get_product_detail: async (args) => {
    const { product_id, productId, id } = args || {};
    const targetId = product_id || productId || id;
    const targetTenantId = resolveMockActiveTenantId();

    const product = mockProducts.find(p => (p.tenant_id || 'tnt_mock_1') === targetTenantId && p.id === targetId);
    if (!product) {
      throw new Error('Product not found');
    }

    const variants = mockProductVariants.filter(v => v.product_id === product.id);
    const variantIds = new Set(variants.map(v => v.id));

    const units = mockProductUnits.filter(u => variantIds.has(u.variant_id));
    const unitIds = new Set(units.map(u => u.id));
    const supply_sources = mockProductSupplySources
      .filter(s => unitIds.has(s.unit_id))
      .map(s => ({
        ...s,
        cost: s.cost !== undefined ? s.cost : s.purchase_cost
      }));
    const bom_items = mockProductBomItems
      .filter(b => b.product_id === product.id || variantIds.has(b.parent_variant_id))
      .map(b => {
        const childVar = mockProductVariants.find(v => v.id === (b.child_variant_id || b.material_variant_id));
        const childProd = childVar ? mockProducts.find(p => p.id === childVar.product_id) : null;
        return {
          ...b,
          product_id: b.product_id || product.id,
          material_variant_id: b.material_variant_id || b.child_variant_id,
          child_product_name: b.child_product_name || (childProd ? childProd.name : null),
          child_variant_name: b.child_variant_name || (childVar ? childVar.name : null),
          child_sku: b.child_sku || (childVar ? childVar.sku : null)
        };
      });

    return {
      product,
      variants,
      units,
      supply_sources,
      bom_items
    };
  },

  add_product_variant: async (args) => {
    const { product_id, productId, name, sku, spec_attributes, specAttributes } = args || {};
    const targetProdId = product_id || productId;
    const targetTenantId = resolveMockActiveTenantId();
    let trimmedName = (name || '').trim();

    const product = mockProducts.find(p => (p.tenant_id || 'tnt_mock_1') === targetTenantId && p.id === targetProdId);
    if (!product) {
      throw new Error('Product not found');
    }

    let cleanSpec = spec_attributes !== undefined ? spec_attributes : specAttributes;
    if (cleanSpec === undefined || cleanSpec === null) {
      cleanSpec = {};
    } else if (typeof cleanSpec === 'string') {
      try {
        cleanSpec = JSON.parse(cleanSpec);
      } catch (_) {
        throw new Error('規格屬性必須為 JSON 物件格式');
      }
    }
    if (typeof cleanSpec !== 'object' || Array.isArray(cleanSpec) || cleanSpec === null) {
      throw new Error('規格屬性必須為 JSON 物件格式');
    }

    if (!trimmedName) {
      const values = Object.values(cleanSpec).filter(v => v !== undefined && v !== null && String(v).trim());
      if (values.length > 0) {
        trimmedName = values.map(v => String(v).trim()).join(' / ');
      } else {
        throw new Error('變體名稱不能為空');
      }
    }

    const exists = mockProductVariants.some(v => v.product_id === product.id && v.name.trim().toLowerCase() === trimmedName.toLowerCase());
    if (exists) {
      throw new Error(`變體「${trimmedName}」已存在`);
    }

    const now = Math.floor(Date.now() / 1000);
    const newVariant = {
      id: nextMockUid('var'),
      product_id: product.id,
      sku: sku && String(sku).trim() ? String(sku).trim() : null,
      name: trimmedName,
      spec_attributes: cleanSpec,
      is_default: false,
      created_at: now
    };
    mockProductVariants.push(newVariant);
    saveStorage('agent_erp_mock_product_variants', mockProductVariants);

    // Auto-create base unit for new variant
    const defaultVar = mockProductVariants.find(v => v.product_id === product.id && v.is_default);
    const defaultUnit = defaultVar ? mockProductUnits.find(u => u.variant_id === defaultVar.id && u.is_base_unit) : null;
    const baseUnitName = defaultUnit ? defaultUnit.unit_name : '個';
    const baseUnitPrice = defaultUnit ? (defaultUnit.selling_price || defaultUnit.sell_price || 0.0) : 0.0;

    const newBaseUnit = {
      id: nextMockUid('unit'),
      variant_id: newVariant.id,
      unit_name: baseUnitName,
      conversion_ratio: 1.0,
      is_base_unit: true,
      selling_price: baseUnitPrice,
      sell_price: baseUnitPrice,
      created_at: now
    };
    mockProductUnits.push(newBaseUnit);
    saveStorage('agent_erp_mock_product_units', mockProductUnits);

    return newVariant;
  },

  update_product_variant: async (args) => {
    const { variant_id, variantId, id, name, sku, spec_attributes, specAttributes } = args || {};
    const targetVarId = variant_id || variantId || id;
    const targetTenantId = resolveMockActiveTenantId();

    if (!targetVarId) {
      throw new Error('Variant not found');
    }

    const variantIndex = mockProductVariants.findIndex(v => v.id === targetVarId);
    if (variantIndex === -1) {
      throw new Error('Variant not found');
    }
    const variant = mockProductVariants[variantIndex];

    const product = mockProducts.find(p => p.id === variant.product_id && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!product) {
      throw new Error('Variant not found');
    }

    let newName = variant.name;

    if (name !== undefined) {
      const tr = String(name).trim();
      if (!tr) {
        throw new Error('變體名稱不能為空');
      }
      newName = tr;
    }

    const duplicate = mockProductVariants.some(v => v.product_id === variant.product_id && v.id !== variant.id && v.name.trim().toLowerCase() === newName.toLowerCase());
    if (duplicate) {
      throw new Error(`變體名稱「${newName}」已存在`);
    }

    let newSku = variant.sku;
    if (sku !== undefined) {
      const trSku = sku && String(sku).trim() ? String(sku).trim() : null;
      newSku = trSku;
    }

    let newSpec = variant.spec_attributes || {};
    const inputSpec = spec_attributes !== undefined ? spec_attributes : specAttributes;
    if (inputSpec !== undefined) {
      let parsedSpec = inputSpec;
      if (typeof parsedSpec === 'string') {
        try {
          parsedSpec = JSON.parse(parsedSpec);
        } catch (_) {
          throw new Error('規格屬性必須為 JSON 物件格式');
        }
      }
      if (typeof parsedSpec !== 'object' || Array.isArray(parsedSpec) || parsedSpec === null) {
        throw new Error('規格屬性必須為 JSON 物件格式');
      }
      newSpec = parsedSpec;
    }

    const updatedVariant = {
      ...variant,
      name: newName,
      sku: newSku,
      spec_attributes: newSpec
    };

    mockProductVariants[variantIndex] = updatedVariant;
    saveStorage('agent_erp_mock_product_variants', mockProductVariants);
    return updatedVariant;
  },

  add_product_unit: async (args) => {
    const { variant_id, variantId, unit_name, unitName, conversion_ratio, conversionRatio, is_base_unit, isBaseUnit, selling_price, sellingPrice, sell_price, sellPrice } = args || {};
    const targetVarId = variant_id || variantId;
    const targetTenantId = resolveMockActiveTenantId();
    const trimmedUnit = (unit_name || unitName || '').trim();

    let variant = mockProductVariants.find(v => v.id === targetVarId);
    if (!variant) {
      variant = mockProductVariants.find(v => v.product_id === targetVarId && v.is_default);
    }
    if (!variant) {
      throw new Error('Product variant not found');
    }
    const product = mockProducts.find(p => p.id === variant.product_id && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!product) {
      throw new Error('Product variant not found');
    }

    if (!trimmedUnit) {
      throw new Error('單位名稱不能為空');
    }

    const exists = mockProductUnits.some(u => u.variant_id === variant.id && u.unit_name.trim().toLowerCase() === trimmedUnit.toLowerCase());
    if (exists) {
      throw new Error(`單位「${trimmedUnit}」已存在`);
    }

    const isBase = is_base_unit !== undefined ? !!is_base_unit : !!isBaseUnit;
    const rawRatio = conversion_ratio !== undefined ? conversion_ratio : conversionRatio;
    const ratio = isBase ? 1.0 : Number(rawRatio);
    if (isNaN(ratio) || ratio <= 0) {
      throw new Error('換算比例必須大於 0');
    }

    const rawPrice = selling_price !== undefined ? selling_price : (sellingPrice !== undefined ? sellingPrice : (sell_price !== undefined ? sell_price : sellPrice));
    const price = rawPrice !== undefined ? Number(rawPrice) : 0.0;
    if (isNaN(price) || price < 0) {
      throw new Error('售價不能為負數');
    }

    if (isBase) {
      mockProductUnits.forEach(u => {
        if (u.variant_id === variant.id) {
          u.is_base_unit = false;
        }
      });
    }

    const now = Math.floor(Date.now() / 1000);
    const newUnit = {
      id: nextMockUid('unit'),
      variant_id: variant.id,
      unit_name: trimmedUnit,
      conversion_ratio: ratio,
      is_base_unit: isBase,
      selling_price: price,
      sell_price: price,
      created_at: now
    };
    mockProductUnits.push(newUnit);
    saveStorage('agent_erp_mock_product_units', mockProductUnits);
    return newUnit;
  },

  update_product_unit: async (args) => {
    const { unit_id, unitId, id, unit_name, unitName, conversion_ratio, conversionRatio, is_base_unit, isBaseUnit, selling_price, sellingPrice, sell_price, sellPrice } = args || {};
    const targetUnitId = unit_id || unitId || id;
    const targetTenantId = resolveMockActiveTenantId();

    if (!targetUnitId) {
      throw new Error('Product unit not found');
    }

    const unit = mockProductUnits.find(u => u.id === targetUnitId);
    if (!unit) {
      throw new Error('Product unit not found');
    }

    const variant = mockProductVariants.find(v => v.id === unit.variant_id);
    if (!variant) {
      throw new Error('Product unit not found');
    }

    const product = mockProducts.find(p => p.id === variant.product_id && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!product) {
      throw new Error('Product unit not found');
    }

    const rawName = unit_name !== undefined ? unit_name : unitName;
    let effectiveName = unit.unit_name;
    if (rawName !== undefined) {
      const trimmed = String(rawName).trim();
      if (!trimmed) {
        throw new Error('單位名稱不能為空');
      }
      const duplicate = mockProductUnits.some(u => u.variant_id === variant.id && u.id !== unit.id && u.unit_name.trim().toLowerCase() === trimmed.toLowerCase());
      if (duplicate) {
        throw new Error(`單位「${trimmed}」已存在`);
      }
      effectiveName = trimmed;
    }

    const rawIsBase = is_base_unit !== undefined ? is_base_unit : isBaseUnit;
    const targetIsBase = rawIsBase !== undefined ? !!rawIsBase : unit.is_base_unit;

    if (unit.is_base_unit && !targetIsBase) {
      const otherBase = mockProductUnits.some(u => u.variant_id === variant.id && u.id !== unit.id && u.is_base_unit);
      if (!otherBase) {
        throw new Error('每個變體至少要有一個基準單位');
      }
    }

    const rawRatio = conversion_ratio !== undefined ? conversion_ratio : conversionRatio;
    let effectiveRatio = unit.conversion_ratio;
    if (targetIsBase) {
      if (rawRatio !== undefined && Number(rawRatio) !== 1.0) {
        throw new Error('基準單位換算比例必須為 1');
      }
      effectiveRatio = 1.0;
    } else if (rawRatio !== undefined) {
      const r = Number(rawRatio);
      if (isNaN(r) || r <= 0) {
        throw new Error('換算比例必須大於 0');
      }
      effectiveRatio = r;
    }

    const rawPrice = selling_price !== undefined ? selling_price : (sellingPrice !== undefined ? sellingPrice : (sell_price !== undefined ? sell_price : sellPrice));
    let effectivePrice = unit.selling_price;
    if (rawPrice !== undefined) {
      const p = Number(rawPrice);
      if (isNaN(p) || p < 0) {
        throw new Error('售價不能為負數');
      }
      effectivePrice = p;
    }

    if (targetIsBase && !unit.is_base_unit) {
      mockProductUnits.forEach(u => {
        if (u.variant_id === variant.id && u.id !== unit.id) {
          u.is_base_unit = false;
        }
      });
    }

    unit.unit_name = effectiveName;
    unit.conversion_ratio = effectiveRatio;
    unit.is_base_unit = targetIsBase;
    unit.selling_price = effectivePrice;
    unit.sell_price = effectivePrice;

    saveStorage('agent_erp_mock_product_units', mockProductUnits);
    return { ...unit };
  },

  add_supply_source: async (args) => {
    const { unit_id, unitId, variant_id, variantId, vendor_partner_id, vendorPartnerId, purchase_cost, purchaseCost, currency, is_primary, isPrimary } = args || {};
    const targetId = unit_id || unitId || variant_id || variantId;
    const targetVendorId = vendor_partner_id || vendorPartnerId;
    const targetTenantId = resolveMockActiveTenantId();

    let unit = mockProductUnits.find(u => u.id === targetId);
    if (!unit) {
      unit = mockProductUnits.find(u => u.variant_id === targetId && u.is_base_unit) ||
             mockProductUnits.find(u => u.variant_id === targetId);
    }
    if (!unit) {
      const fallbackVar = mockProductVariants.find(v => v.product_id === targetId && v.is_default) ||
                          mockProductVariants.find(v => v.product_id === targetId);
      if (fallbackVar) {
        unit = mockProductUnits.find(u => u.variant_id === fallbackVar.id && u.is_base_unit) ||
               mockProductUnits.find(u => u.variant_id === fallbackVar.id);
      }
    }
    if (!unit) {
      throw new Error('Product unit not found');
    }

    const variant = mockProductVariants.find(v => v.id === unit.variant_id);
    if (!variant) {
      throw new Error('Product unit not found');
    }
    const product = mockProducts.find(p => p.id === variant.product_id && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!product) {
      throw new Error('Product unit not found');
    }

    const vendor = mockPartners.find(p => p.id === targetVendorId && (p.tenant_id || 'tnt_mock_1') === targetTenantId && p.is_vendor === true);
    if (!vendor) {
      throw new Error('供應商不存在或無效');
    }

    const rawCost = purchase_cost !== undefined ? purchase_cost : (purchaseCost !== undefined ? purchaseCost : args?.cost);
    const cost = Number(rawCost);
    if (isNaN(cost) || cost < 0) {
      throw new Error('採購成本不能為負數');
    }

    const targetIsPrimary = is_primary !== undefined ? !!is_primary : !!isPrimary;
    if (targetIsPrimary) {
      mockProductSupplySources.forEach(s => {
        if (s.unit_id === unit.id) {
          s.is_primary = false;
        }
      });
    }

    const now = Math.floor(Date.now() / 1000);
    const newSource = {
      id: nextMockUid('src'),
      unit_id: unit.id,
      vendor_partner_id: vendor.id,
      purchase_cost: cost,
      cost: cost,
      currency: (currency || 'TWD').trim(),
      is_primary: targetIsPrimary,
      created_at: now
    };
    mockProductSupplySources.push(newSource);
    saveStorage('agent_erp_mock_product_supply_sources', mockProductSupplySources);
    return newSource;
  },

  update_supply_source: async (args) => {
    const {
      source_id,
      sourceId,
      id,
      purchase_cost,
      purchaseCost,
      cost: argCost,
      vendor_partner_id,
      vendorPartnerId,
      currency,
      is_primary,
      isPrimary
    } = args || {};

    const targetSourceId = (source_id || sourceId || id || '').trim();
    if (!targetSourceId) {
      throw new Error('供應來源 ID 不能為空');
    }

    const targetTenantId = resolveMockActiveTenantId();
    const source = mockProductSupplySources.find(s => s.id === targetSourceId);
    if (!source) {
      throw new Error('供應來源不存在');
    }

    const unit = mockProductUnits.find(u => u.id === source.unit_id);
    if (!unit) {
      throw new Error('供應來源不存在');
    }
    const variant = mockProductVariants.find(v => v.id === unit.variant_id);
    if (!variant) {
      throw new Error('供應來源不存在');
    }
    const product = mockProducts.find(p => p.id === variant.product_id && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!product) {
      throw new Error('供應來源不存在');
    }

    const rawCost = purchase_cost !== undefined ? purchase_cost : (purchaseCost !== undefined ? purchaseCost : argCost);
    if (rawCost !== undefined) {
      const costNum = Number(rawCost);
      if (isNaN(costNum) || costNum < 0) {
        throw new Error('採購成本不能為負數');
      }
      source.purchase_cost = costNum;
      source.cost = costNum;
    }

    const targetVendorId = vendor_partner_id !== undefined ? vendor_partner_id : vendorPartnerId;
    if (targetVendorId !== undefined) {
      const trimmedVendor = (targetVendorId || '').trim();
      if (!trimmedVendor) {
        throw new Error('供應商不存在或無效');
      }
      const vendor = mockPartners.find(p => p.id === trimmedVendor && (p.tenant_id || 'tnt_mock_1') === targetTenantId && p.is_vendor === true);
      if (!vendor) {
        throw new Error('供應商不存在或無效');
      }
      source.vendor_partner_id = vendor.id;
    }

    if (currency !== undefined) {
      const cur = (currency || '').trim();
      source.currency = cur || 'TWD';
    }

    const prim = is_primary !== undefined ? is_primary : isPrimary;
    if (prim !== undefined) {
      const targetIsPrimary = !!prim;
      if (targetIsPrimary) {
        mockProductSupplySources.forEach(s => {
          if (s.unit_id === source.unit_id && s.id !== source.id) {
            s.is_primary = false;
          }
        });
      }
      source.is_primary = targetIsPrimary;
    }

    saveStorage('agent_erp_mock_product_supply_sources', mockProductSupplySources);
    return { ...source };
  },

  add_bom_item: async (args) => {
    const {
      parent_variant_id, parentVariantId,
      child_variant_id, childVariantId,
      product_id, productId,
      material_variant_id, materialVariantId,
      quantity
    } = args || {};
    const targetParentVid = parent_variant_id || parentVariantId || product_id || productId;
    const targetChildVid = child_variant_id || childVariantId || material_variant_id || materialVariantId;
    const targetTenantId = resolveMockActiveTenantId();

    const qty = Number(quantity);
    if (isNaN(qty) || qty <= 0) {
      throw new Error('BOM 用量必須大於 0');
    }

    let parentVar = mockProductVariants.find(v => v.id === targetParentVid);
    if (!parentVar) {
      parentVar = mockProductVariants.find(v => v.product_id === targetParentVid && v.is_default) ||
                  mockProductVariants.find(v => v.product_id === targetParentVid);
    }
    if (!parentVar) {
      throw new Error('母規格變體不存在');
    }
    const parentProd = mockProducts.find(p => p.id === parentVar.product_id && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!parentProd) {
      throw new Error('母規格變體不存在');
    }
    const isParentManufactured = parentProd.category === 'manufactured' || parentProd.category === '自製成品' || parentProd.category === '自製';
    if (!isParentManufactured) {
      throw new Error('非自製成品不可建立 BOM 組成');
    }

    let childVar = mockProductVariants.find(v => v.id === targetChildVid);
    if (!childVar) {
      childVar = mockProductVariants.find(v =>
        (v.product_id === targetChildVid && v.is_default) ||
        (typeof targetChildVid === 'string' && targetChildVid.startsWith('var_') && targetChildVid.endsWith('_std') && v.product_id === targetChildVid.slice(4, -4)) ||
        v.product_id === targetChildVid
      );
    }
    if (!childVar) {
      throw new Error('子物料變體不存在或不屬於同一租戶');
    }
    const childProd = mockProducts.find(p => p.id === childVar.product_id && (p.tenant_id || 'tnt_mock_1') === targetTenantId);
    if (!childProd) {
      throw new Error('子物料變體不存在或不屬於同一租戶');
    }

    if (parentVar.id === childVar.id || parentProd.id === childProd.id) {
      throw new Error('BOM 子物料不能為自身');
    }

    if (checkMockBomCycle(parentProd.id, childProd.id)) {
      throw new Error('BOM 子物料不能形成循環引用');
    }

    const now = Math.floor(Date.now() / 1000);
    const newBom = {
      id: nextMockUid('bom'),
      parent_variant_id: parentVar.id,
      child_variant_id: childVar.id,
      product_id: parentProd.id,
      material_variant_id: childVar.id,
      quantity: qty,
      created_at: now,
      child_product_name: childProd.name,
      child_variant_name: childVar.name,
      child_sku: childVar.sku || null
    };
    mockProductBomItems.push(newBom);
    saveStorage('agent_erp_mock_product_bom_items', mockProductBomItems);
    return newBom;
  }
};

