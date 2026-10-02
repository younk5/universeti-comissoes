BEGIN;

CREATE OR REPLACE FUNCTION public.upsert_product_backed_commission(
  p_commission_id uuid,
  p_actor_id uuid,
  p_seller_id uuid,
  p_seller_name_snapshot text,
  p_product_id uuid,
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
  v_product public.products%ROWTYPE;
  v_commission public.commissions%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'p_actor_id must not be null' USING ERRCODE = '22004';
  END IF;

  PERFORM 1
  FROM public.profiles AS actor_profile
  WHERE actor_profile.id = p_actor_id
    AND actor_profile.role = 'admin'
    AND actor_profile.active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active admin actor required' USING ERRCODE = '42501';
  END IF;

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'p_product_id must not be null' USING ERRCODE = '22004';
  END IF;

  SELECT *
  INTO v_product
  FROM public.products
  WHERE id = p_product_id
    AND active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active product not found' USING ERRCODE = 'P0002';
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
      v_product.id,
      v_product.name,
      p_sale_value_cents,
      v_product.commission_type,
      v_product.commission_rate_bps,
      v_product.commission_fixed_cents,
      p_sale_date,
      p_note
    )
    RETURNING * INTO v_commission;
  ELSE
    UPDATE public.commissions AS commission
    SET
      seller_id = p_seller_id,
      seller_name_snapshot = p_seller_name_snapshot,
      product_id = v_product.id,
      product = v_product.name,
      sale_value_cents = p_sale_value_cents,
      commission_type = v_product.commission_type,
      commission_rate_bps = v_product.commission_rate_bps,
      commission_fixed_cents = v_product.commission_fixed_cents,
      sale_date = p_sale_date,
      note = p_note
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

REVOKE ALL ON FUNCTION public.upsert_product_backed_commission(uuid, uuid, uuid, text, uuid, bigint, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_product_backed_commission(uuid, uuid, uuid, text, uuid, bigint, date, text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
