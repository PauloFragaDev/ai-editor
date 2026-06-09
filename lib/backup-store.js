'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');

var BASE    = path.join(os.homedir(), '.ai-editor');
var BACKUPS = path.join(BASE, 'backups');
var HISTORY = path.join(BASE, 'history.json');

function ensure() {
  if (!fs.existsSync(BACKUPS)) { fs.mkdirSync(BACKUPS, { recursive: true }); }
}

function loadAll() {
  try { return JSON.parse(fs.readFileSync(HISTORY, 'utf-8')); }
  catch (e) { return []; }
}

function writeAll(entries) {
  ensure();
  fs.writeFileSync(HISTORY, JSON.stringify(entries), 'utf-8');
}

// Añade una entrada al historial. content puede ser null (sin backup disponible).
function add(backupId, file, content, meta) {
  ensure();
  var hasBackup = content !== null && content !== undefined;
  if (hasBackup) {
    fs.writeFileSync(path.join(BACKUPS, backupId), content, 'utf-8');
  }
  var h = loadAll();
  h.push(Object.assign({ backupId: backupId, file: file, hasBackup: hasBackup, ts: Date.now() }, meta));
  writeAll(h);
}

// Restaura el archivo original desde el backup y elimina la entrada.
function restore(backupId) {
  var h = loadAll();
  var entry = null;
  for (var i = 0; i < h.length; i++) { if (h[i].backupId === backupId) { entry = h[i]; break; } }
  if (!entry) return { error: 'backup no encontrado (puede haberse limpiado)' };
  if (!entry.hasBackup) return { error: 'este cambio no tiene backup disponible' };
  var bf = path.join(BACKUPS, backupId);
  if (!fs.existsSync(bf)) return { error: 'archivo de backup eliminado' };
  try {
    fs.writeFileSync(entry.file, fs.readFileSync(bf, 'utf-8'), 'utf-8');
    writeAll(h.filter(function (e) { return e.backupId !== backupId; }));
    fs.unlinkSync(bf);
    return { ok: true, file: entry.file };
  } catch (e) {
    return { error: e.message };
  }
}

// Devuelve el historial filtrado por projectKey.
function forProject(projectKey) {
  return loadAll().filter(function (e) { return e.projectKey === projectKey; });
}

// Elimina todos los backups y entradas de un proyecto.
function clearProject(projectKey) {
  var h = loadAll();
  var keep = [], remove = [];
  h.forEach(function (e) { (e.projectKey === projectKey ? remove : keep).push(e); });
  remove.forEach(function (e) {
    var bf = path.join(BACKUPS, e.backupId);
    if (fs.existsSync(bf)) { try { fs.unlinkSync(bf); } catch (err) {} }
  });
  writeAll(keep);
}

module.exports = { add, restore, forProject, clearProject };
