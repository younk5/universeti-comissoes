BEGIN;

ALTER TABLE public.commissions
  ADD COLUMN IF NOT EXISTS sale_date date NOT NULL DEFAULT current_date,
  ADD COLUMN IF NOT EXISTS note text NOT NULL DEFAULT '';

ALTER TABLE public.commissions
  ALTER COLUMN sale_date DROP DEFAULT;

CREATE FUNCTION public.void_commission(p_commission_id uuid, p_actor_id uuid)
returns table (
  commission_id uuid,
  voided_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_voided_at timestamptz := clock_timestamp();
begin
  if p_commission_id is null then
    raise exception 'p_commission_id must not be null' using errcode = '22004';
  end if;

  if p_actor_id is null then
    raise exception 'p_actor_id must not be null' using errcode = '22004';
  end if;

  return query
  with updated as (
    update public.commissions as c
    set
      status = 'voided',
      updated_at = v_voided_at
    where c.status = 'pending'
      and c.id = p_commission_id
    returning c.id
  ), new_batch as (
    insert into public.payment_batches (actor_id, created_at)
    select p_actor_id, v_voided_at
    where exists (select 1 from updated)
    returning id
  ), inserted_events as (
    insert into public.commission_payment_events as payment_event (
      commission_id,
      payment_batch_id,
      actor_id,
      event_type,
      previous_status,
      new_status,
      created_at
    )
    select
      updated.id,
      new_batch.id,
      p_actor_id,
      'voided',
      'pending',
      'voided',
      v_voided_at
    from updated
    cross join new_batch
    returning payment_event.commission_id
  )
  select inserted_events.commission_id, v_voided_at
  from inserted_events;
end;
$$;

REVOKE ALL ON FUNCTION public.void_commission(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.void_commission(uuid, uuid) TO service_role;

COMMIT;
