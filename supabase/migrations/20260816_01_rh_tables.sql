-- ============================================================================
-- Ri Happy demo: the five tables the whole demo reads from.
--
-- Everything here is new and everything is prefixed rh_. Nothing in this file
-- touches, alters or drops an existing object: this project shares a Supabase
-- project with the demo factory's dps_product, and create-only is the rule that
-- keeps the two from ever meeting.
--
-- THE ONE THING TO UNDERSTAND BEFORE READING THE COLUMNS.
--
-- Ri Happy fulfils every online order from a physical shop. So availability is
-- a fact about a PAIR, this product at that shop, and never a fact about the
-- catalogue. rh_store_stock is that pair, and it is the reason this schema
-- exists at all.
--
-- And it holds a STATE, not a count. Their own storefront answers "can this
-- reach that postcode, and from which shops" and never publishes how many are
-- on the shelf. So no count was ever given to us, and nothing here invents one.
-- A demo that shows "3 left at Augusta" to the people who own the real stock
-- ledger is a demo that loses the room.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Stores. The real pickup shops their checkout names, one row each.
-- ----------------------------------------------------------------------------
create table if not exists public.rh_store (
    store_id    text primary key,              -- our stable slug, e.g. sp-augusta
    name        text not null,                 -- exactly as their checkout names it
    region_code text not null,                 -- sp | poa | rb
    region_label text not null,                -- Sao Paulo, Porto Alegre, Rio Branco
    city        text,
    state       text,
    mall        text,
    lat         numeric(9,6),
    lng         numeric(9,6),
    rank        integer not null default 100,  -- 1 is the shop a postcode resolves to first
    banner      text not null default 'Ri Happy',  -- Ri Happy or PBKIDS
    is_pickup   boolean not null default true,
    updated_at  timestamptz not null default now()
);

comment on table public.rh_store is
    'Pickup stores read from Ri Happy checkout. Coordinates are geocoded by us for the geofence scene.';
comment on column public.rh_store.rank is
    'Lowest rank wins when a postcode resolves to a region. Set from how their own checkout ordered the pickup list.';

create index if not exists rh_store_region_idx on public.rh_store (region_code, rank);

-- ----------------------------------------------------------------------------
-- Products. The catalogue, as captured, with the two fields substitution needs.
-- ----------------------------------------------------------------------------
create table if not exists public.rh_product (
    sku_id         text primary key,
    product_id     text not null,
    name           text not null,
    brand          text,
    licence        text,                       -- LEGO, Barbie, Pokemon... or null. Derived, never guessed.
    department     text,                       -- BRINQUEDOS, BABY, JOGOS...
    category       text,                       -- BLOCOS DE MONTAR, BONECAS...
    category_path  text,
    price          numeric(12,2) not null,
    list_price     numeric(12,2),              -- null when there is no reduction to show
    age_min_months integer,
    age_max_months integer,
    age_display    text,                       -- 4a-8a, 12m-3a
    age_bracket    text,                       -- 0-2 | 3-5 | 6-8 | 9-12 | 13+ | unknown
    image_url      text not null,              -- absolute, on our own origin
    image_count    integer not null default 1,
    page_url       text not null,              -- absolute, our storefront
    source_url     text,                       -- their product page, for provenance only
    is_active      boolean not null default true,
    updated_at     timestamptz not null default now(),

    -- A price is a promise. These refuse the two ways a wrong one gets in:
    -- a zero from a null coercion, and a "was" price lower than the "now" price.
    constraint rh_product_price_positive check (price > 0),
    constraint rh_product_list_not_lower check (list_price is null or list_price >= price)
);

comment on column public.rh_product.licence is
    'Franchise, derived from their merchandising clusters against an allowlist. Null when no licence was recognised, never a guess.';
comment on column public.rh_product.list_price is
    'The before price, only when a genuine reduction exists. Null otherwise, so no discount can be implied.';

create index if not exists rh_product_licence_idx  on public.rh_product (licence) where licence is not null;
create index if not exists rh_product_category_idx on public.rh_product (department, category);
create index if not exists rh_product_active_idx   on public.rh_product (is_active) where is_active;

-- ----------------------------------------------------------------------------
-- Stock. The pair that the entire demo argues about.
-- ----------------------------------------------------------------------------
create table if not exists public.rh_store_stock (
    sku_id     text not null references public.rh_product(sku_id) on delete restrict,
    store_id   text not null references public.rh_store(store_id) on delete restrict,
    state      text not null check (state in ('available', 'withoutStock')),
    updated_at timestamptz not null default now(),
    primary key (sku_id, store_id)
);

comment on table public.rh_store_stock is
    'Availability per product per store, as a state. Their checkout publishes no unit counts, so this table holds none.';

create index if not exists rh_store_stock_store_idx on public.rh_store_stock (store_id, state);

-- ----------------------------------------------------------------------------
-- Postcode to region. Exact postcodes for the demo, prefixes so a nearby one
-- typed live still lands somewhere sensible.
-- ----------------------------------------------------------------------------
create table if not exists public.rh_cep_region (
    id          serial primary key,
    cep         text,                          -- 8 digits, no punctuation
    prefix      text,                          -- 2 to 5 leading digits
    region_code text not null,
    label       text not null,
    constraint rh_cep_one_rule check ((cep is null) <> (prefix is null))
);

comment on table public.rh_cep_region is
    'Postcode resolution. A prefix rule exists so an executive typing their own postcode in the room still resolves.';

create unique index if not exists rh_cep_region_cep_idx    on public.rh_cep_region (cep) where cep is not null;
create unique index if not exists rh_cep_region_prefix_idx on public.rh_cep_region (prefix) where prefix is not null;

-- ----------------------------------------------------------------------------
-- What was loaded, and when. Read only ever by us, never by the storefront.
-- ----------------------------------------------------------------------------
create table if not exists public.rh_sync_log (
    id       bigserial primary key,
    ran_at   timestamptz not null default now(),
    source   text not null,                    -- capture | seed | stock-flip
    detail   text,
    items    integer,
    problems text
);

-- Keep updated_at honest on the tables an operator edits during a demo.
create or replace function public.rh_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists rh_store_stock_touch on public.rh_store_stock;
create trigger rh_store_stock_touch
    before update on public.rh_store_stock
    for each row execute function public.rh_touch();

drop trigger if exists rh_product_touch on public.rh_product;
create trigger rh_product_touch
    before update on public.rh_product
    for each row execute function public.rh_touch();
