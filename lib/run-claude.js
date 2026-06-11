'use strict';
const { spawn } = require('child_process');

// Ejecuta un proceso y resuelve con la MISMA forma que spawnSync devolvía:
// { status, signal, stdout, stderr, error }. Nunca rechaza la promesa.
function runClaude(args, opts) {
  opts = opts || {};
  var cmd = opts.command || 'claude';
  return new Promise(function (resolve) {
    var out = '', err = '', done = false, timer = null, child;

    function finish(res) {
      if (done) return;
      done = true;
      if (timer) { clearTimeout(timer); timer = null; }
      resolve(res);
    }

    try {
      child = spawn(cmd, args, { cwd: opts.cwd, env: process.env });
    } catch (e) {
      return finish({ status: null, signal: null, stdout: '', stderr: '', error: e });
    }

    child.stdout.on('data', function (d) { out += d; });
    child.stderr.on('data', function (d) { err += d; });
    child.on('error', function (e) {
      finish({ status: null, signal: null, stdout: out, stderr: err, error: e });
    });
    child.on('close', function (code, signal) {
      finish({ status: code, signal: signal, stdout: out, stderr: err, error: null });
    });

    if (opts.timeout) {
      timer = setTimeout(function () {
        try { child.kill('SIGTERM'); } catch (e) {}
        finish({ status: null, signal: 'SIGTERM', stdout: out, stderr: err, error: null });
      }, opts.timeout);
    }
  });
}

module.exports = { runClaude };
