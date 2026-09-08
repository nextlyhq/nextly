"use client";

/**
 * Translation mode: the language being edited, beside the language it is being
 * translated from.
 *
 * A WRAPPER rather than a second editor. The document being edited stays exactly
 * the form it already was — same RHF context, same unsaved-changes guard, same
 * autosave, same save intent — and this puts a read-only source beside it. The
 * alternative, a route of its own, would duplicate every one of those and the
 * guard would have to learn a second address.
 *
 * Inactive it renders `children` and nothing else: no wrapper element, no
 * suppression request, no extra DOM. A document with no source to show is the
 * ordinary editor, unchanged, and that has to be true structurally rather than
 * by the styles happening to agree.
 *
 * The source pane is a SIBLING of `children` rather than inside it, so it never
 * joins the target's form context — which matters because `useFormContext`
 * binds to the nearest provider, and a source rendered inside the target's form
 * would read and write the document being edited.
 *
 * ## Why this component owns the chrome request
 *
 * `useSuppressAdminChrome` grants `primaryRail` — the whole of the admin's
 * navigation — only to a request carrying `canExit: true`, per REQUEST, and the
 * rail is otherwise the only way out. So the component that takes the rail is
 * the component that must render the way back, and keeping both here means the
 * invariant cannot be broken by a caller that forgets: there is no arrangement
 * of props that suppresses the rail without also rendering Exit.
 *
 * @module components/features/entries/TranslationMode/TranslationPanes
 */

import type { Control, FieldValues } from "react-hook-form";

import { useSuppressAdminChrome } from "@admin/components/layout/ChromeSuppression";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@admin/components/ui";
import { cn } from "@admin/lib/utils";

import { SourceDocumentPane } from "./SourceDocumentPane";
import type { SourcePaneDocument } from "./SourceDocumentPane";
import { TranslationFieldProvider } from "./TranslationFieldContext";
import { TranslationProgress } from "./TranslationProgress";

export interface TranslationPanesProps {
  /**
   * The source to show, or undefined to render `children` alone.
   *
   * Undefined is the ordinary editor. It covers every reason there is no source
   * — mode off, an unconfigured language in the URL, a source that is the
   * language already being edited — because none of them is a different screen.
   */
  source: SourcePaneDocument | undefined;
  /**
   * Leave the mode, keeping the language being edited.
   *
   * Optional so a caller that cannot leave — a test harness, a surface still
   * being wired — needs no placeholder of its own. It defaults to a no-op HERE
   * rather than at each call site, which is what keeps `canExit: true` honest:
   * the exit is always rendered, so the rail is never surrendered to a surface
   * with no button at all.
   */
  onExit?: (() => void) | undefined;
  /** The editor. Rendered in the target pane when the mode is on. */
  children: React.ReactNode;
  /**
   * The target form's control, so the bar can report how far along this
   * language is as the translator types.
   *
   * The control rather than a rendered node: both editors were assembling the
   * same progress element at the call site, derivation and all. Reading a form
   * here is safe — the bar must contain nothing that WRITES, which is a
   * different rule and one `useWatch` does not break.
   */
  control?: Control<FieldValues> | undefined;
}

export function TranslationPanes({
  source,
  onExit = () => {},
  children,
  control,
}: TranslationPanesProps) {
  return source ? (
    <ActivePanes source={source} onExit={onExit} control={control}>
      {children}
    </ActivePanes>
  ) : (
    <>{children}</>
  );
}

/**
 * The mode itself, mounted only while there is a source.
 *
 * A separate component so the chrome request below runs only when the mode is
 * on. Calling the hook from the wrapper above would ask the admin to hide its
 * navigation for every localized document, in the mode or not — the same reason
 * `BlocksField` splits its editor out from its control.
 */
function ActivePanes({
  source,
  onExit,
  children,
  control,
}: {
  source: SourcePaneDocument;
  onExit: () => void;
  children: React.ReactNode;
  control?: Control<FieldValues> | undefined;
}) {
  // `documentSidebar` is deliberately absent: this asks for the admin's
  // furniture, and the editor's own rail is the document's, collapsed through
  // the form's own control rather than taken away from underneath it.
  useSuppressAdminChrome({
    layers: ["primaryRail", "subSidebar", "header", "pageFrame"],
    canExit: true,
  });

  return (
    <div className="flex h-dvh flex-col">
      <ModeBar source={source} onExit={onExit} control={control} />
      {/* Sizes are PERCENTAGE STRINGS, and that is load-bearing rather than a
          style choice: this library reads a bare number as PIXELS, so
          `defaultSize={40}` is a 40-pixel pane. A layout in pixels is also
          wrong on the next monitor, where a relative one survives a resize.

          Source LEFT because it is read first and the target is where the work
          happens — the pane ORDER is reading order for the SCREEN, not for
          either language, so an RTL target does not move it. */}
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel id="translation-source" minSize="25%" defaultSize="40%">
          <SourceDocumentPane source={source} />
        </ResizablePanel>
        <ResizableHandle withGrip aria-label="Source and translation" />
        <ResizablePanel id="translation-target" minSize="30%">
          {/* A container of its own, and this is the whole of the editor's
              layout adaptation. `@container/content` is declared on the
              dashboard's `<main>`, which stays full-page width — so without
              this every `@4xl/content:` query inside the editor measures the
              PAGE while rendering into half of it, and the 320px document rail
              is laid out beside a main column that no longer has room for it.
              Naming the container here makes those queries measure the PANE, so
              the editor responds exactly as it already does at a narrow window:
              the rail hides and its language panel takes over inline. No
              translation-mode branch anywhere in the form. */}
          <div className="@container/content h-full overflow-y-auto">
            {/* The pane stands in for `PageContainer`, so it owes the same
                horizontal inset — and stops owing it at the same width. The
                editor's two columns go edge-to-edge from `@4xl`, so the padding
                ends there rather than being applied and then cancelled by a
                negative margin inside the editor. Cancellation is what made
                this fragile: the margin cannot see whether its container padded,
                so the same class was right here and 64px too wide on a measured
                page, where the inset is spent as grid columns instead.

                On an INNER element, deliberately: the container is declared
                above, and an element cannot query itself — padding written up
                there would resolve against the page and reintroduce exactly the
                mismatch this fixes. */}
            {/* The per-field source, provided around the TARGET alone. The
                source pane is a sibling, so its own fields read the default and
                offer nothing — a field cannot fill itself from itself. */}
            <TranslationFieldProvider
              value={{
                sourceValues: source.values,
                sourceLabel: source.sourceLabel,
              }}
            >
              <div className="px-4 @sm/content:px-6 @2xl/content:px-8 @4xl/content:px-0">
                {children}
              </div>
            </TranslationFieldProvider>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

/**
 * The one strip of chrome the mode owns: what is being translated, and the way
 * out.
 *
 * Save and Publish are deliberately NOT here. They belong to the document being
 * edited and already live in its own header, inside the target pane — moving
 * them up here would put a save control outside the form it saves, and the
 * suppression request above is what makes this bar the only furniture left.
 */
function ModeBar({
  source,
  onExit,
  control,
}: {
  source: SourcePaneDocument;
  onExit: () => void;
  control?: Control<FieldValues> | undefined;
}) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border bg-background px-4 py-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Translating
      </span>
      <span className="text-sm font-medium text-foreground">
        {source.targetLabel}
      </span>
      <span className="text-xs text-muted-foreground">from</span>
      <span className="text-sm font-medium text-foreground">
        {source.sourceLabel}
      </span>
      <span className="flex-1" />
      {control && (
        <TranslationProgress control={control} fields={source.fields} />
      )}
      <button
        type="button"
        onClick={onExit}
        className={cn(
          "inline-flex h-8 items-center rounded-md border border-border bg-background px-3",
          "text-xs font-medium text-foreground transition-colors",
          "hover:bg-accent hover:text-accent-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
      >
        Exit translation mode
      </button>
    </div>
  );
}
