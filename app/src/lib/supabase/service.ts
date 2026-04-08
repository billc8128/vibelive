import { createClient as createSupabaseClient, SupabaseClient } from "@supabase/supabase-js";

// ────────────────────────────────────────────────────────────────
// Service role Supabase client
//
// 这个 client 使用 SUPABASE_SERVICE_ROLE_KEY,**完全绕过 RLS**。
// 只允许在受信任的服务端代码里 import (API route / cron / webhook),
// 因为它实际上具有数据库 root 权限。
//
// 典型场景:
//   - LiveKit webhook → 没有用户 cookie,但要跨用户归档僵尸 live_streams
//   - 后台清理任务 → 同上
//
// 严禁:
//   - 暴露给 client component
//   - 用 NEXT_PUBLIC_ 前缀的 env 暴露 service role key
//   - 在响应里把这个 client 查到的内容透传给未授权用户
// ────────────────────────────────────────────────────────────────

let cached: SupabaseClient | null = null;

export function createServiceClient(): SupabaseClient | null {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey || !url.startsWith("http")) {
    return null;
  }

  cached = createSupabaseClient(url, serviceKey, {
    auth: {
      // Service role 不需要 session 持久化,也不需要自动刷新 token
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cached;
}
