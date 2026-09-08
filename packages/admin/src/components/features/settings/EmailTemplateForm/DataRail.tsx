"use client";

import { Badge, Button, Textarea } from "@nextlyhq/ui";

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
}) {
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
        <Textarea
          value={sampleText}
          onChange={e => onSampleChange(e.target.value)}
          spellCheck={false}
          className="min-h-[220px] font-mono text-xs"
          aria-invalid={Boolean(sampleError)}
        />
        {sampleError ? (
          <p className="mt-1.5 text-xs text-destructive">
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
