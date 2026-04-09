import { NextRequest } from "next/server";
import {
  sendAiAudienceContextEvent,
  type AiAudienceContextEventPayload,
} from "@/lib/orchestrator/client";
import { isAiAudienceContextEvent } from "@/lib/ai-audience/context";

export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "请求格式错误" }, { status: 400 });
  }

  if (!isAiAudienceContextEvent(payload)) {
    return Response.json({ error: "无效的上下文事件" }, { status: 400 });
  }

  const response = await sendAiAudienceContextEvent(
    payload as AiAudienceContextEventPayload,
  );
  if (!response) {
    return Response.json({ ok: true, skipped: true }, { status: 202 });
  }

  if (!response.ok) {
    return Response.json(
      { error: "上下文转发失败", status: response.status },
      { status: 502 },
    );
  }

  return Response.json({ ok: true });
}
