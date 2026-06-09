'use strict';

// Extrae objetos JSON de nivel superior respetando strings y escapes.
function extractJsonObjects(text) {
  var objs = [];
  var depth = 0, start = -1, inStr = false, esc = false;
  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    if (inStr) {
      if (esc) { esc = false; }
      else if (ch === '\\') { esc = true; }
      else if (ch === '"') { inStr = false; }
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') { if (depth === 0) { start = i; } depth++; }
    else if (ch === '}') {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start !== -1) { objs.push(text.slice(start, i + 1)); start = -1; }
      }
    }
  }
  return objs;
}

// Extrae el último objeto JSON con una clave "status" del stdout de claude.
function parseReport(stdout) {
  var text = String(stdout || '');
  var matches = extractJsonObjects(text);
  for (var j = matches.length - 1; j >= 0; j--) {
    try {
      var obj = JSON.parse(matches[j]);
      if (obj && typeof obj.status === 'string') {
        return {
          status: obj.status,
          file: obj.file || null,
          candidates: obj.candidates || [],
          affectsMultiple: !!obj.affectsMultiple,
          summary: obj.summary || '',
          newHtml: (typeof obj.newHtml === 'string' ? obj.newHtml : null)
        };
      }
    } catch (e) { /* sigue probando */ }
  }
  return { status: 'not_found', file: null, candidates: [], affectsMultiple: false, summary: '', newHtml: null };
}

module.exports = { parseReport };
