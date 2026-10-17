"use client";

// What the schema change does to fields that stop being translated: how many values in which
// languages move to the localization archive, which language becomes the shared value, and the
// command that brings the others back. A field that cannot leave translation in one change shows
// why instead, and the dialog does not offer Apply.

import { Badge, Button } from "@nextlyhq/ui";

import { AlertTriangle, Check, Copy } from "@admin/components/icons";
import { useCopyToClipboard } from "@admin/hooks/useCopyToClipboard";
import type { SchemaPreviewLeavingTranslation } from "@admin/services/schemaApi";

/** A language's name in English, or its code when the runtime cannot name it. */
function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** "12 Spanish and 3 Arabic values move to the archive." */
function movesSentence(field: SchemaPreviewLeavingTranslation): string {
  if (field.total === 0) return "No other language has a value to archive.";
  const parts = Object.entries(field.byLocale)
    .sort(([, a], [, b]) => b - a)
    .map(
      ([locale, count]) => `${count.toLocaleString()} ${languageName(locale)}`
    );
  const list = new Intl.ListFormat("en", { type: "conjunction" }).format(parts);
  return `${list} ${field.total === 1 ? "value moves" : "values move"} to the archive.`;
}

const STEP_COUNTS = ["", "one step", "two steps", "three steps", "four steps"];

/**
 * Why a field cannot leave translation in this change, and the steps that get there instead.
 * Set in the body's own colour with one warning icon rather than all in red: it is a way
 * forward to follow, not an error to read past.
 */
function RefusalSteps({
  refusal,
}: {
  refusal: NonNullable<SchemaPreviewLeavingTranslation["refusal"]>;
}) {
  const count =
    STEP_COUNTS[refusal.steps.length] ?? `${refusal.steps.length} steps`;
  return (
    <div className="flex items-start gap-2">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-600 dark:text-warning-500" />
      <div className="space-y-1.5">
        <p>
          {/* The field is named on the badge row above, so the lead does not repeat it. */}
          <strong>Needs {count}</strong>
        </p>
        <p>{refusal.reason}</p>
        <ol className="list-decimal space-y-0.5 pl-5">
          {refusal.steps.map(step => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function RestoreCommand({ command }: { command: string }) {
  const { copied, copy } = useCopyToClipboard(command);
  return (
    <div className="flex items-center gap-2">
      {/* On one line, scrolled rather than wrapped: a command broken across lines reads as two. */}
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre rounded-sm border border-border bg-primary/5 px-2 py-1.5 font-mono text-xs">
        {command}
      </code>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy the restore command"}
        className="shrink-0"
      >
        {copied ? (
          <Check className="h-4 w-4 text-success" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}

export function LeavingTranslationNotice({
  fields,
}: {
  fields: readonly SchemaPreviewLeavingTranslation[];
}) {
  if (fields.length === 0) return null;
  return (
    <div className="space-y-3 rounded-md border border-border bg-primary/5 p-3">
      {fields.map(field => (
        <div
          key={field.name}
          className="space-y-1.5 text-sm [&+&]:border-t [&+&]:border-border [&+&]:pt-3"
        >
          <div className="flex items-center gap-2.5">
            {/* The Builder's control is "Localized", so the badge and the steps say the same. */}
            <Badge variant="primary">no longer localized</Badge>
            <strong>{field.name}</strong>
          </div>
          {field.refusal ? (
            <RefusalSteps refusal={field.refusal} />
          ) : (
            <>
              <p className="text-muted-foreground">
                {movesSentence(field)} {languageName(field.defaultLocale)}{" "}
                becomes the shared value.
              </p>
              {field.total > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    To bring them back, make the field translated again, then
                    run:
                  </p>
                  <RestoreCommand command={field.restoreCommand} />
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}
