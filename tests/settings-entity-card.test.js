/**
 * @file settings-entity-card.test.js
 * @description Test suite for reusable SettingsEntityCard component and App.svelte card refactoring (Issue #134).
 *
 * ## Test Perspective Table (Equivalence Partitioning & Boundary Values)
 * | Case ID | Input / Precondition | Perspective (Equivalence / Boundary) | Expected Result | Notes |
 * |---|---|---|---|---|
 * | TC-SEC-N-01 | Title: '成員與角色管理', onRefresh provided | Equivalence – Normal header with title & refresh button | Header rendered with h3 title and refresh button | Basic card shell |
 * | TC-SEC-N-02 | Title + badge: 'Partner 聚合根', badgeClass: 'badge-cyan' | Equivalence – Header with title and badge | Badge element rendered with correct class and text alongside title | Badge support |
 * | TC-SEC-N-03 | headerExtra snippet provided (filter buttons) | Equivalence – Header extra slot/snippet | Filter buttons rendered in header action area alongside refresh button | Header extension |
 * | TC-SEC-N-04 | description: '管理當前組織架構...' | Equivalence – Description paragraph | Rendered with `.settings-desc` paragraph class | Description support |
 * | TC-SEC-N-05 | form snippet provided | Equivalence – Form area slot/snippet | Form container and fields rendered in card body before error/list | Form slot |
 * | TC-SEC-N-06 | errorMessage: '成員名稱不可為空' | Equivalence – Error banner | Rendered in red error banner below form | Error handling |
 * | TC-SEC-N-07 | isEmpty: true, emptyMessage: '目前尚無成員資料...' | Equivalence – Empty state container | Rendered with `.empty-audit` container with specified message | Empty state |
 * | TC-SEC-N-08 | isEmpty: false, children snippet with list items | Equivalence – Items rendering | List items rendered inside container with specified `listClass` & `listStyle` | List container |
 * | TC-SEC-B-01 | badge: null / undefined / empty string | Boundary – No badge | Header rendered without badge element | Optional badge |
 * | TC-SEC-B-02 | errorMessage: null / undefined / empty string | Boundary – No error | Error banner container not rendered | Clean state |
 * | TC-SEC-B-03 | description: null / undefined / empty string | Boundary – No description | Description paragraph not rendered | Optional description |
 * | TC-SEC-B-04 | headerExtra: null / undefined | Boundary – No header extra | Only refresh button rendered in header actions area | Default header actions |
 * | TC-SEC-B-05 | onRefresh: null / undefined | Boundary – No refresh button | Refresh button not rendered | Optional refresh action |
 * | TC-SEC-B-06 | listStyle: undefined (default) | Boundary – Default list styling | Uses default flex column styling with gap | Default fallback |
 * | TC-SEC-E-01 | isRefreshing: true | Boundary – Refresh loading state | Refresh button is disabled | Concurrency guard |
 * | TC-INT-MEM-01 | Existing Member Management card in App.svelte | Integration – Member card refactoring | SettingsEntityCard wraps member add form, dept picker, and member list | Zero regression |
 * | TC-INT-DEPT-01 | Existing Department Management card in App.svelte | Integration – Department card refactoring | SettingsEntityCard wraps dept add form, parent selector, and dept list | Zero regression |
 * | TC-INT-PTR-01 | Existing Partner Management card in App.svelte | Integration – Partner card refactoring | SettingsEntityCard wraps partner filter in headerExtra, partner form, and partner list | Zero regression |
 * | TC-INT-SKL-01 | Available Skill Configuration card in App.svelte | Integration – Non-scope card exclusion | Skill config card retains tabs+checkbox format without alteration | Scope boundary |
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const componentPath = path.join(rootDir, 'src/lib/components/SettingsEntityCard.svelte');
const appPath = path.join(rootDir, 'src/App.svelte');

test('TC-SEC-N-01: SettingsEntityCard file exists and defines core props contract', () => {
  // Given: Preconditions - SettingsEntityCard component file in src/lib/components
  assert.ok(fs.existsSync(componentPath), 'SettingsEntityCard.svelte must exist in src/lib/components');

  // When:  Operation to execute - Read component content
  const content = fs.readFileSync(componentPath, 'utf-8');

  // Then:  Expected result - Contains title, onRefresh, refreshLabel, and glass-panel wrapper
  assert.match(content, /title/, 'Props should include title');
  assert.match(content, /onRefresh/, 'Props should include onRefresh');
  assert.match(content, /refreshLabel\s*=\s*'重新整理'/, 'refreshLabel default should be 重新整理');
  assert.match(content, /settings-group glass-panel/, 'Default containerClass should be settings-group glass-panel');
});

test('TC-SEC-N-02: SettingsEntityCard supports optional badge with customizable class', () => {
  // Given: Preconditions - Component source code
  const content = fs.readFileSync(componentPath, 'utf-8');

  // When:  Operation to execute - Inspect badge rendering logic
  // Then:  Expected result - Badge is rendered conditionally with badgeClass
  assert.match(content, /badge\s*=\s*''/, 'badge default should be empty string');
  assert.match(content, /badgeClass\s*=\s*'badge-cyan'/, 'badgeClass default should be badge-cyan');
  assert.match(content, /\{#if badge\}/, 'badge should be rendered conditionally');
  assert.match(content, /<span class="badge \{badgeClass\}"/, 'badge span should interpolate badgeClass');
});

test('TC-SEC-N-03: SettingsEntityCard supports headerExtra snippet for custom controls', () => {
  // Given: Preconditions - Component source code
  const content = fs.readFileSync(componentPath, 'utf-8');

  // When:  Operation to execute - Inspect headerExtra rendering logic
  // Then:  Expected result - headerExtra snippet is rendered inside header action row
  assert.match(content, /headerExtra/, 'headerExtra should be accepted as prop');
  assert.match(content, /\{#if headerExtra\}\s*\{@render headerExtra\(\)\}\s*\{\/if\}/, 'headerExtra snippet rendered conditionally');
});

test('TC-SEC-N-04: SettingsEntityCard renders description with settings-desc class', () => {
  // Given: Preconditions - Component source code
  const content = fs.readFileSync(componentPath, 'utf-8');

  // When:  Operation to execute - Inspect description markup
  // Then:  Expected result - description rendered in <p class="settings-desc">
  assert.match(content, /\{#if description\}\s*<p class="settings-desc">\{description\}<\/p>\s*\{\/if\}/, 'description rendered with class settings-desc');
});

test('TC-SEC-N-05: SettingsEntityCard renders form snippet above list container', () => {
  // Given: Preconditions - Component source code
  const content = fs.readFileSync(componentPath, 'utf-8');

  // When:  Operation to execute - Inspect form rendering order
  // Then:  Expected result - form snippet is rendered before errorMessage and list
  const formIndex = content.indexOf('{#if form}');
  const errorIndex = content.indexOf('{#if errorMessage}');
  const listIndex = content.indexOf('<div class={listClass}');

  assert.ok(formIndex > 0, 'form snippet block must exist');
  assert.ok(errorIndex > formIndex, 'errorMessage must come after form');
  assert.ok(listIndex > errorIndex, 'list container must come after errorMessage');
});

test('TC-SEC-N-06: SettingsEntityCard renders errorMessage in dedicated red alert banner', () => {
  // Given: Preconditions - Component source code
  const content = fs.readFileSync(componentPath, 'utf-8');

  // When:  Operation to execute - Inspect error message markup
  // Then:  Expected result - Error message rendered in red banner (#ef4444)
  assert.match(content, /\{#if errorMessage\}/, 'errorMessage should be rendered conditionally');
  assert.match(content, /#ef4444/, 'errorMessage container should style text with error red #ef4444');
});

test('TC-SEC-N-07: SettingsEntityCard renders empty state with emptyMessage when isEmpty is true', () => {
  // Given: Preconditions - Component source code
  const content = fs.readFileSync(componentPath, 'utf-8');

  // When:  Operation to execute - Inspect empty state markup
  // Then:  Expected result - When isEmpty is true, renders .empty-audit with emptyMessage
  assert.match(content, /\{#if isEmpty\}\s*<div class="empty-audit"[^>]*>\{emptyMessage\}<\/div>/, 'empty state uses .empty-audit class');
});

test('TC-SEC-N-08: SettingsEntityCard renders children snippet when isEmpty is false', () => {
  // Given: Preconditions - Component source code
  const content = fs.readFileSync(componentPath, 'utf-8');

  // When:  Operation to execute - Inspect items rendering logic
  // Then:  Expected result - When not empty, renders children snippet inside list container
  assert.match(content, /\{:else if children\}\s*\{@render children\(\)\}\s*\{\/if\}/, 'renders children when isEmpty is false');
});

test('TC-SEC-B-01: Boundary value - Null/empty badge defaults cleanly without extra DOM', () => {
  // Given: Preconditions - Component source code
  const content = fs.readFileSync(componentPath, 'utf-8');

  // When:  Operation to execute - Inspect fallback when badge is empty
  // Then:  Expected result - Renders direct <h3>{title}</h3> without badge wrapper when badge is falsy
  assert.match(content, /\{:else\}\s*<h3 style="margin: 0;">\{title\}<\/h3>/, 'Fallback simple h3 title when badge is not provided');
});

test('TC-SEC-B-02: Boundary value - Null/empty errorMessage does not render error DOM', () => {
  // Given: Preconditions - Component source code
  const content = fs.readFileSync(componentPath, 'utf-8');

  // When:  Operation to execute - Inspect errorMessage condition
  // Then:  Expected result - Strict {#if errorMessage} guard prevents empty red boxes
  assert.ok(content.includes('{#if errorMessage}'), 'Guarded by if statement');
});

test('TC-SEC-B-03: Boundary value - Null/empty description does not render empty paragraph', () => {
  // Given: Preconditions - Component source code
  const content = fs.readFileSync(componentPath, 'utf-8');

  // When:  Operation to execute - Inspect description condition
  // Then:  Expected result - Strict {#if description} guard prevents empty paragraphs
  assert.ok(content.includes('{#if description}'), 'Guarded by if statement');
});

test('TC-SEC-B-04 & B-05: Boundary values - Optional headerExtra and onRefresh', () => {
  // Given: Preconditions - Component source code
  const content = fs.readFileSync(componentPath, 'utf-8');

  // When:  Operation to execute - Inspect header right action elements
  // Then:  Expected result - Both headerExtra and onRefresh button are independently optional
  assert.ok(content.includes('{#if headerExtra}'), 'headerExtra is conditionally rendered');
  assert.ok(content.includes('{#if onRefresh}'), 'onRefresh button is conditionally rendered');
});

test('TC-SEC-B-06: Boundary value - Default listStyle flex column gap', () => {
  // Given: Preconditions - Component source code
  const content = fs.readFileSync(componentPath, 'utf-8');

  // When:  Operation to execute - Inspect default listStyle
  // Then:  Expected result - Default listStyle specifies flex column with gap 8px
  assert.match(content, /listStyle\s*=\s*'display: flex; flex-direction: column; gap: 8px;'/, 'Default listStyle is flex column');
});

test('TC-SEC-E-01: Concurrency guard - isRefreshing disables refresh button', () => {
  // Given: Preconditions - Component source code
  const content = fs.readFileSync(componentPath, 'utf-8');

  // When:  Operation to execute - Inspect onRefresh button disabled binding
  // Then:  Expected result - button has disabled={isRefreshing} attribute
  assert.match(content, /<button class="btn btn-sm" onclick=\{onRefresh\} disabled=\{isRefreshing\}>/, 'Refresh button bound to disabled={isRefreshing}');
});

test('TC-INT-MEM-01: Integration - App.svelte Member Management card uses SettingsEntityCard', () => {
  // Given: Preconditions - App.svelte source code
  const appContent = fs.readFileSync(appPath, 'utf-8');

  // When:  Operation to execute - Inspect Member Management card in App.svelte
  // Then:  Expected result - Uses SettingsEntityCard with title, onRefresh, emptyMessage, and snippet form
  assert.match(appContent, /import SettingsEntityCard from '\.\/lib\/components\/SettingsEntityCard\.svelte';/, 'SettingsEntityCard must be imported in App.svelte');
  assert.match(appContent, /<SettingsEntityCard\s+title="成員與角色管理 \(Member & Role Management\)"/, 'Member card must use SettingsEntityCard');
  assert.match(appContent, /onRefresh=\{fetchMembers\}/, 'Member card must bind onRefresh to fetchMembers');
  assert.match(appContent, /refreshLabel="重新整理成員"/, 'Member card must set refreshLabel to 重新整理成員');
  assert.match(appContent, /emptyMessage="目前尚無成員資料，請新增成員。"/, 'Member card must specify empty message');
  assert.match(appContent, /\{#snippet form\(\)\}\s*<!-- Add Member Form -->/, 'Member card must supply form via snippet');
});

test('TC-INT-DEPT-01: Integration - App.svelte Department Management card uses SettingsEntityCard', () => {
  // Given: Preconditions - App.svelte source code
  const appContent = fs.readFileSync(appPath, 'utf-8');

  // When:  Operation to execute - Inspect Department Management card in App.svelte
  // Then:  Expected result - Uses SettingsEntityCard with title, onRefresh, emptyMessage, and snippet form
  assert.match(appContent, /<SettingsEntityCard\s+title="部門管理 \(Department Management\)"/, 'Department card must use SettingsEntityCard');
  assert.match(appContent, /onRefresh=\{fetchDepartments\}/, 'Department card must bind onRefresh to fetchDepartments');
  assert.match(appContent, /refreshLabel="重新整理部門"/, 'Department card must set refreshLabel to 重新整理部門');
  assert.match(appContent, /emptyMessage="目前尚無部門資料，請新增部門。"/, 'Department card must specify empty message');
  assert.match(appContent, /\{#snippet form\(\)\}\s*<!-- Add Department Form -->/, 'Department card must supply form via snippet');
});

test('TC-INT-PTR-01: Integration - App.svelte Partner Management card uses SettingsEntityCard', () => {
  // Given: Preconditions - App.svelte source code
  const appContent = fs.readFileSync(appPath, 'utf-8');

  // When:  Operation to execute - Inspect Partner Management card in App.svelte
  // Then:  Expected result - Uses SettingsEntityCard with badge, headerExtra snippet for filters, and form snippet
  assert.match(appContent, /<SettingsEntityCard\s+title="合作夥伴基本資料管理 \(Partner Management\)"/, 'Partner card must use SettingsEntityCard');
  assert.match(appContent, /badge="Partner 聚合根"/, 'Partner card must pass badge');
  assert.match(appContent, /\{#snippet headerExtra\(\)\}\s*<div class="filter-row"/, 'Partner card must supply filter buttons via headerExtra snippet');
  assert.match(appContent, /\{#snippet form\(\)\}\s*<!-- Add Partner Form -->/, 'Partner card must supply form via snippet');
  assert.match(appContent, /emptyMessage="目前尚無符合篩選條件的夥伴資料，請透過上方表單或 AI 助理對話登記。"/, 'Partner card must specify empty message');
});

test('TC-INT-SKL-01: Integration - Usable Skills card remains distinct and unchanged', () => {
  // Given: Preconditions - App.svelte source code
  const appContent = fs.readFileSync(appPath, 'utf-8');

  // When:  Operation to execute - Inspect Usable Skills card in App.svelte
  // Then:  Expected result - Usable Skills card retains its custom tabs + disclaimer structure outside SettingsEntityCard
  assert.match(appContent, /<!-- Department Usable Skills Configuration \(Issue #115\) -->/, 'Skills section header remains intact');
  assert.match(appContent, /<div class="skill-disclaimer-banner"/, 'Mandatory security disclaimer remains intact');
});
