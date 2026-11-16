// @ts-check
import { invoke } from '../tauri.js';
import { appState, navigate } from '../store.svelte.js';

/**
 * Fetch quotes list with optional filters
 * @param {Object} [filter]
 * @returns {Promise<any[]>}
 */
export async function fetchQuotes(filter = {}) {
  try {
    const payload = {};
    if (filter.filter_status || filter.filterStatus || filter.status) {
      const s = filter.filter_status || filter.filterStatus || filter.status;
      payload.filter_status = s;
      payload.filterStatus = s;
    }
    if (filter.filter_customer_id || filter.filterCustomerId || filter.customer_partner_id || filter.customerPartnerId) {
      const c = filter.filter_customer_id || filter.filterCustomerId || filter.customer_partner_id || filter.customerPartnerId;
      payload.filter_customer_id = c;
      payload.filterCustomerId = c;
    }
    const today = filter.today_override || filter.todayOverride;
    if (today) {
      payload.today_override = today;
      payload.todayOverride = today;
    }
    const list = await invoke('list_quotes', payload);
    appState.quotes = list || [];
    return appState.quotes;
  } catch (err) {
    console.error("Failed to fetch quotes:", err);
    throw err;
  }
}

/**
 * Fetch quote detail with line items
 * @param {string} quoteId
 * @param {string} [todayOverride]
 * @returns {Promise<any>}
 */
export async function fetchQuoteDetail(quoteId, todayOverride = undefined) {
  try {
    const payload = {
      quote_id: quoteId,
      quoteId: quoteId,
      id: quoteId
    };
    if (todayOverride) {
      payload.today_override = todayOverride;
      payload.todayOverride = todayOverride;
    }
    const detail = await invoke('get_quote', payload);
    appState.currentQuoteDetail = detail;
    appState.selectedQuoteId = quoteId;
    return detail;
  } catch (err) {
    console.error("Failed to fetch quote detail:", err);
    throw err;
  }
}

/**
 * Fetch quote detail without mutating shared quote workspace state
 * @param {string} quoteId
 * @param {string} [todayOverride]
 * @returns {Promise<any>}
 */
export async function getQuoteDetailReadOnly(quoteId, todayOverride = undefined) {
  try {
    const payload = {
      quote_id: quoteId,
      quoteId: quoteId,
      id: quoteId
    };
    if (todayOverride) {
      payload.today_override = todayOverride;
      payload.todayOverride = todayOverride;
    }
    return await invoke('get_quote', payload);
  } catch (err) {
    console.error("Failed to read quote detail:", err);
    throw err;
  }
}

/**
 * Fetch quotes pending approval with below-standard items
 * @returns {Promise<any[]>}
 */
export async function fetchPendingApprovalQuotes() {
  try {
    const list = await invoke('list_pending_approval_quotes', {});
    appState.pendingApprovalQuotes = list || [];
    return appState.pendingApprovalQuotes;
  } catch (err) {
    console.error("Failed to fetch pending approval quotes:", err);
    throw err;
  }
}

/**
 * Create a new draft quote
 * @param {Object} input
 * @returns {Promise<any>}
 */
export async function createQuoteAction(input) {
  try {
    const payload = input?.input ? input : { input };
    const res = await invoke('create_quote', payload);
    await fetchQuotes();
    return res;
  } catch (err) {
    console.error("Failed to create quote:", err);
    throw err;
  }
}

/**
 * Update quote header (draft only)
 * @param {Object} input
 * @returns {Promise<any>}
 */
export async function updateQuoteHeaderAction(input) {
  try {
    const payload = input?.input ? input : { input };
    const res = await invoke('update_quote_header', payload);
    appState.currentQuoteDetail = res;
    await fetchQuotes();
    return res;
  } catch (err) {
    console.error("Failed to update quote header:", err);
    throw err;
  }
}

/**
 * Add line item to quote (draft only)
 * @param {Object} input
 * @returns {Promise<any>}
 */
export async function addQuoteLineAction(input) {
  try {
    const raw = input?.input ? input.input : input;
    const note = raw.note !== undefined ? raw.note : (raw.notes !== undefined ? raw.notes : null);
    const inner = { ...raw, note };
    delete inner.notes;
    const payload = { input: inner };
    const res = await invoke('add_quote_line', payload);
    appState.currentQuoteDetail = res;
    return res;
  } catch (err) {
    console.error("Failed to add quote line:", err);
    throw err;
  }
}

/**
 * Update line item in quote (draft only)
 * @param {Object} input
 * @returns {Promise<any>}
 */
export async function updateQuoteLineAction(input) {
  try {
    const raw = input?.input ? input.input : input;
    const note = raw.note !== undefined ? raw.note : (raw.notes !== undefined ? raw.notes : null);
    const inner = { ...raw, note };
    delete inner.notes;
    const payload = { input: inner };
    const res = await invoke('update_quote_line', payload);
    appState.currentQuoteDetail = res;
    return res;
  } catch (err) {
    console.error("Failed to update quote line:", err);
    throw err;
  }
}

/**
 * Delete line item from quote (draft only)
 * @param {Object} input
 * @returns {Promise<any>}
 */
export async function deleteQuoteLineAction(input) {
  try {
    const qId = input.quote_id || input.quoteId;
    const lId = input.line_id || input.lineId;
    const payload = {
      quote_id: qId,
      quoteId: qId,
      line_id: lId,
      lineId: lId
    };
    const res = await invoke('delete_quote_line', payload);
    appState.currentQuoteDetail = res;
    return res;
  } catch (err) {
    console.error("Failed to delete quote line:", err);
    throw err;
  }
}

/**
 * Submit quote for approval or send
 * @param {Object} input
 * @returns {Promise<any>}
 */
export async function submitQuoteAction(input) {
  try {
    const qId = input.quote_id || input.quoteId;
    const today = input.today_override || input.todayOverride;
    const payload = {
      quote_id: qId,
      quoteId: qId,
      today_override: today,
      todayOverride: today
    };
    const res = await invoke('submit_quote', payload);
    // Re-fetch complete QuoteDetail with lines and total_amount to prevent TypeError in UI
    const detail = await fetchQuoteDetail(qId, today);
    await fetchQuotes(today ? { today_override: today } : {});
    return {
      ...detail,
      message: res?.message
    };
  } catch (err) {
    console.error("Failed to submit quote:", err);
    throw err;
  }
}

/**
 * Withdraw quote from pending approval back to draft
 * @param {Object} input
 * @returns {Promise<any>}
 */
export async function withdrawQuoteApprovalAction(input) {
  try {
    const qId = input.quote_id || input.quoteId;
    const today = input.today_override || input.todayOverride;
    const payload = {
      quote_id: qId,
      quoteId: qId,
      reason: input.reason,
      today_override: today,
      todayOverride: today
    };
    const res = await invoke('withdraw_quote_approval', payload);
    appState.currentQuoteDetail = res;
    await fetchQuotes();
    return res;
  } catch (err) {
    console.error("Failed to withdraw quote approval:", err);
    throw err;
  }
}

/**
 * Approve pending quote
 * @param {Object} input
 * @returns {Promise<any>}
 */
export async function approveQuoteAction(input) {
  try {
    const qId = input.quote_id || input.quoteId;
    const today = input.today_override || input.todayOverride;
    const payload = {
      quote_id: qId,
      quoteId: qId,
      reason: input.reason,
      today_override: today,
      todayOverride: today
    };
    const res = await invoke('approve_quote', payload);
    appState.currentQuoteDetail = res;
    await fetchQuotes(today ? { today_override: today } : {});
    return res;
  } catch (err) {
    console.error("Failed to approve quote:", err);
    throw err;
  }
}

/**
 * Reject pending quote
 * @param {Object} input
 * @returns {Promise<any>}
 */
export async function rejectQuoteAction(input) {
  try {
    const qId = input.quote_id || input.quoteId;
    const today = input.today_override || input.todayOverride;
    const payload = {
      quote_id: qId,
      quoteId: qId,
      reason: input.reason,
      today_override: today,
      todayOverride: today
    };
    const res = await invoke('reject_quote', payload);
    appState.currentQuoteDetail = res;
    await fetchQuotes(today ? { today_override: today } : {});
    return res;
  } catch (err) {
    console.error("Failed to reject quote:", err);
    throw err;
  }
}

/**
 * Mark sent quote as declined by customer
 * @param {Object} input
 * @returns {Promise<any>}
 */
export async function declineQuoteAction(input) {
  try {
    const qId = input.quote_id || input.quoteId;
    const today = input.today_override || input.todayOverride;
    const payload = {
      quote_id: qId,
      quoteId: qId,
      reason: input.reason,
      today_override: today,
      todayOverride: today
    };
    const res = await invoke('decline_quote', payload);
    appState.currentQuoteDetail = res;
    await fetchQuotes(today ? { today_override: today } : {});
    return res;
  } catch (err) {
    console.error("Failed to decline quote:", err);
    throw err;
  }
}

/**
 * Cancel quote
 * @param {Object} input
 * @returns {Promise<any>}
 */
export async function cancelQuoteAction(input) {
  try {
    const qId = input.quote_id || input.quoteId;
    const today = input.today_override || input.todayOverride;
    const payload = {
      quote_id: qId,
      quoteId: qId,
      reason: input.reason,
      today_override: today,
      todayOverride: today
    };
    const res = await invoke('cancel_quote', payload);
    appState.currentQuoteDetail = res;
    await fetchQuotes(today ? { today_override: today } : {});
    return res;
  } catch (err) {
    console.error("Failed to cancel quote:", err);
    throw err;
  }
}

/**
 * Mark sent quote as accepted by customer and convert to confirmed sales order (Issue #234)
 * @param {Object} input
 * @returns {Promise<any>}
 */
export async function convertQuoteAction(input) {
  try {
    const raw = input?.input ? input.input : (input || {});
    const qId = raw.quote_id || raw.quoteId;
    const whId = raw.warehouse_id !== undefined ? raw.warehouse_id : raw.warehouseId;
    const poNum = raw.customer_po_number !== undefined
      ? raw.customer_po_number
      : (raw.customerPoNumber !== undefined ? raw.customerPoNumber : raw.customer_reference);
    const expShip = raw.expected_ship_date !== undefined ? raw.expected_ship_date : raw.expectedShipDate;
    const today = input?.today_override ?? input?.todayOverride ?? raw.today_override ?? raw.todayOverride;
    const inner = {
      quote_id: qId,
      warehouse_id: whId !== undefined && whId !== null && String(whId).trim() !== '' ? String(whId).trim() : null,
      customer_po_number: poNum !== undefined && poNum !== null ? String(poNum) : null,
      expected_ship_date: expShip !== undefined && expShip !== null && String(expShip).trim() !== '' ? String(expShip).trim() : null,
      note: raw.note !== undefined && raw.note !== null ? String(raw.note) : null
    };
    const payload = { input: inner };
    if (today) {
      payload.today_override = today;
      payload.todayOverride = today;
    }
    const res = await invoke('convert_quote', payload);
    appState.currentQuoteDetail = {
      quote: res.quote,
      lines: res.lines,
      total_amount: res.total_amount
    };
    await fetchQuotes(today ? { today_override: today } : {});
    return res;
  } catch (err) {
    console.error("Failed to convert quote:", err);
    throw err;
  }
}

/**
 * Navigate to Quotes workspace and open a specific quote detail
 * @param {string} quoteId
 */
export function selectQuote(quoteId) {
  if (!quoteId) return;
  appState.pendingQuoteDetailId = quoteId;
  navigate('/app/quotes');
}

