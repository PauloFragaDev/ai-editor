'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseBackup } = require('../lib/parse-backup');

describe('parseBackup', () => {
  it('extracts content between markers', () => {
    const out = 'log\n<<<BACKUP_START>>>\n<p>orig</p>\n<<<BACKUP_END>>>\nmore';
    assert.equal(parseBackup(out), '<p>orig</p>\n');
  });

  it('returns null when start marker absent', () => {
    assert.equal(parseBackup('sin marcadores'), null);
  });

  it('returns null when end marker absent', () => {
    assert.equal(parseBackup('<<<BACKUP_START>>>\nx'), null);
  });

  it('handles empty and undefined input', () => {
    assert.equal(parseBackup(''), null);
    assert.equal(parseBackup(undefined), null);
  });
});
