'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { runClaude } = require('../lib/run-claude');

describe('runClaude', () => {
  it('resolves with stdout and status 0 on success', async () => {
    const r = await runClaude(['-e', 'process.stdout.write("hola")'], { command: 'node' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), 'hola');
    assert.equal(r.error, null);
  });

  it('resolves with non-zero status and stderr on failure', async () => {
    const r = await runClaude(['-e', 'process.stderr.write("boom");process.exit(3)'], { command: 'node' });
    assert.equal(r.status, 3);
    assert.match(r.stderr, /boom/);
  });

  it('kills the process and signals timeout', async () => {
    const r = await runClaude(['-e', 'setTimeout(()=>{}, 10000)'], { command: 'node', timeout: 150 });
    assert.ok(r.signal || r.status !== 0);
  });
});
