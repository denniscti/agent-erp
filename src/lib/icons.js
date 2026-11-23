/**
 * @file icons.js
 * @description Fixed registry of stable icon definitions extracted from App.svelte.
 * Provides a canonical whitelist of valid icon names for domain manifests.
 * Prevents arbitrary, unvetted SVG injection across modules.
 */

/**
 * @typedef {Object} IconDefinition
 * @property {string} name - Stable unique icon identifier
 * @property {string} label - Descriptive name of the icon
 * @property {string} innerHtml - SVG interior elements
 * @property {string} viewBox - SVG viewBox attribute (defaults to '0 0 24 24')
 */

/**
 * Canonical registry of allowed module navigation icons.
 * @type {Record<string, IconDefinition>}
 */
export const ICON_REGISTRY = {
  'shopping-bag': {
    name: 'shopping-bag',
    label: '採購袋 / 採購單',
    viewBox: '0 0 24 24',
    innerHtml: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path>'
  },
  'file-text': {
    name: 'file-text',
    label: '文件明細 / 請款單',
    viewBox: '0 0 24 24',
    innerHtml: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline>'
  },
  'warehouse': {
    name: 'warehouse',
    label: '倉儲建築 / 倉庫管理',
    viewBox: '0 0 24 24',
    innerHtml: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline>'
  },
  'credit-card': {
    name: 'credit-card',
    label: '卡片付款 / 應付與付款',
    viewBox: '0 0 24 24',
    innerHtml: '<rect width="20" height="14" x="2" y="5" rx="2"></rect><line x1="2" x2="22" y1="10" y2="10"></line>'
  },
  'clipboard-list': {
    name: 'clipboard-list',
    label: '報價清單 / 報價與盤點',
    viewBox: '0 0 24 24',
    innerHtml: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect><path d="M9 14h6"></path><path d="M9 18h6"></path><path d="M9 10h6"></path>'
  },
  'truck': {
    name: 'truck',
    label: '貨車運輸 / 銷售與調撥',
    viewBox: '0 0 24 24',
    innerHtml: '<rect x="1" y="3" width="15" height="13" rx="1"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle>'
  },
  'settings': {
    name: 'settings',
    label: '齒輪設定 / 基礎資料與系統設定',
    viewBox: '0 0 24 24',
    innerHtml: '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>'
  },
  'agent': {
    name: 'agent',
    label: '對話氣泡 / AI 助理',
    viewBox: '0 0 24 24',
    innerHtml: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>'
  },
  'file-check': {
    name: 'file-check',
    label: '核對勾選文件 / 銷項發票',
    viewBox: '0 0 24 24',
    innerHtml: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><line x1="10" y1="9" x2="8" y2="9"></line>'
  },
  'clock': {
    name: 'clock',
    label: '時鐘時序 / 應收帳款與帳齡',
    viewBox: '0 0 24 24',
    innerHtml: '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>'
  },
  'shield-check': {
    name: 'shield-check',
    label: '防護盾牌 / 客戶信用',
    viewBox: '0 0 24 24',
    innerHtml: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><path d="m9 12 2 2 4-4"></path>'
  },
  'receipt-card': {
    name: 'receipt-card',
    label: '收款卡片 / 客戶收款單',
    viewBox: '0 0 24 24',
    innerHtml: '<rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line>'
  }
};

/**
 * Array of all valid registered icon identifiers.
 * @type {string[]}
 */
export const KNOWN_ICONS = Object.keys(ICON_REGISTRY);

/**
 * Validates whether a given icon name is recognized in the registry.
 * @param {string | null | undefined} iconName
 * @returns {boolean}
 */
export function isKnownIcon(iconName) {
  if (!iconName || typeof iconName !== 'string') return false;
  return Object.prototype.hasOwnProperty.call(ICON_REGISTRY, iconName.trim());
}

/**
 * Retrieves icon definition by name.
 * @param {string | null | undefined} iconName
 * @returns {IconDefinition | undefined}
 */
export function getIcon(iconName) {
  if (!iconName || typeof iconName !== 'string') return undefined;
  return ICON_REGISTRY[iconName.trim()];
}

/**
 * Generates full SVG string for a given icon name.
 * @param {string} iconName
 * @param {Object} [options]
 * @param {number} [options.width=20]
 * @param {number} [options.height=20]
 * @param {number} [options.strokeWidth=2]
 * @param {string} [options.className='']
 * @returns {string}
 */
export function getIconSvg(iconName, options = {}) {
  const icon = getIcon(iconName);
  if (!icon) return '';
  const { width = 20, height = 20, strokeWidth = 2, className = '' } = options;
  const classAttr = className ? ` class="${className}"` : '';
  return `<svg width="${width}" height="${height}" viewBox="${icon.viewBox}" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${classAttr}>${icon.innerHtml}</svg>`;
}

