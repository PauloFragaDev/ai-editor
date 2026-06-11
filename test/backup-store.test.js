'use strict';
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

let tmp;
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aiestore-'));
  process.env.AI_EDITOR_DIR = tmp;
});
after(() => {
  delete process.env.AI_EDITOR_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

// require AFTER env var is set so baseDir() resolves to tmp
const store = require('../lib/backup-store');

describe('backup-store', () => {
  beforeEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
  });

  it('add persists a backup and forProject filters by projectKey', () => {
    store.add('id1', '/tmp/a.html', '<p>old</p>', { projectKey: 'proj', instruction: 'x', tag: 'p', time: '10:00' });
    store.add('id2', '/tmp/b.html', '<p>old2</p>', { projectKey: 'otro', instruction: 'y', tag: 'p', time: '10:01' });
    const list = store.forProject('proj');
    assert.equal(list.length, 1);
    assert.equal(list[0].backupId, 'id1');
    assert.equal(list[0].hasBackup, true);
  });

  it('add with null content marks hasBackup false and writes no backup file', () => {
    store.add('id3', '/tmp/c.html', null, { projectKey: 'proj' });
    const list = store.forProject('proj');
    assert.equal(list[0].hasBackup, false);
    assert.equal(fs.existsSync(path.join(tmp, 'backups', 'id3')), false);
  });

  it('restore rewrites the original file and removes the entry', () => {
    const target = path.join(tmp, 'target.html');
    fs.writeFileSync(target, '<p>NEW</p>', 'utf-8');
    store.add('id4', target, '<p>OLD</p>', { projectKey: 'proj' });
    const r = store.restore('id4');
    assert.equal(r.ok, true);
    assert.equal(fs.readFileSync(target, 'utf-8'), '<p>OLD</p>');
    assert.equal(store.forProject('proj').length, 0);
  });

  it('restore returns error for unknown backupId', () => {
    assert.ok(store.restore('nope').error);
  });

  it('clearProject removes only its entries and backup files', () => {
    store.add('id5', '/tmp/d.html', '<p>x</p>', { projectKey: 'proj' });
    store.add('id6', '/tmp/e.html', '<p>y</p>', { projectKey: 'keep' });
    store.clearProject('proj');
    assert.equal(store.forProject('proj').length, 0);
    assert.equal(store.forProject('keep').length, 1);
    assert.equal(fs.existsSync(path.join(tmp, 'backups', 'id5')), false);
  });
});
