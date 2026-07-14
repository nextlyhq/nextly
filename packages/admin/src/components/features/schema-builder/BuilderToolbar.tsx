// Simplified toolbar: no icon tile, no Hooks button, no unsaved-count badge
// (the Save button's enabled state is the only unsaved signal).
//
// Code-first entities show a "Read-only" badge next to the name. Their Save
// stays disabled, but Settings stays enabled so the config can be inspected
// read-only.
import { Badge, Button } from "@nextlyhq/ui";

import { Lock, Save, Settings } from "@admin/components/icons";

import type { BuilderConfig } from "./builder-config";

type Props = {
  config: BuilderConfig;
  name: string;
  /** Number of unsaved field changes. Drives Save-schema enable state only;
   */
  unsavedCount: number;
  /** True when the entity is code-first / locked from UI edits. */
  locked?: boolean;
  onOpenSettings: () => void;
  onSave: () => void;
};

const KIND_BREADCRUMB: Record<BuilderConfig["kind"], string> = {
  collection: "Collections",
  single: "Singles",
  component: "Components",
};

export function BuilderToolbar({
  config,
  name,
  unsavedCount,
  locked = false,
  onOpenSettings,
  onSave,
}: Props) {
  const saveDisabled = unsavedCount === 0 || locked;
  const lockedSaveTitle = locked
    ? `This ${config.kind} is managed in code. Update its definition in code to make changes.`
    : undefined;

  return (
    <div className="flex items-center gap-3 px-6 py-3 border-b border-border sticky top-0 z-30 bg-background">
      <div className="flex items-center gap-3 min-w-0">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground truncate">
            {KIND_BREADCRUMB[config.kind]} /
          </div>
          <div className="text-xl font-semibold tracking-tight truncate">
            {name}
          </div>
        </div>
        {locked && (
          <Badge variant="outline" className="gap-1 shrink-0">
            <Lock className="h-3 w-3" />
            Read-only
          </Badge>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* Settings stays enabled when locked so the config can be viewed
            read-only; only Save is gated. */}
        <Button
          variant="outline"
          size="icon-sm"
          onClick={onOpenSettings}
          aria-label={locked ? "View settings" : "Settings"}
        >
          <Settings className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          disabled={saveDisabled}
          title={lockedSaveTitle}
          onClick={onSave}
        >
          <Save className="h-4 w-4" />
          Save
        </Button>
      </div>
    </div>
  );
}
