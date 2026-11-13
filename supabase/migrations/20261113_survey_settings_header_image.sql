-- Angewendet am 2026-11-13 (Supabase-Projekt vtdekigorlwlarvlshpp).
--
-- Kopfbild pro Umfrage (Templates/umfrage-dynamisch.html), gepflegt im Admin
-- (admin/admin-umfrage.html). Schlüssel ist der Umfrage-Slug (wht_slug), weil
-- der in Dynamics DEV und PROD gleich ist (die GUIDs nicht).
create table if not exists public.survey_settings (
  survey_slug text primary key,
  header_image_url text,
  header_image_path text,
  updated_at timestamptz not null default now()
);
alter table public.survey_settings enable row level security;

create policy survey_settings_public_read on public.survey_settings
  for select using (true);
create policy survey_settings_admin_insert on public.survey_settings
  for insert with check (auth.role() = 'authenticated');
create policy survey_settings_admin_update on public.survey_settings
  for update using (auth.role() = 'authenticated');
create policy survey_settings_admin_delete on public.survey_settings
  for delete using (auth.role() = 'authenticated');

-- Öffentlicher Bucket für die Kopfbilder: lesen darf jeder (die Umfrageseite
-- ist öffentlich), hochladen/tauschen/löschen nur eingeloggte Admins.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('survey-images', 'survey-images', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do nothing;

create policy survey_images_public_read on storage.objects
  for select using (bucket_id = 'survey-images');
create policy survey_images_admin_insert on storage.objects
  for insert with check (bucket_id = 'survey-images' and auth.role() = 'authenticated');
create policy survey_images_admin_update on storage.objects
  for update using (bucket_id = 'survey-images' and auth.role() = 'authenticated');
create policy survey_images_admin_delete on storage.objects
  for delete using (bucket_id = 'survey-images' and auth.role() = 'authenticated');
