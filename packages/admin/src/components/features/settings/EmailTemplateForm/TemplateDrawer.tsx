"use client";

/**
 * Region 06 — instruments, not settings.
 *
 * Sample data is not configuration: it is never saved with the template and
 * exists only to exercise the preview. Grouping it with the delivery settings,
 * as the old rail did, put a throwaway JSON blob beside the provider a real
 * message will be sent through.
 *
 * Collapsed it costs one strip, so the panes keep the height. Open, the JSON
 * gets the full width of the editor rather than a 320px column — which is what
 * a nested object needed and never had.
 */
import { Button } from "@nextlyhq/ui";

import { ChevronDown, ChevronUp } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import { DataRail } from "./DataRail";

export function TemplateDrawer({
  open,
  onOpenChange,
  sampleText,
  onSampleChange,
  onReset,
  sampleError,
  unknownVariables,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleText: string;
  onSampleChange: (v: string) => void;
  onReset: () => void;
  sampleError: string | null;
  unknownVariables: string[];
}) {
  return (
    <div className={cn("flex flex-col", open && "max-h-[45vh]")}>
      <div className="flex shrink-0 items-center gap-3 px-4 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5" />
          )}
          Sample data
        </Button>
        {unknownVariables.length > 0 ? (
          <button
            type="button"
            onClick={() => onOpenChange(true)}
            className="text-xs text-warning hover:underline"
          >
            {unknownVariables.length} unknown variable
            {unknownVariables.length === 1 ? "" : "s"}
          </button>
        ) : null}
        {sampleError ? (
          <span className="text-xs text-destructive">Invalid JSON</span>
        ) : null}
      </div>
      {open ? (
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-border p-4">
          <DataRail
            sampleText={sampleText}
            onSampleChange={onSampleChange}
            onReset={onReset}
            sampleError={sampleError}
            unknownVariables={unknownVariables}
          />
        </div>
      ) : null}
    </div>
  );
}
