// @ts-check
import { invoke } from '../tauri.js';
import { appState, showToast } from '../store.svelte.js';

/**
 * Fetch warehouses list
 * @param {boolean} [includeInactive]
 * @returns {Promise<any[]>}
 */
export async function fetchWarehouses(includeInactive = true) {
  try {
    const payload = {};
    if (includeInactive !== null && includeInactive !== undefined) {
      payload.include_inactive = Boolean(includeInactive);
      payload.includeInactive = Boolean(includeInactive);
    }
    const list = await invoke('list_warehouses', payload);
    appState.warehouses = list || [];
    return appState.warehouses;
  } catch (err) {
    console.error("Failed to fetch warehouses:", err);
    return [];
  }
}

/**
 * Create a warehouse
 * @param {string | object} codeOrObj
 * @param {string} [maybeName]
 * @returns {Promise<any>}
 */
export async function createWarehouseAction(codeOrObj, maybeName) {
  let rawCode = codeOrObj;
  let rawName = maybeName;
  if (codeOrObj && typeof codeOrObj === 'object') {
    rawCode = codeOrObj.code;
    rawName = codeOrObj.name;
  }
  const trimmedCode = (rawCode || '').trim();
  const trimmedName = (rawName || '').trim();
  if (!trimmedCode) throw new Error('倉庫代碼為必填項目');
  if (!trimmedName) throw new Error('倉庫名稱為必填項目');
  try {
    const wh = await invoke('create_warehouse', {
      code: trimmedCode,
      name: trimmedName
    });
    await fetchWarehouses();
    showToast(`倉庫「${wh.name} (${wh.code})」建立成功！`);
    if (typeof appState.createWarehouseSuccessCallback === 'function') {
      /** @type {any} */
      const cb = appState.createWarehouseSuccessCallback;
      appState.createWarehouseSuccessCallback = null;
      try {
        await cb(wh);
      } catch (cbErr) {
        console.error("Callback error after warehouse creation:", cbErr);
      }
    }
    return wh;
  } catch (err) {
    console.error("Failed to create warehouse:", err);
    throw err;
  }
}

/**
 * Update warehouse
 * @param {string} id
 * @param {string} code
 * @param {string} name
 * @returns {Promise<any>}
 */
export async function updateWarehouseAction(id, code, name) {
  const trimmedCode = (code || '').trim();
  const trimmedName = (name || '').trim();
  if (!trimmedCode) throw new Error('倉庫代碼為必填項目');
  if (!trimmedName) throw new Error('倉庫名稱為必填項目');
  try {
    const wh = await invoke('update_warehouse', {
      id,
      code: trimmedCode,
      name: trimmedName
    });
    await fetchWarehouses();
    showToast(`倉庫「${wh.name}」已更新！`);
    return wh;
  } catch (err) {
    console.error("Failed to update warehouse:", err);
    throw err;
  }
}

/**
 * Set default warehouse
 * @param {string} id
 * @returns {Promise<any>}
 */
export async function setDefaultWarehouseAction(id) {
  try {
    const wh = await invoke('set_default_warehouse', { id });
    await fetchWarehouses();
    showToast(`已將「${wh.name}」設為預設倉！`);
    return wh;
  } catch (err) {
    console.error("Failed to set default warehouse:", err);
    throw err;
  }
}

/**
 * Deactivate warehouse
 * @param {string} id
 * @returns {Promise<any>}
 */
export async function deactivateWarehouseAction(id) {
  try {
    const wh = await invoke('deactivate_warehouse', { id });
    await fetchWarehouses();
    showToast(`已停用倉庫「${wh.name}」！`);
    return wh;
  } catch (err) {
    console.error("Failed to deactivate warehouse:", err);
    throw err;
  }
}

/**
 * Reactivate warehouse
 * @param {string} id
 * @returns {Promise<any>}
 */
export async function reactivateWarehouseAction(id) {
  try {
    const wh = await invoke('reactivate_warehouse', { id });
    await fetchWarehouses();
    showToast(`已重新啟用倉庫「${wh.name}」！`);
    return wh;
  } catch (err) {
    console.error("Failed to reactivate warehouse:", err);
    throw err;
  }
}

