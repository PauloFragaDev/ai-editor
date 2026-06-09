'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseReport } = require('../lib/parse-report');

describe('parseReport', () => {
  it('extracts a plain JSON report', () => {
    const r = parseReport('Edité el archivo.\n{ "status":"edited", "file":"/p/a.blade.php", "affectsMultiple":false, "summary":"título cambiado" }');
    assert.equal(r.status, 'edited');
    assert.equal(r.file, '/p/a.blade.php');
    assert.equal(r.affectsMultiple, false);
  });

  it('extracts JSON inside ```json fences', () => {
    const raw = '```json\n{ "status":"ambiguous", "candidates":["a","b"] }\n```';
    const r = parseReport(raw);
    assert.equal(r.status, 'ambiguous');
    assert.deepEqual(r.candidates, ['a', 'b']);
  });

  it('returns not_found status when no JSON present', () => {
    const r = parseReport('No encontré nada relevante.');
    assert.equal(r.status, 'not_found');
  });

  it('extracts newHtml from the report', () => {
    const r = parseReport('{ "status":"edited", "file":"/p/a.html", "newHtml":"<h1>Hola</h1>" }');
    assert.equal(r.status, 'edited');
    assert.equal(r.newHtml, '<h1>Hola</h1>');
  });

  it('handles newHtml that contains braces', () => {
    const stdout = 'Listo.\n{ "status":"edited", "file":"/p/a.html", "newHtml":"<div style=\\"color:red\\" data-x=\\"{a:1}\\">x</div>", "summary":"ok" }';
    const r = parseReport(stdout);
    assert.equal(r.status, 'edited');
    assert.equal(r.newHtml, '<div style="color:red" data-x="{a:1}">x</div>');
    assert.equal(r.file, '/p/a.html');
  });

  it('returns null newHtml when absent', () => {
    const r = parseReport('{ "status":"edited", "file":"/p/a.html" }');
    assert.equal(r.newHtml, null);
  });
});
