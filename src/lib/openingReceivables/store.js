// @ts-check
import { invoke } from '../tauri.js';
import { appState, showToast } from '../store.svelte.js';

/**
 * Load opening receivables list
 * @param {any} [filter]
 * @returns {Promise<any[]>}
 */
export async function loadOpeningReceivablesAction(filter) {
  try {
    const list = await invoke('list_opening_receivables', { filter: filter || null });
    appState.openingReceivables = list || [];
    return appState.openingReceivables;
  } catch (err) {
    console.error('Failed to load opening receivables:', err);
    throw err;
  }
}

/**
 * Create an opening receivable
 * @param {any} input
 * @returns {Promise<any>}
 */
export async function createOpeningReceivableAction(input) {
  try {
    const detail = await invoke('create_opening_receivable', { input });
    showToast(`期初應收單「${detail.opening_receivable.opening_number}」已成功建立！`);
    await loadOpeningReceivablesAction();
    return detail;
  } catch (err) {
    console.error('Failed to create opening receivable:', err);
    throw err;
  }
}

/**
 * Void an opening receivable
 * @param {string} id
 * @param {string} void_reason
 * @returns {Promise<any>}
 */
export async function voidOpeningReceivableAction(id, void_reason) {
  try {
    const detail = await invoke('void_opening_receivable', {
      id,
      voidReason: void_reason,
      void_reason: void_reason
    });
    showToast(`期初應收單「${detail.opening_receivable.opening_number}」已作廢！`);
    await loadOpeningReceivablesAction();
    return detail;
  } catch (err) {
    console.error('Failed to void opening receivable:', err);
    throw err;
  }
}

