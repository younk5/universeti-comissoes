BEGIN;

CREATE FUNCTION public.delete_commission(p_commission_id uuid, p_actor_id uuid)
RETURNS TABLE (deleted_commission_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_batch_ids uuid[];
BEGIN
  IF p_commission_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'commission and actor are required' USING ERRCODE = '22004';
  END IF;

  SELECT * INTO v_actor
  FROM public.profiles
  WHERE id = p_actor_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_actor.role <> 'admin'
    OR v_actor.active IS NOT TRUE
    OR v_actor.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'only an active administrator may delete commissions' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.commissions
  WHERE id = p_commission_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'commission not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT pg_catalog.array_agg(DISTINCT event.payment_batch_id)
  INTO v_batch_ids
  FROM public.commission_payment_events AS event
  WHERE event.commission_id = p_commission_id;

  DELETE FROM public.commission_payment_events
  WHERE commission_id = p_commission_id;

  DELETE FROM public.commissions
  WHERE id = p_commission_id;

  IF v_batch_ids IS NOT NULL THEN
    DELETE FROM public.payment_batches AS batch
    WHERE batch.id = ANY (v_batch_ids)
      AND NOT EXISTS (
        SELECT 1
        FROM public.commission_payment_events AS event
        WHERE event.payment_batch_id = batch.id
      );
  END IF;

  RETURN QUERY SELECT p_commission_id;
END;
$$;

CREATE FUNCTION public.delete_seller(p_target_id uuid, p_actor_id uuid)
RETURNS TABLE (deleted_seller_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_target public.profiles%ROWTYPE;
  v_batch_ids uuid[];
BEGIN
  IF p_target_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'seller and actor are required' USING ERRCODE = '22004';
  END IF;

  SELECT * INTO v_actor
  FROM public.profiles
  WHERE id = p_actor_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_actor.role <> 'admin'
    OR v_actor.active IS NOT TRUE
    OR v_actor.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'only an active administrator may delete sellers' USING ERRCODE = '42501';
  END IF;

  IF p_target_id = p_actor_id THEN
    RAISE EXCEPTION 'an administrator cannot delete itself' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_target
  FROM public.profiles
  WHERE id = p_target_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'seller not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_target.role <> 'seller' THEN
    RAISE EXCEPTION 'only seller profiles can be deleted' USING ERRCODE = '22023';
  END IF;

  SELECT pg_catalog.array_agg(DISTINCT event.payment_batch_id)
  INTO v_batch_ids
  FROM public.commission_payment_events AS event
  JOIN public.commissions AS commission ON commission.id = event.commission_id
  WHERE commission.seller_id = p_target_id;

  DELETE FROM public.commission_payment_events AS event
  USING public.commissions AS commission
  WHERE event.commission_id = commission.id
    AND commission.seller_id = p_target_id;

  DELETE FROM public.commissions
  WHERE seller_id = p_target_id;

  IF v_batch_ids IS NOT NULL THEN
    DELETE FROM public.payment_batches AS batch
    WHERE batch.id = ANY (v_batch_ids)
      AND NOT EXISTS (
        SELECT 1
        FROM public.commission_payment_events AS event
        WHERE event.payment_batch_id = batch.id
      );
  END IF;

  DELETE FROM public.app_session_registry
  WHERE user_id = p_target_id;

  DELETE FROM public.profile_archive_events
  WHERE target_id = p_target_id;

  DELETE FROM public.profiles
  WHERE id = p_target_id;

  RETURN QUERY SELECT p_target_id;
END;
$$;

CREATE FUNCTION public.delete_product(p_product_id uuid, p_actor_id uuid)
RETURNS TABLE (deleted_product_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
BEGIN
  IF p_product_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'product and actor are required' USING ERRCODE = '22004';
  END IF;

  SELECT * INTO v_actor
  FROM public.profiles
  WHERE id = p_actor_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_actor.role <> 'admin'
    OR v_actor.active IS NOT TRUE
    OR v_actor.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'only an active administrator may delete products' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product not found' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (SELECT 1 FROM public.commissions WHERE product_id = p_product_id) THEN
    RAISE EXCEPTION 'product is referenced by commissions' USING ERRCODE = '23503';
  END IF;

  DELETE FROM public.product_rule_events
  WHERE product_id = p_product_id;

  DELETE FROM public.products
  WHERE id = p_product_id;

  RETURN QUERY SELECT p_product_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_commission(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_seller(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_product(uuid, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.delete_commission(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_seller(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_product(uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
