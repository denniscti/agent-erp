// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isKnownIcon,
  getIcon,
  getIconSvg,
  KNOWN_ICONS,
  ICON_REGISTRY
} from '../src/lib/icons.js';

import {
  EXPECTED_DOMAINS,
  validateSingleManifest,
  verifyDomainManifests
} from '../scripts/verify-domain-manifests.mjs';

/**
 * -------------------------------------------------------------------------------------------------
 * Test Strategy Perspective Table (Issue #263: Domain Manifest Schema & Verification)
 * -------------------------------------------------------------------------------------------------
 * | Case ID     | Input / Precondition                                 | Perspective (Equivalence / Boundary) | Expected Result                                              | Notes                 |
 * |-------------|------------------------------------------------------|--------------------------------------|--------------------------------------------------------------|-----------------------|
 * | TC-MAN-N-01 | Real 14 domain directories in src/lib                | Equivalence – Normal Full Scan       | All 14 manifests pass verifyDomainManifests without error    | Acceptance standard   |
 * | TC-MAN-N-02 | Whitelisted icon names (e.g. shopping-bag, truck)    | Equivalence – Whitelist Lookup       | isKnownIcon returns true, getIconSvg returns valid SVG tag   | Icon registry SSOT    |
 * | TC-MAN-N-03 | Valid compliant mock manifest object                 | Equivalence – Unit Manifest Check    | validateSingleManifest returns valid: true and errors: []    | Pure unit validation  |
 * | TC-MAN-E-01 | Missing id field                                     | Error – Missing Field                | Rejected with 'Field "id" is required'                       | Mandatory schema      |
 * | TC-MAN-E-02 | Missing label field                                  | Error – Missing Field                | Rejected with 'Field "label" is required'                    | Mandatory schema      |
 * | TC-MAN-E-03 | Missing icon field                                   | Error – Missing Field                | Rejected with 'Field "icon" is required'                     | Mandatory schema      |
 * | TC-MAN-E-04 | Missing route field                                  | Error – Missing Field                | Rejected with 'Field "route" is required'                    | Mandatory schema      |
 * | TC-MAN-E-05 | Missing aliases field                                | Error – Missing Field                | Rejected with 'Field "aliases" is required'                  | Mandatory schema      |
 * | TC-MAN-E-06 | Missing entry field                                  | Error – Missing Field                | Rejected with 'Field "entry" is required'                    | Mandatory schema      |
 * | TC-MAN-E-07 | Missing topLevelNav field                            | Error – Missing Field                | Rejected with 'Field "topLevelNav" is required'              | Mandatory schema      |
 * | TC-MAN-E-08 | id does not match directory name                     | Error – ID Directory Invariant       | Rejected with 'must match directory name'                    | Folder invariant      |
 * | TC-MAN-E-09 | Two domains share the same id                        | Error – ID Duplicate Conflict        | verifyDomainManifests rejects with 'Duplicate module id'     | Global uniqueness     |
 * | TC-MAN-E-10 | Arbitrary SVG string or unknown icon name            | Error – Icon Whitelist Violation     | Rejected with 'not registered in KNOWN_ICONS'                | Anti-injection guard  |
 * | TC-MAN-E-11 | entry points to non-existent file                    | Error – Entry Existence Violation    | Rejected with 'Entry file not found at'                      | Disk existence guard  |
 * | TC-MAN-E-12 | route does not start with '/'                        | Error – Route Format Violation       | Rejected with 'must be a canonical path starting with "/"'   | Canonical URI format  |
 * | TC-MAN-E-13 | aliases contains non-string elements                 | Error – Array Element Type           | Rejected with 'must be a string'                             | Type enforcement      |
 * | TC-MAN-E-14 | topLevelNav provided as string "true"                | Error – Boolean Type Violation       | Rejected with 'must be a boolean (true or false)'            | Type enforcement      |
 * | TC-MAN-B-01 | Manifest is null, undefined, or array                | Boundary – Non-object Manifest       | Rejected with 'Manifest must be a non-null JSON object'      | Root boundary         |
 * | TC-MAN-B-02 | Required string fields are empty or whitespace       | Boundary – Empty String Values       | Rejected with required non-empty string errors               | Empty value boundary  |
 * | TC-MAN-B-03 | aliases is empty array []                            | Boundary – Empty Array               | Validated as valid (empty aliases is acceptable)             | Collection boundary   |
 * | TC-MAN-B-04 | Icon lookup with null, undefined, or unknown         | Boundary – Unknown / Null Icon       | isKnownIcon returns false, getIconSvg returns empty string   | Safe boundary fallback|
 * -------------------------------------------------------------------------------------------------
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tempTestDir = path.resolve(__dirname, '../.tmp_manifest_test');

test.describe('Issue #263: Domain Manifest Schema & CI Verification Suite', () => {

  test('TC-MAN-N-01: Real 14 domain directories in src/lib pass full CI manifest verification', () => {
    // Given: The 14 domain folders in src/lib
    // When: Running the CI verification engine
    const outcome = verifyDomainManifests();

    // Then: All 14 domains must pass with zero errors
    assert.strictEqual(outcome.success, true, `Verification failed with errors: ${outcome.errors.join('; ')}`);
    assert.strictEqual(outcome.count, 14, 'Must verify exactly 14 domain directories');
    assert.strictEqual(outcome.errors.length, 0, 'Must have zero verification errors');

    for (const domain of EXPECTED_DOMAINS) {
      assert.ok(outcome.results[domain], `Domain [${domain}] must be in verification results`);
      assert.strictEqual(outcome.results[domain].valid, true, `Domain [${domain}] manifest must be valid`);
      assert.deepStrictEqual(outcome.results[domain].errors, [], `Domain [${domain}] must have no errors`);
    }
  });

  test('TC-MAN-N-02: Icon registry provides verified whitelist and SVG generator', () => {
    // Given: Stable icon identifiers extracted from App.svelte
    const expectedCoreIcons = [
      'shopping-bag',
      'file-text',
      'warehouse',
      'credit-card',
      'clipboard-list',
      'truck',
      'settings'
    ];

    // When & Then: All core icons must be registered and return valid SVG markup
    for (const iconName of expectedCoreIcons) {
      assert.strictEqual(isKnownIcon(iconName), true, `Icon [${iconName}] must be in registry`);
      const def = getIcon(iconName);
      assert.ok(def, `Icon definition for [${iconName}] must exist`);
      assert.strictEqual(def.name, iconName);
      assert.ok(def.innerHtml.length > 0, `Icon [${iconName}] must have SVG inner HTML`);

      const svg = getIconSvg(iconName, { width: 24, height: 24 });
      assert.ok(svg.startsWith('<svg width="24" height="24"'), `Generated SVG must contain custom dimensions`);
      assert.ok(svg.includes(def.innerHtml), `Generated SVG must include definition inner HTML`);
    }
  });

  test('TC-MAN-N-03: Compliant manifest object passes validateSingleManifest', () => {
    // Given: A fully valid domain manifest object
    const validManifest = {
      id: 'testDomain',
      label: '測試領域',
      icon: 'warehouse',
      route: '/app/test-domain',
      aliases: ['test-domain', '/app/test'],
      entry: 'Workspace.svelte',
      topLevelNav: true
    };

    // When: Validating without disk presence check
    const result = validateSingleManifest(validManifest, { expectedId: 'testDomain' });

    // Then: Result must be valid with zero errors
    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.errors, []);
  });

  test('TC-MAN-E-01: Missing id field is rejected', () => {
    // Given: Manifest missing id
    const manifest = {
      label: '採購單',
      icon: 'shopping-bag',
      route: '/app/purchase-orders',
      aliases: ['po'],
      entry: 'Workspace.svelte',
      topLevelNav: true
    };

    // When: Validating manifest
    const result = validateSingleManifest(manifest);

    // Then: Must fail with id requirement error
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Field "id" is required')));
  });

  test('TC-MAN-E-02: Missing label field is rejected', () => {
    // Given: Manifest missing label
    const manifest = {
      id: 'purchaseOrders',
      icon: 'shopping-bag',
      route: '/app/purchase-orders',
      aliases: ['po'],
      entry: 'Workspace.svelte',
      topLevelNav: true
    };

    // When: Validating manifest
    const result = validateSingleManifest(manifest);

    // Then: Must fail with label requirement error
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Field "label" is required')));
  });

  test('TC-MAN-E-03: Missing icon field is rejected', () => {
    // Given: Manifest missing icon
    const manifest = {
      id: 'purchaseOrders',
      label: '採購單',
      route: '/app/purchase-orders',
      aliases: ['po'],
      entry: 'Workspace.svelte',
      topLevelNav: true
    };

    // When: Validating manifest
    const result = validateSingleManifest(manifest);

    // Then: Must fail with icon requirement error
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Field "icon" is required')));
  });

  test('TC-MAN-E-04: Missing route field is rejected', () => {
    // Given: Manifest missing route
    const manifest = {
      id: 'purchaseOrders',
      label: '採購單',
      icon: 'shopping-bag',
      aliases: ['po'],
      entry: 'Workspace.svelte',
      topLevelNav: true
    };

    // When: Validating manifest
    const result = validateSingleManifest(manifest);

    // Then: Must fail with route requirement error
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Field "route" is required')));
  });

  test('TC-MAN-E-05: Missing aliases field is rejected', () => {
    // Given: Manifest missing aliases
    const manifest = {
      id: 'purchaseOrders',
      label: '採購單',
      icon: 'shopping-bag',
      route: '/app/purchase-orders',
      entry: 'Workspace.svelte',
      topLevelNav: true
    };

    // When: Validating manifest
    const result = validateSingleManifest(manifest);

    // Then: Must fail with aliases requirement error
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Field "aliases" is required and must be an array')));
  });

  test('TC-MAN-E-06: Missing entry field is rejected', () => {
    // Given: Manifest missing entry
    const manifest = {
      id: 'purchaseOrders',
      label: '採購單',
      icon: 'shopping-bag',
      route: '/app/purchase-orders',
      aliases: ['po'],
      topLevelNav: true
    };

    // When: Validating manifest
    const result = validateSingleManifest(manifest);

    // Then: Must fail with entry requirement error
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Field "entry" is required')));
  });

  test('TC-MAN-E-07: Missing topLevelNav field is rejected', () => {
    // Given: Manifest missing topLevelNav
    const manifest = {
      id: 'purchaseOrders',
      label: '採購單',
      icon: 'shopping-bag',
      route: '/app/purchase-orders',
      aliases: ['po'],
      entry: 'Workspace.svelte'
    };

    // When: Validating manifest
    const result = validateSingleManifest(manifest);

    // Then: Must fail with topLevelNav requirement error
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Field "topLevelNav" is required and must be a boolean')));
  });

  test('TC-MAN-E-08: Manifest id mismatch with folder name is rejected', () => {
    // Given: Manifest id 'mismatchedId' inside directory 'actualFolder'
    const manifest = {
      id: 'mismatchedId',
      label: '測試',
      icon: 'warehouse',
      route: '/app/test',
      aliases: [],
      entry: 'Workspace.svelte',
      topLevelNav: false
    };

    // When: Validating with expectedId 'actualFolder'
    const result = validateSingleManifest(manifest, { expectedId: 'actualFolder' });

    // Then: Must fail with mismatch error
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('must match directory name ("actualFolder")')));
  });

  test('TC-MAN-E-09: Duplicate module id across different directories is rejected', () => {
    // Given: A temporary test folder structure with two domains having the same id
    const mockBaseDir = path.join(tempTestDir, 'duplicate_test');
    const domainADir = path.join(mockBaseDir, 'domainA');
    const domainBDir = path.join(mockBaseDir, 'domainB');

    fs.mkdirSync(domainADir, { recursive: true });
    fs.mkdirSync(domainBDir, { recursive: true });
    fs.writeFileSync(path.join(domainADir, 'Workspace.svelte'), '<script></script>');
    fs.writeFileSync(path.join(domainBDir, 'Workspace.svelte'), '<script></script>');

    fs.writeFileSync(
      path.join(domainADir, 'manifest.json'),
      JSON.stringify({
        id: 'sharedId',
        label: 'A',
        icon: 'truck',
        route: '/app/a',
        aliases: [],
        entry: 'Workspace.svelte',
        topLevelNav: false
      })
    );

    fs.writeFileSync(
      path.join(domainBDir, 'manifest.json'),
      JSON.stringify({
        id: 'sharedId',
        label: 'B',
        icon: 'truck',
        route: '/app/b',
        aliases: [],
        entry: 'Workspace.svelte',
        topLevelNav: false
      })
    );

    try {
      // When: Verifying across the mock domains
      const outcome = verifyDomainManifests({
        baseDir: mockBaseDir,
        domains: ['domainA', 'domainB']
      });

      // Then: Must report duplicate id conflict
      assert.strictEqual(outcome.success, false);
      assert.ok(outcome.errors.some(e => e.includes('Duplicate module id "sharedId"')));
    } finally {
      fs.rmSync(mockBaseDir, { recursive: true, force: true });
    }
  });

  test('TC-MAN-E-10: Arbitrary SVG string or unvetted icon name is rejected', () => {
    // Given: Manifest with raw SVG and arbitrary string instead of registered icon
    const manifestWithSvg = {
      id: 'test',
      label: '測試',
      icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>',
      route: '/app/test',
      aliases: [],
      entry: 'Workspace.svelte',
      topLevelNav: false
    };

    const manifestWithUnknownIcon = {
      id: 'test',
      label: '測試',
      icon: 'some-unregistered-icon',
      route: '/app/test',
      aliases: [],
      entry: 'Workspace.svelte',
      topLevelNav: false
    };

    // When: Validating both manifests
    const resSvg = validateSingleManifest(manifestWithSvg);
    const resUnknown = validateSingleManifest(manifestWithUnknownIcon);

    // Then: Both must be rejected for not being registered in KNOWN_ICONS
    assert.strictEqual(resSvg.valid, false);
    assert.ok(resSvg.errors.some(e => e.includes('is not registered in KNOWN_ICONS')));

    assert.strictEqual(resUnknown.valid, false);
    assert.ok(resUnknown.errors.some(e => e.includes('is not registered in KNOWN_ICONS')));
  });

  test('TC-MAN-E-11: Entry file not found on disk is rejected', () => {
    // Given: Manifest pointing to non-existent Workspace file
    const manifest = {
      id: 'warehouses',
      label: '倉庫管理',
      icon: 'warehouse',
      route: '/app/warehouses',
      aliases: [],
      entry: 'NonExistentComponent.svelte',
      topLevelNav: true
    };

    // When: Validating with actual warehouses folder path
    const warehousesDir = path.resolve(__dirname, '../src/lib/warehouses');
    const result = validateSingleManifest(manifest, { dirPath: warehousesDir });

    // Then: Must fail with entry file not found error
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Entry file not found at')));
  });

  test('TC-MAN-E-12: Route not starting with "/" is rejected', () => {
    // Given: Relative non-canonical route
    const manifest = {
      id: 'purchaseOrders',
      label: '採購單',
      icon: 'shopping-bag',
      route: 'app/purchase-orders', // missing leading slash
      aliases: [],
      entry: 'Workspace.svelte',
      topLevelNav: true
    };

    // When: Validating manifest
    const result = validateSingleManifest(manifest);

    // Then: Must fail with canonical path requirement error
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('must be a canonical path starting with "/"')));
  });

  test('TC-MAN-E-13: Aliases containing non-string elements is rejected', () => {
    // Given: Aliases array with invalid number and object types
    const manifest = {
      id: 'purchaseOrders',
      label: '採購單',
      icon: 'shopping-bag',
      route: '/app/purchase-orders',
      // @ts-ignore
      aliases: ['valid-alias', 12345, { bad: true }],
      entry: 'Workspace.svelte',
      topLevelNav: true
    };

    // When: Validating manifest
    const result = validateSingleManifest(manifest);

    // Then: Must fail with aliases element type error
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Field "aliases[1]" must be a string')));
    assert.ok(result.errors.some(e => e.includes('Field "aliases[2]" must be a string')));
  });

  test('TC-MAN-E-14: topLevelNav provided as string "true" is rejected', () => {
    // Given: Non-boolean string topLevelNav
    const manifest = {
      id: 'purchaseOrders',
      label: '採購單',
      icon: 'shopping-bag',
      route: '/app/purchase-orders',
      aliases: [],
      entry: 'Workspace.svelte',
      // @ts-ignore
      topLevelNav: 'true'
    };

    // When: Validating manifest
    const result = validateSingleManifest(manifest);

    // Then: Must fail with boolean type requirement error
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Field "topLevelNav" is required and must be a boolean')));
  });

  test('TC-MAN-B-01: Null, undefined, or array manifest input is rejected', () => {
    // Given: Non-object or nullish inputs
    // When: Validating
    const resNull = validateSingleManifest(null);
    const resUndefined = validateSingleManifest(undefined);
    const resArray = validateSingleManifest([]);
    const resString = validateSingleManifest('{}');

    // Then: All must fail with non-null JSON object error
    assert.strictEqual(resNull.valid, false);
    assert.ok(resNull.errors[0].includes('non-null JSON object'));

    assert.strictEqual(resUndefined.valid, false);
    assert.ok(resUndefined.errors[0].includes('non-null JSON object'));

    assert.strictEqual(resArray.valid, false);
    assert.ok(resArray.errors[0].includes('non-null JSON object'));

    assert.strictEqual(resString.valid, false);
    assert.ok(resString.errors[0].includes('non-null JSON object'));
  });

  test('TC-MAN-B-02: String fields with empty or whitespace-only content are rejected', () => {
    // Given: Manifest with empty/whitespace string fields
    const manifest = {
      id: '   ',
      label: '',
      icon: '   ',
      route: '',
      aliases: [],
      entry: '  ',
      topLevelNav: false
    };

    // When: Validating manifest
    const result = validateSingleManifest(manifest);

    // Then: All empty string fields must trigger validation errors
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Field "id" is required and must be a non-empty string')));
    assert.ok(result.errors.some(e => e.includes('Field "label" is required and must be a non-empty string')));
    assert.ok(result.errors.some(e => e.includes('Field "icon" is required and must be a non-empty string')));
    assert.ok(result.errors.some(e => e.includes('Field "route" is required and must be a non-empty string')));
    assert.ok(result.errors.some(e => e.includes('Field "entry" is required and must be a non-empty string')));
  });

  test('TC-MAN-B-03: Empty aliases array [] is valid', () => {
    // Given: Manifest with empty array for aliases
    const manifest = {
      id: 'testDomain',
      label: '測試',
      icon: 'truck',
      route: '/app/test',
      aliases: [],
      entry: 'Workspace.svelte',
      topLevelNav: false
    };

    // When: Validating manifest
    const result = validateSingleManifest(manifest, { expectedId: 'testDomain' });

    // Then: Empty array is accepted as valid
    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.errors, []);
  });

  test('TC-MAN-B-04: Icon lookup with null, undefined, or empty returns false', () => {
    // Given: Nullish or invalid icon queries
    // When & Then: Functions must return safe fallbacks without throwing
    assert.strictEqual(isKnownIcon(null), false);
    assert.strictEqual(isKnownIcon(undefined), false);
    assert.strictEqual(isKnownIcon(''), false);
    assert.strictEqual(isKnownIcon('   '), false);
    assert.strictEqual(isKnownIcon('non-existent-icon'), false);

    assert.strictEqual(getIcon(null), undefined);
    assert.strictEqual(getIcon(undefined), undefined);
    assert.strictEqual(getIcon(''), undefined);

    assert.strictEqual(getIconSvg(null), '');
    assert.strictEqual(getIconSvg('non-existent-icon'), '');
  });
});

