"use client";

/**
 * Region 03 — the body being authored.
 *
 * The editor FILLS its pane and scrolls inside it, with no minimum height. It
 * previously carried a 380px floor, which the old layout paired with an outer
 * `overflow-y-auto` so a short viewport scrolled the whole page. The shell gives
 * each pane a definite height and clips it, so a floor taller than the pane
 * makes the editor overflow a box that hides the overflow — and CodeMirror then
 * measures a viewport larger than anything on screen, and will put the caret in
 * the clipped part. Stacked on a laptop, that is the common case, not the edge.
 *
 * Two editors behind one toggle, and the pair carries two invariants that are
 * easy to lose and have no visible symptom when lost:
 *
 * Each tab gets a DISTINCT `key`, so React mounts a fresh Controller per tab.
 * Sharing one, whose `name` flips between `htmlContent` and `plainTextContent`,
 * makes react-hook-form leak and then blank the values after a few toggles.
 *
 * Variable insertion targets whichever body is mounted — see
 * `useVariableInsertion`, which owns that rule.
 */
import type { EditorView } from "@codemirror/view";
import { Suspense, lazy } from "react";
import { useFormState, type useForm } from "react-hook-form";

import { FormField } from "@admin/components/ui/form";

import type { TemplateFormValues } from "./schema";
import { Segmented } from "./Segmented";

// CodeMirror reaches for browser globals on import, so it loads on demand
// rather than during SSR.
const CodeMirrorEditor = lazy(() =>
  import(
    "@admin/components/features/entries/fields/text/CodeMirrorEditor"
  ).then(m => ({ default: m.CodeMirrorEditor }))
);

/**
 * Why a save was refused, for the two body fields.
 *
 * Rendered in the toolbar rather than beside the editor because the editor
 * scrolls: a message under a long template is a message the author has to go
 * looking for, and the refusal they are trying to understand is the reason they
 * cannot save.
 *
 * It also names the OTHER tab when that is where the problem is. The two bodies
 * share one toggle, so an author on the plain-text tab can be blocked by the
 * HTML one with nothing on screen belonging to it.
 */
function BodyRefusal({
  control,
  editorTab,
}: {
  control: ReturnType<typeof useForm<TemplateFormValues>>["control"];
  editorTab: "html" | "text";
}) {
  const { errors } = useFormState({ control });
  const html = errors.htmlContent?.message;
  const text = errors.plainTextContent?.message;

  const active = editorTab === "html" ? html : text;
  const other = editorTab === "html" ? text : html;
  const otherLabel = editorTab === "html" ? "Plain text" : "HTML";

  if (!active && !other) return null;

  return (
    <p className="ml-auto text-xs text-destructive" role="alert">
      {active ?? `${otherLabel}: ${String(other)}`}
    </p>
  );
}

export function BodyEditor({
  control,
  editorTab,
  onEditorTabChange,
  isPending,
  editorWrapRef,
  htmlEditorViewRef,
  chips,
}: {
  control: ReturnType<typeof useForm<TemplateFormValues>>["control"];
  editorTab: "html" | "text";
  onEditorTabChange: (tab: "html" | "text") => void;
  isPending: boolean;
  editorWrapRef: React.RefObject<HTMLDivElement | null>;
  htmlEditorViewRef: React.RefObject<EditorView | null>;
  /** The variable chips, rendered beside the tab toggle. */
  chips?: React.ReactNode;
}) {
  return (
    <>
      {/* Bounded and scrollable. The strip is `shrink-0` and the editor is the
          only child that can give way, so an unbounded strip takes the pane one
          declared variable at a time — and a template with enough of them
          leaves no editor at all. */}
      {/*
        Two rows, and the split is the point. The chip strip is bounded and
        scrolls, because it grows by a row per declared variable and the editor
        is the only thing able to give way. The refusal must NOT be inside that
        scroller: submitting does not scroll it, so with enough chips the alert
        mounts below the visible area and the refused save is silent again —
        which is the failure this alert exists to end.
      */}
      <div className="flex shrink-0 items-center gap-2 px-3 pt-2">
        <Segmented<"html" | "text">
          value={editorTab}
          onChange={onEditorTabChange}
          options={[
            { value: "html", label: "HTML" },
            { value: "text", label: "Plain text" },
          ]}
        />
        <BodyRefusal control={control} editorTab={editorTab} />
      </div>
      {chips ? (
        <div
          data-testid="body-editor-chips"
          className="flex max-h-16 shrink-0 flex-wrap items-center gap-2 overflow-y-auto border-b border-border px-3 pb-2 pt-2"
        >
          {chips}
        </div>
      ) : (
        <div className="shrink-0 border-b border-border pb-2" />
      )}
      {/* Editor body */}
      <div
        ref={editorWrapRef}
        className="html-code-editor min-h-0 flex-1 overflow-auto bg-background"
      >
        {editorTab === "html" ? (
          <FormField
            // Distinct key so React mounts a fresh Controller per tab.
            // Without it, one Controller's `name` would flip between
            // htmlContent/plainTextContent on toggle and react-hook-form
            // leaks/blanks the values after repeated switches.
            key="editor-html"
            control={control}
            name="htmlContent"
            render={({ field }) => (
              <Suspense
                fallback={
                  <div className="h-full w-full animate-pulse bg-muted/30" />
                }
              >
                <CodeMirrorEditor
                  value={field.value ?? ""}
                  onChange={val => {
                    if (!isPending) field.onChange(val);
                  }}
                  onCreateEditor={view => {
                    htmlEditorViewRef.current = view;
                  }}
                  language="html"
                  disabled={isPending}
                  readOnly={false}
                  minHeight={380}
                  editorOptions={{ tabSize: 2 }}
                  placeholder={
                    "<h1>Hello {{userName}}</h1>\n<p>Welcome to {{appName}}.</p>"
                  }
                />
              </Suspense>
            )}
          />
        ) : (
          <FormField
            key="editor-text"
            control={control}
            name="plainTextContent"
            render={({ field }) => (
              <textarea
                {...field}
                value={field.value ?? ""}
                disabled={isPending}
                placeholder="Plain-text fallback sent alongside the HTML…"
                className="h-full w-full resize-none bg-background p-3.5 font-mono text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
              />
            )}
          />
        )}
      </div>
    </>
  );
}
