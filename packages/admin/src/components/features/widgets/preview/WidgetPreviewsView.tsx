"use client";

/**
 * The widget preview page's body: every widget the reader may see, from the
 * development preview read, each drawn in every state at every size, with a
 * light and dark switch and the accessibility check.
 *
 * Every card is drawn with the admin's own declaration of the widget, the one
 * the dashboard draws with (`resolveDashboardWidgets`, from the workspace
 * payload this reader was sent). The read decides which widgets are listed
 * and what their ready states are drawn from; it is the same audience, so a
 * listed widget the admin holds no declaration for is said, never guessed.
 *
 * The switch is the admin's own theme (`useTheme`), so every card is drawn in
 * the theme exactly as the dashboard is. The check runs in the theme on show,
 * and each state keeps its findings per theme.
 *
 * @module components/features/widgets/preview/WidgetPreviewsView
 */

import { Button } from "@nextlyhq/ui";
import { useCallback, useMemo, useRef, useState, type JSX } from "react";

import { useBranding } from "@admin/context/providers/BrandingProvider";
import { useTheme } from "@admin/context/providers/ThemeProvider";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";

import { resolveDashboardWidgets } from "../resolve-widgets";

import {
  isBlockingFinding,
  pageAccessibilityCheck,
  type AccessibilityFinding,
} from "./accessibility";
import {
  findingsKey,
  PreviewFindingsContext,
  type PreviewFindings,
} from "./preview-findings";
import type { WidgetPreview } from "./types";
import { WidgetPreviewSection } from "./WidgetPreviewSection";

/** Said where the page holds no axe to check with. */
export const NO_ACCESSIBILITY_CHECK =
  "No accessibility check is loaded in this page: load axe-core's script (as the end-to-end suite does) and check again.";

/** What the last check said, for the status line. */
type CheckStatus =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "unavailable" }
  | { kind: "done"; theme: string; states: number; blocking: number };

function statusText(status: CheckStatus): string {
  switch (status.kind) {
    case "idle":
      return "Not checked yet.";
    case "running":
      return "Checking each drawn state...";
    case "unavailable":
      return NO_ACCESSIBILITY_CHECK;
    case "done":
      return `Checked ${status.states} states in ${status.theme}: ${status.blocking} with serious or critical findings.`;
  }
}

/** Runs the check on every drawn state under `root`, one after another. */
async function checkEveryState(
  root: HTMLElement,
  check: (element: Element) => Promise<AccessibilityFinding[]>
): Promise<Map<string, AccessibilityFinding[]>> {
  const found = new Map<string, AccessibilityFinding[]>();
  for (const state of root.querySelectorAll<HTMLElement>(
    "[data-preview-key]"
  )) {
    const key = state.dataset.previewKey;
    const card = state.querySelector("[data-preview-card]");
    if (key === undefined || card === null) continue;
    found.set(key, await check(card));
  }
  return found;
}

export function WidgetPreviewsView({
  previews,
}: {
  previews: readonly WidgetPreview[];
}): JSX.Element {
  const branding = useBranding();
  const { hasPermission } = useCurrentUserPermissions();
  const { resolvedTheme, setTheme } = useTheme();
  const theme = resolvedTheme ?? "light";

  // The declarations the dashboard draws with, by id.
  const definitions = useMemo(
    () =>
      new Map(
        resolveDashboardWidgets(
          branding.plugins,
          branding.widgets,
          hasPermission
        ).map(definition => [definition.id, definition] as const)
      ),
    [branding, hasPermission]
  );

  const rootRef = useRef<HTMLDivElement>(null);
  const [findings, setFindings] = useState<PreviewFindings>(new Map());
  const [status, setStatus] = useState<CheckStatus>({ kind: "idle" });

  const runCheck = useCallback(async () => {
    const check = pageAccessibilityCheck();
    const root = rootRef.current;
    if (check === undefined || root === null) {
      setStatus({ kind: "unavailable" });
      return;
    }
    setStatus({ kind: "running" });
    const found = await checkEveryState(root, check);
    setFindings(previous => {
      const next = new Map(previous);
      for (const [key, list] of found) next.set(findingsKey(theme, key), list);
      return next;
    });
    setStatus({
      kind: "done",
      theme,
      states: found.size,
      blocking: [...found.values()].filter(list => list.some(isBlockingFinding))
        .length,
    });
  }, [theme]);

  const context = useMemo(() => ({ findings, theme }), [findings, theme]);

  return (
    <div className="space-y-6" data-testid="widget-previews">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Widget previews
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Every widget you may see, drawn from its preview cases at its
          smallest, default and largest sizes, and in each state its card can be
          in. Nothing here loads data. This page exists only while the server
          runs in development.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <div
            role="group"
            aria-label="Theme"
            className="inline-flex gap-1 rounded-md border border-border p-1"
          >
            {(["light", "dark"] as const).map(option => (
              <Button
                key={option}
                variant={theme === option ? "default" : "ghost"}
                size="sm"
                aria-pressed={theme === option}
                onClick={() => setTheme(option)}
              >
                {option === "light" ? "Light" : "Dark"}
              </Button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={status.kind === "running"}
            onClick={() => void runCheck()}
          >
            Check accessibility
          </Button>
          <p
            role="status"
            className="text-sm text-muted-foreground"
            data-testid="accessibility-status"
            data-check={status.kind}
          >
            {statusText(status)}
          </p>
        </div>
      </header>
      <PreviewFindingsContext.Provider value={context}>
        <div ref={rootRef} className="space-y-6">
          {previews.map(preview => (
            <WidgetPreviewSection
              key={preview.id}
              preview={preview}
              definition={definitions.get(preview.id)}
            />
          ))}
        </div>
      </PreviewFindingsContext.Provider>
    </div>
  );
}
