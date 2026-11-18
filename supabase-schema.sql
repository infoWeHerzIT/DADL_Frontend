-- ================================================================
-- Der Architekt deines Lebens – Supabase Schema
-- Ausführen im Supabase SQL Editor (supabase.com → SQL Editor)
-- ================================================================

-- ── 1. EVENTS ────────────────────────────────────────────────────
-- UNUSED seit der Dynamics-Migration: kalender.html, register.html,
-- event-webinar.html, event-workshop.html, 10Workshops_Serie.html und
-- tpl/feedback.html lesen Events inzwischen alle aus Dynamics
-- (wht_event über dynamicsCRM.listEvents()). admin-events.html/
-- admin-event-detail.html (die einzigen Schreiber) wurden entfernt.
-- Tabelle bewusst NICHT gelöscht (Altdaten als Archiv), aber von keiner
-- Seite mehr gelesen/geschrieben.
create table if not exists events (
  id               text primary key,
  name             text not null,
  type             text not null default 'Workshop',
  year             integer not null,
  month            integer not null,
  day              integer not null,
  time_from        text,
  time_to          text,
  location         text,
  format           text not null default 'Präsenz',
  price            text,
  spots            text,
  description      text,
  url              text default 'register.html',
  video_meeting_url text,
  ressourcen_url   text,
  status           integer not null default 0, -- 0 = Draft, 1 = Aktiv, 2 = Vergangene
  created_at       timestamptz default now()
);

-- Falls die Tabelle bereits existiert (bestehende Installation),
-- einmalig im Supabase SQL Editor ausführen:
alter table events add column if not exists status integer not null default 0; -- 0 = Draft, 1 = Aktiv, 2 = Vergangene

-- ── 2. PARTICIPANTS ──────────────────────────────────────────────
-- UNUSED seit der Dynamics-Migration: register.html und
-- 10Workshops_Serie.html schreiben Kontaktdaten inzwischen ausschließlich
-- als Dynamics-Lead (wht_lead), nicht mehr hierher. Nur noch von
-- tpl/feedback.html gelesen (presetParticipantId-Pfad ist seit dem
-- Löschen von admin-event-detail.html unerreichbar, da das der einzige
-- Erzeuger solcher Links war). Tabelle bewusst NICHT gelöscht (Altdaten).
-- Einmalige Kontaktdaten je Person. Unique Key = Handynummer.
create table if not exists participants (
  id         uuid default gen_random_uuid() primary key,
  vorname    text not null,
  nachname   text not null,
  email      text not null,
  handy      text unique,
  ort        text,
  created_at timestamptz default now()
);

-- ── 3. EVENT_PARTICIPATIONS ──────────────────────────────────────
-- UNUSED seit der Dynamics-Migration: register.html und
-- 10Workshops_Serie.html schreiben nicht mehr hierher (Event-Teilnahme
-- ergibt sich jetzt aus wht_lead.wht_EventId in Dynamics). Tabelle
-- bewusst NICHT gelöscht (Altdaten), admin-teilnehmer.html (einziger
-- Leser) wurde entfernt.
-- N:M Beziehung zwischen Events und Participants.
-- 1 Participant kann an mehreren Events teilnehmen.
-- 1 Event kann mehrere Participants haben.
create table if not exists event_participations (
  id              uuid default gen_random_uuid() primary key,
  event_id        text references events(id) on delete set null,
  participant_id  uuid references participants(id) on delete cascade,
  ticket_name     text,
  ticket_price    text,
  payment_status  text default 'pending',  -- pending | confirmed | cancelled
  registered_at   timestamptz default now(),
  unique(event_id, participant_id)
);

-- ── 4. FEEDBACK ──────────────────────────────────────────────────
-- event_id enthält seit der Dynamics-Migration von tpl/feedback.html
-- eine Dynamics-Event-GUID (wht_eventid), keine Supabase-events.id mehr —
-- der frühere "references events(id)"-Foreign-Key wurde deshalb entfernt
-- (sonst schlägt jeder Insert mit einem Foreign-Key-Fehler fehl).
create table if not exists feedback (
  id              uuid default gen_random_uuid() primary key,
  event_id        text, -- Dynamics-GUID (wht_eventid), kein Supabase-FK mehr
  ort             text,
  vorname         text,
  email           text,
  rating          integer not null check (rating between 1 and 5),
  recommend       text,
  highlight       text,
  improvement     text,
  testimonial_ok  boolean default false,
  created_at      timestamptz default now()
);

-- ── 5. AUDIENCE SURVEY (Zielgruppen-Umfrage) ─────────────────────
create table if not exists audience_survey (
  id                    uuid default gen_random_uuid() primary key,
  situation             text[],   -- Frage 1: Mehrfachauswahl
  situation_main        text,     -- Frage 2: Einfachauswahl
  challenge             text,     -- Frage 3
  themen                text[],   -- Frage 4: Mehrfachauswahl
  moment                text,     -- Frage 5
  versucht              text[],   -- Frage 6: Mehrfachauswahl
  versucht_nicht        text,     -- Frage 7
  hindernis             text[],   -- Frage 8: Mehrfachauswahl
  unterstuetzung        text,     -- Frage 9: Einfachauswahl
  veraenderung          text,     -- Frage 10
  quelle                text,     -- Frage 11: Einfachauswahl
  kommentar             text,     -- Frage 12 (optional)
  zoom_wunsch           text,     -- Frage 13: Einfachauswahl (Pflichtfrage)
  ergebnisse_wunsch     text,     -- Frage 14: Einfachauswahl
  vollstaendiger_name   text,     -- Frage 15 (optional, nur bei Ja bei 13/14)
  email                 text,
  telefon               text,
  newsletter_opt_in     boolean default false,
  created_at            timestamptz default now()
);

-- ── 5b. SURVEY EVENT LINKS ────────────────────────────────────────
-- Ordnet einer Umfrage-Seite (page_key = URL-Pfad, z. B. "/tpl/umfrage_zg0826.html")
-- optional ein Dynamics-Event zu (event_id = wht_event-GUID aus Dynamics,
-- nicht die Supabase-events-Tabelle). Serverseitig statt localStorage, damit
-- ALLE Besucher dieselbe vom Admin gewählte Zuordnung sehen, nicht nur der
-- Browser, in dem die Auswahl getroffen wurde.
create table if not exists survey_event_links (
  page_key   text primary key,
  event_id   text,
  updated_at timestamptz default now()
);

-- ── 5c. SURVEY RESPONSES RAW (Sicherheitsnetz) ────────────────────
-- Gehört zum dynamischen Umfrage-System (wht_survey/wht_surveyquestion/
-- wht_surveyanswer in Dynamics). Roher Antwort-Payload wird HIER
-- gespeichert, bevor die mehrstufige Dynamics-Schreibkette (Lead →
-- Response → N Answer-Zeilen, bis zu ~15 sequenzielle Requests) läuft —
-- bricht die Kette mittendrin ab, ist die Antwort trotzdem nicht verloren.
create table if not exists survey_responses_raw (
  id           uuid default gen_random_uuid() primary key,
  survey_id    text,        -- Dynamics wht_surveyid (GUID)
  payload      jsonb not null,
  created_at   timestamptz default now()
);

-- ── 6. ROW LEVEL SECURITY ────────────────────────────────────────
alter table events              enable row level security;
alter table participants        enable row level security;
alter table event_participations enable row level security;
alter table feedback            enable row level security;
alter table audience_survey     enable row level security;
alter table survey_event_links  enable row level security;
alter table survey_responses_raw enable row level security;

-- Events: jeder kann lesen (Kalender & Startseite)
create policy "events_public_read"
  on events for select using (true);

-- Events: nur eingeloggte Admins dürfen schreiben
create policy "events_admin_insert" on events for insert
  with check (auth.role() = 'authenticated');
create policy "events_admin_update" on events for update
  using (auth.role() = 'authenticated');
create policy "events_admin_delete" on events for delete
  using (auth.role() = 'authenticated');

-- Participants: öffentlich anlegen/aktualisieren (Registrierung)
create policy "participants_public_insert"
  on participants for insert with check (true);
create policy "participants_public_update"
  on participants for update using (true);

-- Participants: nur Admins dürfen lesen/löschen
create policy "participants_admin_read" on participants for select
  using (auth.role() = 'authenticated');
create policy "participants_admin_delete" on participants for delete
  using (auth.role() = 'authenticated');

-- EventParticipations: jeder darf sich eintragen (Registrierung)
create policy "event_participations_public_insert"
  on event_participations for insert with check (true);

-- EventParticipations: nur Admins dürfen lesen/bearbeiten
create policy "event_participations_admin_read" on event_participations for select
  using (auth.role() = 'authenticated');
create policy "event_participations_admin_update" on event_participations for update
  using (auth.role() = 'authenticated');
create policy "event_participations_admin_delete" on event_participations for delete
  using (auth.role() = 'authenticated');

-- Feedback: jeder darf Feedback abgeben
create policy "feedback_public_insert"
  on feedback for insert with check (true);

-- Feedback: nur eingeloggte Admins dürfen lesen/bearbeiten
create policy "feedback_admin_read" on feedback for select
  using (auth.role() = 'authenticated');
create policy "feedback_admin_update" on feedback for update
  using (auth.role() = 'authenticated');
create policy "feedback_admin_delete" on feedback for delete
  using (auth.role() = 'authenticated');

-- Audience Survey: jeder darf die Umfrage absenden
create policy "audience_survey_public_insert"
  on audience_survey for insert with check (true);

-- Audience Survey: nur eingeloggte Admins dürfen lesen/löschen
create policy "audience_survey_admin_read" on audience_survey for select
  using (auth.role() = 'authenticated');
create policy "audience_survey_admin_delete" on audience_survey for delete
  using (auth.role() = 'authenticated');

-- Survey Event Links: jeder darf lesen (Anzeige des Event-Namens für alle Besucher)
create policy "survey_event_links_public_read"
  on survey_event_links for select using (true);

-- Survey Event Links: nur eingeloggte Admins dürfen die Zuordnung setzen/ändern
create policy "survey_event_links_admin_insert" on survey_event_links for insert
  with check (auth.role() = 'authenticated');
create policy "survey_event_links_admin_update" on survey_event_links for update
  using (auth.role() = 'authenticated');

-- Survey Responses Raw: jeder darf eine Antwort ablegen (Sicherheitsnetz)
create policy "survey_responses_raw_public_insert"
  on survey_responses_raw for insert with check (true);

-- Survey Responses Raw: nur eingeloggte Admins dürfen lesen
create policy "survey_responses_raw_admin_read" on survey_responses_raw for select
  using (auth.role() = 'authenticated');


-- ================================================================
-- MIGRATION (nur einmal ausführen auf bestehender Datenbank)
-- ================================================================
-- Führe diese Blöcke der Reihe nach im SQL Editor aus,
-- falls die alte "participants"-Tabelle bereits Daten enthält.

-- Schritt 1: Neue participants Tabelle (falls noch nicht vorhanden)
-- → siehe oben (create table if not exists participants ...)

-- Schritt 2: Bestehende Daten in neue participants Tabelle migrieren
-- (dedup nach handy; bei fehlender Nummer dedup nach email)
/*
insert into participants (id, vorname, nachname, email, handy, ort, created_at)
select distinct on (coalesce(nullif(handy,''), email))
  gen_random_uuid(), vorname, nachname, email, nullif(handy,''), ort, registered_at
from participants_old   -- ← alter Name der Original-Tabelle
order by coalesce(nullif(handy,''), email), registered_at desc
on conflict (handy) do nothing;
*/

-- Schritt 3: EventParticipations befüllen
/*
insert into event_participations (event_id, participant_id, ticket_name, ticket_price, payment_status, registered_at)
select
  o.event_id,
  p.id,
  o.ticket_name,
  o.ticket_price,
  o.payment_status,
  o.registered_at
from participants_old o
join participants p
  on coalesce(nullif(o.handy,''), o.email) = coalesce(nullif(p.handy,'')::text, p.email)
on conflict (event_id, participant_id) do nothing;
*/

-- Schritt 4: Alte Tabelle umbenennen (Backup) oder löschen
-- alter table participants_old rename to participants_backup;
-- drop table participants_backup;
