-- ============================================================================
-- The three functions that existed only in the database.
--
-- rh_email, rh_ping and rh_sleep were created directly through the management
-- API while working out why the panel's Custom API calls were failing, and none
-- of them was ever written down. rh_email is the one the Use Case 1 email
-- actually runs on, so the repository could not rebuild the thing the demo
-- depends on most. Recorded here from the live definitions.
--
-- rh_touch is not here because migration 01 already carries it.
--
-- The same audit found migration 02 describing rh_offer with an integer fourth
-- parameter when the live function takes text. Replaying it would have created
-- a second overload beside the working one rather than the working one itself,
-- and PostgREST would then have had two candidates to choose between. That file
-- is corrected in the same change.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- rh_email: the same answer as rh_offer, minus everything a message ignores.
--
-- rh_offer returns about 12 KB, and 83 percent of it is the stock map and the
-- list of serving shops, which paint a storefront and mean nothing in an email.
-- This is the same query projected down to roughly 2 KB. That mattered when the
-- fourth parameter had to survive a merge tag that resolved to nothing, and it
-- still matters because this runs once per recipient at send time.
-- ----------------------------------------------------------------------------
create or replace function public.rh_email(
    cep      text default null,
    store_id text default null,
    sku      text default null,
    n        text default null
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
    v_full jsonb;
begin
    v_full := public.rh_offer(cep, store_id, sku, coalesce(nullif(n, ''), '3'));

    -- Everything a message renders, and nothing a message ignores.
    return jsonb_build_object(
        'ok',               v_full -> 'ok',
        'resolved',         v_full -> 'resolved',
        'cep',              v_full -> 'cep',
        'region',           v_full -> 'region',
        'storeName',        coalesce(v_full -> 'store' ->> 'name', ''),
        'storeId',          coalesce(v_full -> 'store' ->> 'id', ''),
        'storeCount',       v_full -> 'storeCount',
        'hero',             v_full -> 'hero',
        'substitute',       v_full -> 'substitute',
        'substituteReason', coalesce(v_full ->> 'substituteReason', ''),
        'offers',           v_full -> 'offers',
        'generatedAt',      v_full -> 'generatedAt'
    );
end;
$$;


-- ----------------------------------------------------------------------------
-- rh_ping: 26 bytes, and the point is that it does no work at all.
--
-- When a call fails there are always two candidates, the journey and the work,
-- and one endpoint that answers without doing anything separates them. It is
-- what proved the Tokyo project answers reliably from Dengage, three times out
-- of three, after distance had been blamed twice and was wrong twice.
-- ----------------------------------------------------------------------------
create or replace function public.rh_ping()
returns jsonb
language sql
immutable
set search_path = public
as $$
    select jsonb_build_object('ok', true, 'pong', 'rh');
$$;


-- ----------------------------------------------------------------------------
-- rh_sleep: takes a known amount of time, so somebody else's timeout can be
-- measured rather than guessed at.
--
-- Exposed as endpoints at zero, one and two seconds, it found where Dengage
-- stops waiting: a plain call answers, the same call plus one second does not.
--
-- Clamped to ten seconds, though the real ceiling is lower and is not ours:
-- Postgres cancels its own statements at about three, so anything above that
-- fails on this side and would say nothing about Dengage at all.
-- ----------------------------------------------------------------------------
create or replace function public.rh_sleep(seconds text default '0')
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
    v_wanted  numeric;
    v_started timestamptz := clock_timestamp();
begin
    -- Same defensive parse as rh_offer, and for the same reason: a parameter
    -- that arrives blank must produce an answer rather than a 400.
    v_wanted := coalesce(
        nullif(regexp_replace(coalesce(seconds, ''), '[^0-9.]', '', 'g'), '')::numeric,
        0
    );
    v_wanted := least(greatest(v_wanted, 0), 10);

    perform pg_sleep(v_wanted);

    -- Reporting what it actually took, not what was asked for, because the two
    -- differ exactly when the answer is interesting.
    return jsonb_build_object(
        'ok', true,
        'askedFor', v_wanted,
        'actuallyTook', round(extract(epoch from (clock_timestamp() - v_started))::numeric, 3),
        'note', 'measuring the Dengage Custom API timeout'
    );
end;
$$;


-- The publishable key is what the panel and the storefront present. These read
-- and return; none of them writes anything.
grant execute on function public.rh_email(text, text, text, text) to anon, authenticated;
grant execute on function public.rh_ping() to anon, authenticated;
grant execute on function public.rh_sleep(text) to anon, authenticated;
