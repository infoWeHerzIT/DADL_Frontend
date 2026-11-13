-- Angewendet am 2026-11-13 (Supabase-Projekt vtdekigorlwlarvlshpp).
--
-- Kopfbild-Ausschnitt: Original behalten (für späteres Neu-Zuschneiden) und
-- die gewählte Position/Zoom merken, damit der Editor dort wieder aufmacht.
-- Siehe Code/survey-header-image.js.
alter table public.survey_settings
  add column if not exists original_image_path text,
  add column if not exists header_crop jsonb;
