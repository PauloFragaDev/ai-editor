'use strict';

var START = '<<<BACKUP_START>>>';
var END   = '<<<BACKUP_END>>>';

function parseBackup(stdout) {
  var text = String(stdout || '');
  var si = text.indexOf(START);
  if (si < 0) return null;
  var ci = si + START.length;
  if (text[ci] === '\n') ci++;
  var ei = text.indexOf(END, ci);
  if (ei < 0) return null;
  return text.slice(ci, ei);
}

module.exports = { parseBackup };
