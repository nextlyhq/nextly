"use client";

import { Badge, Button } from "@nextlyhq/ui";
import { Suspense, lazy, useId, type JSX } from "react";

// The admin's code editor, which reads and checks JSON; loaded with the panel.
const CodeMirrorEditor = lazy(() =>
  import(
    "@admin/components/features/entries/fields/text/CodeMirrorEditor"
  ).then(module => ({ default: module.CodeMirrorEditor }))
);

// ============================================================
// Rail: Data tab (sample data + variable check)
// ============================================================

export function DataRail({
  sampleText,
  onSampleChange,
  onReset,
  sampleError,
  unknownVariables,
}: {
  sampleText: string;
  onSampleChange: (v: string) => void;
  onReset: () => void;
  sampleError: string | null;
  unknownVariables: string[];
}): JSX.Element {
  const errorId = useId();
  return (
    <div className="space-y-5">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Sample data
          </h4>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={onReset}
          >
            Reset
          </Button>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">
          JSON that fills the live preview. Not saved with the template.
        </p>
        <div className="rounded-md border border-input">
          <Suspense
            fallback={
              <div
                aria-hidden
                className="h-55 animate-pulse rounded-md bg-muted/30"
              />
            }
          >
            <CodeMirrorEditor
              label="Sample data"
              invalid={Boolean(sampleError)}
              describedBy={sampleError ? errorId : undefined}
              language="json"
              value={sampleText}
              onChange={onSampleChange}
              disabled={false}
              readOnly={false}
              minHeight={220}
              maxHeight={480}
              editorOptions={{
                fontSize: 12,
                lineNumbers: false,
                folding: true,
              }}
            />
          </Suspense>
        </div>
        {sampleError ? (
          <p id={errorId} className="mt-1.5 text-xs text-destructive">
            Invalid JSON: {sampleError}
          </p>
        ) : null}
      </div>

      <div>
        <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Variable check
        </h4>
        {unknownVariables.length > 0 ? (
          // Full-strength status border so the boundary is perceivable.
          <div className="rounded-md border border-warning bg-warning/10 p-3">
            <p className="text-xs text-foreground">
              Used but not declared or sampled (renders blank):
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {unknownVariables.map(n => (
                <Badge key={n} variant="outline" className="font-mono text-xs">
                  {`{{${n}}}`}
                </Badge>
              ))}
            </div>
          </div>
        ) : (
          <p className="rounded-md border border-border bg-muted p-3 text-xs text-muted-foreground">
            All referenced variables are declared or sampled.
          </p>
        )}
      </div>
    </div>
  );
}
