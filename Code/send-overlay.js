// ================================================================
// Sende-Overlay + Double-Opt-In-Hinweis (gemeinsam für Umfragen und Tools)
// ----------------------------------------------------------------
// sendOverlay.show(label)
//   Blockiert die ganze Seite (Overlay + inert) und zeigt Spinner + Text
//   mit animierten Punkten, z. B. "Bitte warten. E-Mail wird verschickt".
// sendOverlay.hide()
//   Hebt die Blockade wieder auf (z. B. bei einem Fehler, damit der Nutzer
//   es erneut versuchen kann).
// sendOverlay.showDoi(email, { continueLabel, onContinue })
//   Ersetzt den Spinner durch ein Fenster mit der Bitte, die Double-Opt-In-
//   Mail zu bestätigen, inkl. Button zum Öffnen der E-Mail: bei bekannter
//   Domain zum Webmail-Postfach des Anbieters, sonst per mailto: zum lokal
//   eingerichteten Standard-E-Mail-Programm. Nach Klick auf den
//   Weiter-Button wird die Blockade aufgehoben und onContinue() aufgerufen.
//
// Bringt eigenes CSS mit (Farben der Marke, Schrift wird von der Seite
// geerbt) und hängt sein Markup selbst an <body> — die einbindende Seite
// braucht nur <script src="../Code/send-overlay.js"></script>.
// ================================================================

(function () {
  'use strict';

  var CSS = [
    '.so-overlay{position:fixed;inset:0;z-index:9999;display:none;flex-direction:column;align-items:center;justify-content:center;gap:22px;padding:24px;text-align:center;font-family:inherit}',
    '.so-overlay.so-visible{display:flex}',
    '.so-wait{background:rgba(255,250,241,0.88);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);cursor:wait}',
    '.so-spinner{width:54px;height:54px;border-radius:50%;border:4px solid rgba(217,104,44,0.2);border-top-color:#d9682c;animation:so-spin .8s linear infinite}',
    '.so-wait p{font-size:18px;font-weight:600;color:#00224d;margin:0}',
    '.so-dots span{display:inline-block;animation:so-blink 1.4s infinite both}',
    '.so-dots span:nth-child(2){animation-delay:.2s}',
    '.so-dots span:nth-child(3){animation-delay:.4s}',
    '@keyframes so-spin{to{transform:rotate(360deg)}}',
    '@keyframes so-blink{0%,80%,100%{opacity:0}40%{opacity:1}}',

    '.so-doi{background:rgba(0,34,77,0.55)}',
    '.so-card{max-width:480px;width:100%;background:#fffaf1;border-radius:4px;box-shadow:0 12px 48px rgba(0,0,0,0.25);overflow:hidden;text-align:left}',
    '.so-hdr{background:#00224d;border-left:5px solid #d9682c;padding:22px 28px;display:flex;align-items:center;gap:14px}',
    '.so-hdr svg{width:30px;height:30px;flex:none;color:#d9682c}',
    '.so-hdr h2{font-size:20px;font-weight:700;color:#fffaf1;margin:0;line-height:1.3;letter-spacing:0}',
    '.so-body{padding:24px 28px 28px}',
    '.so-body p{font-size:15.5px;line-height:1.65;color:#2d3748;margin:0 0 14px;max-width:none}',
    '.so-body p.so-hint{font-size:13.5px;color:rgba(0,34,77,0.6)}',
    '.so-mail{font-weight:600;color:#00224d;word-break:break-all}',
    '.so-actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:22px}',
    '.so-actions a,.so-actions button{font:inherit;font-size:15px;font-weight:600;letter-spacing:.02em;padding:13px 22px;border-radius:2px;cursor:pointer;text-decoration:none;text-align:center;flex:1 1 auto}',
    '.so-open{background:#d9682c;color:#fffaf1;border:none}',
    '.so-open:hover{background:#bd551f}',
    '.so-continue{background:none;color:#00224d;border:1px solid rgba(0,34,77,0.2)}',
    '.so-continue:hover{border-color:#d9682c}',
    '.so-actions a:focus-visible,.so-actions button:focus-visible{outline:3px solid #d9682c;outline-offset:2px}',

    '@media (prefers-reduced-motion:reduce){.so-spinner{animation-duration:2.4s}.so-dots span{animation:none;opacity:1}}'
  ].join('\n');

  var HTML =
    '<div class="so-overlay so-wait" id="so-wait" role="alertdialog" aria-modal="true" aria-live="assertive" aria-labelledby="so-wait-text">' +
      '<div class="so-spinner" aria-hidden="true"></div>' +
      '<p id="so-wait-text"><span id="so-wait-label"></span><span class="so-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span></p>' +
    '</div>' +
    '<div class="so-overlay so-doi" id="so-doi" role="dialog" aria-modal="true" aria-labelledby="so-doi-title">' +
      '<div class="so-card">' +
        '<div class="so-hdr">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3.5 6l8.5 7 8.5-7"/></svg>' +
          '<h2 id="so-doi-title">Nur noch ein Klick zur Bestätigung</h2>' +
        '</div>' +
        '<div class="so-body">' +
          '<p>Vielen Dank für dein Interesse an unseren Impulsen! Wir haben dir soeben eine E-Mail an <span class="so-mail" id="so-doi-mail"></span> gesendet.</p>' +
          '<p>Bitte öffne diese Nachricht und <strong>bestätige deine Anmeldung über den enthaltenen Link.</strong> Erst danach nehmen wir dich in unseren Newsletter auf – so stellen wir sicher, dass niemand ohne sein Einverständnis E-Mails von uns erhält.</p>' +
          '<p class="so-hint">Keine E-Mail erhalten? Bitte wirf auch einen Blick in deinen Spam- oder Werbe-Ordner. Die Zustellung kann einige Minuten dauern.</p>' +
          '<div class="so-actions">' +
            '<a class="so-open" id="so-doi-open" href="#" target="_blank" rel="noopener" hidden></a>' +
            '<button type="button" class="so-continue" id="so-doi-continue"></button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

  // Webmail-Postfach anhand der Domain der E-Mail-Adresse — bei bekannter
  // Domain führt der Button direkt zum passenden Webmail-Login. Unbekannte
  // Domains (z. B. Firmen-Adressen) bekommen stattdessen einen mailto:-Link,
  // der das lokal als Standard eingerichtete E-Mail-Programm öffnet (mehr
  // ist einem Browser aus nicht möglich — kein Zugriff auf den Posteingang,
  // nur das Verfassen-Fenster, aber besser als gar kein Link).
  var WEBMAIL = [
    { re: /^(gmail|googlemail)\.com$/,             name: 'Gmail',        url: 'https://mail.google.com/' },
    { re: /^(outlook|hotmail|live|msn)\.[a-z.]+$/, name: 'Outlook',      url: 'https://outlook.live.com/mail/' },
    { re: /^gmx\.[a-z.]+$/,                        name: 'GMX',          url: 'https://www.gmx.net/' },
    { re: /^web\.de$/,                             name: 'WEB.DE',       url: 'https://web.de/' },
    { re: /^t-online\.de$/,                        name: 't-online',     url: 'https://email.t-online.de/' },
    { re: /^(yahoo|ymail)\.[a-z.]+$/,              name: 'Yahoo Mail',   url: 'https://mail.yahoo.com/' },
    { re: /^(icloud|me|mac)\.com$/,                name: 'iCloud Mail',  url: 'https://www.icloud.com/mail' },
    { re: /^freenet\.de$/,                         name: 'freenet Mail', url: 'https://webmail.freenet.de/' },
    { re: /^mail\.de$/,                            name: 'mail.de',      url: 'https://mail.de/' },
    { re: /^posteo\.(de|net)$/,                    name: 'Posteo',       url: 'https://posteo.de/webmail/' },
    { re: /^(proton\.me|protonmail\.com|pm\.me)$/, name: 'Proton Mail',  url: 'https://mail.proton.me/' }
  ];

  var mounted = false;
  var inerted = [];

  function mount() {
    if (mounted) return;
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    var wrap = document.createElement('div');
    wrap.innerHTML = HTML;
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
    mounted = true;
  }

  function block() {
    if (inerted.length) return;
    Array.prototype.forEach.call(document.body.children, function (el) {
      if (!el.classList.contains('so-overlay') && el.tagName !== 'SCRIPT' && !el.inert) {
        el.inert = true;
        inerted.push(el);
      }
    });
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  function unblock() {
    inerted.forEach(function (el) { el.inert = false; });
    inerted = [];
  }

  function show(label) {
    mount();
    document.getElementById('so-wait-label').textContent = label || 'Bitte warten. E-Mail wird verschickt';
    document.getElementById('so-doi').classList.remove('so-visible');
    document.getElementById('so-wait').classList.add('so-visible');
    block();
  }

  function hide() {
    if (!mounted) return;
    document.getElementById('so-wait').classList.remove('so-visible');
    document.getElementById('so-doi').classList.remove('so-visible');
    unblock();
  }

  function showDoi(email, opts) {
    opts = opts || {};
    mount();
    var domain = (String(email).split('@')[1] || '').toLowerCase();
    var hit = WEBMAIL.find(function (w) { return w.re.test(domain); });
    var openLink = document.getElementById('so-doi-open');
    var cont     = document.getElementById('so-doi-continue');

    document.getElementById('so-doi-mail').textContent = email;
    openLink.hidden = false;
    if (hit) {
      openLink.href = hit.url;
      openLink.textContent = hit.name + ' öffnen';
    } else {
      openLink.href = 'mailto:';
      openLink.textContent = 'E-Mail-Programm öffnen';
    }
    cont.textContent = opts.continueLabel || 'Weiter';
    cont.onclick = function () {
      hide();
      if (typeof opts.onContinue === 'function') opts.onContinue();
    };

    document.getElementById('so-wait').classList.remove('so-visible');
    document.getElementById('so-doi').classList.add('so-visible');
    block();
    (hit ? openLink : cont).focus();
  }

  window.sendOverlay = { show: show, hide: hide, showDoi: showDoi };
})();
