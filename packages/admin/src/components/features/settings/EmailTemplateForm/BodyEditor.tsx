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
import type { useForm } from "react-hook-form";

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
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Segmented<"html" | "text">
          value={editorTab}
          onChange={onEditorTabChange}
          options={[
            { value: "html", label: "HTML" },
            { value: "text", label: "Plain text" },
          ]}
        />
        {chips}
      </div>
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
