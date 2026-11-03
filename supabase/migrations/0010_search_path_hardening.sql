-- A Little Place Called Us — migration 0010: search_path hardening for
-- SECURITY DEFINER helpers.
--
-- Why this file exists, and why it is last:
--   Every other SECURITY DEFINER function in this project already sets
--   search_path = public (join_space_by_code, create_invitation,
--   guess_answer, handle_new_user, prevent_second_space,
--   prevent_second_membership, enforce_two_members in 0003).
--   Two helpers did not:
--     * public.is_space_member(uuid) — created in 0001, no search_path.
--     * public.is_space_creator(uuid) — created in 0008, no search_path.
--   A SECURITY DEFINER function without a fixed search_path can, in
--   principle, be tricked if an attacker can create an object in a schema
--   earlier in the caller's search_path. In Supabase, ordinary authenticated
--   users cannot create tables in public by default, so the practical risk
--   today is low. This is hardening, not a fix for a confirmed live exploit,
--   and it changes no logic, no policy, and no row visibility.
--
-- Apply AFTER 0009, never before 0008. Migration 0008 recreates
-- is_space_creator without a search_path, so applying this file before
-- 0008 would be undone by 0008. Applying it after 0009 is safe and
-- idempotent: CREATE OR REPLACE with identical logic, only the
-- search_path clause added.
--
-- Requires: public.spaces and public.space_members from 0001, and
-- public.is_space_creator from 0008 (CREATE OR REPLACE will create it
-- even if 0008 was skipped, because its body only references 0001 tables,
-- but the policy that uses it only exists after 0008 — apply in order).
-- No tables, columns, policies, grants, or rows are changed by this file.
-- No data is deleted, truncated, or rewritten.

create or replace function public.is_space_member(p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.space_members where space_id = p_space_id and user_id = auth.uid());
$$;

create or replace function public.is_space_creator(p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.spaces where id = p_space_id and created_by = auth.uid());
$$;

-- Grants are deliberately NOT changed here. CREATE OR REPLACE does not
-- change existing grants, and the repository never granted these two
-- helpers explicitly (PostgreSQL's default PUBLIC execute is why the audit
-- found both anon and authenticated able to call is_space_member, which
-- returns false for anon because auth.uid() is null). Adding a grant here
-- would be a new access decision, not hardening, so this file adds none.
-- The functions only return true/false for the caller's own membership
-- or creator status (auth.uid() is the caller, never a parameter).
