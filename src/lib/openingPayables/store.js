// @ts-check
import { invoke } from '../tauri.js';
import { appState, showToast } from '../store.svelte.js';

/**
 * Load opening payables list
 * @param {any} [filter]
 * @returns {Promise<any[]>}
 */
export async function loadOpeningPayablesAction(filter) {
  try {
    const list = await invoke('list_opening_payables', { filter: filter || null });
    appState.openingPayables = list || [];
    return appState.openingPayables;
  } catch (err) {
    console.error("Failed to load opening payables:", err);
    throw err;
  }
}

/**
 * Create an opening payable
 * @param {any} input
 * @returns {Promise<any>}
 */
export async function createOpeningPayableAction(input) {
  try {
    const detail = await invoke('create_opening_payable', { input });
    showToast(`期初應付單「${detail.opening_payable.opening_number}」已成功建立！`);
    await loadOpeningPayablesAction();
    return detail;
  } catch (err) {
    console.error("Failed to create opening payable:", err);
    throw err;
  }
}

/**
 * Void an opening payable
 * @param {string} id
 * @param {string} void_reason
 * @returns {Promise<any>}
 */
export async function voidOpeningPayableAction(id, void_reason) {
  try {
    const detail = await invoke('void_opening_payable', { id, void_reason });
    showToast(`期初應付單「${detail.opening_payable.opening_number}」已作廢！`);
    await loadOpeningPayablesAction();
    return detail;
  } catch (err) {
    console.error("Failed to void opening payable:", err);
    throw err;
  }
}

