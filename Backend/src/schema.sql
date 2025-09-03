-- db/schema.sql
-- PostgreSQL 13+

---------------------------
-- Core: users & plans
---------------------------
create table if not exists users (
  id               bigserial primary key,
  email            citext not null unique,
  email_domain     citext generated always as (substring(email from '@(.*)$')) stored,
  site_domain      citext,                                   -- their verified website domain
  role             text check (role in ('supplier','distributor','buyer')) default 'supplier',
  plan             text check (plan in ('free','pro')) default 'free',
  verified         boolean not null default false,           -- email_domain matches site_domain (server logic decides)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists users_email_domain_idx on users(email_domain);
create index if not exists users_site_domain_idx on users(site_domain);

---------------------------
-- Vault: traits per user
---------------------------
create table if not exists vaults (
  user_id          bigint primary key references users(id) on delete cascade,
  website          citext,                                   -- full site (we also keep site_domain in users)
  industries       text,                                     -- csv or json if you prefer
  regions          text,
  seed_buyers      text,                                     -- csv domains
  notes            text,
  verified_at      timestamptz,
  updated_at       timestamptz not null default now()
);

---------------------------
-- Quotas
---------------------------
create table if not exists daily_credits (
  user_id          bigint references users(id) on delete cascade,
  day              date not null,
  searches_used    integer not null default 0,
  reveals_used     integer not null default 0,
  primary key(user_id, day)
);

-- Internal overrides (e.g. dev unlimited)
create table if not exists plan_overrides (
  user_id          bigint primary key references users(id) on delete cascade,
  unlimited        boolean not null default false,
  notes            text
);

---------------------------
-- Finds (jobs) & preview steps
---------------------------
create table if not exists finds (
  id               bigserial primary key,
  user_id          bigint not null references users(id) on delete cascade,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  lane_free_total  integer not null default 0,
  lane_free_done   integer not null default 0,
  lane_pro_total   integer not null default 0,
  lane_pro_done    integer not null default 0,
  status           text check (status in ('queued','running','halt','done','error')) not null default 'queued',
  error_msg        text
);

create index if not exists finds_user_idx on finds(user_id);
create index if not exists finds_status_idx on finds(status);

create table if not exists preview_steps (
  id               bigserial primary key,
  find_id          bigint not null references finds(id) on delete cascade,
  lane             text check (lane in ('free','pro')) not null,
  category         text,
  probe            text,
  filter           text,
  evidence         text,
  conclusion       text,
  step_index       integer not null default 0,               -- ordering for UI
  created_at       timestamptz not null default now()
);

create index if not exists preview_steps_find_lane_idx on preview_steps(find_id, lane, step_index);

---------------------------
-- BYLI (Bring-Your-List Intelligence)
---------------------------
create table if not exists target_lists (
  id               bigserial primary key,
  user_id          bigint not null references users(id) on delete cascade,
  name             text not null,
  total_targets    integer not null default 0,
  created_at       timestamptz not null default now()
);

create index if not exists target_lists_user_idx on target_lists(user_id);

create table if not exists target_items (
  id               bigserial primary key,
  list_id          bigint not null references target_lists(id) on delete cascade,
  domain           citext not null,
  label            text,                                     -- optional human label
  status           text check (status in ('new','watching','ignored','bad')) not null default 'new',
  last_seen_signal timestamptz,
  created_at       timestamptz not null default now()
);

create unique index if not exists target_items_unique on target_items(list_id, domain);
create index if not exists target_items_domain_idx on target_items(domain);

-- Signals detected (either mapped to a target item, or global)
create table if not exists signals (
  id               bigserial primary key,
  user_id          bigint not null references users(id) on delete cascade,
  target_item_id   bigint references target_items(id) on delete set null,
  source           text,               -- e.g., "public_feed", "tender", "review", "social"
  kind             text,               -- e.g., "demand","product","ops"
  title            text not null,
  url              text,
  details          jsonb,              -- arbitrary evidence
  detected_at      timestamptz not null default now()
);

create index if not exists signals_user_time_idx on signals(user_id, detected_at desc);
create index if not exists signals_target_idx on signals(target_item_id);

---------------------------
-- Convenience view: daily remaining (searches/reveals)
--   (Assumes your app code maintains the per-plan limits)
---------------------------
-- Example: not enforced here; your server uses this to compute remaining.
-- create or replace view v_credits_remaining as
-- select u.id as user_id,
--        greatest(0, (case when p.unlimited then 999999 else  (/* your daily cap */ 10) end) - coalesce(dc.searches_used,0)) as searches_left,
--        greatest(0, (case when p.unlimited then 999999 else  (/* your daily cap */ 2) end)  - coalesce(dc.reveals_used,0))  as reveals_left
-- from users u
-- left join plan_overrides p on p.user_id = u.id
-- left join daily_credits dc on dc.user_id = u.id and dc.day = current_date;
