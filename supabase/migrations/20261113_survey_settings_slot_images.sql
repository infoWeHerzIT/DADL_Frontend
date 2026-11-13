-- Angewendet am 2026-11-13 (Supabase-Projekt vtdekigorlwlarvlshpp).
--
-- Weitere Bilder pro Umfrage: je Abschnitt ("section:3") und je Frage
-- ("question:9"), gleiche Struktur wie das Kopfbild:
--   { "<slot>": { "url", "path", "original_path", "crop" } }
-- Siehe Code/survey-header-image.js.
alter table public.survey_settings
  add column if not exists images jsonb not null default '{}'::jsonb;
