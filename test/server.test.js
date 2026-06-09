'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../server');

function mockSpawn(stdout) {
  return {
    spawnSync: function () {
      return { stdout: stdout, stderr: '', status: 0, signal: null, error: null };
    }
  };
}

function failSpawn(stderr) {
  return {
    spawnSync: function () {
      return { stdout: '', stderr: stderr, status: 1, signal: null, error: null };
    }
  };
}

describe('POST /edit', () => {
  it('returns 400 when html is missing', async () => {
    const app = createApp(mockSpawn('<p>ok</p>'));
    const res = await request(app)
      .post('/edit')
      .send({ instruction: 'make it red' });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  it('returns 400 when instruction is missing', async () => {
    const app = createApp(mockSpawn('<p>ok</p>'));
    const res = await request(app)
      .post('/edit')
      .send({ html: '<p>hello</p>' });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  it('returns 400 when body is empty', async () => {
    const app = createApp(mockSpawn('<p>ok</p>'));
    const res = await request(app).post('/edit').send({});
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  it('returns modified html from Claude', async () => {
    const modified = '<p style="color:red">hello</p>';
    const app = createApp(mockSpawn(modified));
    const res = await request(app)
      .post('/edit')
      .send({ html: '<p>hello</p>', instruction: 'make text red' });
    assert.equal(res.status, 200);
    assert.equal(res.body.html, modified);
  });

  it('strips ```html ... ``` code fences from Claude response', async () => {
    const wrapped = '```html\n<p style="color:red">hello</p>\n```';
    const app = createApp(mockSpawn(wrapped));
    const res = await request(app)
      .post('/edit')
      .send({ html: '<p>hello</p>', instruction: 'make text red' });
    assert.equal(res.status, 200);
    assert.equal(res.body.html, '<p style="color:red">hello</p>');
  });

  it('strips ``` ... ``` code fences without language tag', async () => {
    const wrapped = '```\n<p>changed</p>\n```';
    const app = createApp(mockSpawn(wrapped));
    const res = await request(app)
      .post('/edit')
      .send({ html: '<p>hello</p>', instruction: 'change it' });
    assert.equal(res.status, 200);
    assert.equal(res.body.html, '<p>changed</p>');
  });

  it('returns 500 when claude CLI fails', async () => {
    const app = createApp(failSpawn('authentication error'));
    const res = await request(app)
      .post('/edit')
      .send({ html: '<p>hello</p>', instruction: 'break it' });
    assert.equal(res.status, 500);
    assert.ok(res.body.error);
  });
});

const path = require('path');

function reportSpawn(stdout) {
  return {
    spawnSync: function () {
      return { stdout: stdout, stderr: '', status: 0, signal: null, error: null };
    }
  };
}

describe('POST /edit-source', () => {
  it('returns 400 when instruction is missing', async () => {
    const app = createApp(reportSpawn('{}'));
    const res = await request(app).post('/edit-source')
      .send({ url: { origin: 'http://localhost', pathname: '/ai-editor/' }, outerHTML: '<p>x</p>' });
    assert.equal(res.status, 400);
  });

  it('returns 422 fallbackToDom when project cannot be resolved', async () => {
    const app = createApp(reportSpawn('{ "status":"edited" }'));
    const res = await request(app).post('/edit-source')
      .send({ url: { origin: 'http://localhost', pathname: '/../../etc/' }, outerHTML: '<p>x</p>', instruction: 'do' });
    assert.equal(res.status, 422);
    assert.equal(res.body.fallbackToDom, true);
  });

  it('returns edited status with file, newHtml and hasBackup from report', async () => {
    const app = createApp(reportSpawn('{ "status":"edited", "file":"/var/www/html/ai-editor/inject.js", "newHtml":"<p>y</p>", "summary":"ok" }'));
    const res = await request(app).post('/edit-source')
      .send({ url: { origin: 'http://localhost', pathname: '/ai-editor/' }, outerHTML: '<p>x</p>', uniqueText: 'x', instruction: 'do' });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'edited');
    assert.equal(res.body.file, '/var/www/html/ai-editor/inject.js');
    assert.equal(res.body.newHtml, '<p>y</p>');
    assert.equal(typeof res.body.hasBackup, 'boolean');
  });

  it('returns 500 when claude CLI fails', async () => {
    const app = createApp(failSpawn('auth error'));
    const res = await request(app).post('/edit-source')
      .send({ url: { origin: 'http://localhost', pathname: '/ai-editor/' }, outerHTML: '<p>x</p>', uniqueText: 'x', instruction: 'do' });
    assert.equal(res.status, 500);
  });
});
