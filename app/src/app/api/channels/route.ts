import { NextRequest } from "next/server";
import {
  AI_AUDIENCE_SETTINGS_KEYS,
  isAllowedAiAudienceSettingsKey,
  normalizeAiAudienceSettingsPatch,
} from "@/lib/ai-audience/settings";
import { createClient } from "@/lib/supabase/server";

// Slug 校验:小写字母/数字/短横线,3-20 字符 (与数据库 check 约束一致)
const SLUG_RE = /^[a-z0-9-]{3,20}$/;

// 持久频道表的可写字段白名单 (其它放 settings JSONB)
const COL_FIELDS = [
  "title",
  "thumbnail_url",
  "project_name",
  "project_desc",
  "project_stage",
  "project_url",
  "coding_tool",
  "quality",
] as const;

// settings JSONB 内允许的键 (服务端校验,防止注入垃圾)
const SETTINGS_KEYS = new Set([
  "category",
  "platforms",
  "tags",
  "slow_mode_enabled",
  "slow_mode_seconds",
  "followers_only",
  ...AI_AUDIENCE_SETTINGS_KEYS,
]);

// 简单字符串截断
const cap = (v: unknown, n: number) =>
  typeof v === "string" ? v.slice(0, n) : "";

// GET: 获取当前登录用户的频道 (没有则返回 channel: null)
export async function GET() {
  const supabase = await createClient();
  if (!supabase) {
    return Response.json({ error: "服务未配置" }, { status: 500 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ channel: null }, { status: 200 });
  }

  const { data, error } = await supabase
    .from("channels")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ channel: data ?? null });
}

// POST: 首次创建频道 (需要 slug + 可选初始字段)
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  if (!supabase) {
    return Response.json({ error: "服务未配置" }, { status: 500 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  let body: { slug?: string; title?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求格式错误" }, { status: 400 });
  }

  const slug = (body.slug || "").trim().toLowerCase();
  if (!SLUG_RE.test(slug)) {
    return Response.json(
      { error: "频道 ID 仅允许小写字母、数字和短横线,3-20 字符" },
      { status: 400 }
    );
  }

  // 已存在 → 返回现有频道,而不是报错
  const { data: existing } = await supabase
    .from("channels")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (existing) {
    return Response.json({ channel: existing });
  }

  // slug 唯一性预检 (DB 也有约束兜底)
  const { data: taken } = await supabase
    .from("channels")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (taken) {
    return Response.json({ error: "该频道 ID 已被占用" }, { status: 409 });
  }

  const { data, error } = await supabase
    .from("channels")
    .insert({
      user_id: user.id,
      slug,
      title: cap(body.title, 200),
    })
    .select()
    .single();

  if (error) {
    // unique 约束兜底
    if (error.code === "23505") {
      return Response.json({ error: "该频道 ID 已被占用" }, { status: 409 });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ channel: data });
}

// PATCH: 更新频道字段 (持久化设置)
// 支持顶层列字段以及 settings.* 子字段
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  if (!supabase) {
    return Response.json({ error: "服务未配置" }, { status: 500 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求格式错误" }, { status: 400 });
  }

  // 找到当前用户频道
  const { data: channel } = await supabase
    .from("channels")
    .select("settings")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!channel) {
    return Response.json({ error: "频道不存在,请先创建" }, { status: 404 });
  }

  const updates: Record<string, unknown> = {};

  // 处理白名单顶层列
  for (const k of COL_FIELDS) {
    if (body[k] !== undefined) {
      // 字符串字段统一截断
      updates[k] = cap(body[k], k === "project_desc" ? 1000 : k === "thumbnail_url" || k === "project_url" ? 500 : 200);
    }
  }

  // 处理 settings 合并
  if (body.settings && typeof body.settings === "object") {
    const incoming = body.settings as Record<string, unknown>;
    const merged: Record<string, unknown> = {
      ...((channel.settings as Record<string, unknown>) || {}),
    };
    const aiAudiencePatch = normalizeAiAudienceSettingsPatch(incoming);
    for (const [k, v] of Object.entries(incoming)) {
      if (!SETTINGS_KEYS.has(k)) continue;
      if (isAllowedAiAudienceSettingsKey(k)) {
        const nextValue = aiAudiencePatch[k];
        if (nextValue !== undefined) {
          merged[k] = nextValue;
        }
        continue;
      }
      // 简单类型校验
      if (k === "platforms" && Array.isArray(v)) {
        merged[k] = v.filter((x) => typeof x === "string").slice(0, 10);
      } else if (k === "slow_mode_seconds" && typeof v === "number") {
        // 仅允许 5/10/30/60
        merged[k] = [5, 10, 30, 60].includes(v) ? v : 5;
      } else if (
        (k === "slow_mode_enabled" || k === "followers_only") &&
        typeof v === "boolean"
      ) {
        merged[k] = v;
      } else if ((k === "category" || k === "tags") && typeof v === "string") {
        merged[k] = v.slice(0, 200);
      }
    }
    updates.settings = merged;
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "没有可更新的字段" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("channels")
    .update(updates)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // 如果当前正在直播,同步把热字段写回 live_streams (保持观看页实时显示)
  // 仅同步会被观看者看到的字段
  const liveSync: Record<string, unknown> = {};
  if (updates.title !== undefined) liveSync.title = updates.title;
  if (updates.thumbnail_url !== undefined) liveSync.thumbnail_url = updates.thumbnail_url;
  if (updates.project_name !== undefined) liveSync.project_name = updates.project_name;
  if (updates.project_desc !== undefined) liveSync.description = updates.project_desc;
  if (updates.project_stage !== undefined) liveSync.stage = updates.project_stage;
  if (updates.coding_tool !== undefined) liveSync.coding_tool = updates.coding_tool;

  if (Object.keys(liveSync).length > 0) {
    await supabase
      .from("live_streams")
      .update(liveSync)
      .eq("user_id", user.id)
      .eq("status", "live");
  }

  return Response.json({ channel: data });
}
