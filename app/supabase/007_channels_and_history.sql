-- ============================================
-- Vibelive Feature 1: 持久化频道 (channels) + 历史记录 (stream_history)
-- 在 Supabase SQL Editor 中执行此脚本
--
-- 设计说明:
--   - channels: 一个用户一个频道,slug 是 URL 标识 (/watch/{slug})
--   - 同时被用作 LiveKit room name,所以观看页 URL 永久有效
--   - 核心字段独立列存储, 易变的杂项 (分类/平台/聊天等) 放 settings JSONB
--   - live_streams 增加 channel_id 外键, 仍然保留 room_name (= channel.slug) 以兼容
--   - stream_history: 下播时归档,用于离线频道页展示「最近一次直播」摘要
-- ============================================

-- ────────────────────────────────────────────
-- 1. channels 表 (持久频道)
-- ────────────────────────────────────────────
create table public.channels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,

  -- URL slug,3-20 字符,小写字母/数字/短横线
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,20}$'),

  -- 直播信息
  title text default '',
  thumbnail_url text default '',

  -- 项目信息
  project_name text default '',
  project_desc text default '',
  project_stage text default '构思中',
  project_url text default '',

  -- 技术设置
  coding_tool text default 'cursor',
  quality text default '1080p',

  -- 易变设置 (分类/平台/标签/聊天等),JSON 形式扩展友好
  -- 形如: { category, platforms[], tags, slow_mode_enabled, slow_mode_seconds, followers_only }
  settings jsonb not null default '{}'::jsonb,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.channels enable row level security;

create policy "Channels are viewable by everyone"
  on public.channels for select using (true);

create policy "Users can insert own channel"
  on public.channels for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update own channel"
  on public.channels for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger on_channel_updated
  before update on public.channels
  for each row execute function public.handle_updated_at();

create index if not exists channels_slug_idx on public.channels(slug);

-- ────────────────────────────────────────────
-- 2. live_streams 关联 channel
-- ────────────────────────────────────────────
alter table public.live_streams
  add column if not exists channel_id uuid references public.channels(id) on delete cascade;

create index if not exists live_streams_channel_id_idx on public.live_streams(channel_id);

-- ────────────────────────────────────────────
-- 3. stream_history 表 (下播归档)
-- ────────────────────────────────────────────
create table public.stream_history (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  title text default '',
  project_name text default '',
  project_stage text default '',
  coding_tool text default '',
  thumbnail_url text default '',

  started_at timestamptz not null,
  ended_at timestamptz not null default now(),
  duration_seconds int generated always as
    (greatest(0, extract(epoch from (ended_at - started_at))::int)) stored,
  peak_viewers int default 0,

  created_at timestamptz default now()
);

alter table public.stream_history enable row level security;

create policy "Stream history viewable by everyone"
  on public.stream_history for select using (true);

create policy "Users can insert own history"
  on public.stream_history for insert
  to authenticated
  with check (auth.uid() = user_id);

create index if not exists stream_history_channel_started_idx
  on public.stream_history(channel_id, started_at desc);
