// ============================================
// Vibelive 数据类型定义
// AI Code Streaming Platform
// ============================================

// --- 基础类型 ---

export type StreamStatus = 'live' | 'ended' | 'scheduled' | 'paused';

export type ProjectCategory =
  | 'notes'
  | 'productivity'
  | 'marketing'
  | 'video'
  | 'social'
  | 'gaming'
  | 'education'
  | 'finance'
  | 'health'
  | 'devtools';

export type ProjectPlatform = 'web' | 'mobile' | 'desktop' | 'cli' | 'api';

export type CodingTool =
  | 'cursor'
  | 'copilot'
  | 'windsurf'
  | 'v0'
  | 'bolt'
  | 'replit'
  | 'claude_code'
  | 'other';

export type DevStage =
  | 'planning'
  | 'scaffolding'
  | 'building'
  | 'styling'
  | 'testing'
  | 'deploying'
  | 'completed';

// --- 核心实体 ---

export interface Broadcaster {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  bio: string;
  followers: number;
  totalStreams: number;
  totalViewers: number;
  preferredTools: CodingTool[];
  socialLinks: {
    github?: string;
    twitter?: string;
    website?: string;
  };
  isLive: boolean;
  joinedAt: string; // ISO date
}

export interface Project {
  id: string;
  name: string;
  description: string;
  broadcasterId: string;
  category: ProjectCategory;
  platform: ProjectPlatform;
  tools: CodingTool[];
  thumbnailUrl: string;
  tags: string[];
  status: 'in_development' | 'completed' | 'published';
  productUrl?: string; // 完成后的产品链接
  totalViewers: number;
  devTimeMinutes: number;
  stages: DevStageInfo[];
  currentStage?: DevStage;
  createdAt: string;
  updatedAt: string;
}

export interface Stream {
  id: string;
  title: string;
  description: string;
  broadcasterId: string;
  projectId: string;
  status: StreamStatus;
  thumbnailUrl: string;
  viewerCount: number;
  peakViewers: number;
  detectedTool: CodingTool | null;
  currentStage: DevStage;
  startedAt: string;
  endedAt?: string;
  durationMinutes?: number;
  tags: string[];
}

export interface DevStageInfo {
  stage: DevStage;
  label: string;
  progress: number; // 0-100
  isActive: boolean;
  completedAt?: string;
}

export interface ChatMessage {
  id: string;
  streamId: string;
  userId: string;
  username: string;
  avatarUrl: string;
  content: string;
  timestamp: string;
  type: 'text' | 'system';
}

export interface Category {
  id: ProjectCategory;
  label: string;
  labelZh: string;
  icon: string;
  description: string;
  color: string;
  projectCount: number;
}

export interface ToolInfo {
  id: CodingTool;
  name: string;
  icon: string;
  color: string;
  description: string;
  usagePercent: number;
}

// --- 页面数据聚合类型 ---

export interface StreamWithDetails extends Stream {
  broadcaster: Broadcaster;
  project: Project;
}

export interface ProjectWithBroadcaster extends Project {
  broadcaster: Broadcaster;
}
