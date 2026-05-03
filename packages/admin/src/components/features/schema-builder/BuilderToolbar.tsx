// Why: top-of-page toolbar for the new builder. Matches the admin
// page-header convention (breadcrumb + title + right-aligned size="sm"
// actions). Per-kind action visibility is config-driven (Hooks hidden
// for Components). Code-first preservation surfaces here as:
//   - Source badge (Code / UI) when source is passed.
//   - Save schema disabled with a tooltip reason when locked.
//   - Settings button disabled when locked (a future "view settings"
//     read-only flow is planned but out of PR 1 scope).
//
// Save schema is also disabled when nothing is dirty so users don't
// trigger a no-op preview.
import { Button } from "@revnixhq/ui";

import type { BuilderConfig } from "./builder-config";
import {
  CollectionSourceBadge,
  type CollectionSource,
} from "./CollectionSourceBadge";

type Props = {
  config: BuilderConfig;
  name: string;
  /** Lucide icon name (e.g., "FileText"). First letter is shown as a fallback tile. */
  icon: string;
  /** Number of unsaved field changes. Drives Save-schema enable + count badge. */
  unsavedCount: number;
  /** Source of the collection/single/component (Code / UI). Shows the source badge. */
  source?: CollectionSource;
  /** True when the entity is code-first / locked from UI edits. */
  locked?: boolean;
  onOpenSettings: () => void;
  onOpenHooks?: () => void;
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
  icon,
  unsavedCount,
  source,
  locked = false,
  onOpenSettings,
  onOpenHooks,
  onSave,
}: Props) {
  const saveDisabled = unsavedCount === 0 || locked;
  const lockedTitle = locked
    ? "This collection is managed in code. Edit fields by updating the config file."
    : undefined;

  return (
    <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 border-b border-border bg-background">
      <div className="flex items-center gap-2 min-w-0">
        <div
          className="w-8 h-8 rounded-md bg-primary/10 border border-primary/25 flex items-center justify-center text-primary text-xs"
          aria-hidden
        >
          {icon.slice(0, 1)}
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground truncate">
            {KIND_BREADCRUMB[config.kind]} /
          </div>
          <div className="text-xl font-semibold tracking-tight truncate">
            {name}
          </div>
        </div>
        {source && <CollectionSourceBadge source={source} className="ml-2" />}
        {unsavedCount > 0 && (
          <span
            aria-label={`${unsavedCount} unsaved changes`}
            className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300"
          >
            {unsavedCount}
          </span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={locked}
          title={lockedTitle}
          onClick={onOpenSettings}
        >
          Settings
        </Button>
        {config.toolbar.showHooks && onOpenHooks && (
          <Button
            variant="outline"
            size="sm"
            disabled={locked}
            title={lockedTitle}
            onClick={onOpenHooks}
          >
            Hooks
          </Button>
        )}
        <Button
          size="sm"
          disabled={saveDisabled}
          title={lockedTitle}
          onClick={onSave}
        >
          Save schema
        </Button>
      </div>
    </div>
  );
}
