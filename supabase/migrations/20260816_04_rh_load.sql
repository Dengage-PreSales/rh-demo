-- ============================================================================
-- Load the committed snapshots into the rh_ tables.
--
--   select public.rh_load();
--
-- Reads the three JSON files straight out of the repository over https and
-- upserts them. That is the whole refresh procedure: on the morning of a demo,
-- run the capture, push, call this once.
--
-- WHY A DATABASE FUNCTION RATHER THAN A SCRIPT WITH A SERVICE KEY: this way the
-- service key never leaves Supabase and never has to exist on anybody's laptop
-- or in any CI runner. The only credential involved is the one already inside
-- the database.
--
-- UPSERTS ONLY. Nothing here deletes or truncates anything, ever. A product that
-- disappears from the catalogue is marked inactive on a later pass rather than
-- removed, because a row that vanishes takes its history with it and this
-- database is shared with another project.
-- ============================================================================

create or replace function public.rh_load(branch text default 'main')
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_base     text;
    v_body     text;
    v_status   integer;
    v_stores   integer := 0;
    v_products integer := 0;
    v_carried  integer := 0;
    v_filled   integer := 0;
    v_problems text[] := array[]::text[];
begin
    -- The repository is fixed here rather than passed in. This function runs as
    -- its owner and can make outbound requests, so letting a caller choose the
    -- host would turn it into an open proxy. Only the branch is a parameter,
    -- and it is checked against a strict pattern before it is interpolated.
    if branch !~ '^[A-Za-z0-9._/-]{1,100}$' then
        raise exception 'refusing a branch name that is not a plain git ref: %', branch;
    end if;
    v_base := 'https://raw.githubusercontent.com/Dengage-PreSales/rh-demo/' || branch || '/';

    -- ---------------------------------------------------------------- stores
    select status, content into v_status, v_body
    from extensions.http_get(v_base || 'data/stores.json');
    if v_status <> 200 then
        raise exception 'stores.json returned %', v_status;
    end if;

    insert into public.rh_store
        (store_id, name, region_code, region_label, city, state, mall, lat, lng, rank, banner, is_pickup)
    select s.store_id, s.name, s.region_code, s.region_label, s.city, s.state,
           nullif(s.mall, ''), s.lat, s.lng, s.rank, s.banner, true
    from jsonb_to_recordset((v_body::jsonb) -> 'stores')
        as s(store_id text, name text, region_code text, region_label text,
             city text, state text, mall text, lat numeric, lng numeric,
             rank integer, banner text)
    on conflict (store_id) do update set
        name = excluded.name, region_code = excluded.region_code,
        region_label = excluded.region_label, city = excluded.city,
        state = excluded.state, mall = excluded.mall,
        lat = excluded.lat, lng = excluded.lng,
        rank = excluded.rank, banner = excluded.banner, updated_at = now();
    get diagnostics v_stores = row_count;

    -- -------------------------------------------------------------- products
    select status, content into v_status, v_body
    from extensions.http_get(v_base || 'web/products.json');
    if v_status <> 200 then
        raise exception 'products.json returned %', v_status;
    end if;

    -- An empty catalogue is refused rather than applied. Applying it would
    -- withdraw the whole shop on a bad capture, and the first anyone would know
    -- is an empty storefront.
    if coalesce(jsonb_array_length((v_body::jsonb) -> 'products'), 0) = 0 then
        raise exception 'products.json carried no products, refusing to apply it';
    end if;

    insert into public.rh_product
        (sku_id, product_id, name, brand, licence, department, category, category_path,
         price, list_price, age_min_months, age_max_months, age_display, age_bracket,
         image_url, image_count, page_url, is_active)
    select p.id,
           p.id,
           p.name,
           nullif(p.brand, ''),
           p.licence,
           nullif(p.department, ''),
           nullif(p.category, ''),
           nullif(p."categoryPath", ''),
           p.price,
           p."listPrice",
           p."ageMinMonths",
           p."ageMaxMonths",
           nullif(p."ageDisplay", ''),
           p."ageBracket",
           'https://dengage-presales.github.io/rh-demo/' || p.image,
           1,
           'https://dengage-presales.github.io/rh-demo/product.html?id=' || p.id,
           true
    from jsonb_to_recordset((v_body::jsonb) -> 'products')
        as p(id text, name text, brand text, licence text, department text,
             category text, "categoryPath" text, price numeric, "listPrice" numeric,
             "ageMinMonths" integer, "ageMaxMonths" integer, "ageDisplay" text,
             "ageBracket" text, image text)
    on conflict (sku_id) do update set
        name = excluded.name, brand = excluded.brand, licence = excluded.licence,
        department = excluded.department, category = excluded.category,
        category_path = excluded.category_path, price = excluded.price,
        list_price = excluded.list_price,
        age_min_months = excluded.age_min_months, age_max_months = excluded.age_max_months,
        age_display = excluded.age_display, age_bracket = excluded.age_bracket,
        image_url = excluded.image_url, page_url = excluded.page_url,
        is_active = true, updated_at = now();
    get diagnostics v_products = row_count;

    -- ----------------------------------------------------------------- stock
    select status, content into v_status, v_body
    from extensions.http_get(v_base || 'data/stock.json');
    if v_status <> 200 then
        raise exception 'stock.json returned %', v_status;
    end if;

    -- First the shops that genuinely carry each product.
    insert into public.rh_store_stock (sku_id, store_id, state)
    select c.key, store_id, 'available'
    from jsonb_each((v_body::jsonb) -> 'carriedBy') as c(key, value)
    cross join lateral jsonb_array_elements_text(c.value) as store_id
    where exists (select 1 from public.rh_product p where p.sku_id = c.key)
      and exists (select 1 from public.rh_store s where s.store_id = store_id)
    on conflict (sku_id, store_id) do update set
        state = excluded.state, updated_at = now();
    get diagnostics v_carried = row_count;

    -- Then every other pairing in the regions that were actually captured, so
    -- "we know it is not there" is recorded explicitly. Absent and unavailable
    -- read identically to a query and mean very different things, and only one
    -- of them is safe to tell a customer.
    insert into public.rh_store_stock (sku_id, store_id, state)
    select p.sku_id, s.store_id, 'withoutStock'
    from public.rh_product p
    cross join public.rh_store s
    where s.region_code in (
        select jsonb_array_elements_text((v_body::jsonb) -> 'regions')
    )
    on conflict (sku_id, store_id) do nothing;
    get diagnostics v_filled = row_count;

    -- A store with no position cannot carry a geofence. Say so out loud here
    -- rather than letting somebody discover it while building the campaign.
    select array_agg(name order by name) into v_problems
    from public.rh_store where lat is null or lng is null;

    insert into public.rh_sync_log (source, detail, items, problems)
    values ('rh_load', 'branch ' || branch, v_products,
            case when coalesce(array_length(v_problems, 1), 0) > 0
                 then 'stores without a position: ' || array_to_string(v_problems, '; ')
                 else null end);

    return jsonb_build_object(
        'ok', true,
        'stores', v_stores,
        'products', v_products,
        'availablePairs', v_carried,
        'filledUnavailable', v_filled,
        'storesWithoutPosition', coalesce(array_length(v_problems, 1), 0)
    );
end;
$$;

comment on function public.rh_load(text) is
    'Loads the committed catalogue, stores and availability from the rh-demo repository. Upserts only, never deletes. The repository host is fixed inside the function so it cannot be used as a proxy.';

revoke all on function public.rh_load(text) from public, anon, authenticated;
