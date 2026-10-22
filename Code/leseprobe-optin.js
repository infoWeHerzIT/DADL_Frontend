// ================================================================
// Leseprobe-Opt-in "Die ersten Seiten aus dem Buch" (EIN Baustein für alle Seiten)
// ----------------------------------------------------------------
// Einbinden (nach dynamics-crm.js und send-overlay.js):
//   <div data-leseprobe-optin></div>
//   <script src="../Code/leseprobe-optin.js"></script>
//
// Rendert Überschrift, Formular (Vorname + E-Mail freiwillig, Newsletter-
// Checkbox) und die Danke-/Download-Box in jeden Platzhalter mit dem
// Attribut data-leseprobe-optin.
//
// Ablauf beim Absenden:
//   - ohne E-Mail           → direkt Danke-/Download-Box (kein Lead)
//   - mit E-Mail            → Lead in Dynamics (crm-submit[-dev]), dann
//       · ohne Newsletter   → Danke-/Download-Box
//       · mit Newsletter    → Double-Opt-In-Hinweis (sendOverlay.showDoi)
//   - Newsletter ohne E-Mail → Hinweis, dass die E-Mail gebraucht wird
//
// Optionale Konfiguration durch die Seite:
//   LeseprobeOptin.configure({ getEventId: function(){ return '...'; } })
//     → Dynamics-Event-GUID, die mit dem Lead gespeichert wird.
//   LeseprobeOptin.configure({ notifyCheckboxLabel: '...' })
//     → zeigt eine zusätzliche Checkbox ("Sag mir Bescheid, wenn ...") an.
//       Landet bei Zustimmung + E-Mail als Zeitstempel in
//       wht_optinemaildatetime (submitLead's emailOptIn-Feld — bisher nur
//       vorbereitet, von keiner Seite genutzt). Muss VOR dem Laden von
//       DOMContentLoaded aufgerufen werden (reicht: irgendwo synchron im
//       Seiten-<script>, siehe andere configure()-Aufrufe).
//   LeseprobeOptin.reset()
//     → zeigt wieder das leere Formular (z. B. bei "Check noch einmal machen").
//
// Wie ein iframe nur an EINER Stelle definiert, aber als normales Markup
// eingesetzt: so können Warte-Overlay und Double-Opt-In-Fenster die ganze
// Seite abdecken, und die Höhe passt sich automatisch an.
// ================================================================

(function () {
  'use strict';

  // ── KONFIGURATION ───────────────────────────────────────────────
  // Rohen SharePoint-"Link kopieren"-Link eintragen, OHNE selbst
  // "download=1" anzuhängen (macht withDownloadParam() automatisch).
  // Freigabe des Links auf "Jeder mit dem Link" stellen. Solange leer,
  // zeigt die Danke-Box keinen Download-Button.
  var PDF_DOWNLOAD_URL = 'https://weherzit-my.sharepoint.com/:b:/g/personal/sorin_ratiu_weherzit_de1/IQBnT2KgGvAmT590eli9sMEDARJ4uVQ42auVEAEOuDe-hmk?e=QbAGY7';
  var DATENSCHUTZ_URL  = 'https://der-architekt-deines-lebens.de/rechtliches.html#datenschutz';
  // ────────────────────────────────────────────────────────────────

  var CSS = [
    '.lpo{--lpo-paper:#ECE4D1;--lpo-cream:#FEFAF1;--lpo-ink:#1d1a13;--lpo-ink-soft:#5c5645;--lpo-line:#cdbe9c;--lpo-navy:#09204A;--lpo-orange:#CC6E3B;--lpo-orange-600:#AF5B2D;--lpo-orange-100:#EFDDC7;--lpo-ok:#4c7a5e;',
    '  background:var(--lpo-paper);border:1px solid var(--lpo-line);border-top:3px solid var(--lpo-orange);padding:28px 24px;margin:0 0 26px;color:var(--lpo-ink);font-family:inherit}',
    '.lpo *{box-sizing:border-box}',
    '.lpo .lpo-eyebrow{font-weight:600;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--lpo-orange-600);margin:0 0 12px}',
    '.lpo h3{font-weight:800;font-size:23px;line-height:1.25;letter-spacing:-.01em;color:var(--lpo-orange-600);margin:0 0 10px}',
    '.lpo .lpo-lead{margin:0 0 20px;color:var(--lpo-ink-soft);max-width:none}',
    '.lpo .lpo-row{display:grid;gap:0 16px}',
    '@media (min-width:520px){.lpo .lpo-row{grid-template-columns:1fr 1fr}}',
    '.lpo label.lpo-fl{display:block;font-weight:600;font-size:14px;color:var(--lpo-ink);margin:18px 0 7px}',
    '.lpo .lpo-opt{font-weight:400;font-size:13px;color:var(--lpo-ink-soft)}',
    '.lpo input[type=text],.lpo input[type=email]{width:100%;font:inherit;font-size:16px;color:var(--lpo-ink);background:var(--lpo-cream);border:1px solid var(--lpo-line);padding:11px 13px;border-radius:0;-webkit-appearance:none}',
    '.lpo input[type=text]:focus,.lpo input[type=email]:focus{outline:2px solid var(--lpo-orange);outline-offset:1px;border-color:transparent}',
    '.lpo .lpo-cb{display:flex;gap:11px;align-items:flex-start;margin:16px 0 0;font-size:15px;color:var(--lpo-ink-soft);cursor:pointer}',
    '.lpo .lpo-cb input{margin:3px 0 0;flex:0 0 auto;width:17px;height:17px;accent-color:var(--lpo-orange)}',
    '.lpo .lpo-btn{display:inline-block;font:inherit;font-weight:700;font-size:17px;letter-spacing:.01em;background:var(--lpo-orange-600);color:#FFFFFF;border:0;padding:16px 30px;border-radius:2px;cursor:pointer;text-decoration:none;transition:background .15s ease}',
    '.lpo .lpo-btn:hover{background:var(--lpo-navy)}',
    '.lpo .lpo-btn:disabled{opacity:.7;cursor:wait}',
    '.lpo .lpo-btn:focus-visible{outline:3px solid var(--lpo-orange);outline-offset:3px}',
    '.lpo .lpo-btn[hidden]{display:none}',
    '.lpo .lpo-fine{font-size:13.5px;line-height:1.5;color:var(--lpo-ink-soft);margin:14px 0 0;max-width:none}',
    '.lpo .lpo-fine a{color:var(--lpo-orange-600);text-underline-offset:3px}',
    '.lpo .lpo-note{margin:16px 0 0;font-size:14px;color:var(--lpo-orange-600)}',
    '.lpo .lpo-note.lpo-ok{color:var(--lpo-ok)}',

    '.lpo .lpo-ty{position:relative}',
    '.lpo .lpo-confetti{position:absolute;left:0;right:0;top:-18px;height:0;overflow:visible;pointer-events:none}',
    '.lpo .lpo-confetti span{position:absolute;top:-22px;width:9px;height:14px;opacity:.9;animation:lpoFall 1.3s ease-in infinite}',
    '@keyframes lpoFall{0%{transform:translateY(0) rotate(0deg);opacity:1}100%{transform:translateY(170px) rotate(360deg);opacity:0}}',
    '.lpo .lpo-box{background:linear-gradient(160deg,var(--lpo-cream) 0%,var(--lpo-orange-100) 100%);border:1.5px solid var(--lpo-orange);border-radius:10px;padding:34px 28px;text-align:center;box-shadow:0 10px 32px rgba(204,110,59,.2);animation:lpoPop .5s cubic-bezier(.34,1.56,.64,1)}',
    '@keyframes lpoPop{0%{transform:scale(.85);opacity:0}100%{transform:scale(1);opacity:1}}',
    '.lpo .lpo-emojis{font-size:26px;letter-spacing:8px;margin:0 0 8px;animation:lpoEmoji .6s ease}',
    '@keyframes lpoEmoji{0%{transform:scale(0);opacity:0}60%{transform:scale(1.15);opacity:1}100%{transform:scale(1)}}',
    '.lpo .lpo-box h4{font-weight:800;font-size:23px;line-height:1.25;letter-spacing:-.01em;color:var(--lpo-navy);margin:0 0 10px}',
    '.lpo .lpo-box p{margin:0 auto 18px;font-size:15.5px;color:var(--lpo-ink);max-width:none}',
    '.lpo .lpo-box .lpo-btn{box-shadow:0 4px 16px rgba(204,110,59,.35)}',
    '@media (prefers-reduced-motion:reduce){.lpo .lpo-confetti{display:none}.lpo .lpo-box,.lpo .lpo-emojis{animation:none}.lpo .lpo-btn{transition:none}}'
  ].join('\n');

  // Baut das Markup für eine Instanz — als Funktion statt fixer Konstante,
  // damit die optionale Benachrichtigungs-Checkbox (options.notifyCheckboxLabel)
  // je nach Seiten-Konfiguration mit reinkommt oder wegbleibt.
  function buildHtml(n) {
    var notifyCb = options.notifyCheckboxLabel
      ? '<label class="lpo-cb"><input type="checkbox" name="notify"> <span>' + options.notifyCheckboxLabel + '</span></label>'
      : '';
    return (
      '<p class="lpo-eyebrow">Wenn du weitergehen willst</p>' +
      '<h3>Die ersten Seiten aus dem Buch</h3>' +
      '<p class="lpo-lead">Aus dem Kapitel, in dem dieser Zustand beschrieben wird — nicht als Ratgeber, sondern als Beschreibung. Kostenlos, als PDF.</p>' +
      '<form class="lpo-form" novalidate>' +
        '<div class="lpo-row">' +
          '<div><label class="lpo-fl" for="lpo-name-' + n + '">Vorname </label>' +
            '<input id="lpo-name-' + n + '" name="vorname" type="text" autocomplete="given-name"></div>' +
          '<div><label class="lpo-fl" for="lpo-mail-' + n + '">E-Mail </label>' +
            '<input id="lpo-mail-' + n + '" name="email" type="email" autocomplete="email"></div>' +
        '</div>' +
        '<label class="lpo-cb"><input type="checkbox" name="newsletter"> <span>Ja, schick mir ab und zu Impulse per E-Mail (Newsletter). Jederzeit mit einem Klick abbestellbar.</span></label>' +
        notifyCb +
        '<p style="margin:22px 0 0"><button class="lpo-btn" type="submit">Leseprobe schicken</button></p>' +
        '<p class="lpo-fine">Deine Angaben verwende ich nur, um dir dein Ergebnis zu schicken und dich bei Interesse zu einem Erstgespräch einzuladen — <a href="' + DATENSCHUTZ_URL + '">Datenschutzerklärung</a>.</p>' +
        '<p class="lpo-note" hidden></p>' +
      '</form>' +
      '<div class="lpo-ty" hidden>' +
        '<div class="lpo-confetti" aria-hidden="true"></div>' +
        '<div class="lpo-box" role="status">' +
          '<div class="lpo-emojis" aria-hidden="true">🎉 🎊 ✨</div>' +
          '<h4>Fast geschafft 🎉</h4>' +
          '<p>Deine Leseprobe „Die ersten Seiten aus dem Buch" ist bereit. Klick unten, um sie direkt herunterzuladen.</p>' +
          '<a class="lpo-btn lpo-dl" href="#" target="_blank" rel="noopener">PDF jetzt herunterladen</a>' +
        '</div>' +
      '</div>'
    );
  }

  var MAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var CONFETTI_COLORS = ['#CC6E3B', '#09204A', '#AF5B2D', '#CC6E3B', '#09204A', '#EFDDC7'];

  var options = { getEventId: function () { return ''; }, notifyCheckboxLabel: '' };
  var instances = [];
  var styleAdded = false;

  // Hängt "download=1" korrekt an — sonst zeigt SharePoint nur seine
  // HTML-Vorschauseite statt die Datei direkt herunterzuladen.
  function withDownloadParam(url) {
    if (!url) return url;
    return url + (url.indexOf('?') === -1 ? '?' : '&') + 'download=1';
  }

  function addStyle() {
    if (styleAdded) return;
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    styleAdded = true;
  }

  function mount(root) {
    if (root.__lpo) return root.__lpo;
    addStyle();
    var n = instances.length + 1;
    root.classList.add('lpo');
    root.innerHTML = buildHtml(n);

    var form     = root.querySelector('.lpo-form');
    var nameIn   = form.querySelector('input[name=vorname]');
    var mailIn   = form.querySelector('input[name=email]');
    var nlIn     = form.querySelector('input[name=newsletter]');
    var notifyIn = form.querySelector('input[name=notify]');
    var submit  = form.querySelector('button[type=submit]');
    var note    = form.querySelector('.lpo-note');
    var ty      = root.querySelector('.lpo-ty');
    var dl      = root.querySelector('.lpo-dl');

    dl.href   = withDownloadParam(PDF_DOWNLOAD_URL) || '#';
    dl.hidden = !PDF_DOWNLOAD_URL;

    var confetti = root.querySelector('.lpo-confetti');
    for (var i = 0; i < 24; i++) {
      var c = document.createElement('span');
      c.style.left = (2 + i * 4) + '%';
      c.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      c.style.animationDelay = ((i * 0.18) % 0.9).toFixed(2) + 's';
      if (i % 2) c.style.borderRadius = '50%';
      confetti.appendChild(c);
    }

    function showNote(text, ok) {
      note.textContent = text;
      note.classList.toggle('lpo-ok', !!ok);
      note.hidden = false;
    }

    function showThankyou(vorname) {
      ty.querySelector('h4').textContent = vorname ? 'Fast geschafft, ' + vorname + ' 🎉' : 'Fast geschafft 🎉';
      form.hidden = true;
      ty.hidden = false;
      ty.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function reset() {
      form.reset();
      note.hidden = true;
      ty.hidden = true;
      form.hidden = false;
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var vorname = nameIn.value.trim();
      var email   = mailIn.value.trim();
      var newsletterOptIn = nlIn.checked;
      var notifyOptIn = notifyIn ? notifyIn.checked : false;

      // E-Mail ist freiwillig — nur prüfen, wenn etwas eingetragen ist. Für
      // Newsletter und Benachrichtigung wird sie aber gebraucht.
      var mailError = email && !MAIL_RE.test(email) ? 'Bitte gib eine gültige E-Mail-Adresse an.'
                    : !email && newsletterOptIn ? 'Für den Newsletter brauchen wir deine E-Mail-Adresse.'
                    : !email && notifyOptIn ? 'Für die Benachrichtigung brauchen wir deine E-Mail-Adresse.'
                    : '';
      if (mailError) { showNote(mailError); mailIn.focus(); return; }
      note.hidden = true;

      // Ohne E-Mail gibt es keinen Lead anzulegen — direkt zum Download.
      if (!email) { showThankyou(vorname); return; }

      submit.disabled = true;
      submit.textContent = 'Wird gesendet …';
      sendOverlay.show('Bitte warten. E-Mail wird verschickt');

      dynamicsCRM.submitLead({
        firstname: vorname,
        email: email,
        newsletterOptIn: newsletterOptIn,
        emailOptIn: notifyOptIn,
        eventId: options.getEventId() || ''
      }).then(function (res) {
        submit.disabled = false;
        submit.textContent = 'Leseprobe schicken';
        if (!res || !res.success) {
          sendOverlay.hide();
          showNote('Da ist etwas schiefgelaufen. Bitte versuch es gleich noch einmal.');
          return;
        }
        form.reset();
        if (newsletterOptIn) {
          // Bei Newsletter-Opt-in auf die Double-Opt-In-Mail hinweisen.
          sendOverlay.showDoi(email, { continueLabel: 'Schließen' });
          showNote('Danke! Deine Anmeldung ist bei uns eingegangen.', true);
        } else {
          sendOverlay.hide();
          showThankyou(vorname);
        }
      });
    });

    root.__lpo = { reset: reset };
    instances.push(root.__lpo);
    return root.__lpo;
  }

  function mountAll() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-leseprobe-optin]'), mount);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll);
  else mountAll();

  window.LeseprobeOptin = {
    configure: function (opts) {
      if (opts && typeof opts.getEventId === 'function') options.getEventId = opts.getEventId;
      if (opts && typeof opts.notifyCheckboxLabel === 'string') options.notifyCheckboxLabel = opts.notifyCheckboxLabel;
    },
    reset: function () { instances.forEach(function (i) { i.reset(); }); },
    mount: mount
  };
})();
