import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const SLUG_RE = /^[a-z0-9-]{3,20}$/;

// GET /api/channels/check-slug?slug=foo
// 返回 { available: true|false, reason?: string }
// 用于开播页设置频道 ID 时的实时校验
export async function GET(request: NextRequest) {
  const slug = (request.nextUrl.searchParams.get("slug") || "").trim().toLowerCase();
  if (!SLUG_RE.test(slug)) {
    return Response.json({
      available: false,
      reason: "格式不合法",
    });
  }

  const supabase = await createClient();
  if (!supabase) {
    return Response.json({ available: false, reason: "服务未配置" }, { status: 500 });
  }

  const { data } = await supabase
    .from("channels")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (data) {
    return Response.json({ available: false, reason: "已被占用" });
  }
  return Response.json({ available: true });
}
