/**
 * @file issue162-cleanup.test.js
 * @description Test suite for Issue #162 - Clean up Phase 0/1 obsolete backend tables, mock_cdn, seed data,
 * and verify the fix for Issue #160 (Channel IPC streaming in Tauri vs Mock mode).
 * Conforms to .agent/rules/test-strategy.md and docs/standards/testing-verification.md.
 *
 * ## Test Perspective Table (Equivalence Partitioning & Boundary Values)
 * | Case ID | Input / Precondition | Perspective (Equivalence / Boundary) | Expected Result | Notes |
 * |---|---|---|---|---|
 * | TC-162-CHN-01 | Browser mock environment (no window.__TAURI_INTERNALS__), new Channel() | Equivalence – Normal Mock Channel | Instance has onmessage callback property, no toJSON IPC method | Browser sandbox mode |
 * | TC-162-CHN-02 | Tauri environment simulation (window.__TAURI_INTERNALS__ present), new Channel() | Equivalence – Normal Tauri Channel | Instance has toJSON returning "__CHANNEL__:<id>" | Native Tauri IPC mode |
 * | TC-162-CHN-03 | Call invoke('simulate_agent_chat', { channel }) | Equivalence – Normal Chat Streaming | Receives honest message "一般對話尚未串接 LLM 模型...", no SO-9922 or invoice references | Honest assistant reply |
 * | TC-162-CHN-04 | new Channel(null) / no constructor callback, onmessage assigned later | Boundary – NULL / Late binding | Receives streaming messages via late-bound setter | Boundary scenario |
 * | TC-162-CHN-05 | invoke('simulate_agent_chat', { message: '   ', channel }) | Boundary – Whitespace / Empty message | Streams honest response safely without error | Boundary scenario |
 * | TC-162-CHN-06 | invoke('simulate_agent_chat', { channel: null }) | Error – Null / Missing Channel | Resolves safely without unhandled exception or crash | Error scenario |
 * | TC-162-CHN-07 | Inspect done flag across streaming lifecycle | Boundary – Stream State Transitions | Intermediate chunks have done === false, terminal chunk has done === true | Stream lifecycle |
 * | TC-162-CLN-01 | Check mock_cdn directory on filesystem | Equivalence – Obsolete Directory Cleanup | Directory does not exist | Phase 0/1 CDN removal |
 * | TC-162-CLN-02 | Inspect vite.config.js content | Equivalence – Obsolete Plugin Cleanup | Does not contain serveMockCdn or /mock_cdn/ route | Dev server cleanup |
 * | TC-162-CLN-03 | Inspect scripts/seed-test-data.mjs content | Equivalence – Seed Script Cleanup | Does not contain orders array or mirrored_orders table | Seed data cleanup |
 * | TC-162-CLN-04 | Inspect src-tauri/src/lib.rs content | Equivalence – Database Initialization Cleanup | init_db does not create modules or mirrored_orders table, and no DROP statements | DB startup cleanup |
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Polyfill Svelte 5 $state rune for Node.js test environment if not defined
if (typeof globalThis.$state === 'undefined') {
  globalThis.$state = (v) => v;
}

const { Channel, invoke } = await import('../src/lib/tauri.js');

test('TC-162-CHN-01: Equivalence - Browser mock environment returns MockChannel with onmessage capability', () => {
  // Given: Preconditions - in Node.js test runner without window.__TAURI_INTERNALS__
  const originalWindow = globalThis.window;
  delete globalThis.window;

  try {
    // When:  Operation to execute
    const channel = new Channel();

    // Then:  Expected result/verification
    assert.ok(channel, 'Channel should instantiate');
    assert.equal(typeof channel.toJSON, 'undefined', 'Mock channel should not have toJSON');
    assert.equal(channel.onmessage, null, 'Default onmessage should be null');

    let received = null;
    channel.onmessage = (msg) => { received = msg; };
    channel.onmessage({ test: 123 });
    assert.deepEqual(received, { test: 123 }, 'onmessage callback should execute');
  } finally {
    if (originalWindow !== undefined) {
      globalThis.window = originalWindow;
    }
  }
});

test('TC-162-CHN-02: Equivalence - Tauri environment returns TauriChannel with IPC serialization toJSON()', () => {
  // Given: Preconditions - simulate Tauri runtime internals on window
  const originalWindow = globalThis.window;
  let registeredCallback = null;
  globalThis.window = {
    __TAURI_INTERNALS__: {
      transformCallback: (cb) => {
        registeredCallback = cb;
        return 999;
      },
      unregisterCallback: () => {}
    }
  };

  try {
    // When:  Operation to execute
    const channel = new Channel();

    // Then:  Expected result/verification
    assert.ok(channel, 'Channel should instantiate in Tauri mode');
    assert.equal(typeof channel.toJSON, 'function', 'Tauri channel must have toJSON for IPC serialization');
    assert.equal(channel.toJSON(), '__CHANNEL__:999', 'toJSON must return __CHANNEL__:<callbackId>');
    assert.equal(channel.id, 999, 'channel.id must match transformCallback id');
  } finally {
    if (originalWindow !== undefined) {
      globalThis.window = originalWindow;
    } else {
      delete globalThis.window;
    }
  }
});

test('TC-162-CHN-03: Equivalence - simulate_agent_chat streams honest response without legacy draft order text', async () => {
  // Given: Preconditions
  const channel = new Channel();
  const chunks = [];
  let streamCompleted = false;

  const streamPromise = new Promise((resolve) => {
    channel.onmessage = (chunk) => {
      chunks.push(chunk);
      if (chunk.done) {
        streamCompleted = true;
        resolve();
      }
    };
  });

  // When:  Operation to execute
  await invoke('simulate_agent_chat', {
    workspace: 'agent',
    message: '你好，請幫我查詢訂單',
    channel: channel
  });

  await streamPromise;

  // Then:  Expected result/verification
  const fullText = chunks.map(c => c.token).join('');
  assert.ok(streamCompleted, 'Stream should complete with done: true');
  assert.ok(
    fullText.includes('一般對話尚未串接 LLM 模型'),
    `Full text should contain honest LLM status, got: "${fullText}"`
  );
  assert.ok(
    fullText.includes('任務'),
    'Full text should direct user to specific task domains'
  );
  assert.ok(
    !fullText.includes('SO-9922') && !fullText.includes('Mirrored Draft') && !fullText.includes('invoice'),
    'Full text must NOT contain obsolete SO-9922 / invoice simulation text'
  );
});

test('TC-162-CHN-04: Boundary - new Channel(null) supports late assignment of channel.onmessage', async () => {
  // Given: Preconditions
  const channel = new Channel(null);
  assert.equal(channel.onmessage, null);

  const chunks = [];
  const streamPromise = new Promise((resolve) => {
    // Late-bound assignment
    channel.onmessage = (chunk) => {
      chunks.push(chunk);
      if (chunk.done) resolve();
    };
  });

  // When:  Operation to execute
  await invoke('simulate_agent_chat', {
    workspace: 'main',
    message: 'Hello',
    channel: channel
  });

  await streamPromise;

  // Then:  Expected result/verification
  assert.ok(chunks.length > 0, 'Late-bound onmessage should receive streaming tokens');
  assert.ok(chunks[chunks.length - 1].done, 'Last chunk should be marked done');
});

test('TC-162-CHN-05: Boundary - simulate_agent_chat with empty or whitespace message', async () => {
  // Given: Preconditions
  const channel = new Channel();
  let completed = false;

  const streamPromise = new Promise((resolve) => {
    channel.onmessage = (chunk) => {
      if (chunk.done) {
        completed = true;
        resolve();
      }
    };
  });

  // When:  Operation to execute with whitespace message
  await invoke('simulate_agent_chat', {
    workspace: 'main',
    message: '   \n\t  ',
    channel: channel
  });

  await streamPromise;

  // Then:  Expected result/verification
  assert.equal(completed, true, 'Stream should safely complete for whitespace-only message');
});

test('TC-162-CHN-06: Error - simulate_agent_chat handles null or invalid channel gracefully', async () => {
  // Given: Preconditions
  const invalidChannelInputs = [null, undefined, {}, { onmessage: 'not_a_function' }];

  // When / Then: Operation and verification for each invalid channel
  for (const invalidChannel of invalidChannelInputs) {
    const result = await invoke('simulate_agent_chat', {
      workspace: 'main',
      message: 'test',
      channel: invalidChannel
    });
    assert.equal(result, null, 'Invoke with invalid channel should resolve safely to null');
  }
});

test('TC-162-CHN-07: Boundary - Stream state transitions maintain done: false until the final token', async () => {
  // Given: Preconditions
  const channel = new Channel();
  const chunkStatuses = [];

  const streamPromise = new Promise((resolve) => {
    channel.onmessage = (chunk) => {
      chunkStatuses.push(chunk.done);
      if (chunk.done) resolve();
    };
  });

  // When:  Operation to execute
  await invoke('simulate_agent_chat', {
    workspace: 'main',
    message: '測試串流狀態',
    channel: channel
  });

  await streamPromise;

  // Then:  Expected result/verification
  assert.ok(chunkStatuses.length > 1, 'Stream should have multiple chunks');
  for (let i = 0; i < chunkStatuses.length - 1; i++) {
    assert.equal(chunkStatuses[i], false, `Chunk ${i} must have done === false`);
  }
  assert.equal(chunkStatuses[chunkStatuses.length - 1], true, 'Final chunk must have done === true');
});

test('TC-162-CLN-01: Equivalence - mock_cdn directory is completely removed from project', () => {
  // Given: Preconditions
  const mockCdnPath = path.resolve(process.cwd(), 'mock_cdn');

  // When:  Operation to execute
  const exists = fs.existsSync(mockCdnPath);

  // Then:  Expected result/verification
  assert.equal(exists, false, 'mock_cdn directory should not exist on filesystem');
});

test('TC-162-CLN-02: Equivalence - vite.config.js does not contain serveMockCdn plugin', () => {
  // Given: Preconditions
  const viteConfigPath = path.resolve(process.cwd(), 'vite.config.js');

  // When:  Operation to execute
  const content = fs.readFileSync(viteConfigPath, 'utf8');

  // Then:  Expected result/verification
  assert.ok(!content.includes('serveMockCdn'), 'vite.config.js must not reference serveMockCdn');
  assert.ok(!content.includes('/mock_cdn/'), 'vite.config.js must not reference /mock_cdn/');
});

test('TC-162-CLN-03: Equivalence - seed-test-data.mjs does not seed mirrored_orders or orders', () => {
  // Given: Preconditions
  const seedScriptPath = path.resolve(process.cwd(), 'scripts', 'seed-test-data.mjs');

  // When:  Operation to execute
  const content = fs.readFileSync(seedScriptPath, 'utf8');

  // Then:  Expected result/verification
  assert.ok(!content.includes('mirrored_orders'), 'seed-test-data.mjs must not reference mirrored_orders');
  assert.ok(!content.includes('孿生訂單'), 'seed-test-data.mjs must not log 孿生訂單');
  assert.ok(!content.includes('SO-9921'), 'seed-test-data.mjs must not seed SO-9921');
  assert.ok(!content.includes('SO-9922'), 'seed-test-data.mjs must not seed SO-9922');
});

test('TC-162-CLN-04: Equivalence - src-tauri/src/lib.rs init_db does not create modules or mirrored_orders table', () => {
  // Given: Preconditions
  const libRsPath = path.resolve(process.cwd(), 'src-tauri', 'src', 'lib.rs');

  // When:  Operation to execute
  const content = fs.readFileSync(libRsPath, 'utf8');

  // Then:  Expected result/verification
  assert.ok(!content.includes('CREATE TABLE IF NOT EXISTS modules'), 'lib.rs must not create modules table');
  assert.ok(!content.includes('CREATE TABLE IF NOT EXISTS mirrored_orders'), 'lib.rs must not create mirrored_orders table');
  assert.ok(!content.includes('DROP TABLE'), 'lib.rs must not drop tables (harmless legacy)');
  assert.ok(content.includes('一般對話尚未串接 LLM 模型'), 'lib.rs must contain updated honest chat response');
});

// Execution Command: node --test tests/issue162-cleanup.test.js
// Full Test Suite: npm test
