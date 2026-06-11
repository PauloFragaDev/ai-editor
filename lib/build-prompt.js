'use strict';

function buildSourceEditPrompt(e) {
  var lines = [];
  lines.push('Eres un agente que edita el ARCHIVO FUENTE de un componente web a partir de un');
  lines.push('elemento del DOM renderizado. Tienes Read, Grep, Glob, Edit sobre el proyecto.');
  lines.push('');
  lines.push('PROYECTO: ' + e.projectRoot + '  (tipo: ' + e.kind + ')');
  lines.push('URL renderizada: ' + e.url.href);
  lines.push('');
  lines.push('OBJETIVO: localiza el archivo fuente que GENERA este elemento y aplica la');
  lines.push('instrucción respetando la sintaxis del lenguaje (HTML / Blade / Vue SFC / JSX-TSX).');
  lines.push('NO edites assets compilados (public/build, dist, .next). En Laravel edita SOLO en resources/.');
  lines.push('');

  if (e.confirmFile) {
    lines.push('El usuario YA confirmó editar este archivo: ' + e.confirmFile);
    lines.push('Edita ahí directamente la instrucción.');
  } else {
    lines.push('ESTRATEGIA DE LOCALIZACIÓN, en este orden:');
    lines.push('1. Si hay sourceHint {fileName,lineNumber}: ábrelo, verifica que coincide con outerHTML, edita ahí.');
    lines.push('2. Si hay viteInspector "file:line:col" o componentFile (.vue): ábrelo y localiza por uniqueText/atributos en el <template>.');
    lines.push('3. Si no, GREP de uniqueText en las fuentes (Blade: resources/views; SPA: src; estático: *.html). 1 match -> edita; varios -> desambigua con ancestors/attrs; si sigue ambiguo NO edites: status=ambiguous con candidatos.');
    lines.push('4. Sin texto único: usa domPath/ancestors (baja confianza).');
    lines.push('');
    lines.push('CUIDADO con loops/includes: si el elemento procede de @foreach, @include, v-for, .map() o un parcial,');
    lines.push('editar la plantilla afectará a TODAS las instancias. Si lo detectas, hazlo igual pero marca affectsMultiple=true.');
  }

  lines.push('');
  lines.push('EVIDENCIA:');
  lines.push('  framework: ' + e.framework);
  lines.push('  sourceHint: ' + JSON.stringify(e.sourceHint));
  lines.push('  viteInspector: ' + JSON.stringify(e.viteInspector));
  lines.push('  componentFile: ' + JSON.stringify(e.componentFile));
  lines.push('  ancestors: ' + JSON.stringify(e.ancestors));
  lines.push('  attrs: ' + JSON.stringify(e.attrs));
  lines.push('  uniqueText: ' + JSON.stringify(e.uniqueText));
  lines.push('  outerHTML:');
  lines.push(e.outerHTML);
  lines.push('');
  lines.push('INSTRUCCIÓN DEL USUARIO: ' + e.instruction);
  lines.push('');
  lines.push('Cuando termines (o si no puedes), emite EXACTAMENTE un bloque JSON:');
  lines.push('{ "status":"edited|ambiguous|not_found", "file":"...", "candidates":[...], "affectsMultiple":true|false, "summary":"frase corta del cambio", "newHtml":"<el>...</el> o null" }');
  lines.push('summary: una frase corta en español (máx. 12 palabras) describiendo qué se cambió,');
  lines.push('p.ej. "Texto del botón cambiado a \'Enviar\'" o "Color de fondo del header a azul".');
  lines.push('');
  lines.push('newHtml: OBLIGATORIO en casi todos los casos. Debe ser ÚNICAMENTE el outerHTML del mismo');
  lines.push('elemento raíz que aparece en EVIDENCIA:outerHTML — mismo tag, mismo nivel, sin hermanos');
  lines.push('ni ancestros. Toma ese elemento, aplica exactamente los cambios y devuélvelo completo.');
  lines.push('El editor sustituye ese nodo en tiempo real; si incluyes más elementos o un contenedor');
  lines.push('padre, el resto de la página desaparecerá visualmente.');
  lines.push('USA null ÚNICAMENTE si el cambio es EXCLUSIVAMENTE en un <style> o <script> externo');
  lines.push('sin modificar el elemento en sí. Para texto, atributos, clases, estilos inline o');
  lines.push('estructura interior: SIEMPRE proporciona newHtml.');

  return lines.join('\n');
}

module.exports = { buildSourceEditPrompt };
