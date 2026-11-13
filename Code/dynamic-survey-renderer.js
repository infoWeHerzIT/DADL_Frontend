// ================================================================
// Dynamic Survey Renderer
// ----------------------------------------------------------------
// Baut aus einer Fragenliste (wie von dynamicsCRM.getSurvey() geliefert)
// ein Formular in ein gegebenes Container-Element und sammelt beim
// Absenden die Antworten in der Form, die
// dynamicsCRM.submitSurveyResponse({ answers: [...] }) erwartet:
//   { questionId, value }              — bei text/email/telefon/nummer
//   { questionId, options: [{id,label,additionalInfo?}] } — bei einmal-/
//     mehrfachauswahl (einmalauswahl: options mit genau einem Eintrag). Das
//     Label wird mitgeschickt, damit wht_surveyanswer.wht_value (Primary-
//     Name-Feld in Dynamics) auch bei Auswahl-Antworten befüllt werden kann.
//     additionalInfo ist nur gesetzt, wenn die Option
//     wht_addmoreinformation=ja hat UND der User dort etwas eingetragen hat.
//
// Nutzung:
//   var renderer = new DynamicSurveyRenderer(document.getElementById('root'));
//   renderer.renderQuestions(questions);
//   ...
//   if (!renderer.validate()) return;
//   var answers = renderer.getAnswers();
// ================================================================

class DynamicSurveyRenderer {
  constructor(container) {
    this.container = container;
    this.questions = [];
  }

  static esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Baut ein einzelnes Options-Item (Checkbox/Radio + Label). Optionen mit
  // wht_addmoreinformation=ja (o.allowsAdditionalInfo) bekommen zusätzlich
  // ein Freitextfeld unter dem Label (z. B. "Sonstiges, und zwar: ___") —
  // ist die Option ausgewählt, ist dieses Feld pflicht (siehe validate()),
  // erkennbar am "*" im kleinen Label darüber (gleiche Konvention wie bei
  // den übrigen Pflichtfeldern auf der Seite).
  static _optionItemHtml(fieldId, inputType, o) {
    var esc = DynamicSurveyRenderer.esc;
    var extraHtml = o.allowsAdditionalInfo
      ? '<div class="option-more-info-group">' +
          '<label class="option-more-info-label" for="dq-optinfo-' + esc(o.id) + '">Bitte gib hier mehr Details an <span class="req">*</span></label>' +
          '<input class="form-input option-more-info" type="text" id="dq-optinfo-' + esc(o.id) + '" placeholder="Details eingeben …">' +
          '<span class="field-error" id="err-optinfo-' + esc(o.id) + '">Bitte gib hier weitere Informationen an.</span>' +
        '</div>'
      : '';
    return (
      '<div class="option-item-wrap">' +
        '<label class="option-item"><input type="' + inputType + '" name="' + fieldId + '" value="' + esc(o.id) + '"> ' + esc(o.label) + '</label>' +
        extraHtml +
      '</div>'
    );
  }

  // onAnyChange: optionaler Callback, der bei jeder Interaktion mit einer
  // Frage aufgerufen wird (change/input) — z. B. um Kontaktfelder abhängig
  // von der Antwort dynamisch pflicht zu machen (siehe requiresContact()).
  renderQuestions(questions, onAnyChange) {
    this.questions = questions || [];
    var esc = DynamicSurveyRenderer.esc;
    var html = this.questions.map(function (q, idx) {
      var reqBadge = q.required ? ' <span class="req">*</span>' : '';
      var fieldId = 'dq-' + q.id;
      var errId = 'err-dq-' + q.id;
      var body = '';

      if (q.type === 'mehrfachauswahl') {
        body =
          '<div class="option-list" id="' + fieldId + '">' +
          (q.options || []).map(function (o) {
            return DynamicSurveyRenderer._optionItemHtml(fieldId, 'checkbox', o);
          }).join('') +
          '</div>';
      } else if (q.type === 'einmalauswahl') {
        body =
          '<div class="option-list" id="' + fieldId + '">' +
          (q.options || []).map(function (o) {
            return DynamicSurveyRenderer._optionItemHtml(fieldId, 'radio', o);
          }).join('') +
          '</div>';
      } else if (q.type === 'text') {
        body = '<textarea class="form-textarea" id="' + fieldId + '"></textarea>';
      } else if (q.type === 'email') {
        body = '<input class="form-input" type="email" id="' + fieldId + '" placeholder="max@beispiel.de">';
      } else if (q.type === 'telefon') {
        body = '<input class="form-input" type="tel" id="' + fieldId + '" placeholder="+49 123 456789">';
      } else if (q.type === 'nummer') {
        body = '<input class="form-input" type="number" id="' + fieldId + '">';
      } else {
        // Unbekannter/nicht erkannter Typ: sicherer Fallback statt eines
        // stillen Blindgängers (leeres/kaputtes Feld ohne Erklärung).
        console.warn('[DynamicSurveyRenderer] Unbekannter Fragetyp "' + q.type + '" bei Frage ' + q.id + ' — falle auf Textfeld zurück.');
        body = '<input class="form-input" type="text" id="' + fieldId + '">';
      }

      var hintHtml = q.hint ? '<p class="question-hint">' + esc(q.hint) + '</p>' : '';

      return (
        '<div class="form-group" data-question-id="' + esc(q.id) + '" data-question-type="' + esc(q.type) + '">' +
        '<label class="question-label">' + (idx + 1) + '. ' + esc(q.label) + reqBadge + '</label>' +
        hintHtml +
        body +
        '<span class="field-error" id="' + errId + '">Bitte beantworte diese Frage.</span>' +
        '</div>'
      );
    }).join('');

    this.container.innerHTML = html;

    // Fehler beim Interagieren wieder entfernen + Freitextfelder (wht_add-
    // moreinformation) ein-/ausblenden, je nachdem ob ihre Option gerade
    // ausgewählt ist.
    var self = this;
    this.questions.forEach(function (q) {
      var fieldId = 'dq-' + q.id;
      var group = self.container.querySelector('[data-question-id="' + q.id.replace(/"/g, '') + '"]');
      if (!group) return;
      self._syncOptionInfoVisibility(group);
      group.addEventListener('change', function () {
        self._syncOptionInfoVisibility(group);
        self._clearError(q.id);
        if (onAnyChange) onAnyChange();
      });
      group.addEventListener('input', function (e) {
        self._clearError(q.id);
        if (e.target.classList.contains('option-more-info')) self._clearOptionInfoError(e.target);
        if (onAnyChange) onAnyChange();
      });
    });
  }

  // Blendet die Freitextfelder (.option-more-info) innerhalb einer Frage
  // ein/aus, je nachdem ob die zugehörige Checkbox/Radio gerade ausgewählt
  // ist — läuft bei jeder Änderung der Auswahl erneut (auch bei Radios
  // relevant: Auswählen einer anderen Option blendet das Feld der zuvor
  // gewählten Option wieder aus).
  _syncOptionInfoVisibility(group) {
    var self = this;
    group.querySelectorAll('.option-item-wrap').forEach(function (wrap) {
      var input = wrap.querySelector('input[type="checkbox"], input[type="radio"]');
      var infoGroup = wrap.querySelector('.option-more-info-group');
      if (!input || !infoGroup) return;
      infoGroup.classList.toggle('visible', input.checked);
      // Wird das Feld durch Ab-/Umwählen wieder ausgeblendet, macht eine
      // stehengebliebene Fehlermarkierung keinen Sinn mehr.
      if (!input.checked) self._clearOptionInfoError(infoGroup.querySelector('.option-more-info'));
    });
  }

  _clearOptionInfoError(infoEl) {
    infoEl.classList.remove('error');
    var err = document.getElementById('err-' + infoEl.id.replace(/^dq-/, ''));
    if (err) err.classList.remove('visible');
  }

  // Prüft für die aktuell gewählten Auswahl-Optionen, welche Kontaktfelder
  // dadurch pflicht werden (je Option einzeln steuerbar über
  // wht_surveyquestionoption.wht_make{Name,Surname,Email,Phone}Required) —
  // z. B. macht "Ja, das klingt gut" bei der Zoom-Frage Vorname+E-Mail
  // pflicht, ohne Telefon zu verlangen. Wird von der aufrufenden Seite
  // genutzt, um die Kontaktfelder dynamisch pflicht zu machen.
  getRequiredContactFields() {
    var self = this;
    var result = { name: false, surname: false, email: false, phone: false };
    this.questions.forEach(function (q) {
      if (q.type !== 'mehrfachauswahl' && q.type !== 'einmalauswahl') return;
      var fieldId = 'dq-' + q.id;
      var checkedIds = Array.prototype.slice
        .call(self.container.querySelectorAll('input[name="' + fieldId + '"]:checked'))
        .map(function (inp) { return inp.value; });
      checkedIds.forEach(function (id) {
        var opt = (q.options || []).find(function (o) { return o.id === id; });
        if (!opt) return;
        if (opt.requiresName)    result.name = true;
        if (opt.requiresSurname) result.surname = true;
        if (opt.requiresEmail)   result.email = true;
        if (opt.requiresPhone)   result.phone = true;
      });
    });
    return result;
  }

  _clearError(questionId) {
    var group = this.container.querySelector('[data-question-id="' + questionId + '"]');
    if (!group) return;
    group.classList.remove('error');
    var err = document.getElementById('err-dq-' + questionId);
    if (err) err.classList.remove('visible');
    var optList = group.querySelector('.option-list');
    if (optList) optList.classList.remove('error');
  }

  // Prüft alle Pflichtfragen sowie die Freitextfelder ausgewählter
  // "wht_addmoreinformation"-Optionen (die sind pflicht, sobald ihre Option
  // gewählt ist — unabhängig davon, ob die Frage selbst pflicht ist),
  // markiert Fehler visuell, fokussiert das erste ungültige Feld. Gibt true
  // zurück, wenn alles gültig ist.
  // onlyQuestionIds (optional): Array von Frage-IDs — dann werden nur diese
  // Fragen geprüft (für Umfragen in Abschnitten: beim „Weiter“ nur den
  // aktuellen Abschnitt prüfen, siehe Templates/umfrage-dynamisch.html).
  validate(onlyQuestionIds) {
    var self = this;
    var valid = true;
    var firstInvalid = null;
    var only = null;
    if (Array.isArray(onlyQuestionIds)) {
      only = {};
      onlyQuestionIds.forEach(function (id) { only[id] = true; });
    }

    this.questions.forEach((q) => {
      if (only && !only[q.id]) return;
      var group = this.container.querySelector('[data-question-id="' + q.id + '"]');

      if (q.required) {
        var ok = this._isAnswered(q);
        var err = document.getElementById('err-dq-' + q.id);
        if (!ok) {
          valid = false;
          if (group) group.classList.add('error');
          var optList = group ? group.querySelector('.option-list') : null;
          if (optList) optList.classList.add('error');
          if (err) err.classList.add('visible');
          if (!firstInvalid) firstInvalid = group;
        } else {
          if (group) group.classList.remove('error');
          if (err) err.classList.remove('visible');
        }
      }

      if (q.type === 'mehrfachauswahl' || q.type === 'einmalauswahl') {
        var checkedIds = group
          ? Array.prototype.slice.call(group.querySelectorAll('input[name="dq-' + q.id + '"]:checked')).map(function (inp) { return inp.value; })
          : [];
        checkedIds.forEach(function (id) {
          var opt = (q.options || []).find(function (o) { return o.id === id; });
          if (!opt || !opt.allowsAdditionalInfo) return;
          var infoEl = document.getElementById('dq-optinfo-' + id);
          if (!infoEl) return;
          var infoOk = !!(infoEl.value && infoEl.value.trim());
          if (!infoOk) {
            valid = false;
            infoEl.classList.add('error');
            var infoErr = document.getElementById('err-optinfo-' + id);
            if (infoErr) infoErr.classList.add('visible');
            if (!firstInvalid) firstInvalid = infoEl;
          } else {
            self._clearOptionInfoError(infoEl);
          }
        });
      }
    });

    if (firstInvalid) firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return valid;
  }

  _isAnswered(q) {
    var fieldId = 'dq-' + q.id;
    if (q.type === 'mehrfachauswahl' || q.type === 'einmalauswahl') {
      return this.container.querySelectorAll('input[name="' + fieldId + '"]:checked').length > 0;
    }
    var el = document.getElementById(fieldId);
    return !!(el && el.value && el.value.trim());
  }

  // Sammelt die Antworten in der vom Write-Endpoint erwarteten Form.
  // Unbeantwortete, nicht-pflicht Fragen werden ausgelassen.
  getAnswers() {
    var answers = [];
    var fieldId;
    this.questions.forEach((q) => {
      fieldId = 'dq-' + q.id;
      if (q.type === 'mehrfachauswahl' || q.type === 'einmalauswahl') {
        var checkedIds = Array.prototype.slice
          .call(this.container.querySelectorAll('input[name="' + fieldId + '"]:checked'))
          .map(function (inp) { return inp.value; });
        if (checkedIds.length > 0) {
          // Label pro gewählter Option mitschicken (nicht nur die GUID) —
          // wht_surveyanswer.wht_value ist das Primary-Name-Feld in Dynamics
          // und würde sonst bei Auswahl-Antworten leer bleiben.
          var options = checkedIds.map(function (id) {
            var opt = (q.options || []).find(function (o) { return o.id === id; });
            var option = { id: id, label: opt ? opt.label : '' };
            if (opt && opt.allowsAdditionalInfo) {
              var infoEl = document.getElementById('dq-optinfo-' + id);
              var infoVal = infoEl ? infoEl.value.trim() : '';
              if (infoVal) option.additionalInfo = infoVal;
            }
            return option;
          });
          answers.push({ questionId: q.id, options: options });
        }
      } else {
        var el = document.getElementById(fieldId);
        var val = el ? el.value.trim() : '';
        if (val) answers.push({ questionId: q.id, value: val });
      }
    });
    return answers;
  }
}
