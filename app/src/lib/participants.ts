export const AI_AUDIENCE_IDENTITY_PREFIX = "ai-audience:";

export interface ParticipantLike {
  identity: string;
  permissions?: {
    canPublish?: boolean;
  } | null;
}

export function isAiAudienceIdentity(identity: string): boolean {
  return identity.startsWith(AI_AUDIENCE_IDENTITY_PREFIX);
}

export function isViewerParticipant(participant: ParticipantLike): boolean {
  return (
    !participant.permissions?.canPublish &&
    !isAiAudienceIdentity(participant.identity)
  );
}
