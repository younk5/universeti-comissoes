BEGIN;

TRUNCATE TABLE
  public.product_rule_events,
  public.commission_payment_events,
  public.payment_batches,
  public.commissions,
  public.profile_archive_events,
  public.app_session_registry,
  public.bootstrap_locks,
  public.products,
  public.profiles
RESTART IDENTITY CASCADE;

DELETE FROM auth.users;

WITH new_admin AS (
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    'universeti@internal.galaxy-smart.local',
    crypt('__COLE_A_SENHA_AQUI__', gen_salt('bf')),
    clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  )
  RETURNING id
)
INSERT INTO public.profiles (
  id, email, username, username_normalized, display_name, role, active, session_not_before
)
SELECT
  id,
  'universeti@internal.galaxy-smart.local',
  'UniverseTI',
  'universeti',
  'UniverseTI',
  'admin'::public.app_role,
  true,
  'epoch'::timestamptz
FROM new_admin;

COMMIT;
