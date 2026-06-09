(function () {
  'use strict';

  if (window.__aieLoaded) { console.log('[AI Editor] Ya está inyectado.'); return; }
  window.__aieLoaded = true;

  // Reentrada automática tras recarga de página
  if (sessionStorage.getItem('__aie_reenter') === '1') {
    sessionStorage.removeItem('__aie_reenter');
    window.addEventListener('load', function () { enterEditMode(); });
  }

  // ── State ────────────────────────────────────────────────────────────────
  var editMode         = false;
  var selectedEl       = null;
  var backupHTML       = null;
  var panelEl          = null;
  var hoveredEl        = null;
  var badgeEl          = null;
  var toolbarEl        = null;
  var historyEl        = null;
  var historyCollapsed = false;
  var selectionMode    = 'element'; // 'element' | 'area'
  var sessionHistory   = [];
  var areaDragging          = false;
  var areaStartX            = 0;
  var areaStartY            = 0;
  var areaOverlay           = null;  // overlay temporal mientras se arrastra
  var selectionIndicatorEl  = null;  // indicador fijo tras soltar el ratón

  var SERVER_URL  = 'http://localhost:3333/edit';
  var SOURCE_URL  = 'http://localhost:3333/edit-source';
  var HISTORY_URL = 'http://localhost:3333/history';

  function historyQS() {
    return '?origin=' + encodeURIComponent(location.origin) +
           '&pathname=' + encodeURIComponent(location.pathname);
  }

  function reloadPage() {
    sessionStorage.setItem('__aie_reenter', '1');
    location.reload();
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  function isEditorNode(el) {
    if (!el) return false;
    if (panelEl   && (el === panelEl   || panelEl.contains(el)))   return true;
    if (badgeEl   && (el === badgeEl   || badgeEl.contains(el)))   return true;
    if (toolbarEl && (el === toolbarEl || toolbarEl.contains(el))) return true;
    if (historyEl && (el === historyEl || historyEl.contains(el))) return true;
    return false;
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function makeDraggable(el) {
    var dragging = false, ox = 0, oy = 0;
    el.addEventListener('mousedown', function (e) {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true;
      ox = e.clientX - el.getBoundingClientRect().left;
      oy = e.clientY - el.getBoundingClientRect().top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var x = Math.max(0, Math.min(window.innerWidth  - el.offsetWidth,  e.clientX - ox));
      var y = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, e.clientY - oy));
      el.style.left   = x + 'px';
      el.style.top    = y + 'px';
      el.style.right  = 'auto';
      el.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', function () { dragging = false; });
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
      attrs: attrs, instruction: instruction,
      tag: (el.tagName || '?').toLowerCase()
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

  // ── Toolbar ──────────────────────────────────────────────────────────────
  function createToolbar() {
    var bar = document.createElement('div');
    bar.style.cssText = [
      'position:fixed', 'top:16px', 'left:50%', 'transform:translateX(-50%)',
      'z-index:2147483647', 'background:#1f2937', 'border-radius:8px',
      'box-shadow:0 4px 16px rgba(0,0,0,0.3)',
      'display:flex', 'align-items:center', 'gap:4px', 'padding:6px 8px',
      'font-family:-apple-system,BlinkMacSystemFont,sans-serif',
      'user-select:none', 'cursor:move'
    ].join(';');

    function btnStyle(active) {
      return 'padding:5px 12px;border:none;border-radius:5px;font-size:12px;' +
        'font-weight:500;cursor:pointer;' +
        (active ? 'background:#3b82f6;color:#fff' : 'background:#374151;color:#d1d5db');
    }

    bar.innerHTML =
      '<button id="__aie_mode_el" style="' + btnStyle(true)  + '">⬚ Elemento</button>' +
      '<button id="__aie_mode_ar" style="' + btnStyle(false) + '">▦ \xC1rea</button>' +
      '<div style="width:1px;background:#4b5563;margin:0 4px;align-self:stretch"></div>' +
      '<button id="__aie_tb_close" style="background:none;border:none;color:#9ca3af;' +
        'font-size:18px;cursor:pointer;padding:0 4px;line-height:1">&times;</button>';

    var btnEl = bar.querySelector('#__aie_mode_el');
    var btnAr = bar.querySelector('#__aie_mode_ar');

    function updateModes() {
      btnEl.style.cssText = btnStyle(selectionMode === 'element');
      btnAr.style.cssText = btnStyle(selectionMode === 'area');
      document.body.style.cursor = selectionMode === 'area' ? 'crosshair' : '';
    }

    btnEl.addEventListener('click', function () { selectionMode = 'element'; updateModes(); });
    btnAr.addEventListener('click', function () { selectionMode = 'area';    updateModes(); });
    bar.querySelector('#__aie_tb_close').addEventListener('click', exitEditMode);

    makeDraggable(bar);
    return bar;
  }

  // ── History panel ────────────────────────────────────────────────────────
  function renderHistory(panel) {
    if (!panel) return;
    panel.innerHTML =
      '<div style="padding:10px 12px;background:#f9fafb;border-bottom:1px solid #e5e7eb;' +
        'display:flex;align-items:center;gap:6px;cursor:move">' +
        '<span style="font-size:12px;font-weight:600;color:#374151;flex:1">Historial</span>' +
        '<button id="__aie_hist_clear" style="font-size:11px;padding:2px 8px;' +
          'border:1px solid #d1d5db;border-radius:4px;background:#fff;cursor:pointer;color:#6b7280">Limpiar</button>' +
        '<button id="__aie_hist_toggle" style="background:none;border:none;cursor:pointer;' +
          'color:#6b7280;font-size:13px;padding:0 2px">' + (historyCollapsed ? '▼' : '▲') + '</button>' +
        '<button id="__aie_hist_close" style="background:none;border:none;cursor:pointer;' +
          'color:#9ca3af;font-size:18px;padding:0 2px;line-height:1">&times;</button>' +
      '</div>' +
      (historyCollapsed ? '' :
        '<div style="max-height:180px;overflow-y:auto;padding:8px 12px">' +
          (sessionHistory.length === 0
            ? '<div style="font-size:12px;color:#9ca3af;text-align:center;padding:10px 0">Sin cambios a\xFAn</div>'
            : sessionHistory.map(function (e, i) {
                return '<div style="font-size:11px;padding:4px 0;border-bottom:1px solid #f3f4f6;' +
                  'display:flex;align-items:center;gap:4px">' +
                  '<span style="color:#9ca3af;white-space:nowrap">' + e.time + '</span>' +
                  '<span style="color:#6b7280;white-space:nowrap">&lt;' + e.tag + '&gt;</span>' +
                  '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escapeHtml(e.instruction) + '">' + escapeHtml(e.instruction) + '</span>' +
                  (e.backupId && e.hasBackup ? '<button data-revert="' + i + '" style="flex-shrink:0;font-size:10px;padding:1px 5px;' +
                    'border:1px solid #fca5a5;border-radius:3px;background:#fff;cursor:pointer;' +
                    'color:#dc2626;white-space:nowrap" title="Deshacer cambio en: ' + escapeHtml(e.file || '') + '">&#8617; deshacer</button>' : '') +
                  '</div>';
              }).join('')
          ) +
        '</div>'
      ) +
      '<div style="padding:8px 12px;border-top:1px solid #e5e7eb">' +
        '<button id="__aie_hist_undo" ' + (backupHTML ? '' : 'disabled ') +
          'style="width:100%;padding:6px;background:#f3f4f6;color:#374151;' +
          'border:1px solid #d1d5db;border-radius:6px;font-size:12px;cursor:pointer;' +
          (backupHTML ? '' : 'opacity:0.45;') + '">' +
          '↩ Deshacer \xFAltimo cambio</button>' +
      '</div>';

    panel.querySelectorAll('[data-revert]').forEach(function (btn) {
      var idx = parseInt(btn.getAttribute('data-revert'), 10);
      var entry = sessionHistory[idx];
      if (entry && entry.backupId) {
        btn.addEventListener('click', function () {
          restoreBackup(entry.backupId, (entry.file || '').split('/').slice(-1)[0] || 'archivo');
        });
      }
    });
    panel.querySelector('#__aie_hist_clear').addEventListener('click', function () {
      fetch(HISTORY_URL + historyQS(), { method: 'DELETE' })
        .catch(function () {});
      sessionHistory = [];
      renderHistory(panel);
    });
    panel.querySelector('#__aie_hist_toggle').addEventListener('click', function () {
      historyCollapsed = !historyCollapsed; renderHistory(panel);
    });
    panel.querySelector('#__aie_hist_close').addEventListener('click', function () {
      panel.remove(); historyEl = null;
    });
    panel.querySelector('#__aie_hist_undo').addEventListener('click', function () {
      if (backupHTML) { doUndo(); }
    });
  }

  function createHistoryPanel() {
    var panel = document.createElement('div');
    panel.style.cssText = [
      'position:fixed', 'bottom:24px', 'left:24px',
      'z-index:2147483647', 'width:300px',
      'background:#fff', 'border-radius:12px',
      'box-shadow:0 8px 32px rgba(0,0,0,0.18)',
      'font-family:-apple-system,BlinkMacSystemFont,sans-serif',
      'overflow:hidden', 'box-sizing:border-box'
    ].join(';');
    renderHistory(panel);
    makeDraggable(panel);
    return panel;
  }

  function addHistoryEntry(el, instruction, file, backupId, hasBackup) {
    var now  = new Date();
    var time = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    sessionHistory.push({ time: time, tag: (el.tagName || '?').toLowerCase(), instruction: instruction.slice(0, 50), file: file || null, backupId: backupId || null, hasBackup: !!hasBackup });
    if (historyEl) { renderHistory(historyEl); }
  }

  function restoreBackup(backupId, filename) {
    if (!confirm('Deshacer el cambio en "' + filename + '"?\nSe restaurar\xE1 el contenido anterior del archivo.')) return;
    fetch('http://localhost:3333/restore-backup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ backupId: backupId })
    })
    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
    .then(function (res) {
      if (res.ok && res.body.ok) { reloadPage(); }
      else { alert('No se pudo restaurar.\n' + (res.body.error || 'Error desconocido')); }
    })
    .catch(function (err) { alert('Error: ' + err.message); });
  }

  // ── Undo ─────────────────────────────────────────────────────────────────
  function doUndo() {
    if (!backupHTML || !selectedEl) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = backupHTML;
    var restored = tmp.firstElementChild || tmp.firstChild;
    if (restored) { selectedEl.replaceWith(restored); selectedEl = restored; }
    backupHTML = null;
    if (historyEl) { renderHistory(historyEl); }
    if (panelEl) {
      var btn = panelEl.querySelector('#__aie_undo');
      if (btn) { btn.style.display = 'none'; }
    }
  }

  // ── Area selection ───────────────────────────────────────────────────────
  function findContainingElement(x1, y1, x2, y2) {
    var seen = [], best = null, bestArea = Infinity;
    [[x1,y1],[x2,y1],[x1,y2],[x2,y2]].forEach(function (pt) {
      (document.elementsFromPoint(pt[0], pt[1]) || []).forEach(function (el) {
        if (!isEditorNode(el) && el !== document.body && el !== document.documentElement && seen.indexOf(el) < 0) {
          seen.push(el);
        }
      });
    });
    seen.forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.left <= x1 && r.top <= y1 && r.right >= x2 && r.bottom >= y2) {
        var area = r.width * r.height;
        if (area < bestArea) { bestArea = area; best = el; }
      }
    });
    return best;
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
        '<button id="__aie_undo" style="display:' + (backupHTML ? '' : 'none') + ';padding:7px 14px;' +
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
    selectedEl = el;
    panelEl = createPanel(el.outerHTML);
    document.body.appendChild(panelEl);

    var closeBtn = panelEl.querySelector('#__aie_close');
    var applyBtn = panelEl.querySelector('#__aie_apply');
    var undoBtn  = panelEl.querySelector('#__aie_undo');
    var inputEl  = panelEl.querySelector('#__aie_instruction');
    var msgEl    = panelEl.querySelector('#__aie_msg');

    closeBtn.addEventListener('click', closePanel);
    setTimeout(function () { inputEl.focus(); }, 40);

    function showMsg(text, color) {
      msgEl.textContent = text; msgEl.style.color = color || '#374151'; msgEl.style.display = 'block';
    }
    function hideMsg() { msgEl.style.display = 'none'; }
    function resetApplyBtn() { applyBtn.disabled = false; applyBtn.textContent = 'Aplicar'; inputEl.readOnly = false; }

    function repositionIndicator() {
      if (!selectionIndicatorEl || !selectedEl) { return; }
      var r = selectedEl.getBoundingClientRect();
      selectionIndicatorEl.style.left   = r.left + 'px';
      selectionIndicatorEl.style.top    = r.top + 'px';
      selectionIndicatorEl.style.width  = r.width + 'px';
      selectionIndicatorEl.style.height = r.height + 'px';
    }

    function applyHtmlToDom(newHtml) {
      var tmp = document.createElement('div');
      tmp.innerHTML = newHtml;
      var newEl = tmp.firstElementChild || tmp.firstChild;
      if (!newEl) { showMsg('La IA devolvió una respuesta vacía.', '#ef4444'); resetApplyBtn(); return; }
      backupHTML = selectedEl.outerHTML;
      if (hoveredEl === selectedEl) { hoveredEl = null; }
      if (tmp.children.length > 1) {
        selectedEl.replaceWith.apply(selectedEl, Array.prototype.slice.call(tmp.childNodes));
        selectedEl = tmp.childNodes[0] || newEl;
      } else {
        selectedEl.replaceWith(newEl);
        selectedEl = newEl;
      }
      undoBtn.style.display = '';
      if (historyEl) { renderHistory(historyEl); }
      inputEl.value = ''; resetApplyBtn(); inputEl.focus();
    }

    function domFallback(evidence) {
      showMsg('Editando en pantalla (modo temporal)…', '#6b7280');
      fetch(SERVER_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: evidence.outerHTML, instruction: evidence.instruction })
      })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (!res.ok) { throw new Error(res.body.error || 'Error del servidor'); }
        hideMsg(); applyHtmlToDom(res.body.html);
      })
      .catch(function (err) { showMsg(err.message || 'Error al aplicar.', '#ef4444'); resetApplyBtn(); });
    }

    function renderCandidates(candidates, evidence) {
      msgEl.innerHTML = ''; msgEl.style.display = 'block'; msgEl.style.color = '#374151';
      var label = document.createElement('div');
      label.style.cssText = 'font-size:12px;margin-bottom:6px';
      label.textContent = 'Ambiguo — elige el archivo a editar:';
      msgEl.appendChild(label);
      candidates.forEach(function (c) {
        var btn = document.createElement('button');
        btn.textContent = c.split('/').slice(-2).join('/'); btn.title = c;
        btn.style.cssText = 'display:block;width:100%;text-align:left;padding:4px 8px;margin-bottom:4px;' +
          'border:1px solid #d1d5db;border-radius:4px;background:#f9fafb;cursor:pointer;' +
          'font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        btn.addEventListener('click', function () {
          hideMsg(); applyBtn.disabled = true; applyBtn.textContent = 'Editando archivo fuente…';
          var ev2 = Object.assign({}, evidence, { confirmFile: c });
          fetch(SOURCE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ev2) })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
          .then(function (res) {
            if (!res.ok) { throw new Error(res.body.error || 'Error'); }
            if (res.body.status === 'edited') {
              addHistoryEntry(selectedEl, evidence.instruction, res.body.file, res.body.backupId, res.body.hasBackup);
              if (res.body.newHtml) {
                applyHtmlToDom(res.body.newHtml);
                repositionIndicator();
                if (res.body.affectsMultiple) {
                  showMsg('Guardado · plantilla compartida (afecta otras p\xE1ginas)', '#92400e');
                } else {
                  showMsg('Editado ✓ (archivo guardado)', '#059669');
                  setTimeout(hideMsg, 2500);
                }
              } else {
                reloadPage();
              }
            } else { showMsg('No se pudo editar.', '#ef4444'); resetApplyBtn(); }
          })
          .catch(function (err) { showMsg(err.message || 'Error.', '#ef4444'); resetApplyBtn(); });
        });
        msgEl.appendChild(btn);
      });
    }

    applyBtn.addEventListener('click', function () {
      var instruction = inputEl.value.trim();
      if (!instruction) { inputEl.focus(); return; }
      applyBtn.disabled = true; applyBtn.textContent = 'Editando archivo fuente…';
      inputEl.readOnly = true; hideMsg();
      var evidence = buildEvidence(selectedEl, instruction);
      fetch(SOURCE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(evidence) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); })
      .then(function (res) {
        if (res.status === 422 && res.body.fallbackToDom) { inputEl.readOnly = false; return domFallback(evidence); }
        if (!res.ok) { throw new Error(res.body.error || 'Error ' + res.status); }
        var rep = res.body;
        if (rep.status === 'edited') {
          addHistoryEntry(selectedEl, instruction, rep.file, rep.backupId, rep.hasBackup);
          if (rep.newHtml) {
            applyHtmlToDom(rep.newHtml);
            repositionIndicator();
            if (rep.affectsMultiple) {
              showMsg('Guardado · plantilla compartida (afecta otras p\xE1ginas)', '#92400e');
            } else {
              showMsg('Editado ✓ (archivo guardado)', '#059669');
              setTimeout(hideMsg, 2500);
            }
          } else {
            reloadPage();
          }
        } else if (rep.status === 'ambiguous') {
          inputEl.readOnly = false; resetApplyBtn(); renderCandidates(rep.candidates || [], evidence);
        } else {
          inputEl.readOnly = false; resetApplyBtn();
          showMsg('No se localiz\xF3 el archivo fuente.', '#ef4444');
          var fbBtn = document.createElement('button');
          fbBtn.textContent = 'Editar solo en pantalla (temporal)';
          fbBtn.style.cssText = 'margin-top:6px;padding:4px 10px;border:1px solid #d1d5db;' +
            'border-radius:4px;background:#f3f4f6;cursor:pointer;font-size:12px;display:block';
          fbBtn.addEventListener('click', function () {
            fbBtn.remove(); applyBtn.disabled = true; applyBtn.textContent = 'Consultando IA…';
            inputEl.readOnly = true; hideMsg(); domFallback(evidence);
          });
          msgEl.appendChild(fbBtn);
        }
      })
      .catch(function (err) {
        showMsg('Error: ' + (err.message || 'desconocido') + '. Revisa con git.', '#ef4444');
        inputEl.readOnly = false; resetApplyBtn();
      });
    });

    undoBtn.addEventListener('click', doUndo);
  }

  function closePanel() {
    if (panelEl)              { panelEl.remove();              panelEl              = null; }
    if (selectionIndicatorEl) { selectionIndicatorEl.remove(); selectionIndicatorEl = null; }
    selectedEl = null;
  }

  // ── Edit mode on/off ─────────────────────────────────────────────────────
  function enterEditMode() {
    editMode = true;
    selectionMode = 'element';
    sessionHistory = [];
    historyCollapsed = false;
    badgeEl   = createBadge();
    toolbarEl = createToolbar();
    historyEl = createHistoryPanel();
    document.body.appendChild(badgeEl);
    document.body.appendChild(toolbarEl);
    document.body.appendChild(historyEl);
    // Carga el historial del proyecto desde el servidor
    fetch(HISTORY_URL + historyQS())
      .then(function (r) { return r.json(); })
      .then(function (entries) {
        sessionHistory = entries;
        if (historyEl) { renderHistory(historyEl); }
      })
      .catch(function () {});
  }

  function exitEditMode() {
    editMode = false;
    document.body.style.cursor = '';
    if (badgeEl)   { badgeEl.remove();   badgeEl   = null; }
    if (toolbarEl) { toolbarEl.remove(); toolbarEl = null; }
    if (historyEl) { historyEl.remove(); historyEl = null; }
    if (hoveredEl)            { hoveredEl.style.outline = '';         hoveredEl            = null; }
    if (areaOverlay)          { areaOverlay.remove();                 areaOverlay          = null; }
    if (selectionIndicatorEl) { selectionIndicatorEl.remove();        selectionIndicatorEl = null; }
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
    if (e.key === 'Escape') { exitEditMode(); }
  });

  document.addEventListener('mouseover', function (e) {
    if (!editMode || selectionMode !== 'element' || isEditorNode(e.target)) return;
    if (hoveredEl && hoveredEl !== e.target) { hoveredEl.style.outline = ''; }
    hoveredEl = e.target;
    hoveredEl.style.outline = '2px solid #3b82f6';
  });

  document.addEventListener('mouseout', function (e) {
    if (!editMode || selectionMode !== 'element' || isEditorNode(e.target)) return;
    if (e.target === hoveredEl) { e.target.style.outline = ''; hoveredEl = null; }
  });

  document.addEventListener('click', function (e) {
    if (!editMode || selectionMode !== 'element' || isEditorNode(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    openPanel(e.target);
  }, true);

  document.addEventListener('mousedown', function (e) {
    if (!editMode || selectionMode !== 'area' || isEditorNode(e.target)) return;
    areaDragging = true;
    areaStartX = e.clientX; areaStartY = e.clientY;
    areaOverlay = document.createElement('div');
    areaOverlay.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;' +
      'border:2px dashed #3b82f6;background:rgba(59,130,246,0.08);box-sizing:border-box;' +
      'left:' + areaStartX + 'px;top:' + areaStartY + 'px;width:0;height:0';
    document.body.appendChild(areaOverlay);
    e.preventDefault();
  });

  document.addEventListener('mousemove', function (e) {
    if (!areaDragging || !areaOverlay) return;
    areaOverlay.style.left   = Math.min(e.clientX, areaStartX) + 'px';
    areaOverlay.style.top    = Math.min(e.clientY, areaStartY) + 'px';
    areaOverlay.style.width  = Math.abs(e.clientX - areaStartX) + 'px';
    areaOverlay.style.height = Math.abs(e.clientY - areaStartY) + 'px';
  });

  document.addEventListener('mouseup', function (e) {
    if (!areaDragging) return;
    areaDragging = false;
    var x1 = Math.min(e.clientX, areaStartX), y1 = Math.min(e.clientY, areaStartY);
    var x2 = Math.max(e.clientX, areaStartX), y2 = Math.max(e.clientY, areaStartY);
    // Eliminar siempre el overlay de arrastre
    if (areaOverlay) { areaOverlay.remove(); areaOverlay = null; }
    if (x2 - x1 < 5 || y2 - y1 < 5) return;
    var target = findContainingElement(x1, y1, x2, y2);
    if (target) {
      // openPanel llama a closePanel internamente, que borraría el indicador
      // si lo creamos antes. Lo creamos DESPUÉS de que openPanel termine.
      openPanel(target);
      selectionIndicatorEl = document.createElement('div');
      selectionIndicatorEl.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;' +
        'box-sizing:border-box;border:2px solid #3b82f6;background:rgba(59,130,246,0.12);' +
        'box-shadow:0 0 0 3px rgba(59,130,246,0.25);border-radius:3px;' +
        'left:' + x1 + 'px;top:' + y1 + 'px;' +
        'width:' + (x2 - x1) + 'px;height:' + (y2 - y1) + 'px';
      document.body.appendChild(selectionIndicatorEl);
    }
  });

  console.log('[AI Editor] Inyectado. Alt+E para activar el modo edici\xF3n.');
}());
