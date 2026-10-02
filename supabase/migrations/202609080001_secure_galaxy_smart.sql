BEGIN;

create type public.app_role as enum ('admin', 'seller');
create type public.commission_type as enum ('percentage', 'fixed');
create type public.commission_status as enum ('pending', 'paid', 'voided');
create type public.payment_event_type as enum ('paid', 'voided');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  email text not null unique,
  username text not null,
  username_normalized text not null unique,
  display_name text not null,
  role public.app_role not null,
  active boolean not null default true,
  session_not_before timestamptz not null default 'epoch'::timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_email_normalized_check
    check (email = lower(btrim(email)) and email <> ''),
  constraint profiles_username_normalized_check
    check (username_normalized = lower(btrim(username_normalized)) and username_normalized <> ''),
  constraint profiles_username_check
    check (btrim(username) <> ''),
  constraint profiles_display_name_check
    check (btrim(display_name) <> '')
);

create unique index profiles_one_admin_idx
  on public.profiles (role)
  where role = 'admin';

create table public.commissions (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete restrict,
  seller_name_snapshot text not null,
  product text not null,
  sale_value_cents bigint not null,
  commission_type public.commission_type not null,
  commission_rate_bps integer,
  commission_fixed_cents bigint,
  commission_value_cents bigint generated always as (
    case commission_type
      when 'percentage' then (sale_value_cents * commission_rate_bps + 5000) / 10000
      when 'fixed' then commission_fixed_cents
    end
  ) stored,
  status public.commission_status not null default 'pending',
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commissions_seller_name_snapshot_check
    check (btrim(seller_name_snapshot) <> ''),
  constraint commissions_product_check
    check (char_length(btrim(product)) between 1 and 200),
  constraint commissions_sale_value_cents_range_check
    check (sale_value_cents between 1 and 900000000000000),
  constraint commissions_type_amounts_check check (
    (commission_type = 'percentage'
      and commission_rate_bps between 1 and 10000
      and commission_fixed_cents is null)
    or
    (commission_type = 'fixed'
      and commission_rate_bps is null
      and commission_fixed_cents between 1 and 900000000000000)
  ),
  constraint commissions_status_paid_at_check check (
    (status = 'paid' and paid_at is not null)
    or
    (status in ('pending', 'voided') and paid_at is null)
  )
);

create index commissions_seller_created_at_idx
  on public.commissions (seller_id, created_at desc);

create index commissions_status_created_at_idx
  on public.commissions (status, created_at desc);

create table public.payment_batches (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.commission_payment_events (
  id uuid primary key default gen_random_uuid(),
  commission_id uuid not null references public.commissions(id) on delete restrict,
  payment_batch_id uuid not null references public.payment_batches(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  event_type public.payment_event_type not null,
  previous_status public.commission_status not null,
  new_status public.commission_status not null,
  created_at timestamptz not null default now()
);

create unique index commission_payment_events_paid_once_idx
  on public.commission_payment_events (commission_id, event_type)
  where event_type = 'paid';

create table public.bootstrap_locks (
  scope text primary key,
  owner_token uuid not null,
  lease_expires_at timestamptz not null
);

CREATE FUNCTION public.mark_commissions_paid(p_commission_ids uuid[], p_actor_id uuid)
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
    WHERE c.status = 'pending'
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

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_commissions_paid(uuid[], uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_commissions_paid(uuid[], uuid) TO service_role;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commissions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payment_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE public.commission_payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_payment_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.bootstrap_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bootstrap_locks FORCE ROW LEVEL SECURITY;

COMMIT;
