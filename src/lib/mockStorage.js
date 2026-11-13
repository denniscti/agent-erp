// @ts-check

/**
 * Shared storage helper for mock data persistence and session resolution.
 */

const memoryStorage = new Map();

export function loadStorage(key, defaultVal) {
  if (typeof window !== 'undefined' && window.localStorage) {
    const saved = window.localStorage.getItem(key);
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
  }
  if (memoryStorage.has(key)) {
    return memoryStorage.get(key);
  }
  return defaultVal;
}

export function saveStorage(key, val) {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      if (val === null || val === undefined) {
        window.localStorage.removeItem(key);
      } else {
        window.localStorage.setItem(key, JSON.stringify(val));
      }
    } catch (e) {}
  }
  if (val === null || val === undefined) {
    memoryStorage.delete(key);
  } else {
    memoryStorage.set(key, val);
  }
}

let mockUidCounter = 0;
export function nextMockUid(prefix) {
  mockUidCounter++;
  const ms = Date.now();
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}_${ms}_${mockUidCounter}_${rand}`;
}

export function resolveMockActiveTenantId() {
  const session = loadStorage('agent_erp_mock_session', null);
  if (session && session.active_tenant_id !== undefined && session.active_tenant_id !== null) {
    return typeof session.active_tenant_id === 'string' ? session.active_tenant_id : String(session.active_tenant_id);
  }
  return 'tnt_mock_1';
}

export function resolveMockActiveUserId() {
  const session = loadStorage('agent_erp_mock_session', null);
  if (session && session.user_id !== undefined && session.user_id !== null) {
    return typeof session.user_id === 'string' ? session.user_id : String(session.user_id);
  }
  return 'usr_mock_admin';
}
