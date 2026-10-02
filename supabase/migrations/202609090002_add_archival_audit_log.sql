BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid references public.profiles(id) on delete restrict;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_archival_metadata_check
  CHECK (
    (archived_at IS NULL AND archived_by IS NULL)
    OR (archived_at IS NOT NULL AND archived_by IS NOT NULL)
  );

CREATE TABLE public.profile_archive_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL references public.profiles(id) on delete restrict,
  target_id uuid NOT NULL references public.profiles(id) on delete restrict,
  target_role public.app_role NOT NULL,
  target_display_name text NOT NULL,
  archived_at timestamptz NOT NULL,
  CONSTRAINT profile_archive_events_target_display_name_check
    CHECK (btrim(target_display_name) <> '')
);

CREATE INDEX profile_archive_events_target_archived_at_idx
  ON public.profile_archive_events (target_id, archived_at DESC);

CREATE INDEX profile_archive_events_actor_archived_at_idx
  ON public.profile_archive_events (actor_id, archived_at DESC);

ALTER TABLE public.profile_archive_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_archive_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.profile_archive_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.profile_archive_events TO service_role;

CREATE FUNCTION public.archive_profile(p_target_id uuid, p_actor_id uuid)
RETURNS TABLE (
  target_id uuid,
  target_role public.app_role,
  target_display_name text,
  archived_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_target public.profiles%ROWTYPE;
  v_archived_at timestamptz := pg_catalog.clock_timestamp();
  v_active_admin_count integer;
BEGIN
  IF p_target_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'archive target and actor are required' USING ERRCODE = '22004';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('public.archive_profile'));

  SELECT * INTO v_actor
  FROM public.profiles
  WHERE id = p_actor_id
  FOR UPDATE;
  IF NOT FOUND OR v_actor.role <> 'admin' OR v_actor.active IS NOT TRUE OR v_actor.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'only an active administrator may archive profiles' USING ERRCODE = '42501';
  END IF;

  IF p_target_id = p_actor_id THEN
    RAISE EXCEPTION 'an administrator cannot archive itself' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_target
  FROM public.profiles
  WHERE id = p_target_id
    AND archived_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_target.role = 'admin' THEN
    PERFORM 1
    FROM public.profiles
    WHERE role = 'admin'
      AND active = true
      AND archived_at IS NULL
    FOR UPDATE;

    SELECT count(*) INTO v_active_admin_count
    FROM public.profiles
    WHERE role = 'admin'
      AND active = true
      AND archived_at IS NULL;
    IF v_active_admin_count <= 1 THEN
      RAISE EXCEPTION 'the last active administrator cannot be archived' USING ERRCODE = '23514';
    END IF;
  END IF;

  UPDATE public.profiles
  SET
    active = false,
    archived_at = v_archived_at,
    archived_by = p_actor_id,
    session_not_before = v_archived_at,
    updated_at = v_archived_at
  WHERE id = p_target_id
  RETURNING * INTO v_target;

  INSERT INTO public.profile_archive_events (
    actor_id,
    target_id,
    target_role,
    target_display_name,
    archived_at
  ) VALUES (
    p_actor_id,
    v_target.id,
    v_target.role,
    v_target.display_name,
    v_archived_at
  );

  RETURN QUERY
  SELECT v_target.id, v_target.role, v_target.display_name, v_archived_at;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_profile(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_profile(uuid, uuid) TO service_role;

COMMIT;
