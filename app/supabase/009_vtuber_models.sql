-- ============================================
-- Vibelive: 用户上传 VTuber / Live2D 模型仓库
-- 在 Supabase SQL Editor 中执行此脚本
--
-- 设计要点:
--   - 内置模型继续走 Vercel Blob (lib/broadcast/model-registry.ts), 不动
--   - 用户自传走 Supabase Storage 的 vtuber-models bucket, public read,
--     写删受 RLS 限制 (只能动 {auth.uid()}/* 路径下的对象)
--   - DB 表 public.vtuber_models 只存元数据 + 全部相对路径列表 (用于
--     删除时一次性清理, Supabase Storage 没有原生递归 delete)
--   - 不存内容 hash / 不做服务端解析 model3.json: 直传完成后客户端 POST
--     metadata 注册, server 只校验 storage_prefix 必须以 user_id 开头
--   - file_paths 是 jsonb, 一个模型常见 50-200 个文件, 每条路径
--     50-100 字符 → 每行 5-20KB. 完全在 jsonb 舒适区
-- ============================================

-- ────────────────────────────────────────────
-- 1. vtuber_models 表 (元数据)
-- ────────────────────────────────────────────
create table public.vtuber_models (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- UI 显示名 (用户上传时取自顶层文件夹名, 后续可改)
  name text not null check (length(name) between 1 and 100),

  -- Cubism .model3.json 在 storage 里的完整 object key
  -- e.g. "{user_id}/{model_id}/my_model/my_model.model3.json"
  entry_path text not null check (length(entry_path) <= 500),

  -- VTube Studio .vtube.json 的完整 object key (可选, 没有 → 没面捕映射)
  vtube_config_path text check (length(vtube_config_path) <= 500),

  -- 这次上传的所有文件在 storage 里共享的前缀
  -- e.g. "{user_id}/{model_id}"  → 删除时按这个前缀拼具体路径
  storage_prefix text not null check (length(storage_prefix) <= 200),

  -- 该模型 storage_prefix 下所有文件的相对路径列表
  -- 用于删除 (Supabase Storage 没有递归 remove)
  -- 形如 ["my_model/my_model.model3.json", "my_model/textures/00.png", ...]
  file_paths jsonb not null default '[]'::jsonb,

  -- 信息字段 (UI 展示, 配额估算)
  file_count int not null default 0 check (file_count >= 0 and file_count <= 1000),
  total_size_bytes bigint not null default 0
    check (total_size_bytes >= 0 and total_size_bytes <= 209715200), -- 200MB

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index vtuber_models_user_id_idx on public.vtuber_models(user_id, created_at desc);

alter table public.vtuber_models enable row level security;

-- 用户只能看到自己的模型
create policy "users see own vtuber models"
  on public.vtuber_models for select
  using (auth.uid() = user_id);

-- 插入: user_id 必须是自己
create policy "users insert own vtuber models"
  on public.vtuber_models for insert
  to authenticated
  with check (auth.uid() = user_id);

-- 更新: 仅自己的行 (留给后续 rename)
create policy "users update own vtuber models"
  on public.vtuber_models for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 删除: 仅自己的行
create policy "users delete own vtuber models"
  on public.vtuber_models for delete
  using (auth.uid() = user_id);

-- updated_at 自动维护 (复用 channels 那条 trigger function)
create trigger on_vtuber_model_updated
  before update on public.vtuber_models
  for each row execute function public.handle_updated_at();

-- ────────────────────────────────────────────
-- 2. Storage bucket: vtuber-models
-- ────────────────────────────────────────────
-- public read (pixi-live2d-display 直接 fetch model3.json + 所有依赖资源),
-- 写删受 RLS 限制 (只能动自己 user_id 前缀下的对象).
--
-- 安全模型: URL 形如
--   {project}.supabase.co/storage/v1/object/public/vtuber-models/{user_id}/{model_id}/...
-- {model_id} 是 UUID v4, 不可猜. 列表只能通过 /api/vtuber-models 拿,
-- 该接口走 RLS 仅返回 auth.uid() 的行. 因此他人无从枚举.
insert into storage.buckets (id, name, public, file_size_limit)
values (
  'vtuber-models',
  'vtuber-models',
  true,                      -- public read
  52428800                   -- 50MB per file
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- 公开读 (public bucket 的标准做法)
create policy "vtuber-models public read"
  on storage.objects for select
  using (bucket_id = 'vtuber-models');

-- 上传: 路径第一段必须是 auth.uid()
-- storage.foldername(name) 把 path 按 / 切成数组, [1] 是第一段 (1-indexed)
create policy "vtuber-models owner upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'vtuber-models'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 删除: 同上
create policy "vtuber-models owner delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'vtuber-models'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 更新 (覆盖同名上传) 同上
create policy "vtuber-models owner update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'vtuber-models'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'vtuber-models'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
