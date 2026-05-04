// Why: simplified toolbar per feedback Section 2.
// - Dropped source badge (CollectionSourceBadge) -- code-first awareness
//   moves to a tooltip on the disabled Save Schema button instead of a
//   visible chip.
// - Dropped the icon tile (the first-letter square next to the name).
// - Dropped the Hooks button (UI removal per Q3 in PR D plan).
// - Dropped the unsaved-count badge entirely (Mobeen 2026-05-03). The
//   Save Schema button's enabled state is the only unsaved signal now.
import { Button } from "@revnixhq/ui";

import { Save, Settings } from "@admin/components/icons";

import type { BuilderConfig } from "./builder-config";

type Props = {
  config: BuilderConfig;
  name: string;
  /** Number of unsaved field changes. Drives Save-schema enable state only;
   *  the visible badge was removed in PR D (Mobeen 2026-05-03). */
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
  const lockedTitle = locked
    ? "This collection is managed in code. Edit fields by updating the config file."
    : undefined;

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
      <div className="flex items-center gap-2 min-w-0">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground truncate">
            {KIND_BREADCRUMB[config.kind]} /
          </div>
          <div className="text-xl font-semibold tracking-tight truncate">
            {name}
          </div>
        </div>
        {/* Why: unsaved-count badge fully removed in PR D (Mobeen 2026-05-03).
            Save Schema button enable state is the only signal. */}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="outline"
          size="icon-sm"
          disabled={locked}
          title={lockedTitle}
          onClick={onOpenSettings}
          aria-label="Settings"
        >
          <Settings className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          disabled={saveDisabled}
          title={lockedTitle}
          onClick={onSave}
        >
          <Save className="h-4 w-4" />
          Save
        </Button>
      </div>
    </div>
  );
}
