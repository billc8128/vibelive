import { NextRequest } from "next/server";

import { tickAiAudienceRuntime } from "@/lib/orchestrator/client";

export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "请求格式错误" }, { status: 400 });
  }

  const roomSlug =
    typeof (payload as { roomSlug?: unknown })?.roomSlug === "string"
      ? (payload as { roomSlug: string }).roomSlug.trim()
      : "";
  if (!roomSlug) {
    return Response.json({ error: "roomSlug is required" }, { status: 400 });
  }

  const response = await tickAiAudienceRuntime({ roomSlug });
  if (!response) {
    return Response.json({ ok: true, skipped: true }, { status: 202 });
  }

  if (!response.ok) {
    return Response.json(
      { error: "runtime tick 转发失败", status: response.status },
      { status: 502 },
    );
  }

  return Response.json({ ok: true });
}
