BEGIN;

CREATE OR REPLACE FUNCTION public.mark_commissions_paid(p_commission_ids uuid[], p_actor_id uuid)
returns table (
  commission_id uuid,
  paid_at timestamptz,
  payment_batch_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid_at timestamptz := clock_timestamp();
begin
  if coalesce(array_length(p_commission_ids, 1), 0) = 0 then
    raise exception 'p_commission_ids must not be empty' using errcode = '22023';
  end if;

  if p_actor_id is null then
    raise exception 'p_actor_id must not be null' using errcode = '22004';
  end if;

  return query
  with updated as (
    update public.commissions as c
    set
      status = 'paid',
      paid_at = v_paid_at,
      updated_at = v_paid_at
    where c.status = 'pending'
      and c.id = any(p_commission_ids)
    returning c.id, c.paid_at
  ),
  new_batch as (
    insert into public.payment_batches (actor_id, created_at)
    select p_actor_id, v_paid_at
    where exists (select 1 from updated)
    returning id
  ),
  inserted_events as (
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
      'paid',
      'pending',
      'paid',
      v_paid_at
    from updated
    cross join new_batch
    returning
      payment_event.commission_id as event_commission_id,
      payment_event.payment_batch_id as event_payment_batch_id
  )
  select updated.id, updated.paid_at, inserted_events.event_payment_batch_id
  from updated
  join inserted_events on inserted_events.event_commission_id = updated.id;
end;
$$;

REVOKE ALL ON FUNCTION public.mark_commissions_paid(uuid[], uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_commissions_paid(uuid[], uuid) TO service_role;

COMMIT;
