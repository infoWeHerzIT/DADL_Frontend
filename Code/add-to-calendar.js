/*
 * Add-to-Calendar Button — wiederverwendbare Komponente
 * Rendert einen Button mit Dropdown (Google, Apple/iCal, Outlook, Outlook.com,
 * Office 365, Yahoo) analog zu addevent.com — vollständig clientseitig,
 * kein externer Account/Service nötig.
 *
 * Verwendung:
 *   <div id="add-to-calendar"></div>
 *   <script src="Code/add-to-calendar.js"></script>
 *   <script>
 *     renderAddToCalendarButton('add-to-calendar', {
 *       title: 'Das Webinar',
 *       description: 'Beschreibungstext …',
 *       location: 'Online · Zoom',
 *       url: 'https://zoom.us/…',           // optional, wird an description angehängt
 *       year: 2026, month: 6, day: 21,      // month ist 0-indexiert (0 = Januar)
 *       timeFrom: '09:00', timeTo: '12:00', // 'HH:MM', timeTo optional
 *       timeZone: 'Europe/Berlin',          // optional, Default Europe/Berlin
 *       label: 'Zum Kalender hinzufügen'    // optional Button-Text
 *     });
 *   </script>
 */
(function (global) {
  'use strict';

  function injectStyles() {
    if (document.getElementById('atc-styles')) return;
    var style = document.createElement('style');
    style.id = 'atc-styles';
    style.textContent = [
      '.atc-wrap{position:relative;display:inline-block;font-family:"Source Sans 3", Arimo, Arial, Helvetica, sans-serif;}',
      '.atc-btn{display:inline-flex;align-items:center;gap:10px;background:var(--orange,#ff6300);color:#fff;',
      'border:none;padding:15px 30px;font-size:15px;font-weight:500;letter-spacing:.04em;cursor:pointer;',
      'border-radius:2px;text-decoration:none;transition:background .2s,transform .2s;}',
      '.atc-btn:hover{background:#e55700;transform:translateY(-1px);}',
      '.atc-btn svg{flex:none;}',
      '.atc-chevron{transition:transform .18s;}',
      '.atc-wrap.open .atc-chevron{transform:rotate(180deg);}',
      '.atc-menu{position:absolute;top:calc(100% + 8px);left:0;min-width:240px;background:#fff;',
      'border:1px solid rgba(0,34,77,.1);border-radius:2px;box-shadow:0 12px 32px rgba(0,34,77,.14);',
      'padding:6px;z-index:1000;opacity:0;visibility:hidden;transform:translateY(-6px);',
      'transition:opacity .16s,transform .16s,visibility .16s;}',
      '.atc-wrap.open .atc-menu{opacity:1;visibility:visible;transform:translateY(0);}',
      '.atc-item{display:flex;align-items:center;gap:12px;width:100%;padding:11px 12px;background:none;',
      'border:none;text-align:left;font-family:"Source Sans 3", Arimo, Arial, Helvetica, sans-serif;font-size:14.5px;color:var(--navy,#00224d);',
      'border-radius:2px;cursor:pointer;text-decoration:none;transition:background .15s;}',
      '.atc-item:hover{background:var(--orange-dim,rgba(255,99,0,.1));}',
      '.atc-item svg{flex:none;}',
      '.atc-item span{flex:1;}'
    ].join('');
    document.head.appendChild(style);
  }

  var ICONS = {
    calendar: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    chevron: '<svg class="atc-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>',
    google: '<svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22 12.2c0-.7-.06-1.4-.18-2H12v3.9h5.6a4.8 4.8 0 0 1-2.1 3.1v2.6h3.4c2-1.8 3.1-4.5 3.1-7.6z"/><path fill="#34A853" d="M12 22c2.8 0 5.2-.9 6.9-2.5l-3.4-2.6c-.9.6-2.1 1-3.5 1-2.7 0-5-1.8-5.8-4.3H2.7v2.7A10 10 0 0 0 12 22z"/><path fill="#FBBC05" d="M6.2 13.6a6 6 0 0 1 0-3.8V7.1H2.7a10 10 0 0 0 0 9l3.5-2.5z"/><path fill="#EA4335" d="M12 6.4c1.5 0 2.9.5 4 1.5l3-3A10 10 0 0 0 2.7 7.1l3.5 2.7c.7-2.5 3-4.4 5.8-4.4z"/></svg>',
    apple: '<svg width="16" height="18" viewBox="0 0 384 512" fill="currentColor"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>',
    outlook: '<svg width="18" height="18" viewBox="0 0 24 24"><path fill="#0078D4" d="M21.5 5.5h-9.8L11 4H3a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h8l1-1.5h9.5a.5.5 0 0 0 .5-.5v-12a.5.5 0 0 0-.5-.5z"/><circle cx="7.2" cy="12" r="4" fill="#fff"/><path fill="#0078D4" d="M7.2 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8zm0 5.4a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/></svg>',
    yahoo: '<svg width="18" height="18" viewBox="0 0 24 24"><path fill="#720E9E" d="M12 2 4 8l8 14 8-14z" opacity=".15"/><text x="12" y="16" text-anchor="middle" font-size="11" font-weight="700" fill="#720E9E" font-family="Arial">Y!</text></svg>'
  };

  function pad(n) { return String(n).padStart(2, '0'); }

  // Offset (ms) of `timeZone` from UTC at the given instant, computed via Intl so it
  // does not depend on the host system's own timezone.
  function getTimeZoneOffset(date, timeZone) {
    var dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    var map = {};
    dtf.formatToParts(date).forEach(function (p) { map[p.type] = p.value; });
    var asUtc = Date.UTC(map.year, map.month - 1, map.day, map.hour, map.minute, map.second);
    return asUtc - date.getTime();
  }

  // Interprets Y/M/D/H/Min as wall-clock time in `timeZone`, returns the equivalent UTC Date.
  function zonedTimeToUtc(year, month, day, hour, minute, timeZone) {
    var guess = Date.UTC(year, month, day, hour, minute, 0);
    var offset = getTimeZoneOffset(new Date(guess), timeZone);
    return new Date(guess - offset);
  }

  function formatUtcCompact(date) {
    return date.getUTCFullYear() + pad(date.getUTCMonth() + 1) + pad(date.getUTCDate()) +
      'T' + pad(date.getUTCHours()) + pad(date.getUTCMinutes()) + pad(date.getUTCSeconds()) + 'Z';
  }

  function escapeIcs(str) {
    return String(str || '')
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  function foldIcsLine(line) {
    // RFC 5545: lines >75 octets should be folded; keep it simple, split every 73 chars.
    if (line.length <= 75) return line;
    var out = '';
    var rest = line;
    while (rest.length > 73) {
      out += rest.substring(0, 73) + '\r\n ';
      rest = rest.substring(73);
    }
    return out + rest;
  }

  function buildEventTimes(opts) {
    var tz = opts.timeZone || 'Europe/Berlin';
    var from = (opts.timeFrom || '09:00').split(':');
    var fromH = parseInt(from[0], 10) || 0;
    var fromM = parseInt(from[1], 10) || 0;

    var start = zonedTimeToUtc(opts.year, opts.month, opts.day, fromH, fromM, tz);

    var end;
    if (opts.timeTo) {
      var to = opts.timeTo.split(':');
      var toH = parseInt(to[0], 10) || 0;
      var toM = parseInt(to[1], 10) || 0;
      end = zonedTimeToUtc(opts.year, opts.month, opts.day, toH, toM, tz);
      if (end <= start) end = new Date(start.getTime() + 60 * 60 * 1000);
    } else {
      end = new Date(start.getTime() + 60 * 60 * 1000);
    }
    return { start: start, end: end };
  }

  function buildDescription(opts) {
    var desc = opts.description || '';
    if (opts.url) desc = (desc ? desc + '\n\n' : '') + opts.url;
    return desc;
  }

  function buildVEvent(opts, times) {
    var uid = (global.crypto && global.crypto.randomUUID ? global.crypto.randomUUID() : (Date.now() + '-' + Math.random().toString(36).slice(2))) + '@adrianaundsorin';
    return [
      'BEGIN:VEVENT',
      'UID:' + uid,
      'DTSTAMP:' + formatUtcCompact(new Date()),
      'DTSTART:' + formatUtcCompact(times.start),
      'DTEND:' + formatUtcCompact(times.end),
      'SUMMARY:' + escapeIcs(opts.title),
      'DESCRIPTION:' + escapeIcs(buildDescription(opts)),
      'LOCATION:' + escapeIcs(opts.location),
      'END:VEVENT'
    ];
  }

  function buildIcs(opts, times) {
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Der Architekt deines Lebens//Add to Calendar//DE',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH'
    ].concat(buildVEvent(opts, times), ['END:VCALENDAR']);
    return lines.map(foldIcsLine).join('\r\n');
  }

  // Baut eine einzelne .ics-Datei mit mehreren VEVENT-Blöcken (ein Termin je Eintrag in `eventsList`).
  function buildIcsMulti(eventsList) {
    var body = [];
    eventsList.forEach(function (opts) {
      body = body.concat(buildVEvent(opts, buildEventTimes(opts)));
    });
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Der Architekt deines Lebens//Add to Calendar//DE',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH'
    ].concat(body, ['END:VCALENDAR']);
    return lines.map(foldIcsLine).join('\r\n');
  }

  function downloadBlob(text, filename) {
    var blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function downloadIcs(opts, times) {
    downloadBlob(buildIcs(opts, times), (opts.title || 'termin').replace(/[^\w\-]+/g, '_') + '.ics');
  }

  function downloadIcsMulti(eventsList, filename) {
    downloadBlob(buildIcsMulti(eventsList), (filename || 'termine').replace(/[^\w\-]+/g, '_') + '.ics');
  }

  function googleUrl(opts, times) {
    var params = new URLSearchParams({
      action: 'TEMPLATE',
      text: opts.title || '',
      dates: formatUtcCompact(times.start) + '/' + formatUtcCompact(times.end),
      details: buildDescription(opts),
      location: opts.location || ''
    });
    return 'https://calendar.google.com/calendar/render?' + params.toString();
  }

  function outlookWebUrl(opts, times, host) {
    var params = new URLSearchParams({
      path: '/calendar/action/compose',
      rru: 'addevent',
      subject: opts.title || '',
      body: buildDescription(opts),
      location: opts.location || '',
      startdt: times.start.toISOString(),
      enddt: times.end.toISOString(),
      allday: 'false'
    });
    return 'https://' + host + '/calendar/0/deeplink/compose?' + params.toString();
  }

  function yahooUrl(opts, times) {
    var params = new URLSearchParams({
      v: '60',
      view: 'd',
      type: '20',
      title: opts.title || '',
      st: formatUtcCompact(times.start),
      et: formatUtcCompact(times.end),
      desc: buildDescription(opts),
      in_loc: opts.location || ''
    });
    return 'https://calendar.yahoo.com/?' + params.toString();
  }

  function closeAll() {
    document.querySelectorAll('.atc-wrap.open').forEach(function (w) { w.classList.remove('open'); });
  }

  // Pure link builder (no DOM/button) — for contexts like emails where only
  // static hrefs work, e.g. the "Nächste Schritte" section in emailjs-template.html.
  function buildAddToCalendarLinks(opts) {
    var times = buildEventTimes(opts);
    var ics = buildIcs(opts, times);
    return {
      google:     googleUrl(opts, times),
      outlookCom: outlookWebUrl(opts, times, 'outlook.live.com'),
      office365:  outlookWebUrl(opts, times, 'outlook.office.com'),
      yahoo:      yahooUrl(opts, times),
      ics:        'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics)
    };
  }

  function renderAddToCalendarButton(target, opts) {
    injectStyles();
    var container = typeof target === 'string' ? document.getElementById(target) : target;
    if (!container) return;

    var times = buildEventTimes(opts);
    var label = opts.label || 'Zum Kalender hinzufügen';

    var wrap = document.createElement('div');
    wrap.className = 'atc-wrap';
    wrap.innerHTML =
      '<button type="button" class="atc-btn">' + ICONS.calendar + '<span>' + label + '</span>' + ICONS.chevron + '</button>' +
      '<div class="atc-menu">' +
        '<button type="button" class="atc-item" data-provider="google">' + ICONS.google + '<span>Google Calendar</span></button>' +
        '<button type="button" class="atc-item" data-provider="ical">' + ICONS.apple + '<span>Apple Kalender (iCal)</span></button>' +
        '<button type="button" class="atc-item" data-provider="outlookcom">' + ICONS.outlook + '<span>Outlook.com</span></button>' +
        '<button type="button" class="atc-item" data-provider="office365">' + ICONS.outlook + '<span>Office 365</span></button>' +
        '<button type="button" class="atc-item" data-provider="outlook">' + ICONS.outlook + '<span>Outlook (Desktop / .ics)</span></button>' +
        '<button type="button" class="atc-item" data-provider="yahoo">' + ICONS.yahoo + '<span>Yahoo Calendar</span></button>' +
      '</div>';

    container.innerHTML = '';
    container.appendChild(wrap);

    var btn = wrap.querySelector('.atc-btn');
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var wasOpen = wrap.classList.contains('open');
      closeAll();
      if (!wasOpen) wrap.classList.add('open');
    });

    wrap.querySelectorAll('.atc-item').forEach(function (item) {
      item.addEventListener('click', function () {
        var provider = item.getAttribute('data-provider');
        var freshTimes = buildEventTimes(opts);
        switch (provider) {
          case 'google':
            window.open(googleUrl(opts, freshTimes), '_blank', 'noopener');
            break;
          case 'outlookcom':
            window.open(outlookWebUrl(opts, freshTimes, 'outlook.live.com'), '_blank', 'noopener');
            break;
          case 'office365':
            window.open(outlookWebUrl(opts, freshTimes, 'outlook.office.com'), '_blank', 'noopener');
            break;
          case 'yahoo':
            window.open(yahooUrl(opts, freshTimes), '_blank', 'noopener');
            break;
          case 'ical':
          case 'outlook':
            downloadIcs(opts, freshTimes);
            break;
        }
        closeAll();
      });
    });

    return wrap;
  }

  // Einzelner Button (kein Dropdown) zum Download einer .ics-Datei mit mehreren Terminen —
  // Web-Kalender (Google/Outlook.com/Yahoo) unterstützen nur einen Termin pro Deeplink,
  // daher hier nur der universelle .ics-Download (funktioniert mit Apple Kalender, Outlook, Google-Import).
  function renderAddAllToCalendarButton(target, eventsList, opts) {
    injectStyles();
    var container = typeof target === 'string' ? document.getElementById(target) : target;
    if (!container) return;

    opts = opts || {};
    var label = opts.label || 'Alle Termine zum Kalender hinzufügen';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'atc-btn';
    btn.innerHTML = ICONS.calendar + '<span>' + label + '</span>';

    container.innerHTML = '';
    container.appendChild(btn);

    btn.addEventListener('click', function () {
      downloadIcsMulti(eventsList, opts.filename);
    });

    return btn;
  }

  document.addEventListener('click', closeAll);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAll(); });

  global.renderAddToCalendarButton = renderAddToCalendarButton;
  global.renderAddAllToCalendarButton = renderAddAllToCalendarButton;
  global.buildAddToCalendarLinks = buildAddToCalendarLinks;
})(window);
