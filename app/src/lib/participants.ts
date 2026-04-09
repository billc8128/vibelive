export const AI_AUDIENCE_IDENTITY_PREFIX = "ai-audience:";
// 首页 LiveStreamCard hover 预览用的临时连接 identity 前缀.
// 这些 participant 不应该出现在观众数 / 观众列表里 — 它们只是首页卡片划过时
// 抓帧用的瞬时连接, 不是真观众. 见 commit 0e7cd81.
export const HOVER_PREVIEW_IDENTITY_PREFIX = "hover-";

export interface ParticipantLike {
  identity: string;
  permissions?: {
    canPublish?: boolean;
  } | null;
}

export function isAiAudienceIdentity(identity: string): boolean {
  return identity.startsWith(AI_AUDIENCE_IDENTITY_PREFIX);
}

export function isHoverPreviewIdentity(identity: string): boolean {
  return identity.startsWith(HOVER_PREVIEW_IDENTITY_PREFIX);
}

export function isViewerParticipant(participant: ParticipantLike): boolean {
  return (
    !participant.permissions?.canPublish &&
    !isAiAudienceIdentity(participant.identity) &&
    !isHoverPreviewIdentity(participant.identity)
  );
}
