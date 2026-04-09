"use client";

import { useState } from "react";
import {
  ProductCategory,
  PlatformType,
  CATEGORY_LABELS,
  PLATFORM_LABELS,
} from "@/lib/types";
import { useI18n } from "@/lib/i18n/context";
import type { TranslationKey } from "@/lib/i18n/zh";

interface FilterBarProps {
  onFilterChange: (filters: {
    category: ProductCategory | null;
    platform: PlatformType | null;
    sortBy: "viewers" | "recent";
  }) => void;
}

export function FilterBar({ onFilterChange }: FilterBarProps) {
  const { t } = useI18n();
  const [activeCategory, setActiveCategory] =
    useState<ProductCategory | null>(null);
  const [activePlatform, setActivePlatform] =
    useState<PlatformType | null>(null);
  const [sortBy, setSortBy] = useState<"viewers" | "recent">(
    "viewers"
  );

  const handleCategory = (cat: ProductCategory | null) => {
    setActiveCategory(cat);
    onFilterChange({ category: cat, platform: activePlatform, sortBy });
  };

  const handlePlatform = (plat: PlatformType | null) => {
    setActivePlatform(plat);
    onFilterChange({ category: activeCategory, platform: plat, sortBy });
  };

  const handleSort = (s: "viewers" | "recent") => {
    setSortBy(s);
    onFilterChange({ category: activeCategory, platform: activePlatform, sortBy: s });
  };

  const categories = Object.keys(CATEGORY_LABELS) as ProductCategory[];
  const platforms = Object.keys(PLATFORM_LABELS) as PlatformType[];

  return (
    <div className="space-y-3">
      {/* Categories */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary mr-1">
          {t('filter.category')}
        </span>
        <button
          onClick={() => handleCategory(null)}
          className={`pixel-tag cursor-pointer transition-colors ${
            activeCategory === null ? "filter-chip-active" : "hover:text-text-primary"
          }`}
        >
          {t('filter.all')}
        </button>
        {categories.map((key) => (
          <button
            key={key}
            onClick={() => handleCategory(key)}
            className={`pixel-tag cursor-pointer transition-colors ${
              activeCategory === key
                ? "filter-chip-active"
                : "hover:text-text-primary"
            }`}
          >
            {t(`category.${key}` as TranslationKey)}
          </button>
        ))}
      </div>

      {/* Platforms */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary mr-1">
          {t('filter.platform')}
        </span>
        <button
          onClick={() => handlePlatform(null)}
          className={`pixel-tag cursor-pointer transition-colors ${
            activePlatform === null ? "filter-chip-active" : "hover:text-text-primary"
          }`}
        >
          {t('filter.all')}
        </button>
        {platforms.map((key) => (
          <button
            key={key}
            onClick={() => handlePlatform(key)}
            className={`pixel-tag cursor-pointer transition-colors ${
              activePlatform === key
                ? "filter-chip-active"
                : "hover:text-text-primary"
            }`}
          >
            {t(`platform.${key}` as TranslationKey)}
          </button>
        ))}
      </div>

      {/* Sort */}
      <div className="flex items-center gap-2">
        <span className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary mr-1">
          {t('filter.sort')}
        </span>
        {[
          { key: "viewers" as const, label: t('filter.sortViewers') },
          { key: "recent" as const, label: t('filter.sortRecent') },
        ].map((opt) => (
          <button
            key={opt.key}
            onClick={() => handleSort(opt.key)}
            className={`pixel-tag cursor-pointer transition-colors ${
              sortBy === opt.key
                ? "filter-chip-active"
                : "hover:text-text-primary"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
