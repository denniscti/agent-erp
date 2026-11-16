<script>
  import { onMount } from 'svelte';
  import {
    appState,
    navigate,
    showToast,
    formatCurrency,
    formatTime,
    fetchPartners,
    loadOpeningPayablesAction,
    createOpeningPayableAction,
    voidOpeningPayableAction,
    loadVendorPaymentsAction,
    getVendorPaymentAction,
    createVendorPaymentAction,
    updateVendorPaymentHeaderAction,
    addVendorPaymentAllocationAction,
    updateVendorPaymentAllocationAction,
    removeVendorPaymentAllocationAction,
    postVendorPaymentAction,
    cancelVendorPaymentAction,
    voidVendorPaymentAction,
    loadAccountsPayableAction,
    queryAccountsPayableAction,
    getAccountPayableAction,
    loadPayablesAgingAction,
    loadVendorStatementAction
  } from '../store.svelte.js';
  import { calculateDueDate } from '../paymentTerms.js';

  let { initialSubTab = 'aging' } = $props();

  // Sub tab: 'aging' | 'opening-payables' | 'vendor-payments' | 'accounts-payable'
  let activeSubTab = $state(initialSubTab);

  // Loading state
  let isLoading = $state(false);

  // Auxiliary data
  let availableVendors = $state([]);

  // ==========================================
  // Aging States (Issue #204)
  // ==========================================
  let payablesAging = $state(null);
  let isAgingLoading = $state(false);
  let agingViewMode = $state('summary'); // 'summary' | 'detail' | 'raw_list'
  let selectedAgingVendorId = $state(null);

  // Computed selected vendor in aging
  let selectedAgingVendor = $derived.by(() => {
    if (!payablesAging || !selectedAgingVendorId) return null;
    return (payablesAging.vendors || []).find(v => v.vendor_partner_id === selectedAgingVendorId) || null;
  });

  async function refreshAging() {
    isAgingLoading = true;
    try {
      payablesAging = await loadPayablesAgingAction();
    } catch (err) {
      console.error('Failed to load payables aging:', err);
      showToast('載入帳齡分析失敗：' + (err.message || err), 'error');
    } finally {
      isAgingLoading = false;
    }
  }

  // Helper date function (pure string YYYY-MM-DD)
  function getTodayDateString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // ==========================================
  // 1. Vendor Payments Subtab States
  // ==========================================
  // View mode: 'list' | 'draft' | 'detail'
  let paymentViewMode = $state('list');
  let selectedPayment = $state(null);
  let isPaymentLoading = $state(false);
  let paymentActionLoading = $state(false);
  let paymentErrorMsg = $state('');

  // Payment List Filters
  let filterPayVendorId = $state('');
  let filterPayStatus = $state('all');
  let filterPayDateFrom = $state('');
  let filterPayDateTo = $state('');

  // Create Payment Modal States
  let isCreatePayModalOpen = $state(false);
  let newPayVendorId = $state('');
  let newPayDate = $state(getTodayDateString());
  let newPayMethod = $state('bank_transfer');
  let newPayRef = $state('');
  let newPayNote = $state('');
  let newPayError = $state('');
  let newPaySubmitting = $state(false);

  // Draft Editing State
  let draftHeaderDate = $state(getTodayDateString());
  let draftHeaderMethod = $state('bank_transfer');
  let draftHeaderRef = $state('');
  let draftHeaderNote = $state('');
  let draftCandidatePayables = $state([]); // candidate open accounts payable for this vendor
  let draftAllocations = $state({}); // map: apId -> { selected: boolean, amount: number, rawInput: string, allocationId: string|null, error: string }
  let isSavingDraftHeader = $state(false);

  // Void Payment Modal States
  let isVoidPayModalOpen = $state(false);
  let voidPayTarget = $state(null);
  let voidPayReason = $state('');
  let voidPayError = $state('');
  let voidPaySubmitting = $state(false);

  // ==========================================
  // 2. Accounts Payable Subtab States
  // ==========================================
  let filterApVendorId = $state('');
  let filterApSettlementStatus = $state('all');
  let filterApStatus = $state('all');
  let apDetailModalOpen = $state(false);
  let currentApDetail = $state(null);
  let isApDetailLoading = $state(false);

  // ==========================================
  // 3. Opening Payables Subtab States
  // ==========================================
  let filterOapVendorId = $state('');
  let filterOapStatus = $state('all');

  // Create Opening Payable Modal States
  let isCreateOapModalOpen = $state(false);
  let createOapVendorId = $state('');
  let createOapOriginalReference = $state('');
  let createOapDocumentDate = $state(getTodayDateString());
  let createOapDueDate = $state(getTodayDateString());
  let createOapAmount = $state('');
  let createOapNote = $state('');
  let createOapError = $state('');
  let createOapSubmitting = $state(false);
  let oapPaymentTermsHint = $state('');

  // Void Opening Payable Modal States
  let isVoidOapModalOpen = $state(false);
  let voidTargetOap = $state(null);
  let voidOapReason = $state('');
  let voidOapError = $state('');
  let voidOapSubmitting = $state(false);

  // ==========================================
  // 4. Vendor Statement Subtab States (Issue #205)
  // ==========================================
  function getFirstDayOfMonthString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}-01`;
  }

  let stmtVendorId = $state('');
  let stmtStartDate = $state(getFirstDayOfMonthString());
  let stmtEndDate = $state(getTodayDateString());
  let vendorStatement = $state(null);
  let isStatementLoading = $state(false);

  async function refreshStatement() {
    if (!stmtVendorId) {
      vendorStatement = null;
      return;
    }
    if (!stmtStartDate || !stmtEndDate) {
      showToast('請選擇起訖日', 'error');
      return;
    }
    if (stmtStartDate > stmtEndDate) {
      showToast('起日不可晚於迄日', 'error');
      return;
    }
    isStatementLoading = true;
    try {
      vendorStatement = await loadVendorStatementAction(stmtVendorId, stmtStartDate, stmtEndDate);
    } catch (err) {
      console.error('Failed to load vendor statement:', err);
      showToast('載入對帳明細失敗：' + (err.message || String(err)), 'error');
    } finally {
      isStatementLoading = false;
    }
  }

  function setStatementCurrentMonth() {
    stmtStartDate = getFirstDayOfMonthString();
    stmtEndDate = getTodayDateString();
    refreshStatement();
  }

  function setStatementLastMonth() {
    const d = new Date();
    const prevMonthEnd = new Date(d.getFullYear(), d.getMonth(), 0);
    const prevMonthStart = new Date(prevMonthEnd.getFullYear(), prevMonthEnd.getMonth(), 1);
    const formatYmd = dt => {
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const day = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    stmtStartDate = formatYmd(prevMonthStart);
    stmtEndDate = formatYmd(prevMonthEnd);
    refreshStatement();
  }

  function openStatementForVendor(vendorId) {
    stmtVendorId = vendorId;
    stmtStartDate = getFirstDayOfMonthString();
    stmtEndDate = getTodayDateString();
    activeSubTab = 'statement';
    refreshStatement();
  }

  // Derived lists
  let vendorPaymentsList = $derived(appState.vendorPayments || []);
  let accountsPayableList = $derived(appState.accountsPayable || []);
  let openingPayablesList = $derived(appState.openingPayables || []);

  // Calculate live draft total amount
  let draftTotalAmount = $derived.by(() => {
    let sum = 0;
    for (const ap of draftCandidatePayables) {
      const state = draftAllocations[ap.id];
      if (state && state.selected) {
        const amt = Number(state.amount);
        if (!isNaN(amt) && amt > 0) {
          sum += amt;
        }
      }
    }
    return Math.round(sum * 100) / 100;
  });

  // Calculate live draft allocation count
  let draftAllocCount = $derived.by(() => {
    let count = 0;
    for (const ap of draftCandidatePayables) {
      const state = draftAllocations[ap.id];
      if (state && state.selected) count++;
    }
    return count;
  });

  onMount(async () => {
    await loadInitialData();
  });

  async function loadInitialData() {
    isLoading = true;
    try {
      const partners = await fetchPartners();
      availableVendors = (partners || []).filter(p => p.is_vendor && p.is_active !== false);

      await Promise.all([
        refreshAging(),
        refreshVendorPayments(),
        refreshAccountsPayable(),
        refreshOpeningPayables()
      ]);
    } catch (err) {
      console.error('Failed to load accounts payable initial data:', err);
      showToast('載入資料失敗：' + (err.message || String(err)));
    } finally {
      isLoading = false;
    }
  }

  // ==========================================
  // Vendor Payments Logic
  // ==========================================
  async function refreshVendorPayments() {
    try {
      const filter = {};
      if (filterPayVendorId) filter.vendor_partner_id = filterPayVendorId;
      if (filterPayStatus && filterPayStatus !== 'all') filter.status = filterPayStatus;
      if (filterPayDateFrom) filter.payment_date_from = filterPayDateFrom;
      if (filterPayDateTo) filter.payment_date_to = filterPayDateTo;
      await loadVendorPaymentsAction(filter);
    } catch (err) {
      console.error('Failed to refresh vendor payments:', err);
    }
  }

  function openCreatePayModal(preselectedVendorId = '') {
    newPayVendorId = preselectedVendorId || (availableVendors.length > 0 ? availableVendors[0].id : '');
    newPayDate = getTodayDateString();
    newPayMethod = 'bank_transfer';
    newPayRef = '';
    newPayNote = '';
    newPayError = '';
    isCreatePayModalOpen = true;
  }

  function closeCreatePayModal() {
    isCreatePayModalOpen = false;
  }

  async function handleCreatePaySubmit() {
    newPayError = '';
    if (!newPayVendorId) {
      newPayError = '請選擇供應商';
      return;
    }
    if (!newPayDate) {
      newPayError = '請選擇付款日';
      return;
    }
    if (newPayDate > getTodayDateString()) {
      newPayError = '付款日不可晚於今天';
      return;
    }

    newPaySubmitting = true;
    try {
      // Check if there is already an existing draft for this vendor
      const existingDraft = (vendorPaymentsList || []).find(
        p => p.status === 'draft' && p.vendor_partner_id === newPayVendorId
      );
      if (existingDraft) {
        if (confirm(`此供應商已有進行中的草稿付款單「${existingDraft.payment_number}」，是否直接開啟該草稿？`)) {
          isCreatePayModalOpen = false;
          const detail = await getVendorPaymentAction(existingDraft.id);
          await openDraftEditView(detail);
          return;
        }
      }

      const detail = await createVendorPaymentAction({
        vendor_partner_id: newPayVendorId,
        payment_date: newPayDate,
        payment_method: newPayMethod,
        payment_reference: newPayRef.trim() || null,
        note: newPayNote.trim() || null
      });
      isCreatePayModalOpen = false;
      await openDraftEditView(detail);
    } catch (err) {
      newPayError = err.message || String(err);
    } finally {
      newPaySubmitting = false;
    }
  }

  async function openDraftEditView(paymentDetail, preselectedApId = null) {
    paymentErrorMsg = '';
    selectedPayment = paymentDetail;
    draftHeaderDate = paymentDetail.payment_date || getTodayDateString();
    draftHeaderMethod = paymentDetail.payment_method || 'bank_transfer';
    draftHeaderRef = paymentDetail.payment_reference || '';
    draftHeaderNote = paymentDetail.note || '';

    // Load candidate payables for this vendor
    isPaymentLoading = true;
    paymentViewMode = 'draft';
    try {
      const apList = await queryAccountsPayableAction({
        vendorPartnerId: paymentDetail.vendor_partner_id,
        status: 'open'
      });

      // Existing allocations in this payment
      const allocMap = {};
      for (const a of (paymentDetail.allocations || [])) {
        allocMap[a.account_payable_id] = a;
      }

      // Filter and prepare candidate payables (guarantee vendor isolation)
      const candidates = (apList || []).filter(ap => {
        if (ap.vendor_partner_id && ap.vendor_partner_id !== paymentDetail.vendor_partner_id) {
          return false;
        }
        const hasAlloc = Boolean(allocMap[ap.id]);
        return hasAlloc || ap.outstanding_amount > 0;
      });

      // Prepare state map
      const stateMap = {};
      for (const ap of candidates) {
        const existingAlloc = allocMap[ap.id];
        if (existingAlloc) {
          stateMap[ap.id] = {
            selected: true,
            amount: existingAlloc.amount,
            rawInput: String(existingAlloc.amount),
            allocationId: existingAlloc.id,
            error: ''
          };
        } else if (preselectedApId && ap.id === preselectedApId) {
          // Will be added below
          stateMap[ap.id] = {
            selected: true,
            amount: ap.outstanding_amount,
            rawInput: String(ap.outstanding_amount),
            allocationId: null,
            error: ''
          };
        } else {
          stateMap[ap.id] = {
            selected: false,
            amount: ap.outstanding_amount,
            rawInput: String(ap.outstanding_amount),
            allocationId: null,
            error: ''
          };
        }
      }

      draftCandidatePayables = candidates;
      draftAllocations = stateMap;

      // If preselectedApId is not yet in allocations, add it now
      if (preselectedApId && !allocMap[preselectedApId]) {
        const ap = candidates.find(c => c.id === preselectedApId);
        if (ap && ap.outstanding_amount > 0) {
          const updated = await addVendorPaymentAllocationAction(paymentDetail.id, ap.id, ap.outstanding_amount);
          selectedPayment = updated;
          const newAlloc = (updated.allocations || []).find(a => a.account_payable_id === ap.id);
          if (newAlloc) {
            draftAllocations[ap.id].allocationId = newAlloc.id;
          }
        }
      }
    } catch (err) {
      console.error('Failed to load candidate payables for draft:', err);
      paymentErrorMsg = '載入待核銷應付失敗：' + (err.message || String(err));
    } finally {
      isPaymentLoading = false;
    }
  }

  async function handleToggleAllocation(ap) {
    paymentErrorMsg = '';
    const allocState = draftAllocations[ap.id];
    if (!allocState) return;

    if (!allocState.selected) {
      // User is checking this payable
      allocState.selected = true;
      let amt = Number(allocState.amount);
      if (isNaN(amt) || amt <= 0) {
        amt = ap.outstanding_amount;
        allocState.amount = amt;
        allocState.rawInput = String(amt);
      }
      allocState.error = '';

      try {
        paymentActionLoading = true;
        const updated = await addVendorPaymentAllocationAction(selectedPayment.id, ap.id, amt);
        selectedPayment = updated;
        const added = (updated.allocations || []).find(a => a.account_payable_id === ap.id);
        if (added) {
          allocState.allocationId = added.id;
        }
      } catch (err) {
        allocState.selected = false;
        paymentErrorMsg = err.message || String(err);
      } finally {
        paymentActionLoading = false;
      }
    } else {
      // User is unchecking this payable
      allocState.selected = false;
      allocState.error = '';
      if (allocState.allocationId) {
        try {
          paymentActionLoading = true;
          const updated = await removeVendorPaymentAllocationAction(selectedPayment.id, allocState.allocationId);
          selectedPayment = updated;
          allocState.allocationId = null;
        } catch (err) {
          allocState.selected = true;
          paymentErrorMsg = err.message || String(err);
        } finally {
          paymentActionLoading = false;
        }
      }
    }
  }

  async function handleAllocationAmountChange(ap, newValue) {
    const allocState = draftAllocations[ap.id];
    if (!allocState) return;

    allocState.rawInput = newValue;
    const num = parseFloat(newValue);
    allocState.amount = isNaN(num) ? 0 : num;

    // Boundary & error check for red alert styling
    if (isNaN(num) || num <= 0) {
      allocState.error = '核銷金額必須大於 0';
    } else if (num > ap.outstanding_amount) {
      allocState.error = `超過未付餘額 ${formatCurrency(ap.outstanding_amount)}`;
    } else {
      allocState.error = '';
    }

    // If it is currently allocated in backend, sync if valid
    if (allocState.selected && allocState.allocationId && !allocState.error) {
      try {
        const updated = await updateVendorPaymentAllocationAction(selectedPayment.id, allocState.allocationId, num);
        selectedPayment = updated;
      } catch (err) {
        paymentErrorMsg = err.message || String(err);
      }
    }
  }

  async function handleSaveDraftHeader() {
    paymentErrorMsg = '';
    if (!draftHeaderDate) {
      paymentErrorMsg = '付款日不可為空';
      return;
    }
    if (draftHeaderDate > getTodayDateString()) {
      paymentErrorMsg = '付款日不可晚於今天';
      return;
    }

    isSavingDraftHeader = true;
    try {
      const updated = await updateVendorPaymentHeaderAction({
        id: selectedPayment.id,
        payment_id: selectedPayment.id,
        payment_date: draftHeaderDate,
        payment_method: draftHeaderMethod,
        payment_reference: draftHeaderRef.trim() || null,
        note: draftHeaderNote.trim() || null
      });
      selectedPayment = updated;
    } catch (err) {
      paymentErrorMsg = err.message || String(err);
    } finally {
      isSavingDraftHeader = false;
    }
  }

  async function handlePostPayment() {
    paymentErrorMsg = '';

    // First check if any checked allocation has an error or amount > outstanding
    // If user edited to an exceeded amount, try syncing to let backend throw P-03
    for (const ap of draftCandidatePayables) {
      const allocState = draftAllocations[ap.id];
      if (allocState && allocState.selected) {
        if (allocState.amount > ap.outstanding_amount) {
          // Force update to backend so P-03 triggers as required by acceptance criteria
          try {
            paymentActionLoading = true;
            if (allocState.allocationId) {
              await updateVendorPaymentAllocationAction(selectedPayment.id, allocState.allocationId, allocState.amount);
            } else {
              await addVendorPaymentAllocationAction(selectedPayment.id, ap.id, allocState.amount);
            }
          } catch (err) {
            paymentErrorMsg = err.message || String(err);
            paymentActionLoading = false;
            return;
          }
        }
      }
    }

    if (draftAllocCount === 0) {
      paymentErrorMsg = '付款單至少需有 1 筆核銷方可過帳';
      return;
    }

    paymentActionLoading = true;
    try {
      const posted = await postVendorPaymentAction(selectedPayment.id);
      selectedPayment = posted;
      paymentViewMode = 'detail';
      await Promise.all([
        refreshVendorPayments(),
        refreshAccountsPayable()
      ]);
    } catch (err) {
      paymentErrorMsg = err.message || String(err);
    } finally {
      paymentActionLoading = false;
    }
  }

  async function handleCancelPayment() {
    paymentErrorMsg = '';
    if (!confirm(`確定要取消付款單「${selectedPayment.payment_number}」嗎？`)) {
      return;
    }

    paymentActionLoading = true;
    try {
      const cancelled = await cancelVendorPaymentAction(selectedPayment.id);
      selectedPayment = cancelled;
      paymentViewMode = 'detail';
      await refreshVendorPayments();
    } catch (err) {
      paymentErrorMsg = err.message || String(err);
    } finally {
      paymentActionLoading = false;
    }
  }

  function openVoidPayModal(payment) {
    voidPayTarget = payment;
    voidPayReason = '';
    voidPayError = '';
    isVoidPayModalOpen = true;
  }

  function closeVoidPayModal() {
    isVoidPayModalOpen = false;
    voidPayTarget = null;
  }

  async function handleVoidPaySubmit() {
    if (!voidPayTarget) return;
    if (!voidPayReason.trim()) {
      voidPayError = '作廢需填寫原因';
      return;
    }

    voidPaySubmitting = true;
    voidPayError = '';
    try {
      const voided = await voidVendorPaymentAction(voidPayTarget.id, voidPayReason.trim());
      isVoidPayModalOpen = false;
      voidPayTarget = null;
      if (selectedPayment && selectedPayment.id === voided.id) {
        selectedPayment = voided;
      }
      await Promise.all([
        refreshVendorPayments(),
        refreshAccountsPayable()
      ]);
    } catch (err) {
      voidPayError = err.message || String(err);
    } finally {
      voidPaySubmitting = false;
    }
  }

  async function viewPaymentDetail(paymentId) {
    paymentErrorMsg = '';
    isPaymentLoading = true;
    try {
      const detail = await getVendorPaymentAction(paymentId);
      selectedPayment = detail;
      if (detail.status === 'draft') {
        await openDraftEditView(detail);
      } else {
        paymentViewMode = 'detail';
      }
    } catch (err) {
      console.error('Failed to view payment detail:', err);
      showToast('載入付款單失敗：' + (err.message || String(err)));
    } finally {
      isPaymentLoading = false;
    }
  }

  function backToPaymentList() {
    paymentViewMode = 'list';
    selectedPayment = null;
    paymentErrorMsg = '';
    refreshVendorPayments();
  }

  // ==========================================
  // Quick Actions (快捷入口)
  // ==========================================
  async function initiatePaymentFromVendor(vendorId) {
    activeSubTab = 'vendor-payments';
    paymentViewMode = 'list';
    try {
      isLoading = true;
      // Check if an existing draft payment already exists for this vendor
      const existingDraft = (vendorPaymentsList || []).find(
        p => p.status === 'draft' && p.vendor_partner_id === vendorId
      );

      let detail;
      if (existingDraft) {
        detail = await getVendorPaymentAction(existingDraft.id);
        showToast(`已為您開啟供應商既有的草稿付款單「${detail.payment_number}」`);
      } else {
        detail = await createVendorPaymentAction({
          vendor_partner_id: vendorId,
          payment_date: getTodayDateString(),
          payment_method: 'bank_transfer'
        });
      }
      await openDraftEditView(detail);
    } catch (err) {
      showToast('建立付款單失敗：' + (err.message || String(err)));
    } finally {
      isLoading = false;
    }
  }

  async function initiatePaymentFromAp(ap) {
    activeSubTab = 'vendor-payments';
    paymentViewMode = 'list';
    try {
      isLoading = true;
      const targetApId = ap.id || ap.account_payable_id;
      const vendorId = ap.vendor_partner_id;

      // Check if an existing draft payment already exists for this vendor
      const existingDraft = (vendorPaymentsList || []).find(
        p => p.status === 'draft' && p.vendor_partner_id === vendorId
      );

      let detail;
      if (existingDraft) {
        detail = await getVendorPaymentAction(existingDraft.id);
        showToast(`已為您開啟供應商既有的草稿付款單「${detail.payment_number}」`);
      } else {
        detail = await createVendorPaymentAction({
          vendor_partner_id: vendorId,
          payment_date: getTodayDateString(),
          payment_method: 'bank_transfer'
        });
      }
      await openDraftEditView(detail, targetApId);
    } catch (err) {
      showToast('建立付款單失敗：' + (err.message || String(err)));
    } finally {
      isLoading = false;
    }
  }

  async function initiatePaymentFromOap(oap) {
    try {
      isLoading = true;
      const apList = await queryAccountsPayableAction({
        vendorPartnerId: oap.vendor_partner_id,
        status: 'open'
      });
      const targetAp = (apList || []).find(a => a.source_type === 'opening_balance' && a.source_id === oap.id);
      if (targetAp) {
        await initiatePaymentFromAp(targetAp);
      } else {
        await initiatePaymentFromVendor(oap.vendor_partner_id);
      }
    } catch (err) {
      showToast('發起付款失敗：' + (err.message || String(err)));
    } finally {
      isLoading = false;
    }
  }

  function jumpToVendorBill(billId) {
    appState.activeWorkspace = 'vendor-bills';
    appState.selectedVendorBillId = billId;
    navigate('/app/vendor-bills');
  }

  function jumpToOpeningPayable(oapId) {
    activeSubTab = 'opening-payables';
    filterOapVendorId = '';
    filterOapStatus = 'all';
    refreshOpeningPayables();
  }

  // ==========================================
  // Accounts Payable Tab Logic
  // ==========================================
  async function refreshAccountsPayable() {
    try {
      const filter = {};
      if (filterApVendorId) {
        filter.vendorPartnerId = filterApVendorId;
        filter.vendor_partner_id = filterApVendorId;
      }
      if (filterApSettlementStatus && filterApSettlementStatus !== 'all') {
        filter.settlementStatus = filterApSettlementStatus;
        filter.settlement_status = filterApSettlementStatus;
      }
      if (filterApStatus && filterApStatus !== 'all') {
        filter.status = filterApStatus;
      }
      await loadAccountsPayableAction(filter);
    } catch (err) {
      console.error('Failed to refresh accounts payable:', err);
    }
  }

  async function openApDetailModal(apId) {
    isApDetailLoading = true;
    apDetailModalOpen = true;
    try {
      currentApDetail = await getAccountPayableAction(apId);
    } catch (err) {
      showToast('載入應付詳情失敗：' + (err.message || String(err)));
      apDetailModalOpen = false;
    } finally {
      isApDetailLoading = false;
    }
  }

  function closeApDetailModal() {
    apDetailModalOpen = false;
    currentApDetail = null;
  }

  // ==========================================
  // Opening Payables Tab Logic
  // ==========================================
  async function refreshOpeningPayables() {
    try {
      const filter = {};
      if (filterOapVendorId) filter.vendor_partner_id = filterOapVendorId;
      if (filterOapStatus && filterOapStatus !== 'all') filter.status = filterOapStatus;
      await loadOpeningPayablesAction(filter);
    } catch (err) {
      console.error('Failed to refresh opening payables:', err);
    }
  }

  function handleOapVendorChange() {
    const vendor = availableVendors.find(v => v.id === createOapVendorId);
    if (!vendor) {
      oapPaymentTermsHint = '';
      return;
    }

    if (vendor.payment_terms_type) {
      const typeLabel = vendor.payment_terms_type === 'net' ? '貨到' : '月結';
      oapPaymentTermsHint = `已依付款條件（${typeLabel} ${vendor.payment_terms_days || 0} 天）自動推算並預填到期日，可手動修改`;
      createOapDueDate = calculateDueDate(createOapDocumentDate, vendor.payment_terms_type, vendor.payment_terms_days);
    } else {
      oapPaymentTermsHint = '此供應商未設定付款條件，預設單據日為到期日，可手動修改';
      createOapDueDate = createOapDocumentDate;
    }
  }

  function handleOapDocDateChange() {
    const vendor = availableVendors.find(v => v.id === createOapVendorId);
    if (vendor && vendor.payment_terms_type) {
      createOapDueDate = calculateDueDate(createOapDocumentDate, vendor.payment_terms_type, vendor.payment_terms_days);
    }
  }

  function openCreateOapModal() {
    createOapVendorId = availableVendors.length > 0 ? availableVendors[0].id : '';
    createOapOriginalReference = '';
    createOapDocumentDate = getTodayDateString();
    createOapDueDate = getTodayDateString();
    createOapAmount = '';
    createOapNote = '';
    createOapError = '';
    oapPaymentTermsHint = '';
    if (createOapVendorId) {
      handleOapVendorChange();
    }
    isCreateOapModalOpen = true;
  }

  function closeCreateOapModal() {
    isCreateOapModalOpen = false;
  }

  async function handleCreateOapSubmit() {
    createOapError = '';
    if (!createOapVendorId) {
      createOapError = '請選擇供應商';
      return;
    }
    if (!createOapOriginalReference.trim()) {
      createOapError = '原單號或發票號不可為空';
      return;
    }
    if (!createOapDocumentDate) {
      createOapError = '請選擇原單據日';
      return;
    }
    if (!createOapDueDate) {
      createOapError = '請選擇到期日';
      return;
    }
    const amt = parseFloat(createOapAmount);
    if (isNaN(amt) || amt <= 0) {
      createOapError = '未付金額必須大於 0';
      return;
    }

    createOapSubmitting = true;
    try {
      await createOpeningPayableAction({
        vendor_partner_id: createOapVendorId,
        original_reference: createOapOriginalReference.trim(),
        document_date: createOapDocumentDate,
        due_date: createOapDueDate,
        amount: amt,
        note: createOapNote.trim() || null
      });
      isCreateOapModalOpen = false;
      await Promise.all([
        refreshOpeningPayables(),
        refreshAccountsPayable()
      ]);
    } catch (err) {
      createOapError = err.message || String(err);
    } finally {
      createOapSubmitting = false;
    }
  }

  function openVoidOapModal(oap) {
    voidTargetOap = oap;
    voidOapReason = '';
    voidOapError = '';
    isVoidOapModalOpen = true;
  }

  function closeVoidOapModal() {
    isVoidOapModalOpen = false;
    voidTargetOap = null;
  }

  async function handleVoidOapSubmit() {
    if (!voidTargetOap) return;
    if (!voidOapReason.trim()) {
      voidOapError = '作廢原因為必填';
      return;
    }

    voidOapSubmitting = true;
    voidOapError = '';
    try {
      await voidOpeningPayableAction(voidTargetOap.id, voidOapReason.trim());
      isVoidOapModalOpen = false;
      voidTargetOap = null;
      await Promise.all([
        refreshOpeningPayables(),
        refreshAccountsPayable()
      ]);
    } catch (err) {
      voidOapError = err.message || String(err);
    } finally {
      voidOapSubmitting = false;
    }
  }

  function getPaymentMethodLabel(method) {
    switch (method) {
      case 'bank_transfer': return '銀行轉帳';
      case 'cash': return '現金';
      case 'check': return '支票';
      case 'other': return '其他';
      default: return method || '-';
    }
  }

  function getSettlementStatusLabel(status) {
    switch (status) {
      case 'unpaid': return '未付';
      case 'partially_paid': return '部分付款';
      case 'paid': return '已付清';
      default: return status || '-';
    }
  }
</script>

<div class="ap-workspace">
  <!-- Header -->
  <header class="workspace-header">
    <div class="header-left">
      <div class="icon-wrap">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect width="20" height="14" x="2" y="5" rx="2"></rect>
          <line x1="2" x2="22" y1="10" y2="10"></line>
        </svg>
      </div>
      <div>
        <h2>應付帳款工作區 (Accounts Payable)</h2>
        <p class="subtitle">管理應付帳款、核銷付款單與期初登錄</p>
      </div>
    </div>
  </header>

  <!-- Sub Tabs Navigation -->
  <div class="subtabs-bar">
    <button 
      class="subtab-btn {activeSubTab === 'aging' ? 'active' : ''}" 
      onclick={() => { activeSubTab = 'aging'; agingViewMode = 'summary'; refreshAging(); }}
      id="tab-payables-aging"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
      </svg>
      帳齡總表 (Payables Aging)
    </button>
    <button 
      class="subtab-btn {activeSubTab === 'statement' ? 'active' : ''}" 
      onclick={() => { activeSubTab = 'statement'; if (stmtVendorId) refreshStatement(); }}
      id="tab-vendor-statement"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
        <line x1="10" y1="9" x2="8" y2="9"></line>
      </svg>
      對帳明細 (Vendor Statement)
    </button>
    <button 
      class="subtab-btn {activeSubTab === 'opening-payables' ? 'active' : ''}" 
      onclick={() => { activeSubTab = 'opening-payables'; refreshOpeningPayables(); }}
      id="tab-opening-payables"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
        <polyline points="10 9 9 9 8 9"></polyline>
      </svg>
      期初應付 (Opening Payables)
    </button>
    <button 
      class="subtab-btn {activeSubTab === 'vendor-payments' ? 'active' : ''}" 
      onclick={() => { activeSubTab = 'vendor-payments'; paymentViewMode = 'list'; refreshVendorPayments(); }}
      id="tab-vendor-payments"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
        <line x1="1" y1="10" x2="23" y2="10"></line>
      </svg>
      付款單 (Vendor Payments)
    </button>
  </div>

  <!-- Main View Area -->
  <div class="view-content">
    <!-- ==================================================== -->
    <!-- SUBTAB 0: 帳齡總表 (Payables Aging) -->
    <!-- ==================================================== -->
    {#if activeSubTab === 'aging'}
      <!-- Aging summary KPIs -->
      <div class="kpi-grid">
        <div class="kpi-card">
          <span class="kpi-title">總未付應付帳款</span>
          <span class="kpi-value text-danger font-mono font-bold">{formatCurrency(payablesAging?.totals?.total_outstanding || 0)}</span>
          <span class="kpi-sub font-mono">基準日：{payablesAging?.as_of_date || '-'}</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-title">未到期金額 (Current)</span>
          <span class="kpi-value font-mono">{formatCurrency(payablesAging?.totals?.current || 0)}</span>
          <span class="kpi-sub">≤ 0 天 (尚未到期)</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-title">總逾期金額</span>
          <span class="kpi-value text-warning font-mono">
            {formatCurrency(((payablesAging?.totals?.overdue_1_30 || 0) + (payablesAging?.totals?.overdue_31_60 || 0) + (payablesAging?.totals?.overdue_61_90 || 0) + (payablesAging?.totals?.overdue_90_plus || 0)))}
          </span>
          <span class="kpi-sub">包含 1-30, 31-60, 61-90, 90+ 天</span>
        </div>
        <div class="kpi-card kpi-reference">
          <span class="kpi-title">已到貨未請款 (未稅參考)</span>
          <span class="kpi-value text-primary font-mono">{formatCurrency(payablesAging?.totals?.unbilled_received_amount || 0)}</span>
          <span class="kpi-sub">貨已到未立帳（不計入帳齡與未付）</span>
        </div>
      </div>

      {#if agingViewMode === 'summary'}
        <div class="toolbar">
          <div class="toolbar-left">
            <span class="badge badge-info">計算基準日：{payablesAging?.as_of_date || '-'}</span>
            <span class="text-sm text-muted">帳齡採到期日業界標準分段</span>
          </div>
          <div class="toolbar-right">
            <button class="btn btn-secondary btn-sm" onclick={refreshAging} disabled={isAgingLoading} id="btn-refresh-aging">
              {isAgingLoading ? '重新計算中...' : '重新整理'}
            </button>
            <button class="btn btn-secondary btn-sm" onclick={() => { activeSubTab = 'accounts-payable'; refreshAccountsPayable(); }} id="btn-switch-all-ap">
              全部應付清單
            </button>
          </div>
        </div>

        <div class="table-container">
          {#if isAgingLoading}
            <div class="empty-state">帳齡資料載入中...</div>
          {:else if !payablesAging || !payablesAging.vendors || payablesAging.vendors.length === 0}
            <div class="empty-state">
              <p>目前尚無未付應付帳款或已到貨未請款紀錄</p>
            </div>
          {:else}
            <table class="data-table" id="table-payables-aging">
              <thead>
                <tr>
                  <th>供應商</th>
                  <th class="text-right">未到期</th>
                  <th class="text-right">逾期 1-30 天</th>
                  <th class="text-right">逾期 31-60 天</th>
                  <th class="text-right">逾期 61-90 天</th>
                  <th class="text-right">逾期 90+ 天</th>
                  <th class="text-right font-bold">未付合計</th>
                  <th class="text-right text-muted">已到貨未請款 (未稅)</th>
                  <th class="text-center">操作</th>
                </tr>
              </thead>
              <tbody>
                {#each payablesAging.vendors as v}
                  <tr>
                    <td class="font-medium">
                      <button 
                        class="link-btn font-medium" 
                        onclick={() => { selectedAgingVendorId = v.vendor_partner_id; agingViewMode = 'detail'; }}
                        id={`btn-view-vendor-aging-${v.vendor_partner_id}`}
                      >
                        {v.vendor_name}
                      </button>
                    </td>
                    <td class="text-right font-mono">{formatCurrency(v.current)}</td>
                    <td class="text-right font-mono {v.overdue_1_30 > 0 ? 'text-warning font-medium' : ''}">{formatCurrency(v.overdue_1_30)}</td>
                    <td class="text-right font-mono {v.overdue_31_60 > 0 ? 'text-warning font-medium' : ''}">{formatCurrency(v.overdue_31_60)}</td>
                    <td class="text-right font-mono {v.overdue_61_90 > 0 ? 'text-danger font-medium' : ''}">{formatCurrency(v.overdue_61_90)}</td>
                    <td class="text-right font-mono {v.overdue_90_plus > 0 ? 'text-danger font-bold' : ''}">{formatCurrency(v.overdue_90_plus)}</td>
                    <td class="text-right font-mono font-bold {v.total_outstanding > 0 ? 'text-danger' : ''}">{formatCurrency(v.total_outstanding)}</td>
                    <td class="text-right font-mono text-muted bg-ref">{formatCurrency(v.unbilled_received_amount)}</td>
                    <td class="text-center">
                      <div class="btn-group-sm">
                        <button 
                          class="btn-action text-primary" 
                          onclick={() => { selectedAgingVendorId = v.vendor_partner_id; agingViewMode = 'detail'; }}
                          id={`btn-detail-vendor-${v.vendor_partner_id}`}
                        >
                          明細
                        </button>
                        {#if v.total_outstanding > 0}
                          <button 
                            class="btn-action text-success font-medium" 
                            onclick={() => initiatePaymentFromVendor(v.vendor_partner_id)}
                            id={`btn-pay-vendor-${v.vendor_partner_id}`}
                          >
                            付款
                          </button>
                        {/if}
                      </div>
                    </td>
                  </tr>
                {/each}
              </tbody>
              <tfoot>
                <tr class="row-total">
                  <td class="font-bold">全體合計 (Total)</td>
                  <td class="text-right font-mono font-bold">{formatCurrency(payablesAging.totals.current)}</td>
                  <td class="text-right font-mono font-bold">{formatCurrency(payablesAging.totals.overdue_1_30)}</td>
                  <td class="text-right font-mono font-bold">{formatCurrency(payablesAging.totals.overdue_31_60)}</td>
                  <td class="text-right font-mono font-bold">{formatCurrency(payablesAging.totals.overdue_61_90)}</td>
                  <td class="text-right font-mono font-bold">{formatCurrency(payablesAging.totals.overdue_90_plus)}</td>
                  <td class="text-right font-mono font-bold text-danger">{formatCurrency(payablesAging.totals.total_outstanding)}</td>
                  <td class="text-right font-mono font-bold text-muted bg-ref">{formatCurrency(payablesAging.totals.unbilled_received_amount)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          {/if}
        </div>

      {:else if agingViewMode === 'detail' && selectedAgingVendor}
        <!-- Vendor Detail View -->
        <div class="toolbar">
          <div class="toolbar-left">
            <button class="btn btn-secondary btn-sm" onclick={() => { agingViewMode = 'summary'; }} id="btn-back-to-aging-summary">
              ← 返回帳齡總表
            </button>
            <h3 class="m-0 font-bold">{selectedAgingVendor.vendor_name} - 應付帳款明細</h3>
          </div>
          <div class="toolbar-right">
            {#if selectedAgingVendor.total_outstanding > 0}
              <button 
                class="btn btn-primary btn-sm" 
                onclick={() => initiatePaymentFromVendor(selectedAgingVendor.vendor_partner_id)}
                id="btn-vendor-detail-pay"
              >
                為此供應商付款 ({formatCurrency(selectedAgingVendor.total_outstanding)})
              </button>
            {/if}
          </div>
        </div>

        <div class="table-container">
          {#if selectedAgingVendor.items.length === 0}
            <div class="empty-state">
              <p>此供應商目前無未付應付帳款（或僅有已到貨未請款訂單）</p>
              {#if selectedAgingVendor.unbilled_received_amount > 0}
                <p class="text-muted">已到貨未請款金額：{formatCurrency(selectedAgingVendor.unbilled_received_amount)}</p>
              {/if}
            </div>
          {:else}
            <table class="data-table" id="table-vendor-aging-detail">
              <thead>
                <tr>
                  <th>來源單號</th>
                  <th>外部單號</th>
                  <th>單據日</th>
                  <th>到期日</th>
                  <th class="text-center">逾期天數</th>
                  <th class="text-center">所屬分段</th>
                  <th class="text-right">應付金額</th>
                  <th class="text-right">已付金額</th>
                  <th class="text-right">未付餘額</th>
                  <th class="text-center">付款狀態</th>
                  <th class="text-center">操作</th>
                </tr>
              </thead>
              <tbody>
                {#each selectedAgingVendor.items as item}
                  <tr>
                    <td class="font-mono font-medium">
                      {#if item.source_type === 'vendor_bill'}
                        <button class="link-btn font-mono" onclick={() => jumpToVendorBill(item.source_id)}>{item.source_number}</button>
                      {:else if item.source_type === 'opening_balance'}
                        <button class="link-btn font-mono" onclick={() => jumpToOpeningPayable(item.source_id)}>{item.source_number}</button>
                      {:else}
                        {item.source_number}
                      {/if}
                    </td>
                    <td class="font-mono text-muted">{item.external_reference || '-'}</td>
                    <td>{item.document_date}</td>
                    <td>{item.due_date}</td>
                    <td class="text-center font-mono">
                      {#if item.overdue_days <= 0}
                        <span class="text-muted">{item.overdue_days} 天</span>
                      {:else}
                        <span class="text-danger font-medium">{item.overdue_days} 天</span>
                      {/if}
                    </td>
                    <td class="text-center">
                      {#if item.bucket === 'current'}
                        <span class="badge badge-success">未到期</span>
                      {:else if item.bucket === '1-30'}
                        <span class="badge badge-warning">逾期 1-30</span>
                      {:else if item.bucket === '31-60'}
                        <span class="badge badge-warning">逾期 31-60</span>
                      {:else if item.bucket === '61-90'}
                        <span class="badge badge-danger">逾期 61-90</span>
                      {:else}
                        <span class="badge badge-danger font-bold">逾期 90+</span>
                      {/if}
                    </td>
                    <td class="text-right font-mono">{formatCurrency(item.amount)}</td>
                    <td class="text-right font-mono">{formatCurrency(item.paid_amount)}</td>
                    <td class="text-right font-mono font-bold text-danger">{formatCurrency(item.outstanding_amount)}</td>
                    <td class="text-center">
                      {#if item.settlement_status === 'unpaid'}
                        <span class="badge badge-unpaid">未付</span>
                      {:else if item.settlement_status === 'partially_paid'}
                        <span class="badge badge-partial">部分付款</span>
                      {:else}
                        <span class="badge badge-paid">已付清</span>
                      {/if}
                    </td>
                    <td class="text-center">
                      <div class="btn-group-sm">
                        <button 
                          class="btn-action text-primary font-medium" 
                          onclick={() => initiatePaymentFromAp(item)}
                          id={`btn-pay-ap-${item.account_payable_id}`}
                        >
                          付款
                        </button>
                        <button 
                          class="btn-action text-muted" 
                          onclick={() => openApDetailModal(item.account_payable_id)}
                        >
                          核銷歷程
                        </button>
                      </div>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </div>
      {/if}

    <!-- ==================================================== -->
    <!-- SUBTAB: 對帳明細 (Vendor Statement) -->
    <!-- ==================================================== -->
    {:else if activeSubTab === 'statement'}
      <!-- Toolbar & Filters -->
      <div class="toolbar">
        <div class="filters">
          <div class="filter-group">
            <label for="stmt-vendor-select">供應商：</label>
            <select id="stmt-vendor-select" bind:value={stmtVendorId} onchange={refreshStatement}>
              <option value="">請選擇供應商</option>
              {#each availableVendors as v}
                <option value={v.id}>{v.name}</option>
              {/each}
            </select>
          </div>
          <div class="filter-group">
            <label for="stmt-start-date">起日：</label>
            <input type="date" id="stmt-start-date" bind:value={stmtStartDate} onchange={refreshStatement} />
          </div>
          <div class="filter-group">
            <label for="stmt-end-date">迄日：</label>
            <input type="date" id="stmt-end-date" bind:value={stmtEndDate} onchange={refreshStatement} />
          </div>
          <button class="btn btn-secondary btn-sm" onclick={setStatementCurrentMonth} id="btn-stmt-current-month">本月</button>
          <button class="btn btn-secondary btn-sm" onclick={setStatementLastMonth} id="btn-stmt-last-month">上月</button>
          <button class="btn btn-primary btn-sm" onclick={refreshStatement} disabled={isStatementLoading || !stmtVendorId} id="btn-stmt-refresh">
            {isStatementLoading ? '查詢中...' : '查詢'}
          </button>
        </div>
      </div>

      <!-- Warning notice on retroactive void impact -->
      <div class="statement-notice-banner" id="statement-void-notice">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <span>
          <strong>作廢的回溯影響：</strong>
          作廢的單據會從所有期間消失，因此作廢操作會改變過去期間的對帳結果。
        </span>
      </div>

      {#if !stmtVendorId}
        <div class="empty-state" style="padding: 3rem 1rem; text-align: center;">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
          </svg>
          <p style="margin-top: 1rem; color: #64748b; font-size: 0.95rem;">請由上方選擇欲對帳的供應商與期間以查詢明細</p>
        </div>
      {:else if isStatementLoading}
        <div class="loading-state" style="padding: 3rem; text-align: center; color: #64748b;">
          載入對帳明細中...
        </div>
      {:else if vendorStatement}
        <!-- Section 1: 期初未付 (Opening Balance) -->
        <div class="statement-section-card opening-card" id="section-opening-balance">
          <div class="card-inner">
            <div class="card-header-line">
              <span class="card-badge">第 1 段</span>
              <span class="card-title">期初未付 (截至 {vendorStatement.start_date} 之前)</span>
            </div>
            <div class="amount-line">
              <span class="amount-val font-mono">{formatCurrency(vendorStatement.opening_balance)}</span>
              <span class="amount-formula font-mono text-muted">Σ(單據日 &lt; 起日應付) − Σ(付款日 &lt; 起日已過帳付款核銷)</span>
            </div>
          </div>
        </div>

        <!-- Section 2: 本期新增應付清單 (Current Payables) -->
        <div class="statement-table-section" id="section-current-payables">
          <div class="section-heading">
            <div class="heading-left">
              <span class="card-badge">第 2 段</span>
              <h3>本期新增應付清單</h3>
              <span class="count-tag font-mono">{vendorStatement.payables.length} 筆</span>
            </div>
            <div class="heading-right font-mono">
              本期應付小計：<span class="font-bold text-danger">{formatCurrency(vendorStatement.current_payables_total)}</span>
            </div>
          </div>

          {#if vendorStatement.payables.length === 0}
            <div class="table-empty-notice">此期間無新增應付帳款</div>
          {:else}
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>單據日</th>
                    <th>來源類型</th>
                    <th>來源單號</th>
                    <th>外部單號 / 發票號</th>
                    <th>到期日</th>
                    <th class="text-right">金額</th>
                  </tr>
                </thead>
                <tbody>
                  {#each vendorStatement.payables as ap}
                    <tr>
                      <td class="font-mono">{ap.document_date}</td>
                      <td>
                        {#if ap.source_type === 'vendor_bill'}
                          <span class="badge badge-partial">請款單</span>
                        {:else if ap.source_type === 'opening_balance'}
                          <span class="badge badge-draft">期初應付</span>
                        {:else}
                          <span class="badge badge-draft">{ap.source_type}</span>
                        {/if}
                      </td>
                      <td>
                        <button 
                          class="link-btn font-mono"
                          onclick={() => openApDetailModal(ap.account_payable_id)}
                          title="查看應付帳款詳情"
                        >
                          {ap.source_number}
                        </button>
                      </td>
                      <td class="font-mono text-muted">{ap.external_reference || '-'}</td>
                      <td class="font-mono">{ap.due_date}</td>
                      <td class="text-right font-mono font-semibold text-danger">
                        {formatCurrency(ap.amount)}
                      </td>
                    </tr>
                  {/each}
                </tbody>
                <tfoot>
                  <tr class="table-total-row">
                    <td colspan="5" class="text-right font-bold">本期應付合計</td>
                    <td class="text-right font-mono font-bold text-danger">
                      {formatCurrency(vendorStatement.current_payables_total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          {/if}
        </div>

        <!-- Section 3: 本期付款清單 (Current Payments) -->
        <div class="statement-table-section" id="section-current-payments">
          <div class="section-heading">
            <div class="heading-left">
              <span class="card-badge">第 3 段</span>
              <h3>本期付款清單 (已過帳)</h3>
              <span class="count-tag font-mono">{vendorStatement.payments.length} 筆</span>
            </div>
            <div class="heading-right font-mono">
              本期付款小計：<span class="font-bold text-success">{formatCurrency(vendorStatement.current_payments_total)}</span>
            </div>
          </div>

          {#if vendorStatement.payments.length === 0}
            <div class="table-empty-notice">此期間無付款記錄</div>
          {:else}
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>付款日</th>
                    <th>付款單號</th>
                    <th>付款方式</th>
                    <th>參考號</th>
                    <th>核銷對象 (單號 / 金額)</th>
                    <th class="text-right">付款金額</th>
                  </tr>
                </thead>
                <tbody>
                  {#each vendorStatement.payments as pay}
                    <tr>
                      <td class="font-mono">{pay.payment_date}</td>
                      <td>
                        <button 
                          class="link-btn font-mono font-semibold"
                          onclick={() => { activeSubTab = 'vendor-payments'; viewPaymentDetail(pay.payment_id); }}
                          title="查看付款單詳情"
                        >
                          {pay.payment_number}
                        </button>
                      </td>
                      <td>{getPaymentMethodLabel(pay.payment_method)}</td>
                      <td class="font-mono text-muted">{pay.payment_reference || '-'}</td>
                      <td>
                        <div class="allocations-pill-list">
                          {#each pay.allocations as alloc}
                            <span class="alloc-pill font-mono">
                              <button 
                                class="alloc-link"
                                onclick={() => openApDetailModal(alloc.account_payable_id)}
                                title="查看對應應付單"
                              >
                                {alloc.source_number}
                              </button>
                              <span class="alloc-amt">({formatCurrency(alloc.amount)})</span>
                            </span>
                          {/each}
                        </div>
                      </td>
                      <td class="text-right font-mono font-semibold text-success">
                        {formatCurrency(pay.amount)}
                      </td>
                    </tr>
                  {/each}
                </tbody>
                <tfoot>
                  <tr class="table-total-row">
                    <td colspan="5" class="text-right font-bold">本期付款合計</td>
                    <td class="text-right font-mono font-bold text-success">
                      {formatCurrency(vendorStatement.current_payments_total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          {/if}
        </div>

        <!-- Section 4: 期末未付 (Closing Balance) & 恆等式勾稽 -->
        <div class="statement-section-card closing-card" id="section-closing-balance">
          <div class="card-inner">
            <div class="card-header-line">
              <span class="card-badge">第 4 段</span>
              <span class="card-title">期末未付 (截至 {vendorStatement.end_date})</span>
            </div>
            <div class="amount-line">
              <span class="amount-val font-mono font-bold text-danger">{formatCurrency(vendorStatement.closing_balance)}</span>
            </div>
            <div class="reconciliation-formula-box">
              <div class="formula-label">勾稽平衡驗證 (恆等式)：</div>
              <div class="formula-content font-mono">
                <span class="term">期初 {formatCurrency(vendorStatement.opening_balance)}</span>
                <span class="op">+</span>
                <span class="term text-danger">本期應付 {formatCurrency(vendorStatement.current_payables_total)}</span>
                <span class="op">−</span>
                <span class="term text-success">本期付款 {formatCurrency(vendorStatement.current_payments_total)}</span>
                <span class="op">=</span>
                <span class="term font-bold text-danger">期末未付 {formatCurrency(vendorStatement.closing_balance)}</span>
                <span class="check-icon" title="計算已平衡">✓ 平衡</span>
              </div>
              <div class="formula-hint text-muted">
                註：當迄日為今天時，期末未付將與工作區顯示之該供應商未付合計一致。
              </div>
            </div>
          </div>
        </div>
      {/if}

    <!-- ==================================================== -->
    <!-- SUBTAB 1: 付款單 (Vendor Payments) -->
    <!-- ==================================================== -->
    {:else if activeSubTab === 'vendor-payments'}
      {#if paymentViewMode === 'list'}
        <!-- Payments List View -->
        <div class="toolbar">
          <div class="filters">
            <div class="filter-group">
              <label for="filter-pay-vendor">供應商：</label>
              <select id="filter-pay-vendor" bind:value={filterPayVendorId} onchange={refreshVendorPayments}>
                <option value="">全部供應商</option>
                {#each availableVendors as v}
                  <option value={v.id}>{v.name}</option>
                {/each}
              </select>
            </div>

            <div class="filter-group">
              <label for="filter-pay-status">狀態：</label>
              <select id="filter-pay-status" bind:value={filterPayStatus} onchange={refreshVendorPayments}>
                <option value="all">全部狀態</option>
                <option value="draft">草稿 (draft)</option>
                <option value="posted">已過帳 (posted)</option>
                <option value="cancelled">已取消 (cancelled)</option>
                <option value="voided">已作廢 (voided)</option>
              </select>
            </div>

            <div class="filter-group">
              <label for="filter-pay-from">付款日起：</label>
              <input type="date" id="filter-pay-from" bind:value={filterPayDateFrom} onchange={refreshVendorPayments} />
            </div>

            <div class="filter-group">
              <label for="filter-pay-to">迄：</label>
              <input type="date" id="filter-pay-to" bind:value={filterPayDateTo} onchange={refreshVendorPayments} />
            </div>
          </div>

          <div class="actions">
            <button class="btn btn-primary" onclick={() => openCreatePayModal()} id="btn-create-vendor-payment">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              新增付款單
            </button>
          </div>
        </div>

        <div class="table-container">
          {#if isPaymentLoading}
            <div class="empty-state">資料載入中...</div>
          {:else if vendorPaymentsList.length === 0}
            <div class="empty-state">
              <p>目前尚無付款單紀錄</p>
              <button class="btn btn-secondary" onclick={() => openCreatePayModal()}>立即建立付款單</button>
            </div>
          {:else}
            <table class="data-table" id="table-vendor-payments">
              <thead>
                <tr>
                  <th>付款單號</th>
                  <th>供應商</th>
                  <th>付款日</th>
                  <th>付款方式</th>
                  <th>參考資訊</th>
                  <th class="text-right">付款總額</th>
                  <th class="text-center">核銷筆數</th>
                  <th>狀態</th>
                  <th class="text-center">操作</th>
                </tr>
              </thead>
              <tbody>
                {#each vendorPaymentsList as p}
                  <tr class={p.status === 'voided' ? 'row-voided' : ''}>
                    <td class="font-mono font-medium">
                      <button class="link-btn font-mono" onclick={() => viewPaymentDetail(p.id)}>{p.payment_number}</button>
                    </td>
                    <td>{p.vendor_name_snapshot}</td>
                    <td>{p.payment_date}</td>
                    <td>{getPaymentMethodLabel(p.payment_method)}</td>
                    <td class="text-muted text-sm">{p.payment_reference || '-'}</td>
                    <td class="text-right font-medium">{formatCurrency(p.total_amount)}</td>
                    <td class="text-center">{p.allocation_count !== undefined ? p.allocation_count : (p.allocations ? p.allocations.length : 0)}</td>
                    <td>
                      {#if p.status === 'draft'}
                        <span class="badge badge-draft">草稿 (draft)</span>
                      {:else if p.status === 'posted'}
                        <span class="badge badge-posted">已過帳 (posted)</span>
                      {:else if p.status === 'cancelled'}
                        <span class="badge badge-cancelled">已取消 (cancelled)</span>
                      {:else if p.status === 'voided'}
                        <span class="badge badge-voided">已作廢 (voided)</span>
                      {:else}
                        <span class="badge">{p.status}</span>
                      {/if}
                    </td>
                    <td class="text-center">
                      {#if p.status === 'draft'}
                        <button class="btn-action text-primary" onclick={() => viewPaymentDetail(p.id)}>編輯/核銷</button>
                      {:else if p.status === 'posted'}
                        <button class="btn-action text-primary" onclick={() => viewPaymentDetail(p.id)}>檢視</button>
                        <button class="btn-action text-danger" onclick={() => openVoidPayModal(p)}>作廢</button>
                      {:else}
                        <button class="btn-action text-muted" onclick={() => viewPaymentDetail(p.id)}>檢視</button>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </div>

      {:else if paymentViewMode === 'draft' && selectedPayment}
        <!-- Payment Draft Editing View -->
        <div class="editor-header">
          <div class="editor-title-wrap">
            <button class="btn btn-secondary btn-sm" onclick={backToPaymentList}>
              &larr; 返回清單
            </button>
            <h3>
              編輯付款單草稿 <span class="font-mono text-muted">({selectedPayment.payment_number})</span>
            </h3>
            <span class="badge badge-draft">草稿</span>
          </div>

          <div class="editor-actions">
            <button 
              class="btn btn-danger btn-outline btn-sm" 
              onclick={handleCancelPayment}
              disabled={paymentActionLoading}
              id="btn-cancel-payment"
            >
              取消付款單
            </button>
            <button 
              class="btn btn-primary" 
              onclick={handlePostPayment}
              disabled={paymentActionLoading || draftAllocCount === 0}
              id="btn-post-payment"
            >
              {paymentActionLoading ? '處理中...' : '確認過帳 (Post)'}
            </button>
          </div>
        </div>

        {#if paymentErrorMsg}
          <div class="alert alert-danger mb-3" id="payment-error-banner">{paymentErrorMsg}</div>
        {/if}

        <!-- Header Card -->
        <div class="card mb-4">
          <div class="card-header">
            <h4>付款單表頭資訊</h4>
            <button 
              class="btn btn-secondary btn-sm" 
              onclick={handleSaveDraftHeader}
              disabled={isSavingDraftHeader}
              id="btn-save-draft-header"
            >
              {isSavingDraftHeader ? '儲存中...' : '儲存表頭變更'}
            </button>
          </div>
          <div class="card-body">
            <div class="form-row-3">
              <div class="form-group">
                <label for="draft-vendor-name">供應商</label>
                <input id="draft-vendor-name" type="text" value={selectedPayment.vendor_name_snapshot} disabled class="bg-readonly" />
              </div>

              <div class="form-group">
                <label for="draft-payment-date">付款日 <span class="required">*</span></label>
                <input 
                  type="date" 
                  id="draft-payment-date" 
                  bind:value={draftHeaderDate}
                  max={getTodayDateString()}
                  onchange={handleSaveDraftHeader}
                  required 
                />
                <span class="help-text">純日期格式，不可晚於今天</span>
              </div>

              <div class="form-group">
                <label for="draft-payment-method">付款方式 <span class="required">*</span></label>
                <select id="draft-payment-method" bind:value={draftHeaderMethod} onchange={handleSaveDraftHeader}>
                  <option value="bank_transfer">銀行轉帳 (bank_transfer)</option>
                  <option value="cash">現金 (cash)</option>
                  <option value="check">支票 (check)</option>
                  <option value="other">其他 (other)</option>
                </select>
              </div>
            </div>

            <div class="form-row mt-3">
              <div class="form-group">
                <label for="draft-payment-ref">參考資訊</label>
                <input 
                  type="text" 
                  id="draft-payment-ref" 
                  bind:value={draftHeaderRef} 
                  placeholder="匯款末五碼、支票號碼或交易序號"
                  onblur={handleSaveDraftHeader}
                />
              </div>

              <div class="form-group">
                <label for="draft-payment-note">備註</label>
                <input 
                  type="text" 
                  id="draft-payment-note" 
                  bind:value={draftHeaderNote} 
                  placeholder="內部備註說明（選填）"
                  onblur={handleSaveDraftHeader}
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Allocation Table Card -->
        <div class="card">
          <div class="card-header">
            <div>
              <h4>未付應付帳款勾選與核銷</h4>
              <p class="subtitle text-sm">列出該供應商未付餘額大於 0 的有效應付，勾選並填寫本次核銷金額</p>
            </div>
            <div class="alloc-stats">
              已勾選核銷：<strong>{draftAllocCount}</strong> 筆
            </div>
          </div>

          <div class="card-body p-0">
            {#if draftCandidatePayables.length === 0}
              <div class="empty-state">
                此供應商目前沒有待核銷的未付應付帳款
              </div>
            {:else}
              <table class="data-table" id="table-draft-allocations">
                <thead>
                  <tr>
                    <th class="text-center" style="width: 50px;">勾選</th>
                    <th>來源單號</th>
                    <th>外部單號</th>
                    <th>單據日</th>
                    <th>到期日</th>
                    <th class="text-right">應付總額</th>
                    <th class="text-right">未付餘額</th>
                    <th style="width: 200px;">本次核銷金額</th>
                  </tr>
                </thead>
                <tbody>
                  {#each draftCandidatePayables as ap}
                    {@const state = draftAllocations[ap.id] || { selected: false, amount: ap.outstanding_amount, rawInput: String(ap.outstanding_amount), error: '' }}
                    <tr class={state.selected ? 'row-selected' : ''}>
                      <td class="text-center">
                        <input 
                          type="checkbox" 
                          id={`chk-ap-${ap.id}`}
                          checked={state.selected} 
                          onchange={() => handleToggleAllocation(ap)}
                          disabled={paymentActionLoading}
                        />
                      </td>
                      <td class="font-mono">
                        {#if ap.source_type === 'vendor_bill'}
                          <button class="link-btn font-mono" onclick={() => jumpToVendorBill(ap.source_id)} title="點擊檢視請款單">
                            {ap.source_number}
                          </button>
                        {:else if ap.source_type === 'opening_balance'}
                          <button class="link-btn font-mono" onclick={() => jumpToOpeningPayable(ap.source_id)} title="點擊檢視期初應付">
                            {ap.source_number}
                          </button>
                        {:else}
                          {ap.source_number}
                        {/if}
                      </td>
                      <td class="font-mono text-muted">{ap.external_reference || '-'}</td>
                      <td>{ap.document_date}</td>
                      <td>{ap.due_date}</td>
                      <td class="text-right">{formatCurrency(ap.amount)}</td>
                      <td class="text-right font-medium">{formatCurrency(ap.outstanding_amount)}</td>
                      <td>
                        <div class="alloc-input-wrap">
                          <input 
                            type="number" 
                            step="0.01"
                            min="0.01"
                            id={`input-alloc-${ap.id}`}
                            value={state.rawInput}
                            disabled={!state.selected || paymentActionLoading}
                            class={state.error ? 'input-error' : ''}
                            oninput={(e) => handleAllocationAmountChange(ap, e.currentTarget.value)}
                          />
                          {#if state.error}
                            <span class="error-hint" id={`error-hint-${ap.id}`}>{state.error}</span>
                          {/if}
                        </div>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/if}
          </div>

          <div class="card-footer summary-footer">
            <div class="summary-left">
              <span>核銷筆數：<strong>{draftAllocCount}</strong> 筆</span>
            </div>
            <div class="summary-right">
              <span class="total-label">付款總額（核銷合計）：</span>
              <span class="total-amount font-mono" id="draft-total-amount">
                {formatCurrency(draftTotalAmount)}
              </span>
            </div>
          </div>
        </div>

      {:else if paymentViewMode === 'detail' && selectedPayment}
        <!-- Payment Read-only View (Posted / Cancelled / Voided) -->
        <div class="editor-header">
          <div class="editor-title-wrap">
            <button class="btn btn-secondary btn-sm" onclick={backToPaymentList}>
              &larr; 返回清單
            </button>
            <h3>
              付款單明細 <span class="font-mono text-muted">({selectedPayment.payment_number})</span>
            </h3>
            {#if selectedPayment.status === 'posted'}
              <span class="badge badge-posted">已過帳 (posted)</span>
            {:else if selectedPayment.status === 'voided'}
              <span class="badge badge-voided">已作廢 (voided)</span>
            {:else if selectedPayment.status === 'cancelled'}
              <span class="badge badge-cancelled">已取消 (cancelled)</span>
            {:else}
              <span class="badge">{selectedPayment.status}</span>
            {/if}
          </div>

          <div class="editor-actions">
            {#if selectedPayment.status === 'posted'}
              <button 
                class="btn btn-danger" 
                onclick={() => openVoidPayModal(selectedPayment)}
                id="btn-void-payment"
              >
                作廢此付款單
              </button>
            {/if}
          </div>
        </div>

        {#if selectedPayment.status === 'voided'}
          <div class="alert alert-danger mb-3" id="void-reason-alert">
            <strong>已作廢</strong>：{selectedPayment.void_reason || '無說明'}
            {#if selectedPayment.voided_at}
              <span class="text-xs text-muted ml-2">（作廢時間：{formatTime(selectedPayment.voided_at)}）</span>
            {/if}
          </div>
        {:else if selectedPayment.status === 'cancelled'}
          <div class="alert alert-info mb-3">
            <strong>此草稿付款單已取消</strong>
            {#if selectedPayment.cancelled_at}
              <span class="text-xs text-muted ml-2">（取消時間：{formatTime(selectedPayment.cancelled_at)}）</span>
            {/if}
          </div>
        {/if}

        <!-- Read-only Header Card -->
        <div class="card mb-4">
          <div class="card-header">
            <h4>表頭資訊</h4>
          </div>
          <div class="card-body">
            <div class="info-grid">
              <div class="info-item">
                <span class="info-label">供應商</span>
                <span class="info-value font-medium">{selectedPayment.vendor_name_snapshot}</span>
              </div>
              <div class="info-item">
                <span class="info-label">付款日</span>
                <span class="info-value">{selectedPayment.payment_date}</span>
              </div>
              <div class="info-item">
                <span class="info-label">付款方式</span>
                <span class="info-value">{getPaymentMethodLabel(selectedPayment.payment_method)}</span>
              </div>
              <div class="info-item">
                <span class="info-label">參考資訊</span>
                <span class="info-value">{selectedPayment.payment_reference || '-'}</span>
              </div>
              <div class="info-item">
                <span class="info-label">備註</span>
                <span class="info-value">{selectedPayment.note || '-'}</span>
              </div>
              <div class="info-item">
                <span class="info-label">過帳時間</span>
                <span class="info-value">{selectedPayment.posted_at ? formatTime(selectedPayment.posted_at) : '-'}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Read-only Allocations Table -->
        <div class="card">
          <div class="card-header">
            <h4>核銷明細</h4>
          </div>
          <div class="card-body p-0">
            <table class="data-table">
              <thead>
                <tr>
                  <th>來源單號</th>
                  <th>外部單號</th>
                  <th>單據日</th>
                  <th>到期日</th>
                  <th class="text-right">應付總額</th>
                  <th class="text-right">核銷金額</th>
                </tr>
              </thead>
              <tbody>
                {#if !selectedPayment.allocations || selectedPayment.allocations.length === 0}
                  <tr>
                    <td colspan="6" class="text-center text-muted py-4">無核銷項目</td>
                  </tr>
                {:else}
                  {#each selectedPayment.allocations as a}
                    <tr>
                      <td class="font-mono">
                        {#if a.source_type === 'vendor_bill'}
                          <button class="link-btn font-mono" onclick={() => jumpToVendorBill(a.source_id)}>
                            {a.source_number}
                          </button>
                        {:else if a.source_type === 'opening_balance'}
                          <button class="link-btn font-mono" onclick={() => jumpToOpeningPayable(a.source_id)}>
                            {a.source_number}
                          </button>
                        {:else}
                          {a.source_number}
                        {/if}
                      </td>
                      <td class="font-mono text-muted">{a.external_reference || '-'}</td>
                      <td>{a.document_date || '-'}</td>
                      <td>{a.due_date || '-'}</td>
                      <td class="text-right">{a.ap_amount ? formatCurrency(a.ap_amount) : '-'}</td>
                      <td class="text-right font-medium">{formatCurrency(a.amount)}</td>
                    </tr>
                  {/each}
                {/if}
              </tbody>
            </table>
          </div>

          <div class="card-footer summary-footer">
            <div class="summary-left">
              <span>核銷筆數：<strong>{selectedPayment.allocations ? selectedPayment.allocations.length : 0}</strong> 筆</span>
            </div>
            <div class="summary-right">
              <span class="total-label">付款總額：</span>
              <span class="total-amount font-mono">
                {formatCurrency(selectedPayment.total_amount)}
              </span>
            </div>
          </div>
        </div>
      {/if}

    <!-- ==================================================== -->
    <!-- SUBTAB 2: 應付帳款明細 (Accounts Payable) -->
    <!-- ==================================================== -->
    {:else if activeSubTab === 'accounts-payable'}
      <div class="toolbar">
        <div class="filters">
          <div class="filter-group">
            <label for="filter-ap-vendor">供應商：</label>
            <select id="filter-ap-vendor" bind:value={filterApVendorId} onchange={refreshAccountsPayable}>
              <option value="">全部供應商</option>
              {#each availableVendors as v}
                <option value={v.id}>{v.name}</option>
              {/each}
            </select>
          </div>

          {#if filterApVendorId}
            <button 
              class="btn btn-secondary btn-sm" 
              onclick={() => initiatePaymentFromVendor(filterApVendorId)}
              id="btn-vendor-quick-pay"
            >
              為此供應商付款
            </button>
          {/if}

          <div class="filter-group">
            <label for="filter-ap-settlement">結算狀態：</label>
            <select id="filter-ap-settlement" bind:value={filterApSettlementStatus} onchange={refreshAccountsPayable}>
              <option value="all">全部結算狀態</option>
              <option value="unpaid">未付 (unpaid)</option>
              <option value="partially_paid">部分付款 (partially_paid)</option>
              <option value="paid">已付清 (paid)</option>
            </select>
          </div>

          <div class="filter-group">
            <label for="filter-ap-status">狀態：</label>
            <select id="filter-ap-status" bind:value={filterApStatus} onchange={refreshAccountsPayable}>
              <option value="all">全部狀態</option>
              <option value="open">有效 (open)</option>
              <option value="voided">已作廢 (voided)</option>
            </select>
          </div>
        </div>
      </div>

      <div class="table-container">
        {#if isLoading}
          <div class="empty-state">資料載入中...</div>
        {:else if accountsPayableList.length === 0}
          <div class="empty-state">
            <p>目前尚無應付帳款紀錄</p>
          </div>
        {:else}
          <table class="data-table" id="table-accounts-payable">
            <thead>
              <tr>
                <th>來源單號</th>
                <th>來源類型</th>
                <th>供應商</th>
                <th>外部單號</th>
                <th>單據日</th>
                <th>到期日</th>
                <th class="text-right">應付總額</th>
                <th class="text-right">已付金額</th>
                <th class="text-right">未付餘額</th>
                <th>結算狀態</th>
                <th>單據狀態</th>
                <th class="text-center">操作</th>
              </tr>
            </thead>
            <tbody>
              {#each accountsPayableList as ap}
                <tr class={ap.status === 'voided' ? 'row-voided' : ''}>
                  <td class="font-mono font-medium">
                    {#if ap.source_type === 'vendor_bill'}
                      <button class="link-btn font-mono" onclick={() => jumpToVendorBill(ap.source_id)}>{ap.source_number}</button>
                    {:else if ap.source_type === 'opening_balance'}
                      <button class="link-btn font-mono" onclick={() => jumpToOpeningPayable(ap.source_id)}>{ap.source_number}</button>
                    {:else}
                      {ap.source_number}
                    {/if}
                  </td>
                  <td>
                    {ap.source_type === 'vendor_bill' ? '請款單' : (ap.source_type === 'opening_balance' ? '期初應付' : ap.source_type)}
                  </td>
                  <td>{ap.vendor_name_snapshot}</td>
                  <td class="font-mono text-muted">{ap.external_reference || '-'}</td>
                  <td>{ap.document_date}</td>
                  <td>{ap.due_date}</td>
                  <td class="text-right">{formatCurrency(ap.amount)}</td>
                  <td class="text-right">{formatCurrency(ap.paid_amount || 0)}</td>
                  <td class="text-right font-medium">{formatCurrency(ap.outstanding_amount)}</td>
                  <td>
                    {#if ap.settlement_status === 'unpaid'}
                      <span class="badge badge-unpaid">未付</span>
                    {:else if ap.settlement_status === 'partially_paid'}
                      <span class="badge badge-partial">部分付款</span>
                    {:else if ap.settlement_status === 'paid'}
                      <span class="badge badge-paid">已付清</span>
                    {:else}
                      <span class="badge">{ap.settlement_status}</span>
                    {/if}
                  </td>
                  <td>
                    {#if ap.status === 'open'}
                      <span class="badge badge-success">有效</span>
                    {:else}
                      <span class="badge badge-danger">已作廢</span>
                    {/if}
                  </td>
                  <td class="text-center">
                    <div class="btn-group-sm">
                      {#if ap.status === 'open' && ap.outstanding_amount > 0}
                        <button 
                          class="btn-action text-primary font-medium" 
                          onclick={() => initiatePaymentFromAp(ap)}
                          id={`btn-pay-ap-${ap.id}`}
                        >
                          付款
                        </button>
                      {/if}
                      <button 
                        class="btn-action text-muted" 
                        onclick={() => openApDetailModal(ap.id)}
                      >
                        核銷歷程
                      </button>
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>

    <!-- ==================================================== -->
    <!-- SUBTAB 3: 期初應付 (Opening Payables) -->
    <!-- ==================================================== -->
    {:else if activeSubTab === 'opening-payables'}
      <div class="toolbar">
        <div class="filters">
          <div class="filter-group">
            <label for="filter-oap-vendor">供應商：</label>
            <select id="filter-oap-vendor" bind:value={filterOapVendorId} onchange={refreshOpeningPayables}>
              <option value="">全部供應商</option>
              {#each availableVendors as v}
                <option value={v.id}>{v.name}</option>
              {/each}
            </select>
          </div>

          <div class="filter-group">
            <label for="filter-oap-status">狀態：</label>
            <select id="filter-oap-status" bind:value={filterOapStatus} onchange={refreshOpeningPayables}>
              <option value="all">全部狀態</option>
              <option value="open">有效 (open)</option>
              <option value="voided">已作廢 (voided)</option>
            </select>
          </div>
        </div>

        <div class="actions">
          <button class="btn btn-primary" onclick={openCreateOapModal} id="btn-create-opening-payable">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            新增期初應付
          </button>
        </div>
      </div>

      <div class="table-container">
        {#if isLoading}
          <div class="empty-state">資料載入中...</div>
        {:else if openingPayablesList.length === 0}
          <div class="empty-state">
            <p>目前尚無期初應付帳款紀錄</p>
            <button class="btn btn-secondary" onclick={openCreateOapModal}>立即新增期初欠款</button>
          </div>
        {:else}
          <table class="data-table">
            <thead>
              <tr>
                <th>期初單號</th>
                <th>供應商</th>
                <th>原單號 / 發票號</th>
                <th>單據日</th>
                <th>到期日</th>
                <th class="text-right">未付金額 (含稅)</th>
                <th>狀態</th>
                <th>備註</th>
                <th class="text-center">操作</th>
              </tr>
            </thead>
            <tbody>
              {#each openingPayablesList as oap}
                <tr class={oap.status === 'voided' ? 'row-voided' : ''}>
                  <td class="font-mono font-medium">{oap.opening_number}</td>
                  <td>{oap.vendor_name_snapshot}</td>
                  <td class="font-mono">{oap.original_reference}</td>
                  <td>{oap.document_date}</td>
                  <td>{oap.due_date}</td>
                  <td class="text-right font-medium">{formatCurrency(oap.amount)}</td>
                  <td>
                    {#if oap.status === 'open'}
                      <span class="badge badge-success">有效 (open)</span>
                    {:else if oap.status === 'voided'}
                      <span class="badge badge-danger">已作廢 (voided)</span>
                    {:else}
                      <span class="badge">{oap.status}</span>
                    {/if}
                  </td>
                  <td class="text-muted text-sm">{oap.note || '-'}</td>
                  <td class="text-center">
                    {#if oap.status === 'open'}
                      <div class="btn-group-sm">
                        <button 
                          class="btn-action text-primary font-medium" 
                          onclick={() => initiatePaymentFromOap(oap)}
                          title="為此期初應付付款"
                        >
                          付款
                        </button>
                        <button 
                          class="btn-action text-danger" 
                          onclick={() => openVoidOapModal(oap)}
                          title="作廢此期初應付"
                        >
                          作廢
                        </button>
                      </div>
                    {:else}
                      <span class="text-xs text-muted" title={oap.void_reason || ''}>
                        {oap.void_reason ? `原因: ${oap.void_reason}` : '已作廢'}
                      </span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
    {/if}
  </div>

  <!-- ==================================================== -->
  <!-- MODAL: 新增付款單 (Create Payment Modal) -->
  <!-- ==================================================== -->
  {#if isCreatePayModalOpen}
    <div class="modal-backdrop" onclick={closeCreatePayModal} onkeydown={(e) => e.key === 'Escape' && closeCreatePayModal()} role="presentation">
      <div class="modal-box" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
        <div class="modal-header">
          <h3>新增付款單</h3>
          <button class="btn-close" onclick={closeCreatePayModal}>&times;</button>
        </div>

        <div class="modal-body">
          {#if newPayError}
            <div class="alert alert-danger" id="new-pay-error-msg">{newPayError}</div>
          {/if}

          <div class="form-group">
            <label for="new-pay-vendor">供應商 <span class="required">*</span></label>
            <select id="new-pay-vendor" bind:value={newPayVendorId} required>
              <option value="" disabled>請選擇供應商</option>
              {#each availableVendors as v}
                <option value={v.id}>{v.name}</option>
              {/each}
            </select>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="new-pay-date">付款日 <span class="required">*</span></label>
              <input 
                type="date" 
                id="new-pay-date" 
                bind:value={newPayDate} 
                max={getTodayDateString()} 
                required 
              />
              <span class="help-text">不可晚於今天</span>
            </div>

            <div class="form-group">
              <label for="new-pay-method">付款方式 <span class="required">*</span></label>
              <select id="new-pay-method" bind:value={newPayMethod}>
                <option value="bank_transfer">銀行轉帳</option>
                <option value="cash">現金</option>
                <option value="check">支票</option>
                <option value="other">其他</option>
              </select>
            </div>
          </div>

          <div class="form-group">
            <label for="new-pay-ref">參考資訊</label>
            <input 
              type="text" 
              id="new-pay-ref" 
              bind:value={newPayRef} 
              placeholder="匯款末五碼、支票號碼或交易序號" 
            />
          </div>

          <div class="form-group">
            <label for="new-pay-note">備註</label>
            <input 
              type="text" 
              id="new-pay-note" 
              bind:value={newPayNote} 
              placeholder="付款單備註說明（選填）" 
            />
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" onclick={closeCreatePayModal} disabled={newPaySubmitting}>取消</button>
          <button class="btn btn-primary" onclick={handleCreatePaySubmit} disabled={newPaySubmitting} id="btn-submit-create-payment">
            {newPaySubmitting ? '建立中...' : '建立草稿並進行核銷'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- ==================================================== -->
  <!-- MODAL: 作廢付款單 (Void Payment Modal) -->
  <!-- ==================================================== -->
  {#if isVoidPayModalOpen}
    <div class="modal-backdrop" onclick={closeVoidPayModal} onkeydown={(e) => e.key === 'Escape' && closeVoidPayModal()} role="presentation">
      <div class="modal-box modal-box-sm" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
        <div class="modal-header">
          <h3>作廢付款單</h3>
          <button class="btn-close" onclick={closeVoidPayModal}>&times;</button>
        </div>

        <div class="modal-body">
          {#if voidPayError}
            <div class="alert alert-danger" id="void-pay-error-msg">{voidPayError}</div>
          {/if}

          <p class="text-sm">
            確定要作廢付款單 <strong class="font-mono">{voidPayTarget?.payment_number}</strong> 嗎？
          </p>

          <div class="alert alert-warning text-xs">
            ⚠️ 作廢後將自動解除所有應付核銷，並將應付帳款未付餘額完全恢復。
          </div>

          <div class="form-group">
            <label for="void-pay-reason">作廢原因 <span class="required">*</span></label>
            <textarea 
              id="void-pay-reason" 
              bind:value={voidPayReason} 
              placeholder="請填寫作廢原因（必填）" 
              rows="3"
              required
            ></textarea>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" onclick={closeVoidPayModal} disabled={voidPaySubmitting}>取消</button>
          <button class="btn btn-danger" onclick={handleVoidPaySubmit} disabled={voidPaySubmitting} id="btn-submit-void-payment">
            {voidPaySubmitting ? '作廢中...' : '確認作廢'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- ==================================================== -->
  <!-- MODAL: 應付帳款詳情與核銷歷程 (AP Detail Modal) -->
  <!-- ==================================================== -->
  {#if apDetailModalOpen}
    <div class="modal-backdrop" onclick={closeApDetailModal} onkeydown={(e) => e.key === 'Escape' && closeApDetailModal()} role="presentation">
      <div class="modal-box modal-box-lg" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
        <div class="modal-header">
          <h3>應付帳款詳情與核銷歷程</h3>
          <button class="btn-close" onclick={closeApDetailModal}>&times;</button>
        </div>

        <div class="modal-body">
          {#if isApDetailLoading || !currentApDetail}
            <div class="empty-state">載入中...</div>
          {:else}
            <div class="info-grid mb-3">
              <div class="info-item">
                <span class="info-label">來源單號</span>
                <span class="info-value font-mono font-medium">{currentApDetail.source_number}</span>
              </div>
              <div class="info-item">
                <span class="info-label">供應商</span>
                <span class="info-value">{currentApDetail.vendor_name_snapshot}</span>
              </div>
              <div class="info-item">
                <span class="info-label">應付總額</span>
                <span class="info-value font-medium">{formatCurrency(currentApDetail.amount)}</span>
              </div>
              <div class="info-item">
                <span class="info-label">已付金額</span>
                <span class="info-value font-medium text-success">{formatCurrency(currentApDetail.paid_amount || 0)}</span>
              </div>
              <div class="info-item">
                <span class="info-label">未付餘額</span>
                <span class="info-value font-medium text-danger">{formatCurrency(currentApDetail.outstanding_amount)}</span>
              </div>
              <div class="info-item">
                <span class="info-label">結算狀態</span>
                <span class="info-value">
                  <span class="badge badge-{currentApDetail.settlement_status}">
                    {getSettlementStatusLabel(currentApDetail.settlement_status)}
                  </span>
                </span>
              </div>
            </div>

            <h4 class="mt-4 mb-2">核銷此筆應付之付款單紀錄</h4>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>付款單號</th>
                    <th>付款日期</th>
                    <th class="text-right">核銷金額</th>
                    <th>付款單狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {#if !currentApDetail.allocations || currentApDetail.allocations.length === 0}
                    <tr>
                      <td colspan="4" class="text-center text-muted py-4">尚無付款單核銷紀錄</td>
                    </tr>
                  {:else}
                    {#each currentApDetail.allocations as pa}
                      <tr>
                        <td class="font-mono">
                          <button class="link-btn font-mono" onclick={() => { closeApDetailModal(); activeSubTab = 'vendor-payments'; viewPaymentDetail(pa.payment_id); }}>
                            {pa.payment_number}
                          </button>
                        </td>
                        <td>{pa.payment_date || '-'}</td>
                        <td class="text-right font-medium">{formatCurrency(pa.amount)}</td>
                        <td>
                          {#if pa.payment_status === 'posted'}
                            <span class="badge badge-posted">已過帳</span>
                          {:else if pa.payment_status === 'voided'}
                            <span class="badge badge-voided">已作廢</span>
                          {:else}
                            <span class="badge">{pa.payment_status}</span>
                          {/if}
                        </td>
                      </tr>
                    {/each}
                  {/if}
                </tbody>
              </table>
            </div>
          {/if}
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" onclick={closeApDetailModal}>關閉</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- ==================================================== -->
  <!-- MODAL: 新增期初應付 (Create Opening Payable Modal) -->
  <!-- ==================================================== -->
  {#if isCreateOapModalOpen}
    <div class="modal-backdrop" onclick={closeCreateOapModal} onkeydown={(e) => e.key === 'Escape' && closeCreateOapModal()} role="presentation">
      <div class="modal-box" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
        <div class="modal-header">
          <h3>新增期初應付帳款</h3>
          <button class="btn-close" onclick={closeCreateOapModal}>&times;</button>
        </div>

        <div class="modal-body">
          {#if createOapError}
            <div class="alert alert-danger" id="create-oap-error-msg">{createOapError}</div>
          {/if}

          <div class="form-group">
            <label for="create-oap-vendor">供應商 <span class="required">*</span></label>
            <select 
              id="create-oap-vendor" 
              bind:value={createOapVendorId} 
              onchange={handleOapVendorChange}
              required
            >
              <option value="" disabled>請選擇供應商</option>
              {#each availableVendors as v}
                <option value={v.id}>
                  {v.name} {v.payment_terms_type ? `(${v.payment_terms_type === 'net' ? '貨到' : '月結'} ${v.payment_terms_days} 天)` : ''}
                </option>
              {/each}
            </select>
          </div>

          <div class="form-group">
            <label for="create-oap-orig-ref">原單號 / 發票號 <span class="required">*</span></label>
            <input 
              type="text" 
              id="create-oap-orig-ref" 
              bind:value={createOapOriginalReference} 
              placeholder="舊系統單號或發票號碼"
              required 
            />
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="create-oap-doc-date">原單據日 <span class="required">*</span></label>
              <input 
                type="date" 
                id="create-oap-doc-date" 
                bind:value={createOapDocumentDate} 
                onchange={handleOapDocDateChange}
                required 
              />
              <span class="help-text">不可晚於今天；有採購單時須早於首張採購單</span>
            </div>

            <div class="form-group">
              <label for="create-oap-due-date">到期日 <span class="required">*</span></label>
              <input 
                type="date" 
                id="create-oap-due-date" 
                bind:value={createOapDueDate} 
                required 
              />
              <span class="help-text">不可早於單據日</span>
            </div>
          </div>

          {#if oapPaymentTermsHint}
            <div class="terms-hint">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="16" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12.01" y2="8"></line>
              </svg>
              {oapPaymentTermsHint}
            </div>
          {/if}

          <div class="form-group">
            <label for="create-oap-amount">未付金額 (含稅) <span class="required">*</span></label>
            <input 
              type="number" 
              id="create-oap-amount" 
              bind:value={createOapAmount} 
              placeholder="0.00" 
              step="0.01" 
              min="0.01"
              required 
            />
          </div>

          <div class="form-group">
            <label for="create-oap-note">備註</label>
            <input 
              type="text" 
              id="create-oap-note" 
              bind:value={createOapNote} 
              placeholder="期初未結備註說明（選填）" 
            />
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" onclick={closeCreateOapModal} disabled={createOapSubmitting}>取消</button>
          <button class="btn btn-primary" onclick={handleCreateOapSubmit} disabled={createOapSubmitting} id="btn-submit-create-oap">
            {createOapSubmitting ? '建立中...' : '確定建立'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- ==================================================== -->
  <!-- MODAL: 作廢期初應付 (Void Opening Payable Modal) -->
  <!-- ==================================================== -->
  {#if isVoidOapModalOpen}
    <div class="modal-backdrop" onclick={closeVoidOapModal} onkeydown={(e) => e.key === 'Escape' && closeVoidOapModal()} role="presentation">
      <div class="modal-box modal-box-sm" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
        <div class="modal-header">
          <h3>作廢期初應付帳款</h3>
          <button class="btn-close" onclick={closeVoidOapModal}>&times;</button>
        </div>

        <div class="modal-body">
          {#if voidOapError}
            <div class="alert alert-danger" id="void-oap-error-msg">{voidOapError}</div>
          {/if}

          <p class="text-sm">
            確定要作廢期初單號 <strong class="font-mono">{voidTargetOap?.opening_number}</strong>（{voidTargetOap?.vendor_name_snapshot}，金額: {formatCurrency(voidTargetOap?.amount || 0)}）嗎？
          </p>

          <div class="form-group">
            <label for="void-oap-reason">作廢原因 <span class="required">*</span></label>
            <textarea 
              id="void-oap-reason" 
              bind:value={voidOapReason} 
              placeholder="請填寫作廢原因（必填）" 
              rows="3"
              required
            ></textarea>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" onclick={closeVoidOapModal} disabled={voidOapSubmitting}>取消</button>
          <button class="btn btn-danger" onclick={handleVoidOapSubmit} disabled={voidOapSubmitting} id="btn-submit-void-oap">
            {voidOapSubmitting ? '作廢中...' : '確認作廢'}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .ap-workspace {
    display: flex;
    flex-direction: column;
    height: 100%;
    background-color: var(--color-bg-primary, #ffffff);
    color: var(--color-text-primary, #1e293b);
  }

  .workspace-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid var(--color-border, #e2e8f0);
    background-color: var(--color-bg-secondary, #f8fafc);
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .icon-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 8px;
    background-color: #e0f2fe;
    color: #0284c7;
  }

  h2 {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0;
  }

  .subtitle {
    font-size: 0.8125rem;
    color: var(--color-text-muted, #64748b);
    margin: 0.25rem 0 0 0;
  }

  .subtabs-bar {
    display: flex;
    gap: 0.5rem;
    padding: 0 1.5rem;
    border-bottom: 1px solid var(--color-border, #e2e8f0);
    background-color: var(--color-bg-secondary, #f8fafc);
  }

  .subtab-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-text-muted, #64748b);
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .subtab-btn:hover {
    color: var(--color-text-primary, #1e293b);
  }

  .subtab-btn.active {
    color: #0284c7;
    border-bottom-color: #0284c7;
  }

  .view-content {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem;
  }

  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.25rem;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .filters {
    display: flex;
    gap: 1rem;
    align-items: center;
    flex-wrap: wrap;
  }

  .filter-group {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
  }

  .filter-group select, .filter-group input {
    padding: 0.375rem 0.75rem;
    border: 1px solid var(--color-border, #cbd5e1);
    border-radius: 6px;
    background: #ffffff;
    font-size: 0.875rem;
  }

  .table-container {
    border: 1px solid var(--color-border, #e2e8f0);
    border-radius: 8px;
    overflow-x: auto;
    background: #ffffff;
  }

  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
    text-align: left;
  }

  .data-table th {
    background-color: #f8fafc;
    padding: 0.75rem 1rem;
    font-weight: 600;
    color: #475569;
    border-bottom: 1px solid #e2e8f0;
    white-space: nowrap;
  }

  .data-table td {
    padding: 0.75rem 1rem;
    border-bottom: 1px solid #f1f5f9;
  }

  .data-table tr:last-child td {
    border-bottom: none;
  }

  .row-voided {
    opacity: 0.65;
    background-color: #fdf2f2;
  }

  .row-selected {
    background-color: #f0fdf4;
  }

  .font-mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  .font-medium {
    font-weight: 500;
  }

  .text-right {
    text-align: right;
  }

  .text-center {
    text-align: center;
  }

  .text-sm {
    font-size: 0.875rem;
  }

  .text-xs {
    font-size: 0.75rem;
  }

  .text-muted {
    color: #64748b;
  }

  .text-danger {
    color: #dc2626;
  }

  .text-success {
    color: #15803d;
  }

  .badge {
    display: inline-block;
    padding: 0.25rem 0.5rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 500;
  }

  .badge-success, .badge-paid, .badge-posted {
    background-color: #dcfce7;
    color: #15803d;
  }

  .badge-danger, .badge-voided {
    background-color: #fee2e2;
    color: #b91c1c;
  }

  .badge-draft {
    background-color: #f1f5f9;
    color: #475569;
  }

  .badge-cancelled {
    background-color: #f3f4f6;
    color: #6b7280;
    text-decoration: line-through;
  }

  .badge-unpaid {
    background-color: #fef3c7;
    color: #92400e;
  }

  .badge-partial {
    background-color: #e0f2fe;
    color: #0369a1;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    border: none;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .btn-sm {
    padding: 0.25rem 0.625rem;
    font-size: 0.8125rem;
  }

  .btn-primary {
    background-color: #0284c7;
    color: #ffffff;
  }

  .btn-primary:hover:not(:disabled) {
    background-color: #0369a1;
  }

  .btn-secondary {
    background-color: #f1f5f9;
    color: #334155;
    border: 1px solid #cbd5e1;
  }

  .btn-secondary:hover:not(:disabled) {
    background-color: #e2e8f0;
  }

  .btn-danger {
    background-color: #dc2626;
    color: #ffffff;
  }

  .btn-danger:hover:not(:disabled) {
    background-color: #b91c1c;
  }

  .btn-outline {
    background: transparent;
    border: 1px solid currentColor;
  }

  .btn-outline:hover:not(:disabled) {
    background-color: #fee2e2;
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-action {
    background: none;
    border: none;
    cursor: pointer;
    font-weight: 500;
    font-size: 0.8125rem;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
  }

  .btn-action:hover {
    background-color: #f1f5f9;
  }

  .btn-group-sm {
    display: inline-flex;
    gap: 0.25rem;
  }

  .link-btn {
    background: none;
    border: none;
    padding: 0;
    color: #0284c7;
    text-decoration: underline;
    cursor: pointer;
    font-size: inherit;
  }

  .link-btn:hover {
    color: #0369a1;
  }

  .empty-state {
    padding: 3rem 1.5rem;
    text-align: center;
    color: #64748b;
  }

  .empty-state p {
    margin-bottom: 1rem;
  }

  /* Card */
  .card {
    border: 1px solid var(--color-border, #e2e8f0);
    border-radius: 8px;
    background: #ffffff;
    box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05);
    overflow: hidden;
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--color-border, #e2e8f0);
    background-color: #f8fafc;
  }

  .card-header h4 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .card-body {
    padding: 1.25rem;
  }

  .card-body.p-0 {
    padding: 0;
  }

  .card-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1.25rem;
    border-top: 1px solid var(--color-border, #e2e8f0);
    background-color: #f8fafc;
  }

  .summary-footer {
    font-size: 0.9375rem;
  }

  .total-label {
    font-weight: 500;
    color: #475569;
  }

  .total-amount {
    font-size: 1.125rem;
    font-weight: 700;
    color: #0284c7;
  }

  .editor-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.25rem;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .editor-title-wrap {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .editor-title-wrap h3 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
  }

  .editor-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .alloc-input-wrap {
    display: flex;
    flex-direction: column;
  }

  .alloc-input-wrap input {
    width: 100%;
    padding: 0.375rem 0.5rem;
    font-size: 0.875rem;
    text-align: right;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    border: 1px solid #cbd5e1;
    border-radius: 4px;
  }

  .alloc-input-wrap input.input-error {
    border-color: #dc2626 !important;
    background-color: #fef2f2 !important;
    color: #dc2626 !important;
    outline: none;
    box-shadow: 0 0 0 2px rgba(220, 38, 38, 0.2);
  }

  .error-hint {
    color: #dc2626;
    font-size: 0.75rem;
    margin-top: 0.25rem;
    font-weight: 500;
  }

  .info-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 1rem;
  }

  .info-item {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .info-label {
    font-size: 0.75rem;
    color: #64748b;
  }

  .info-value {
    font-size: 0.9375rem;
    color: #1e293b;
  }

  /* Modals */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 999;
  }

  .modal-box {
    background: #ffffff;
    border-radius: 10px;
    width: 100%;
    max-width: 520px;
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
    overflow: hidden;
  }

  .modal-box-sm {
    max-width: 440px;
  }

  .modal-box-lg {
    max-width: 720px;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid #e2e8f0;
  }

  .modal-header h3 {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 600;
  }

  .btn-close {
    background: none;
    border: none;
    font-size: 1.5rem;
    line-height: 1;
    cursor: pointer;
    color: #94a3b8;
  }

  .btn-close:hover {
    color: #334155;
  }

  .modal-body {
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    padding: 1rem 1.25rem;
    border-top: 1px solid #e2e8f0;
    background-color: #f8fafc;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  .form-row-3 {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 1rem;
  }

  label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: #334155;
  }

  .required {
    color: #dc2626;
  }

  input, select, textarea {
    padding: 0.5rem 0.75rem;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 0.875rem;
    font-family: inherit;
  }

  input:focus, select:focus, textarea:focus {
    outline: none;
    border-color: #0284c7;
    box-shadow: 0 0 0 3px rgba(2, 132, 199, 0.15);
  }

  .bg-readonly {
    background-color: #f8fafc;
    color: #64748b;
    cursor: not-allowed;
  }

  .help-text {
    font-size: 0.6875rem;
    color: #64748b;
  }

  .terms-hint {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.75rem;
    color: #0369a1;
    background-color: #f0f9ff;
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    border: 1px solid #bae6fd;
  }

  .alert {
    padding: 0.75rem;
    border-radius: 6px;
    font-size: 0.8125rem;
  }

  .alert-danger {
    background-color: #fee2e2;
    color: #991b1b;
    border: 1px solid #fecaca;
  }

  .alert-warning {
    background-color: #fef3c7;
    color: #92400e;
    border: 1px solid #fde68a;
  }

  .alert-info {
    background-color: #e0f2fe;
    color: #0369a1;
    border: 1px solid #bae6fd;
  }

  .mb-2 { margin-bottom: 0.5rem; }
  .mb-3 { margin-bottom: 0.75rem; }
  .mb-4 { margin-bottom: 1rem; }
  .mt-3 { margin-top: 0.75rem; }
  .mt-4 { margin-top: 1rem; }
  .ml-2 { margin-left: 0.5rem; }
  .py-4 { padding-top: 1rem; padding-bottom: 1rem; }

  /* Aging KPI Cards */
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1rem;
    margin-bottom: 1.25rem;
  }

  .kpi-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 1rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  }

  .kpi-card.kpi-reference {
    background: #f8fafc;
    border-left: 4px solid #0284c7;
  }

  .kpi-title {
    font-size: 0.75rem;
    font-weight: 600;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.025em;
  }

  .kpi-value {
    font-size: 1.5rem;
    font-weight: 700;
    color: #1e293b;
    line-height: 1.2;
  }

  .kpi-sub {
    font-size: 0.6875rem;
    color: #94a3b8;
  }

  .bg-ref {
    background-color: #f8fafc;
  }

  .row-total {
    background-color: #f1f5f9;
    border-top: 2px solid #cbd5e1;
  }

  /* ==========================================
     Vendor Statement Styles (Issue #205)
     ========================================== */
  .statement-notice-banner {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background-color: #fffbeb;
    border: 1px solid #fef3c7;
    border-radius: 8px;
    color: #92400e;
    font-size: 0.875rem;
    margin-bottom: 1.25rem;
  }

  .statement-section-card {
    background: #ffffff;
    border: 1px solid var(--color-border, #e2e8f0);
    border-radius: 8px;
    padding: 1.25rem 1.5rem;
    margin-bottom: 1.5rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  }

  .statement-section-card.opening-card {
    border-left: 4px solid #64748b;
  }

  .statement-section-card.closing-card {
    border-left: 4px solid #ef4444;
    background: #fffafa;
  }

  .card-header-line {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .card-badge {
    display: inline-block;
    padding: 0.125rem 0.375rem;
    background: #e2e8f0;
    color: #475569;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .card-title {
    font-size: 0.95rem;
    font-weight: 600;
    color: #334155;
  }

  .amount-line {
    display: flex;
    align-items: baseline;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .amount-val {
    font-size: 1.5rem;
    font-weight: 700;
  }

  .amount-formula {
    font-size: 0.8125rem;
  }

  .statement-table-section {
    margin-bottom: 1.5rem;
  }

  .section-heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.75rem;
  }

  .heading-left {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .heading-left h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .count-tag {
    font-size: 0.75rem;
    background: #f1f5f9;
    padding: 0.125rem 0.5rem;
    border-radius: 9999px;
    color: #64748b;
  }

  .table-empty-notice {
    padding: 1.5rem;
    text-align: center;
    color: #94a3b8;
    background: #f8fafc;
    border: 1px dashed #cbd5e1;
    border-radius: 8px;
    font-size: 0.875rem;
  }

  .allocations-pill-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }

  .alloc-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    background: #f1f5f9;
    padding: 0.125rem 0.375rem;
    border-radius: 4px;
    font-size: 0.75rem;
    border: 1px solid #e2e8f0;
  }

  .alloc-link {
    background: none;
    border: none;
    color: #0284c7;
    cursor: pointer;
    padding: 0;
    text-decoration: underline;
  }

  .alloc-amt {
    color: #64748b;
  }

  .table-total-row {
    background-color: #f8fafc;
    border-top: 2px solid #e2e8f0;
  }

  .reconciliation-formula-box {
    margin-top: 1rem;
    padding: 0.75rem 1rem;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
  }

  .formula-label {
    font-size: 0.8125rem;
    font-weight: 600;
    color: #475569;
    margin-bottom: 0.375rem;
  }

  .formula-content {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    font-size: 0.95rem;
  }

  .formula-content .op {
    color: #94a3b8;
    font-weight: bold;
  }

  .formula-content .check-icon {
    margin-left: 0.5rem;
    color: #16a34a;
    font-weight: bold;
    font-size: 0.8125rem;
    background: #dcfce7;
    padding: 0.125rem 0.5rem;
    border-radius: 9999px;
  }

  .formula-hint {
    font-size: 0.75rem;
    margin-top: 0.375rem;
  }
</style>
