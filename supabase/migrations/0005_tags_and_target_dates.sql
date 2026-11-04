-- A Little Place Called Us — migration 0005: memory tags + future target dates
-- Apply in the Supabase SQL editor after 0004. Both columns are optional and
-- backfilled empty/null, so existing rows are unaffected. No RLS change is
-- needed: tags ride on memories and target_date rides on future_plans, which
-- already have member-only policies.
alter table public.memories add column if not exists tags text[] not null default '{}'::text[];
alter table public.future_plans add column if not exists target_date date;
