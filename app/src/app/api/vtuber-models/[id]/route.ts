import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// ────────────────────────────────────────────────────────────────
// /api/vtuber-models/[id]
//
// DELETE: 删除一个用户自传模型 — 同时清掉:
//   1. Storage 里 storage_prefix 下的所有文件 (按 file_paths 列表精确删)
//   2. vtuber_models 表的行
//
// 顺序: 先 delete storage objects, 再 delete row.
// 如果 storage 部分失败但 row 没删, 用户重试 DELETE 仍能继续清理
// (file_paths 还在 row 里). 如果先删行再删 storage, 失败就成了孤儿对象.
// ────────────────────────────────────────────────────────────────

const BUCKET = "vtuber-models";

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  if (!id) {
    return Response.json({ error: "id 必填" }, { status: 400 });
  }

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

  // RLS 会过滤掉非自己的行 — maybeSingle 拿不到等同于"无权或不存在"
  const { data: model, error: fetchErr } = await supabase
    .from("vtuber_models")
    .select("id, storage_prefix, file_paths")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr) {
    return Response.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!model) {
    return Response.json({ error: "模型不存在或无权访问" }, { status: 404 });
  }

  // 拼出绝对 storage path 并批量删除
  // file_paths 是相对路径, 例如 "my_model/textures/00.png"
  const filePaths: string[] = Array.isArray(model.file_paths)
    ? model.file_paths.filter((p: unknown): p is string => typeof p === "string")
    : [];

  const absolutePaths = filePaths.map((p) => `${model.storage_prefix}/${p}`);

  if (absolutePaths.length > 0) {
    // Supabase storage.remove 支持一次最多 ~1000 path. MAX_FILE_COUNT 也是 1000,
    // 所以正常情况下一次能删完. 防御性地分批一次 500.
    const BATCH = 500;
    for (let i = 0; i < absolutePaths.length; i += BATCH) {
      const batch = absolutePaths.slice(i, i + BATCH);
      const { error: rmErr } = await supabase.storage
        .from(BUCKET)
        .remove(batch);
      if (rmErr) {
        // Storage 删失败 → 不删 row, 让用户重试. 但已经删掉的部分是不可逆的;
        // 客户端把这个 error message 显示出来, 用户重试 DELETE 仍可继续清理.
        return Response.json(
          { error: `存储清理失败: ${rmErr.message}` },
          { status: 500 }
        );
      }
    }
  }

  // 现在删 row
  const { error: delErr } = await supabase
    .from("vtuber_models")
    .delete()
    .eq("id", id);

  if (delErr) {
    return Response.json({ error: delErr.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
