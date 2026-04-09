"use client";

import { useI18n } from "@/lib/i18n/context";

export function LiveTicker() {
  const { t } = useI18n();

  const TICKER_ITEMS = [
    { icon: "🎮", text: t('ticker.startedStreaming', { user: 'PixelCrafter', project: 'NoteFlow' }), color: "text-accent-pink" },
    { icon: "⚡", text: t('ticker.using', { user: '独立开发者小明', tool: 'Bolt', project: 'TaskForge' }), color: "text-accent-purple" },
    { icon: "🌟", text: t('ticker.phase', { user: 'AI Artisan', project: 'LangBridge', phase: '语音翻译' }), color: "text-accent-cyan" },
    { icon: "📦", text: t('ticker.launched', { user: 'Dev Sensei', project: 'CodeQuest' }), color: "text-accent-green" },
    { icon: "💻", text: t('ticker.using', { user: 'Neural Nomad', tool: 'Copilot', project: 'ReviewBot' }), color: "text-accent-pink" },
    { icon: "🎯", text: t('ticker.published', { project: 'MindMap AI' }), color: "text-accent-yellow" },
    { icon: "🎲", text: t('ticker.building', { user: 'indie_hacker', project: 'PixelQuest', phase: '战斗系统' }), color: "text-accent-purple" },
  ];

  const doubled = [...TICKER_ITEMS, ...TICKER_ITEMS];

  return (
    <div className="w-full overflow-hidden border-y border-border-pixel/50 bg-bg-secondary/50 py-1.5">
      <div className="ticker-scroll flex whitespace-nowrap gap-8">
        {doubled.map((item, i) => (
          <span key={i} className="inline-flex items-center gap-2 text-xs">
            <span>{item.icon}</span>
            <span className={item.color}>{item.text}</span>
            <span className="text-border-pixel mx-2">•</span>
          </span>
        ))}
      </div>
    </div>
  );
}
