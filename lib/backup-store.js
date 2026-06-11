'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');

function baseDir()     { return process.env.AI_EDITOR_DIR || path.join(os.homedir(), '.ai-editor'); }
function backupsDir()  { return path.join(baseDir(), 'backups'); }
function historyFile() { return path.join(baseDir(), 'history.json'); }

function ensure() {
  var b = backupsDir();
  if (!fs.existsSync(b)) { fs.mkdirSync(b, { recursive: true }); }
}

function loadAll() {
  try { return JSON.parse(fs.readFileSync(historyFile(), 'utf-8')); }
  catch (e) { return []; }
}

function writeAll(entries) {
  ensure();
  fs.writeFileSync(historyFile(), JSON.stringify(entries), 'utf-8');
}

// Añade una entrada al historial. content puede ser null (sin backup disponible).
function add(backupId, file, content, meta) {
  ensure();
  var hasBackup = content !== null && content !== undefined;
  if (hasBackup) {
    fs.writeFileSync(path.join(backupsDir(), backupId), content, 'utf-8');
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
  var bf = path.join(backupsDir(), backupId);
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
    var bf = path.join(backupsDir(), e.backupId);
    if (fs.existsSync(bf)) { try { fs.unlinkSync(bf); } catch (err) {} }
  });
  writeAll(keep);
}

module.exports = { add, restore, forProject, clearProject };
