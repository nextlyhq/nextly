"use client";

import { useEffect, useState } from "react";

/**
 * ReadingProgressBar - 2px-tall bar fixed to the top of the viewport
 * that fills as the reader scrolls through the article.
 *
 * Article-scoped: the progress percentage is computed against the
 * height of the element matching `targetSelector` (default `article`),
 * not the full page. That way the footer + related-posts sections
 * don't look like "the article keeps going."
 *
 * Uses a single scroll listener + requestAnimationFrame to avoid
 * thrashing on fast scroll. Hidden when prefers-reduced-motion is
 * set (the bar's main purpose is feedback during motion - readers
 * who've disabled motion don't need it).
 */

interface ReadingProgressBarProps {
  targetSelector?: string;
}

export function ReadingProgressBar({
  targetSelector = "article",
}: ReadingProgressBarProps) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const target = document.querySelector(targetSelector);
    if (!target) return;

    let ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const rect = (target as HTMLElement).getBoundingClientRect();
        const total = (target as HTMLElement).offsetHeight - window.innerHeight;
        const scrolled = Math.max(0, -rect.top);
        const pct = total > 0 ? Math.min(100, (scrolled / total) * 100) : 0;
        setProgress(pct);
        ticking = false;
      });
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [targetSelector]);

  return (
    <div
      className="pointer-events-none fixed left-0 right-0 top-0 z-50 h-0.5 motion-reduce:hidden"
      aria-hidden="true"
    >
      <div
        className="h-full transition-[width] duration-75"
        style={{
          width: `${progress}%`,
          background: "var(--color-accent)",
        }}
      />
    </div>
  );
}
