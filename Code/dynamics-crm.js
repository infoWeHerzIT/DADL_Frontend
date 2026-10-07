// ================================================================
// Dynamics CRM Integration (Dataverse via Supabase Edge Functions)
// ----------------------------------------------------------------
// Browser-JS darf nie direkt mit Client-Secret gegen die Dataverse Web API
// sprechen – das Secret wäre für jeden im Quelltext sichtbar. Stattdessen
// ruft diese Klasse die Supabase Edge Functions "crm-submit" bzw.
// "crm-survey-submit" auf, die serverseitig mit der bestehenden Dynamics-
// Verbindung die Datensätze anlegen/aktualisieren.
//
// Voraussetzung: supabase-config.js ist VOR dieser Datei eingebunden
// (stellt den globalen "db"-Client bereit).
//
// Alle Methoden sind fire-and-forget: Fehler werden geloggt, aber nie
// geworfen, damit ein CRM-Ausfall nie die Registrierung/Weiterleitung
// des Nutzers blockiert.
//
// ── DEV/PROD-Routing ────────────────────────────────────────────
// Welche Dynamics-Umgebung angesprochen wird, entscheidet NICHT der Client
// (der hat gar keinen Zugriff auf Secrets), sondern welche Edge Function
// aufgerufen wird: "crm-submit" schreibt gegen Dynamics PROD (eigene
// DYNAMICS_PROD_*-Secrets), "crm-submit-dev" gegen Dynamics DEV (die
// bereits vorhandenen DYNAMICS_*-Secrets) — siehe supabase/functions/crm-submit(-dev).
// Diese Klasse wählt nur den Funktionsnamen anhand der Umgebung, in der
// die Seite gerade läuft:
//   - localhost/127.0.0.1/file:// oder ?dynamics_env=dev  → *-dev (DEV)
//   - alles andere (z. B. infoweherzit.github.io)         → * (PROD)
// ================================================================

class DynamicsCRM {
  constructor(client, environment) {
    this.client = client || (typeof db !== 'undefined' ? db : null);
    this.environment = environment || DynamicsCRM.detectEnvironment();
    console.info('[DynamicsCRM] Ziel-Umgebung:', this.environment);
  }

  static detectEnvironment() {
    try {
      var override = new URLSearchParams(window.location.search).get('dynamics_env');
      if (override === 'dev' || override === 'prod') return override;

      var host = window.location.hostname;
      var isLocal = window.location.protocol === 'file:' || host === 'localhost' || host === '127.0.0.1' || host === '';
      return isLocal ? 'dev' : 'prod';
    } catch (e) {
      return 'prod';
    }
  }

  _functionName(base) {
    return this.environment === 'dev' ? base + '-dev' : base;
  }

  // Legt einen Lead (wht_lead) an (supabase/functions/crm-submit[-dev]).
  // eventId: Supabase-Event-ID (z. B. "evt_..."), der die Anmeldung zugeordnet
  // ist — wird als wht_eventid mitgeschickt (optional).
  // quelle: numerische ID aus dem "Wie hast du von uns erfahren?"-Feld (optional).
  // interesseAnCoachingOptIn / einwilligungDatenverarbeitungOptIn /
  // newsletterOptIn / testimonialOptIn: true, wenn die jeweilige Checkbox
  // beim Absenden gesetzt war — die Function trägt dafür serverseitig das
  // aktuelle Datum ein (Dynamics speichert dort den Zeitpunkt der
  // Zustimmung, kein Bool). Alle vier sind optional; wird ein Feld nicht
  // angegeben, bleibt es in Dynamics einfach leer.
  // leadType: 'contact' oder 'account' (optional) — setzt wht_leadtype.
  // firmenname: bei leadType='account' (optional) — landet in wht_accountname.
  // widerrufsverzichtOptIn: true, wenn die Widerrufsverzicht-Checkbox beim
  // Absenden gesetzt war (nur bei Privatperson relevant) — landet wie die
  // anderen OptIn-Felder als Zeitstempel in wht_optinrightofwithdrawaldatetime.
  // Existiert aktuell nur in Dynamics DEV, noch nicht in PROD.
  // emailOptIn: true, wenn "Sag mir Bescheid, sobald das Buch
  // erscheint" gesetzt war — landet als Zeitstempel in wht_optinemaildatetime.
  // leadConnectionId: GUID eines anderen, vorher angelegten Leads (optional)
  // — verknüpft diesen Lead per wht_leadconnection damit (z. B. Empfänger-
  // Lead → Besteller-Lead beim Verschenken-Fall). Existiert aktuell nur in
  // Dynamics DEV, noch nicht in PROD.
  // extra: beliebiges flaches Objekt (z. B. { strasse, hausnr, plz, stadt,
  // land, ustIdNr, nachricht }) — landet in DEV auf eigenen Feldern
  // (wht_street1, wht_city usw.), alles sonst Unbekannte gebündelt als JSON
  // in wht_jsoncontent.
  //
  // Anders als die übrigen fire-and-forget-Methoden hier: wirft NIE, gibt
  // aber ein Ergebnisobjekt { success, id } zurück (id = neue Lead-GUID),
  // damit Aufrufer bei Erfolg z. B. einen zweiten, verknüpften Lead anlegen
  // können, ohne dafür auf CRM-Fehler mit try/catch reagieren zu müssen.
  submitLead(fields) {
    fields = fields || {};
    return this.client.functions.invoke(this._functionName('crm-submit'), {
      body: {
        firstname:                          fields.firstname   || '',
        lastname:                           fields.lastname    || '',
        email:                              fields.email       || '',
        mobilephone:                        fields.mobilephone || '',
        eventId:                            fields.eventId      || '',
        quelle:                             fields.quelle != null && fields.quelle !== '' ? fields.quelle : null,
        interesseAnCoachingOptIn:           !!fields.interesseAnCoachingOptIn,
        einwilligungDatenverarbeitungOptIn: !!fields.einwilligungDatenverarbeitungOptIn,
        newsletterOptIn:                    !!fields.newsletterOptIn,
        testimonialOptIn:                   !!fields.testimonialOptIn,
        widerrufsverzichtOptIn:             !!fields.widerrufsverzichtOptIn,
        emailOptIn:                         !!fields.emailOptIn,
        leadType:                           fields.leadType         || '',
        leadConnectionId:                   fields.leadConnectionId || '',
        firmenname:                         fields.firmenname       || '',
        extra:                              fields.extra            || null
      }
    }).then(function (res) {
      if (res.error) throw res.error;
      return { success: true, id: (res.data && res.data.id) || null };
    }).catch(function (err) {
      console.error('CRM submit error:', err);
      return { success: false, id: null };
    });
  }

  // Legt einen Lead (wht_lead) mit den übergebenen Umfrage-Antworten als JSON
  // (wht_jsoncontent) an (supabase/functions/crm-survey-submit[-dev]).
  // eventId: Dynamics-Event-GUID (wht_eventid), der die Umfrage zugeordnet
  // ist — wird als wht_EventId-Lookup mitgeschickt (optional).
  submitSurvey(fields) {
    fields = fields || {};
    return this.client.functions.invoke(this._functionName('crm-survey-submit'), {
      body: {
        firstname:   fields.firstname   || '',
        lastname:    fields.lastname    || '',
        email:       fields.email       || '',
        mobilephone: fields.mobilephone || '',
        eventId:     fields.eventId     || '',
        survey:      fields.survey      || {}
      }
    }).catch(function (err) {
      console.error('CRM submit error:', err);
    });
  }

  // Liest alle Events aus Dynamics (Entität wht_event, read-only) —
  // supabase/functions/dynamics-events-list[-dev]. Gibt bei Fehlern ein
  // leeres Array zurück statt zu werfen, damit eine Kalenderseite nie mit
  // einer Exception hängen bleibt.
  listEvents() {
    return this.client.functions.invoke(this._functionName('dynamics-events-list'), {
      method: 'GET'
    }).then(function (res) {
      if (res.error) throw res.error;
      return res.data || [];
    }).catch(function (err) {
      console.error('CRM list events error:', err);
      return [];
    });
  }

  // Liest alle aktiven Produkte aus Dynamics (Entität "wht_product",
  // read-only) — supabase/functions/dynamics-products-list[-dev]. Jedes
  // Produkt liefert { id, name, url }. Gibt bei Fehlern ein leeres Array
  // zurück statt zu werfen, analog zu listEvents().
  listProducts() {
    return this.client.functions.invoke(this._functionName('dynamics-products-list'), {
      method: 'GET'
    }).then(function (res) {
      if (res.error) throw res.error;
      return res.data || [];
    }).catch(function (err) {
      console.error('CRM list products error:', err);
      return [];
    });
  }

  // Liest alle Leads (wht_lead), die einem Event zugeordnet sind (read-only)
  // — supabase/functions/dynamics-leads-by-event[-dev]. Jeder Lead trägt
  // "active" (true = per Double-Opt-In bestätigt, siehe confirmLead()).
  // Gibt bei Fehlern ein leeres Array zurück statt zu werfen, analog zu
  // listEvents().
  listLeadsByEvent(eventId) {
    var fnName = this._functionName('dynamics-leads-by-event') + '?eventId=' + encodeURIComponent(eventId || '');
    return this.client.functions.invoke(fnName, {
      method: 'GET'
    }).then(function (res) {
      if (res.error) throw res.error;
      return res.data || [];
    }).catch(function (err) {
      console.error('CRM list leads by event error:', err);
      return [];
    });
  }

  // Liest einen einzelnen Lead (wht_lead) anhand seiner GUID (read-only) —
  // supabase/functions/dynamics-lead-get[-dev]. Dient Templates/feedback.html:
  // personalisierte Feedback-Links ("?event_id=<GUID>&lead_id=<GUID>") tragen
  // Name/E-Mail/Telefon automatisch ein, analog zum alten (seit der
  // Dynamics-Migration toten) presetParticipantId-Pfad, aber aus Dynamics
  // statt der ungenutzten Supabase-"participants"-Tabelle.
  // Gibt bei Fehlern ODER wenn kein Lead mit dieser ID existiert bewusst
  // "null" zurück (kein Wurf) — ein falscher/abgelaufener Link darf die
  // Feedback-Seite nie blockieren, sie zeigt dann einfach die normalen
  // (leeren) Kontaktfelder an.
  getLeadById(leadId) {
    var fnName = this._functionName('dynamics-lead-get') + '?leadId=' + encodeURIComponent(leadId || '');
    return this.client.functions.invoke(fnName, {
      method: 'GET'
    }).then(function (res) {
      if (res.error) throw res.error;
      return res.data || null;
    }).catch(function (err) {
      console.error('CRM get lead by id error:', err);
      return null;
    });
  }

  // Liest eine dynamische Umfrage-Definition (wht_survey + wht_surveyquestion
  // + wht_surveyquestionoption, read-only) anhand ihres Slugs —
  // supabase/functions/dynamics-survey-get[-dev]. Gibt bei Fehlern ODER wenn
  // keine Umfrage mit diesem Slug existiert bewusst "null" zurück (nicht ein
  // leeres Array/Objekt) — "nicht gefunden/Ladefehler" und "Umfrage ohne
  // Fragen" sind unterschiedliche Zustände, die die aufrufende Seite
  // unterschiedlich behandeln muss.
  // Löst bei "nicht gefunden" (404 — siehe dynamics-survey-get[-dev], kommt
  // z. B. bei falschem/veraltetem Slug oder deaktivierter Umfrage) bewusst zu
  // "null" auf statt zu werfen — das ist ein normales, erwartbares Ergebnis.
  // Jeder ANDERE Fehler (Netzwerkausfall, 502 von Dynamics usw.) wird
  // weitergereicht (Promise rejected), damit die aufrufende Seite ihn von
  // "existiert nicht" unterscheiden und z. B. einen Retry anbieten kann,
  // statt fälschlich "Umfrage nicht verfügbar" zu zeigen.
  getSurvey(slug) {
    var fnName = this._functionName('dynamics-survey-get') + '?slug=' + encodeURIComponent(slug || '');
    return this.client.functions.invoke(fnName, {
      method: 'GET'
    }).then(function (res) {
      if (res.error) throw res.error;
      return res.data || null;
    }).catch(function (err) {
      if (err && err.context && err.context.status === 404) return null;
      console.error('CRM get survey error:', err);
      throw err;
    });
  }

  // Wie getSurvey(), aber Lookup per Dynamics-GUID (wht_surveyid) statt per
  // Slug — für Seiten, die per "?id=<guid>" statt "?survey=<slug>" verlinkt
  // werden. Gleiches "null bei Fehler/nicht gefunden"-Verhalten wie getSurvey().
  // Gleiches "404 → null, alles andere → weiterreichen"-Verhalten wie
  // getSurvey() oben.
  getSurveyById(id) {
    var fnName = this._functionName('dynamics-survey-get') + '?id=' + encodeURIComponent(id || '');
    return this.client.functions.invoke(fnName, {
      method: 'GET'
    }).then(function (res) {
      if (res.error) throw res.error;
      return res.data || null;
    }).catch(function (err) {
      if (err && err.context && err.context.status === 404) return null;
      console.error('CRM get survey by id error:', err);
      throw err;
    });
  }

  // Legt eine Umfrage-Einreichung normalisiert in Dynamics an: 1 Lead
  // (Kontaktdaten) + 1 wht_surveyresponse (Klammer der Einreichung) + je
  // beantworteter Frage 1 (oder bei Mehrfachauswahl mehrere)
  // wht_surveyanswer-Zeile(n) — supabase/functions/crm-survey-response-submit[-dev].
  // fields.surveyId: Dynamics wht_surveyid-GUID (Pflicht).
  // fields.answers: Array aus { questionId, value } (Text/E-Mail/Telefon/
  // Nummer) ODER { questionId, optionIds: [...] } (Einmal-/Mehrfachauswahl).
  // fields.newsletterOptIn: true, wenn die Newsletter-Checkbox beim Absenden
  // gesetzt war — landet wie bei submitLead() als Zeitstempel in
  // wht_optinnewsletterdatetime (nur wenn dabei auch ein Lead entsteht,
  // also E-Mail oder Telefon angegeben wurde).
  // fields.emailOptIn: true, wenn die Checkbox "Ergebnisse dieser Umfrage
  // bekommen" aktiviert war — landet als Zeitstempel in
  // wht_optinemaildatetime und setzt damit den Lead als per E-Mail
  // zugestimmt für weitere Benachrichtigungen.
  submitSurveyResponse(fields) {
    fields = fields || {};
    return this.client.functions.invoke(this._functionName('crm-survey-response-submit'), {
      body: {
        firstname:        fields.firstname   || '',
        lastname:         fields.lastname    || '',
        email:            fields.email       || '',
        mobilephone:      fields.mobilephone || '',
        eventId:          fields.eventId     || '',
        surveyId:         fields.surveyId    || '',
        newsletterOptIn:  !!fields.newsletterOptIn,
        emailOptIn:       !!fields.emailOptIn,
        answers:          fields.answers     || []
      }
    }).catch(function (err) {
      console.error('CRM submit survey response error:', err);
    });
  }

  // Listet alle aktiven Umfragen (wht_survey, read-only) —
  // supabase/functions/dynamics-surveys-list[-dev]. Gibt bei Fehlern ein
  // leeres Array zurück statt zu werfen, analog zu listEvents().
  listSurveys() {
    return this.client.functions.invoke(this._functionName('dynamics-surveys-list'), {
      method: 'GET'
    }).then(function (res) {
      if (res.error) throw res.error;
      return res.data || [];
    }).catch(function (err) {
      console.error('CRM list surveys error:', err);
      return [];
    });
  }

  // Liest und aggregiert die Ergebnisse einer Umfrage anhand ihrer
  // Dynamics-GUID — supabase/functions/dynamics-survey-results[-dev].
  // Anders als getSurvey()/getSurveyById() (fürs Formular) liefert das hier
  // pro Frage bereits ausgewertete Daten: Häufigkeiten pro Option bei
  // Auswahl-Fragen, die Liste der Einzelantworten bei Text-Fragen. Gleiches
  // "null bei Fehler/nicht gefunden"-Verhalten wie getSurvey().
  getSurveyResults(id) {
    var fnName = this._functionName('dynamics-survey-results') + '?id=' + encodeURIComponent(id || '');
    return this.client.functions.invoke(fnName, {
      method: 'GET'
    }).then(function (res) {
      if (res.error) throw res.error;
      return res.data || null;
    }).catch(function (err) {
      console.error('CRM get survey results error:', err);
      return null;
    });
  }

  // Liefert die EINZELNEN Responses einer Umfrage (nicht aggregiert wie
  // getSurveyResults) — je Response die Lead-Daten (falls verknüpft) und
  // die Antworten je Frage — supabase/functions/dynamics-survey-responses[-dev].
  getSurveyResponses(id) {
    var fnName = this._functionName('dynamics-survey-responses') + '?id=' + encodeURIComponent(id || '');
    return this.client.functions.invoke(fnName, {
      method: 'GET'
    }).then(function (res) {
      if (res.error) throw res.error;
      return (res.data && res.data.responses) || [];
    }).catch(function (err) {
      console.error('CRM get survey responses error:', err);
      return [];
    });
  }

  // Kopiert/synchronisiert eine Umfrage (Titel, Intro, Beschreibung, alle
  // Fragen + Optionen) von Dynamics DEV nach Dynamics PROD —
  // supabase/functions/dynamics-survey-push-to-prod. Anders als die übrigen
  // Methoden hier gibt es dafür KEIN "-dev"-Gegenstück (_functionName()):
  // die Function liest IMMER aus DEV und schreibt IMMER nach PROD, deshalb
  // wird ihr fester Name direkt aufgerufen, unabhängig von this.environment.
  // id: DEV-GUID (wht_surveyid) der zu übertragenden Umfrage (Pflicht).
  // Wirft nie — liefert bei Fehlern { success:false, error }.
  pushSurveyToProd(id) {
    return this.client.functions.invoke('dynamics-survey-push-to-prod', {
      body: { id: id || '' }
    }).then(function (res) {
      if (res.error) throw res.error;
      return res.data;
    }).catch(function (err) {
      console.error('CRM push survey to prod error:', err);
      return { success: false, error: String((err && err.message) || err) };
    });
  }

  // Bestätigt die Double-Opt-In-E-Mail eines Leads: prüft, ob "token"
  // (die Lead-GUID) zu einem Lead mit der übergebenen E-Mail-Adresse
  // gehört, und setzt bei Erfolg wht_doubleoptinaccepted —
  // supabase/functions/crm-lead-confirm[-dev]. Anders als die übrigen
  // Methoden hier NICHT silent-catch: verify-email.html muss das Ergebnis
  // (Erfolg/bereits bestätigt/Fehler) anzeigen.
  confirmLead(email, token) {
    return this.client.functions.invoke(this._functionName('crm-lead-confirm'), {
      body: { email: email || '', token: token || '' }
    }).then(function (res) {
      if (res.error) throw res.error;
      return res.data;
    }).catch(function (err) {
      console.error('CRM confirm lead error:', err);
      return { success: false, error: String(err) };
    });
  }
}

var dynamicsCRM = new DynamicsCRM();
