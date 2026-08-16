-- ============================================================================
-- rh_offer: the one question this demo answers, and the only endpoint it needs.
--
--   "For this customer, right now, what can the shop that would actually serve
--    them put in their hands, and if the thing they wanted is not there, what
--    is the honest alternative?"
--
-- The storefront asks it. The email asks it at send time, per recipient, through
-- the panel's Custom API endpoint. The Android app asks it when a push is
-- tapped. One resolution layer, every channel, which is requirement R3.1 and is
-- also the reason there is exactly one function here rather than five.
--
-- CALLED AS A GET SO THE PANEL CAN CALL IT:
--   https://<project>.supabase.co/rest/v1/rpc/rh_offer?cep=01310-100&sku=...&n=4
-- PostgREST only allows GET on a function marked stable, hence `stable` below.
-- That is not decoration; drop it and the email stops working.
--
-- WHAT IT NEVER DOES: throw. Every failure a customer can cause has a named
-- answer, because a template that errors at send time drops the whole message
-- and nobody finds out until the campaign report. Requirement R3.3 in one word:
-- unresolvable postcodes, regions with no shop, and empty catalogues all come
-- back as ordinary JSON with `ok` true and a `resolved` reason.
-- ============================================================================

create or replace function public.rh_offer(
    cep      text default null,
    store_id text default null,
    sku      text default null,
    -- Text rather than integer, and this is not a style choice. PostgREST binds
    -- query string parameters by declared type, so an empty n, which is what a
    -- merge tag that resolved to nothing produces, was rejected before this
    -- function ever ran: 400, invalid input syntax for type integer. A send
    -- cannot fail because a field was blank, so every parameter arrives as text
    -- and is parsed below where a bad value can be handled rather than thrown.
    n        text default null
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
    v_digits   text;
    v_region   text;
    v_label    text;
    v_store    public.rh_store%rowtype;
    v_hero     public.rh_product%rowtype;
    v_hero_state text;
    v_sub      jsonb := null;
    v_reason   text := null;
    v_offers   jsonb := '[]'::jsonb;
    v_stock    jsonb := '{}'::jsonb;
    v_stores   jsonb := '[]'::jsonb;
    v_resolved text;
    v_limit    integer;
    v_sku      text;
    v_store_in text;
begin
    -- Anything that is not a run of digits becomes the default rather than an
    -- error. A blank, a stray space or a merge tag that failed to resolve all
    -- land here, and none of them should be able to break a send.
    v_limit := coalesce(nullif(regexp_replace(coalesce(n, ''), '[^0-9]', '', 'g'), '')::integer, 4);
    v_limit := least(greatest(v_limit, 1), 12);

    v_sku      := nullif(btrim(coalesce(sku, '')), '');
    v_store_in := nullif(btrim(coalesce(store_id, '')), '');
    -- ------------------------------------------------------------------
    -- 1. Postcode to region. Punctuation is stripped because a person types
    --    01310-100, 01310100 or "01310 100" and all three mean the same shop.
    -- ------------------------------------------------------------------
    v_digits := regexp_replace(coalesce(cep, ''), '[^0-9]', '', 'g');

    if v_store_in is not null then
        select * into v_store from public.rh_store s where s.store_id = v_store_in;
    elsif length(v_digits) >= 5 then
        -- Exact postcode first, then the longest prefix that matches. Longest
        -- wins so a specific rule can always override a broad one.
        select r.region_code, r.label into v_region, v_label
        from public.rh_cep_region r
        where r.cep = v_digits
        limit 1;

        if v_region is null then
            select r.region_code, r.label into v_region, v_label
            from public.rh_cep_region r
            where r.prefix is not null and v_digits like r.prefix || '%'
            order by length(r.prefix) desc
            limit 1;
        end if;

        if v_region is not null then
            select * into v_store
            from public.rh_store s
            where s.region_code = v_region and s.is_pickup
            order by s.rank, s.name
            limit 1;
        end if;
    end if;

    -- ------------------------------------------------------------------
    -- 2. Decide which of the three worlds we are in, and say so plainly.
    -- ------------------------------------------------------------------
    if v_store.store_id is not null then
        v_resolved := 'store';
        v_region   := v_store.region_code;
        v_label    := v_store.region_label;
    elsif v_region is not null then
        -- The postcode is real and we know the area. There is simply no shop
        -- that serves it. Rio Branco is exactly this, with real data behind it.
        v_resolved := 'no_store';
    else
        v_resolved := 'unknown_cep';
    end if;

    -- ------------------------------------------------------------------
    -- 3. The hero, when one was asked for.
    -- ------------------------------------------------------------------
    if v_sku is not null then
        select * into v_hero from public.rh_product p where p.sku_id = v_sku and p.is_active;
    end if;

    if v_hero.sku_id is not null and v_store.store_id is not null then
        select ss.state into v_hero_state
        from public.rh_store_stock ss
        where ss.sku_id = v_hero.sku_id and ss.store_id = v_store.store_id;
        -- No row means we never captured this pair. That is unknown, not "in
        -- stock", so it is treated exactly like withoutStock downstream.
        v_hero_state := coalesce(v_hero_state, 'withoutStock');
    end if;

    -- ------------------------------------------------------------------
    -- 4. Substitution, only when the hero cannot be had at this shop.
    --
    --    The cascade is ordered the way a shop assistant actually thinks about
    --    it for toys, and it is Ri Happy's blocking question number five, so
    --    the ordering is meant to be argued with rather than hidden:
    --
    --      same franchise   a child who wants LEGO wants LEGO
    --      overlapping age  the wrong age band is a returned present
    --      same shelf       department then category
    --      near the price   within 30 percent either way
    --
    --    Every candidate is filtered to what this shop can actually hand over
    --    first, so a substitution can never itself be unavailable.
    -- ------------------------------------------------------------------
    if v_hero.sku_id is not null and v_store.store_id is not null and v_hero_state <> 'available' then
        select to_jsonb(c) - 'rank_licence' - 'rank_age' - 'rank_shelf' - 'rank_price' - 'gap',
               case
                   when c.rank_licence = 0 then 'same_licence'
                   when c.rank_age     = 0 then 'same_age_and_shelf'
                   when c.rank_shelf   = 0 then 'same_shelf'
                   else 'nearby_price'
               end
          into v_sub, v_reason
        from (
            select p.sku_id, p.name, p.brand, p.licence, p.price, p.list_price,
                   p.age_display, p.image_url, p.page_url, p.category,
                   case when p.licence is not null and p.licence = v_hero.licence then 0 else 1 end as rank_licence,
                   case when p.age_min_months is not null and v_hero.age_min_months is not null
                             and p.age_min_months <= coalesce(v_hero.age_max_months, 216)
                             and coalesce(p.age_max_months, 216) >= v_hero.age_min_months
                        then 0 else 1 end as rank_age,
                   case when p.department = v_hero.department and p.category = v_hero.category then 0
                        when p.department = v_hero.department then 1
                        else 2 end as rank_shelf,
                   case when abs(p.price - v_hero.price) <= v_hero.price * 0.30 then 0 else 1 end as rank_price,
                   abs(p.price - v_hero.price) as gap
            from public.rh_product p
            join public.rh_store_stock ss
              on ss.sku_id = p.sku_id and ss.store_id = v_store.store_id
            where p.is_active
              and ss.state = 'available'
              and p.sku_id <> v_hero.sku_id
        ) c
        order by c.rank_licence, c.rank_age, c.rank_shelf, c.rank_price, c.gap
        limit 1;
    end if;

    -- ------------------------------------------------------------------
    -- 5. What this shop can offer, and the whole stock picture in one map.
    --
    --    The stock map is why the storefront makes ONE call and can then paint
    --    a badge on every tile without asking again. It is small: a couple of
    --    hundred short keys.
    -- ------------------------------------------------------------------
    if v_store.store_id is not null then
        select coalesce(jsonb_agg(to_jsonb(o) order by o.ord), '[]'::jsonb) into v_offers
        from (
            select p.sku_id, p.name, p.brand, p.licence, p.price, p.list_price,
                   p.age_display, p.image_url, p.page_url, p.category,
                   row_number() over (order by
                       case when v_hero.department is not null
                                 and p.department = v_hero.department then 0 else 1 end,
                       p.list_price is null,
                       p.price desc) as ord
            from public.rh_product p
            join public.rh_store_stock ss
              on ss.sku_id = p.sku_id and ss.store_id = v_store.store_id
            where p.is_active
              and ss.state = 'available'
              and (v_hero.sku_id is null or p.sku_id <> v_hero.sku_id)
              and (v_sub is null or p.sku_id <> (v_sub ->> 'sku_id'))
            limit v_limit
        ) o;

        select coalesce(jsonb_object_agg(ss.sku_id, ss.state), '{}'::jsonb) into v_stock
        from public.rh_store_stock ss
        where ss.store_id = v_store.store_id;

        select coalesce(jsonb_agg(jsonb_build_object(
                   'id', s.store_id, 'name', s.name, 'mall', s.mall,
                   'lat', s.lat, 'lng', s.lng) order by s.rank, s.name), '[]'::jsonb)
          into v_stores
        from public.rh_store s
        where s.region_code = v_region and s.is_pickup;
    end if;

    -- ------------------------------------------------------------------
    -- 6. No shop serves this area. Something is still shown, and it makes no
    --    availability claim of any kind: no badge, no store name, no promise.
    --    Saying nothing is the honest answer, and it is still a usable email.
    -- ------------------------------------------------------------------
    if v_resolved <> 'store' then
        select coalesce(jsonb_agg(to_jsonb(f) order by f.ord), '[]'::jsonb) into v_offers
        from (
            select p.sku_id, p.name, p.brand, p.licence, p.price, p.list_price,
                   p.age_display, p.image_url, p.page_url, p.category,
                   row_number() over (order by p.list_price is null, p.price desc) as ord
            from public.rh_product p
            where p.is_active
            limit v_limit
        ) f;
    end if;

    -- ------------------------------------------------------------------
    -- 7. One shape, always. Callers never branch on whether a key exists.
    -- ------------------------------------------------------------------
    return jsonb_build_object(
        'ok', true,
        'resolved', v_resolved,
        'cep', case when v_digits = '' then null else v_digits end,
        'region', v_label,
        'store', case when v_store.store_id is null then null else jsonb_build_object(
            'id', v_store.store_id,
            'name', v_store.name,
            'mall', v_store.mall,
            'city', v_store.city,
            'banner', v_store.banner,
            'lat', v_store.lat,
            'lng', v_store.lng
        ) end,
        'stores', v_stores,
        'storeCount', jsonb_array_length(v_stores),
        'hero', case when v_hero.sku_id is null then null else jsonb_build_object(
            'sku_id', v_hero.sku_id,
            'name', v_hero.name,
            'brand', v_hero.brand,
            'licence', v_hero.licence,
            'price', v_hero.price,
            'list_price', v_hero.list_price,
            'age_display', v_hero.age_display,
            'image_url', v_hero.image_url,
            'page_url', v_hero.page_url,
            'category', v_hero.category,
            -- Three states, not two, and the third is the one that matters.
            --
            -- true   we hold a captured row saying this shop has it
            -- false  we hold a captured row saying it does not
            -- null   no shop resolved, so nobody has been asked
            --
            -- The old expression collapsed the third into the second. Vitoria
            -- and Rio Branco have one Ri Happy branch each that their own
            -- checkout never offers for collection, so nothing serves those
            -- postcodes and v_hero_state is never set. It still returned false,
            -- which reads as "we checked and it is not there" about a real toy
            -- nobody checked. That is a claim we invented, and it is the same
            -- fault that once had a message declare a toy unavailable at a shop
            -- it had never resolved. That was patched in the template by
            -- guarding on the shop name, which left this source intact for
            -- every later reader to inherit.
            --
            -- Whatever consumes this must treat null as say nothing rather than
            -- as false. The storefront already does: availability.js badges only
            -- when a shop is resolved and a captured answer exists.
            'available', case
                when v_store.store_id is null then null
                else coalesce(v_hero_state, 'unknown') = 'available'
            end
        ) end,
        'substitute', v_sub,
        'substituteReason', v_reason,
        'offers', v_offers,
        'stock', v_stock,
        'generatedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    );
end;
$$;

comment on function public.rh_offer(text, text, text, integer) is
    'Store resolution, availability and substitution for the Ri Happy demo. Stable so PostgREST allows GET, which is what the Dengage panel Custom API endpoint requires. Never throws: every edge returns ok true with a resolved reason.';

-- The publishable (anon) key is what the storefront and the panel present. It
-- may call this function and nothing else that writes.
grant execute on function public.rh_offer(text, text, text, text) to anon, authenticated;
