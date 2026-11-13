// @ts-check

// Generic request-staleness and in-flight detail sequence management
export const navigationStalenessListeners = new Set();

/**
 * Register a callback to be executed whenever route navigation occurs,
 * allowing detail flows (e.g. stocktakes, purchase orders, inventory adjustments)
 * to invalidate in-flight asynchronous requests and prevent race conditions.
 * @param {() => void} listener
 * @returns {() => void} Unsubscribe function
 */
export function registerNavigationStalenessListener(listener) {
  navigationStalenessListeners.add(listener);
  return () => {
    navigationStalenessListeners.delete(listener);
  };
}

/**
 * Invalidate in-flight detail requests across all registered domain flows
 */
export function invalidateNavigationStaleness() {
  for (const listener of navigationStalenessListeners) {
    try {
      listener();
    } catch (e) {
      console.warn("Error in navigation staleness listener:", e);
    }
  }
}

