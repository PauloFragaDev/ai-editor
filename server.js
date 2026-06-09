'use strict';

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveProject } = require('./lib/resolve-project');
const { buildSourceEditPrompt } = require('./lib/build-prompt');
const { parseReport } = require('./lib/parse-report');
const { parseBackup } = require('./lib/parse-backup');
const backupStore    = require('./lib/backup-store');

function projectKeyFromUrl(url) {
  if (!url.origin || url.origin === 'null') {
    return (url.pathname || '').split('/').slice(0, 4).join('/');
  }
  return url.origin;
}

const PROMPT_PREFIX =
  'You are an HTML editor. The user provides an HTML snippet and an instruction. ' +
  'Return ONLY the modified HTML — no explanation, no markdown, no code blocks. ' +
  'Return raw HTML only.\n\n';

function stripCodeFences(text) {
  return text
    .replace(/^```(?:html)?\n?/i, '')
    .replace(/\n?```$/,           '')
    .trim();
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'projects.config.json'), 'utf-8'));
  } catch (e) {
    return { docRoot: '/var/www/html', routes: [] };
  }
}

function createApp(deps) {
  var spawn  = (deps && deps.spawnSync) || spawnSync;
  var config = (deps && deps.config)    || loadConfig();
  var store  = (deps && deps.backupStore) || backupStore;

  var app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  // ── POST /edit  (modo DOM-efímero, fallback) ─────────────────────────────
  app.post('/edit', function (req, res) {
    var body = req.body || {};
    var html = body.html;
    var instruction = body.instruction;

    if (!html || !instruction) {
      return res.status(400).json({ error: 'html and instruction are required' });
    }

    var prompt = PROMPT_PREFIX + 'HTML:\n' + html + '\n\nInstruction: ' + instruction;

    try {
      var proc = spawn('claude', ['-p', prompt], {
        encoding: 'utf-8',
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024
      });

      if (proc.error) {
        throw proc.error;
      }

      if (proc.status !== 0 || proc.signal) {
        var msg = (proc.stderr || '').trim() ||
          (proc.signal ? 'claude timed out' : 'claude exited with code ' + proc.status);
        throw new Error(msg);
      }

      var result = stripCodeFences(proc.stdout.trim());
      res.json({ html: result });
    } catch (err) {
      res.status(500).json({ error: err.message || 'claude CLI error' });
    }
  });

  // ── POST /edit-source  (edita el archivo fuente real) ────────────────────
  app.post('/edit-source', function (req, res) {
    var b = req.body || {};

    if (!b.instruction || (!b.outerHTML && !b.uniqueText)) {
      return res.status(400).json({ error: 'instruction and outerHTML/uniqueText are required' });
    }
    if (!b.url || !b.url.origin) {
      return res.status(400).json({ error: 'url is required' });
    }

    var resolved = resolveProject(b.url, config);
    if (!resolved.projectRoot) {
      return res.status(422).json({ error: 'could not resolve project root', fallbackToDom: true });
    }

    var prompt = buildSourceEditPrompt({
      projectRoot:   resolved.projectRoot,
      kind:          resolved.kind,
      url:           b.url,
      framework:     b.framework    || 'none',
      sourceHint:    b.sourceHint   || null,
      viteInspector: b.viteInspector || null,
      componentFile: b.componentFile || null,
      ancestors:     b.ancestors    || [],
      attrs:         b.attrs        || {},
      uniqueText:    b.uniqueText   || null,
      outerHTML:     b.outerHTML    || '',
      instruction:   b.instruction,
      confirmFile:   b.confirmFile
    });

    try {
      var proc = spawn('claude', [
        '-p', prompt,
        '--add-dir', resolved.projectRoot,
        '--allowedTools', 'Read,Grep,Glob,Edit',
        '--permission-mode', 'acceptEdits',
        '--model', 'sonnet'
      ], {
        cwd:       resolved.projectRoot,
        encoding:  'utf-8',
        timeout:   120000,
        maxBuffer: 10 * 1024 * 1024
      });

      if (proc.error) {
        throw proc.error;
      }

      if (proc.status !== 0 || proc.signal) {
        var msg2 = (proc.stderr || '').trim() ||
          (proc.signal ? 'claude timed out' : 'claude exited with code ' + proc.status);
        throw new Error(msg2);
      }

      var report = parseReport(proc.stdout);
      var backupId = null;
      if (report.status === 'edited' && report.file) {
        var backupContent = parseBackup(proc.stdout);
        if (backupContent !== null) {
          backupId = Date.now().toString(36) + Math.random().toString(36).slice(2);
          store.add(backupId, report.file, backupContent, {
            projectKey:  projectKeyFromUrl(b.url),
            instruction: (b.instruction || '').slice(0, 100),
            tag:         b.tag || '?',
            time:        new Date().toTimeString().slice(0, 5)
          });
        }
      }
      res.json(Object.assign({}, report, { backupId: backupId }));
    } catch (err) {
      res.status(500).json({ error: err.message || 'claude CLI error' });
    }
  });

  // ── GET /history  (historial de ediciones de un proyecto) ───────────────────
  app.get('/history', function (req, res) {
    var projectKey = req.query.projectKey || '';
    res.json(store.forProject(projectKey));
  });

  // ── DELETE /history  (limpiar historial y backups de un proyecto) ────────────
  app.delete('/history', function (req, res) {
    var projectKey = req.query.projectKey || '';
    store.clearProject(projectKey);
    res.json({ ok: true });
  });

  // ── POST /restore-backup  (restaura el archivo al estado previo a la edición) ─
  app.post('/restore-backup', function (req, res) {
    var b = req.body || {};
    if (!b.backupId) return res.status(400).json({ error: 'backupId required' });
    var result = store.restore(b.backupId);
    if (result.error) return res.status(404).json(result);
    res.json(result);
  });

  // ── GET /inject.js  (sirve el script para inyección manual o Tampermonkey) ─
  app.get('/inject.js', function (req, res) {
    res.setHeader('Content-Type', 'application/javascript');
    res.sendFile(path.join(__dirname, 'inject.js'));
  });

  // ── GET /userscript.user.js  (userscript de Tampermonkey) ────────────────
  app.get('/userscript.user.js', function (req, res) {
    res.setHeader('Content-Type', 'application/javascript');
    res.send([
      '// ==UserScript==',
      '// @name         AI Editor',
      '// @namespace    http://localhost:3333/',
      '// @version      1.2',
      '// @description  AI visual editor — auto-inject on localhost and local files',
      '// @match        http://localhost*',
      '// @match        http://127.0.0.1*',
      '// @match        file:///*',
      '// @grant        GM_xmlhttpRequest',
      '// @connect      localhost',
      '// ==/UserScript==',
      '(function() {',
      '  GM_xmlhttpRequest({',
      '    method: "GET",',
      '    url: "http://localhost:3333/inject.js?t=" + Date.now(),',
      '    onload: function(r) {',
      '      var s = document.createElement("script");',
      '      s.textContent = r.responseText;',
      '      (document.head || document.documentElement).appendChild(s);',
      '    }',
      '  });',
      '}());'
    ].join('\n'));
  });

  return app;
}

if (require.main === module) {
  var app = createApp();
  app.listen(3333, function () {
    console.log('[AI Editor] Server running on http://localhost:3333');
  });
}

module.exports = { createApp };
