'use strict';

const express = require('express');
const cors = require('cors');

const SYSTEM_PROMPT =
  'You are an HTML editor. The user provides an HTML snippet and an instruction. ' +
  'Return ONLY the modified HTML — no explanation, no markdown, no code blocks. ' +
  'Return raw HTML only.';

function stripCodeFences(text) {
  return text
    .replace(/^```(?:html)?\n?/i, '')
    .replace(/\n?```$/,           '')
    .trim();
}

function createApp(anthropic) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.post('/edit', async (req, res) => {
    const { html, instruction } = req.body || {};

    if (!html || !instruction) {
      return res.status(400).json({ error: 'html and instruction are required' });
    }

    const claudeCall = anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: `HTML:\n${html}\n\nInstruction: ${instruction}` }
      ]
    });

    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Request timed out after 30s')), 30_000)
    );

    try {
      const message = await Promise.race([claudeCall, timeout]);
      const result = stripCodeFences(message.content[0].text);
      res.json({ html: result });
    } catch (err) {
      claudeCall.catch(() => {}); // silence dangling rejection if timeout won the race
      res.status(500).json({ error: err.message || 'Claude API error' });
    }
  });

  return app;
}

if (require.main === module) {
  const Anthropic = require('@anthropic-ai/sdk');
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const app = createApp(anthropic);
  app.listen(3333, () =>
    console.log('[AI Editor] Server running on http://localhost:3333')
  );
}

module.exports = { createApp };
