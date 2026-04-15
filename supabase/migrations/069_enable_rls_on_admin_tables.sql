-- Migration 069: Enable RLS on admin-only tables
--
-- SECURITY FIX: system_errors (056) and ai_platform_usage (066) were created
-- without ENABLE ROW LEVEL SECURITY. The original authors assumed "service-role
-- only" was enforced by the fact that no app code reads these via the anon
-- client — but Supabase exposes every public schema table through the anon
-- API by default. Without RLS, anyone with the anon key (which ships in the
-- browser bundle) can SELECT / INSERT / UPDATE / DELETE these rows.
--
-- Both tables are only written and read via clients built with
-- SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS. Enabling RLS with no
-- policies denies all access from anon / authenticated roles while leaving
-- service-role access unchanged — which is exactly what the authors intended.
--
-- Affected data:
--   system_errors       — stack traces, request bodies, user/team IDs
--   ai_platform_usage   — per-team/user AI token counts and spend

ALTER TABLE system_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform_usage ENABLE ROW LEVEL SECURITY;
