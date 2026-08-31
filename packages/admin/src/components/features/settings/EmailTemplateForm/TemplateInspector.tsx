"use client";

/**
 * Region 05 — configuration that is not the content.
 *
 * Summoned rather than resident. The rail it replaces was a permanent 320px
 * column holding three unrelated things, which is why nine controls competed
 * for the space and the layout picker was hard to find; here the same controls
 * get the full height of the pane and are grouped by the question they answer.
 *
 * Variables live here rather than in the drawer because DECLARING one is
 * configuration — it is a statement about what this template expects — while
 * the sample values that exercise them are an instrument, and those are in the
 * drawer.
 */
import { Button } from "@nextlyhq/ui";

import { X } from "@admin/components/icons";

import type { TemplateFormVariable } from "./schema";
import { SettingsRail, type TemplateSettingsProps } from "./SettingsRail";
import { VariablesRail } from "./VariablesRail";

export function TemplateInspector({
  control,
  isEdit,
  isPending,
  isLayoutRow,
  providers,
  layouts,
  declared,
  onInsert,
  onClose,
}: TemplateSettingsProps & {
  declared: TemplateFormVariable[];
  onInsert: (name: string) => void;
  onClose: () => void;
}) {
  return (
    // Bounded by the PANE, not by the viewport: the splitter allows the preview
    // down to 25% — around 300px at 1280 — and the shell clips the pane, so a
    // viewport-relative maximum lets the inspector's left edge disappear.
    <div className="flex h-full w-[360px] max-w-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-semibold text-foreground">Settings</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Close settings"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
        <SettingsRail
          control={control}
          isEdit={isEdit}
          isPending={isPending}
          isLayoutRow={isLayoutRow}
          providers={providers}
          layouts={layouts}
        />
        {!isLayoutRow && (
          <VariablesRail
            control={control}
            declared={declared}
            onInsert={onInsert}
          />
        )}
      </div>
    </div>
  );
}
