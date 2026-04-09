import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// ────────────────────────────────────────────────────────────────
// /api/vtuber-models
//
// 当前用户的 VTuber / Live2D 模型仓库.
//   GET   list  → 当前用户的所有模型
//   POST  register → 客户端把文件直传到 Supabase Storage 后,
//                    用元数据调这个接口往 vtuber_models 表插一行.
//
// 服务端不接触 byte: 上传由 client supabase.storage.from('vtuber-models').upload()
// 直接打 Storage, server 只校验 metadata 合法性 (路径必须以 user_id 开头).
//
// 删除走 /api/vtuber-models/[id] DELETE — 那里需要清 Storage 里的文件.
// ────────────────────────────────────────────────────────────────

const MAX_FILE_COUNT = 1000;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024; // 200MB
const NAME_MAX = 100;

interface RegisterBody {
  name?: unknown;
  entry_path?: unknown;
  vtube_config_path?: unknown;
  storage_prefix?: unknown;
  file_paths?: unknown;
  file_count?: unknown;
  total_size_bytes?: unknown;
}

// GET: 当前用户的所有模型 (按 created_at desc)
export async function GET() {
  const supabase = await createClient();
  if (!supabase) {
    return Response.json({ models: [] });
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ models: [] });
  }

  const { data, error } = await supabase
    .from("vtuber_models")
    .select("id, name, entry_path, vtube_config_path, storage_prefix, file_count, total_size_bytes, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ models: data ?? [] });
}

// POST: 客户端上传完成后, 注册元数据
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

  let body: RegisterBody;
  try {
    body = (await request.json()) as RegisterBody;
  } catch {
    return Response.json({ error: "请求格式错误" }, { status: 400 });
  }

  // ─ 字段校验 ─
  const name = typeof body.name === "string" ? body.name.trim().slice(0, NAME_MAX) : "";
  if (!name) {
    return Response.json({ error: "name 必填" }, { status: 400 });
  }

  const entry_path = typeof body.entry_path === "string" ? body.entry_path : "";
  if (!entry_path || !entry_path.endsWith(".model3.json")) {
    return Response.json({ error: "entry_path 必须是 .model3.json" }, { status: 400 });
  }

  const storage_prefix = typeof body.storage_prefix === "string" ? body.storage_prefix : "";
  if (!storage_prefix) {
    return Response.json({ error: "storage_prefix 必填" }, { status: 400 });
  }

  // ─ 安全: 路径必须落在 {user_id}/ 下, 防止越权污染他人空间 ─
  // (Storage RLS 也会拦, 这里是双保险 + 早 fail)
  const userPrefix = `${user.id}/`;
  if (!storage_prefix.startsWith(userPrefix)) {
    return Response.json({ error: "storage_prefix 越权" }, { status: 403 });
  }
  if (!entry_path.startsWith(userPrefix)) {
    return Response.json({ error: "entry_path 越权" }, { status: 403 });
  }
  // entry_path 必须落在 storage_prefix 下
  if (!entry_path.startsWith(`${storage_prefix}/`)) {
    return Response.json({ error: "entry_path 不在 storage_prefix 下" }, { status: 400 });
  }

  // vtube_config_path 可选, 校验同上
  let vtube_config_path: string | null = null;
  if (typeof body.vtube_config_path === "string" && body.vtube_config_path) {
    if (!body.vtube_config_path.endsWith(".vtube.json")) {
      return Response.json({ error: "vtube_config_path 必须是 .vtube.json" }, { status: 400 });
    }
    if (!body.vtube_config_path.startsWith(`${storage_prefix}/`)) {
      return Response.json({ error: "vtube_config_path 不在 storage_prefix 下" }, { status: 400 });
    }
    vtube_config_path = body.vtube_config_path;
  }

  // file_paths: 相对于 storage_prefix, 用于删除时的精确清理
  if (!Array.isArray(body.file_paths)) {
    return Response.json({ error: "file_paths 必须是数组" }, { status: 400 });
  }
  const file_paths = body.file_paths.filter((p): p is string => typeof p === "string");
  if (file_paths.length === 0) {
    return Response.json({ error: "file_paths 为空" }, { status: 400 });
  }
  if (file_paths.length > MAX_FILE_COUNT) {
    return Response.json({ error: `文件过多 (>${MAX_FILE_COUNT})` }, { status: 400 });
  }
  // 不允许 .. 或绝对路径
  for (const p of file_paths) {
    if (p.includes("..") || p.startsWith("/")) {
      return Response.json({ error: `非法路径: ${p}` }, { status: 400 });
    }
  }

  const file_count = typeof body.file_count === "number" ? Math.floor(body.file_count) : file_paths.length;
  const total_size_bytes = typeof body.total_size_bytes === "number" ? Math.floor(body.total_size_bytes) : 0;
  if (total_size_bytes < 0 || total_size_bytes > MAX_TOTAL_BYTES) {
    return Response.json({ error: `total_size_bytes 超过限制 (${MAX_TOTAL_BYTES})` }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("vtuber_models")
    .insert({
      user_id: user.id,
      name,
      entry_path,
      vtube_config_path,
      storage_prefix,
      file_paths,
      file_count,
      total_size_bytes,
    })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ model: data });
}
