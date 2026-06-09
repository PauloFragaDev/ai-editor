'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildSourceEditPrompt } = require('../lib/build-prompt');

describe('buildSourceEditPrompt', () => {
  it('includes projectRoot, kind, instruction and uniqueText', () => {
    const p = buildSourceEditPrompt({
      projectRoot: '/var/www/html/iqv', kind: 'laravel',
      url: { href: 'http://localhost:8000/clients' },
      uniqueText: 'Listado de clientes', instruction: 'cambia el título a Clientes Activos',
      outerHTML: '<h1>Listado de clientes</h1>', ancestors: ['main', 'section'], attrs: {},
      framework: 'none', sourceHint: null, viteInspector: null, componentFile: null
    });
    assert.match(p, /\/var\/www\/html\/iqv/);
    assert.match(p, /laravel/);
    assert.match(p, /Listado de clientes/);
    assert.match(p, /cambia el título a Clientes Activos/);
    assert.match(p, /resources/);
    assert.match(p, /"status"/);
  });

  it('mentions confirmFile when provided', () => {
    const p = buildSourceEditPrompt({
      projectRoot: '/p', kind: 'static', url: { href: 'x' },
      uniqueText: 't', instruction: 'i', outerHTML: '<p>t</p>', ancestors: [], attrs: {},
      framework: 'none', sourceHint: null, viteInspector: null, componentFile: null,
      confirmFile: '/p/index.html'
    });
    assert.match(p, /\/p\/index\.html/);
  });

  it('does not crash when hints are null', () => {
    assert.doesNotThrow(() => buildSourceEditPrompt({
      projectRoot: '/p', kind: 'spa', url: { href: 'x' }, uniqueText: null,
      instruction: 'i', outerHTML: '<div></div>', ancestors: [], attrs: {},
      framework: 'none', sourceHint: null, viteInspector: null, componentFile: null
    }));
  });
});
