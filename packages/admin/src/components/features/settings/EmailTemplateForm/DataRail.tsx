"use client";

import { Badge, Button } from "@nextlyhq/ui";
import { Suspense, lazy, useId, useState, type JSX } from "react";

import { DataFields } from "./DataFields";
import { RealRecordPicker } from "./RealRecordPicker";
import type { SampleDeclaration } from "./sample-data";
import { Segmented } from "./Segmented";
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

/** How the test data is edited: as fields, or as the JSON it is. */
type DataView = "fields" | "json";

interface TestDataProps {
  /** The test data as JSON: as typed, or the data written out. */
  sampleText: string;
  sampleData: Record<string, unknown>;
  /** The declared variables, which the fields are drawn from. */
  variables: ReadonlyArray<SampleDeclaration & { description?: string }>;
  onFieldChange: (name: string, value: unknown) => void;
  onJsonChange: (json: string) => void;
  onReset: () => void;
  sampleError: string | null;
  /** The saved template, whose owner may offer real records; absent for a new one. */
  templateId?: string;
  /** Fill the test data from a real record's values. */
  onRecord?: (values: Record<string, unknown>) => void;
}

export function DataRail({
  check,
  onDeclare,
  ...testData
}: TestDataProps & {
  check: TemplateVariableCheck;
  /** Declare a variable the template uses; absent where declarations are locked. */
  onDeclare?: (name: string) => void;
}): JSX.Element {
  return (
    <div className="space-y-5">
      <TestData {...testData} />
      <VariableCheck check={check} onDeclare={onDeclare} />
    </div>
  );
}

/** The test data, as a field per declared variable or as its JSON. */
function TestData({
  sampleText,
  sampleData,
  variables,
  onFieldChange,
  onJsonChange,
  onReset,
  sampleError,
  templateId,
  onRecord,
}: TestDataProps): JSX.Element {
  const [view, setView] = useState<DataView>("fields");
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Test data
        </h4>
        <div className="flex items-center gap-1.5">
          <Segmented<DataView>
            options={[
              { value: "fields", label: "Fields" },
              { value: "json", label: "JSON" },
            ]}
            value={view}
            onChange={setView}
          />
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
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        Fills the live preview and a test send. Not saved with the template.
      </p>
      {templateId && onRecord ? (
        <RealRecordPicker templateId={templateId} onLoaded={onRecord} />
      ) : null}
      {view === "json" ? (
        <JsonEditor
          sampleText={sampleText}
          sampleError={sampleError}
          onJsonChange={onJsonChange}
        />
      ) : sampleError ? (
        <p className="rounded-md border border-destructive p-3 text-xs text-destructive">
          The JSON doesn&apos;t parse, so the fields can&apos;t show it. Fix it
          in JSON, or Reset.
        </p>
      ) : (
        <DataFields
          variables={variables}
          data={sampleData}
          onChange={onFieldChange}
        />
      )}
    </div>
  );
}

/** The test data as the JSON it is, checked as it is typed. */
function JsonEditor({
  sampleText,
  sampleError,
  onJsonChange,
}: Pick<
  TestDataProps,
  "sampleText" | "sampleError" | "onJsonChange"
>): JSX.Element {
  const errorId = useId();
  return (
    <>
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
            label="Test data"
            invalid={Boolean(sampleError)}
            describedBy={sampleError ? errorId : undefined}
            language="json"
            value={sampleText}
            onChange={onJsonChange}
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
    </>
  );
}

/** What the check found nothing wrong with, as far as it looked. */
const ALL_CLEAR: Record<TemplateVariableCheck["blanks"], string> = {
  checked: "Every variable used is declared and has a value.",
  loading: "Every variable used is declared. Checking for blank values…",
  kept: "Every variable used is declared. Blank values aren't checked for an email kept on its first engine.",
  unavailable:
    "Every variable used is declared. Blank values couldn't be checked.",
};

/** The variables the template uses but doesn't declare, and those left blank. */
function VariableCheck({
  check,
  onDeclare,
}: {
  check: TemplateVariableCheck;
  onDeclare?: (name: string) => void;
}): JSX.Element {
  return (
    <div className="space-y-2" data-testid="variable-check">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Variable check
      </h4>
      {check.undeclared.length > 0 ? (
        // Full-strength status border so the boundary is perceivable.
        <div
          className="rounded-md border border-warning-border bg-warning-surface p-3"
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
          className="rounded-md border border-warning-border bg-warning-surface p-3"
          data-testid="missing-values"
        >
          <p className="text-xs text-foreground">
            No test value and no fallback, so these show blank:
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {check.missing.map(path => (
              <Badge key={path} variant="outline" className="font-mono text-xs">
                {`{{${path}}}`}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}
      {check.undeclared.length === 0 && check.missing.length === 0 ? (
        <p className="rounded-md border border-border bg-muted p-3 text-xs text-muted-foreground">
          {ALL_CLEAR[check.blanks]}
        </p>
      ) : null}
    </div>
  );
}
