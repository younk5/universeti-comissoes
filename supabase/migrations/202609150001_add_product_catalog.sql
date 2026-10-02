BEGIN;

CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  name_normalized text GENERATED ALWAYS AS (lower(btrim(name))) STORED,
  commission_type public.commission_type NOT NULL,
  commission_rate_bps integer,
  commission_fixed_cents bigint,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_name_check
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT products_type_amounts_check CHECK (
    (commission_type = 'percentage'
      AND commission_rate_bps BETWEEN 1 AND 10000
      AND commission_fixed_cents IS NULL)
    OR
    (commission_type = 'fixed'
      AND commission_rate_bps IS NULL
      AND commission_fixed_cents BETWEEN 1 AND 900000000000000)
  )
);

CREATE UNIQUE INDEX products_name_normalized_idx
  ON public.products (name_normalized);

ALTER TABLE public.commissions
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT;

CREATE INDEX commissions_product_pending_idx
  ON public.commissions (product_id)
  WHERE status = 'pending';

CREATE TABLE public.product_rule_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  old_name text NOT NULL,
  new_name text NOT NULL,
  old_commission_type public.commission_type NOT NULL,
  old_commission_rate_bps integer,
  old_commission_fixed_cents bigint,
  new_commission_type public.commission_type NOT NULL,
  new_commission_rate_bps integer,
  new_commission_fixed_cents bigint,
  recalculated_pending_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_rule_events_old_name_check
    CHECK (char_length(btrim(old_name)) BETWEEN 1 AND 200),
  CONSTRAINT product_rule_events_new_name_check
    CHECK (char_length(btrim(new_name)) BETWEEN 1 AND 200),
  CONSTRAINT product_rule_events_old_type_amounts_check CHECK (
    (old_commission_type = 'percentage'
      AND old_commission_rate_bps BETWEEN 1 AND 10000
      AND old_commission_fixed_cents IS NULL)
    OR
    (old_commission_type = 'fixed'
      AND old_commission_rate_bps IS NULL
      AND old_commission_fixed_cents BETWEEN 1 AND 900000000000000)
  ),
  CONSTRAINT product_rule_events_new_type_amounts_check CHECK (
    (new_commission_type = 'percentage'
      AND new_commission_rate_bps BETWEEN 1 AND 10000
      AND new_commission_fixed_cents IS NULL)
    OR
    (new_commission_type = 'fixed'
      AND new_commission_rate_bps IS NULL
      AND new_commission_fixed_cents BETWEEN 1 AND 900000000000000)
  ),
  CONSTRAINT product_rule_events_recalculated_pending_count_check
    CHECK (recalculated_pending_count >= 0)
);

CREATE OR REPLACE FUNCTION public.update_product_rule(
  p_product_id uuid,
  p_actor_id uuid,
  p_name text,
  p_commission_type public.commission_type,
  p_commission_rate_bps integer,
  p_commission_fixed_cents bigint
)
RETURNS TABLE (
  product_id uuid,
  recalculated_pending_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_changed_at timestamptz := pg_catalog.clock_timestamp();
  v_recalculated_pending_count integer := 0;
BEGIN
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'p_product_id must not be null' USING ERRCODE = '22004';
  END IF;

  SELECT *
  INTO v_product
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'product not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_product.active IS NOT TRUE THEN
    RAISE EXCEPTION 'product is inactive' USING ERRCODE = 'P0001';
  END IF;

  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'p_actor_id must not be null' USING ERRCODE = '22004';
  END IF;

  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'p_name must contain between 1 and 200 characters after trimming' USING ERRCODE = '22023';
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

  UPDATE public.products
  SET
    name = p_name,
    commission_type = p_commission_type,
    commission_rate_bps = CASE WHEN p_commission_type = 'percentage' THEN p_commission_rate_bps ELSE NULL END,
    commission_fixed_cents = CASE WHEN p_commission_type = 'fixed' THEN p_commission_fixed_cents ELSE NULL END,
    updated_at = v_changed_at
  WHERE id = v_product.id;

  PERFORM 1
  FROM public.commissions AS c
  WHERE c.status = 'pending'
    AND c.product_id = v_product.id
  FOR UPDATE;

  SELECT count(*)::integer
  INTO v_recalculated_pending_count
  FROM public.commissions AS c
  WHERE c.status = 'pending'
    AND c.product_id = v_product.id;

  INSERT INTO public.product_rule_events (
    actor_id,
    product_id,
    old_name,
    new_name,
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
    v_product.id,
    v_product.name,
    p_name,
    v_product.commission_type,
    v_product.commission_rate_bps,
    v_product.commission_fixed_cents,
    p_commission_type,
    CASE WHEN p_commission_type = 'percentage' THEN p_commission_rate_bps ELSE NULL END,
    CASE WHEN p_commission_type = 'fixed' THEN p_commission_fixed_cents ELSE NULL END,
    v_recalculated_pending_count,
    v_changed_at
  );

  UPDATE public.commissions AS c
  SET
    commission_type = p_commission_type,
    commission_rate_bps = CASE WHEN p_commission_type = 'percentage' THEN p_commission_rate_bps ELSE NULL END,
    commission_fixed_cents = CASE WHEN p_commission_type = 'fixed' THEN p_commission_fixed_cents ELSE NULL END,
    updated_at = v_changed_at
  WHERE c.status = 'pending'
    AND c.product_id = v_product.id;

  GET DIAGNOSTICS v_recalculated_pending_count = ROW_COUNT;

  RETURN QUERY
  SELECT v_product.id, v_recalculated_pending_count;
END;
$$;

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products FORCE ROW LEVEL SECURITY;
ALTER TABLE public.product_rule_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_rule_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.products FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.product_rule_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_product_rule(uuid, uuid, text, public.commission_type, integer, bigint) FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.products TO service_role;
GRANT SELECT, INSERT ON TABLE public.product_rule_events TO service_role;
GRANT EXECUTE ON FUNCTION public.update_product_rule(uuid, uuid, text, public.commission_type, integer, bigint) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
