import { AccessToken } from "livekit-server-sdk";
import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const MAX_IDENTITY_LEN = 30;
const MAX_ROOM_LEN = 60;
// Viewer 的"显示名"上限 — 给 `viewer-...-xxxxxx` 前后缀留空间,
// 14 字符开销 (`viewer-` 7 + `-xxxxxx` 7) → 16 字符 nickname 是安全的
const MAX_VIEWER_NAME_LEN = 16;

export async function POST(request: NextRequest) {
  let body: { room?: string; identity?: string; isPublisher?: boolean };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求格式错误" }, { status: 400 });
  }

  const { room, identity, isPublisher } = body;

  if (!room || typeof room !== "string" || room.length > MAX_ROOM_LEN) {
    return Response.json({ error: "room 无效" }, { status: 400 });
  }

  // Publisher tokens: require auth, derive identity from user profile (ignore client identity)
  let resolvedIdentity: string;
  let displayName = "";
  let canPublish = false;

  if (isPublisher) {
    const supabase = await createClient();
    if (!supabase) {
      return Response.json({ error: "服务未配置" }, { status: 500 });
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return Response.json({ error: "开播需要登录" }, { status: 401 });
    }
    canPublish = true;
    // Derive identity from auth — never trust client input for publishers
    resolvedIdentity = user.user_metadata?.full_name
      || user.user_metadata?.name
      || user.email?.split("@")[0]
      || "主播";
    displayName = resolvedIdentity;
  } else {
    // Viewer: use client-provided identity but sanitize.
    //
    // 关键: viewer identity 必须永远不和 publisher identity 撞 —
    // LiveKit 的"同 identity 进同 room"会强制踢掉旧连接(participant
    // duplicated). 同一主播自己开 watch 预览时,如果 viewer identity
    // 和 publisher identity 相同(都从 user_metadata.full_name 派生),
    // publisher 会被自己踢出去, go-live 那边变成"下播"假状态.
    //
    // 对策: viewer identity 一律加 `viewer-` 前缀 + 6 字符随机后缀.
    // displayName 字段保留干净 nickname, 前端通过 participant.name 拿来显示.
    //
    // 例外: hover- 前缀的请求来自 LiveStreamCard 的首页悬停预览, 客户端
    // 已经自己加了 `hover-{room}-{rand}` 唯一命名空间, 透传不动 — 这样
    // watch 页面 line 294/378 的 `!p.identity.startsWith("hover-")`
    // 过滤逻辑能继续把它们排除在观众列表外.
    if (!identity || typeof identity !== "string") {
      return Response.json({ error: "identity 为必填项" }, { status: 400 });
    }
    const cleaned = identity.trim();
    if (!cleaned) {
      return Response.json({ error: "identity 不能为空" }, { status: 400 });
    }

    if (cleaned.startsWith("hover-")) {
      // hover preview: 透传, displayName 留空 (会被观众列表过滤掉, 反正不显示)
      resolvedIdentity = cleaned.slice(0, MAX_IDENTITY_LEN);
    } else {
      // 普通 viewer: 加前缀和随机后缀
      const nick = cleaned.slice(0, MAX_VIEWER_NAME_LEN);
      const suffix = Math.random().toString(36).slice(2, 8);
      resolvedIdentity = `viewer-${nick}-${suffix}`;
      displayName = nick;
    }
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    return Response.json({ error: "服务端未配置 LiveKit 凭据" }, { status: 500 });
  }

  const token = new AccessToken(apiKey, apiSecret, {
    identity: resolvedIdentity,
    name: displayName, // 前端 participant.name 用,纯显示;identity 是系统级唯一 ID
    ttl: "6h",
  });

  token.addGrant({
    room,
    roomJoin: true,
    canPublish,
    canSubscribe: true,
    canPublishData: true,
  });

  const jwt = await token.toJwt();

  return Response.json({ token: jwt });
}
