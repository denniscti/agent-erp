// @ts-check
import { invoke } from '../tauri.js';
import { appState, showToast } from '../store.svelte.js';

/**
 * Load customer receipts list with filter
 * @param {any} [filter]
 * @returns {Promise<any[]>}
 */
export async function loadCustomerReceiptsAction(filter = {}) {
  try {
    const list = await invoke('list_customer_receipts', {
      filter,
      ...filter
    });
    appState.customerReceipts = list || [];
    return appState.customerReceipts;
  } catch (err) {
    console.error("Failed to load customer receipts:", err);
    throw err;
  }
}

/**
 * Get customer receipt detail by ID
 * @param {string} receiptId
 * @returns {Promise<any>}
 */
export async function getCustomerReceiptAction(receiptId) {
  try {
    const detail = await invoke('get_customer_receipt', {
      receipt_id: receiptId,
      receiptId,
      id: receiptId
    });
    appState.currentCustomerReceiptDetail = detail;
    appState.selectedCustomerReceiptId = detail.id;
    return detail;
  } catch (err) {
    console.error("Failed to get customer receipt detail:", err);
    throw err;
  }
}

/**
 * Create customer receipt draft
 * @param {any} input
 * @returns {Promise<any>}
 */
export async function createCustomerReceiptAction(input) {
  try {
    const detail = await invoke('create_customer_receipt', { input });
    showToast(`建立收款單「${detail.receipt_number}」成功！`);
    appState.currentCustomerReceiptDetail = detail;
    appState.selectedCustomerReceiptId = detail.id;
    await loadCustomerReceiptsAction();
    return detail;
  } catch (err) {
    console.error("Failed to create customer receipt:", err);
    throw err;
  }
}

/**
 * Update customer receipt header
 * @param {any} input
 * @returns {Promise<any>}
 */
export async function updateCustomerReceiptHeaderAction(input) {
  try {
    const detail = await invoke('update_customer_receipt_header', { input });
    showToast(`收款單表頭更新成功！`);
    appState.currentCustomerReceiptDetail = detail;
    await loadCustomerReceiptsAction();
    return detail;
  } catch (err) {
    console.error("Failed to update customer receipt header:", err);
    throw err;
  }
}

/**
 * Add allocation to draft customer receipt
 * @param {string} receiptId
 * @param {string} accountReceivableId
 * @param {number} amount
 * @returns {Promise<any>}
 */
export async function addCustomerReceiptAllocationAction(receiptId, accountReceivableId, amount) {
  try {
    const detail = await invoke('add_customer_receipt_allocation', {
      receipt_id: receiptId,
      receiptId,
      account_receivable_id: accountReceivableId,
      accountReceivableId,
      amount,
      input: {
        receipt_id: receiptId,
        receiptId,
        account_receivable_id: accountReceivableId,
        accountReceivableId,
        amount
      }
    });
    appState.currentCustomerReceiptDetail = detail;
    return detail;
  } catch (err) {
    console.error("Failed to add customer receipt allocation:", err);
    throw err;
  }
}

/**
 * Update allocation amount on draft customer receipt
 * @param {string} receiptId
 * @param {string} allocationId
 * @param {number} amount
 * @returns {Promise<any>}
 */
export async function updateCustomerReceiptAllocationAction(receiptId, allocationId, amount) {
  try {
    const detail = await invoke('update_customer_receipt_allocation', {
      receipt_id: receiptId,
      receiptId,
      allocation_id: allocationId,
      allocationId,
      amount,
      input: {
        receipt_id: receiptId,
        receiptId,
        allocation_id: allocationId,
        allocationId,
        amount
      }
    });
    appState.currentCustomerReceiptDetail = detail;
    return detail;
  } catch (err) {
    console.error("Failed to update customer receipt allocation:", err);
    throw err;
  }
}

/**
 * Remove allocation from draft customer receipt
 * @param {string} receiptId
 * @param {string} allocationId
 * @returns {Promise<any>}
 */
export async function removeCustomerReceiptAllocationAction(receiptId, allocationId) {
  try {
    const detail = await invoke('remove_customer_receipt_allocation', {
      receipt_id: receiptId,
      receiptId,
      allocation_id: allocationId,
      allocationId,
      input: {
        receipt_id: receiptId,
        receiptId,
        allocation_id: allocationId,
        allocationId
      }
    });
    appState.currentCustomerReceiptDetail = detail;
    return detail;
  } catch (err) {
    console.error("Failed to remove customer receipt allocation:", err);
    throw err;
  }
}

/**
 * Post customer receipt (draft -> posted)
 * @param {string} receiptId
 * @returns {Promise<any>}
 */
export async function postCustomerReceiptAction(receiptId) {
  try {
    const detail = await invoke('post_customer_receipt', {
      receipt_id: receiptId,
      receiptId,
      id: receiptId
    });
    showToast(`收款單「${detail.receipt_number}」已成功過帳！`);
    appState.currentCustomerReceiptDetail = detail;
    await loadCustomerReceiptsAction();
    return detail;
  } catch (err) {
    console.error("Failed to post customer receipt:", err);
    throw err;
  }
}

/**
 * Cancel draft customer receipt (draft -> cancelled)
 * @param {string} receiptId
 * @returns {Promise<any>}
 */
export async function cancelCustomerReceiptAction(receiptId) {
  try {
    const detail = await invoke('cancel_customer_receipt', {
      receipt_id: receiptId,
      receiptId,
      id: receiptId
    });
    showToast(`收款單「${detail.receipt_number}」已取消！`);
    appState.currentCustomerReceiptDetail = detail;
    await loadCustomerReceiptsAction();
    return detail;
  } catch (err) {
    console.error("Failed to cancel customer receipt:", err);
    throw err;
  }
}

/**
 * Void posted customer receipt (posted -> voided)
 * @param {string} receiptId
 * @param {string} voidReason
 * @returns {Promise<any>}
 */
export async function voidCustomerReceiptAction(receiptId, voidReason) {
  try {
    const detail = await invoke('void_customer_receipt', {
      receipt_id: receiptId,
      receiptId,
      id: receiptId,
      void_reason: voidReason,
      voidReason
    });
    showToast(`收款單「${detail.receipt_number}」已作廢！`);
    appState.currentCustomerReceiptDetail = detail;
    await loadCustomerReceiptsAction();
    return detail;
  } catch (err) {
    console.error("Failed to void customer receipt:", err);
    throw err;
  }
}

/**
 * Load open accounts receivable for a customer
 * @param {string} customerPartnerId
 * @returns {Promise<any[]>}
 */
export async function loadCustomerOpenReceivablesAction(customerPartnerId) {
  try {
    const list = await invoke('list_accounts_receivable', {
      customer_partner_id: customerPartnerId,
      customerPartnerId,
      status: 'open'
    });
    return (list || []).filter(ar => ar.outstanding_amount > 0);
  } catch (err) {
    console.error("Failed to load customer open receivables:", err);
    throw err;
  }
}

