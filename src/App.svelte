<script>
  import { onMount } from 'svelte';
  import { isTauri } from './lib/tauri.js';
  import { 
    appState, 
    fetchAuditLogs, 
    formatAuditDecision,
    checkForUpdates,
    installUpdate,
    navigate,
    checkAuthStatus,
    logoutAction,
    simulateTokenExpiry,
    fetchTasks,
    initMainChatGreeting,
    switchActiveTask,
    fetchMembers,
    onboardMemberAction,
    assignMemberRoleAction,
    assignMemberDepartmentsAction,
    getEffectiveSkills,
    computeSkillDiff,
    canManageMembers,
    fetchDepartments,
    createDepartmentAction,
    updateDepartmentSkillsAction,
    filterDeclaredSkills,
    getDeclaredSkills,
    getSkillsByDomain,
    KNOWN_DOMAINS,
    fetchPartners,
    createPartnerAction,
    updatePartnerAction,
    fetchProducts,
    createProductAction,
    getProductDetailAction,
    addProductVariantAction,
    updateProductVariantAction,
    addProductUnitAction,
    updateProductUnitAction,
    addSupplySourceAction,
    updateSupplySourceAction,
    addBomItemAction,
    fetchWarehouses,
    createWarehouseAction,
    updateWarehouseAction,
    setDefaultWarehouseAction,
    deactivateWarehouseAction,
    reactivateWarehouseAction
  } from './lib/store.svelte.js';
  import ChatBox from './lib/components/ChatBox.svelte';
  import TaskPanel from './lib/components/TaskPanel.svelte';
  import Breadcrumb from './lib/components/Breadcrumb.svelte';
  import StatusOverview from './lib/components/StatusOverview.svelte';
  import LoginScreen from './lib/components/auth/LoginScreen.svelte';
  import RegisterWizard from './lib/components/auth/RegisterWizard.svelte';
  import TenantPicker from './lib/components/auth/TenantPicker.svelte';
  import OnboardingScreen from './lib/components/auth/OnboardingScreen.svelte';
  import SettingsEntityCard from './lib/components/SettingsEntityCard.svelte';
  import PurchaseOrdersWorkspace from './lib/components/PurchaseOrdersWorkspace.svelte';
  import WarehouseWorkspace from './lib/components/WarehouseWorkspace.svelte';
  import CreateWarehouseModal from './lib/components/CreateWarehouseModal.svelte';

  let activeTab = $derived(appState.activeWorkspace);
  let isNotificationOpen = $state(false);
  let initializedKey = $state('');

  let newMemberName = $state('');
  let newMemberEmail = $state('');
  let newMemberRole = $state('member');
  let newMemberDepartmentIds = $state([]);
  let newMemberEffectiveSkills = $derived(getEffectiveSkills(newMemberDepartmentIds, appState.departments));
  let isAddingMember = $state(false);
  let memberError = $state('');

  let newDepartmentName = $state('');
  let newDepartmentParentId = $state('');
  let isAddingDepartment = $state(false);
  let departmentError = $state('');

  // Warehouse management state (Issue #179)
  let newWarehouseCode = $state('');
  let newWarehouseName = $state('');
  let isAddingWarehouse = $state(false);
  let warehouseError = $state('');
  let editingWarehouseId = $state(null);
  let editWarehouseCode = $state('');
  let editWarehouseName = $state('');
  let isSavingWarehouse = $state(false);

  // Customer / Partner / Vendor management state (Issue #117, #119)
  let newPartnerName = $state('');
  let newPartnerTaxId = $state('');
  let newPartnerRole = $state('customer'); // 'customer' | 'vendor' | 'both'
  let partnerFilter = $state('all'); // 'all' | 'customer' | 'vendor'
  let isAddingPartner = $state(false);
  let partnerError = $state('');
  let editingPartnerId = $state(null);
  let editingPartnerName = $state('');
  let editingPartnerTaxId = $state('');
  let isUpdatingPartner = $state(false);
  let editPartnerError = $state('');

  let filteredPartners = $derived(
    appState.partners.filter(p => {
      if (partnerFilter === 'customer') return p.is_customer;
      if (partnerFilter === 'vendor') return p.is_vendor;
      return true;
    })
  );

  // Product & Material Management state (Issue #137)
  let newProductName = $state('');
  let newProductCategory = $state('resale'); // 'resale' | 'manufactured' | 'raw_material'
  let newProductUnit = $state('件');
  let newProductPrice = $state(0);
  let isAddingProduct = $state(false);
  let productError = $state('');
  let productFilter = $state('all'); // 'all' | 'resale' | 'manufactured' | 'raw_material'
  let newProductBomSelections = $state({}); // { [candidateId]: { selected: boolean, quantity: number } }

  let purchasableCandidates = $derived(
    appState.products
  );

  let detailBomCandidates = $derived(
    expandedProductId
      ? appState.products.filter(p => p.id !== expandedProductId)
      : []
  );

  let filteredProducts = $derived(
    appState.products.filter(p => {
      if (productFilter === 'all') return true;
      return p.category === productFilter;
    })
  );

  let expandedProductId = $state(null);
  let expandedProductDetail = $state(null);
  let isLoadingProductDetail = $state(false);
  let productDetailTab = $state('variants'); // 'variants' | 'units' | 'sources' | 'bom'
  let productDetailError = $state('');

  // Sub-entity form states
  let newVariantName = $state('');
  let newVariantSku = $state('');
  let newVariantSpecPairs = $state([{ key: '', value: '' }]);
  let isAddingVariant = $state(false);

  // Edit variant states
  let editingVariantId = $state(null);
  let editVariantName = $state('');
  let editVariantSku = $state('');
  let editVariantSpecPairs = $state([]);
  let isUpdatingVariant = $state(false);

  let newUnitVariantId = $state('');
  let newUnitName = $state('');
  let newUnitRatio = $state(1);
  let newUnitPrice = $state(0);
  let newUnitIsBase = $state(false);
  let isAddingUnit = $state(false);

  // Edit unit states
  let editingUnitId = $state(null);
  let editUnitName = $state('');
  let editUnitRatio = $state(1);
  let editUnitPrice = $state(0);
  let editUnitIsBase = $state(false);
  let isUpdatingUnit = $state(false);

  let newSupplyUnitId = $state('');
  let newSupplyVendorId = $state('');
  let newSupplyCost = $state(0);
  let newSupplyCode = $state('');
  let isAddingSupply = $state(false);

  // Edit supply source states (Issue #141)
  let editingSupplySourceId = $state(null);
  let editSupplyVendorId = $state('');
  let editSupplyCost = $state(0);
  let editSupplyCurrency = $state('TWD');
  let editSupplyIsPrimary = $state(false);
  let isUpdatingSupply = $state(false);

  let newBomParentVariantId = $state('');
  let newBomChildVariantId = $state('');
  let newBomQuantity = $state(1);
  let newBomLossRate = $state(0);
  let isAddingBom = $state(false);

  let vendorPartners = $derived(
    appState.partners.filter(p => p.is_vendor)
  );

  // Department Skill management state (Issue #115)
  let activeSkillDeptId = $state(null);
  let skillSearchKeyword = $state('');
  let isUpdatingDeptSkill = $state(false);
  let deptSkillError = $state('');

  let effectiveSkillDeptId = $derived(
    activeSkillDeptId || (appState.departments.length > 0 ? appState.departments[0].id : null)
  );

  let currentSkillDept = $derived(
    appState.departments.find(d => d.id === effectiveSkillDeptId) || null
  );

  let allDeclaredSkills = $derived(getDeclaredSkills());
  let filteredDeclaredSkills = $derived(filterDeclaredSkills(allDeclaredSkills, skillSearchKeyword));

  let skillGroupsByDomain = $derived.by(() => {
    const map = new Map();
    // Pre-populate with known domains
    for (const kd of KNOWN_DOMAINS) {
      map.set(kd.id, {
        domain: kd.id,
        name: kd.name,
        description: kd.description,
        skills: []
      });
    }

    // Populate skills
    for (const sk of filteredDeclaredSkills) {
      const dom = sk.domain || 'other';
      if (!map.has(dom)) {
        map.set(dom, {
          domain: dom,
          name: dom,
          description: '',
          skills: []
        });
      }
      map.get(dom).skills.push(sk);
    }

    // Return groups that have at least one skill
    return Array.from(map.values()).filter(g => g.skills.length > 0);
  });

  async function handleToggleDepartmentSkill(deptId, skillId, isCurrentlyEnabled) {
    if (isUpdatingDeptSkill) return;
    if (!deptId || !skillId) return;
    const dept = appState.departments.find(d => d.id === deptId);
    if (!dept) return;

    isUpdatingDeptSkill = true;
    deptSkillError = '';

    const currentSkills = dept.skills || [];
    let nextSkills;
    if (isCurrentlyEnabled) {
      nextSkills = currentSkills.filter(s => s !== skillId);
    } else {
      nextSkills = [...currentSkills, skillId];
    }

    try {
      await updateDepartmentSkillsAction(deptId, nextSkills);
    } catch (err) {
      deptSkillError = err?.message || '更新部門 Skill 設定失敗';
    } finally {
      isUpdatingDeptSkill = false;
    }
  }

  // Existing member department editing state
  let editingMemberId = $state(null);
  let editingDepartmentIds = $state([]);
  let isSavingMemberDepartments = $state(false);
  let editingMemberDeptError = $state('');

  function toggleNewMemberDepartment(deptId) {
    if (newMemberDepartmentIds.includes(deptId)) {
      newMemberDepartmentIds = newMemberDepartmentIds.filter(id => id !== deptId);
    } else {
      newMemberDepartmentIds = [...newMemberDepartmentIds, deptId];
    }
  }

  function startEditingMemberDepartments(member) {
    editingMemberId = member.user_id || member.id;
    editingDepartmentIds = [...(member.department_ids || [])];
    editingMemberDeptError = '';
  }

  function cancelEditingMemberDepartments() {
    editingMemberId = null;
    editingDepartmentIds = [];
    editingMemberDeptError = '';
  }

  function toggleEditingDepartment(deptId) {
    if (editingDepartmentIds.includes(deptId)) {
      editingDepartmentIds = editingDepartmentIds.filter(id => id !== deptId);
    } else {
      editingDepartmentIds = [...editingDepartmentIds, deptId];
    }
  }

  async function handleSaveMemberDepartments(userId) {
    isSavingMemberDepartments = true;
    editingMemberDeptError = '';
    try {
      await assignMemberDepartmentsAction(userId, editingDepartmentIds);
      editingMemberId = null;
      editingDepartmentIds = [];
    } catch (err) {
      editingMemberDeptError = err?.message || '更新成員部門失敗';
    } finally {
      isSavingMemberDepartments = false;
    }
  }

  function getDepartmentNames(deptIds) {
    if (!deptIds || deptIds.length === 0) return [];
    return deptIds
      .map(id => {
        const d = appState.departments.find(dep => dep.id === id);
        return d ? d.name : id;
      })
      .filter(Boolean);
  }

  async function handleOnboardMember(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (!newMemberName.trim() || !newMemberEmail.trim()) {
      memberError = '請填寫姓名與電子郵件';
      return;
    }
    isAddingMember = true;
    memberError = '';
    try {
      await onboardMemberAction({
        name: newMemberName.trim(),
        email: newMemberEmail.trim(),
        role: newMemberRole,
        department_ids: newMemberDepartmentIds
      });
      newMemberName = '';
      newMemberEmail = '';
      newMemberRole = 'member';
      newMemberDepartmentIds = [];
    } catch (err) {
      memberError = err?.message || '新增成員失敗';
    } finally {
      isAddingMember = false;
    }
  }

  async function handleRoleChange(userId, newRole) {
    try {
      await assignMemberRoleAction(userId, newRole);
    } catch (err) {
      console.error("Failed to assign role:", err);
    }
  }

  async function handleCreateDepartment(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (!newDepartmentName.trim()) {
      departmentError = '請填寫部門名稱';
      return;
    }
    isAddingDepartment = true;
    departmentError = '';
    try {
      await createDepartmentAction(
        newDepartmentName.trim(),
        newDepartmentParentId ? newDepartmentParentId.trim() : null
      );
      newDepartmentName = '';
      newDepartmentParentId = '';
    } catch (err) {
      departmentError = err?.message || '新增部門失敗';
    } finally {
      isAddingDepartment = false;
    }
  }

  async function handleCreatePartner(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (!newPartnerName.trim()) {
      partnerError = '請填寫夥伴／廠商名稱';
      return;
    }
    isAddingPartner = true;
    partnerError = '';
    try {
      const isCustomer = newPartnerRole === 'customer' || newPartnerRole === 'both';
      const isVendor = newPartnerRole === 'vendor' || newPartnerRole === 'both';
      await createPartnerAction({
        name: newPartnerName.trim(),
        taxId: newPartnerTaxId.trim() || null,
        isCustomer,
        isVendor
      });
      newPartnerName = '';
      newPartnerTaxId = '';
    } catch (err) {
      partnerError = err?.message || '新增夥伴失敗';
    } finally {
      isAddingPartner = false;
    }
  }

  function startEditPartner(partner, focusTaxId = false) {
    editingPartnerId = partner.id;
    editingPartnerName = partner.name || '';
    editingPartnerTaxId = partner.tax_id || '';
    editPartnerError = '';
  }

  function cancelEditPartner() {
    editingPartnerId = null;
    editingPartnerName = '';
    editingPartnerTaxId = '';
    editPartnerError = '';
  }

  async function handleUpdatePartner(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (!editingPartnerName.trim()) {
      editPartnerError = '請填寫夥伴名稱';
      return;
    }
    const trimmedTax = editingPartnerTaxId.trim();
    if (trimmedTax && !/^\d{8}$/.test(trimmedTax)) {
      editPartnerError = '統一編號必須為 8 碼半形數字';
      return;
    }
    isUpdatingPartner = true;
    editPartnerError = '';
    try {
      await updatePartnerAction({
        id: editingPartnerId,
        name: editingPartnerName.trim(),
        taxId: trimmedTax || ''
      });
      cancelEditPartner();
    } catch (err) {
      editPartnerError = err?.message || '更新夥伴失敗';
    } finally {
      isUpdatingPartner = false;
    }
  }

  async function handleCreateProduct(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (!newProductName.trim()) {
      productError = '請填寫商品名稱';
      return;
    }
    isAddingProduct = true;
    productError = '';
    try {
      const initialBomItems = newProductCategory === 'manufactured'
        ? Object.entries(newProductBomSelections)
            .filter(([_, item]) => item && item.selected && Number(item.quantity) > 0)
            .map(([materialVariantId, item]) => ({
              materialVariantId,
              quantity: Number(item.quantity)
            }))
        : [];

      await createProductAction({
        name: newProductName.trim(),
        category: newProductCategory,
        baseUnit: newProductUnit.trim() || '件',
        sellingPrice: Number(newProductPrice) || 0,
        initialBomItems
      });
      newProductName = '';
      newProductUnit = '件';
      newProductPrice = 0;
      newProductBomSelections = {};
    } catch (err) {
      productError = typeof err === 'string' ? err : (err?.message || '新增商品失敗');
      await fetchProducts();
    } finally {
      isAddingProduct = false;
    }
  }

  async function handleToggleProductDetail(productId) {
    if (expandedProductId === productId) {
      expandedProductId = null;
      expandedProductDetail = null;
      productDetailError = '';
      return;
    }
    expandedProductId = productId;
    isLoadingProductDetail = true;
    productDetailError = '';
    try {
      expandedProductDetail = await getProductDetailAction(productId);
      if (expandedProductDetail?.variants?.length > 0) {
        newUnitVariantId = expandedProductDetail.variants[0].id;
        newBomParentVariantId = expandedProductDetail.variants[0].id;
      }
      if (expandedProductDetail?.units?.length > 0) {
        newSupplyUnitId = expandedProductDetail.units[0].id;
      } else {
        newSupplyUnitId = '';
      }
    } catch (err) {
      productDetailError = (typeof err === 'string' ? err : err?.message) || '載入商品明細失敗';
    } finally {
      isLoadingProductDetail = false;
    }
  }

  function addSpecPair() {
    newVariantSpecPairs = [...newVariantSpecPairs, { key: '', value: '' }];
  }

  function removeSpecPair(index) {
    newVariantSpecPairs = newVariantSpecPairs.filter((_, i) => i !== index);
  }

  function addEditSpecPair() {
    editVariantSpecPairs = [...editVariantSpecPairs, { key: '', value: '' }];
  }

  function removeEditSpecPair(index) {
    editVariantSpecPairs = editVariantSpecPairs.filter((_, i) => i !== index);
  }

  function startEditVariant(variant) {
    editingVariantId = variant.id;
    editVariantName = variant.name || '';
    editVariantSku = variant.sku || '';
    const specs = variant.spec_attributes || {};
    const pairs = Object.entries(specs).map(([key, value]) => ({ key, value: String(value) }));
    editVariantSpecPairs = pairs.length > 0 ? pairs : [{ key: '', value: '' }];
    productDetailError = '';
  }

  function cancelEditVariant() {
    editingVariantId = null;
    editVariantName = '';
    editVariantSku = '';
    editVariantSpecPairs = [];
    productDetailError = '';
  }

  async function handleAddVariant(productId) {
    const specAttrs = {};
    for (const pair of newVariantSpecPairs) {
      const k = (pair.key || '').trim();
      const v = (pair.value || '').trim();
      if (k && v) {
        specAttrs[k] = v;
      }
    }
    const nameToSubmit = newVariantName.trim();
    if (!nameToSubmit && Object.keys(specAttrs).length === 0) {
      productDetailError = '請輸入規格名稱或設定規格軸屬性';
      return;
    }
    isAddingVariant = true;
    productDetailError = '';
    try {
      await addProductVariantAction(productId, nameToSubmit, newVariantSku.trim() || undefined, specAttrs);
      newVariantName = '';
      newVariantSku = '';
      newVariantSpecPairs = [{ key: '', value: '' }];
      expandedProductDetail = await getProductDetailAction(productId);
    } catch (err) {
      productDetailError = err?.message || '新增規格失敗';
    } finally {
      isAddingVariant = false;
    }
  }

  async function handleUpdateVariant(productId) {
    if (!editingVariantId) return;
    const specAttrs = {};
    for (const pair of editVariantSpecPairs) {
      const k = (pair.key || '').trim();
      const v = (pair.value || '').trim();
      if (k && v) {
        specAttrs[k] = v;
      }
    }
    const nameToSubmit = editVariantName.trim();
    if (!nameToSubmit && Object.keys(specAttrs).length === 0) {
      productDetailError = '變體名稱不能為空';
      return;
    }
    isUpdatingVariant = true;
    productDetailError = '';
    try {
      await updateProductVariantAction(editingVariantId, {
        name: nameToSubmit || undefined,
        sku: editVariantSku.trim() || null,
        spec_attributes: specAttrs,
        productId
      });
      cancelEditVariant();
      expandedProductDetail = await getProductDetailAction(productId);
    } catch (err) {
      productDetailError = err?.message || '更新規格變體失敗';
    } finally {
      isUpdatingVariant = false;
    }
  }

  function startEditUnit(unit) {
    editingUnitId = unit.id;
    editUnitName = unit.unit_name || '';
    editUnitRatio = unit.conversion_ratio || 1;
    editUnitPrice = unit.selling_price || unit.sell_price || 0;
    editUnitIsBase = !!unit.is_base_unit;
    productDetailError = '';
  }

  function cancelEditUnit() {
    editingUnitId = null;
    editUnitName = '';
    editUnitRatio = 1;
    editUnitPrice = 0;
    editUnitIsBase = false;
    productDetailError = '';
  }

  async function handleUpdateUnit(productId) {
    if (!editingUnitId) return;
    const name = editUnitName.trim();
    if (!name) {
      productDetailError = '單位名稱不能為空';
      return;
    }
    const ratio = editUnitIsBase ? 1.0 : Number(editUnitRatio);
    if (isNaN(ratio) || ratio <= 0) {
      productDetailError = '換算比例必須大於 0';
      return;
    }
    const price = Number(editUnitPrice);
    if (isNaN(price) || price < 0) {
      productDetailError = '售價不能為負數';
      return;
    }
    isUpdatingUnit = true;
    productDetailError = '';
    try {
      await updateProductUnitAction(editingUnitId, {
        unit_name: name,
        conversion_ratio: ratio,
        is_base_unit: editUnitIsBase,
        selling_price: price,
        productId
      });
      cancelEditUnit();
      expandedProductDetail = await getProductDetailAction(productId);
    } catch (err) {
      productDetailError = err?.message || '更新包裝單位失敗';
    } finally {
      isUpdatingUnit = false;
    }
  }

  async function handleAddUnit(productId) {
    if (!newUnitName.trim()) {
      productDetailError = '請輸入包裝單位名稱';
      return;
    }
    if (!newUnitRatio || Number(newUnitRatio) <= 0) {
      productDetailError = '換算比例必須大於 0';
      return;
    }
    isAddingUnit = true;
    productDetailError = '';
    try {
      const variantId = newUnitVariantId || expandedProductDetail?.variants?.[0]?.id;
      if (!variantId) {
        throw new Error('找不到可綁定的規格變體');
      }
      await addProductUnitAction(
        variantId,
        newUnitName.trim(),
        newUnitIsBase ? 1.0 : Number(newUnitRatio),
        newUnitIsBase,
        Number(newUnitPrice) || 0
      );
      newUnitName = '';
      newUnitRatio = 1;
      newUnitPrice = 0;
      newUnitIsBase = false;
      expandedProductDetail = await getProductDetailAction(productId);
    } catch (err) {
      productDetailError = err?.message || '新增包裝單位失敗';
    } finally {
      isAddingUnit = false;
    }
  }

  async function handleAddSupplySource(productId) {
    if (!newSupplyVendorId) {
      productDetailError = '請選擇供應商';
      return;
    }
    isAddingSupply = true;
    productDetailError = '';
    try {
      const unitId = newSupplyUnitId || expandedProductDetail?.units?.[0]?.id;
      if (!unitId) {
        throw new Error('找不到可綁定的銷售單位');
      }
      await addSupplySourceAction(
        unitId,
        newSupplyVendorId,
        Number(newSupplyCost) || 0,
        'TWD',
        false
      );
      newSupplyCost = 0;
      newSupplyCode = '';
      expandedProductDetail = await getProductDetailAction(productId);
    } catch (err) {
      productDetailError = (typeof err === 'string' ? err : err?.message) || '新增採購來源失敗';
    } finally {
      isAddingSupply = false;
    }
  }

  function startEditSupplySource(source) {
    editingSupplySourceId = source.id;
    editSupplyVendorId = source.vendor_partner_id;
    editSupplyCost = source.purchase_cost !== undefined ? source.purchase_cost : (source.cost !== undefined ? source.cost : 0);
    editSupplyCurrency = source.currency || 'TWD';
    editSupplyIsPrimary = !!source.is_primary;
    productDetailError = '';
  }

  function cancelEditSupplySource() {
    editingSupplySourceId = null;
    editSupplyVendorId = '';
    editSupplyCost = 0;
    editSupplyCurrency = 'TWD';
    editSupplyIsPrimary = false;
    productDetailError = '';
  }

  async function handleUpdateSupplySource(productId) {
    if (!editingSupplySourceId) return;
    if (!editSupplyVendorId) {
      productDetailError = '請選擇供應商';
      return;
    }
    if (Number(editSupplyCost) < 0) {
      productDetailError = '採購成本不能為負數';
      return;
    }

    isUpdatingSupply = true;
    productDetailError = '';
    try {
      await updateSupplySourceAction(editingSupplySourceId, {
        vendor_partner_id: editSupplyVendorId,
        purchase_cost: Number(editSupplyCost) || 0,
        currency: editSupplyCurrency,
        is_primary: editSupplyIsPrimary
      });
      cancelEditSupplySource();
      expandedProductDetail = await getProductDetailAction(productId);
    } catch (err) {
      productDetailError = err?.message || '更新供應來源失敗';
    } finally {
      isUpdatingSupply = false;
    }
  }

  async function handleAddBomItem(productId) {
    if (!newBomChildVariantId) {
      productDetailError = '請選擇或輸入子物料規格 ID';
      return;
    }
    if (!newBomQuantity || Number(newBomQuantity) <= 0) {
      productDetailError = 'BOM 用量必須大於 0';
      return;
    }
    isAddingBom = true;
    productDetailError = '';
    try {
      const parentVariantId = newBomParentVariantId || expandedProductDetail?.variants?.[0]?.id;
      if (!parentVariantId) {
        throw new Error('找不到母規格變體');
      }
      await addBomItemAction(
        parentVariantId,
        newBomChildVariantId,
        Number(newBomQuantity)
      );
      newBomChildVariantId = '';
      newBomQuantity = 1;
      newBomLossRate = 0;
      expandedProductDetail = await getProductDetailAction(productId);
    } catch (err) {
      productDetailError = (typeof err === 'string' ? err : err?.message) || '新增 BOM 組成失敗';
    } finally {
      isAddingBom = false;
    }
  }

  function getVendorName(vendorId) {
    const v = appState.partners.find(p => p.id === vendorId);
    return v ? v.name : vendorId;
  }

  function getChildMaterialDisplayName(b) {
    if (!b) return '未命名物料';
    if (b.child_product_name) {
      return b.child_product_name;
    }
    const found = appState.products.find(p => p.id === b.child_variant_id || (b.child_variant_id && b.child_variant_id.includes(p.id)));
    return found ? found.name : (b.child_variant_id || '未命名物料');
  }

  function getParentDepartmentName(parentId) {
    if (!parentId) return null;
    const parent = appState.departments.find(d => d.id === parentId);
    return parent ? parent.name : parentId;
  }

  // --- Warehouse Handlers (Issue #179) ---
  async function handleCreateWarehouse(e) {
    if (e && e.preventDefault) e.preventDefault();
    warehouseError = '';
    const code = newWarehouseCode.trim();
    const name = newWarehouseName.trim();
    if (!code) {
      warehouseError = '倉庫代碼為必填項目';
      return;
    }
    if (!name) {
      warehouseError = '倉庫名稱為必填項目';
      return;
    }
    isAddingWarehouse = true;
    try {
      await createWarehouseAction(code, name);
      newWarehouseCode = '';
      newWarehouseName = '';
    } catch (err) {
      warehouseError = err.message || '建立倉庫失敗';
    } finally {
      isAddingWarehouse = false;
    }
  }

  async function handleSetDefaultWarehouse(id) {
    warehouseError = '';
    try {
      await setDefaultWarehouseAction(id);
    } catch (err) {
      warehouseError = err.message || '設定預設倉失敗';
    }
  }

  async function handleDeactivateWarehouse(id) {
    warehouseError = '';
    try {
      await deactivateWarehouseAction(id);
    } catch (err) {
      warehouseError = err.message || '停用倉庫失敗';
    }
  }

  async function handleReactivateWarehouse(id) {
    warehouseError = '';
    try {
      await reactivateWarehouseAction(id);
    } catch (err) {
      warehouseError = err.message || '啟用倉庫失敗';
    }
  }

  function handleStartEditWarehouse(wh) {
    editingWarehouseId = wh.id;
    editWarehouseCode = wh.code;
    editWarehouseName = wh.name;
    warehouseError = '';
  }

  function handleCancelEditWarehouse() {
    editingWarehouseId = null;
    editWarehouseCode = '';
    editWarehouseName = '';
  }

  async function handleSaveEditWarehouse(id) {
    warehouseError = '';
    const code = editWarehouseCode.trim();
    const name = editWarehouseName.trim();
    if (!code) {
      warehouseError = '倉庫代碼為必填項目';
      return;
    }
    if (!name) {
      warehouseError = '倉庫名稱為必填項目';
      return;
    }
    isSavingWarehouse = true;
    try {
      await updateWarehouseAction(id, code, name);
      editingWarehouseId = null;
    } catch (err) {
      warehouseError = err.message || '更新倉庫失敗';
    } finally {
      isSavingWarehouse = false;
    }
  }

  async function initializeAppData(force = false) {
    const currentKey = `${appState.authUser?.id || ''}_${appState.activeTenant?.id || ''}`;
    if (!force && initializedKey === currentKey && currentKey !== '_') return;

    await fetchAuditLogs();
    await fetchTasks();
    await fetchPartners();
    await fetchDepartments();
    await fetchMembers();
    await fetchProducts();
    await fetchWarehouses();
    await initMainChatGreeting();
    initializedKey = currentKey;
  }

  // Initialize data on mount
  onMount(async () => {
    if (isTauri) {
      try {
        const { getVersion } = await import('@tauri-apps/api/app');
        appState.version = await getVersion();
      } catch (err) {
        console.warn("Failed to fetch version from Tauri:", err);
      }
    } else {
      appState.version = '0.1.0';
    }

    // Check auth status first
    const auth = await checkAuthStatus();

    if (auth.status === 'unauthenticated') {
      if (appState.route !== '/register') {
        navigate('/login');
      }
    } else if (auth.status === 'needs_tenant_creation') {
      navigate('/onboarding');
    } else if (auth.status === 'needs_tenant_selection') {
      navigate('/select-tenant');
    } else {
      // Authenticated
      if (appState.route === '/login' || appState.route === '/register') {
        navigate('/app/agent');
      }
      await initializeAppData();
    }

    // Hash router synchronization
    const handleHashChange = async () => {
      const hash = location.hash.slice(1);
      if (!hash) {
        if (appState.authStatus === 'authenticated') {
          navigate('/app/agent');
        } else {
          navigate('/login');
        }
      } else {
        if (appState.authStatus === 'unauthenticated' && hash !== '/register') {
          navigate('/login');
        } else {
          appState.route = hash;
          if (appState.authStatus === 'authenticated') {
            await initializeAppData();
          }
        }
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    // Initial sync
    await handleHashChange();

    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  });

  function selectWorkspace(ws) {
    if (ws === 'agent') navigate('/app/agent');
    else if (ws === 'settings') navigate('/app/settings');
    else if (ws === 'purchase-orders') navigate('/app/purchase-orders');
    else if (ws === 'warehouses' || ws === 'warehouse') navigate('/app/warehouses');
    else if (ws === 'inventory') navigate('/app/inventory');
    else navigate(`/app/${ws}`);
  }

  function handleBrandLogoClick() {
    switchActiveTask(null);
    selectWorkspace('agent');
  }
</script>

{#if appState.route === '/login'}
  <LoginScreen />
{:else if appState.route === '/register'}
  <RegisterWizard />
{:else if appState.route === '/onboarding'}
  <OnboardingScreen />
{:else if appState.route === '/select-tenant'}
  <TenantPicker />
{:else}
  <div class="app-shell">
    <div class="shell-body">
      <!-- 1. Left Sidebar Rail (64px) -->
      <aside class="sidebar-rail">
        <div class="rail-top">
          <button class="rail-brand-logo" onclick={handleBrandLogoClick} title="回到主 Agent 環境對話">
            A
          </button>

          <nav class="rail-nav">
            <!-- AI Agent Chat / 主助理 -->
            <button 
              class="rail-nav-btn {activeTab === 'agent' ? 'active' : ''}" 
              onclick={() => selectWorkspace('agent')}
              title="AI 助理對話"
              aria-label="AI 助理對話"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
              </svg>
            </button>

            <!-- 採購單 (Issue #165) -->
            <button 
              class="rail-nav-btn {activeTab === 'purchase-orders' ? 'active' : ''}" 
              onclick={() => selectWorkspace('purchase-orders')}
              title="採購單"
              aria-label="採購單"
              id="rail-nav-purchase-orders"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <path d="M16 10a4 4 0 0 1-8 0"></path>
              </svg>
            </button>

            <!-- 倉庫管理 (Issue #182) -->
            <button 
              class="rail-nav-btn {activeTab === 'warehouses' || activeTab === 'inventory' ? 'active' : ''}" 
              onclick={() => selectWorkspace('warehouses')}
              title="倉庫管理"
              aria-label="倉庫管理"
              id="rail-nav-warehouses"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                <polyline points="9 22 9 12 15 12 15 22"></polyline>
              </svg>
            </button>

            <!-- Settings icon -->
            <button 
              class="rail-nav-btn {activeTab === 'settings' ? 'active' : ''}" 
              onclick={() => selectWorkspace('settings')}
              title="設定與防禦管理"
              aria-label="設定與防禦管理"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
            </button>
          </nav>
        </div>

        <div class="rail-bottom">
          <!-- Notification Bell -->
          <button class="rail-notif-btn" onclick={() => isNotificationOpen = !isNotificationOpen} title="通知中心" aria-label="通知中心">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
            </svg>
            {#if appState.notifications.length > 0}
              <span class="rail-badge">{appState.notifications.length}</span>
            {/if}
          </button>
        </div>
      </aside>

      <!-- 2. Collapsible Task Panel -->
      <TaskPanel />

      <!-- 3. Central Area (Breadcrumb + Chat or Workspace) -->
      <div class="shell-workspace-area">
        <div class="agent-main-container">
          <Breadcrumb />

          {#if appState.updateAvailable}
            <div class="update-banner glass-panel">
              <div class="update-banner-header">
                <span class="badge badge-amber">系統更新可用</span>
                <h4>主程式發現新版本 (v0.2.0)</h4>
              </div>
              <p class="update-notes-preview">{appState.updateNotes}</p>
              
              <div class="update-action-row">
                {#if appState.updateStatus === 'idle'}
                  <button class="btn btn-primary" onclick={installUpdate}>
                    立刻下載並更新 (Download & Install)
                  </button>
                {:else if appState.updateStatus === 'downloading'}
                  <div class="update-progress-layout">
                    <span class="progress-percent">正在下載：{appState.updateProgress.percent}% ({(appState.updateProgress.downloaded / 1024 / 1024).toFixed(2)} MB / 2.34 MB)</span>
                    <div class="progress-bar-container">
                      <div class="progress-bar-fill" style="width: {appState.updateProgress.percent}%"></div>
                    </div>
                  </div>
                {:else if appState.updateStatus === 'finished'}
                  <div class="relaunch-status">
                    <span class="spinner-icon"></span>
                    <span>下載完成，正在重啟並套用主程式更新...</span>
                  </div>
                {/if}
              </div>
            </div>
          {/if}

          {#if activeTab === 'settings'}
            <!-- Settings Workspace View -->
            <div class="workspace-scrollable">
              <div class="settings-layout">


                <!-- SQLite Audit Trail -->
                <div class="settings-group glass-panel">
                  <h3>邊緣寫入攔截審計紀錄 (SQLite Audit Trail)</h3>
                  <p class="settings-desc">記錄每一次經由操作者實體點擊確認釋放的 database write 歷史。</p>
                  <div class="audit-list">
                    {#if appState.auditLogs.length === 0}
                      <div class="empty-audit">目前尚無寫入審計記錄。</div>
                    {:else}
                      {#each appState.auditLogs as log}
                        <div class="audit-item">
                          <div class="audit-meta">
                            <span class="audit-id font-bold">{log.id}</span>
                            <span class="audit-time">{new Date(log.timestamp * 1000).toLocaleString()}</span>
                          </div>
                          <div class="audit-body">
                            <span>指令：<span style="color: rgb(var(--accent-amber));">{log.action_type}</span></span>
                            <span>操作人：<span class="font-bold">{log.operator}</span></span>
                            <span>結果：
                              <span style={log.decision === 'approved' ? 'color: rgb(var(--accent-emerald));' : 'color: #EF4444;'}>
                                {formatAuditDecision(log.decision)}
                              </span>
                            </span>
                          </div>
                        </div>
                      {/each}
                    {/if}
                  </div>
                </div>

                <!-- Auth & Accounts -->
                <div class="settings-group glass-panel">
                  <h3>系統認證與帳戶 (System Authentication & Account)</h3>
                  <p class="settings-desc">管理目前本機工作站的認證階段。當前登入身分與租戶資訊如下：</p>
                  
                  <div class="settings-status-box" style="margin-top: 16px; padding: 12px; border-radius: 6px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color);">
                    <div style="margin-bottom: 8px;">
                      <span style="color: var(--text-muted); font-size: 0.85rem;">目前帳戶：</span>
                      <span style="color: var(--text-primary); font-weight: 600; font-size: 0.9rem;">
                        {#if appState.authUser}
                          {appState.authUser.display_name ? `${appState.authUser.display_name} (${appState.authUser.email})` : appState.authUser.email}
                        {:else}
                          未登入
                        {/if}
                      </span>
                    </div>
                    <div>
                      <span style="color: var(--text-muted); font-size: 0.85rem;">活動租戶：</span>
                      {#if appState.activeTenant}
                        <span class="badge badge-cyan">
                          {appState.activeTenant.name} ({appState.activeTenant.code})
                        </span>
                      {:else}
                        <span style="color: var(--text-muted); font-size: 0.85rem; font-style: italic;">未選取租戶</span>
                      {/if}
                    </div>
                  </div>
                  
                  <div style="display: flex; gap: 12px; margin-top: 16px;">
                    <button 
                      class="btn" 
                      style="border-color: rgba(239, 68, 68, 0.3); color: rgb(239, 68, 68); background: rgba(239, 68, 68, 0.05);"
                      onclick={logoutAction}
                    >
                      安全登出帳戶
                    </button>
                    <button 
                      class="btn" 
                      style="border-color: rgba(245, 158, 11, 0.3); color: rgb(245, 158, 11); background: rgba(245, 158, 11, 0.05);"
                      onclick={simulateTokenExpiry}
                    >
                      模擬 Token 過期
                    </button>
                  </div>
                </div>

                <!-- Member & Role Management (Admin/Owner only) -->
                {#if canManageMembers(appState.activeTenant)}
                <SettingsEntityCard
                  title="成員與角色管理 (Member & Role Management)"
                  description="管理當前租戶下的組織成員、權限角色與所屬部門（支援一人掛多部門與有效 Skill 聯集提權檢視）。"
                  onRefresh={fetchMembers}
                  refreshLabel="重新整理成員"
                  errorMessage={memberError}
                  isEmpty={appState.members.length === 0}
                  emptyMessage="目前尚無成員資料，請新增成員。"
                  listClass="member-list"
                  listStyle="display: flex; flex-direction: column; gap: 10px;"
                >
                  {#snippet form()}
                    <!-- Add Member Form -->
                  <form onsubmit={handleOnboardMember} class="member-add-form" style="display: flex; flex-direction: column; gap: 12px; padding: 14px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color); border-radius: var(--radius-sm); margin-bottom: 16px;">
                    <div style="display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end;">
                      <div style="flex: 1; min-width: 140px;">
                        <label for="member-name-input" style="display: block; font-size: 0.75rem; color: var(--text-muted); margin-bottom: 4px;">成員姓名</label>
                        <input 
                          id="member-name-input"
                          type="text" 
                          class="form-input" 
                          placeholder="例：王小明" 
                          bind:value={newMemberName}
                          style="width: 100%; padding: 7px 10px; font-size: 0.85rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);" 
                        />
                      </div>
                      <div style="flex: 1.5; min-width: 180px;">
                        <label for="member-email-input" style="display: block; font-size: 0.75rem; color: var(--text-muted); margin-bottom: 4px;">電子郵件</label>
                        <input 
                          id="member-email-input"
                          type="email" 
                          class="form-input" 
                          placeholder="例：user@company.com" 
                          bind:value={newMemberEmail}
                          style="width: 100%; padding: 7px 10px; font-size: 0.85rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);" 
                        />
                      </div>
                      <div style="width: 150px;">
                        <label for="member-role-select" style="display: block; font-size: 0.75rem; color: var(--text-muted); margin-bottom: 4px;">指派角色</label>
                        <select 
                          id="member-role-select"
                          bind:value={newMemberRole}
                          style="width: 100%; padding: 7px 8px; font-size: 0.85rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);"
                        >
                          <option value="member">Member (一般成員)</option>
                          <option value="admin">Admin (管理員)</option>
                          <option value="owner">Owner (擁有者)</option>
                        </select>
                      </div>
                      <button 
                        type="submit" 
                        class="btn btn-primary btn-sm" 
                        disabled={isAddingMember}
                        style="height: 35px; white-space: nowrap; padding: 0 16px;"
                      >
                        {#if isAddingMember}新增中...{:else}+ 新增成員{/if}
                      </button>
                    </div>

                    <!-- Department Multi-selection for new member -->
                    <div style="padding: 10px; background: rgba(0, 0, 0, 0.2); border-radius: 6px; border: 1px dashed var(--border-color);">
                      <div style="font-size: 0.78rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between;">
                        <span>指派所屬部門（可複選，非必填）：</span>
                        {#if appState.departments.length === 0}
                          <span style="font-size: 0.72rem; color: var(--text-muted);">尚未建立任何部門（可於下方部門管理設定）</span>
                        {/if}
                      </div>

                      {#if appState.departments.length > 0}
                        <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px;">
                          {#each appState.departments as dept (dept.id)}
                            {@const isSelected = newMemberDepartmentIds.includes(dept.id)}
                            <button 
                              type="button"
                              class="badge-chip"
                              onclick={() => toggleNewMemberDepartment(dept.id)}
                              style="cursor: pointer; padding: 4px 10px; border-radius: 14px; font-size: 0.78rem; border: 1px solid {isSelected ? 'rgba(var(--accent-cyan), 0.6)' : 'var(--border-color)'}; background: {isSelected ? 'rgba(var(--accent-cyan), 0.15)' : 'rgba(255, 255, 255, 0.03)'}; color: {isSelected ? 'rgb(var(--accent-cyan))' : 'var(--text-secondary)'}; display: flex; align-items: center; gap: 5px; transition: all 0.15s ease;"
                            >
                              <span>{isSelected ? '✓ ' : '+ '}{dept.name}</span>
                            </button>
                          {/each}
                        </div>
                      {/if}

                      <!-- Security / Effective Skill Union Preview -->
                      <div style="font-size: 0.75rem; background: rgba(255, 255, 255, 0.02); padding: 8px 10px; border-radius: 4px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px;">
                        <span style="color: var(--text-muted); font-weight: 500;">🛡️ 預期取得之有效 Skills（部門權限聯集）：</span>
                        {#if newMemberEffectiveSkills.length > 0}
                          <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                            {#each newMemberEffectiveSkills as skill}
                              <span class="badge badge-cyan" style="font-size: 0.7rem; padding: 2px 6px;">{skill}</span>
                            {/each}
                          </div>
                        {:else if newMemberDepartmentIds.length > 0}
                          <span style="color: var(--text-muted); font-style: italic;">（所選部門尚未設定 Skill，無法評估權限影響）</span>
                        {:else}
                          <span style="color: var(--text-muted); font-style: italic;">（未選擇部門）</span>
                        {/if}
                      </div>
                    </div>
                  </form>
                  {/snippet}
                      {#each appState.members as member (member.user_id || member.id)}
                        {@const isEditing = editingMemberId === (member.user_id || member.id)}
                        {@const memberDeptNames = getDepartmentNames(member.department_ids)}
                        {@const memberSkills = getEffectiveSkills(member.department_ids || [], appState.departments)}

                        <div class="member-item" style="display: flex; flex-direction: column; gap: 10px; padding: 14px; border-radius: 6px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color);">
                          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                            <div style="display: flex; align-items: center; gap: 12px;">
                              <div style="width: 38px; height: 38px; border-radius: 50%; background: rgba(var(--accent-cyan), 0.1); border: 1px solid rgba(var(--accent-cyan), 0.3); display: flex; align-items: center; justify-content: center; font-weight: 600; color: rgb(var(--accent-cyan)); font-size: 0.9rem;">
                                {(member.name || member.email || 'M').charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                  <span style="font-weight: 600; color: var(--text-primary); font-size: 0.95rem;">{member.name || member.email}</span>
                                  <span class="badge {member.role === 'owner' ? 'badge-amber' : member.role === 'admin' ? 'badge-cyan' : 'badge-slate'}" style="font-size: 0.72rem; text-transform: uppercase;">
                                    {member.role}
                                  </span>
                                </div>
                                <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">{member.email}</div>
                              </div>
                            </div>
                            
                            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                              <button 
                                type="button" 
                                class="btn btn-sm" 
                                onclick={() => isEditing ? cancelEditingMemberDepartments() : startEditingMemberDepartments(member)}
                                style="font-size: 0.78rem; padding: 4px 10px;"
                              >
                                {isEditing ? '收合部門編輯' : '編輯所屬部門'}
                              </button>

                              <div style="display: flex; align-items: center; gap: 6px;">
                                <span style="font-size: 0.8rem; color: var(--text-muted);">角色：</span>
                                <select 
                                  value={member.role} 
                                  onchange={(e) => handleRoleChange(member.user_id || member.id, e.target.value)}
                                  style="padding: 4px 8px; font-size: 0.82rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);"
                                >
                                  <option value="owner">Owner (擁有者)</option>
                                  <option value="admin">Admin (管理員)</option>
                                  <option value="member">Member (一般成員)</option>
                                </select>
                              </div>
                            </div>
                          </div>

                          <!-- Member Department and Skills display (when not editing) -->
                          <div style="display: flex; flex-wrap: wrap; gap: 16px; align-items: center; padding-top: 6px; border-top: 1px solid rgba(255, 255, 255, 0.05); font-size: 0.8rem;">
                            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                              <span style="color: var(--text-muted);">所屬部門：</span>
                              {#if memberDeptNames.length > 0}
                                {#each memberDeptNames as deptName}
                                  <span class="badge badge-slate" style="font-size: 0.72rem; padding: 2px 8px; background: rgba(255, 255, 255, 0.06); border: 1px solid var(--border-color);">{deptName}</span>
                                {/each}
                              {:else}
                                <span style="color: var(--text-muted); font-size: 0.75rem; font-style: italic;">（未指派部門）</span>
                              {/if}
                            </div>

                            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                              <span style="color: var(--text-muted);">有效 Skills 聯集：</span>
                              {#if memberSkills.length > 0}
                                {#each memberSkills as sk}
                                  <span class="badge badge-cyan" style="font-size: 0.7rem; padding: 1px 6px;">{sk}</span>
                                {/each}
                              {:else if (member.department_ids && member.department_ids.length > 0)}
                                <span style="color: var(--text-muted); font-size: 0.75rem; font-style: italic;">（部門尚未設定 Skill，無法評估權限）</span>
                              {:else}
                                <span style="color: var(--text-muted); font-size: 0.75rem; font-style: italic;">（未指派部門）</span>
                              {/if}
                            </div>
                          </div>

                          <!-- Inline Department Editor -->
                          {#if isEditing}
                            {@const skillDiff = computeSkillDiff(member.department_ids || [], editingDepartmentIds, appState.departments)}
                            <div style="margin-top: 6px; padding: 12px; background: rgba(0, 0, 0, 0.3); border-radius: 6px; border: 1px solid rgba(var(--accent-cyan), 0.3); display: flex; flex-direction: column; gap: 10px;">
                              <div style="font-size: 0.82rem; font-weight: 600; color: var(--text-primary); display: flex; justify-content: space-between; align-items: center;">
                                <span>編輯「{member.name || member.email}」所屬部門：</span>
                                <span style="font-size: 0.72rem; color: var(--text-muted);">點擊勾選或取消部門以調整權限</span>
                              </div>

                              {#if appState.departments.length > 0}
                                <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                                  {#each appState.departments as dept (dept.id)}
                                    {@const isSelected = editingDepartmentIds.includes(dept.id)}
                                    <button 
                                      type="button"
                                      class="badge-chip"
                                      onclick={() => toggleEditingDepartment(dept.id)}
                                      style="cursor: pointer; padding: 5px 12px; border-radius: 14px; font-size: 0.8rem; border: 1px solid {isSelected ? 'rgba(var(--accent-cyan), 0.8)' : 'var(--border-color)'}; background: {isSelected ? 'rgba(var(--accent-cyan), 0.2)' : 'rgba(255, 255, 255, 0.03)'}; color: {isSelected ? 'rgb(var(--accent-cyan))' : 'var(--text-secondary)'}; display: flex; align-items: center; gap: 6px; transition: all 0.15s ease;"
                                    >
                                      <span>{isSelected ? '✓ ' : '+ '}{dept.name}</span>
                                    </button>
                                  {/each}
                                </div>
                              {:else}
                                <div style="font-size: 0.78rem; color: var(--text-muted);">組織目前尚無任何部門資料。</div>
                              {/if}

                              <!-- Security & Privilege Impact Diff Box -->
                              <div style="font-size: 0.78rem; background: rgba(255, 255, 255, 0.03); padding: 10px; border-radius: 6px; border: 1px dashed var(--border-color); display: flex; flex-direction: column; gap: 6px;">
                                <div style="font-weight: 600; color: var(--text-secondary); display: flex; align-items: center; gap: 6px;">
                                  <span>🛡️ 資安與權限影響預覽 (Security Privilege Impact)：</span>
                                </div>

                                <div style="display: flex; flex-direction: column; gap: 4px;">
                                  {#if skillDiff.addedSkills.length > 0}
                                    <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                                      <span style="color: #10b981; font-weight: 600;">➕ 額外取得 Skill（提權）：</span>
                                      {#each skillDiff.addedSkills as sk}
                                        <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 0.72rem; padding: 2px 6px;">+{sk}</span>
                                      {/each}
                                    </div>
                                  {/if}

                                  {#if skillDiff.removedSkills.length > 0}
                                    <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                                      <span style="color: #ef4444; font-weight: 600;">➖ 將失去 Skill（降權）：</span>
                                      {#each skillDiff.removedSkills as sk}
                                        <span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); font-size: 0.72rem; padding: 2px 6px;">-{sk}</span>
                                      {/each}
                                    </div>
                                  {/if}

                                  {#if skillDiff.addedSkills.length === 0 && skillDiff.removedSkills.length === 0}
                                    <div style="color: var(--text-muted); font-style: italic;">
                                      {#if skillDiff.currentSkills.length === 0 && skillDiff.nextSkills.length === 0}
                                        {(editingDepartmentIds.length > 0 || (member.department_ids && member.department_ids.length > 0))
                                          ? '（部門尚未設定 Skill，無法評估權限影響）'
                                          : '（未指派任何部門）'}
                                      {:else}
                                        （本次調整未變動成員之有效 Skill 集合）
                                      {/if}
                                    </div>
                                  {/if}
                                </div>
                              </div>

                              {#if editingMemberDeptError}
                                <div style="color: #ef4444; font-size: 0.78rem;">{editingMemberDeptError}</div>
                              {/if}

                              <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px;">
                                <button 
                                  type="button" 
                                  class="btn btn-sm" 
                                  onclick={cancelEditingMemberDepartments}
                                  disabled={isSavingMemberDepartments}
                                >
                                  取消
                                </button>
                                <button 
                                  type="button" 
                                  class="btn btn-primary btn-sm" 
                                  onclick={() => handleSaveMemberDepartments(member.user_id || member.id)}
                                  disabled={isSavingMemberDepartments}
                                >
                                  {#if isSavingMemberDepartments}儲存中...{:else}儲存部門設定{/if}
                                </button>
                              </div>
                            </div>
                          {/if}
                        </div>
                      {/each}
                </SettingsEntityCard>
                {/if}

                <!-- Department Management (Admin/Owner only) -->
                {#if canManageMembers(appState.activeTenant)}
                <SettingsEntityCard
                  title="部門管理 (Department Management)"
                  description="管理當前組織架構與部門階層（支援上層部門 parent_id 關聯）。設定後將同步於組織治理與指派流程中。"
                  onRefresh={fetchDepartments}
                  refreshLabel="重新整理部門"
                  errorMessage={departmentError}
                  isEmpty={appState.departments.length === 0}
                  emptyMessage="目前尚無部門資料，請新增部門。"
                  listClass="department-list"
                  listStyle="display: flex; flex-direction: column; gap: 8px;"
                >
                  {#snippet form()}
                    <!-- Add Department Form -->
                  <form onsubmit={handleCreateDepartment} class="department-add-form" style="display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; padding: 14px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color); border-radius: var(--radius-sm); margin-bottom: 16px;">
                    <div style="flex: 1.5; min-width: 180px;">
                      <label for="dept-name-input" style="display: block; font-size: 0.75rem; color: var(--text-muted); margin-bottom: 4px;">部門名稱</label>
                      <input 
                        id="dept-name-input"
                        type="text" 
                        class="form-input" 
                        placeholder="例：研發部、行銷部、業務一部" 
                        bind:value={newDepartmentName}
                        style="width: 100%; padding: 7px 10px; font-size: 0.85rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);" 
                      />
                    </div>
                    <div style="flex: 1.5; min-width: 180px;">
                      <label for="dept-parent-select" style="display: block; font-size: 0.75rem; color: var(--text-muted); margin-bottom: 4px;">上層部門（可選）</label>
                      <select 
                        id="dept-parent-select"
                        bind:value={newDepartmentParentId}
                        style="width: 100%; padding: 7px 8px; font-size: 0.85rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);"
                      >
                        <option value="">無（頂層部門）</option>
                        {#each appState.departments as dept (dept.id)}
                          <option value={dept.id}>{dept.name}</option>
                        {/each}
                      </select>
                    </div>
                    <button 
                      type="submit" 
                      class="btn btn-primary btn-sm" 
                      disabled={isAddingDepartment}
                      style="height: 35px; white-space: nowrap; padding: 0 16px;"
                    >
                      {#if isAddingDepartment}新增中...{:else}+ 新增部門{/if}
                    </button>
                  </form>
                  {/snippet}
                      {#each appState.departments as dept (dept.id)}
                        {@const parentName = getParentDepartmentName(dept.parent_id)}
                        <div class="department-item" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; border-radius: 6px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color);">
                          <div style="display: flex; align-items: center; gap: 12px;">
                            <div style="width: 36px; height: 36px; border-radius: 8px; background: rgba(var(--accent-purple), 0.12); border: 1px solid rgba(var(--accent-purple), 0.3); display: flex; align-items: center; justify-content: center; font-weight: 600; color: rgb(var(--accent-purple)); font-size: 0.95rem;">
                              🏢
                            </div>
                            <div>
                              <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-weight: 600; color: var(--text-primary); font-size: 0.9rem;">{dept.name}</span>
                                {#if parentName}
                                  <span class="badge badge-cyan" style="font-size: 0.72rem;">
                                    上層：{parentName}
                                  </span>
                                {:else}
                                  <span class="badge badge-slate" style="font-size: 0.72rem;">
                                    頂層部門
                                  </span>
                                {/if}
                              </div>
                              <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px; font-family: monospace;">{dept.id}</div>
                            </div>
                          </div>
                        </div>
                      {/each}
                </SettingsEntityCard>

                <!-- Department Usable Skills Configuration (Issue #115) -->
                <div class="settings-group glass-panel" style="margin-top: 24px;">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-wrap: wrap; gap: 8px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                      <h3 style="margin: 0;">可用 Skill 設定 (Department Usable Skills)</h3>
                      <span class="badge badge-cyan" style="font-size: 0.72rem;">二元授權清單</span>
                    </div>
                    <button class="btn btn-sm" onclick={fetchDepartments}>
                      重新整理
                    </button>
                  </div>
                  <p class="settings-desc">為每個部門配置可呼叫之 Agent Skill 權限清單。依據最小授權原則管理各部門之任務能力。</p>

                  <!-- Mandatory Security Disclaimer -->
                  <div class="skill-disclaimer-banner" style="margin-bottom: 16px; padding: 12px 14px; border-radius: 6px; background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.35); color: #fbbf24; font-size: 0.82rem; display: flex; align-items: flex-start; gap: 10px; line-height: 1.5;">
                    <span style="font-size: 1.15rem; line-height: 1;">⚠️</span>
                    <div>
                      <strong>僅供情境設計，尚未擋真實存取：</strong>目前 Rust 端的 Tauri command 尚未實作強制授權檢查，此設定介面為情境設計與二元授權清單宣告，設定完成不代表底層 API 已被強制阻斷。
                    </div>
                  </div>

                  {#if appState.departments.length === 0}
                    <div class="empty-audit" style="padding: 24px; text-align: center;">
                      請先於上方「部門管理」建立組織部門，方可進行 Skill 授權配置。
                    </div>
                  {:else}
                    <!-- Department Selector Tabs -->
                    <div style="margin-bottom: 16px;">
                      <div style="font-size: 0.78rem; font-weight: 600; color: var(--text-muted); margin-bottom: 8px;">
                        選擇目標部門：
                      </div>
                      <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                        {#each appState.departments as dept (dept.id)}
                          {@const isSelected = effectiveSkillDeptId === dept.id}
                          {@const skillCount = (dept.skills || []).length}
                          <button
                            type="button"
                            class="btn btn-sm"
                            onclick={() => activeSkillDeptId = dept.id}
                            style="padding: 6px 14px; border-radius: 6px; font-size: 0.82rem; border: 1px solid {isSelected ? 'rgba(var(--accent-cyan), 0.8)' : 'var(--border-color)'}; background: {isSelected ? 'rgba(var(--accent-cyan), 0.18)' : 'rgba(255, 255, 255, 0.03)'}; color: {isSelected ? 'rgb(var(--accent-cyan))' : 'var(--text-secondary)'}; font-weight: {isSelected ? '600' : 'normal'}; display: flex; align-items: center; gap: 6px;"
                          >
                            <span>🏢 {dept.name}</span>
                            <span class="badge {isSelected ? 'badge-cyan' : 'badge-slate'}" style="font-size: 0.68rem; padding: 1px 5px;">
                              {skillCount}
                            </span>
                          </button>
                        {/each}
                      </div>
                    </div>

                    <!-- Selected Department Active Header & Search Box -->
                    {#if currentSkillDept}
                      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 14px; padding: 12px 14px; background: rgba(0, 0, 0, 0.25); border-radius: 6px; border: 1px solid var(--border-color);">
                        <div style="display: flex; align-items: center; gap: 10px;">
                          <span style="font-size: 0.95rem; font-weight: 600; color: var(--text-primary);">
                            部門：<span style="color: rgb(var(--accent-cyan));">{currentSkillDept.name}</span>
                          </span>
                          <span class="badge badge-slate" style="font-size: 0.72rem; font-family: monospace;">
                            {currentSkillDept.id}
                          </span>
                          <span style="font-size: 0.8rem; color: var(--text-muted);">
                            （已啟用 {(currentSkillDept.skills || []).length} 個 Skills）
                          </span>
                        </div>

                        <!-- Search Filter -->
                        <div style="flex: 1; max-width: 320px; min-width: 200px; position: relative;">
                          <input
                            type="text"
                            class="form-input"
                            placeholder="🔍 搜尋 Skill 名稱、識別碼、領域..."
                            bind:value={skillSearchKeyword}
                            style="width: 100%; padding: 6px 10px; font-size: 0.8rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);"
                          />
                        </div>
                      </div>

                      {#if deptSkillError}
                        <div style="color: #ef4444; font-size: 0.8rem; margin-bottom: 12px;">{deptSkillError}</div>
                      {/if}

                      <!-- Skills Grouped by Domain -->
                      <div class="skills-domain-list" style="display: flex; flex-direction: column; gap: 16px;">
                        {#if skillGroupsByDomain.length === 0}
                          <div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
                            未找到符合「{skillSearchKeyword}」的 Skill
                          </div>
                        {:else}
                          {#each skillGroupsByDomain as group (group.domain)}
                            <div class="skill-domain-card" style="padding: 14px; border-radius: 6px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color);">
                              <!-- Domain Header -->
                              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.06);">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                  <span style="font-size: 0.95rem;">📁</span>
                                  <span style="font-weight: 600; color: var(--text-primary); font-size: 0.88rem;">{group.name}</span>
                                  <span class="badge badge-slate" style="font-size: 0.7rem; font-family: monospace;">{group.domain}</span>
                                </div>
                                <span style="font-size: 0.75rem; color: var(--text-muted);">
                                  {group.description || ''}
                                </span>
                              </div>

                              <!-- Skills in Domain -->
                              <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 10px;">
                                {#each group.skills as skill (skill.id)}
                                  {@const isEnabled = (currentSkillDept.skills || []).includes(skill.id)}
                                  {@const chkId = `skill-chk-${currentSkillDept.id}-${skill.id}`}
                                  <div
                                    class="skill-item-row"
                                    style="display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border-radius: 6px; background: {isEnabled ? 'rgba(var(--accent-cyan), 0.07)' : 'rgba(0, 0, 0, 0.2)'}; border: 1px solid {isEnabled ? 'rgba(var(--accent-cyan), 0.4)' : 'rgba(255, 255, 255, 0.06)'}; transition: all 0.15s ease;"
                                  >
                                    <input
                                      id={chkId}
                                      type="checkbox"
                                      checked={isEnabled}
                                      disabled={isUpdatingDeptSkill}
                                      onchange={() => handleToggleDepartmentSkill(currentSkillDept.id, skill.id, isEnabled)}
                                      style="margin-top: 3px; accent-color: rgb(var(--accent-cyan)); cursor: pointer; width: 16px; height: 16px;"
                                    />
                                    <label for={chkId} style="flex: 1; min-width: 0; cursor: pointer; margin: 0;">
                                      <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                                        <span style="font-weight: 600; color: {isEnabled ? 'var(--text-primary)' : 'var(--text-secondary)'}; font-size: 0.84rem;">
                                          {skill.name}
                                        </span>
                                        <span class="badge {isEnabled ? 'badge-cyan' : 'badge-slate'}" style="font-size: 0.68rem; font-family: monospace;">
                                          {skill.id}
                                        </span>
                                      </div>
                                      {#if skill.description}
                                        <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 3px; line-height: 1.35;">
                                          {skill.description}
                                        </div>
                                      {/if}
                                    </label>
                                  </div>
                                {/each}
                              </div>
                            </div>
                          {/each}
                        {/if}
                      </div>
                    {/if}
                  {/if}
                </div>
                {/if}

                <!-- Customer & Vendor Partner Management (Issue #117, #119) -->
                <SettingsEntityCard
                  title="合作夥伴基本資料管理 (Partner Management)"
                  badge="Partner 聚合根"
                  badgeClass="badge-cyan"
                  description="登記與維護合作夥伴基本檔案（名稱、統一編號／稅號、身份角色）。支援客戶與供應商身份疊加，作為後續銷售受理、採購與交易對象的基準資料庫。"
                  onRefresh={() => fetchPartners()}
                  refreshLabel="重新整理"
                  containerStyle="margin-top: 24px;"
                  errorMessage={partnerError}
                  isEmpty={filteredPartners.length === 0}
                  emptyMessage="目前尚無符合篩選條件的夥伴資料，請透過上方表單或 AI 助理對話登記。"
                  listClass="customer-list"
                  listStyle="display: flex; flex-direction: column; gap: 8px;"
                >
                  {#snippet headerExtra()}
                    <div class="filter-row" style="display: flex; gap: 4px; background: rgba(0, 0, 0, 0.2); padding: 2px; border-radius: 6px;">
                      <button 
                        class="filter-btn {partnerFilter === 'all' ? 'active' : ''}" 
                        onclick={() => partnerFilter = 'all'}
                        style="font-size: 0.75rem; padding: 4px 10px; border-radius: 4px; border: none; background: {partnerFilter === 'all' ? 'var(--accent-cyan)' : 'transparent'}; color: {partnerFilter === 'all' ? '#000' : 'var(--text-secondary)'}; cursor: pointer; font-weight: {partnerFilter === 'all' ? '600' : 'normal'};"
                      >
                        全部 ({appState.partners.length})
                      </button>
                      <button 
                        class="filter-btn {partnerFilter === 'customer' ? 'active' : ''}" 
                        onclick={() => partnerFilter = 'customer'}
                        style="font-size: 0.75rem; padding: 4px 10px; border-radius: 4px; border: none; background: {partnerFilter === 'customer' ? 'var(--accent-cyan)' : 'transparent'}; color: {partnerFilter === 'customer' ? '#000' : 'var(--text-secondary)'}; cursor: pointer; font-weight: {partnerFilter === 'customer' ? '600' : 'normal'};"
                      >
                        客戶 ({appState.partners.filter(p => p.is_customer).length})
                      </button>
                      <button 
                        class="filter-btn {partnerFilter === 'vendor' ? 'active' : ''}" 
                        onclick={() => partnerFilter = 'vendor'}
                        style="font-size: 0.75rem; padding: 4px 10px; border-radius: 4px; border: none; background: {partnerFilter === 'vendor' ? 'var(--accent-cyan)' : 'transparent'}; color: {partnerFilter === 'vendor' ? '#000' : 'var(--text-secondary)'}; cursor: pointer; font-weight: {partnerFilter === 'vendor' ? '600' : 'normal'};"
                      >
                        供應商 ({appState.partners.filter(p => p.is_vendor).length})
                      </button>
                    </div>
                  {/snippet}

                  {#snippet form()}
                    <!-- Add Partner Form -->
                    <form onsubmit={handleCreatePartner} class="customer-add-form" style="display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; padding: 14px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color); border-radius: var(--radius-sm); margin-bottom: 16px;">
                      <div style="flex: 2; min-width: 180px;">
                        <label for="partner-name-input" style="display: block; font-size: 0.75rem; color: var(--text-muted); margin-bottom: 4px;">夥伴／廠商名稱（必填）</label>
                        <input 
                          id="partner-name-input"
                          type="text" 
                          class="form-input" 
                          placeholder="例：欣興電子、台灣積體電路製造、聯發科技" 
                          bind:value={newPartnerName}
                          style="width: 100%; padding: 7px 10px; font-size: 0.85rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);" 
                        />
                      </div>
                      <div style="flex: 1.2; min-width: 140px;">
                        <label for="partner-tax-id-input" style="display: block; font-size: 0.75rem; color: var(--text-muted); margin-bottom: 4px;">統一編號 / 稅號（選填）</label>
                        <input 
                          id="partner-tax-id-input"
                          type="text" 
                          class="form-input" 
                          placeholder="例：11223344" 
                          bind:value={newPartnerTaxId}
                          style="width: 100%; padding: 7px 10px; font-size: 0.85rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);" 
                        />
                      </div>
                      <div style="flex: 1.2; min-width: 130px;">
                        <label for="partner-role-select" style="display: block; font-size: 0.75rem; color: var(--text-muted); margin-bottom: 4px;">登記身份</label>
                        <select
                          id="partner-role-select"
                          class="form-input"
                          bind:value={newPartnerRole}
                          style="width: 100%; padding: 7px 10px; font-size: 0.85rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);"
                        >
                          <option value="customer">🏢 客戶 (Customer)</option>
                          <option value="vendor">🏭 供應商 (Vendor)</option>
                          <option value="both">🌐 雙重身份 (Both)</option>
                        </select>
                      </div>
                      <button 
                        type="submit" 
                        class="btn btn-primary btn-sm" 
                        disabled={isAddingPartner}
                        style="height: 35px; white-space: nowrap; padding: 0 16px;"
                      >
                        {#if isAddingPartner}登記中...{:else}+ 登記夥伴{/if}
                      </button>
                    </form>
                  {/snippet}

                  {#each filteredPartners as partner (partner.id)}
                    {#if editingPartnerId === partner.id}
                      <!-- Inline Edit Form -->
                      <form onsubmit={handleUpdatePartner} class="customer-item customer-edit-form" style="display: flex; flex-direction: column; gap: 10px; padding: 14px; border-radius: 6px; background: rgba(0, 240, 255, 0.04); border: 1px solid rgba(var(--accent-cyan), 0.5);">
                        <div style="display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end;">
                          <div style="flex: 2; min-width: 170px;">
                            <label for="edit-partner-name-{partner.id}" style="display: block; font-size: 0.72rem; color: var(--text-muted); margin-bottom: 3px;">夥伴／廠商名稱（必填）</label>
                            <input
                              id="edit-partner-name-{partner.id}"
                              type="text"
                              class="form-input"
                              placeholder="夥伴名稱"
                              bind:value={editingPartnerName}
                              style="width: 100%; padding: 6px 10px; font-size: 0.85rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);"
                            />
                          </div>
                          <div style="flex: 1.5; min-width: 140px;">
                            <label for="edit-partner-tax-{partner.id}" style="display: block; font-size: 0.72rem; color: var(--text-muted); margin-bottom: 3px;">統一編號（8 碼數字，可清空）</label>
                            <input
                              id="edit-partner-tax-{partner.id}"
                              type="text"
                              class="form-input"
                              placeholder="例：22099131"
                              bind:value={editingPartnerTaxId}
                              style="width: 100%; padding: 6px 10px; font-size: 0.85rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);"
                            />
                          </div>
                          <div style="display: flex; gap: 6px; align-items: flex-end;">
                            <button
                              type="submit"
                              class="btn btn-primary btn-sm"
                              disabled={isUpdatingPartner}
                              style="height: 33px; padding: 0 14px; font-size: 0.8rem;"
                            >
                              {isUpdatingPartner ? '儲存中...' : '儲存'}
                            </button>
                            <button
                              type="button"
                              class="btn btn-outline btn-sm"
                              onclick={cancelEditPartner}
                              disabled={isUpdatingPartner}
                              style="height: 33px; padding: 0 12px; font-size: 0.8rem;"
                            >
                              取消
                            </button>
                          </div>
                        </div>
                        {#if editPartnerError}
                          <div class="field-error-msg" style="color: var(--status-error); font-size: 0.75rem; margin-top: 2px;">
                            ⚠️ {editPartnerError}
                          </div>
                        {/if}
                      </form>
                    {:else}
                      <div class="customer-item" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; border-radius: 6px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color);">
                        <div style="display: flex; align-items: center; gap: 12px;">
                          <div style="width: 36px; height: 36px; border-radius: 8px; background: rgba(var(--accent-cyan), 0.12); border: 1px solid rgba(var(--accent-cyan), 0.3); display: flex; align-items: center; justify-content: center; font-weight: 600; color: rgb(var(--accent-cyan)); font-size: 0.95rem;">
                            {#if partner.is_customer && partner.is_vendor}
                              🌐
                            {:else if partner.is_vendor}
                              🏭
                            {:else}
                              🏢
                            {/if}
                          </div>
                          <div>
                            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                              <span style="font-weight: 600; color: var(--text-primary); font-size: 0.9rem;">{partner.name}</span>
                              {#if partner.tax_id}
                                <span class="badge badge-cyan" style="font-size: 0.72rem;">
                                  統編：{partner.tax_id}
                                </span>
                              {:else}
                                <button
                                  type="button"
                                  class="btn btn-xs"
                                  onclick={() => startEditPartner(partner, true)}
                                  style="padding: 2px 8px; font-size: 0.7rem; border-radius: 4px; border: 1px dashed var(--accent-cyan); color: var(--accent-cyan); background: rgba(0, 240, 255, 0.05); cursor: pointer; transition: all 0.2s;"
                                  title="點擊補填統一編號"
                                >
                                  + 補填統編
                                </button>
                              {/if}
                              {#if partner.is_customer}
                                <span class="badge badge-emerald" style="font-size: 0.7rem;">
                                  客戶
                                </span>
                              {/if}
                              {#if partner.is_vendor}
                                <span class="badge badge-amber" style="font-size: 0.7rem;">
                                  供應商
                                </span>
                              {/if}
                            </div>
                            <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px; font-family: monospace;">{partner.id}</div>
                          </div>
                        </div>
                        <div style="display: flex; align-items: center; gap: 10px;">
                          <div style="font-size: 0.75rem; color: var(--text-muted);">
                            {new Date(partner.created_at * 1000).toLocaleString()}
                          </div>
                          <button
                            type="button"
                            class="btn btn-outline btn-xs"
                            onclick={() => startEditPartner(partner, false)}
                            style="padding: 3px 10px; font-size: 0.75rem; border-radius: 4px; border: 1px solid var(--border-color); background: rgba(255, 255, 255, 0.04); color: var(--text-secondary); cursor: pointer;"
                          >
                            編輯
                          </button>
                        </div>
                      </div>
                    {/if}
                  {/each}
                </SettingsEntityCard>

                <!-- Product & BOM Management (Issue #137) -->
                <SettingsEntityCard
                  title="商品主檔與規格 BOM 管理 (Product & BOM Management)"
                  badge="Product 聚合根"
                  badgeClass="badge-purple"
                  description="建立與維護全生命週期商品資料模型（轉售商品、自製成品、原物料），包含多規格變體、多階包裝銷售單位（換算比率與售價）、供應來源採購成本，以及自製成品 BOM 物料清單。"
                  onRefresh={() => fetchProducts()}
                  refreshLabel="重新整理"
                  containerStyle="margin-top: 24px;"
                  errorMessage={productError}
                  isEmpty={filteredProducts.length === 0}
                  emptyMessage="目前尚無符合篩選條件的商品資料，請透過上方表單或 AI 助理對話建立。"
                  listClass="product-list"
                  listStyle="display: flex; flex-direction: column; gap: 10px;"
                >
                  {#snippet headerExtra()}
                    <div class="filter-row" style="display: flex; gap: 4px; background: rgba(0, 0, 0, 0.2); padding: 2px; border-radius: 6px;">
                      <button 
                        class="filter-btn {productFilter === 'all' ? 'active' : ''}" 
                        onclick={() => productFilter = 'all'}
                        style="font-size: 0.75rem; padding: 4px 10px; border-radius: 4px; border: none; background: {productFilter === 'all' ? 'var(--accent-purple)' : 'transparent'}; color: {productFilter === 'all' ? '#fff' : 'var(--text-secondary)'}; cursor: pointer; font-weight: {productFilter === 'all' ? '600' : 'normal'};"
                      >
                        全部 ({appState.products.length})
                      </button>
                      <button 
                        class="filter-btn {productFilter === 'resale' ? 'active' : ''}" 
                        onclick={() => productFilter = 'resale'}
                        style="font-size: 0.75rem; padding: 4px 10px; border-radius: 4px; border: none; background: {productFilter === 'resale' ? 'var(--accent-purple)' : 'transparent'}; color: {productFilter === 'resale' ? '#fff' : 'var(--text-secondary)'}; cursor: pointer; font-weight: {productFilter === 'resale' ? '600' : 'normal'};"
                      >
                        轉售商品 ({appState.products.filter(p => p.category === 'resale').length})
                      </button>
                      <button 
                        class="filter-btn {productFilter === 'manufactured' ? 'active' : ''}" 
                        onclick={() => productFilter = 'manufactured'}
                        style="font-size: 0.75rem; padding: 4px 10px; border-radius: 4px; border: none; background: {productFilter === 'manufactured' ? 'var(--accent-purple)' : 'transparent'}; color: {productFilter === 'manufactured' ? '#fff' : 'var(--text-secondary)'}; cursor: pointer; font-weight: {productFilter === 'manufactured' ? '600' : 'normal'};"
                      >
                        自製成品 ({appState.products.filter(p => p.category === 'manufactured').length})
                      </button>
                      <button 
                        class="filter-btn {productFilter === 'raw_material' ? 'active' : ''}" 
                        onclick={() => productFilter = 'raw_material'}
                        style="font-size: 0.75rem; padding: 4px 10px; border-radius: 4px; border: none; background: {productFilter === 'raw_material' ? 'var(--accent-purple)' : 'transparent'}; color: {productFilter === 'raw_material' ? '#fff' : 'var(--text-secondary)'}; cursor: pointer; font-weight: {productFilter === 'raw_material' ? '600' : 'normal'};"
                      >
                        原物料 ({appState.products.filter(p => p.category === 'raw_material').length})
                      </button>
                    </div>
                  {/snippet}

                  {#snippet form()}
                    <!-- Add Product Form -->
                    <form onsubmit={handleCreateProduct} class="product-add-form" style="display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; padding: 14px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color); border-radius: var(--radius-sm); margin-bottom: 16px;">
                      <div style="flex: 2; min-width: 170px;">
                        <label for="prod-name-input" style="display: block; font-size: 0.75rem; color: var(--text-muted); margin-bottom: 4px;">商品名稱（必填）</label>
                        <input 
                          id="prod-name-input"
                          type="text" 
                          class="form-input" 
                          placeholder="例：專業級散熱模組、五金零件" 
                          bind:value={newProductName}
                          style="width: 100%; padding: 7px 10px; font-size: 0.85rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);" 
                        />
                      </div>
                      <div style="flex: 1.2; min-width: 130px;">
                        <label for="prod-category-select" style="display: block; font-size: 0.75rem; color: var(--text-muted); margin-bottom: 4px;">商品類別</label>
                        <select
                          id="prod-category-select"
                          class="form-input"
                          bind:value={newProductCategory}
                          style="width: 100%; padding: 7px 10px; font-size: 0.85rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);"
                        >
                          <option value="resale">📦 轉售商品 (可售・可採)</option>
                          <option value="manufactured">⚙️ 自製成品 (可售・BOM)</option>
                          <option value="raw_material">🧱 原物料 (不售・可採)</option>
                        </select>
                      </div>
                      <div style="flex: 1; min-width: 90px;">
                        <label for="prod-unit-input" style="display: block; font-size: 0.75rem; color: var(--text-muted); margin-bottom: 4px;">基準單位</label>
                        <input 
                          id="prod-unit-input"
                          type="text" 
                          class="form-input" 
                          placeholder="件" 
                          bind:value={newProductUnit}
                          style="width: 100%; padding: 7px 10px; font-size: 0.85rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);" 
                        />
                      </div>
                      <div style="flex: 1; min-width: 100px;">
                        <label for="prod-price-input" style="display: block; font-size: 0.75rem; color: var(--text-muted); margin-bottom: 4px;">基準售價</label>
                        <input 
                          id="prod-price-input"
                          type="number" 
                          min="0"
                          step="any"
                          class="form-input" 
                          placeholder="0" 
                          bind:value={newProductPrice}
                          style="width: 100%; padding: 7px 10px; font-size: 0.85rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);" 
                        />
                      </div>
                      <button 
                        type="submit" 
                        class="btn btn-primary btn-sm" 
                        disabled={isAddingProduct}
                        style="height: 35px; white-space: nowrap; padding: 0 16px;"
                      >
                        {#if isAddingProduct}建立中...{:else}+ 建立商品{/if}
                      </button>

                      {#if newProductCategory === 'manufactured'}
                        <div style="width: 100%; margin-top: 10px; padding: 12px; background: rgba(168, 85, 247, 0.05); border: 1px dashed rgba(168, 85, 247, 0.25); border-radius: 6px;">
                          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <span style="font-size: 0.8rem; font-weight: 600; color: #c084fc;">
                              🧩 組成原物料（選填・多選並指定用量）
                            </span>
                            <span style="font-size: 0.7rem; color: var(--text-muted);">
                              可先跳過，建立後亦可隨時至詳情補登
                            </span>
                          </div>

                          {#if purchasableCandidates.length > 0}
                            <div style="display: flex; flex-direction: column; gap: 8px; max-height: 180px; overflow-y: auto; padding-right: 4px;">
                              {#each purchasableCandidates as candidate (candidate.id)}
                                <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 10px; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-color); border-radius: 4px; font-size: 0.8rem;">
                                  <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; flex: 1;">
                                    <input
                                      type="checkbox"
                                      checked={!!newProductBomSelections[candidate.id]?.selected}
                                      onchange={(e) => {
                                        const checked = e.currentTarget.checked;
                                        newProductBomSelections[candidate.id] = {
                                          selected: checked,
                                          quantity: newProductBomSelections[candidate.id]?.quantity || 1
                                        };
                                      }}
                                    />
                                    <span style="font-weight: 500; color: var(--text-primary);">{candidate.name}</span>
                                    <span class="badge {candidate.category === 'raw_material' ? 'badge-amber' : 'badge-cyan'}" style="font-size: 0.68rem;">
                                      {candidate.category === 'raw_material' ? '原物料' : '轉售/可採購品'}
                                    </span>
                                  </label>
                                  {#if newProductBomSelections[candidate.id]?.selected}
                                    <div style="display: flex; align-items: center; gap: 6px;">
                                      <span style="font-size: 0.72rem; color: var(--text-muted);">用量:</span>
                                      <input
                                        type="number"
                                        min="0.0001"
                                        step="any"
                                        class="form-input"
                                        style="width: 70px; padding: 3px 6px; font-size: 0.75rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);"
                                        value={newProductBomSelections[candidate.id]?.quantity || 1}
                                        oninput={(e) => {
                                          const val = Number(e.currentTarget.value);
                                          newProductBomSelections[candidate.id] = {
                                            selected: true,
                                            quantity: val
                                          };
                                        }}
                                      />
                                    </div>
                                  {/if}
                                </div>
                              {/each}
                            </div>
                          {:else}
                            <div style="font-size: 0.75rem; color: var(--text-muted); padding: 4px 0;">
                              💡 目前系統尚無可採購原物料，此步驟已略過（建立完成後可隨時至詳情補登）。
                            </div>
                          {/if}
                        </div>
                      {/if}
                    </form>
                  {/snippet}

                  {#each filteredProducts as product (product.id)}
                    <div class="product-item" style="display: flex; flex-direction: column; padding: 12px 14px; border-radius: 6px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color);">
                      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                        <div style="display: flex; align-items: center; gap: 12px;">
                          <div style="width: 36px; height: 36px; border-radius: 8px; background: rgba(168, 85, 247, 0.12); border: 1px solid rgba(168, 85, 247, 0.3); display: flex; align-items: center; justify-content: center; font-size: 1.1rem;">
                            {#if product.category === 'manufactured'}
                              ⚙️
                            {:else if product.category === 'raw_material'}
                              🧱
                            {:else}
                              📦
                            {/if}
                          </div>
                          <div>
                            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                              <span style="font-weight: 600; color: var(--text-primary); font-size: 0.9rem;">{product.name}</span>
                              {#if product.category === 'manufactured'}
                                <span class="badge badge-emerald" style="font-size: 0.7rem;">自製成品</span>
                              {:else if product.category === 'raw_material'}
                                <span class="badge badge-amber" style="font-size: 0.7rem;">原物料</span>
                              {:else}
                                <span class="badge badge-cyan" style="font-size: 0.7rem;">轉售商品</span>
                              {/if}
                              {#if product.is_sellable}
                                <span style="font-size: 0.7rem; color: #10b981; background: rgba(16, 185, 129, 0.1); padding: 1px 6px; border-radius: 3px;">可銷售</span>
                              {/if}
                              {#if product.is_purchasable}
                                <span style="font-size: 0.7rem; color: #f59e0b; background: rgba(245, 158, 11, 0.1); padding: 1px 6px; border-radius: 3px;">可採購</span>
                              {/if}
                            </div>
                            <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px; font-family: monospace;">
                              {product.id}
                            </div>
                          </div>
                        </div>

                        <div style="display: flex; align-items: center; gap: 12px;">
                          <button
                            type="button"
                            class="btn btn-outline btn-xs"
                            onclick={() => handleToggleProductDetail(product.id)}
                            style="padding: 4px 12px; font-size: 0.75rem; border-radius: 4px; border: 1px solid var(--border-color); background: rgba(255, 255, 255, 0.04); color: var(--text-secondary); cursor: pointer;"
                          >
                            {expandedProductId === product.id ? '收合詳情 ▲' : '展開規格與 BOM ▼'}
                          </button>
                        </div>
                      </div>

                      <!-- Expandable Detail Section -->
                      {#if expandedProductId === product.id}
                        <div class="product-detail-expanded" style="margin-top: 14px; padding-top: 14px; border-top: 1px dashed var(--border-color);">
                          {#if isLoadingProductDetail}
                            <div style="font-size: 0.8rem; color: var(--text-muted); text-align: center; padding: 12px;">載入詳細資訊中...</div>
                          {:else if expandedProductDetail}
                            <!-- Sub-tabs -->
                            <div style="display: flex; gap: 6px; margin-bottom: 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.06); padding-bottom: 8px;">
                              <button
                                type="button"
                                class="btn btn-xs {productDetailTab === 'variants' ? 'btn-primary' : 'btn-outline'}"
                                onclick={() => productDetailTab = 'variants'}
                                style="font-size: 0.75rem; padding: 3px 10px;"
                              >
                                規格變體 ({expandedProductDetail.variants?.length || 0})
                              </button>
                              <button
                                type="button"
                                class="btn btn-xs {productDetailTab === 'units' ? 'btn-primary' : 'btn-outline'}"
                                onclick={() => productDetailTab = 'units'}
                                style="font-size: 0.75rem; padding: 3px 10px;"
                              >
                                包裝銷售單位 ({expandedProductDetail.units?.length || 0})
                              </button>
                              <button
                                type="button"
                                class="btn btn-xs {productDetailTab === 'sources' ? 'btn-primary' : 'btn-outline'}"
                                onclick={() => productDetailTab = 'sources'}
                                style="font-size: 0.75rem; padding: 3px 10px;"
                              >
                                採購供應商 ({expandedProductDetail.supply_sources?.length || 0})
                              </button>
                              {#if product.category === 'manufactured'}
                                <button
                                  type="button"
                                  class="btn btn-xs {productDetailTab === 'bom' ? 'btn-primary' : 'btn-outline'}"
                                  onclick={() => productDetailTab = 'bom'}
                                  style="font-size: 0.75rem; padding: 3px 10px;"
                                >
                                  BOM 物料組成 ({expandedProductDetail.bom_items?.length || 0})
                                </button>
                              {/if}
                            </div>

                            {#if productDetailError}
                              <div style="color: var(--status-error); font-size: 0.78rem; margin-bottom: 10px; padding: 6px 10px; background: rgba(239, 68, 68, 0.08); border-radius: 4px;">
                                ⚠️ {productDetailError}
                              </div>
                            {/if}

                            <!-- Tab: Variants -->
                            {#if productDetailTab === 'variants'}
                              <div style="display: flex; flex-direction: column; gap: 8px;">
                                <div style="display: flex; flex-direction: column; gap: 6px;">
                                  {#each (expandedProductDetail.variants || []) as v (v.id)}
                                    <div style="display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color); border-radius: 6px; font-size: 0.8rem;">
                                      <div style="display: flex; justify-content: space-between; align-items: center;">
                                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                          <span style="font-weight: 600;">{v.name}</span>
                                          {#if v.is_default}
                                            <span class="badge badge-cyan" style="font-size: 0.65rem;">預設規格</span>
                                          {/if}
                                          {#if v.sku}
                                            <span style="color: var(--text-muted); font-size: 0.72rem; font-family: monospace;">SKU: {v.sku}</span>
                                          {/if}
                                          {#if v.spec_attributes && typeof v.spec_attributes === 'object' && Object.keys(v.spec_attributes).length > 0}
                                            {#each Object.entries(v.spec_attributes) as [attrKey, attrVal]}
                                              <span class="badge" style="font-size: 0.65rem; background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3);">
                                                {attrKey}: {attrVal}
                                              </span>
                                            {/each}
                                          {:else}
                                            <span style="color: var(--text-muted); font-size: 0.7rem;">無規格差異</span>
                                          {/if}
                                        </div>
                                        <div style="display: flex; align-items: center; gap: 6px;">
                                          <span style="color: var(--text-muted); font-size: 0.7rem; font-family: monospace;">{v.id}</span>
                                          <button
                                            type="button"
                                            class="btn btn-outline btn-xs"
                                            style="padding: 2px 8px; font-size: 0.72rem;"
                                            onclick={() => {
                                              if (editingVariantId === v.id) {
                                                cancelEditVariant();
                                              } else {
                                                startEditVariant(v);
                                              }
                                            }}
                                          >
                                            {editingVariantId === v.id ? '取消' : '✏️ 編輯'}
                                          </button>
                                        </div>
                                      </div>

                                      <!-- Inline Edit Form -->
                                      {#if editingVariantId === v.id}
                                        <div style="margin-top: 6px; padding: 10px; background: rgba(0, 0, 0, 0.2); border-radius: 6px; border: 1px dashed var(--border-color); display: flex; flex-direction: column; gap: 8px;">
                                          <div style="font-size: 0.75rem; font-weight: 600; color: var(--text-secondary);">
                                            編輯規格變體「{v.name}」
                                          </div>
                                          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                                            <input
                                              type="text"
                                              class="form-input"
                                              placeholder="規格名稱"
                                              bind:value={editVariantName}
                                              style="flex: 1; min-width: 130px; padding: 4px 8px; font-size: 0.78rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);"
                                            />
                                            <input
                                              type="text"
                                              class="form-input"
                                              placeholder="SKU 代碼 (例：CLOTH-RED-M)"
                                              bind:value={editVariantSku}
                                              style="flex: 1; min-width: 140px; padding: 4px 8px; font-size: 0.78rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);"
                                            />
                                          </div>

                                          <!-- Spec Attributes Axis Pairs for Edit -->
                                          <div style="display: flex; flex-direction: column; gap: 4px;">
                                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                              <span style="font-size: 0.72rem; color: var(--text-muted);">規格軸屬性鍵值 (如 顏色: 紅、尺寸: M)：</span>
                                              <button type="button" class="btn btn-outline btn-xs" style="font-size: 0.68rem; padding: 1px 6px;" onclick={addEditSpecPair}>
                                                + 增加屬性
                                              </button>
                                            </div>
                                            {#each editVariantSpecPairs as pair, pIdx}
                                              <div style="display: flex; gap: 6px; align-items: center;">
                                                <input
                                                  type="text"
                                                  class="form-input"
                                                  placeholder="軸向 (例: 顏色)"
                                                  bind:value={pair.key}
                                                  style="flex: 1; padding: 3px 6px; font-size: 0.75rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);"
                                                />
                                                <input
                                                  type="text"
                                                  class="form-input"
                                                  placeholder="數值 (例: 紅色)"
                                                  bind:value={pair.value}
                                                  style="flex: 1; padding: 3px 6px; font-size: 0.75rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);"
                                                />
                                                <button
                                                  type="button"
                                                  class="btn btn-outline btn-xs"
                                                  style="padding: 2px 6px; color: var(--status-error); border-color: rgba(239,68,68,0.3);"
                                                  onclick={() => removeEditSpecPair(pIdx)}
                                                >
                                                  ✕
                                                </button>
                                              </div>
                                            {/each}
                                          </div>

                                          <div style="display: flex; justify-content: flex-end; gap: 6px; margin-top: 4px;">
                                            <button type="button" class="btn btn-outline btn-xs" onclick={cancelEditVariant}>
                                              取消
                                            </button>
                                            <button
                                              type="button"
                                              class="btn btn-primary btn-xs"
                                              disabled={isUpdatingVariant}
                                              onclick={() => handleUpdateVariant(product.id)}
                                            >
                                              {isUpdatingVariant ? '儲存中...' : '儲存規格變更'}
                                            </button>
                                          </div>
                                        </div>
                                      {/if}
                                    </div>
                                  {/each}
                                </div>

                                <!-- Add Variant Form -->
                                <div style="margin-top: 8px; padding: 10px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color); border-radius: 6px; display: flex; flex-direction: column; gap: 8px;">
                                  <div style="font-size: 0.75rem; font-weight: 600; color: var(--text-secondary);">
                                    + 新增規格變體
                                  </div>
                                  <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                                    <input
                                      type="text"
                                      class="form-input"
                                      placeholder="變體名稱（例：紅色 / M，可留空自動依規格軸組合）"
                                      bind:value={newVariantName}
                                      style="flex: 2; min-width: 160px; padding: 5px 8px; font-size: 0.78rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);"
                                    />
                                    <input
                                      type="text"
                                      class="form-input"
                                      placeholder="SKU 代碼 (選填)"
                                      bind:value={newVariantSku}
                                      style="flex: 1; min-width: 120px; padding: 5px 8px; font-size: 0.78rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);"
                                    />
                                  </div>

                                  <!-- Spec Attributes Dynamic Key-Value Pairs -->
                                  <div style="display: flex; flex-direction: column; gap: 4px;">
                                    <div style="display: flex; justify-content: space-between; align-items: center;">
                                      <span style="font-size: 0.72rem; color: var(--text-muted);">規格軸（例如 顏色: 紅、尺寸: M）：</span>
                                      <button type="button" class="btn btn-outline btn-xs" style="font-size: 0.68rem; padding: 1px 6px;" onclick={addSpecPair}>
                                        + 增加規格軸
                                      </button>
                                    </div>
                                    {#each newVariantSpecPairs as pair, pIdx}
                                      <div style="display: flex; gap: 6px; align-items: center;">
                                        <input
                                          type="text"
                                          class="form-input"
                                          placeholder="軸向 (例: 顏色)"
                                          bind:value={pair.key}
                                          style="flex: 1; padding: 3px 6px; font-size: 0.75rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);"
                                        />
                                        <input
                                          type="text"
                                          class="form-input"
                                          placeholder="屬性值 (例: 紅色)"
                                          bind:value={pair.value}
                                          style="flex: 1; padding: 3px 6px; font-size: 0.75rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);"
                                        />
                                        {#if newVariantSpecPairs.length > 1}
                                          <button
                                            type="button"
                                            class="btn btn-outline btn-xs"
                                            style="padding: 2px 6px; color: var(--status-error); border-color: rgba(239,68,68,0.3);"
                                            onclick={() => removeSpecPair(pIdx)}
                                          >
                                            ✕
                                          </button>
                                        {/if}
                                      </div>
                                    {/each}
                                  </div>

                                  <div style="display: flex; justify-content: flex-end; margin-top: 4px;">
                                    <button
                                      type="button"
                                      class="btn btn-primary btn-xs"
                                      disabled={isAddingVariant}
                                      onclick={() => handleAddVariant(product.id)}
                                      style="padding: 4px 14px; font-size: 0.75rem;"
                                    >
                                      {isAddingVariant ? '新增中...' : '+ 新增規格變體'}
                                    </button>
                                  </div>
                                </div>
                              </div>

                            <!-- Tab: Units -->
                            {:else if productDetailTab === 'units'}
                              <div style="display: flex; flex-direction: column; gap: 8px;">
                                <div style="display: flex; flex-direction: column; gap: 6px;">
                                  {#each (expandedProductDetail.units || []) as u (u.id)}
                                    {@const unitSources = (expandedProductDetail.supply_sources || []).filter(s => s.unit_id === u.id)}
                                    {#if editingUnitId === u.id}
                                      <form onsubmit={(e) => { e.preventDefault(); handleUpdateUnit(product.id); }} style="display: flex; gap: 8px; flex-wrap: wrap; padding: 8px 10px; background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 6px; align-items: flex-end;">
                                        <div style="width: 100px;">
                                          <label for="edit-unit-name-{u.id}" style="display: block; font-size: 0.7rem; color: var(--text-muted);">單位名稱</label>
                                          <input id="edit-unit-name-{u.id}" type="text" class="form-input" bind:value={editUnitName} style="width: 100%; padding: 4px 6px; font-size: 0.75rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);" />
                                        </div>
                                        <div style="width: 80px;">
                                          <label for="edit-unit-ratio-{u.id}" style="display: block; font-size: 0.7rem; color: var(--text-muted);">換算比例</label>
                                          <input id="edit-unit-ratio-{u.id}" type="number" min="0.0001" step="any" disabled={editUnitIsBase} class="form-input" bind:value={editUnitRatio} style="width: 100%; padding: 4px 6px; font-size: 0.75rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);" />
                                        </div>
                                        {#if product.is_sellable}
                                          <div style="width: 80px;">
                                            <label for="edit-unit-price-{u.id}" style="display: block; font-size: 0.7rem; color: var(--text-muted);">售價</label>
                                            <input id="edit-unit-price-{u.id}" type="number" min="0" step="any" class="form-input" bind:value={editUnitPrice} style="width: 100%; padding: 4px 6px; font-size: 0.75rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);" />
                                          </div>
                                        {/if}
                                        <label style="display: flex; align-items: center; gap: 4px; font-size: 0.75rem; margin-bottom: 6px; cursor: pointer;">
                                          <input type="checkbox" bind:checked={editUnitIsBase} onchange={(e) => { if (e.target.checked) editUnitRatio = 1.0; }} />
                                          基準單位 (1:1)
                                        </label>
                                        <div style="display: flex; gap: 4px; margin-left: auto;">
                                          <button type="submit" class="btn btn-primary btn-xs" disabled={isUpdatingUnit} style="padding: 4px 10px; font-size: 0.75rem;">
                                            {isUpdatingUnit ? '儲存中...' : '儲存'}
                                          </button>
                                          <button type="button" class="btn btn-outline btn-xs" onclick={cancelEditUnit} style="padding: 4px 8px; font-size: 0.75rem;">
                                            取消
                                          </button>
                                        </div>
                                      </form>
                                    {:else}
                                      <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: rgba(255, 255, 255, 0.02); border-radius: 4px; font-size: 0.8rem;">
                                        <div style="display: flex; align-items: center; gap: 8px;">
                                          <span style="font-weight: 600;">{u.unit_name}</span>
                                          {#if (expandedProductDetail.variants || []).length > 1}
                                            {@const matchedVar = (expandedProductDetail.variants || []).find(v => v.id === u.variant_id)}
                                            {#if matchedVar}
                                              <span class="badge" style="font-size: 0.65rem; background: rgba(255,255,255,0.06);">{matchedVar.name}</span>
                                            {/if}
                                          {/if}
                                          {#if u.is_base_unit}
                                            <span class="badge badge-cyan" style="font-size: 0.65rem;">基準單位 (1:1)</span>
                                          {:else}
                                            <span style="color: var(--text-muted); font-size: 0.72rem;">比例: {u.conversion_ratio}</span>
                                          {/if}
                                          {#if unitSources.length > 0}
                                            <span class="badge" style="font-size: 0.65rem; background: rgba(245, 158, 11, 0.15); color: #fbbf24;" title={unitSources.map(s => `${getVendorName(s.vendor_partner_id)} ($${s.purchase_cost ?? s.cost})`).join(', ')}>
                                              🏭 {unitSources.length} 間供應商
                                            </span>
                                          {/if}
                                        </div>
                                        <div style="display: flex; align-items: center; gap: 10px;">
                                          {#if product.is_sellable}
                                            <div style="font-weight: 600; color: #10b981;">
                                              ${u.selling_price}
                                            </div>
                                          {:else}
                                            <div style="font-size: 0.72rem; color: var(--text-muted);">
                                              不可銷售
                                            </div>
                                          {/if}
                                          <button
                                            type="button"
                                            class="btn btn-outline btn-xs"
                                            style="padding: 1px 7px; font-size: 0.68rem;"
                                            onclick={() => startEditUnit(u)}
                                          >
                                            ✏️ 編輯
                                          </button>
                                        </div>
                                      </div>
                                    {/if}
                                  {/each}
                                </div>
                                <form onsubmit={(e) => { e.preventDefault(); handleAddUnit(product.id); }} style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; align-items: flex-end;">
                                  {#if (expandedProductDetail?.variants || []).length > 1}
                                    <div style="width: 120px;">
                                      <label for="new-unit-var-{product.id}" style="display: block; font-size: 0.7rem; color: var(--text-muted);">選擇規格變體</label>
                                      <select id="new-unit-var-{product.id}" bind:value={newUnitVariantId} class="form-input" style="width: 100%; padding: 5px 8px; font-size: 0.8rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);">
                                        {#each (expandedProductDetail.variants || []) as v}
                                          <option value={v.id}>{v.name}{v.is_default ? ' (預設)' : ''}</option>
                                        {/each}
                                      </select>
                                    </div>
                                  {/if}
                                  <div style="width: 100px;">
                                    <label for="new-unit-name-{product.id}" style="display: block; font-size: 0.7rem; color: var(--text-muted);">單位名稱</label>
                                    <input id="new-unit-name-{product.id}" type="text" class="form-input" placeholder="例：盒" bind:value={newUnitName} style="width: 100%; padding: 5px 8px; font-size: 0.8rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);" />
                                  </div>
                                  <div style="width: 90px;">
                                    <label for="new-unit-ratio-{product.id}" style="display: block; font-size: 0.7rem; color: var(--text-muted);">換算比率</label>
                                    <input id="new-unit-ratio-{product.id}" type="number" min="0.0001" step="any" disabled={newUnitIsBase} class="form-input" placeholder="10" bind:value={newUnitRatio} style="width: 100%; padding: 5px 8px; font-size: 0.8rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);" />
                                  </div>
                                  {#if product.is_sellable}
                                    <div style="width: 90px;">
                                      <label for="new-unit-price-{product.id}" style="display: block; font-size: 0.7rem; color: var(--text-muted);">售價</label>
                                      <input id="new-unit-price-{product.id}" type="number" min="0" step="any" class="form-input" placeholder="0" bind:value={newUnitPrice} style="width: 100%; padding: 5px 8px; font-size: 0.8rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);" />
                                    </div>
                                  {/if}
                                  <label style="display: flex; align-items: center; gap: 4px; font-size: 0.72rem; color: var(--text-muted); cursor: pointer; margin-bottom: 6px;">
                                    <input type="checkbox" bind:checked={newUnitIsBase} onchange={(e) => { if (e.target.checked) newUnitRatio = 1.0; }} />
                                    設為基準單位
                                  </label>
                                  <button type="submit" class="btn btn-outline btn-xs" disabled={isAddingUnit} style="height: 28px; white-space: nowrap; padding: 0 12px;">
                                    + 新增包裝單位
                                  </button>
                                </form>
                              </div>

                            <!-- Tab: Sources -->
                            {:else if productDetailTab === 'sources'}
                              <div style="display: flex; flex-direction: column; gap: 8px;">
                                {#if !product.is_purchasable}
                                  <div style="padding: 6px 10px; background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 4px; font-size: 0.75rem; color: #fbbf24;">
                                    ℹ️ 此商品類別非採購品（is_purchasable = false），若為自製成品或純轉售，此區供應商採購成本僅供參考。
                                  </div>
                                {/if}
                                <div style="display: flex; flex-direction: column; gap: 6px;">
                                  {#if (expandedProductDetail.supply_sources || []).length === 0}
                                    <div style="font-size: 0.75rem; color: var(--text-muted); padding: 4px 0;">尚未綁定任何採購供應商。</div>
                                  {:else}
                                    {#each expandedProductDetail.supply_sources as s (s.id)}
                                      {@const matchedUnit = (expandedProductDetail.units || []).find(u => u.id === s.unit_id)}
                                      {@const matchedVar = matchedUnit ? (expandedProductDetail.variants || []).find(v => v.id === matchedUnit.variant_id) : null}
                                      {#if editingSupplySourceId === s.id}
                                        <form onsubmit={(e) => { e.preventDefault(); handleUpdateSupplySource(product.id); }} style="display: flex; gap: 8px; flex-wrap: wrap; padding: 8px 10px; background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 6px; align-items: flex-end;">
                                          <div style="flex: 1.5; min-width: 140px;">
                                            <label for="edit-supply-vendor-{s.id}" style="display: block; font-size: 0.7rem; color: var(--text-muted);">供應商</label>
                                            <select id="edit-supply-vendor-{s.id}" bind:value={editSupplyVendorId} class="form-input" style="width: 100%; padding: 4px 6px; font-size: 0.75rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);">
                                              {#each vendorPartners as vp}
                                                <option value={vp.id}>{vp.name}</option>
                                              {/each}
                                            </select>
                                          </div>
                                          <div style="width: 90px;">
                                            <label for="edit-supply-cost-{s.id}" style="display: block; font-size: 0.7rem; color: var(--text-muted);">採購成本</label>
                                            <input id="edit-supply-cost-{s.id}" type="number" min="0" step="any" class="form-input" bind:value={editSupplyCost} style="width: 100%; padding: 4px 6px; font-size: 0.75rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);" />
                                          </div>
                                          <div style="width: 80px;">
                                            <label for="edit-supply-currency-{s.id}" style="display: block; font-size: 0.7rem; color: var(--text-muted);">幣別</label>
                                            <input id="edit-supply-currency-{s.id}" type="text" class="form-input" bind:value={editSupplyCurrency} style="width: 100%; padding: 4px 6px; font-size: 0.75rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);" />
                                          </div>
                                          <label style="display: flex; align-items: center; gap: 4px; font-size: 0.75rem; margin-bottom: 6px; cursor: pointer;">
                                            <input type="checkbox" bind:checked={editSupplyIsPrimary} />
                                            主要來源
                                          </label>
                                          <div style="display: flex; gap: 4px; margin-left: auto;">
                                            <button type="submit" class="btn btn-primary btn-xs" disabled={isUpdatingSupply} style="padding: 4px 10px; font-size: 0.75rem;">
                                              {isUpdatingSupply ? '儲存中...' : '儲存'}
                                            </button>
                                            <button type="button" class="btn btn-outline btn-xs" onclick={cancelEditSupplySource} style="padding: 4px 8px; font-size: 0.75rem;">
                                              取消
                                            </button>
                                          </div>
                                        </form>
                                      {:else}
                                        <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: rgba(255, 255, 255, 0.02); border-radius: 4px; font-size: 0.8rem;">
                                          <div>
                                            <span style="font-weight: 600;">🏭 {getVendorName(s.vendor_partner_id)}</span>
                                            {#if s.is_primary}
                                              <span class="badge badge-amber" style="font-size: 0.65rem; margin-left: 6px;">主要來源</span>
                                            {/if}
                                            {#if matchedUnit}
                                              <span class="badge" style="font-size: 0.65rem; margin-left: 6px; background: rgba(59, 130, 246, 0.15); color: #60a5fa;">
                                                單位: {matchedUnit.unit_name} (x{matchedUnit.conversion_ratio})
                                              </span>
                                            {/if}
                                            {#if matchedVar && (expandedProductDetail.variants || []).length > 1}
                                              <span class="badge" style="font-size: 0.65rem; margin-left: 6px; background: rgba(255,255,255,0.06);">{matchedVar.name}</span>
                                            {/if}
                                            {#if s.vendor_product_code}
                                              <span style="color: var(--text-muted); font-size: 0.72rem; margin-left: 6px;">(廠商型號: {s.vendor_product_code})</span>
                                            {/if}
                                          </div>
                                          <div style="display: flex; align-items: center; gap: 10px;">
                                            <div style="font-weight: 600; color: #f59e0b;">
                                              採購成本: ${s.purchase_cost ?? s.cost} {s.currency}
                                            </div>
                                            <button
                                              type="button"
                                              class="btn btn-outline btn-xs"
                                              style="padding: 1px 7px; font-size: 0.68rem;"
                                              onclick={() => startEditSupplySource(s)}
                                            >
                                              ✏️ 編輯
                                            </button>
                                          </div>
                                        </div>
                                      {/if}
                                    {/each}
                                  {/if}
                                </div>
                                <form onsubmit={(e) => { e.preventDefault(); handleAddSupplySource(product.id); }} style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; align-items: flex-end;">
                                  <div style="width: 150px;">
                                    <label for="new-supply-unit-{product.id}" style="display: block; font-size: 0.7rem; color: var(--text-muted);">選擇銷售單位</label>
                                    <select id="new-supply-unit-{product.id}" bind:value={newSupplyUnitId} class="form-input" style="width: 100%; padding: 5px 8px; font-size: 0.8rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);">
                                      {#each (expandedProductDetail.units || []) as u}
                                        {@const uVar = (expandedProductDetail.variants || []).find(v => v.id === u.variant_id)}
                                        <option value={u.id}>
                                          {u.unit_name} (x{u.conversion_ratio}){uVar && (expandedProductDetail.variants || []).length > 1 ? ` - ${uVar.name}` : ''}
                                        </option>
                                      {/each}
                                    </select>
                                  </div>
                                  <div style="flex: 1.5; min-width: 140px;">
                                    <label for="new-supply-vendor-{product.id}" style="display: block; font-size: 0.7rem; color: var(--text-muted);">選擇供應商</label>
                                    <select id="new-supply-vendor-{product.id}" bind:value={newSupplyVendorId} class="form-input" style="width: 100%; padding: 5px 8px; font-size: 0.8rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);">
                                      <option value="">-- 請選擇供應商 --</option>
                                      {#each vendorPartners as vp}
                                        <option value={vp.id}>{vp.name}</option>
                                      {/each}
                                    </select>
                                  </div>
                                  <div style="width: 90px;">
                                    <label for="new-supply-cost-{product.id}" style="display: block; font-size: 0.7rem; color: var(--text-muted);">採購成本</label>
                                    <input id="new-supply-cost-{product.id}" type="number" min="0" step="any" class="form-input" placeholder="0" bind:value={newSupplyCost} style="width: 100%; padding: 5px 8px; font-size: 0.8rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);" />
                                  </div>
                                  <div style="width: 100px;">
                                    <label for="new-supply-code-{product.id}" style="display: block; font-size: 0.7rem; color: var(--text-muted);">廠商料號(選填)</label>
                                    <input id="new-supply-code-{product.id}" type="text" class="form-input" placeholder="VND-001" bind:value={newSupplyCode} style="width: 100%; padding: 5px 8px; font-size: 0.8rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);" />
                                  </div>
                                  <button type="submit" class="btn btn-outline btn-xs" disabled={isAddingSupply} style="height: 28px; white-space: nowrap; padding: 0 12px;">
                                    + 新增供應商
                                  </button>
                                </form>
                              </div>

                            <!-- Tab: BOM -->
                            {:else if productDetailTab === 'bom'}
                              <div style="display: flex; flex-direction: column; gap: 8px;">
                                <div style="display: flex; flex-direction: column; gap: 6px;">
                                  {#if (expandedProductDetail.bom_items || []).length === 0}
                                    <div style="font-size: 0.75rem; color: var(--text-muted); padding: 4px 0;">尚未建立任何 BOM 子物料清單。</div>
                                  {:else}
                                    {#each expandedProductDetail.bom_items as b (b.id)}
                                      <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: rgba(255, 255, 255, 0.02); border-radius: 4px; font-size: 0.8rem;">
                                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                          <span style="font-weight: 600; color: var(--text-primary);">🧱 {getChildMaterialDisplayName(b)}</span>
                                          {#if b.child_variant_name}
                                            <span style="font-size: 0.72rem; padding: 1px 6px; border-radius: 4px; background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3);">
                                              規格: {b.child_variant_name}
                                            </span>
                                          {/if}
                                          {#if b.child_sku}
                                            <span style="font-size: 0.72rem; color: var(--text-muted); font-family: monospace;">
                                              SKU: {b.child_sku}
                                            </span>
                                          {/if}
                                          <span style="color: var(--text-muted); font-size: 0.7rem; opacity: 0.75;" title="子物料變體 ID">
                                            (#{b.child_variant_id})
                                          </span>
                                          {#if b.loss_rate > 0}
                                            <span style="color: var(--text-muted); font-size: 0.72rem;">(損耗率: {(b.loss_rate * 100).toFixed(1)}%)</span>
                                          {/if}
                                        </div>
                                        <div style="font-weight: 600; color: #a855f7; white-space: nowrap;">
                                          耗用量: {b.quantity}
                                        </div>
                                      </div>
                                    {/each}
                                  {/if}
                                </div>
                                <form onsubmit={(e) => { e.preventDefault(); handleAddBomItem(product.id); }} style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; align-items: flex-end;">
                                  {#if (expandedProductDetail?.variants || []).length > 1}
                                    <div style="width: 120px;">
                                      <label for="new-bom-parent-{product.id}" style="display: block; font-size: 0.7rem; color: var(--text-muted);">主產品規格</label>
                                      <select id="new-bom-parent-{product.id}" bind:value={newBomParentVariantId} class="form-input" style="width: 100%; padding: 5px 8px; font-size: 0.8rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);">
                                        {#each (expandedProductDetail.variants || []) as v}
                                          <option value={v.id}>{v.name}{v.is_default ? ' (預設)' : ''}</option>
                                        {/each}
                                      </select>
                                    </div>
                                  {/if}
                                  <div style="flex: 1.5; min-width: 140px;">
                                    <label for="new-bom-child-{product.id}" style="display: block; font-size: 0.7rem; color: var(--text-muted);">選擇原料或子規格</label>
                                    <select id="new-bom-child-{product.id}" bind:value={newBomChildVariantId} class="form-input" style="width: 100%; padding: 5px 8px; font-size: 0.8rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);">
                                      <option value="">-- 請選擇原料/物料 --</option>
                                      {#each detailBomCandidates as otherProd}
                                        <option value={otherProd.id}>{otherProd.name} ({otherProd.category === 'raw_material' ? '原物料' : (otherProd.category === 'manufactured' ? '半成品/自製品' : '轉售/可採購品')})</option>
                                      {/each}
                                    </select>
                                  </div>
                                  <div style="width: 80px;">
                                    <label for="new-bom-qty-{product.id}" style="display: block; font-size: 0.7rem; color: var(--text-muted);">用量</label>
                                    <input id="new-bom-qty-{product.id}" type="number" min="0.0001" step="any" class="form-input" placeholder="1" bind:value={newBomQuantity} style="width: 100%; padding: 5px 8px; font-size: 0.8rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);" />
                                  </div>
                                  <button type="submit" class="btn btn-outline btn-xs" disabled={isAddingBom || detailBomCandidates.length === 0} style="height: 28px; white-space: nowrap; padding: 0 12px;">
                                    + 加入 BOM
                                  </button>
                                  {#if detailBomCandidates.length === 0}
                                    <div style="width: 100%; font-size: 0.75rem; color: #f59e0b; margin-top: 4px;">
                                      ⚠️ 目前系統尚無其他可作為組成材料的商品，請先建立其他商品。
                                    </div>
                                  {/if}
                                </form>
                              </div>
                            {/if}
                          {/if}
                        </div>
                      {/if}
                    </div>
                  {/each}
                </SettingsEntityCard>

                <!-- Warehouse Management (Warehouse Master) -->
                <SettingsEntityCard
                  title="倉庫管理 (Warehouse Master)"
                  description="管理實體倉庫據點與分倉維度（支援預設倉設定、代碼維護與庫存防停用檢核）。"
                  onRefresh={fetchWarehouses}
                  refreshLabel="重新整理倉庫"
                  errorMessage={warehouseError}
                  isEmpty={appState.warehouses.length === 0}
                  emptyMessage="目前尚無倉庫資料，請先新增第一個倉庫（將自動成為預設倉）。"
                  listClass="warehouse-list"
                  listStyle="display: flex; flex-direction: column; gap: 8px;"
                >
                  {#snippet form()}
                    <!-- Add Warehouse Form -->
                    <form onsubmit={handleCreateWarehouse} class="warehouse-add-form" style="display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; padding: 14px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color); border-radius: var(--radius-sm); margin-bottom: 16px;">
                      <div style="flex: 1; min-width: 140px;">
                        <label for="warehouse-code-input" style="display: block; font-size: 0.75rem; color: var(--text-muted); margin-bottom: 4px;">倉庫代碼 *</label>
                        <input
                          id="warehouse-code-input"
                          type="text"
                          class="form-input"
                          placeholder="例：WH-TPE、WH-01"
                          bind:value={newWarehouseCode}
                          style="width: 100%; padding: 7px 10px; font-size: 0.85rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);"
                        />
                      </div>
                      <div style="flex: 1.5; min-width: 180px;">
                        <label for="warehouse-name-input" style="display: block; font-size: 0.75rem; color: var(--text-muted); margin-bottom: 4px;">倉庫名稱 *</label>
                        <input
                          id="warehouse-name-input"
                          type="text"
                          class="form-input"
                          placeholder="例：台北總倉、高雄分倉"
                          bind:value={newWarehouseName}
                          style="width: 100%; padding: 7px 10px; font-size: 0.85rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);"
                        />
                      </div>
                      <button
                        type="submit"
                        class="btn btn-primary btn-sm"
                        disabled={isAddingWarehouse}
                        style="height: 35px; white-space: nowrap; padding: 0 16px;"
                        id="btn-add-warehouse"
                      >
                        {#if isAddingWarehouse}新增中...{:else}+ 新增倉庫{/if}
                      </button>
                    </form>
                  {/snippet}

                  {#each appState.warehouses as wh (wh.id)}
                    <div class="warehouse-item" style="display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border-radius: 6px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color);">
                      {#if editingWarehouseId === wh.id}
                        <!-- Inline Edit Mode -->
                        <form onsubmit={(e) => { e.preventDefault(); handleSaveEditWarehouse(wh.id); }} style="display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end;">
                          <div style="flex: 1; min-width: 120px;">
                            <label for="edit-wh-code-{wh.id}" style="display: block; font-size: 0.75rem; color: var(--text-muted); margin-bottom: 4px;">代碼</label>
                            <input
                              id="edit-wh-code-{wh.id}"
                              type="text"
                              class="form-input"
                              bind:value={editWarehouseCode}
                              style="width: 100%; padding: 6px 8px; font-size: 0.85rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);"
                            />
                          </div>
                          <div style="flex: 1.5; min-width: 160px;">
                            <label for="edit-wh-name-{wh.id}" style="display: block; font-size: 0.75rem; color: var(--text-muted); margin-bottom: 4px;">名稱</label>
                            <input
                              id="edit-wh-name-{wh.id}"
                              type="text"
                              class="form-input"
                              bind:value={editWarehouseName}
                              style="width: 100%; padding: 6px 8px; font-size: 0.85rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);"
                            />
                          </div>
                          <div style="display: flex; gap: 6px;">
                            <button type="submit" class="btn btn-primary btn-xs" disabled={isSavingWarehouse} style="height: 31px; padding: 0 12px;">儲存</button>
                            <button type="button" class="btn btn-outline btn-xs" onclick={handleCancelEditWarehouse} style="height: 31px; padding: 0 10px;">取消</button>
                          </div>
                        </form>
                      {:else}
                        <!-- Display Mode -->
                        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                          <div style="display: flex; align-items: center; gap: 12px;">
                            <div style="width: 36px; height: 36px; border-radius: 8px; background: rgba(var(--accent-amber), 0.12); border: 1px solid rgba(var(--accent-amber), 0.3); display: flex; align-items: center; justify-content: center; font-size: 1.1rem;">
                              🏬
                            </div>
                            <div>
                              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                <span style="font-weight: 600; color: var(--text-primary); font-size: 0.92rem;">{wh.name}</span>
                                <span class="badge badge-slate" style="font-family: monospace; font-size: 0.75rem;">{wh.code}</span>
                                {#if wh.is_default}
                                  <span class="badge badge-amber" style="font-size: 0.72rem; font-weight: 600;">
                                    ★ 預設倉
                                  </span>
                                {/if}
                                {#if wh.is_active}
                                  <span class="badge badge-emerald" style="font-size: 0.72rem;">啟用中</span>
                                {:else}
                                  <span class="badge badge-slate" style="font-size: 0.72rem; opacity: 0.7;">已停用</span>
                                {/if}
                              </div>
                              <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px; font-family: monospace;">ID: {wh.id}</div>
                            </div>
                          </div>

                          <div style="display: flex; align-items: center; gap: 6px;">
                            {#if !wh.is_default && wh.is_active}
                              <button
                                type="button"
                                class="btn btn-outline btn-xs"
                                onclick={() => handleSetDefaultWarehouse(wh.id)}
                                title="將此倉庫設為開單與開帳預設倉"
                              >
                                設為預設
                              </button>
                            {/if}
                            <button
                              type="button"
                              class="btn btn-outline btn-xs"
                              onclick={() => handleStartEditWarehouse(wh)}
                            >
                              編輯
                            </button>
                            {#if wh.is_active}
                              {#if !wh.is_default}
                                <button
                                  type="button"
                                  class="btn btn-outline btn-xs"
                                  style="color: #ef4444; border-color: rgba(239, 68, 68, 0.3);"
                                  onclick={() => handleDeactivateWarehouse(wh.id)}
                                >
                                  停用
                                </button>
                              {/if}
                            {:else}
                              <button
                                type="button"
                                class="btn btn-outline btn-xs"
                                style="color: #10b981; border-color: rgba(16, 185, 129, 0.3);"
                                onclick={() => handleReactivateWarehouse(wh.id)}
                              >
                                重新啟用
                              </button>
                            {/if}
                          </div>
                        </div>
                      {/if}
                    </div>
                  {/each}
                </SettingsEntityCard>
              </div>
            </div>
          {:else if activeTab === 'warehouses' || activeTab === 'inventory'}
            <!-- Warehouse Management Workspace View (Issue #182) -->
            <WarehouseWorkspace />
          {:else if activeTab === 'purchase-orders'}
            <!-- Purchase Orders Workspace View (Issue #165) -->
            <PurchaseOrdersWorkspace />
          {:else}
            <!-- AI Chat Conversation Primary View -->
            <ChatBox />
          {/if}
        </div>

        <!-- 4. Right Status Overview Panel -->
        <StatusOverview />
      </div>
    </div>

    <!-- 5. Bottom Statusbar (28px) -->
    <footer class="shell-statusbar">
      <div class="statusbar-left">
        <span class="statusbar-dot"></span>
        <span>邊緣資料庫：SQLite 已連線</span>
      </div>
      <div class="statusbar-right">
        <span>Provider: NVIDIA NIM</span>
      </div>
    </footer>

    <!-- Global Create Warehouse Modal (M12 Single Entry) -->
    <CreateWarehouseModal />
  </div>
{/if}

<!-- Toast Popup Notification (UX feedback for update checker) -->
{#if appState.toastMessage}
  <div class="toast-popup glass-panel">
    <div class="toast-body">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: rgb(74, 222, 128);"><polyline points="20 6 9 17 4 12"></polyline></svg>
      <span>{appState.toastMessage}</span>
    </div>
  </div>
{/if}

<style>
  .workspace-scrollable {
    flex-grow: 1;
    overflow-y: auto;
    padding: 24px;
    background: #0D0E12;
  }



  .filter-row {
    display: flex;
    gap: 8px;
  }

  .filter-btn {
    flex-grow: 1;
    padding: 8px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    cursor: pointer;
    font-family: inherit;
    font-size: 0.85rem;
    font-weight: 500;
  }

  .filter-btn.active {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border-color: var(--border-active);
  }



  /* Settings Page */
  .settings-layout {
    display: flex;
    flex-direction: column;
    gap: 24px;
    max-width: 900px;
    margin: 0 auto;
  }

  .settings-group {
    padding: 24px;
  }

  .settings-group h3 {
    margin-bottom: 6px;
    font-size: 1.05rem;
  }

  .settings-desc {
    color: var(--text-secondary);
    font-size: 0.88rem;
    margin-bottom: 16px;
  }

  .audit-list {
    max-height: 240px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 10px;
  }

  .audit-item {
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    padding: 14px;
  }

  .audit-meta {
    display: flex;
    justify-content: space-between;
    margin-bottom: 6px;
    font-size: 0.85rem;
  }

  .audit-time {
    color: var(--text-muted);
  }

  .audit-body {
    display: flex;
    gap: 24px;
    font-size: 0.95rem;
  }

  .empty-audit {
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  /* Updater Banner */
  .update-banner {
    border-color: rgba(var(--accent-amber), 0.3);
    background: rgba(var(--accent-amber), 0.03);
    padding: 16px 20px;
    margin: 16px 24px 0;
    flex-shrink: 0;
    animation: slideIn var(--transition-smooth) forwards;
  }

  .update-banner-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 6px;
  }

  .update-notes-preview {
    font-size: 0.88rem;
    color: var(--text-secondary);
    white-space: pre-wrap;
    margin-bottom: 12px;
  }

  .update-action-row {
    display: flex;
    align-items: center;
  }

  .update-progress-layout {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .progress-percent {
    font-size: 0.85rem;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .progress-bar-container {
    width: 100%;
    height: 6px;
    background: var(--bg-tertiary);
    border-radius: 3px;
    overflow: hidden;
    position: relative;
  }

  .progress-bar-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 3px;
    width: 0%;
    transition: width 0.1s linear;
  }

  .relaunch-status {
    display: flex;
    align-items: center;
    gap: 10px;
    color: rgb(var(--accent-amber));
    font-weight: 500;
  }

  .spinner-icon {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(var(--accent-amber), 0.3);
    border-top-color: rgb(var(--accent-amber));
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Toast Popup Styles */
  .toast-popup {
    position: fixed;
    bottom: 36px;
    right: 24px;
    z-index: 9999;
    padding: 12px 20px;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(18, 18, 18, 0.85);
    backdrop-filter: blur(16px);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
    animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  .toast-body {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 0.9rem;
    color: var(--text-primary);
    font-weight: 500;
  }


</style>
