// @ts-check
import { invoke } from '../tauri.js';
import { appState } from '../store.svelte.js';

/**
 * Query accounts payable list with filter without mutating appState.accountsPayable
 * Suitable for candidate lookup, vendor filtering, or background checks
 * @param {any} [filter]
 * @returns {Promise<any[]>}
 */
export async function queryAccountsPayableAction(filter = {}) {
  try {
    const args = { ...(filter || {}) };
    if (args.vendor_partner_id && !args.vendorPartnerId) {
      args.vendorPartnerId = args.vendor_partner_id;
    }
    if (args.vendorPartnerId && !args.vendor_partner_id) {
      args.vendor_partner_id = args.vendorPartnerId;
    }
    if (args.settlement_status && !args.settlementStatus) {
      args.settlementStatus = args.settlement_status;
    }
    if (args.settlementStatus && !args.settlement_status) {
      args.settlement_status = args.settlementStatus;
    }
    if (args.due_date_from && !args.dueDateFrom) {
      args.dueDateFrom = args.due_date_from;
    }
    if (args.dueDateFrom && !args.due_date_from) {
      args.due_date_from = args.dueDateFrom;
    }
    if (args.due_date_to && !args.dueDateTo) {
      args.dueDateTo = args.due_date_to;
    }
    if (args.dueDateTo && !args.due_date_to) {
      args.due_date_to = args.dueDateTo;
    }
    const list = await invoke('list_accounts_payable', args);
    return list || [];
  } catch (err) {
    console.error("Failed to query accounts payable:", err);
    throw err;
  }
}

/**
 * Load accounts payable list with filter into appState.accountsPayable
 * @param {any} [filter]
 * @returns {Promise<any[]>}
 */
export async function loadAccountsPayableAction(filter = {}) {
  try {
    const list = await queryAccountsPayableAction(filter);
    appState.accountsPayable = list || [];
    return appState.accountsPayable;
  } catch (err) {
    console.error("Failed to load accounts payable:", err);
    throw err;
  }
}

/**
 * Get account payable detail by ID
 * @param {string} id
 * @returns {Promise<any>}
 */
export async function getAccountPayableAction(id) {
  try {
    const detail = await invoke('get_account_payable', {
      id,
      ap_id: id,
      apId: id
    });
    appState.currentAccountPayableDetail = detail;
    return detail;
  } catch (err) {
    console.error("Failed to get account payable detail:", err);
    throw err;
  }
}

/**
 * Load accounts payable aging report
 * @param {string} [asOfDate]
 * @returns {Promise<any>}
 */
export async function loadPayablesAgingAction(asOfDate) {
  try {
    const report = await invoke('get_payables_aging', {
      as_of_date: asOfDate,
      asOfDate: asOfDate
    });
    appState.payablesAgingReport = report;
    return report;
  } catch (err) {
    console.error("Failed to load payables aging report:", err);
    throw err;
  }
}

/**
 * Load vendor statement report
 * @param {string} vendorPartnerId
 * @param {string} startDate
 * @param {string} endDate
 * @returns {Promise<any>}
 */
export async function loadVendorStatementAction(vendorPartnerId, startDate, endDate) {
  try {
    const statement = await invoke('get_vendor_statement', {
      vendor_partner_id: vendorPartnerId,
      vendorPartnerId: vendorPartnerId,
      start_date: startDate,
      startDate: startDate,
      end_date: endDate,
      endDate: endDate
    });
    return statement;
  } catch (err) {
    console.error("Failed to load vendor statement:", err);
    throw err;
  }
}

