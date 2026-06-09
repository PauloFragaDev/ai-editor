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
