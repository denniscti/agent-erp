/**
 * @file domains.js
 * @description Single source of truth for known skill domains.
 * Conforms to docs/standards/authoring/agent-skill-authoring.md section 3.
 */

/**
 * @typedef {Object} DomainDefinition
 * @property {string} id - Unique domain identifier
 * @property {string} name - Human readable domain name
 * @property {string} description - Detailed description of the domain scope
 */

/**
 * The single source of truth array for all recognized skill domains.
 * @type {DomainDefinition[]}
 */
export const KNOWN_DOMAINS = [
  { id: 'department', name: '部門與組織結構', description: '設定部門與組織架構管理' },
  { id: 'customer', name: '客戶管理', description: '客戶資料與交易記錄管理' },
  { id: 'vendor', name: '供應商管理', description: '供應商資料與採購管理' }
];

/**
 * Validates whether a given domain string exists in KNOWN_DOMAINS.
 * @param {string | null | undefined} domain
 * @returns {boolean}
 */
export function isKnownDomain(domain) {
  if (!domain || typeof domain !== 'string') return false;
  const trimmed = domain.trim();
  return KNOWN_DOMAINS.some(d => d.id === trimmed);
}

/**
 * Retrieves domain definition by domain ID.
 * @param {string | null | undefined} domainId
 * @returns {DomainDefinition | undefined}
 */
export function getDomain(domainId) {
  if (!domainId || typeof domainId !== 'string') return undefined;
  const trimmed = domainId.trim();
  return KNOWN_DOMAINS.find(d => d.id === trimmed);
}
