// ================================================================
// Bilder einer Umfrage (Templates/umfrage-dynamisch.html)
// ----------------------------------------------------------------
// Jede Umfrage kann mehrere Bilder haben, angesprochen über einen "Slot":
//   "header"      – Kopfbild oben (800×350, 16:7)
//   "section:3"   – Bild oben auf Abschnitts-Seite 3 (800×300, 8:3)
//   "question:9"  – Bild direkt über Frage 9 (800×300, 8:3)
//
// Ablage: Supabase Storage, Bucket "survey-images", Ordner = Umfrage-Slug
// (so hat jede Umfrage ihren eigenen Ordner; der Slug ist in Dynamics DEV
// und PROD gleich). Pro Bild liegen dort zwei Dateien:
//   <slot>-original-<zeit>.<ext>  – das hochgeladene Foto, unverändert
//   <slot>-<zeit>.jpg             – der gewählte Ausschnitt (1600px breit)
// Gespeichert wird in Tabelle survey_settings (Schlüssel: Slug): das Kopf-
// bild in den Spalten header_image_url/-path, original_image_path,
// header_crop; alle anderen Slots in der Spalte images (jsonb,
// { "<slot>": { url, path, original_path, crop } }).
// Lesen darf jeder, schreiben nur eingeloggte Admins (RLS, siehe
// supabase/migrations/20261113_survey_settings_*.sql).
//
// Der Ausschnitt-Editor (openEditor) zeigt einen Rahmen in der Form des
// jeweiligen Bildes; das Foto lässt sich darin verschieben (ziehen) und
// zoomen (Regler/Mausrad). Beim Übernehmen wird der sichtbare Bereich per
// Canvas als JPG gerendert und hochgeladen. Weil das Original bleibt, kann
// der Ausschnitt später geändert werden (editExisting), der Editor öffnet
// dann an der gespeicherten Position.
//
// Voraussetzung: supabase-config.js vorher eingebunden (globales "db").
// Genutzt von admin/admin-umfrage.html und Templates/umfrage-dynamisch.html.
//
//   SurveyHeaderImage.load(slug)                               → Promise<setting|null>
//   SurveyHeaderImage.getSlot(setting, slot)                   → { url, path, original_path, crop } | null
//   SurveyHeaderImage.chooseAndEdit(slug, file, setting, slot) → Promise<setting|null>  (null = abgebrochen)
//   SurveyHeaderImage.editExisting(slug, setting, slot)        → Promise<setting|null>  (null = abgebrochen)
//   SurveyHeaderImage.remove(slug, setting, slot)              → Promise<setting>
//   SurveyHeaderImage.mountSlotControls(rootEl, options)       → Bedienelemente (Hochladen/Ausschnitt/Entfernen)
//     options: { slug, slot, getSetting(), onChange(setting), title?, names?: { upload, replace, crop, remove } }
// ================================================================
(function () {
  'use strict';

  var BUCKET = 'survey-images';
  var TABLE  = 'survey_settings';
  var MAX_BYTES = 5 * 1024 * 1024;
  var OUT_W = 1600; // Ausgabebreite der Ausschnitte (doppelte Anzeigebreite für scharfe Darstellung)
  var ZOOM_MIN = 1, ZOOM_MAX = 4;
  // Seitenverhältnis (Breite : Höhe) je Slot-Art – muss zur Darstellung auf
  // der Umfrageseite passen (Kopfbild max. 800×350, andere Bilder 800×300).
  var RATIOS = { header: 800 / 350, section: 800 / 300, question: 800 / 300 };
  var FIELDS = 'survey_slug, header_image_url, header_image_path, original_image_path, header_crop, images';

  // supabase-config.js legt den Client als "const db" an – der ist als
  // globale Variable sichtbar, aber NICHT als window.db. Deshalb zuerst die
  // Variable, window.db nur als Fallback.
  function client() {
    var c = (typeof db !== 'undefined') ? db : window.db;
    if (!c) throw new Error('Supabase-Client (db) nicht verfügbar – supabase-config.js vor survey-header-image.js einbinden.');
    return c;
  }
  function storage() { return client().storage.from(BUCKET); }
  function publicUrl(path) { return storage().getPublicUrl(path).data.publicUrl; }

  function slotKind(slot) { return slot === 'header' ? 'header' : String(slot).split(':')[0]; }
  function ratioFor(slot) { return RATIOS[slotKind(slot)] || 800 / 300; }
  function fileBase(slot) { return slot === 'header' ? 'header' : String(slot).replace(/[^a-z0-9]+/gi, '-'); }

  // Bilddaten eines Slots aus der Einstellung lesen (einheitliche Form).
  function getSlot(setting, slot) {
    if (!setting) return null;
    if (slot === 'header') {
      if (!setting.header_image_url) return null;
      return { url: setting.header_image_url, path: setting.header_image_path, original_path: setting.original_image_path, crop: setting.header_crop };
    }
    var map = setting.images || {};
    return map[slot] || null;
  }

  // Neue Einstellung + Upsert-Zeile für einen geänderten Slot (data = null → entfernen).
  // Die Zeile enthält nur die betroffenen Spalten, damit ein Upsert die
  // anderen Slots nicht überschreibt.
  function withSlot(slug, setting, slot, data) {
    var next = Object.assign({ survey_slug: slug }, setting || {});
    next.images = Object.assign({}, (setting && setting.images) || {});
    var row = { survey_slug: slug, updated_at: new Date().toISOString() };
    if (slot === 'header') {
      next.header_image_url    = data ? data.url : null;
      next.header_image_path   = data ? data.path : null;
      next.original_image_path = data ? data.original_path : null;
      next.header_crop         = data ? data.crop : null;
      row.header_image_url = next.header_image_url; row.header_image_path = next.header_image_path;
      row.original_image_path = next.original_image_path; row.header_crop = next.header_crop;
    } else {
      if (data) next.images[slot] = data; else delete next.images[slot];
      row.images = next.images;
    }
    return { row: row, setting: next };
  }

  function load(slug) {
    return client().from(TABLE).select(FIELDS).eq('survey_slug', slug).maybeSingle()
      .then(function (res) {
        if (res.error) throw new Error(res.error.message);
        return res.data || null;
      });
  }

  function validate(file) {
    if (!file) return 'Keine Datei gewählt.';
    if (file.size > MAX_BYTES) return 'Die Datei ist größer als 5 MB.';
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) return 'Bitte JPG, PNG, WebP oder GIF wählen.';
    return '';
  }

  function uploadBlob(path, blob, contentType) {
    return storage().upload(path, blob, { contentType: contentType, cacheControl: '3600', upsert: false })
      .then(function (up) {
        if (up.error) throw new Error('Upload fehlgeschlagen: ' + up.error.message);
        return path;
      });
  }

  function removePaths(paths) {
    var list = (paths || []).filter(Boolean);
    if (!list.length) return;
    storage().remove(list).catch(function () {});
  }

  function saveSetting(row) {
    return client().from(TABLE).upsert(row).then(function (save) {
      if (save.error) throw new Error('Speichern fehlgeschlagen: ' + save.error.message);
      return row;
    });
  }

  function loadImage(src, crossOrigin) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      if (crossOrigin) img.crossOrigin = 'anonymous';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('Das Bild konnte nicht geladen werden.')); };
      img.src = src;
    });
  }

  // ── Styles (Editor + Bedienelemente) ────────────────────────────
  var CSS = [
    '.shi-overlay{position:fixed;inset:0;z-index:10000;background:rgba(0,13,31,.82);display:flex;align-items:center;justify-content:center;padding:16px}',
    '.shi-panel{background:#fffaf1;color:#00224d;border-radius:10px;width:min(960px,100%);max-height:100%;overflow:auto;padding:22px 22px 18px;box-shadow:0 20px 60px rgba(0,0,0,.4);font-family:"DM Sans","Source Sans 3",Arial,sans-serif}',
    '.shi-panel h3{margin:0 0 6px;font-family:Archivo,system-ui,sans-serif;font-size:20px;font-weight:800}',
    '.shi-hint{margin:0 0 14px;font-size:14px;color:rgba(0,34,77,.65);line-height:1.5}',
    '.shi-frame{position:relative;width:100%;overflow:hidden;background:#09204A;border-radius:6px;cursor:grab;touch-action:none;user-select:none;outline:2px solid rgba(217,104,44,.8);outline-offset:-2px}',
    '.shi-frame.shi-dragging{cursor:grabbing}',
    '.shi-img{position:absolute;left:0;top:0;max-width:none;pointer-events:none;will-change:transform}',
    '.shi-controls{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin:16px 0 0}',
    '.shi-controls label{display:flex;align-items:center;gap:10px;font-size:14px;flex:1 1 240px}',
    '.shi-controls input[type=range]{flex:1;accent-color:#d9682c}',
    '.shi-btn{font:inherit;font-size:14px;font-weight:600;border-radius:4px;padding:10px 18px;cursor:pointer;border:1px solid rgba(0,34,77,.25);background:#fff;color:#00224d}',
    '.shi-btn:hover{border-color:#d9682c}',
    '.shi-btn.shi-primary{background:#d9682c;border-color:#d9682c;color:#fff}',
    '.shi-btn.shi-primary:hover{background:#bd551f}',
    '.shi-btn:disabled{opacity:.6;cursor:wait}',
    '.shi-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px;flex-wrap:wrap}',
    '.shi-error{color:#c53030;font-size:14px;margin:10px 0 0;min-height:1em}',
    // Bedienelemente je Slot (dunkle Leiste, passt auf helle und dunkle Flächen)
    '.shi-ctl{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px 12px;padding:8px 12px;background:#001a3b;border-radius:6px;font-family:"DM Sans","Source Sans 3",Arial,sans-serif}',
    '.shi-ctl-title{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:rgba(255,250,241,.55);margin-right:auto}',
    '.shi-ctl-btn{display:inline-flex;align-items:center;background:transparent;border:1px solid rgba(255,250,241,.35);border-radius:2px;color:#fffaf1;font:inherit;font-size:13px;font-weight:500;padding:7px 12px;cursor:pointer;line-height:1.2}',
    '.shi-ctl-btn:hover{border-color:#d9682c}',
    '.shi-ctl-btn[hidden]{display:none}',
    '.shi-ctl-status{font-size:12.5px;color:rgba(255,250,241,.6)}',
    '.shi-ctl-status.ok{color:#7fc8a0}',
    '.shi-ctl-status.err{color:#f87171}'
  ].join('\n');
  var styleAdded = false;
  function ensureStyle() {
    if (styleAdded) return;
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    styleAdded = true;
  }

  // Zeigt den Ausschnitt-Editor für ein geladenes Bild. crop (optional):
  // { zoom, x, y } – gespeicherte Position (x/y relativ zur Rahmengröße).
  // ratio: Breite/Höhe des Rahmens. Ergebnis: { blob, crop } oder null.
  function openEditor(img, crop, ratio) {
    ensureStyle();
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'shi-overlay';
      overlay.innerHTML =
        '<div class="shi-panel" role="dialog" aria-modal="true" aria-label="Bildausschnitt wählen">' +
          '<h3>Bildausschnitt wählen</h3>' +
          '<p class="shi-hint">Der Rahmen zeigt, was auf der Umfrageseite zu sehen ist. Bild mit Maus oder Finger verschieben, mit dem Regler oder dem Mausrad vergrößern und verkleinern.</p>' +
          '<div class="shi-frame" style="aspect-ratio:' + ratio + ' / 1"><img class="shi-img" alt=""></div>' +
          '<div class="shi-controls">' +
            '<label>Zoom <input type="range" class="shi-zoom" min="' + ZOOM_MIN + '" max="' + ZOOM_MAX + '" step="0.01" value="1"></label>' +
            '<button type="button" class="shi-btn shi-reset">Zurücksetzen</button>' +
          '</div>' +
          '<p class="shi-error"></p>' +
          '<div class="shi-actions">' +
            '<button type="button" class="shi-btn shi-cancel">Abbrechen</button>' +
            '<button type="button" class="shi-btn shi-primary shi-save">Ausschnitt übernehmen</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);

      var frame  = overlay.querySelector('.shi-frame');
      var view   = overlay.querySelector('.shi-img');
      var zoomIn = overlay.querySelector('.shi-zoom');
      var errEl  = overlay.querySelector('.shi-error');
      view.src = img.src;

      var iw = img.naturalWidth, ih = img.naturalHeight;
      var W, H, base, s = 1, tx = 0, ty = 0;

      function measure() {
        W = frame.clientWidth; H = frame.clientHeight;
        base = Math.max(W / iw, H / ih); // „cover“: kleinster Maßstab, der den Rahmen füllt
      }
      function clamp() {
        var S = base * s;
        var maxX = Math.max(0, (iw * S - W) / 2), maxY = Math.max(0, (ih * S - H) / 2);
        tx = Math.min(maxX, Math.max(-maxX, tx));
        ty = Math.min(maxY, Math.max(-maxY, ty));
      }
      function render() {
        clamp();
        var S = base * s, w = iw * S, h = ih * S;
        view.style.width = w + 'px'; view.style.height = h + 'px';
        view.style.transform = 'translate(' + (W / 2 + tx - w / 2) + 'px,' + (H / 2 + ty - h / 2) + 'px)';
        zoomIn.value = s;
      }
      function setZoom(v) {
        var ns = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v));
        var factor = ns / s; // Mittelpunkt des Rahmens bleibt fix
        tx *= factor; ty *= factor; s = ns;
        render();
      }

      measure();
      if (crop && typeof crop.zoom === 'number') {
        s = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, crop.zoom));
        tx = (Number(crop.x) || 0) * W; ty = (Number(crop.y) || 0) * H;
      }
      render();

      var drag = null;
      frame.addEventListener('pointerdown', function (e) {
        drag = { x: e.clientX, y: e.clientY, tx: tx, ty: ty };
        frame.classList.add('shi-dragging');
        frame.setPointerCapture(e.pointerId);
        e.preventDefault();
      });
      frame.addEventListener('pointermove', function (e) {
        if (!drag) return;
        tx = drag.tx + (e.clientX - drag.x); ty = drag.ty + (e.clientY - drag.y);
        render();
      });
      function endDrag() { drag = null; frame.classList.remove('shi-dragging'); }
      frame.addEventListener('pointerup', endDrag);
      frame.addEventListener('pointercancel', endDrag);
      frame.addEventListener('wheel', function (e) { e.preventDefault(); setZoom(s * (e.deltaY < 0 ? 1.08 : 1 / 1.08)); }, { passive: false });
      zoomIn.addEventListener('input', function () { setZoom(parseFloat(zoomIn.value)); });
      overlay.querySelector('.shi-reset').addEventListener('click', function () { s = 1; tx = 0; ty = 0; render(); });

      function onResize() { var oW = W, oH = H; measure(); tx *= W / oW; ty *= H / oH; render(); }
      window.addEventListener('resize', onResize);
      function close(result) { window.removeEventListener('resize', onResize); overlay.remove(); resolve(result); }

      overlay.querySelector('.shi-cancel').addEventListener('click', function () { close(null); });
      overlay.addEventListener('click', function (e) { if (e.target === overlay) close(null); });
      document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { document.removeEventListener('keydown', esc); close(null); } });

      overlay.querySelector('.shi-save').addEventListener('click', function () {
        var btn = this;
        btn.disabled = true; btn.textContent = 'Wird erstellt …'; errEl.textContent = '';
        var outW = OUT_W, outH = Math.round(OUT_W * H / W);
        var k = outW / W, S = base * s, w = iw * S, h = ih * S;
        var canvas = document.createElement('canvas');
        canvas.width = outW; canvas.height = outH;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#09204A'; // Hintergrund für transparente PNGs
        ctx.fillRect(0, 0, outW, outH);
        ctx.imageSmoothingQuality = 'high';
        try {
          ctx.drawImage(img, (W / 2 + tx - w / 2) * k, (H / 2 + ty - h / 2) * k, w * k, h * k);
          canvas.toBlob(function (blob) {
            if (!blob) { btn.disabled = false; btn.textContent = 'Ausschnitt übernehmen'; errEl.textContent = 'Der Ausschnitt konnte nicht erstellt werden.'; return; }
            close({ blob: blob, crop: { zoom: s, x: tx / W, y: ty / H } });
          }, 'image/jpeg', 0.9);
        } catch (e) {
          btn.disabled = false; btn.textContent = 'Ausschnitt übernehmen';
          errEl.textContent = 'Der Ausschnitt konnte nicht erstellt werden (Browser-Sicherheit). Bitte das Foto neu hochladen.';
        }
      });
    });
  }

  // Neues Foto für einen Slot: Editor öffnen, dann Original + Ausschnitt
  // hochladen und Einstellung speichern. Alte Dateien des Slots werden gelöscht.
  function chooseAndEdit(slug, file, setting, slot) {
    slot = slot || 'header';
    var problem = validate(file);
    if (problem) return Promise.reject(new Error(problem));
    var current = getSlot(setting, slot);
    var objUrl = URL.createObjectURL(file);
    return loadImage(objUrl, false)
      .then(function (img) { return openEditor(img, null, ratioFor(slot)); })
      .then(function (res) {
        URL.revokeObjectURL(objUrl);
        if (!res) return null;
        var ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        var stamp = Date.now(), base = fileBase(slot);
        var origPath = slug + '/' + base + '-original-' + stamp + '.' + ext;
        var cropPath = slug + '/' + base + '-' + stamp + '.jpg';
        return uploadBlob(origPath, file, file.type)
          .then(function () { return uploadBlob(cropPath, res.blob, 'image/jpeg'); })
          .then(function () {
            var r = withSlot(slug, setting, slot, { url: publicUrl(cropPath), path: cropPath, original_path: origPath, crop: res.crop });
            return saveSetting(r.row).then(function () {
              removePaths([current && current.path, current && current.original_path]);
              return r.setting;
            });
          });
      });
  }

  // Ausschnitt des vorhandenen Originals ändern: Editor an der gespeicherten
  // Position öffnen, nur den Ausschnitt neu hochladen.
  function editExisting(slug, setting, slot) {
    slot = slot || 'header';
    var current = getSlot(setting, slot);
    if (!current || !current.original_path) return Promise.reject(new Error('Für dieses Bild liegt kein Original vor – bitte das Foto neu hochladen.'));
    var src = publicUrl(current.original_path) + '?v=' + Date.now();
    return loadImage(src, true)
      .then(function (img) { return openEditor(img, current.crop || null, ratioFor(slot)); })
      .then(function (res) {
        if (!res) return null;
        var cropPath = slug + '/' + fileBase(slot) + '-' + Date.now() + '.jpg';
        return uploadBlob(cropPath, res.blob, 'image/jpeg').then(function () {
          var r = withSlot(slug, setting, slot, { url: publicUrl(cropPath), path: cropPath, original_path: current.original_path, crop: res.crop });
          return saveSetting(r.row).then(function () {
            removePaths([current.path]);
            return r.setting;
          });
        });
      });
  }

  function remove(slug, setting, slot) {
    slot = slot || 'header';
    var current = getSlot(setting, slot);
    var r = withSlot(slug, setting, slot, null);
    return saveSetting(r.row).then(function () {
      removePaths([current && current.path, current && current.original_path]);
      return r.setting;
    });
  }

  // Bedienelemente für einen Slot in ein Element rendern.
  // options: { slug, slot, getSetting(), onChange(setting), title?, names? }
  function mountSlotControls(root, options) {
    ensureStyle();
    var slug = options.slug, slot = options.slot || 'header';
    var names = options.names || {};
    root.classList.add('shi-ctl');
    root.innerHTML =
      (options.title ? '<span class="shi-ctl-title"></span>' : '') +
      '<label class="shi-ctl-btn"><span class="shi-ctl-upload"></span><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden></label>' +
      '<button type="button" class="shi-ctl-btn shi-ctl-crop"></button>' +
      '<button type="button" class="shi-ctl-btn shi-ctl-remove"></button>' +
      '<span class="shi-ctl-status"></span>';
    if (options.title) root.querySelector('.shi-ctl-title').textContent = options.title;
    var fileIn = root.querySelector('input[type=file]');
    var upText = root.querySelector('.shi-ctl-upload');
    var btnCrop = root.querySelector('.shi-ctl-crop');
    var btnRm = root.querySelector('.shi-ctl-remove');
    var statusEl = root.querySelector('.shi-ctl-status');
    btnCrop.textContent = names.crop || 'Ausschnitt ändern';
    btnRm.textContent = names.remove || 'Entfernen';

    function status(text, cls) { statusEl.textContent = text || ''; statusEl.className = 'shi-ctl-status' + (cls ? ' ' + cls : ''); }
    function render() {
      var cur = getSlot(options.getSetting(), slot);
      upText.textContent = cur ? (names.replace || 'Neues Bild hochladen') : (names.upload || 'Bild hochladen');
      btnCrop.hidden = !(cur && cur.original_path);
      btnRm.hidden = !cur;
    }
    function done(data, okText) {
      if (!data) { status('Abgebrochen – nichts geändert.'); return; }
      options.onChange(data); render(); status(okText, 'ok');
    }

    fileIn.addEventListener('change', function () {
      var file = this.files && this.files[0];
      this.value = '';
      if (!file) return;
      status('');
      chooseAndEdit(slug, file, options.getSetting(), slot)
        .then(function (data) { done(data, 'Gespeichert.'); })
        .catch(function (err) { status(err.message, 'err'); });
    });
    btnCrop.addEventListener('click', function () {
      status('');
      editExisting(slug, options.getSetting(), slot)
        .then(function (data) { done(data, 'Neuer Ausschnitt gespeichert.'); })
        .catch(function (err) { status(err.message, 'err'); });
    });
    btnRm.addEventListener('click', function () {
      if (!getSlot(options.getSetting(), slot)) return;
      if (!window.confirm('Dieses Bild wirklich entfernen?')) return;
      status('Wird entfernt …');
      remove(slug, options.getSetting(), slot)
        .then(function (data) { done(data, 'Entfernt.'); })
        .catch(function (err) { status(err.message, 'err'); });
    });

    render();
    return { render: render };
  }

  window.SurveyHeaderImage = {
    BUCKET: BUCKET, RATIOS: RATIOS,
    load: load, getSlot: getSlot,
    chooseAndEdit: chooseAndEdit, editExisting: editExisting, remove: remove,
    mountSlotControls: mountSlotControls
  };
})();
