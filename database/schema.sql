-- HumanityVote — схема базы данных
-- Запустить эти команды в Supabase SQL Editor при настройке нового проекта

-- ===========================================
-- 1. ТАБЛИЦА ГОЛОСОВ
-- ===========================================

create table votes (
  id uuid default gen_random_uuid() primary key,
  question_id text not null,
  region_id text not null,
  fingerprint text not null unique,
  created_at timestamp with time zone default now()
);

create index votes_question_idx on votes(question_id);
create index votes_region_idx on votes(region_id);
create unique index votes_fingerprint_idx on votes(fingerprint);

-- ===========================================
-- 2. ROW LEVEL SECURITY
-- ===========================================

alter table votes enable row level security;

-- INSERT intentionally has no anon policy.
-- Votes must be written through /api/vote after Cloudflare Turnstile validation.
-- The serverless function uses a Supabase secret/service key and bypasses RLS.

-- Любой может читать (для статистики)
create policy "Anyone can read votes"
on votes for select
to anon
using (true);

-- UPDATE и DELETE намеренно НЕ разрешены через API
-- Только админ через Supabase Dashboard

-- ===========================================
-- 3. ФУНКЦИИ ДЛЯ СТАТИСТИКИ
-- ===========================================

create or replace function get_vote_stats()
returns table (
  region_id text,
  question_id text,
  vote_count bigint
)
language sql
security definer
as $$
  select
    region_id,
    question_id,
    count(*) as vote_count
  from votes
  group by region_id, question_id;
$$;

create or replace function get_total_votes()
returns bigint
language sql
security definer
as $$
  select count(*) from votes;
$$;
