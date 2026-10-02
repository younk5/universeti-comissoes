BEGIN;

CREATE OR REPLACE FUNCTION public.archive_profile(
  p_target_id uuid,
  p_actor_id uuid,
  p_expected_role public.app_role
)
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
  IF p_target_id IS NULL OR p_actor_id IS NULL OR p_expected_role IS NULL THEN
    RAISE EXCEPTION 'archive target, actor, and expected role are required' USING ERRCODE = '22004';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('public.archive_profile'));

  SELECT actor_profile.* INTO v_actor
  FROM public.profiles AS actor_profile
  WHERE actor_profile.id = p_actor_id
  FOR UPDATE;
  IF NOT FOUND OR v_actor.role <> 'admin' OR v_actor.active IS NOT TRUE OR v_actor.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'only an active administrator may archive profiles' USING ERRCODE = '42501';
  END IF;

  IF p_target_id = p_actor_id THEN
    RAISE EXCEPTION 'an administrator cannot archive itself' USING ERRCODE = '22023';
  END IF;

  SELECT target_profile.* INTO v_target
  FROM public.profiles AS target_profile
  WHERE target_profile.id = p_target_id
    AND target_profile.archived_at IS NULL
  FOR UPDATE;
  IF NOT FOUND OR v_target.role <> p_expected_role THEN
    RAISE EXCEPTION 'profile not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_target.role = 'admin' THEN
    PERFORM 1
    FROM public.profiles AS locked_admin
    WHERE locked_admin.role = 'admin'
      AND locked_admin.active = true
      AND locked_admin.archived_at IS NULL
    FOR UPDATE;

    SELECT pg_catalog.count(*) INTO v_active_admin_count
    FROM public.profiles AS active_admin
    WHERE active_admin.role = 'admin'
      AND active_admin.active = true
      AND active_admin.archived_at IS NULL;
    IF v_active_admin_count <= 1 THEN
      RAISE EXCEPTION 'the last active administrator cannot be archived' USING ERRCODE = '23514';
    END IF;
  END IF;

  UPDATE public.profiles AS target_profile
  SET
    active = false,
    archived_at = v_archived_at,
    archived_by = p_actor_id,
    session_not_before = v_archived_at,
    updated_at = v_archived_at
  WHERE target_profile.id = p_target_id
  RETURNING target_profile.* INTO v_target;

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

REVOKE ALL ON FUNCTION public.archive_profile(uuid, uuid, public.app_role) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_profile(uuid, uuid, public.app_role) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
