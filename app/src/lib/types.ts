export type ProductCategory =
  | "notes"
  | "productivity"
  | "marketing"
  | "video"
  | "social"
  | "dev-tools"
  | "ai"
  | "gaming"
  | "education"
  | "other";

export type PlatformType = "web" | "mobile" | "desktop" | "extension" | "api";

export type CodingTool =
  | "cursor"
  | "copilot"
  | "windsurf"
  | "claude-code"
  | "v0"
  | "bolt"
  | "replit"
  | "other";

export type StreamStatus = "live" | "offline" | "away";

export interface Streamer {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  bio: string;
  followers: number;
}

export interface ProjectStage {
  name: string;
  completed: boolean;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  category: ProductCategory;
  platforms: PlatformType[];
  tags: string[];
  productUrl?: string;
  thumbnailUrl: string;
}

export interface Stream {
  id: string;
  streamer: Streamer;
  project: Project;
  status: StreamStatus;
  codingTool: CodingTool;
  viewers: number;
  stages: ProjectStage[];
  startedAt: string;
  totalDevTime: number; // minutes
}

export interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  avatarUrl: string;
  content: string;
  timestamp: string;
}

export const CATEGORY_LABELS: Record<ProductCategory, string> = {
  notes: "笔记",
  productivity: "效率",
  marketing: "营销",
  video: "视频",
  social: "社交",
  "dev-tools": "开发工具",
  ai: "AI",
  gaming: "游戏",
  education: "教育",
  other: "其他",
};

export const PLATFORM_LABELS: Record<PlatformType, string> = {
  web: "网页",
  mobile: "APP",
  desktop: "桌面端",
  extension: "浏览器插件",
  api: "API",
};

export const TOOL_LABELS: Record<CodingTool, string> = {
  cursor: "Cursor",
  copilot: "GitHub Copilot",
  windsurf: "Windsurf",
  "claude-code": "Claude Code",
  v0: "v0",
  bolt: "Bolt",
  replit: "Replit",
  other: "其他",
};

