// @ts-check
import { invoke } from '../tauri.js';
import { appState } from '../store.svelte.js';

/**
 * Query accounts receivable list with filter without mutating appState.accountsReceivable
 * @param {any} [filter]
 * @returns {Promise<any[]>}
 */
export async function queryAccountsReceivableAction(filter = {}) {
  try {
    const args = { ...(filter || {}) };
    if (args.customer_partner_id && !args.customerPartnerId) {
      args.customerPartnerId = args.customer_partner_id;
    }
    if (args.customerPartnerId && !args.customer_partner_id) {
      args.customer_partner_id = args.customerPartnerId;
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
    const list = await invoke('list_accounts_receivable', args);
    return list || [];
  } catch (err) {
    console.error("Failed to query accounts receivable:", err);
    throw err;
  }
}

/**
 * Load accounts receivable list with filter into appState.accountsReceivable
 * @param {any} [filter]
 * @returns {Promise<any[]>}
 */
export async function loadAccountsReceivableAction(filter = {}) {
  try {
    const list = await queryAccountsReceivableAction(filter);
    appState.accountsReceivable = list || [];
    return appState.accountsReceivable;
  } catch (err) {
    console.error("Failed to load accounts receivable:", err);
    throw err;
  }
}

/**
 * Get account receivable detail by ID
 * @param {string} id
 * @returns {Promise<any>}
 */
export async function getAccountReceivableAction(id) {
  try {
    const detail = await invoke('get_account_receivable', {
      id,
      ar_id: id,
      arId: id
    });
    appState.currentAccountReceivableDetail = detail;
    return detail;
  } catch (err) {
    console.error("Failed to get account receivable detail:", err);
    throw err;
  }
}

/**
 * Load accounts receivable aging report
 * @param {string} [asOfDate]
 * @returns {Promise<any>}
 */
export async function loadReceivablesAgingAction(asOfDate) {
  try {
    const report = await invoke('get_receivables_aging', {
      as_of_date: asOfDate,
      asOfDate: asOfDate
    });
    appState.receivablesAgingReport = report;
    return report;
  } catch (err) {
    console.error("Failed to load receivables aging report:", err);
    throw err;
  }
}

