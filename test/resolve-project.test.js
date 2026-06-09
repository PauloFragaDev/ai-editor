'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveProject, findProjectRoot } = require('../lib/resolve-project');

// fs mock: set of paths that "exist"
function fsMock(existing) {
  return { existsSync: function (p) { return existing.has(p); } };
}

const config = {
  docRoot: '/var/www/html',
  routes: [
    { match: 'http://localhost:8000', projectRoot: '/var/www/html/iqv', kind: 'laravel' },
    { match: 'http://localhost:5173', projectRoot: '/var/www/html/day-portal-client', kind: 'spa-vue' }
  ]
};

describe('resolveProject', () => {
  it('resolves an explicit route match by origin', () => {
    const r = resolveProject({ origin: 'http://localhost:8000', pathname: '/' }, config, fsMock(new Set()));
    assert.equal(r.projectRoot, '/var/www/html/iqv');
    assert.equal(r.kind, 'laravel');
  });

  it('falls back to docRoot + first path segment for Apache :80', () => {
    const fs = fsMock(new Set(['/var/www/html/fyndo-landing', '/var/www/html/fyndo-landing/index.html']));
    const r = resolveProject({ origin: 'http://localhost', pathname: '/fyndo-landing/' }, config, fs);
    assert.equal(r.projectRoot, '/var/www/html/fyndo-landing');
    assert.equal(r.kind, 'static');
  });

  it('returns null projectRoot when path escapes docRoot', () => {
    const r = resolveProject({ origin: 'http://localhost', pathname: '/../../etc/' }, config, fsMock(new Set()));
    assert.equal(r.projectRoot, null);
  });
});

describe('findProjectRoot', () => {
  it('detects laravel by artisan + composer.json', () => {
    const fs = fsMock(new Set(['/var/www/html/iqv/artisan', '/var/www/html/iqv/composer.json']));
    const r = findProjectRoot('/var/www/html/iqv/resources/views', '/var/www/html', fs);
    assert.equal(r.projectRoot, '/var/www/html/iqv');
    assert.equal(r.kind, 'laravel');
  });

  it('stops at docRoot and never escapes it', () => {
    const r = findProjectRoot('/var/www/html', '/var/www/html', fsMock(new Set()));
    assert.equal(r.projectRoot, '/var/www/html');
  });
});
