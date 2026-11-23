#!/usr/bin/env node
/**
 * @file verify-domain-manifests.mjs
 * @description CI-level static verification script for domain manifest.json files.
 * Validates schema conformance, icon whitelist, ID uniqueness, and entry file existence.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isKnownIcon, KNOWN_ICONS } from '../src/lib/icons.js';

/**
 * Expected 14 business domain directory identifiers.
 * @type {string[]}
 */
export const EXPECTED_DOMAINS = [
  'purchaseOrders',
  'quotes',
  'salesOrders',
  'vendorBills',
  'accountsPayable',
  'warehouses',
  'inventoryAdjustments',
  'stocktakes',
  'stockTransfers',
  'openingPayables',
  'vendorPayments',
  'departments',
  'partners',
  'products'
];

/**
 * Validates a single manifest object.
 * @param {unknown} manifest - Parsed manifest data
 * @param {Object} [options]
 * @param {string} [options.dirPath] - Absolute directory path containing the manifest
 * @param {string} [options.expectedId] - Expected domain directory name
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSingleManifest(manifest, options = {}) {
  const errors = [];
  const { dirPath, expectedId } = options;

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, errors: ['Manifest must be a non-null JSON object'] };
  }

  // 1. id validation
  if (!manifest.id || typeof manifest.id !== 'string' || manifest.id.trim() === '') {
    errors.push('Field "id" is required and must be a non-empty string');
  } else if (expectedId && manifest.id.trim() !== expectedId) {
    errors.push(`Field "id" ("${manifest.id}") must match directory name ("${expectedId}")`);
  }

  // 2. label validation
  if (!manifest.label || typeof manifest.label !== 'string' || manifest.label.trim() === '') {
    errors.push('Field "label" is required and must be a non-empty string');
  }

  // 3. icon validation
  if (!manifest.icon || typeof manifest.icon !== 'string' || manifest.icon.trim() === '') {
    errors.push('Field "icon" is required and must be a non-empty string');
  } else if (!isKnownIcon(manifest.icon)) {
    errors.push(`Field "icon" ("${manifest.icon}") is not registered in KNOWN_ICONS. Allowed icons: ${KNOWN_ICONS.join(', ')}`);
  }

  // 4. route validation
  if (!manifest.route || typeof manifest.route !== 'string' || manifest.route.trim() === '') {
    errors.push('Field "route" is required and must be a non-empty string');
  } else if (!manifest.route.trim().startsWith('/')) {
    errors.push(`Field "route" ("${manifest.route}") must be a canonical path starting with "/"`);
  }

  // 5. aliases validation
  if (!Array.isArray(manifest.aliases)) {
    errors.push('Field "aliases" is required and must be an array of strings');
  } else {
    for (let i = 0; i < manifest.aliases.length; i++) {
      if (typeof manifest.aliases[i] !== 'string') {
        errors.push(`Field "aliases[${i}]" must be a string, got ${typeof manifest.aliases[i]}`);
      }
    }
  }

  // 6. entry validation
  if (!manifest.entry || typeof manifest.entry !== 'string' || manifest.entry.trim() === '') {
    errors.push('Field "entry" is required and must be a non-empty string');
  } else if (dirPath) {
    const resolvedEntryPath = path.resolve(dirPath, manifest.entry.trim());
    if (!fs.existsSync(resolvedEntryPath)) {
      errors.push(`Entry file not found at: ${resolvedEntryPath} (resolved from "${manifest.entry}")`);
    }
  }

  // 7. topLevelNav validation
  if (typeof manifest.topLevelNav !== 'boolean') {
    errors.push(`Field "topLevelNav" is required and must be a boolean (true or false), got ${typeof manifest.topLevelNav}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validates domain manifests across all expected domain directories.
 * @param {Object} [options]
 * @param {string} [options.baseDir] - Base directory containing domain folders (defaults to src/lib)
 * @param {string[]} [options.domains] - List of domain directories to check
 * @returns {{ success: boolean, count: number, results: Record<string, { valid: boolean, errors: string[] }>, errors: string[] }}
 */
export function verifyDomainManifests(options = {}) {
  const currentFile = fileURLToPath(import.meta.url);
  const defaultBaseDir = path.resolve(path.dirname(currentFile), '../src/lib');
  const baseDir = options.baseDir || defaultBaseDir;
  const domains = options.domains || EXPECTED_DOMAINS;

  const results = {};
  const allErrors = [];
  const seenIds = new Map();

  for (const domain of domains) {
    const domainDir = path.resolve(baseDir, domain);
    const manifestPath = path.join(domainDir, 'manifest.json');

    if (!fs.existsSync(domainDir)) {
      const err = `Domain directory not found: ${domainDir}`;
      results[domain] = { valid: false, errors: [err] };
      allErrors.push(`[${domain}] ${err}`);
      continue;
    }

    if (!fs.existsSync(manifestPath)) {
      const err = `Missing manifest.json at: ${manifestPath}`;
      results[domain] = { valid: false, errors: [err] };
      allErrors.push(`[${domain}] ${err}`);
      continue;
    }

    let manifestContent;
    let manifestData;
    try {
      manifestContent = fs.readFileSync(manifestPath, 'utf-8');
      manifestData = JSON.parse(manifestContent);
    } catch (parseErr) {
      const err = `Failed to parse manifest.json: ${parseErr.message}`;
      results[domain] = { valid: false, errors: [err] };
      allErrors.push(`[${domain}] ${err}`);
      continue;
    }

    const validation = validateSingleManifest(manifestData, {
      dirPath: domainDir,
      expectedId: domain
    });

    // Check duplicate ID
    if (manifestData && typeof manifestData.id === 'string') {
      const id = manifestData.id.trim();
      if (seenIds.has(id)) {
        validation.valid = false;
        const dupErr = `Duplicate module id "${id}" found in both "${seenIds.get(id)}" and "${domain}"`;
        validation.errors.push(dupErr);
      } else {
        seenIds.set(id, domain);
      }
    }

    results[domain] = validation;
    if (!validation.valid) {
      for (const e of validation.errors) {
        allErrors.push(`[${domain}] ${e}`);
      }
    }
  }

  return {
    success: allErrors.length === 0,
    count: domains.length,
    results,
    errors: allErrors
  };
}

// Execute as CLI if invoked directly
const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  console.log('🔍 [CI] Verifying domain manifest.json files...');
  const outcome = verifyDomainManifests();

  if (outcome.success) {
    console.log(`✅ All ${outcome.count} domain manifests passed schema and integrity verification:`);
    for (const domain of EXPECTED_DOMAINS) {
      console.log(`   - ${domain}/manifest.json (valid)`);
    }
    process.exit(0);
  } else {
    console.error(`❌ Manifest verification failed with ${outcome.errors.length} error(s):`);
    for (const err of outcome.errors) {
      console.error(`   ✖ ${err}`);
    }
    process.exit(1);
  }
}

