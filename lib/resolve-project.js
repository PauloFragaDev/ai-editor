'use strict';
const fsReal = require('fs');
const path = require('path');

// Sube desde startPath hasta encontrar un marcador de proyecto, sin salir de docRoot.
function findProjectRoot(startPath, docRoot, fsDeps) {
  var fs = fsDeps || fsReal;
  var dir = path.resolve(startPath);
  var root = path.resolve(docRoot);
  while (dir.indexOf(root) === 0) {
    if (fs.existsSync(path.join(dir, 'artisan')) && fs.existsSync(path.join(dir, 'composer.json'))) {
      return { projectRoot: dir, kind: 'laravel' };
    }
    if (fs.existsSync(path.join(dir, 'vite.config.js')) || fs.existsSync(path.join(dir, 'vite.config.ts'))) {
      return { projectRoot: dir, kind: 'spa' };
    }
    if (fs.existsSync(path.join(dir, 'index.html'))) {
      return { projectRoot: dir, kind: 'static' };
    }
    if (dir === root) { break; }
    dir = path.dirname(dir);
  }
  return { projectRoot: root, kind: 'static' };
}

function resolveProject(url, config, fsDeps) {
  var fs = fsDeps || fsReal;

  // 0. Páginas file:// — el navegador envía origin como la cadena "null".
  if (!url.origin || url.origin === 'null') {
    var filePath = url.pathname || '';
    if (fs.existsSync(filePath)) {
      return { projectRoot: path.dirname(filePath), kind: 'static' };
    }
    return { projectRoot: null, kind: null };
  }

  var docRoot = path.resolve(config.docRoot);

  // 1. Ruta explícita por origin (prefijo).
  var routes = config.routes || [];
  for (var i = 0; i < routes.length; i++) {
    if ((url.origin + url.pathname).indexOf(routes[i].match) === 0 || url.origin === routes[i].match) {
      return { projectRoot: routes[i].projectRoot, kind: routes[i].kind };
    }
  }

  // 2. Default Apache :80 → docRoot + primer segmento del pathname.
  var segs = (url.pathname || '/').split('/').filter(Boolean);
  var candidate = path.resolve(docRoot, segs.length ? segs[0] : '');
  if (candidate.indexOf(docRoot) !== 0) {
    return { projectRoot: null, kind: null };  // path escapó del docRoot
  }
  var detected = findProjectRoot(candidate, docRoot, fs);
  return detected;
}

module.exports = { resolveProject, findProjectRoot };
