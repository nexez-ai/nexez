-- Pass 4: exact, owner-scoped finance reporting.
--
-- The finance cockpit previously downloaded the newest 1,000 checkout orders
-- and 500 negotiations, then calculated period and all-time totals in React.
-- This additive, read-only function aggregates the complete owner-visible set
-- in Postgres, keeps every settlement currency separate, distinguishes refunds
-- from disputes, and exposes sale-time economics coverage.

create or replace function public.nz_owner_finance_rollup(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_fallback_commission_bps integer default 0
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_result jsonb;
begin
  if v_owner_id is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;
  if p_to is not null and p_from is not null and p_to < p_from then
    raise exception 'finance range end must not precede its start'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_fallback_commission_bps < 0 or p_fallback_commission_bps > 1000 then
    raise exception 'fallback commission must be between 0 and 1000 basis points'
      using errcode = 'invalid_parameter_value';
  end if;

  with
  order_scope as materialized (
    select o.*
    from public.checkout_orders o
    where o.owner_id = v_owner_id
      and o.stripe_livemode = true
      and (p_from is null or o.created_at >= p_from)
      and (p_to is null or o.created_at <= p_to)
  ),
  order_base as materialized (
    select
      o.*,
      lower(coalesce(nullif(o.currency, ''), 'usd')) as currency_code,
      case
        when o.status = 'refunded' and coalesce(o.refunded_cents, 0) = 0 then o.amount_cents
        else least(o.amount_cents, greatest(coalesce(o.refunded_cents, 0), 0))
      end::bigint as refund_cents,
      case when o.status = 'disputed' then o.amount_cents else 0 end::bigint as dispute_cents,
      case
        when o.application_fee_cents is not null then greatest(o.application_fee_cents, 0)
        else round(
          o.amount_cents * coalesce(
            o.commission_bps,
            case when o.commission_percent is not null then round(o.commission_percent * 100)::integer end,
            p_fallback_commission_bps
          ) / 10000.0
        )::bigint
      end as original_fee_cents,
      (
        o.application_fee_cents is not null
        or o.commission_bps is not null
        or o.commission_percent is not null
      ) as economics_snapshotted,
      case coalesce(o.channel, 'legacy_direct')
        when 'agent_checkout' then 'direct'
        when 'legacy_direct' then 'direct'
        when 'acp' then 'agent_protocol'
        when 'ucp' then 'agent_protocol'
        when 'recurring_service' then 'recurring'
        when 'staged_settlement' then 'staged'
        when 'reservable_resource' then 'reserved'
        when 'nexie' then 'nexie'
        when 'negotiation' then 'negotiated_order'
        else coalesce(o.channel, 'other')
      end as channel_group
    from order_scope o
  ),
  order_economics as materialized (
    select
      b.*,
      case
        when b.status = 'disputed' then 0
        else greatest(0, b.amount_cents - b.refund_cents)
      end::bigint as retained_gross_cents,
      case
        when b.status = 'disputed' then 0
        else round(
          b.original_fee_cents * greatest(0, b.amount_cents - b.refund_cents)::numeric
          / nullif(b.amount_cents, 0)
        )::bigint
      end as retained_fee_cents
    from order_base b
  ),
  order_currency_rows as (
    select
      currency_code as currency,
      count(*)::bigint as transactions,
      coalesce(sum(amount_cents), 0)::bigint as gross_cents,
      coalesce(sum(retained_gross_cents), 0)::bigint as retained_gross_cents,
      coalesce(sum(refund_cents), 0)::bigint as refund_cents,
      coalesce(sum(dispute_cents), 0)::bigint as dispute_cents,
      coalesce(sum(greatest(refund_cents, dispute_cents)), 0)::bigint as outflow_cents,
      coalesce(sum(retained_fee_cents), 0)::bigint as fee_cents,
      coalesce(sum(greatest(0, retained_gross_cents - retained_fee_cents)), 0)::bigint as net_cents,
      count(*) filter (where refund_cents > 0 and refund_cents < amount_cents)::bigint as partial_refunds,
      count(*) filter (where economics_snapshotted)::bigint as snapshot_transactions,
      count(*) filter (where not economics_snapshotted)::bigint as estimated_transactions
    from order_economics
    group by currency_code
  ),
  channel_rows as (
    select
      currency_code as currency,
      channel_group as channel,
      count(*)::bigint as transactions,
      coalesce(sum(amount_cents), 0)::bigint as gross_cents,
      coalesce(sum(greatest(0, retained_gross_cents - retained_fee_cents)), 0)::bigint as net_cents
    from order_economics
    group by currency_code, channel_group
  ),
  daily_rows as (
    select
      currency_code as currency,
      date_trunc('day', created_at at time zone 'utc') as day,
      count(*)::bigint as transactions,
      coalesce(sum(amount_cents), 0)::bigint as gross_cents,
      coalesce(sum(greatest(refund_cents, dispute_cents)), 0)::bigint as outflow_cents,
      coalesce(sum(greatest(0, retained_gross_cents - retained_fee_cents)), 0)::bigint as net_cents
    from order_economics
    where created_at >= (date_trunc('day', now() at time zone 'utc') - interval '29 days') at time zone 'utc'
    group by currency_code, date_trunc('day', created_at at time zone 'utc')
  ),
  offer_ranked as (
    select
      currency_code as currency,
      page_id,
      max(coalesce(slug, '')) as slug,
      coalesce(offer_key, 'order') as offer_key,
      max(coalesce(offer_name, offer_key, 'Order')) as offer_name,
      count(*)::bigint as transactions,
      coalesce(sum(amount_cents), 0)::bigint as gross_cents,
      coalesce(sum(greatest(0, retained_gross_cents - retained_fee_cents)), 0)::bigint as net_cents,
      row_number() over (
        partition by currency_code
        order by sum(amount_cents) desc, count(*) desc, max(coalesce(offer_name, offer_key, 'Order'))
      ) as rank
    from order_economics
    where coalesce(offer_key, '') <> 'page'
    group by currency_code, page_id, offer_key
  ),
  negotiation_scope as materialized (
    select
      n.*,
      lower(coalesce(nullif(n.currency, ''), 'usd')) as currency_code,
      case
        when lower(coalesce(nullif(n.currency, ''), 'usd')) in (
          'bif','clp','djf','gnf','jpy','kmf','krw','mga','pyg','rwf','ugx','vnd','vuv','xaf','xof','xpf'
        ) then round(n.amount_cents / 100.0)::bigint
        else n.amount_cents::bigint
      end as stripe_amount_cents
    from public.agent_negotiations n
    where n.owner_id = v_owner_id
      and n.stripe_livemode = true
      and n.amount_cents > 0
  ),
  negotiation_economics as materialized (
    select
      n.*,
      case
        when n.status = 'refunded' and coalesce(n.refunded_cents, 0) = 0 then n.stripe_amount_cents
        else least(n.stripe_amount_cents, greatest(coalesce(n.refunded_cents, 0), 0))
      end::bigint as refund_cents,
      case when n.status = 'disputed' then n.stripe_amount_cents else 0 end::bigint as dispute_cents,
      case
        when n.application_fee_cents is not null then greatest(n.application_fee_cents, 0)
        else round(
          n.stripe_amount_cents * coalesce(
            n.commission_bps,
            case when n.commission_percent is not null then round(n.commission_percent * 100)::integer end,
            p_fallback_commission_bps
          ) / 10000.0
        )::bigint
      end as original_fee_cents,
      (
        n.application_fee_cents is not null
        or n.commission_bps is not null
        or n.commission_percent is not null
      ) as economics_snapshotted
    from negotiation_scope n
    where n.status in ('held', 'complete', 'refunded', 'disputed')
  ),
  negotiation_final as materialized (
    select
      n.*,
      case
        when n.status in ('held', 'disputed') then 0
        else greatest(0, n.stripe_amount_cents - n.refund_cents)
      end::bigint as retained_gross_cents,
      case
        when n.status in ('held', 'disputed') then 0
        else round(
          n.original_fee_cents * greatest(0, n.stripe_amount_cents - n.refund_cents)::numeric
          / nullif(n.stripe_amount_cents, 0)
        )::bigint
      end as retained_fee_cents
    from negotiation_economics n
  ),
  escrow_rows as (
    select
      currency_code as currency,
      count(*)::bigint as deals,
      coalesce(sum(stripe_amount_cents), 0)::bigint as funded_cents,
      coalesce(sum(stripe_amount_cents) filter (where status = 'held'), 0)::bigint as held_cents,
      coalesce(sum(stripe_amount_cents) filter (where status in ('complete','refunded','disputed')), 0)::bigint as captured_cents,
      coalesce(sum(refund_cents), 0)::bigint as refund_cents,
      coalesce(sum(dispute_cents), 0)::bigint as dispute_cents,
      coalesce(sum(greatest(refund_cents, dispute_cents)), 0)::bigint as outflow_cents,
      coalesce(sum(retained_fee_cents), 0)::bigint as fee_cents,
      coalesce(sum(greatest(0, retained_gross_cents - retained_fee_cents)), 0)::bigint as net_cents,
      count(*) filter (where refund_cents > 0 and refund_cents < stripe_amount_cents)::bigint as partial_refunds,
      count(*) filter (where economics_snapshotted)::bigint as snapshot_deals,
      count(*) filter (where not economics_snapshotted)::bigint as estimated_deals
    from negotiation_final
    group by currency_code
  ),
  negotiation_window_rows as (
    select
      currency_code as currency,
      count(*)::bigint as deals,
      coalesce(sum(stripe_amount_cents), 0)::bigint as funded_cents,
      coalesce(sum(stripe_amount_cents) filter (where status = 'held'), 0)::bigint as held_cents,
      coalesce(sum(stripe_amount_cents) filter (where status in ('complete','refunded','disputed')), 0)::bigint as captured_cents,
      coalesce(sum(greatest(refund_cents, dispute_cents)), 0)::bigint as outflow_cents,
      coalesce(sum(greatest(0, retained_gross_cents - retained_fee_cents)), 0)::bigint as net_cents
    from negotiation_final
    where (p_from is null or created_at >= p_from)
      and (p_to is null or created_at <= p_to)
    group by currency_code
  ),
  operations as (
    select
      (select count(*) from public.order_requests r
        where r.owner_id = v_owner_id and r.status in ('open','acknowledged'))::bigint as open_requests,
      (select count(*) from public.checkout_orders o
        where o.owner_id = v_owner_id and o.stripe_livemode = true and o.status = 'disputed')::bigint as disputed_orders,
      (select count(*) from public.agent_negotiations n
        where n.owner_id = v_owner_id and n.stripe_livemode = true and n.status = 'disputed')::bigint as disputed_negotiations,
      (select count(*) from public.agent_negotiations n
        where n.owner_id = v_owner_id and n.stripe_livemode = true and n.status = 'held')::bigint as held_negotiations,
      (select count(*) from public.agent_negotiations n
        where n.owner_id = v_owner_id and n.stripe_livemode = true and n.status = 'held'
          and n.updated_at < now() - interval '48 hours')::bigint as stale_held_negotiations,
      (select count(*) from public.checkout_orders o
        where o.owner_id = v_owner_id and o.stripe_livemode = true
          and o.application_fee_cents is null
          and o.commission_bps is null
          and o.commission_percent is null)::bigint
        + (select count(*) from public.agent_negotiations n
          where n.owner_id = v_owner_id and n.stripe_livemode = true
            and n.status in ('held','complete','refunded','disputed')
            and n.application_fee_cents is null
            and n.commission_bps is null
            and n.commission_percent is null)::bigint
        as estimated_economics
  )
  select jsonb_build_object(
    'schemaVersion', 1,
    'currencies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', currency,
        'transactions', transactions,
        'grossCents', gross_cents,
        'retainedGrossCents', retained_gross_cents,
        'refundCents', refund_cents,
        'disputeCents', dispute_cents,
        'outflowCents', outflow_cents,
        'feeCents', fee_cents,
        'netCents', net_cents,
        'aovCents', case when transactions > 0 then round(gross_cents::numeric / transactions)::bigint else 0 end,
        'partialRefunds', partial_refunds,
        'snapshotTransactions', snapshot_transactions,
        'estimatedTransactions', estimated_transactions
      ) order by gross_cents desc, currency)
      from order_currency_rows
    ), '[]'::jsonb),
    'channels', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', currency, 'channel', channel, 'transactions', transactions,
        'grossCents', gross_cents, 'netCents', net_cents
      ) order by currency, gross_cents desc, channel)
      from channel_rows
    ), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', currency, 'date', to_char(day, 'YYYY-MM-DD'),
        'transactions', transactions, 'grossCents', gross_cents,
        'outflowCents', outflow_cents, 'netCents', net_cents
      ) order by day, currency)
      from daily_rows
    ), '[]'::jsonb),
    'topOffers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', currency, 'pageId', page_id, 'slug', slug,
        'offerKey', offer_key, 'offerName', offer_name,
        'transactions', transactions, 'grossCents', gross_cents, 'netCents', net_cents
      ) order by currency, rank)
      from offer_ranked where rank <= 10
    ), '[]'::jsonb),
    'escrow', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', currency, 'deals', deals, 'fundedCents', funded_cents,
        'heldCents', held_cents, 'capturedCents', captured_cents,
        'refundCents', refund_cents, 'disputeCents', dispute_cents,
        'outflowCents', outflow_cents,
        'feeCents', fee_cents, 'netCents', net_cents,
        'partialRefunds', partial_refunds, 'snapshotDeals', snapshot_deals,
        'estimatedDeals', estimated_deals
      ) order by funded_cents desc, currency)
      from escrow_rows
    ), '[]'::jsonb),
    'negotiatedWindow', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', currency, 'deals', deals, 'fundedCents', funded_cents,
        'heldCents', held_cents, 'capturedCents', captured_cents,
        'outflowCents', outflow_cents, 'netCents', net_cents
      ) order by funded_cents desc, currency)
      from negotiation_window_rows
    ), '[]'::jsonb),
    'operations', jsonb_build_object(
      'openRequests', op.open_requests,
      'disputedOrders', op.disputed_orders,
      'disputedNegotiations', op.disputed_negotiations,
      'heldNegotiations', op.held_negotiations,
      'staleHeldNegotiations', op.stale_held_negotiations,
      'estimatedEconomics', op.estimated_economics
    )
  ) into v_result
  from operations op;

  return v_result;
end;
$$;

revoke execute on function public.nz_owner_finance_rollup(timestamptz, timestamptz, integer)
  from public, anon;
grant execute on function public.nz_owner_finance_rollup(timestamptz, timestamptz, integer)
  to authenticated, service_role;

comment on function public.nz_owner_finance_rollup(timestamptz, timestamptz, integer) is
  'Exact RLS-scoped settlement, refund, dispute, fee, channel, and escrow reporting for the authenticated owner.';
