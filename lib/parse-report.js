'use strict';

// Extrae el último objeto JSON con una clave "status" del stdout de claude.
function parseReport(stdout) {
  var text = String(stdout || '');
  // Busca todos los bloques { ... } candidatos, del último al primero.
  // Usamos un regex greedy para capturar el objeto completo incluyendo arrays anidados.
  var matches = [];
  var start = -1;
  for (var i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (start === -1) start = i;
    } else if (text[i] === '}' && start !== -1) {
      matches.push(text.slice(start, i + 1));
      start = -1;
    }
  }
  // Intentar parsear del último al primero
  for (var j = matches.length - 1; j >= 0; j--) {
    try {
      var obj = JSON.parse(matches[j]);
      if (obj && typeof obj.status === 'string') {
        return {
          status: obj.status,
          file: obj.file || null,
          candidates: obj.candidates || [],
          affectsMultiple: !!obj.affectsMultiple,
          summary: obj.summary || ''
        };
      }
    } catch (e) { /* sigue probando */ }
  }
  return { status: 'not_found', file: null, candidates: [], affectsMultiple: false, summary: '' };
}

module.exports = { parseReport };
