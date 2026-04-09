-- ============================================
-- Vibelive AI Audience usage/cost events
-- 在 Supabase SQL Editor 中执行此脚本
--
-- 设计说明:
--   - orchestrator 使用 SUPABASE_SERVICE_ROLE_KEY 写入, 不开放客户端写入
--   - 扁平 token/cost 列用于后台聚合, usage JSONB 保留 OpenRouter 原始明细
--   - RLS 开启但不加 public policy, 普通用户不能直接查询
-- ============================================

create table if not exists public.ai_audience_usage_events (
  id uuid primary key,
  created_at timestamptz not null default now(),

  room_slug text not null,
  channel_id text,
  operation text not null check (operation in ('agent_decide', 'screenshot_summary')),
  persona_key text,

  model_provider text not null,
  model_name text not null,
  decision text,

  has_screenshot boolean not null default false,
  has_video boolean not null default false,

  prompt_tokens int not null default 0,
  completion_tokens int not null default 0,
  total_tokens int not null default 0,
  cached_tokens int not null default 0,
  cache_write_tokens int not null default 0,
  audio_tokens int not null default 0,
  reasoning_tokens int not null default 0,
  cost numeric(20, 10) not null default 0,

  usage jsonb not null default '{}'::jsonb
);

alter table public.ai_audience_usage_events enable row level security;

create index if not exists ai_audience_usage_created_idx
  on public.ai_audience_usage_events(created_at desc);

create index if not exists ai_audience_usage_room_created_idx
  on public.ai_audience_usage_events(room_slug, created_at desc);

create index if not exists ai_audience_usage_model_idx
  on public.ai_audience_usage_events(model_name);

create index if not exists ai_audience_usage_persona_idx
  on public.ai_audience_usage_events(persona_key)
  where persona_key is not null;
