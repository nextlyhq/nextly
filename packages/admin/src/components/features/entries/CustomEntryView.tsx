"use client";

import type { ReactNode } from "react";

import { useSuppressedChrome } from "@admin/components/layout/ChromeSuppression";
import { PageContainer } from "@admin/components/layout/page-container";

interface CustomEntryViewProps {
  /**
   * Rendered above the view, but only when the page keeps its frame. An
   * immersive view has no page to put a trail on.
   */
  breadcrumbs: ReactNode;
  children: ReactNode;
}

/**
 * The frame a plugin's entry view renders in, decided in ONE place.
 *
 * A custom view may take the window. The page frame is the innermost layer of
 * admin chrome, so it is dropped from here rather than from the layout:
 * suppressing the sidebars alone would leave the view stopping 32px short of
 * every edge with a breadcrumb above it, which reads as a bug.
 *
 * The view asks for this on mount, so this reacts to what it asked for rather
 * than deciding on its behalf. Nothing here knows which views are immersive,
 * which is the point — a list of them would drift as plugins added routes,
 * silently, because a missing entry still renders.
 *
 * Create and edit route the SAME registered component, so the decision cannot
 * live in either route: a copy in one of them is a copy that can disagree, and
 * did — a view that took the window while editing was framed and capped while
 * creating the same record.
 *
 * A framed view is page CONTENT, so the measure is the page's, declared here.
 * A view that declared its own would sit inside this container's padding and
 * add a second inset to it, which is the disagreement the shell exists to end.
 * Framed and immersive are the whole vocabulary; there is no third case for a
 * width to answer.
 */
export function CustomEntryView({
  breadcrumbs,
  children,
}: CustomEntryViewProps) {
  const suppressed = useSuppressedChrome();

  if (suppressed.has("pageFrame")) return <>{children}</>;

  return (
    <PageContainer width="form">
      <div className="mb-6">{breadcrumbs}</div>
      {children}
    </PageContainer>
  );
}
