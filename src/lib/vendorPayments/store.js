// @ts-check
import { invoke } from '../tauri.js';
import { appState, showToast } from '../store.svelte.js';

/**
 * Load vendor payments list with filter
 * @param {any} [filter]
 * @returns {Promise<any[]>}
 */
export async function loadVendorPaymentsAction(filter = {}) {
  try {
    const list = await invoke('list_vendor_payments', {
      filter,
      ...filter
    });
    appState.vendorPayments = list || [];
    return appState.vendorPayments;
  } catch (err) {
    console.error("Failed to load vendor payments:", err);
    throw err;
  }
}

/**
 * Get vendor payment detail by ID
 * @param {string} paymentId
 * @returns {Promise<any>}
 */
export async function getVendorPaymentAction(paymentId) {
  try {
    const detail = await invoke('get_vendor_payment', {
      payment_id: paymentId,
      paymentId,
      id: paymentId
    });
    appState.currentVendorPaymentDetail = detail;
    appState.selectedVendorPaymentId = detail.id;
    return detail;
  } catch (err) {
    console.error("Failed to get vendor payment detail:", err);
    throw err;
  }
}

/**
 * Create vendor payment draft
 * @param {any} input
 * @returns {Promise<any>}
 */
export async function createVendorPaymentAction(input) {
  try {
    const detail = await invoke('create_vendor_payment', { input });
    showToast(`建立付款單「${detail.payment_number}」成功！`);
    appState.currentVendorPaymentDetail = detail;
    appState.selectedVendorPaymentId = detail.id;
    await loadVendorPaymentsAction();
    return detail;
  } catch (err) {
    console.error("Failed to create vendor payment:", err);
    throw err;
  }
}

/**
 * Update vendor payment header
 * @param {any} input
 * @returns {Promise<any>}
 */
export async function updateVendorPaymentHeaderAction(input) {
  try {
    const detail = await invoke('update_vendor_payment_header', { input });
    showToast(`付款單表頭更新成功！`);
    appState.currentVendorPaymentDetail = detail;
    await loadVendorPaymentsAction();
    return detail;
  } catch (err) {
    console.error("Failed to update vendor payment header:", err);
    throw err;
  }
}

/**
 * Add allocation to draft vendor payment
 * @param {string} paymentId
 * @param {string} accountPayableId
 * @param {number} amount
 * @returns {Promise<any>}
 */
export async function addVendorPaymentAllocationAction(paymentId, accountPayableId, amount) {
  try {
    const detail = await invoke('add_vendor_payment_allocation', {
      payment_id: paymentId,
      paymentId,
      account_payable_id: accountPayableId,
      accountPayableId,
      amount,
      input: {
        payment_id: paymentId,
        paymentId,
        account_payable_id: accountPayableId,
        accountPayableId,
        amount
      }
    });
    appState.currentVendorPaymentDetail = detail;
    return detail;
  } catch (err) {
    console.error("Failed to add vendor payment allocation:", err);
    throw err;
  }
}

/**
 * Update allocation amount on draft vendor payment
 * @param {string} paymentId
 * @param {string} allocationId
 * @param {number} amount
 * @returns {Promise<any>}
 */
export async function updateVendorPaymentAllocationAction(paymentId, allocationId, amount) {
  try {
    const detail = await invoke('update_vendor_payment_allocation', {
      payment_id: paymentId,
      paymentId,
      allocation_id: allocationId,
      allocationId,
      amount,
      input: {
        payment_id: paymentId,
        paymentId,
        allocation_id: allocationId,
        allocationId,
        amount
      }
    });
    appState.currentVendorPaymentDetail = detail;
    return detail;
  } catch (err) {
    console.error("Failed to update vendor payment allocation:", err);
    throw err;
  }
}

/**
 * Remove allocation from draft vendor payment
 * @param {string} paymentId
 * @param {string} allocationId
 * @returns {Promise<any>}
 */
export async function removeVendorPaymentAllocationAction(paymentId, allocationId) {
  try {
    const detail = await invoke('remove_vendor_payment_allocation', {
      payment_id: paymentId,
      paymentId,
      allocation_id: allocationId,
      allocationId,
      input: {
        payment_id: paymentId,
        paymentId,
        allocation_id: allocationId,
        allocationId
      }
    });
    appState.currentVendorPaymentDetail = detail;
    return detail;
  } catch (err) {
    console.error("Failed to remove vendor payment allocation:", err);
    throw err;
  }
}

/**
 * Post vendor payment (draft -> posted)
 * @param {string} paymentId
 * @returns {Promise<any>}
 */
export async function postVendorPaymentAction(paymentId) {
  try {
    const detail = await invoke('post_vendor_payment', {
      payment_id: paymentId,
      paymentId,
      id: paymentId
    });
    showToast(`付款單「${detail.payment_number}」已成功過帳！`);
    appState.currentVendorPaymentDetail = detail;
    await loadVendorPaymentsAction();
    return detail;
  } catch (err) {
    console.error("Failed to post vendor payment:", err);
    throw err;
  }
}

/**
 * Cancel draft vendor payment (draft -> cancelled)
 * @param {string} paymentId
 * @returns {Promise<any>}
 */
export async function cancelVendorPaymentAction(paymentId) {
  try {
    const detail = await invoke('cancel_vendor_payment', {
      payment_id: paymentId,
      paymentId,
      id: paymentId
    });
    showToast(`付款單「${detail.payment_number}」已取消！`);
    appState.currentVendorPaymentDetail = detail;
    await loadVendorPaymentsAction();
    return detail;
  } catch (err) {
    console.error("Failed to cancel vendor payment:", err);
    throw err;
  }
}

/**
 * Void posted vendor payment (posted -> voided)
 * @param {string} paymentId
 * @param {string} voidReason
 * @returns {Promise<any>}
 */
export async function voidVendorPaymentAction(paymentId, voidReason) {
  try {
    const detail = await invoke('void_vendor_payment', {
      payment_id: paymentId,
      paymentId,
      id: paymentId,
      void_reason: voidReason,
      voidReason
    });
    showToast(`付款單「${detail.payment_number}」已作廢！`);
    appState.currentVendorPaymentDetail = detail;
    await loadVendorPaymentsAction();
    return detail;
  } catch (err) {
    console.error("Failed to void vendor payment:", err);
    throw err;
  }
}

