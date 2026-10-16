"use client";

// What the schema change does to fields that stop being translated: how many values in which
// languages move to the localization archive, which language becomes the shared value, and the
// command that brings the others back. A field that cannot leave translation in one change shows
// why instead, and the dialog does not offer Apply.

import { Badge, Button } from "@nextlyhq/ui";

import { Check, Copy } from "@admin/components/icons";
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

function RestoreCommand({ command }: { command: string }) {
  const { copied, copy } = useCopyToClipboard(command);
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 overflow-x-auto rounded-sm border border-border bg-primary/5 px-2 py-1.5 font-mono text-xs break-all">
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
            <Badge variant={field.refusal ? "destructive" : "primary"}>
              no longer translated
            </Badge>
            <strong>{field.name}</strong>
          </div>
          {field.refusal ? (
            <p className="text-xs text-destructive">{field.refusal}</p>
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
