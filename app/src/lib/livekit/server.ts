import {
  RoomServiceClient,
  IngressClient,
  WebhookReceiver,
} from "livekit-server-sdk";

// ────────────────────────────────────────────────────────────────
// LiveKit 服务端客户端工厂
//
// 集中所有 LiveKit server SDK 客户端的实例化和 env 校验。
// 调用方只需:
//   const room = getRoomService();
//   if (!room) return ...; // 服务未配置
//
// 这样做的好处:
//   1. env 检查只写一次
//   2. wss → https 的 URL 转换只写一次
//   3. 单元测试可以 mock 这一层而不是 SDK 本身
// ────────────────────────────────────────────────────────────────

interface LiveKitCreds {
  url: string;       // ws/wss URL,用于客户端连接
  httpUrl: string;   // http/https URL,用于 server SDK
  apiKey: string;
  apiSecret: string;
}

function readCreds(): LiveKitCreds | null {
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!url || !apiKey || !apiSecret) return null;

  // server SDK 用 http(s),把 ws(s) 协议替换掉
  const httpUrl = url.replace(/^ws/, "http");
  return { url, httpUrl, apiKey, apiSecret };
}

export function getRoomService(): RoomServiceClient | null {
  const c = readCreds();
  if (!c) return null;
  return new RoomServiceClient(c.httpUrl, c.apiKey, c.apiSecret);
}

export function getIngressClient(): IngressClient | null {
  const c = readCreds();
  if (!c) return null;
  return new IngressClient(c.httpUrl, c.apiKey, c.apiSecret);
}

export function getWebhookReceiver(): WebhookReceiver | null {
  const c = readCreds();
  if (!c) return null;
  // WebhookReceiver 用 apiKey/apiSecret 验签 LiveKit 发来的请求
  return new WebhookReceiver(c.apiKey, c.apiSecret);
}
