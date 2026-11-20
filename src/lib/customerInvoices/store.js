// @ts-check
import { invoke } from '../tauri.js';
import { appState, showToast } from '../store.svelte.js';

/**
 * Fetch customer invoices list
 * @param {any} [filter={}]
 * @returns {Promise<any[]>}
 */
export async function fetchCustomerInvoices(filter = {}) {
  try {
    const payload = {};
    if (filter.customer_partner_id || filter.customerPartnerId) {
      const c = filter.customer_partner_id || filter.customerPartnerId;
      payload.customerPartnerId = c;
      payload.customer_partner_id = c;
    }
    if (filter.status) {
      payload.statusFilter = filter.status;
      payload.status_filter = filter.status;
    }
    if (filter.searchQuery || filter.search_query) {
      const q = filter.searchQuery || filter.search_query;
      payload.searchQuery = q;
      payload.search_query = q;
    }
    const list = await invoke('list_customer_invoices', payload);
    appState.customerInvoices = list || [];
    return appState.customerInvoices;
  } catch (err) {
    console.error('Failed to fetch customer invoices:', err);
    throw err;
  }
}

/**
 * Fetch customer invoice detail
 * @param {string} invoiceId
 * @returns {Promise<any>}
 */
export async function fetchCustomerInvoiceDetail(invoiceId) {
  try {
    const detail = await invoke('get_customer_invoice', {
      id: invoiceId,
      invoiceId,
      invoice_id: invoiceId
    });
    appState.currentCustomerInvoiceDetail = detail;
    return detail;
  } catch (err) {
    console.error('Failed to fetch customer invoice detail:', err);
    throw err;
  }
}

/**
 * Fetch uninvoiced sales orders grouped into (a), (b), (c)
 * @param {string | null} [customerPartnerId=null]
 * @returns {Promise<any[]>}
 */
export async function fetchUninvoicedSalesOrders(customerPartnerId = null) {
  try {
    const list = await invoke('list_uninvoiced_sales_orders', {
      customerPartnerId: customerPartnerId || null,
      customer_partner_id: customerPartnerId || null
    });
    appState.uninvoicedSalesOrders = list || [];
    return appState.uninvoicedSalesOrders;
  } catch (err) {
    console.error('Failed to fetch uninvoiced sales orders:', err);
    throw err;
  }
}

/**
 * Fetch pending allowance invoices (CI-10 shortfall >= 1.0)
 * @param {string | null} [customerPartnerId=null]
 * @returns {Promise<any[]>}
 */
export async function fetchPendingAllowanceInvoices(customerPartnerId = null) {
  try {
    const list = await invoke('list_pending_allowance_invoices', {
      customerPartnerId: customerPartnerId || null,
      customer_partner_id: customerPartnerId || null
    });
    appState.pendingAllowanceInvoices = list || [];
    return appState.pendingAllowanceInvoices;
  } catch (err) {
    console.error('Failed to fetch pending allowance invoices:', err);
    throw err;
  }
}

/**
 * Fetch invoicing info for a sales order
 * @param {string} salesOrderId
 * @returns {Promise<any | null>}
 */
export async function fetchSalesOrderInvoicingInfo(salesOrderId) {
  try {
    return await invoke('get_sales_order_invoicing_info', {
      salesOrderId,
      sales_order_id: salesOrderId
    });
  } catch (err) {
    console.error('Failed to fetch sales order invoicing info:', err);
    return null;
  }
}

/**
 * Create customer invoice
 * @param {any} input
 * @returns {Promise<any>}
 */
export async function createCustomerInvoiceAction(input) {
  try {
    const detail = await invoke('create_customer_invoice', { input });
    showToast(`銷項發票「${detail.invoice.invoice_number}」已建立！`);
    await fetchCustomerInvoices();
    await fetchUninvoicedSalesOrders();
    return detail;
  } catch (err) {
    console.error('Failed to create customer invoice:', err);
    throw err;
  }
}

/**
 * Update customer invoice header
 * @param {any} input
 * @returns {Promise<any>}
 */
export async function updateCustomerInvoiceHeaderAction(input) {
  try {
    const detail = await invoke('update_customer_invoice_header', { input });
    showToast(`發票資料已更新`);
    if (appState.currentCustomerInvoiceDetail?.invoice?.id === detail.invoice.id) {
      appState.currentCustomerInvoiceDetail = detail;
    }
    await fetchCustomerInvoices();
    return detail;
  } catch (err) {
    console.error('Failed to update customer invoice header:', err);
    throw err;
  }
}

/**
 * Add sales order to customer invoice
 * @param {string} invoiceId
 * @param {string} salesOrderId
 * @returns {Promise<any>}
 */
export async function addCustomerInvoiceOrderAction(invoiceId, salesOrderId) {
  try {
    const detail = await invoke('add_customer_invoice_order', {
      invoiceId,
      invoice_id: invoiceId,
      salesOrderId,
      sales_order_id: salesOrderId
    });
    showToast(`已成功加入銷售單`);
    if (appState.currentCustomerInvoiceDetail?.invoice?.id === invoiceId) {
      appState.currentCustomerInvoiceDetail = detail;
    }
    await fetchCustomerInvoices();
    await fetchUninvoicedSalesOrders();
    return detail;
  } catch (err) {
    console.error('Failed to add sales order to invoice:', err);
    throw err;
  }
}

/**
 * Remove sales order from customer invoice
 * @param {string} invoiceId
 * @param {string} salesOrderId
 * @returns {Promise<any>}
 */
export async function removeCustomerInvoiceOrderAction(invoiceId, salesOrderId) {
  try {
    const detail = await invoke('remove_customer_invoice_order', {
      invoiceId,
      invoice_id: invoiceId,
      salesOrderId,
      sales_order_id: salesOrderId
    });
    showToast(`已移除銷售單`);
    if (appState.currentCustomerInvoiceDetail?.invoice?.id === invoiceId) {
      appState.currentCustomerInvoiceDetail = detail;
    }
    await fetchCustomerInvoices();
    await fetchUninvoicedSalesOrders();
    return detail;
  } catch (err) {
    console.error('Failed to remove sales order from invoice:', err);
    throw err;
  }
}

/**
 * Post customer invoice
 * @param {any} input
 * @returns {Promise<any>}
 */
export async function postCustomerInvoiceAction(input) {
  try {
    const detail = await invoke('post_customer_invoice', { input });
    showToast(`銷項發票「${detail.invoice.invoice_number}」已完成過帳！`);
    if (appState.currentCustomerInvoiceDetail?.invoice?.id === detail.invoice.id) {
      appState.currentCustomerInvoiceDetail = detail;
    }
    await fetchCustomerInvoices();
    await fetchUninvoicedSalesOrders();
    await fetchPendingAllowanceInvoices();
    return detail;
  } catch (err) {
    console.error('Failed to post customer invoice:', err);
    throw err;
  }
}

/**
 * Cancel draft customer invoice
 * @param {string} invoiceId
 * @returns {Promise<any>}
 */
export async function cancelCustomerInvoiceAction(invoiceId) {
  try {
    const detail = await invoke('cancel_customer_invoice', {
      invoiceId,
      invoice_id: invoiceId
    });
    showToast(`銷項發票「${detail.invoice.invoice_number}」已取消`);
    if (appState.currentCustomerInvoiceDetail?.invoice?.id === invoiceId) {
      appState.currentCustomerInvoiceDetail = detail;
    }
    await fetchCustomerInvoices();
    await fetchUninvoicedSalesOrders();
    return detail;
  } catch (err) {
    console.error('Failed to cancel customer invoice:', err);
    throw err;
  }
}

/**
 * Void posted customer invoice
 * @param {any} input
 * @returns {Promise<any>}
 */
export async function voidCustomerInvoiceAction(input) {
  try {
    const detail = await invoke('void_customer_invoice', { input });
    showToast(`銷項發票「${detail.invoice.invoice_number}」已作廢！`);
    if (appState.currentCustomerInvoiceDetail?.invoice?.id === detail.invoice.id) {
      appState.currentCustomerInvoiceDetail = detail;
    }
    await fetchCustomerInvoices();
    await fetchUninvoicedSalesOrders();
    await fetchPendingAllowanceInvoices();
    return detail;
  } catch (err) {
    console.error('Failed to void customer invoice:', err);
    throw err;
  }
}

