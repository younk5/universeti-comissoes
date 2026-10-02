BEGIN;

CREATE TABLE public.commission_default_rule (
  id boolean NOT NULL DEFAULT true,
  configured boolean NOT NULL DEFAULT false,
  commission_type public.commission_type,
  commission_rate_bps integer,
  commission_fixed_cents bigint,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (id),
  CONSTRAINT commission_default_rule_amounts_check CHECK (
    (configured = false
      AND commission_type IS NULL
      AND commission_rate_bps IS NULL
      AND commission_fixed_cents IS NULL)
    OR
    (configured = true
      AND commission_type = 'percentage'
      AND commission_rate_bps BETWEEN 1 AND 10000
      AND commission_fixed_cents IS NULL)
    OR
    (configured = true
      AND commission_type = 'fixed'
      AND commission_rate_bps IS NULL
      AND commission_fixed_cents BETWEEN 1 AND 900000000000000)
  )
);

INSERT INTO public.commission_default_rule (id, configured) VALUES (true, false);

CREATE TABLE public.commission_default_rule_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  old_configured boolean NOT NULL,
  old_commission_type public.commission_type,
  old_commission_rate_bps integer,
  old_commission_fixed_cents bigint,
  new_commission_type public.commission_type NOT NULL,
  new_commission_rate_bps integer,
  new_commission_fixed_cents bigint,
  recalculated_pending_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commission_default_rule_events_old_amounts_check CHECK (
    (old_configured = false
      AND old_commission_type IS NULL
      AND old_commission_rate_bps IS NULL
      AND old_commission_fixed_cents IS NULL)
    OR
    (old_configured = true
      AND old_commission_type = 'percentage'
      AND old_commission_rate_bps BETWEEN 1 AND 10000
      AND old_commission_fixed_cents IS NULL)
    OR
    (old_configured = true
      AND old_commission_type = 'fixed'
      AND old_commission_rate_bps IS NULL
      AND old_commission_fixed_cents BETWEEN 1 AND 900000000000000)
  ),
  CONSTRAINT commission_default_rule_events_new_amounts_check CHECK (
    (new_commission_type = 'percentage'
      AND new_commission_rate_bps BETWEEN 1 AND 10000
      AND new_commission_fixed_cents IS NULL)
    OR
    (new_commission_type = 'fixed'
      AND new_commission_rate_bps IS NULL
      AND new_commission_fixed_cents BETWEEN 1 AND 900000000000000)
  ),
  CONSTRAINT commission_default_rule_events_recalculated_pending_count_check
    CHECK (recalculated_pending_count >= 0)
);

CREATE OR REPLACE FUNCTION public.update_default_commission_rule(
  p_actor_id uuid,
  p_commission_type public.commission_type,
  p_commission_rate_bps integer,
  p_commission_fixed_cents bigint
)
RETURNS TABLE (recalculated_pending_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_default_rule public.commission_default_rule%ROWTYPE;
  v_updated_at timestamptz := pg_catalog.clock_timestamp();
  v_recalculated_pending_count integer := 0;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'p_actor_id must not be null' USING ERRCODE = '22004';
  END IF;

  PERFORM 1
  FROM public.profiles AS actor_profile
  WHERE actor_profile.id = p_actor_id
    AND actor_profile.role = 'admin'
    AND actor_profile.active = true
    AND actor_profile.archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active admin actor required' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_default_rule
  FROM public.commission_default_rule
  WHERE id = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'default commission rule not found' USING ERRCODE = 'P0002';
  END IF;

  IF (p_commission_type = 'percentage'
      AND p_commission_rate_bps BETWEEN 1 AND 10000
      AND p_commission_fixed_cents IS NULL)
    OR (p_commission_type = 'fixed'
      AND p_commission_rate_bps IS NULL
      AND p_commission_fixed_cents BETWEEN 1 AND 900000000000000) THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'invalid commission amount combination' USING ERRCODE = '22023';
  END IF;

  UPDATE public.commission_default_rule
  SET
    configured = true,
    commission_type = p_commission_type,
    commission_rate_bps = CASE WHEN p_commission_type = 'percentage' THEN p_commission_rate_bps ELSE NULL END,
    commission_fixed_cents = CASE WHEN p_commission_type = 'fixed' THEN p_commission_fixed_cents ELSE NULL END,
    updated_at = v_updated_at
  WHERE id = v_default_rule.id;

  PERFORM 1
  FROM public.commissions AS commission
  WHERE commission.status = 'pending'
    AND commission.product_id IS NULL
  FOR UPDATE;

  UPDATE public.commissions AS commission
  SET
    commission_type = p_commission_type,
    commission_rate_bps = CASE WHEN p_commission_type = 'percentage' THEN p_commission_rate_bps ELSE NULL END,
    commission_fixed_cents = CASE WHEN p_commission_type = 'fixed' THEN p_commission_fixed_cents ELSE NULL END,
    updated_at = v_updated_at
  WHERE commission.status = 'pending'
    AND commission.product_id IS NULL;

  GET DIAGNOSTICS v_recalculated_pending_count = ROW_COUNT;

  INSERT INTO public.commission_default_rule_events (
    actor_id,
    old_configured,
    old_commission_type,
    old_commission_rate_bps,
    old_commission_fixed_cents,
    new_commission_type,
    new_commission_rate_bps,
    new_commission_fixed_cents,
    recalculated_pending_count,
    created_at
  )
  VALUES (
    p_actor_id,
    v_default_rule.configured,
    v_default_rule.commission_type,
    v_default_rule.commission_rate_bps,
    v_default_rule.commission_fixed_cents,
    p_commission_type,
    CASE WHEN p_commission_type = 'percentage' THEN p_commission_rate_bps ELSE NULL END,
    CASE WHEN p_commission_type = 'fixed' THEN p_commission_fixed_cents ELSE NULL END,
    v_recalculated_pending_count,
    v_updated_at
  );

  RETURN QUERY
  SELECT v_recalculated_pending_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_default_backed_commission(
  p_commission_id uuid,
  p_actor_id uuid,
  p_seller_id uuid,
  p_seller_name_snapshot text,
  p_product text,
  p_sale_value_cents bigint,
  p_sale_date date,
  p_note text
)
RETURNS SETOF public.commissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_default_rule public.commission_default_rule%ROWTYPE;
  v_commission public.commissions%ROWTYPE;
  v_updated_at timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'p_actor_id must not be null' USING ERRCODE = '22004';
  END IF;

  PERFORM 1
  FROM public.profiles AS actor_profile
  WHERE actor_profile.id = p_actor_id
    AND actor_profile.role = 'admin'
    AND actor_profile.active = true
    AND actor_profile.archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active admin actor required' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_default_rule
  FROM public.commission_default_rule
  WHERE id = true
  FOR UPDATE;
  IF NOT FOUND OR v_default_rule.configured IS NOT TRUE THEN
    RAISE EXCEPTION 'default commission rule is not configured' USING ERRCODE = 'P0001';
  END IF;

  IF p_commission_id IS NULL THEN
    INSERT INTO public.commissions (
      seller_id,
      seller_name_snapshot,
      product_id,
      product,
      sale_value_cents,
      commission_type,
      commission_rate_bps,
      commission_fixed_cents,
      sale_date,
      note
    )
    VALUES (
      p_seller_id,
      p_seller_name_snapshot,
      NULL,
      p_product,
      p_sale_value_cents,
      v_default_rule.commission_type,
      v_default_rule.commission_rate_bps,
      v_default_rule.commission_fixed_cents,
      p_sale_date,
      p_note
    )
    RETURNING * INTO v_commission;
  ELSE
    UPDATE public.commissions AS commission
    SET
      seller_id = p_seller_id,
      seller_name_snapshot = p_seller_name_snapshot,
      product_id = NULL,
      product = p_product,
      sale_value_cents = p_sale_value_cents,
      commission_type = v_default_rule.commission_type,
      commission_rate_bps = v_default_rule.commission_rate_bps,
      commission_fixed_cents = v_default_rule.commission_fixed_cents,
      sale_date = p_sale_date,
      note = p_note,
      updated_at = v_updated_at
    WHERE commission.id = p_commission_id
      AND commission.status = 'pending'
    RETURNING * INTO v_commission;

    IF NOT FOUND THEN
      RETURN;
    END IF;
  END IF;

  RETURN NEXT v_commission;
END;
$$;

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS default_commission_rate_bps;

UPDATE auth.users
SET raw_user_meta_data = raw_user_meta_data - 'galaxy_smart_default_commission_rate_bps'
WHERE raw_user_meta_data ? 'galaxy_smart_default_commission_rate_bps';

ALTER TABLE public.commission_default_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_default_rule FORCE ROW LEVEL SECURITY;
ALTER TABLE public.commission_default_rule_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_default_rule_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.commission_default_rule FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.commission_default_rule_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_default_commission_rule(uuid, public.commission_type, integer, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.upsert_default_backed_commission(uuid, uuid, uuid, text, text, bigint, date, text) FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.commission_default_rule TO service_role;
GRANT SELECT ON TABLE public.commission_default_rule_events TO service_role;
GRANT EXECUTE ON FUNCTION public.update_default_commission_rule(uuid, public.commission_type, integer, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_default_backed_commission(uuid, uuid, uuid, text, text, bigint, date, text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
