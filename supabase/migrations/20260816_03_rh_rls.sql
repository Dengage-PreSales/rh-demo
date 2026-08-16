-- ============================================================================
-- Row level security for the rh_ tables.
--
-- Why this file exists at all, given the data is a public toy catalogue: with
-- RLS enabled and no policy, a non-owner role reads zero rows. Zero rows and a
-- broken connection look identical from a storefront, and that is a bad thing
-- to discover during a demo. So the policies are explicit and each one says
-- what it is for.
--
-- What the publishable key can reach: the four tables that describe products,
-- shops, availability and postcodes. All of it is already public on Ri Happy's
-- own website. What it cannot reach: rh_sync_log, which is our operational
-- record and nobody else's business.
-- ============================================================================

alter table public.rh_store       enable row level security;
alter table public.rh_product     enable row level security;
alter table public.rh_store_stock enable row level security;
alter table public.rh_cep_region  enable row level security;
alter table public.rh_sync_log    enable row level security;

drop policy if exists rh_store_read on public.rh_store;
create policy rh_store_read on public.rh_store
    for select to anon, authenticated using (true);

drop policy if exists rh_product_read on public.rh_product;
create policy rh_product_read on public.rh_product
    for select to anon, authenticated using (true);

drop policy if exists rh_store_stock_read on public.rh_store_stock;
create policy rh_store_stock_read on public.rh_store_stock
    for select to anon, authenticated using (true);

drop policy if exists rh_cep_region_read on public.rh_cep_region;
create policy rh_cep_region_read on public.rh_cep_region
    for select to anon, authenticated using (true);

-- rh_sync_log deliberately has no policy. RLS is on, so it is readable by the
-- service role only, which is the intent rather than an omission.

grant usage on schema public to anon, authenticated;
grant select on public.rh_store, public.rh_product,
                public.rh_store_stock, public.rh_cep_region to anon, authenticated;

-- No insert, update or delete is granted to anon anywhere. The one write path
-- in this project is rh_set_stock, which is a security definer function with
-- its own key check, added in migration 04.
