"use client";

import { Badge, Button } from "@nextlyhq/ui";
import { Suspense, lazy, useId, type JSX } from "react";

import type { TemplateVariableCheck } from "./useTemplateVariables";

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
  check,
  onDeclare,
}: {
  sampleText: string;
  onSampleChange: (v: string) => void;
  onReset: () => void;
  sampleError: string | null;
  check: TemplateVariableCheck;
  /** Declare a variable the template uses; absent where declarations are locked. */
  onDeclare?: (name: string) => void;
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

      <div className="space-y-2" data-testid="variable-check">
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Variable check
        </h4>
        {check.undeclared.length > 0 ? (
          // Full-strength status border so the boundary is perceivable.
          <div
            className="rounded-md border border-warning bg-warning/10 p-3"
            data-testid="undeclared-variables"
          >
            <p className="text-xs text-foreground">Used but not declared:</p>
            <ul className="mt-2 space-y-1.5">
              {check.undeclared.map(variable => (
                <li
                  key={variable.name}
                  className="flex flex-wrap items-center gap-1.5"
                >
                  {variable.paths.map(path => (
                    <Badge
                      key={path}
                      variant="outline"
                      className="font-mono text-xs"
                    >
                      {`{{${path}}}`}
                    </Badge>
                  ))}
                  {onDeclare ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => onDeclare(variable.name)}
                    >
                      Declare {variable.name}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {check.missing.length > 0 ? (
          <div
            className="rounded-md border border-warning bg-warning/10 p-3"
            data-testid="missing-values"
          >
            <p className="text-xs text-foreground">
              No test value and no fallback, so these show blank:
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {check.missing.map(path => (
                <Badge
                  key={path}
                  variant="outline"
                  className="font-mono text-xs"
                >
                  {`{{${path}}}`}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
        {check.undeclared.length === 0 && check.missing.length === 0 ? (
          <p className="rounded-md border border-border bg-muted p-3 text-xs text-muted-foreground">
            Every variable used is declared and has a value.
          </p>
        ) : null}
      </div>
    </div>
  );
}
