// ================================================================
// Auswertungen für Templates/umfrage-dynamisch.html
// ----------------------------------------------------------------
// Pro Umfrage-Slug (wht_survey.wht_slug) optional eine Konfiguration.
// Umfragen OHNE Eintrag hier verhalten sich wie bisher (Danke-Seite).
// Mit Eintrag zeigt die Seite nach dem Absenden direkt ein Ergebnis an
// und – falls konfiguriert – die Terminbuchung.
//
// Fragen und Optionen werden über ihre Reihenfolge in Dynamics angesprochen
// (wht_surveyquestion.wht_order bzw. wht_surveyquestionoption.wht_order),
// nicht über GUIDs – die sind in DEV und PROD verschieden.
//
// Felder:
//   headerImage:      Kopfbild ganz oben (seitenbreit, max. 350px hoch,
//                     wird bei Bedarf beschnitten). Pfad relativ zu
//                     Templates/ oder absolute URL. Ohne Angabe kein Bild.
//   sections:         Zeigt die Umfrage Schritt für Schritt in Abschnitten
//                     (wie Tools/wo-stehst-du-gerade.html) statt alle Fragen
//                     auf einer Seite. Die erste Seite ist immer die
//                     Beschreibung der Umfrage (wht_description), die zweite
//                     das Intro (wht_intro) – nur wenn es in Dynamics gefüllt
//                     ist. Danach ein Abschnitt pro Eintrag:
//                       [{ title: 'Leichter Einstieg', questions: [1, 2] }, …]
//                     questions = Reihenfolge-Nummern (wht_order) der Fragen.
//                     Fragen, die in keinem Abschnitt stehen, kommen
//                     automatisch in den letzten Abschnitt. Kontaktfelder und
//                     Absenden-Knopf stehen immer im letzten Abschnitt.
//                     Ohne "sections" bleibt alles auf einer Seite.
//   hideResultsOptIn: true blendet die Checkbox „Ergebnisse dieser Umfrage
//                     bekommen“ aus.
//   submitLabel:      Text des Absenden-Knopfs.
//   hiddenQuestions:  Reihenfolge-Nummern von Fragen, die es in Dynamics gibt,
//                     die hier aber nicht gezeigt (und nicht geprüft) werden.
//   contactStep:      { title, heading, text, required[], consent } – macht
//                     die Kontaktdaten zu einer eigenen letzten Seite mit nur
//                     Vorname, E-Mail, Telefon und Einwilligung (braucht
//                     "sections"). required: 'name' | 'email' | 'phone'.
//                     phoneHint: Erklärung unter dem Telefon-Feld.
//                     consent: Text der Pflicht-Checkbox; der Link zur
//                     Datenschutzerklärung wird automatisch angehängt.
//                     consentHidden: true = Häkchen ist vorab gesetzt und
//                     die Zeile wird nicht angezeigt.
//   booking:          { url, intro, askQuestion, yesOption, heading,
//                     centerButton, recommendation, buttonLabel, laterLabel,
//                     laterText } – Terminbuchung. recommendation = Absatz
//                     über dem Knopf, laterLabel = kleiner Link darunter
//                     („Jetzt noch nicht“), laterText = Abschlusszeile danach.
//                     Ist askQuestion gesetzt, wird die Buchung nur direkt
//                     geöffnet, wenn bei dieser Frage die Option yesOption
//                     gewählt wurde; sonst gibt es einen Knopf dafür.
//                     heading: Überschrift über dem Buchungsblock (ohne
//                     Angabe „Was du jetzt damit machen kannst“, '' = keine).
//                     centerButton: true zentriert den Termin-Knopf.
//   footerNote:       Kleine Fußzeile auf jeder Seite der Umfrage (alle
//                     Schritte und das Ergebnis), z. B. Sicherheitshinweis.
//   evaluate(ctx):    liefert das Ergebnis als reines Text-Objekt:
//                     { eyebrow, greeting, title, paragraphs[], focusTitle,
//                       focus[], quoteTitle, quote,
//                       mapTitle, mapHint,
//                       map[{name,label,tone:'yes'|'some'|'no'}],
//                       cards[{title,text}], notes[{title,text}], closing }
//                     focus = kurze Liste von Namen (z. B. Räume), die in
//                     einer Zeile mit „·“ getrennt unter focusTitle steht.
//   ctx.choice(n)     → Reihenfolge-Nr. (1, 2, …) der gewählten Option bei
//                       Frage n, oder null.
//   ctx.choices(n)    → alle gewählten Reihenfolge-Nrn. bei Frage n
//                       (Mehrfachauswahl), oder [].
//   ctx.text(n)       → Freitext-Antwort bei Frage n, oder ''.
//   ctx.contact       → { vorname } aus den Kontaktfeldern.
//   map[].tone        → 'yes' | 'some' | 'no' | 'na' (na = ohne Angabe)
// ================================================================

window.SURVEY_RESULT_CONFIGS = {

  'wo-kommst-du-noch-vor': {
    hideResultsOptIn: true,
    submitLabel: 'Mein Ergebnis zeigen →',
    sections: [
      { title: 'Dein Kopf',            questions: [1, 2] },
      { title: 'Dein „Irgendwann“',    questions: [3, 4] },
      { title: 'Was du willst',        questions: [5, 6] },
      { title: 'Deine Räume (1/2)',    questions: [7, 8, 9] },
      { title: 'Deine Räume (2/2)',    questions: [10, 11, 12] },
      { title: 'Deine Skala',          questions: [13, 14] },
      { title: 'Wo du stehst',         questions: [15] },
      { title: 'Einladung',            questions: [16, 17, 18] }
    ],
    booking: {
      url: 'https://bookings.cloud.microsoft/book/Geaeaf2cdf7e54e6eba9ac4fcc962ebf2@weherzit.de/?ismsaljsauthenabled',
      intro: 'Das Gespräch dauert 30 Minuten und findet über Teams statt. Wir schauen mit deinem Ergebnis ehrlich, wo du stehst, und du gehst mit einem ersten Schritt raus. Ein Angebot gibt es dabei nicht.',
      askQuestion: 16,
      yesOption: 1
    },
    evaluate: function (ctx) {
      var areas = [
        { order: 7,  name: 'Arbeit' },
        { order: 8,  name: 'Partnerschaft' },
        { order: 9,  name: 'Kinder oder Eltern' },
        { order: 10, name: 'Freundschaften' },
        { order: 11, name: 'Deine Wünsche' },
        { order: 12, name: 'Zeit nur für dich' }
      ];
      var count = 0;
      var map = areas.map(function (a) {
        var c = ctx.choice(a.order);
        if (c === 1) return { name: a.name, label: 'Du wohnst hier', tone: 'yes' };
        if (c === 2) { count++; return { name: a.name, label: 'Kaum noch', tone: 'some' }; }
        if (c === 3) { count++; return { name: a.name, label: 'Nur noch zuständig', tone: 'no' }; }
        return { name: a.name, label: 'Trifft nicht zu', tone: 'some' };
      });

      var title, text;
      if (count <= 1) {
        title = 'In deinem Leben wohnst du noch.';
        text = 'Das ist seltener, als du vielleicht denkst. Die meisten Räume gehören auch dir – nicht nur den anderen. Und trotzdem hast du diesen Selbsttest gemacht. Vielleicht lohnt sich die Frage, welcher Raum sich leiser anfühlt, als er auf dem Grundriss aussieht.';
      } else if (count <= 3) {
        title = 'Du wohnst noch – aber in einigen Räumen wird es still.';
        text = 'An den meisten Stellen kommst du noch vor. An zwei, drei Stellen bist du vor allem zuständig. Genau hier lässt sich etwas verändern, ohne dass vorher etwas einstürzen muss. Viele Frauen schauen erst sehr viel später so genau hin.';
      } else {
        title = 'Du hältst dein Haus in Ordnung – für alle anderen.';
        text = 'In den meisten Räumen bist du zuständig, aber kaum noch zu Hause. Das sieht von außen niemand, weil alles läuft. Es ist kein Charakterfehler – es ist das Ergebnis einer Rolle, die sehr lange sehr gut funktioniert hat. Für alle außer für dich. Dass du das jetzt schwarz auf weiß siehst, ist kein Grund zur Scham. Es ist der erste ehrliche Blick auf deinen Bauplan.';
      }

      var paragraphs = [text];
      var today = ctx.choice(13), wish = ctx.choice(14);
      if (today && wish) {
        paragraphs.push('Heute gehört dir ' + today + ' von 5. In drei Monaten wünschst du dir ' + wish + '. Der Abstand dazwischen ist kein Versagen. Er ist dein Bauplan.');
      }

      // Deutlichstes Anzeichen: je zwei Fragen aus 1–6 bilden eine Gruppe,
      // Antwort 1/2/3 = Kenne ich nicht/Manchmal/Ständig zählt 0/1/2.
      var signs = [
        { title: 'Dein Kopf führt einen Kalender für Leben, die nicht deins sind.', text: 'Niemand hat dich gebeten, das alles im Kopf zu behalten. Du machst es, weil du es kannst – und weil es sonst niemand tut. Diese Arbeit taucht in keiner Bilanz auf, und sie hat keinen Feierabend.' },
        { title: 'Du hast einen Ordner mit der Aufschrift „irgendwann“.', text: 'Er wird jedes Jahr ein bisschen dicker. Und jedes Mal, wenn jemand anderes etwas braucht, wandert noch etwas hinein. Irgendwann ist kein Termin.' },
        { title: 'Die Antwort auf die Frage, was du willst, ist leise geworden.', text: 'Vielleicht hältst du es für Bescheidenheit. Am Anfang war es das womöglich auch. Die Antwort ist nicht weg. Sie wurde nur sehr lange nicht gefragt.' }
      ];
      var score = function (n) { var c = ctx.choice(n); return c ? c - 1 : 0; };
      var groups = [score(1) + score(2), score(3) + score(4), score(5) + score(6)];
      var strongest = 0;
      for (var g = 1; g < groups.length; g++) if (groups[g] > groups[strongest]) strongest = g;

      return {
        eyebrow: 'Dein Ergebnis',
        title: title,
        paragraphs: paragraphs,
        mapTitle: 'Dein Grundriss',
        mapHint: 'Wohnst du dort noch – oder bist du dort nur zuständig?',
        map: map,
        cards: [
          { title: 'Dein deutlichstes Anzeichen', text: signs[strongest].title + ' ' + signs[strongest].text },
          { title: 'Ein Raum hat mehr gezogen als die anderen.', text: 'Nicht der, der am leersten aussieht – der, bei dem du kurz gezögert hast. Merk ihn dir. Dort kann etwas anfangen. Du musst heute nichts damit tun.' }
        ],
        notes: [
          { title: 'Wenn es mehr ist als Alltag.', text: 'Wenn dich seit Wochen nichts mehr trägt oder du daran denkst, dir etwas anzutun: Dann ist das kein Fall für einen Selbsttest. Sprich bitte mit deiner Hausärztin oder einer Psychotherapeutin. Die TelefonSeelsorge ist kostenfrei und rund um die Uhr erreichbar – in Deutschland unter 0800 111 0 111, 0800 111 0 222 oder 116 123, in Österreich unter 142. Bei akuter Gefahr wähle den Notruf 112.' }
        ],
        closing: 'Bis bald – Lili & Sorin'
      };
    }
  },

  // Dynamics-Fassung von Tools/wo-stehst-du-gerade.html (DEV-Umfrage
  // 3f65a913-38df-f111-84ea-002248d89353, 16 Fragen). Abschnitte wie auf
  // der statischen Seite; Auswertung = „Dein Grundriss“ aus derselben Seite.
  'wo-stehst-du-gerade': {
    hideResultsOptIn: true,
    submitLabel: 'Mein Ergebnis ansehen',
    // Frage 15 („Magst du in einem Erstgespräch …?“) gibt es in Dynamics noch,
    // sie wird aber nicht mehr gezeigt: Die Einladung steht jetzt als
    // Empfehlung auf der Ergebnisseite.
    hiddenQuestions: [15],
    sections: [
      { title: 'Leichter Einstieg',       questions: [1, 2] },
      { title: 'Spiegel des Alltags',     questions: [3, 4] },
      { title: 'Rollen und Lasten',       questions: [5, 6] },
      { title: 'Was fehlt',               questions: [7, 8] },
      { title: 'Der berührende Moment',   questions: [9, 10] },
      { title: 'Wende nach vorn',         questions: [11, 12] },
      { title: 'Eigene Bereitschaft',     questions: [13, 14] },
      { title: 'Wo du stehst',            questions: [16] }
    ],
    contactStep: {
      title: 'Kontaktdaten',
      heading: 'Fast geschafft.',
      text: 'Damit Lili und Sorin sich dein Ergebnis vor eurem Gespräch in Ruhe ansehen können – und du es auch per E-Mail bekommst:',
      required: ['name', 'email'],
      phoneHint: 'Deine Telefonnummer inkl. Ländervorwahl (damit ich dir über WhatsApp bzgl. deiner Auswertung schreiben kann, falls E-Mail aus unerklärlichen Gründen nicht klappen sollte)',
      consentHidden: true,
      consent: 'Ich bin einverstanden, dass Lili & Sorin mich zu meinem Ergebnis und zum Erstgespräch per E-Mail oder Telefon kontaktieren. Das kann ich jederzeit widerrufen.'
    },
    booking: {
      url: 'https://calendly.com/sorin-ratiu/der-architekt-deines-lebens',
      heading: '',
      intro: 'Genau dort setzen wir an. Im Gespräch mit Sorin schaut ihr euch deine Antworten gemeinsam an: was davon zuerst dran ist und wie du anfangen kannst, ohne alles umzuwerfen. 30 Minuten über Teams. Du gehst mit einem ersten Schritt raus. Über Preise sprechen wir in diesem Gespräch nicht.',
      recommendation: 'Unsere Empfehlung: Such dir jetzt gleich deinen Termin aus – solange dein Ergebnis noch so frisch ist.',
      buttonLabel: 'Meinen Termin wählen',
      centerButton: true,
      laterLabel: 'Jetzt noch nicht',
      laterText: 'Bis bald – Lili & Sorin'
    },
    footerNote: 'Wenn es mehr ist als Alltag → TelefonSeelsorge 0800 111 0 111 · 0800 111 0 222 · 116 123 (DE) · 142 (AT) · Notruf 112',
    evaluate: function (ctx) {
      // Jede Antwort wird einem „Raum“ zugeordnet:
      // yes = Du wohnst hier · some = Kaum noch · no = Nur noch zuständig · na = ohne Angabe
      var pick = function (n, map) { var c = ctx.choice(n); return c && map[c] ? map[c] : 'na'; };
      var q2 = ctx.choices(2), q5 = ctx.choices(5);
      var has = function (arr, n) { return arr.indexOf(n) > -1; };
      var rooms = [
        { name: 'Dein Morgen',        tone: pick(1, { 1: 'yes', 4: 'some', 2: 'no', 3: 'no' }) },
        { name: 'Zeit nur für dich',  tone: pick(7, { 1: 'yes', 2: 'some', 3: 'no', 4: 'no' }) },
        { name: 'Dein Zuhause',       tone: pick(3, { 3: 'yes', 4: 'yes', 2: 'some', 1: 'no' }) },
        { name: 'Dein Kopf am Abend', tone: pick(4, { 1: 'yes', 2: 'some', 3: 'no' }) },
        { name: 'Gesehen werden',     tone: pick(6, { 1: 'yes', 2: 'some', 3: 'no' }) },
        { name: 'Deine Freude',       tone: !q2.length ? 'na' : (has(q2, 7) || has(q2, 8)) ? 'yes' : (has(q2, 5) || has(q2, 6)) ? 'some' : 'no' },
        { name: 'Einfach du',         tone: !q5.length ? 'na' : has(q5, 7) ? 'yes' : q5.length <= 2 ? 'some' : 'no' },
        { name: 'Deine Wünsche',      tone: pick(9, { 5: 'yes', 1: 'some', 2: 'some', 3: 'no', 4: 'no' }) }
      ];
      var labels = { yes: 'Du wohnst hier', some: 'Kaum noch', no: 'Nur noch zuständig', na: 'Ohne Angabe' };
      var count = 0, answered = 0;
      var map = rooms.map(function (r) {
        if (r.tone !== 'na') { answered++; if (r.tone !== 'yes') count++; }
        return { name: r.name, label: labels[r.tone], tone: r.tone };
      });

      // Kurzfassung (13.11.2026): Urteil + zwei Sätze, dann die drei Räume
      // mit den deutlichsten Antworten. Kein Grundriss, keine Karten – der
      // Sicherheitshinweis steht als footerNote auf jeder Seite.
      var share = answered ? count / answered : 0, title, text;
      if (share <= 0.25) {
        title = 'In deinem Leben wohnst du noch.';
        text = 'Die meisten Räume gehören auch dir – nicht nur den anderen. Und trotzdem hast du dir diese Fragen gestellt.';
      } else if (share <= 0.5) {
        title = 'Du wohnst noch – aber in einigen Räumen wird es still.';
        text = 'An vielen Stellen kommst du noch vor. An einigen bist du vor allem zuständig. Genau hier lässt sich etwas verändern, ohne dass vorher etwas einstürzen muss.';
      } else {
        title = 'Du hältst dein Haus in Ordnung – für alle anderen.';
        text = 'In vielen Räumen bist du zuständig, aber kaum noch zu Hause. Von außen sieht das niemand, weil alles läuft.';
      }

      // Deutlichste Antworten zuerst: „Nur noch zuständig“ vor „Kaum noch“,
      // bei Gleichstand in der Reihenfolge der Räume. Höchstens drei.
      var focus = map.filter(function (m) { return m.tone === 'no'; })
        .concat(map.filter(function (m) { return m.tone === 'some'; }))
        .slice(0, 3)
        .map(function (m) { return m.name; });

      var vorname = (ctx.contact && ctx.contact.vorname) || '';
      return {
        eyebrow: 'Ergebnis und Empfehlung',
        greeting: vorname ? vorname + ', hier ist dein Ergebnis.' : 'Hier ist dein Ergebnis.',
        title: title,
        paragraphs: [text],
        focusTitle: 'Wo du am wenigsten vorkommst:',
        focus: focus,
        // Freitext „Schreib in zwei, drei Sätzen, wo du gerade stehst“ –
        // in Dynamics Frage 16 (in der Textvorlage als Frage 15 gezählt).
        quoteTitle: 'Und das hier hast du dir selbst geschrieben:',
        quote: ctx.text(16).trim()
      };
    }
  }

};
