-- Commission ledger: editable fee settings, per-car commission, overrides, and
-- a payments ledger with running balances.
--
-- Builds on booking_fees (20260919) rather than adding commission columns to
-- bookings. booking_fees is already the per-job snapshot, written by trigger at
-- completion, and it has its own RLS: a detailer reads only their own rows. RLS
-- cannot hide individual columns of bookings, and two homes for the same number
-- would drift.
--
-- What changes:
--   * Fees come from two settings tables instead of being hardcoded:
--       service_fees (per car, by package) and addon_fees (once per booking).
--     Seeded: Gold int 30 / full 37, Titanium int 40 / full 46; pet hair 10,
--     engine bay 15. Silver and tint have no fee set.
--   * commission = package fee x car_count + add-ons. The old rule charged the
--     package once per booking and nothing for the engine bay; rows already
--     written keep their amounts - a snapshot is never recomputed.
--   * A completed job whose package has no fee gets fee_amount NULL, which the
--     panel flags as "Fee not set". It is never counted as $0.
--   * An admin can override any job's commission, with a required reason. That
--     is also how a no-show fee is charged: an override on a cancelled booking
--     keeps (or creates) the row, dated to the service date.
--   * Payments are recorded against a detailer, not a week. Partial payments are
--     fine. Balance = all commission - all payments. fee_status ('owed'/'paid')
--     is left in place but no longer drives anything; weeks already marked paid
--     are carried into the ledger as payments so no balance moves.
--   * bookings.completed_at, set when a booking becomes completed. A booking
--     inserted as completed, or given a detailer after completion, now gets its
--     commission too - previously only the status transition did.
--
-- Nothing is dropped or renamed. booking_fee_for() and admin_mark_week_paid/
-- owed() stay defined; nothing calls them after this.

-- ---------------------------------------------------------------------------
-- 0. Monday of a date's week. Pure date arithmetic, so no session time zone.
-- ---------------------------------------------------------------------------
create or replace function public.week_monday(p_day date)
returns date
language sql immutable
as $fn$
  select p_day - (extract(isodow from p_day)::int - 1);
$fn$;

-- ---------------------------------------------------------------------------
-- 1. Fee settings
-- ---------------------------------------------------------------------------
create table if not exists public.service_fees (
  service_key  public.service_type primary key,
  -- Null = no fee set. A completed job on such a package is flagged, not $0.
  fee_per_car  numeric(10,2) check (fee_per_car is null or fee_per_car >= 0),
  is_active    boolean not null default true,
  updated_at   timestamptz not null default now()
);

create table if not exists public.addon_fees (
  addon_key   text primary key check (addon_key in ('pet_hair', 'engine_bay')),
  fee         numeric(10,2) not null check (fee >= 0),
  is_active   boolean not null default true,
  updated_at  timestamptz not null default now()
);

insert into public.service_fees (service_key, fee_per_car) values
  ('interior_gold', 30), ('full_gold', 37), ('interior_titanium', 40), ('full_titanium', 46),
  ('interior_silver', null), ('full_silver', null),
  ('tint', null), ('ceramic_tint', null), ('nano_ceramic_tint', null)
on conflict (service_key) do nothing;

insert into public.addon_fees (addon_key, fee) values ('pet_hair', 10), ('engine_bay', 15)
on conflict (addon_key) do nothing;

drop trigger if exists trg_service_fees_touch on public.service_fees;
create trigger trg_service_fees_touch before update on public.service_fees
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_addon_fees_touch on public.addon_fees;
create trigger trg_addon_fees_touch before update on public.addon_fees
  for each row execute function public.touch_updated_at();

alter table public.service_fees enable row level security;
alter table public.addon_fees enable row level security;

drop policy if exists "Admins manage service fees" on public.service_fees;
create policy "Admins manage service fees" on public.service_fees for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Admins manage add-on fees" on public.addon_fees;
create policy "Admins manage add-on fees" on public.addon_fees for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- The commission for a job, from the current settings. The one place the
-- formula lives; the completion trigger snapshots its result.
-- Engine bay is charged only when the customer paid for it (> 0): a waived
-- engine bay put no money in the detailer's hand to take a cut of.
create or replace function public.commission_for(
  p_service public.service_type, p_car_count integer, p_pet_hair boolean, p_engine_bay_fee numeric
)
returns table (
  package_fee_per_car numeric, cars integer, package_fee numeric,
  pet_hair_fee numeric, engine_bay_commission numeric, fee_amount numeric
)
language sql stable security definer set search_path = public, pg_temp
as $fn$
  select sf.fee_per_car,
         greatest(coalesce(p_car_count, 1), 1),
         sf.fee_per_car * greatest(coalesce(p_car_count, 1), 1),
         case when p_pet_hair then coalesce(ph.fee, 0) else 0 end,
         case when coalesce(p_engine_bay_fee, 0) > 0 then coalesce(eb.fee, 0) else 0 end,
         -- Null when the package has no fee: the whole commission is unknown.
         sf.fee_per_car * greatest(coalesce(p_car_count, 1), 1)
           + case when p_pet_hair then coalesce(ph.fee, 0) else 0 end
           + case when coalesce(p_engine_bay_fee, 0) > 0 then coalesce(eb.fee, 0) else 0 end
  from (select 1) one
  left join public.service_fees sf on sf.service_key = p_service and sf.is_active
  left join public.addon_fees ph on ph.addon_key = 'pet_hair' and ph.is_active
  left join public.addon_fees eb on eb.addon_key = 'engine_bay' and eb.is_active;
$fn$;

-- Internal: only the (security definer) trigger calls it. Supabase grants new
-- functions to authenticated by default, so that grant is revoked explicitly.
revoke execute on function public.commission_for(public.service_type, integer, boolean, numeric) from public, anon, authenticated;

-- What a detailer sees before taking a job. The settings tables are admin-only;
-- this exposes just the active rates, which a detailer pays anyway.
create or replace function public.fee_schedule()
returns table (kind text, key text, fee numeric)
language sql stable security definer set search_path = public, pg_temp
as $fn$
  select 'service', service_key::text, fee_per_car from public.service_fees
   where is_active and fee_per_car is not null
  union all
  select 'addon', addon_key, fee from public.addon_fees where is_active;
$fn$;

revoke execute on function public.fee_schedule() from public, anon;
grant execute on function public.fee_schedule() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Payments
-- ---------------------------------------------------------------------------
create table if not exists public.detailer_payments (
  id           uuid primary key default gen_random_uuid(),
  detailer_id  uuid not null references public.detailers(id),
  amount       numeric(10,2) not null check (amount > 0),
  -- A Brampton calendar date. The week it counts in is its Monday.
  paid_on      date not null default ((now() at time zone 'America/Toronto')::date),
  method       text not null default 'e_transfer' check (method in ('e_transfer', 'cash', 'other')),
  note         text,
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid() references auth.users(id) on delete set null
);

create index if not exists detailer_payments_detailer_paid_idx
  on public.detailer_payments (detailer_id, paid_on);

alter table public.detailer_payments enable row level security;

drop policy if exists "Admins manage payments" on public.detailer_payments;
create policy "Admins manage payments" on public.detailer_payments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
-- Identity, not active status, as with booking_fees: someone off the roster
-- still owes what they owe and needs to see what they have paid.
drop policy if exists "Detailers see their own payments" on public.detailer_payments;
create policy "Detailers see their own payments" on public.detailer_payments for select to authenticated
  using (detailer_id = public.current_detailer_id());

-- Weeks already marked paid become payments, once, so balances do not move.
insert into public.detailer_payments (detailer_id, amount, paid_on, method, note, created_at, created_by)
select f.detailer_id, sum(f.fee_amount),
       (min(f.paid_at) at time zone 'America/Toronto')::date,
       'other',
       'Week of ' || to_char(f.week_start, 'Mon FMDD') || ' marked paid before the payments ledger',
       min(f.paid_at), null
  from public.booking_fees f
 where f.status = 'paid'
   and not exists (select 1 from public.detailer_payments)
 group by f.detailer_id, f.week_start;

-- ---------------------------------------------------------------------------
-- 3. bookings.completed_at
-- ---------------------------------------------------------------------------
alter table public.bookings add column if not exists completed_at timestamptz;

create or replace function public.stamp_booking_completed_at()
returns trigger
language plpgsql
as $fn$
begin
  if new.status = 'completed' then
    if tg_op = 'INSERT' then
      new.completed_at := coalesce(new.completed_at, now());
    elsif old.status is distinct from 'completed'
          and new.completed_at is not distinct from old.completed_at then
      -- A caller may supply the moment (a late entry); otherwise it is now.
      new.completed_at := now();
    end if;
  else
    new.completed_at := null;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_bookings_completed_at on public.bookings;
create trigger trg_bookings_completed_at
  before insert or update of status, completed_at on public.bookings
  for each row execute function public.stamp_booking_completed_at();

-- ---------------------------------------------------------------------------
-- 4. booking_fees: the snapshot, extended
-- ---------------------------------------------------------------------------
alter table public.booking_fees
  add column if not exists completed_at          timestamptz,
  -- Cars the package fee was charged for. 1 on rows from the old per-booking rule.
  add column if not exists car_count             integer,
  add column if not exists package_fee_per_car   numeric(10,2),
  add column if not exists package_fee           numeric(10,2),
  -- Absolute's share of the engine bay. Not the customer's engine_bay_fee.
  add column if not exists engine_bay_commission numeric(10,2) not null default 0,
  add column if not exists commission_override   numeric(10,2),
  add column if not exists override_reason       text,
  add column if not exists overridden_at         timestamptz,
  add column if not exists overridden_by         uuid references auth.users(id) on delete set null;

-- Null fee_amount = the package had no fee set. Flagged in the panel.
alter table public.booking_fees alter column fee_amount drop not null;

alter table public.booking_fees
  add column if not exists effective_amount numeric(10,2)
  generated always as (coalesce(commission_override, fee_amount)) stored;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'booking_fees_override_needs_reason') then
    alter table public.booking_fees add constraint booking_fees_override_needs_reason
      check (commission_override is null or length(btrim(coalesce(override_reason, ''))) > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'booking_fees_override_non_negative') then
    alter table public.booking_fees add constraint booking_fees_override_non_negative
      check (commission_override is null or commission_override >= 0);
  end if;
end $$;

-- completed_on and week_start follow completed_at (Brampton date), so they can
-- never disagree. A row with no completed_at - an override on a job that was
-- not completed - keeps the service date it was given.
create or replace function public.booking_fees_derive_week()
returns trigger
language plpgsql
as $fn$
begin
  if new.completed_at is not null then
    new.completed_on := (new.completed_at at time zone 'America/Toronto')::date;
  end if;
  new.week_start := public.week_monday(new.completed_on);
  return new;
end;
$fn$;

drop trigger if exists trg_booking_fees_derive_week on public.booking_fees;
create trigger trg_booking_fees_derive_week
  before insert or update of completed_at, completed_on on public.booking_fees
  for each row execute function public.booking_fees_derive_week();

-- Backfill the 25 existing rows. The trigger wrote each one at the moment of
-- completion, so created_at is the completion time.
update public.booking_fees
   set completed_at = created_at,
       car_count = 1,
       package_fee = fee_amount - pet_hair_fee,
       package_fee_per_car = fee_amount - pet_hair_fee
 where completed_at is null;

update public.bookings b
   set completed_at = f.completed_at
  from public.booking_fees f
 where f.booking_id = b.id and b.status = 'completed' and b.completed_at is null;

-- ---------------------------------------------------------------------------
-- 5. The completion trigger
-- ---------------------------------------------------------------------------
create or replace function public.sync_booking_fee()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare
  v_total     numeric;
  v_completed boolean;
  v_day       date;
  c           record;
begin
  v_completed := new.status = 'completed'
                 and (tg_op = 'INSERT' or old.status is distinct from 'completed');

  -- Record the commission when a booking becomes completed with a detailer, or
  -- gets its first detailer while completed. completed_at is required, which
  -- keeps jobs completed before the fee model (none set) out of it.
  if new.status = 'completed' and new.assigned_detailer_id is not null and new.completed_at is not null
     and (v_completed or (tg_op = 'UPDATE' and old.assigned_detailer_id is distinct from new.assigned_detailer_id)) then
    v_total := coalesce(new.price, 0) + coalesce(new.engine_bay_fee, 0) + coalesce(new.out_of_area_fee, 0);
    v_day   := (new.completed_at at time zone 'America/Toronto')::date;
    select * into c from public.commission_for(new.service, new.car_count, new.pet_hair, new.engine_bay_fee);

    insert into public.booking_fees as f
      (booking_id, detailer_id, service, customer_total, car_count, package_fee_per_car, package_fee,
       pet_hair_fee, engine_bay_commission, fee_amount, completed_at, completed_on, week_start)
    values
      (new.id, new.assigned_detailer_id, new.service, v_total, c.cars, c.package_fee_per_car, c.package_fee,
       c.pet_hair_fee, c.engine_bay_commission, c.fee_amount, new.completed_at, v_day, public.week_monday(v_day))
    on conflict (booking_id) do update set
       detailer_id = excluded.detailer_id, service = excluded.service, customer_total = excluded.customer_total,
       car_count = excluded.car_count, package_fee_per_car = excluded.package_fee_per_car,
       package_fee = excluded.package_fee, pet_hair_fee = excluded.pet_hair_fee,
       engine_bay_commission = excluded.engine_bay_commission, fee_amount = excluded.fee_amount,
       completed_at = excluded.completed_at
     -- Only a fresh completion re-snapshots. Reassigning a completed job does
     -- not move its commission.
     where v_completed;
  end if;

  -- Stopped being completed: the commission goes, unless an admin overrode it
  -- (a no-show fee). That stays, dated to the service date.
  if tg_op = 'UPDATE' and old.status = 'completed' and new.status is distinct from 'completed' then
    delete from public.booking_fees where booking_id = new.id and commission_override is null;
    update public.booking_fees
       set completed_at = null, completed_on = new.booking_date, customer_total = 0
     where booking_id = new.id;
  end if;

  return null;
end;
$fn$;

drop trigger if exists trg_bookings_sync_fee on public.bookings;
create trigger trg_bookings_sync_fee
  after insert or update of status, assigned_detailer_id on public.bookings
  for each row execute function public.sync_booking_fee();

-- ---------------------------------------------------------------------------
-- 6. Overrides
-- p_amount null clears the override. On a job that is not completed, clearing
-- removes the row: without the override it owes nothing.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_commission_override(
  p_booking_id uuid, p_amount numeric, p_reason text default null
)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare
  b public.bookings%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  select * into b from public.bookings where id = p_booking_id;
  if not found then
    raise exception 'Booking not found' using errcode = 'P0002';
  end if;

  if p_amount is null then
    if b.status = 'completed' and b.completed_at is not null then
      update public.booking_fees
         set commission_override = null, override_reason = null, overridden_at = null, overridden_by = null
       where booking_id = p_booking_id;
    else
      delete from public.booking_fees where booking_id = p_booking_id;
    end if;
    return;
  end if;

  if p_amount < 0 then
    raise exception 'Commission cannot be negative' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Give a reason for the override' using errcode = '22023';
  end if;

  update public.booking_fees
     set commission_override = p_amount, override_reason = btrim(p_reason),
         overridden_at = now(), overridden_by = auth.uid()
   where booking_id = p_booking_id;

  if not found then
    if b.assigned_detailer_id is null then
      raise exception 'Assign a detailer before charging a commission' using errcode = '22023';
    end if;
    insert into public.booking_fees
      (booking_id, detailer_id, service, customer_total, fee_amount, completed_at, completed_on, week_start,
       commission_override, override_reason, overridden_at, overridden_by)
    values
      (b.id, b.assigned_detailer_id, b.service,
       case when b.status = 'completed'
            then coalesce(b.price, 0) + coalesce(b.engine_bay_fee, 0) + coalesce(b.out_of_area_fee, 0) else 0 end,
       null, case when b.status = 'completed' then b.completed_at end,
       b.booking_date, public.week_monday(b.booking_date),
       p_amount, btrim(p_reason), now(), auth.uid());
  end if;
end;
$fn$;

revoke execute on function public.admin_set_commission_override(uuid, numeric, text) from public, anon;
grant execute on function public.admin_set_commission_override(uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Weekly statements
-- One row per visible detailer per Monday in [p_from, p_to]. SECURITY INVOKER,
-- so RLS decides who appears: an admin gets everyone, a detailer only themself.
-- Commission counts by the week it was earned; a payment by its paid_on week.
-- ---------------------------------------------------------------------------
create or replace function public.detailer_week_statements(p_from date, p_to date)
returns table (detailer_id uuid, week_start date, opening numeric, earned numeric, paid numeric, closing numeric)
language sql stable security invoker set search_path = public, pg_temp
as $fn$
  with w as (
    select generate_series(public.week_monday(p_from), public.week_monday(p_to), interval '7 days')::date as week_start
  ),
  e as (
    select f.detailer_id, f.week_start, sum(f.effective_amount) as amt
      from public.booking_fees f where f.effective_amount is not null group by 1, 2
  ),
  p as (
    select dp.detailer_id, public.week_monday(dp.paid_on) as week_start, sum(dp.amount) as amt
      from public.detailer_payments dp group by 1, 2
  ),
  s as (
    select d.id as detailer_id, w.week_start,
           coalesce((select sum(e.amt) from e where e.detailer_id = d.id and e.week_start < w.week_start), 0)
         - coalesce((select sum(p.amt) from p where p.detailer_id = d.id and p.week_start < w.week_start), 0) as opening,
           coalesce((select sum(e.amt) from e where e.detailer_id = d.id and e.week_start = w.week_start), 0) as earned,
           coalesce((select sum(p.amt) from p where p.detailer_id = d.id and p.week_start = w.week_start), 0) as paid
      from public.detailers d cross join w
  )
  select detailer_id, week_start, opening, earned, paid, opening + earned - paid as closing
    from s
   order by detailer_id, week_start;
$fn$;

revoke execute on function public.detailer_week_statements(date, date) from public, anon;
grant execute on function public.detailer_week_statements(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Live updates for both apps. Realtime still applies RLS per subscriber.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'booking_fees') then
    alter publication supabase_realtime add table public.booking_fees;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'detailer_payments') then
    alter publication supabase_realtime add table public.detailer_payments;
  end if;
end $$;
