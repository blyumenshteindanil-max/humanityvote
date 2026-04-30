-- HumanityVote secure voting migration
-- Run this in Supabase SQL Editor AFTER Vercel env vars are configured and deployed.
-- It closes direct anonymous INSERT access so votes can only be written by the
-- serverless /api/vote endpoint using the Supabase secret/service key.

alter table votes enable row level security;

drop policy if exists "Anyone can vote" on votes;

-- Keep public read access for aggregate statistics and existing RPC functions.
drop policy if exists "Anyone can read votes" on votes;
create policy "Anyone can read votes"
on votes for select
to anon
using (true);

-- No INSERT / UPDATE / DELETE policy for anon.
-- Supabase secret/service keys bypass RLS from the serverless endpoint.
