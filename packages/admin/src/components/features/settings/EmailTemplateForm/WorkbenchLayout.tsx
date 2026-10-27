"use client";

/**
 * The workbench's arrangement at every width.
 *
 * A content column (envelope, body) beside a preview of the email, with
 * settings and test data in a side sheet that makes room beside the preview
 * rather than covering it: the preview is the one thing an author never stops
 * needing to see. How those regions share the width depends on the
 * workbench's own width (`tierFor`):
 *
 * - desktop: content | resize handle | preview, plus the sheet as a third
 *   column when open;
 * - tablet: two equal panes, and an open sheet takes the content's pane, still
 *   beside the preview;
 * - phone: one pane at a time behind Edit, Preview, Data and Details tabs, with
 *   the page's two actions in a bar fixed to the bottom.
 *
 * Measured rather than read from media queries because the admin's navigation
 * takes part of the window, and only the workbench's own width says whether
 * its panes fit.
 */
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@nextlyhq/ui";
import { useEffect, useRef, useState, type ReactNode, type JSX } from "react";

import { X } from "@admin/components/icons";
import { useSuppressAdminChrome } from "@admin/components/layout/ChromeSuppression";
import { useMeasuredWidth } from "@admin/components/shared/preview/useMeasuredWidth";
import { cn } from "@admin/lib/utils";

import { tierFor, type WorkbenchTier } from "./workbench-model";

/** What the side sheet shows. */
export type SheetPanel = "data" | "details";

type PhoneTab = "edit" | "preview" | SheetPanel;

const SHEET_LABELS: Record<SheetPanel, string> = {
  data: "Test data",
  details: "Details",
};

const PHONE_LABELS: Record<PhoneTab, string> = {
  edit: "Edit",
  preview: "Preview",
  data: "Data",
  details: "Details",
};

export interface WorkbenchLayoutProps {
  /** The page header; told the tier, since a phone moves its actions down. */
  header: (tier: WorkbenchTier) => ReactNode;
  /** Notices, the inbox strip, the envelope and the body. */
  content: ReactNode;
  /** The rendered email. */
  preview: ReactNode;
  /** Test data, or null where there is none to give (a layout). */
  data: ReactNode | null;
  /** Everything about the template that isn't its content. */
  details: ReactNode;
  /** Which panel the sheet shows, or null when it's closed. */
  sheet: SheetPanel | null;
  onSheetChange: (sheet: SheetPanel | null) => void;
  /** The phone's bottom bar: the page's primary actions. */
  phoneBar: ReactNode;
  /** Accessible name for the resize handle between content and preview. */
  splitLabel: string;
  /**
   * Where a refused save's message is, raised (`seq`) on each refusal so a
   * repeat refusal shows it again. A phone switches to that tab. A tablet
   * closes its sheet for the editor's fields, since an open sheet takes the
   * editor's pane. Details on a tablet or desktop opens through `sheet`.
   */
  revealRequest: RevealRequest;
}

/** A request to show the panel where a refused save's message is. */
export interface RevealRequest {
  panel: "edit" | "details";
  /** Raised on each request; 0 is none yet. */
  seq: number;
}

/** The side sheet: Data and Details behind one strip of tabs, and a close. */
function Sheet({
  data,
  details,
  sheet,
  onSheetChange,
  className,
}: {
  data: ReactNode | null;
  details: ReactNode;
  sheet: SheetPanel;
  onSheetChange: (sheet: SheetPanel | null) => void;
  className?: string;
}) {
  const panels: SheetPanel[] = data ? ["data", "details"] : ["details"];
  const shown = panels.includes(sheet) ? sheet : "details";
  return (
    <aside
      data-testid="workbench-sheet"
      aria-label={SHEET_LABELS[shown]}
      className={cn("flex min-h-0 min-w-0 flex-col bg-background", className)}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <div
          role="tablist"
          aria-label="Side sheet"
          className="flex flex-1 gap-1"
        >
          {panels.map(panel => (
            <button
              key={panel}
              type="button"
              role="tab"
              aria-selected={panel === shown}
              onClick={() => onSheetChange(panel)}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                panel === shown
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {SHEET_LABELS[panel]}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onSheetChange(null)}
          aria-label="Close the side sheet"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto p-4">
        {shown === "data" ? data : details}
      </div>
    </aside>
  );
}

function PhoneLayout({
  content,
  preview,
  data,
  details,
  phoneBar,
  revealRequest,
}: Pick<
  WorkbenchLayoutProps,
  "content" | "preview" | "data" | "details" | "phoneBar" | "revealRequest"
>) {
  const [tab, setTab] = useState<PhoneTab>("edit");
  useEffect(() => {
    if (revealRequest.seq > 0) setTab(revealRequest.panel);
  }, [revealRequest]);
  const tabs: PhoneTab[] = data
    ? ["edit", "preview", "data", "details"]
    : ["edit", "preview", "details"];
  const panel: Record<PhoneTab, ReactNode> = {
    edit: content,
    preview,
    data: <div className="p-4">{data}</div>,
    details: <div className="p-4">{details}</div>,
  };
  return (
    <>
      <div
        role="tablist"
        aria-label="Workbench"
        className="flex shrink-0 border-b border-border"
      >
        {tabs.map(id => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={id === tab}
            onClick={() => setTab(id)}
            className={cn(
              "flex-1 border-b-2 px-1 py-2.5 text-sm font-medium",
              id === tab
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground"
            )}
          >
            {PHONE_LABELS[id]}
          </button>
        ))}
      </div>
      {/* Bottom padding clears the fixed bar, so the last field scrolls above it. */}
      <div
        role="tabpanel"
        data-testid={`workbench-phone-${tab}`}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-20"
      >
        {panel[tab]}
      </div>
      <div
        data-testid="workbench-phone-bar"
        className="fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t border-border bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] *:flex-1"
      >
        {phoneBar}
      </div>
    </>
  );
}

type BodyProps = Omit<
  WorkbenchLayoutProps,
  "header" | "phoneBar" | "revealRequest"
>;

/** Two equal panes; an open sheet takes the content's, beside the preview. */
function TabletBody({
  content,
  preview,
  data,
  details,
  sheet,
  onSheetChange,
}: BodyProps) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-2">
      {sheet ? (
        <Sheet
          data={data}
          details={details}
          sheet={sheet}
          onSheetChange={onSheetChange}
          className="border-r border-border"
        />
      ) : (
        <div
          data-testid="workbench-content"
          className="flex min-h-0 min-w-0 flex-col overflow-y-auto"
        >
          {content}
        </div>
      )}
      <div
        data-testid="workbench-preview"
        className="flex min-h-0 min-w-0 flex-col"
      >
        {preview}
      </div>
    </div>
  );
}

/** Content and preview, resizable, with the sheet as a column beside them. */
function DesktopBody({
  content,
  preview,
  data,
  details,
  sheet,
  onSheetChange,
  splitLabel,
}: BodyProps) {
  return (
    <div className="flex min-h-0 flex-1">
      <ResizablePanelGroup
        orientation="horizontal"
        className="min-h-0 min-w-0 flex-1"
      >
        {/* Percentage strings: the library reads a bare number as pixels. */}
        <ResizablePanel id="content" minSize="30%">
          <div
            data-testid="workbench-content"
            className="flex h-full min-h-0 flex-col overflow-y-auto"
          >
            {content}
          </div>
        </ResizablePanel>
        <ResizableHandle withGrip aria-label={splitLabel} />
        <ResizablePanel id="preview" minSize="30%">
          <div
            data-testid="workbench-preview"
            className="flex h-full min-h-0 flex-col"
          >
            {preview}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
      {sheet ? (
        <Sheet
          data={data}
          details={details}
          sheet={sheet}
          onSheetChange={onSheetChange}
          className="w-90 shrink-0 border-l border-border"
        />
      ) : null}
    </div>
  );
}

export function WorkbenchLayout({
  header,
  phoneBar,
  revealRequest,
  ...body
}: WorkbenchLayoutProps): JSX.Element {
  // The settings navigation and the page's padding: a full-width workbench
  // reads them as a mistake rather than as a margin. The header draws the way
  // back, which is what lets a surface take them.
  useSuppressAdminChrome({
    layers: ["subSidebar", "pageFrame"],
    canExit: true,
  });

  const rootRef = useRef<HTMLDivElement>(null);
  const tier = tierFor(useMeasuredWidth(rootRef));
  const { onSheetChange } = body;
  // A tablet's open sheet takes the editor's pane: an editor refusal closes it.
  useEffect(() => {
    if (tier !== "tablet" || revealRequest.seq === 0) return;
    if (revealRequest.panel === "edit") onSheetChange(null);
  }, [revealRequest, tier, onSheetChange]);

  return (
    <div
      ref={rootRef}
      data-tier={tier}
      className="flex h-full min-h-0 min-w-0 flex-col bg-background"
    >
      {header(tier)}
      {tier === "phone" ? (
        <PhoneLayout
          {...body}
          phoneBar={phoneBar}
          revealRequest={revealRequest}
        />
      ) : tier === "tablet" ? (
        <TabletBody {...body} />
      ) : (
        <DesktopBody {...body} />
      )}
    </div>
  );
}
