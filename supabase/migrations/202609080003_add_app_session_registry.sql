BEGIN;

CREATE TABLE public.app_session_registry (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

REVOKE ALL ON TABLE public.app_session_registry FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.app_session_registry TO service_role;

ALTER TABLE public.app_session_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_session_registry FORCE ROW LEVEL SECURITY;

COMMIT;
