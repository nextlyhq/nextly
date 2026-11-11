// Simplified toolbar: no icon tile, no Hooks button. The number of unsaved
// changes is shown at all times, beside the Undo, Redo and Discard all that
// act on them.
//
// Code-first entities show a "Read-only" badge next to the name. Their Save
// stays disabled, but Settings stays enabled so the config can be inspected
// read-only.
import { Badge, Button } from "@nextlyhq/ui";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { JSX } from "react";

import { Lock, Plus, Settings } from "@admin/components/icons";
import { ROUTES } from "@admin/constants/routes";
import type { BuilderPendingChanges } from "@admin/hooks/useBuilderEntityState";

// Prose names the kind through the shared table, so the toolbar spells each
// kind as every other builder message does.
import { BUILDER_KIND_NOUN, type BuilderConfig } from "./builder-config";
import { PendingChangesControls } from "./PendingChangesControls";

type Props = {
  config: BuilderConfig;
  name: string;
  /** Number of unsaved changes: shown, and what enables Save. */
  unsavedCount: number;
  /** The pending changes Undo, Redo and Discard all act on. */
  pending: BuilderPendingChanges;
  /** True when the entity is code-first / locked from UI edits. */
  locked?: boolean;
  /** Opens the field picker for a field at the end of the list. */
  onAddField: () => void;
  onOpenSettings: () => void;
  onSave: () => void;
};

/**
 * The list a kind's entities are gathered in, as a sentence names it:
 * "collections", "Singles", "field groups". Derived from the kind's noun so
 * the crumb and its label spell the kind as every other message does.
 */
function kindListName(kind: BuilderConfig["kind"]): string {
  return `${BUILDER_KIND_NOUN[kind]}s`;
}

/** The crumb starts a line, so its first letter is capitalised. */
function kindBreadcrumb(kind: BuilderConfig["kind"]): string {
  const name = kindListName(kind);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Where the breadcrumb leads — the builder list this entity was opened from. */
const KIND_LIST_ROUTE: Record<BuilderConfig["kind"], string> = {
  collection: ROUTES.BUILDER_COLLECTIONS,
  single: ROUTES.BUILDER_SINGLES,
  "field-group": ROUTES.BUILDER_FIELD_GROUPS,
};

export function BuilderToolbar({
  config,
  name,
  unsavedCount,
  pending,
  locked = false,
  onAddField,
  onOpenSettings,
  onSave,
}: Props): JSX.Element {
  const saveDisabled = unsavedCount === 0 || locked;
  const lockedSaveTitle = locked
    ? `This ${BUILDER_KIND_NOUN[config.kind]} is managed in code. Update its definition in code to make changes.`
    : undefined;

  return (
    <div className="flex items-center gap-3 px-6 py-3 border-b border-border sticky top-0 z-30 bg-background">
      <div className="flex items-center gap-3 min-w-0">
        {/* The crumb is a LINK, not a label: builder pages render standalone
            (no dashboard sidebar), so on a phone this is the only way back to
            the list — plain text left the reader stranded after saving. */}
        <Link
          href={KIND_LIST_ROUTE[config.kind]}
          className="flex items-center gap-0.5 min-w-0 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={`Back to ${kindListName(config.kind)}`}
        >
          <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="text-xs truncate">
            {kindBreadcrumb(config.kind)} /
          </span>
        </Link>
        <div className="min-w-0">
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
        <PendingChangesControls
          pending={pending}
          count={unsavedCount}
          locked={locked}
        />
        {/* Adding is an edit, so a read-only entity has no add here. */}
        {!locked && (
          // Icon only on a phone, so the entity's name keeps its room; the
          // label stays its accessible name at every width.
          <Button
            variant="outline"
            size="sm"
            aria-label="Add field"
            onClick={onAddField}
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Add field</span>
          </Button>
        )}
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
          Save
        </Button>
      </div>
    </div>
  );
}
