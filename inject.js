(function () {
  'use strict';

  if (window.__aieLoaded) { console.log('[AI Editor] Ya está inyectado.'); return; }
  window.__aieLoaded = true;

  // Reentrada automática tras recarga de página (modo edición persistente)
  if (sessionStorage.getItem('__aie_reenter') === '1') {
    sessionStorage.removeItem('__aie_reenter');
    window.addEventListener('load', function () { enterEditMode(); });
  }

  // ── State ────────────────────────────────────────────────────────────────
  var editMode  = false;
  var selectedEl = null;
  var backupHTML = null;
  var panelEl   = null;
  var hoveredEl  = null;
  var badgeEl   = null;

  var SERVER_URL = 'http://localhost:3333/edit';
  var SOURCE_URL = 'http://localhost:3333/edit-source';

  // ── Helpers ──────────────────────────────────────────────────────────────
  function isEditorNode(el) {
    if (!el) return false;
    if (panelEl && (el === panelEl || panelEl.contains(el))) return true;
    if (badgeEl && (el === badgeEl || badgeEl.contains(el))) return true;
    return false;
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Evidence collection ──────────────────────────────────────────────────
  function collectFrameworkHint(el) {
    var out = { framework: 'none', sourceHint: null, componentFile: null, viteInspector: null };
    try {
      var insp = el.closest && el.closest('[data-v-inspector]');
      if (insp) { out.framework = 'vue'; out.viteInspector = insp.getAttribute('data-v-inspector'); }

      var node = el;
      while (node && !out.componentFile) {
        var vc = node.__vueParentComponent;
        if (vc && vc.type && vc.type.__file) { out.framework = 'vue'; out.componentFile = vc.type.__file; break; }
        node = node.parentElement;
      }

      var key = Object.keys(el).find(function (k) { return k.indexOf('__reactFiber$') === 0; });
      if (key) {
        if (out.framework === 'none') { out.framework = 'react'; }
        var fiber = el[key];
        while (fiber) {
          if (fiber._debugSource) {
            var s = fiber._debugSource;
            out.sourceHint = { fileName: s.fileName, lineNumber: s.lineNumber, columnNumber: s.columnNumber };
            break;
          }
          fiber = fiber.return;
        }
      }
    } catch (e) { /* nunca romper el editor por un hint */ }
    return out;
  }

  function buildAncestors(el) {
    var chain = [], node = el.parentElement, depth = 0;
    while (node && node !== document.body && depth < 5) {
      var sel = node.tagName.toLowerCase();
      if (node.id) { sel += '#' + node.id; }
      else if (node.className && typeof node.className === 'string') {
        sel += '.' + node.className.trim().split(/\s+/).slice(0, 2).join('.');
      }
      chain.unshift(sel);
      node = node.parentElement; depth++;
    }
    return chain;
  }

  function pickUniqueText(el) {
    var txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!txt) { return null; }
    return txt.length > 80 ? txt.slice(0, 80) : txt;
  }

  function buildEvidence(el, instruction) {
    var hint = collectFrameworkHint(el);
    var attrs = {};
    if (el.id) { attrs.id = el.id; }
    if (el.className && typeof el.className === 'string') { attrs['class'] = el.className; }
    return {
      url: { origin: location.origin, pathname: location.pathname, href: location.href },
      framework: hint.framework, sourceHint: hint.sourceHint,
      viteInspector: hint.viteInspector, componentFile: hint.componentFile,
      outerHTML: (el.outerHTML || '').slice(0, 4096),
      ancestors: buildAncestors(el), uniqueText: pickUniqueText(el),
      attrs: attrs, instruction: instruction
    };
  }

  // ── Badge ────────────────────────────────────────────────────────────────
  function createBadge() {
    var el = document.createElement('div');
    el.textContent = 'EDIT MODE';
    el.style.cssText = [
      'position:fixed', 'top:16px', 'right:16px',
      'z-index:2147483647', 'background:#3b82f6', 'color:#fff',
      'font-family:monospace', 'font-size:11px', 'font-weight:700',
      'padding:4px 10px', 'border-radius:4px', 'pointer-events:none',
      'letter-spacing:1px', 'user-select:none'
    ].join(';');
    return el;
  }

  // ── Panel ────────────────────────────────────────────────────────────────
  function createPanel(html) {
    var panel = document.createElement('div');
    panel.style.cssText = [
      'position:fixed', 'bottom:24px', 'right:24px',
      'z-index:2147483647', 'width:360px', 'max-height:80vh',
      'background:#fff', 'border-radius:12px',
      'box-shadow:0 8px 32px rgba(0,0,0,0.18)',
      'display:flex', 'flex-direction:column',
      'font-family:-apple-system,BlinkMacSystemFont,sans-serif',
      'overflow:hidden', 'box-sizing:border-box'
    ].join(';');

    panel.innerHTML =
      '<div style="padding:12px 16px;border-bottom:1px solid #e5e7eb;' +
        'display:flex;justify-content:space-between;align-items:center">' +
        '<span style="font-weight:600;font-size:14px;color:#111827">AI Editor</span>' +
        '<button id="__aie_close" style="background:none;border:none;cursor:pointer;' +
          'font-size:20px;color:#6b7280;line-height:1;padding:0">&times;</button>' +
      '</div>' +
      '<div style="overflow-y:auto;padding:12px 16px;flex:1">' +
        '<details style="margin-bottom:10px">' +
          '<summary style="cursor:pointer;font-size:12px;color:#6b7280;' +
            'user-select:none;list-style:none">&#9654; HTML actual</summary>' +
          '<pre style="font-size:11px;background:#f9fafb;border:1px solid #e5e7eb;' +
            'border-radius:6px;padding:8px;overflow-x:auto;white-space:pre-wrap;' +
            'word-break:break-all;margin:6px 0 0;max-height:160px;overflow-y:auto">' +
            escapeHtml(html) + '</pre>' +
        '</details>' +
        '<textarea id="__aie_instruction" placeholder="\xBFQu\xe9 cambio necesitas?" ' +
          'style="width:100%;box-sizing:border-box;height:80px;padding:8px;' +
          'border:1px solid #d1d5db;border-radius:6px;font-size:13px;' +
          'resize:vertical;outline:none;font-family:inherit;' +
          'transition:border-color .15s"></textarea>' +
        '<div id="__aie_msg" style="font-size:12px;margin-top:6px;display:none"></div>' +
      '</div>' +
      '<div style="padding:10px 16px;border-top:1px solid #e5e7eb;' +
        'display:flex;gap:8px;align-items:center">' +
        '<button id="__aie_undo" style="display:none;padding:7px 14px;' +
          'background:#f3f4f6;color:#374151;border:1px solid #d1d5db;' +
          'border-radius:6px;font-size:13px;cursor:pointer;white-space:nowrap">' +
          'Deshacer</button>' +
        '<button id="__aie_apply" style="flex:1;padding:7px 14px;' +
          'background:#3b82f6;color:#fff;border:none;border-radius:6px;' +
          'font-size:13px;font-weight:500;cursor:pointer">' +
          'Aplicar</button>' +
      '</div>';

    return panel;
  }

  // ── Open / Close panel ───────────────────────────────────────────────────
  function openPanel(el) {
    closePanel();
    backupHTML = null;
    selectedEl = el;
    panelEl = createPanel(el.outerHTML);
    document.body.appendChild(panelEl);

    var closeBtn = panelEl.querySelector('#__aie_close');
    var applyBtn = panelEl.querySelector('#__aie_apply');
    var undoBtn  = panelEl.querySelector('#__aie_undo');
    var inputEl  = panelEl.querySelector('#__aie_instruction');
    var msgEl    = panelEl.querySelector('#__aie_msg');

    closeBtn.addEventListener('click', closePanel);

    // Focus textarea (tiny delay so paint completes first)
    setTimeout(function () { inputEl.focus(); }, 40);

    // ── Panel helpers ──────────────────────────────────────────────────────
    function showMsg(text, color) {
      msgEl.textContent = text;
      msgEl.style.color = color || '#374151';
      msgEl.style.display = 'block';
    }

    function hideMsg() {
      msgEl.style.display = 'none';
    }

    function resetApplyBtn() {
      applyBtn.disabled = false;
      applyBtn.textContent = 'Aplicar';
      inputEl.readOnly = false;
    }

    // Aplica el HTML recibido directamente al DOM (fallback efímero)
    function applyHtmlToDom(newHtml) {
      var tmp = document.createElement('div');
      tmp.innerHTML = newHtml;
      var newEl = tmp.firstElementChild || tmp.firstChild;
      if (!newEl) {
        showMsg('La IA devolvió una respuesta vacía. Intenta de nuevo.', '#ef4444');
        resetApplyBtn();
        return;
      }
      backupHTML = selectedEl.outerHTML;
      if (hoveredEl === selectedEl) { hoveredEl = null; }
      if (tmp.children.length > 1) {
        selectedEl.replaceWith.apply(selectedEl, Array.prototype.slice.call(tmp.childNodes));
        selectedEl = tmp.childNodes[0] || newEl;
      } else {
        selectedEl.replaceWith(newEl);
        selectedEl = newEl;
      }
      inputEl.value = '';
      undoBtn.style.display = '';
      resetApplyBtn();
      inputEl.focus();
    }

    // Fallback: llama a /edit y aplica al DOM
    function domFallback(evidence) {
      showMsg('Editando en pantalla (modo temporal)…', '#6b7280');
      fetch(SERVER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: evidence.outerHTML, instruction: evidence.instruction })
      })
      .then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, body: j }; });
      })
      .then(function (res) {
        if (!res.ok) { throw new Error(res.body.error || 'Error del servidor'); }
        hideMsg();
        applyHtmlToDom(res.body.html);
      })
      .catch(function (err) {
        showMsg(err.message || 'Error al aplicar el cambio.', '#ef4444');
        resetApplyBtn();
      });
    }

    // Muestra lista de archivos candidatos para que el usuario elija
    function renderCandidates(candidates, evidence) {
      msgEl.innerHTML = '';
      msgEl.style.display = 'block';
      msgEl.style.color = '#374151';

      var label = document.createElement('div');
      label.style.cssText = 'font-size:12px;margin-bottom:6px';
      label.textContent = 'Ambiguo — elige el archivo a editar:';
      msgEl.appendChild(label);

      candidates.forEach(function (c) {
        var btn = document.createElement('button');
        btn.textContent = c.split('/').slice(-2).join('/'); // mostrar solo últimas 2 partes
        btn.title = c;
        btn.style.cssText = 'display:block;width:100%;text-align:left;padding:4px 8px;' +
          'margin-bottom:4px;border:1px solid #d1d5db;border-radius:4px;' +
          'background:#f9fafb;cursor:pointer;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        btn.addEventListener('click', function () {
          hideMsg();
          applyBtn.disabled = true;
          applyBtn.textContent = 'Editando archivo fuente…';
          var ev2 = Object.assign({}, evidence, { confirmFile: c });
          fetch(SOURCE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ev2)
          })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); })
          .then(function (res) {
            if (!res.ok) { throw new Error(res.body.error || 'Error del servidor'); }
            if (res.body.status === 'edited') {
              sessionStorage.setItem('__aie_reenter', '1');
              location.reload();
            } else {
              showMsg('No se pudo editar el archivo seleccionado.', '#ef4444');
              resetApplyBtn();
            }
          })
          .catch(function (err) {
            showMsg(err.message || 'Error al editar.', '#ef4444');
            resetApplyBtn();
          });
        });
        msgEl.appendChild(btn);
      });
    }

    // ── Apply ──────────────────────────────────────────────────────────────
    applyBtn.addEventListener('click', function () {
      var instruction = inputEl.value.trim();
      if (!instruction) { inputEl.focus(); return; }

      applyBtn.disabled = true;
      applyBtn.textContent = 'Editando archivo fuente…';
      inputEl.readOnly = true;
      hideMsg();

      var evidence = buildEvidence(selectedEl, instruction);

      fetch(SOURCE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(evidence)
      })
      .then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; });
      })
      .then(function (res) {
        if (res.status === 422 && res.body.fallbackToDom) {
          inputEl.readOnly = false;
          return domFallback(evidence);
        }
        if (!res.ok) { throw new Error(res.body.error || 'Error ' + res.status); }

        var rep = res.body;
        if (rep.status === 'edited') {
          if (rep.affectsMultiple) {
            showMsg('Plantilla/loop reutilizado (' + rep.file + '). El cambio afectar\xe1 a todas sus instancias. Recargando…', '#92400e');
            setTimeout(function () {
              sessionStorage.setItem('__aie_reenter', '1');
              location.reload();
            }, 2000);
          } else {
            sessionStorage.setItem('__aie_reenter', '1');
            location.reload();
          }
        } else if (rep.status === 'ambiguous') {
          inputEl.readOnly = false;
          resetApplyBtn();
          renderCandidates(rep.candidates || [], evidence);
        } else {
          // not_found
          inputEl.readOnly = false;
          resetApplyBtn();
          showMsg('No se localiz\xf3 el archivo fuente.', '#ef4444');
          var fbBtn = document.createElement('button');
          fbBtn.textContent = 'Editar solo en pantalla (temporal)';
          fbBtn.style.cssText = 'margin-top:6px;padding:4px 10px;border:1px solid #d1d5db;' +
            'border-radius:4px;background:#f3f4f6;cursor:pointer;font-size:12px;display:block';
          fbBtn.addEventListener('click', function () {
            fbBtn.remove();
            applyBtn.disabled = true;
            applyBtn.textContent = 'Consultando IA…';
            inputEl.readOnly = true;
            hideMsg();
            domFallback(evidence);
          });
          msgEl.appendChild(fbBtn);
        }
      })
      .catch(function (err) {
        showMsg('Error: ' + (err.message || 'fallo desconocido') + '. Revisa con git si el archivo qued\xf3 a medias.', '#ef4444');
        inputEl.readOnly = false;
        resetApplyBtn();
      });
    });

    // ── Undo ───────────────────────────────────────────────────────────────
    undoBtn.addEventListener('click', function () {
      if (!backupHTML) return;
      var tmp = document.createElement('div');
      tmp.innerHTML = backupHTML;
      var restored = tmp.firstElementChild || tmp.firstChild;
      selectedEl.replaceWith(restored);
      selectedEl = restored;
      backupHTML = null;
      undoBtn.style.display = 'none';
    });
  }

  function closePanel() {
    if (panelEl) { panelEl.remove(); panelEl = null; }
    selectedEl = null;
  }

  // ── Edit mode on/off ─────────────────────────────────────────────────────
  function enterEditMode() {
    editMode = true;
    badgeEl = createBadge();
    document.body.appendChild(badgeEl);
  }

  function exitEditMode() {
    editMode = false;
    if (badgeEl)   { badgeEl.remove();  badgeEl = null; }
    if (hoveredEl) { hoveredEl.style.outline = ''; hoveredEl = null; }
    backupHTML = null;
    closePanel();
  }

  // ── Global event listeners ───────────────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    if (e.repeat) return;
    if (e.altKey && (e.key === 'e' || e.key === 'E')) {
      e.preventDefault();
      editMode ? exitEditMode() : enterEditMode();
      return;
    }
    if (e.key === 'Escape') {
      exitEditMode();
    }
  });

  document.addEventListener('mouseover', function (e) {
    if (!editMode || isEditorNode(e.target)) return;
    if (hoveredEl && hoveredEl !== e.target) {
      hoveredEl.style.outline = '';
    }
    hoveredEl = e.target;
    hoveredEl.style.outline = '2px solid #3b82f6';
  });

  document.addEventListener('mouseout', function (e) {
    if (!editMode || isEditorNode(e.target)) return;
    if (e.target === hoveredEl) {
      e.target.style.outline = '';
      hoveredEl = null;
    }
  });

  // Capture phase so we intercept before link/button default actions
  document.addEventListener('click', function (e) {
    if (!editMode || isEditorNode(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    openPanel(e.target);
  }, true);

  console.log('[AI Editor] Inyectado. Alt+E para activar el modo edici\xf3n.');
}());
