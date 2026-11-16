// @ts-check
import { invoke } from '../tauri.js';
import { appState, showToast } from '../store.svelte.js';

/**
 * Fetch vendor bills list
 * @param {any} [filter={}]
 * @returns {Promise<any[]>}
 */
export async function fetchVendorBills(filter = {}) {
  try {
    const payload = {};
    if (filter.vendor_partner_id || filter.vendorPartnerId) {
      const v = filter.vendor_partner_id || filter.vendorPartnerId;
      payload.vendorPartnerId = v;
      payload.vendor_partner_id = v;
    }
    if (filter.status) {
      payload.status = filter.status;
    }
    const list = await invoke('list_vendor_bills', payload);
    appState.vendorBills = list || [];
    return appState.vendorBills;
  } catch (err) {
    console.error("Failed to fetch vendor bills:", err);
    throw err;
  }
}

/**
 * Fetch vendor bill detail
 * @param {string} billId
 * @returns {Promise<any>}
 */
export async function fetchVendorBillDetail(billId) {
  try {
    const detail = await invoke('get_vendor_bill', {
      id: billId,
      billId,
      bill_id: billId
    });
    appState.currentVendorBillDetail = detail;
    return detail;
  } catch (err) {
    console.error("Failed to fetch vendor bill detail:", err);
    throw err;
  }
}

/**
 * Fetch unbilled received orders
 * @param {string | null} [vendorPartnerId=null]
 * @returns {Promise<any[]>}
 */
export async function fetchUnbilledReceivedOrders(vendorPartnerId = null) {
  try {
    const list = await invoke('list_unbilled_received_orders', {
      vendorPartnerId: vendorPartnerId || null,
      vendor_partner_id: vendorPartnerId || null
    });
    appState.unbilledReceivedOrders = list || [];
    return appState.unbilledReceivedOrders;
  } catch (err) {
    console.error("Failed to fetch unbilled received orders:", err);
    throw err;
  }
}

/**
 * Fetch billing info for a purchase order
 * @param {string} purchaseOrderId
 * @returns {Promise<any | null>}
 */
export async function fetchPurchaseOrderBillingInfo(purchaseOrderId) {
  try {
    return await invoke('get_purchase_order_billing_info', {
      purchaseOrderId,
      purchase_order_id: purchaseOrderId
    });
  } catch (err) {
    console.error("Failed to fetch purchase order billing info:", err);
    return null;
  }
}

/**
 * Create vendor bill
 * @param {any} input
 * @returns {Promise<any>}
 */
export async function createVendorBillAction(input) {
  try {
    const detail = await invoke('create_vendor_bill', { input });
    showToast(`請款單「${detail.bill.bill_number}」已建立！`);
    await fetchVendorBills();
    return detail;
  } catch (err) {
    console.error("Failed to create vendor bill:", err);
    throw err;
  }
}

/**
 * Update vendor bill header
 * @param {any} input
 * @returns {Promise<any>}
 */
export async function updateVendorBillHeaderAction(input) {
  try {
    const detail = await invoke('update_vendor_bill_header', { input });
    showToast(`請款單「${detail.bill.bill_number}」表頭已更新！`);
    appState.currentVendorBillDetail = detail;
    await fetchVendorBills();
    return detail;
  } catch (err) {
    console.error("Failed to update vendor bill header:", err);
    throw err;
  }
}

/**
 * Add purchase order to bill
 * @param {string} billId
 * @param {string} purchaseOrderId
 * @returns {Promise<any>}
 */
export async function addVendorBillOrderAction(billId, purchaseOrderId) {
  try {
    const detail = await invoke('add_vendor_bill_order', {
      billId,
      bill_id: billId,
      purchaseOrderId,
      purchase_order_id: purchaseOrderId
    });
    showToast(`已加入採購單至請款單！`);
    appState.currentVendorBillDetail = detail;
    await fetchVendorBills();
    return detail;
  } catch (err) {
    console.error("Failed to add order to vendor bill:", err);
    throw err;
  }
}

/**
 * Remove purchase order from bill
 * @param {string} billId
 * @param {string} purchaseOrderId
 * @returns {Promise<any>}
 */
export async function removeVendorBillOrderAction(billId, purchaseOrderId) {
  try {
    const detail = await invoke('remove_vendor_bill_order', {
      billId,
      bill_id: billId,
      purchaseOrderId,
      purchase_order_id: purchaseOrderId
    });
    showToast(`已自請款單移除採購單！`);
    appState.currentVendorBillDetail = detail;
    await fetchVendorBills();
    return detail;
  } catch (err) {
    console.error("Failed to remove order from vendor bill:", err);
    throw err;
  }
}

/**
 * Post vendor bill
 * @param {string} billId
 * @returns {Promise<any>}
 */
export async function postVendorBillAction(billId) {
  try {
    const detail = await invoke('post_vendor_bill', {
      billId,
      bill_id: billId
    });
    if (detail.bill.status === 'disputed') {
      showToast(`請款單「${detail.bill.bill_number}」金額不符，已轉為爭議待處理！`);
    } else {
      showToast(`請款單「${detail.bill.bill_number}」已成功過帳！`);
    }
    appState.currentVendorBillDetail = detail;
    await fetchVendorBills();
    return detail;
  } catch (err) {
    console.error("Failed to post vendor bill:", err);
    throw err;
  }
}

/**
 * Accept vendor bill difference
 * @param {string} billId
 * @param {string} differenceNote
 * @returns {Promise<any>}
 */
export async function acceptVendorBillDifferenceAction(billId, differenceNote) {
  try {
    const detail = await invoke('accept_vendor_bill_difference', {
      billId,
      bill_id: billId,
      differenceNote,
      difference_note: differenceNote
    });
    showToast(`已接受差異，請款單「${detail.bill.bill_number}」成功過帳！`);
    appState.currentVendorBillDetail = detail;
    await fetchVendorBills();
    return detail;
  } catch (err) {
    console.error("Failed to accept vendor bill difference:", err);
    throw err;
  }
}

/**
 * Return vendor bill to draft
 * @param {string} billId
 * @returns {Promise<any>}
 */
export async function returnVendorBillToDraftAction(billId) {
  try {
    const detail = await invoke('return_vendor_bill_to_draft', {
      billId,
      bill_id: billId
    });
    showToast(`請款單「${detail.bill.bill_number}」已退回草稿狀態！`);
    appState.currentVendorBillDetail = detail;
    await fetchVendorBills();
    return detail;
  } catch (err) {
    console.error("Failed to return vendor bill to draft:", err);
    throw err;
  }
}

/**
 * Cancel vendor bill
 * @param {string} billId
 * @returns {Promise<any>}
 */
export async function cancelVendorBillAction(billId) {
  try {
    const detail = await invoke('cancel_vendor_bill', {
      billId,
      bill_id: billId
    });
    showToast(`請款單「${detail.bill.bill_number}」已取消！`);
    appState.currentVendorBillDetail = detail;
    await fetchVendorBills();
    return detail;
  } catch (err) {
    console.error("Failed to cancel vendor bill:", err);
    throw err;
  }
}

/**
 * Void vendor bill
 * @param {string} billId
 * @param {string} voidReason
 * @returns {Promise<any>}
 */
export async function voidVendorBillAction(billId, voidReason) {
  try {
    const detail = await invoke('void_vendor_bill', {
      billId,
      bill_id: billId,
      voidReason,
      void_reason: voidReason
    });
    showToast(`請款單「${detail.bill.bill_number}」已作廢！`);
    appState.currentVendorBillDetail = detail;
    await fetchVendorBills();
    return detail;
  } catch (err) {
    console.error("Failed to void vendor bill:", err);
    throw err;
  }
}

