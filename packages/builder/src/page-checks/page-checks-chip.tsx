"use client";

/**
 * Where Page checks open: a quiet count beside Publish, "2 checks", or
 * "Checks" with a tick at none, which opens the list. Pressing an item
 * selects its block, brings it into view and opens the setting that fixes
 * it; the list then gives way to a slim bar under the count, "Check 2 of 5",
 * with Previous, Next and All checks, so the inspector where the fix opens
 * stays uncovered.
 *
 * The checks run over the draft the editor holds, unsaved changes included,
 * each time it changes, so the count, the list and the bar follow the
 * author's fixes as they type. Nothing here touches Save or Publish: a
 * finding is never a reason to hold either back.
 *
 * @module page-checks/page-checks-chip
 */
import { Popover, PopoverContent, PopoverTrigger } from "@nextlyhq/ui";
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import * as React from "react";

import { revealNode } from "../canvas/reveal-node";
import type { EditorState } from "../editor-state";
import { ShowInspectorContext } from "../shell/show-inspector";

import { CORE_PAGE_CHECKS } from "./core-checks";
import {
  fixNeighbour,
  fixStep,
  fixStepWords,
  type FixPlace,
  type FixStep,
} from "./fix-walk";
import {
  pageCheckGroups,
  runPageChecks,
  type CheckedPage,
  type PageCheck,
  type PageFinding,
} from "./page-checks";
import { PageChecksList } from "./page-checks-list";

/** How long "All clear" stays before the bar goes, in ms. */
const ALL_CLEAR_FOR = 4000;

export interface PageChecksChipProps {
  /** The draft the checks judge, and the selection a fix moves. */
  readonly editor: Pick<EditorState, "document" | "select" | "askSetting">;
  /** The canvas, where a fixed block is brought into view. */
  readonly canvas: HTMLElement | null;
  /** The checks to run; the builder's own by default. */
  readonly checks?: readonly PageCheck[];
  /** The page's block definitions; the registry by default. */
  readonly blocks?: CheckedPage["blocks"];
  /** The header and footer drawn around the page, read with it. */
  readonly regions?: CheckedPage["regions"];
  /** The definitions the page's component placements are drawn from. */
  readonly definitions?: CheckedPage["definitions"];
  /** The site's variables, which colours written as one are read through. */
  readonly tokens?: CheckedPage["tokens"];
  /** The site's shared styles, its edits to block types' looks among them. */
  readonly namedClasses?: CheckedPage["namedClasses"];
  /** Opens the document's settings at a tab, for a fix found there. */
  readonly onOpenSettingsTab?: (tab: string) => void;
  /** What the editor knows of the page beyond its document (`page-facts`). */
  readonly facts?: CheckedPage["facts"];
}

/** Whether the list, the bar, or neither is open. */
type Opened = "closed" | "list" | "bar";

/** The count's words: "2 checks", or "Checks" beside a tick at none. */
function chipWords(count: number): string {
  if (count === 0) return "Checks";
  return `${String(count)} ${count === 1 ? "check" : "checks"}`;
}

/**
 * The walk through the list while fixing: where the author is, kept by the
 * finding's key and its index as last seen, and "All clear" shown for a
 * moment once nothing is left before the bar closes.
 */
function useFixWalk(
  findings: readonly PageFinding[],
  opened: Opened,
  close: () => void
): {
  readonly step: FixStep | undefined;
  readonly goTo: (finding: PageFinding) => void;
} {
  const [place, setPlace] = React.useState<FixPlace | undefined>(undefined);
  const step = place === undefined ? undefined : fixStep(findings, place);
  const at = step?.kind === "at" ? step.index : undefined;
  // The index follows the finding while it moves, so a fix of the finding
  // itself leaves Next where the author was.
  React.useEffect(() => {
    if (at !== undefined) {
      setPlace(current =>
        current === undefined || current.index === at
          ? current
          : { ...current, index: at }
      );
    }
  }, [at]);
  const clear = opened === "bar" && step?.kind === "clear";
  const closeLater = React.useRef(close);
  closeLater.current = close;
  React.useEffect(() => {
    if (!clear) return;
    const timer = setTimeout(() => closeLater.current(), ALL_CLEAR_FOR);
    return () => clearTimeout(timer);
  }, [clear]);
  const goTo = React.useCallback(
    (finding: PageFinding) =>
      setPlace({
        key: finding.key,
        index: findings.findIndex(each => each.key === finding.key),
      }),
    [findings]
  );
  return { step, goTo };
}

/** The slim bar under the count while the author fixes things. */
function FixBar({
  step,
  onStep,
  onAll,
  onClose,
}: {
  step: FixStep;
  /** Go to the finding before (`-1`) or after (`1`), where there is one. */
  onStep: ((direction: -1 | 1) => void) | undefined;
  onAll: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const clear = step.kind === "clear";
  return (
    <div
      role="group"
      aria-label="Fixing page checks"
      className="nx-page-checks-bar"
      data-clear={clear ? "" : undefined}
      // Escape from inside the bar closes it; elsewhere it stays the
      // editor's key.
      onKeyDown={event => {
        if (event.key === "Escape") onClose();
      }}
    >
      <span className="nx-page-checks-bar__where" role="status">
        {clear ? (
          <Check aria-hidden="true" className="nx-page-checks-bar__tick" />
        ) : null}
        {fixStepWords(step)}
      </span>
      {clear ? null : (
        <>
          <span className="nx-page-checks-bar__steps">
            <button
              type="button"
              className="nx-page-checks-bar__step"
              aria-label="Previous check"
              title="Previous check"
              disabled={onStep === undefined || !canStep(step, -1)}
              onClick={() => onStep?.(-1)}
            >
              <ChevronLeft aria-hidden="true" />
            </button>
            <button
              type="button"
              className="nx-page-checks-bar__step"
              aria-label="Next check"
              title="Next check"
              disabled={onStep === undefined || !canStep(step, 1)}
              onClick={() => onStep?.(1)}
            >
              <ChevronRight aria-hidden="true" />
            </button>
          </span>
          <button
            type="button"
            className="nx-page-checks-bar__all"
            onClick={onAll}
          >
            All checks
          </button>
        </>
      )}
      <button
        type="button"
        className="nx-page-checks-bar__step"
        aria-label="Close"
        title="Close"
        onClick={onClose}
      >
        <X aria-hidden="true" />
      </button>
    </div>
  );
}

/** Whether Previous (`-1`) or Next (`1`) has somewhere to go. */
function canStep(step: FixStep, direction: -1 | 1): boolean {
  if (step.kind === "clear") return false;
  if (step.kind === "at") {
    const to = step.index + direction;
    return to >= 0 && to < step.total;
  }
  return direction === 1 ? step.next < step.total : step.next > 0;
}

/** The count beside Publish, the list it opens, and the bar while fixing. */
export function PageChecksChip({
  editor,
  canvas,
  checks = CORE_PAGE_CHECKS,
  blocks,
  regions,
  definitions,
  tokens,
  namedClasses,
  onOpenSettingsTab,
  facts,
}: PageChecksChipProps): React.JSX.Element {
  const { document } = editor;
  const report = React.useMemo(
    () =>
      runPageChecks(
        {
          document,
          ...(blocks === undefined ? {} : { blocks }),
          ...(regions === undefined ? {} : { regions }),
          ...(definitions === undefined ? {} : { definitions }),
          ...(tokens === undefined ? {} : { tokens }),
          ...(namedClasses === undefined ? {} : { namedClasses }),
          ...(facts === undefined ? {} : { facts }),
        },
        checks
      ),
    [
      document,
      blocks,
      regions,
      definitions,
      tokens,
      namedClasses,
      facts,
      checks,
    ]
  );
  const { findings } = report;
  const [opened, setOpened] = React.useState<Opened>("closed");
  const close = React.useCallback(() => setOpened("closed"), []);
  const { step, goTo } = useFixWalk(findings, opened, close);
  // The fix opens in the inspector, shown first where the author hid it.
  const showInspector = React.useContext(ShowInspectorContext);
  // Going to a fix from the list moves the cursor to the inspector: the list
  // closing then must not take it back to the count. Set only on leaving the
  // list, so Previous and Next leave no stale mark for its next close.
  const fixing = React.useRef(false);
  const fix = (finding: PageFinding): void => {
    const { nodeId, fix: setting, settingsTab } = finding;
    // A fix in the document's settings opens them at its tab.
    if (settingsTab !== undefined) onOpenSettingsTab?.(settingsTab);
    else if (nodeId !== undefined) {
      if (setting === undefined) editor.select(nodeId);
      else {
        showInspector?.();
        editor.askSetting?.(nodeId, setting);
      }
      if (canvas !== null) revealNode(canvas, nodeId);
    }
    goTo(finding);
    if (opened === "list") fixing.current = true;
    setOpened("bar");
  };
  const count = findings.length;
  return (
    <span className="nx-page-checks-anchor">
      <Popover
        open={opened === "list"}
        onOpenChange={open => setOpened(open ? "list" : "closed")}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="nx-page-checks-chip"
            data-count={count}
            aria-label={
              count === 0 ? "Checks: nothing needs attention" : undefined
            }
          >
            {count === 0 ? (
              <Check aria-hidden="true" className="nx-page-checks-chip__tick" />
            ) : (
              <span aria-hidden="true" className="nx-page-checks-chip__dot" />
            )}
            {chipWords(count)}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          aria-label="Page checks"
          // Within the screen whatever its size, the list scrolling between
          // its heading and its note.
          className="nx-page-checks-popover flex max-h-[var(--radix-popover-content-available-height)] w-[min(420px,calc(100vw-2rem))] flex-col p-0"
          onCloseAutoFocus={event => {
            if (fixing.current) event.preventDefault();
            fixing.current = false;
          }}
        >
          <PageChecksList
            groups={pageCheckGroups(findings, checks, report.notes)}
            notRun={report.notRun}
            onFix={fix}
          />
        </PopoverContent>
      </Popover>
      {opened === "bar" && step !== undefined ? (
        <FixBar
          step={step}
          onStep={direction => {
            const to = fixNeighbour(findings, step, direction);
            if (to !== undefined) fix(to);
          }}
          onAll={() => setOpened("list")}
          onClose={close}
        />
      ) : null}
    </span>
  );
}
