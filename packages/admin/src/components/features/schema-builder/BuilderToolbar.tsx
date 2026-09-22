// Simplified toolbar: no icon tile, no Hooks button, no unsaved-count badge
// (the Save button's enabled state is the only unsaved signal).
//
// Code-first entities show a "Read-only" badge next to the name. Their Save
// stays disabled, but Settings stays enabled so the config can be inspected
// read-only.
import { Badge, Button } from "@nextlyhq/ui";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";

import { Lock, Settings } from "@admin/components/icons";
import { ROUTES } from "@admin/constants/routes";

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
  "field-group": "Field Groups",
};

/** Where the breadcrumb leads — the builder list this entity was opened from. */
const KIND_LIST_ROUTE: Record<BuilderConfig["kind"], string> = {
  collection: ROUTES.BUILDER_COLLECTIONS,
  single: ROUTES.BUILDER_SINGLES,
  "field-group": ROUTES.BUILDER_FIELD_GROUPS,
};

// Singular wording for prose. The kind is a slug, so interpolating it directly
// into a sentence reads as "This field-group is managed in code".
const KIND_NOUN: Record<BuilderConfig["kind"], string> = {
  collection: "collection",
  single: "single",
  "field-group": "field group",
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
    ? `This ${KIND_NOUN[config.kind]} is managed in code. Update its definition in code to make changes.`
    : undefined;

  // The crumb is the page's only exit, and no builder page mounts a
  // navigation guard — a click with unsaved fields would discard them
  // silently. Blocked with a confirm while dirty, same pattern as the
  // settings image-sizes removal.
  const handleCrumbClick = (e: { preventDefault: () => void }) => {
    if (
      unsavedCount > 0 &&
      !window.confirm(
        `You have unsaved changes to this ${KIND_NOUN[config.kind]}. Leave and discard them?`
      )
    ) {
      e.preventDefault();
    }
  };

  return (
    <div className="flex items-center gap-3 px-6 py-3 border-b border-border sticky top-0 z-30 bg-background">
      <div className="flex items-center gap-3 min-w-0">
        {/* The crumb is a LINK, not a label: builder pages render standalone
            (no dashboard sidebar), so on a phone this is the only way back to
            the list — plain text left the reader stranded after saving. */}
        <Link
          href={KIND_LIST_ROUTE[config.kind]}
          onClick={handleCrumbClick}
          className="flex items-center gap-0.5 min-w-0 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={`Back to ${KIND_BREADCRUMB[config.kind]}`}
        >
          <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="text-xs truncate">
            {KIND_BREADCRUMB[config.kind]} /
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
