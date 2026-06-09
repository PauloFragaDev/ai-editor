'use strict';

const express = require('express');
const cors = require('cors');
const { spawnSync } = require('child_process');

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

function createApp(deps) {
  var spawn = (deps && deps.spawnSync) || spawnSync;

  var app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

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

  return app;
}

if (require.main === module) {
  var app = createApp();
  app.listen(3333, function () {
    console.log('[AI Editor] Server running on http://localhost:3333');
  });
}

module.exports = { createApp };
