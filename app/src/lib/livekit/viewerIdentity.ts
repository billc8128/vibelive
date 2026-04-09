import { AI_AUDIENCE_IDENTITY_PREFIX } from "../participants";

const MAX_IDENTITY_LEN = 30;

export interface ViewerIdentityOptions {
  isOwnerSelfWatch: boolean;
  uniqueSuffix?: string;
}

export interface ViewerIdentitySession {
  displayName: string;
  transportIdentity: string;
}

function trimIdentity(value: string) {
  return value.trim().slice(0, MAX_IDENTITY_LEN);
}

function sanitizeDisplayName(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith(AI_AUDIENCE_IDENTITY_PREFIX)) {
    return trimIdentity(trimmed);
  }

  const rest = trimmed.slice(AI_AUDIENCE_IDENTITY_PREFIX.length).trim();
  return trimIdentity(`viewer-${rest || "guest"}`);
}

export function resolveViewerIdentity(
  preferredName: string,
  options: ViewerIdentityOptions,
): ViewerIdentitySession {
  const displayName = sanitizeDisplayName(preferredName);

  if (!options.isOwnerSelfWatch) {
    return {
      displayName,
      transportIdentity: displayName,
    };
  }

  const suffix = trimIdentity(options.uniqueSuffix || "self");
  const joined = `${displayName}-monitor-${suffix}`;

  return {
    displayName,
    transportIdentity: trimIdentity(joined),
  };
}
