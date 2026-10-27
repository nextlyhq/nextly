"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Skeleton,
} from "@nextlyhq/ui";
import { type JSX, useMemo, useState } from "react";

import {
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Layers,
} from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { useEmailTemplates } from "@admin/hooks/queries/useEmailTemplates";
import type { EmailTemplateRecord } from "@admin/services/emailTemplateApi";

import {
  compareGroups,
  DEFAULT_LAYOUT_SLUG,
  KEPT_HELP,
  KEPT_LABEL,
  ownerGroupOf,
  STATE_HELP,
} from "../messages/messages-model";
import { TemplateActionsMenu } from "../TemplateActionsMenu";
import { editRouteFor, useTemplateActions } from "../useTemplateActions";

import { EmailsByOwner } from "./BrandReachCard";
import { emailsByLayout, plural } from "./design-model";

/** What the Default layout is built from, or that the site changed it. */
function DefaultLayoutBadge({ layout }: { layout: EmailTemplateRecord }) {
  if (layout.overridden) {
    return (
      <Badge
        variant="warning"
        title="Your site's version. The brand settings don't reach it."
      >
        Customised
      </Badge>
    );
  }
  return <Badge variant="outline">Built from brand settings</Badge>;
}

/** The states a layout can be in beside its kind, each with what it means. */
function LayoutBadges({ layout }: { layout: EmailTemplateRecord }) {
  const isDefault = layout.slug === DEFAULT_LAYOUT_SLUG;
  return (
    <>
      <Badge variant="outline">
        {layout.kind === "layout" ? "Layout" : "Partial"}
      </Badge>
      {isDefault && <DefaultLayoutBadge layout={layout} />}
      {!isDefault && layout.overridden && (
        <Badge variant="outline" title={STATE_HELP.customised}>
          Customised
        </Badge>
      )}
      {!layout.isActive && <Badge variant="outline">Off</Badge>}
      {layout.keptOnOldEngine && (
        <Badge variant="warning" title={KEPT_HELP}>
          {KEPT_LABEL}
        </Badge>
      )}
      {layout.ownerChanged && (
        <Badge variant="warning" title={STATE_HELP.update}>
          <ArrowUp className="h-3 w-3" />
          Update available
        </Badge>
      )}
    </>
  );
}

function LayoutName({
  layout,
  canOpen,
}: {
  layout: EmailTemplateRecord;
  canOpen: boolean;
}) {
  if (!canOpen) return <span className="font-medium">{layout.name}</span>;
  return (
    <Link href={editRouteFor(layout)} className="font-medium hover:underline">
      {layout.name}
    </Link>
  );
}

function UsedByToggle({
  count,
  open,
  controls,
  onToggle,
}: {
  count: number;
  open: boolean;
  controls: string;
  onToggle: () => void;
}) {
  if (count === 0) {
    return (
      <span className="text-xs text-muted-foreground">
        Not used by any email yet
      </span>
    );
  }
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
    >
      Used by {plural(count, "email")}
      {open ? (
        <ChevronUp className="h-4 w-4" />
      ) : (
        <ChevronDown className="h-4 w-4" />
      )}
    </Button>
  );
}

function LayoutRow({
  layout,
  usedBy,
  canOpen,
  actions,
}: {
  layout: EmailTemplateRecord;
  /** The emails it wraps; undefined for a partial, which none name. */
  usedBy: EmailTemplateRecord[] | undefined;
  canOpen: boolean;
  actions: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const listId = `layout-used-${layout.id}`;
  return (
    <li className="space-y-3 px-4 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <Layers className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <LayoutName layout={layout} canOpen={canOpen} />
            <LayoutBadges layout={layout} />
          </div>
          {layout.description && (
            <p className="text-sm text-muted-foreground">
              {layout.description}
            </p>
          )}
          <div className="break-all font-mono text-xs text-muted-foreground">
            {layout.slug} · {ownerGroupOf(layout.owner).label}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {usedBy && (
            <UsedByToggle
              count={usedBy.length}
              open={open}
              controls={listId}
              onToggle={() => setOpen(!open)}
            />
          )}
          {canOpen && (
            <Link href={editRouteFor(layout)}>
              <Button type="button" size="sm" variant="outline">
                Open
              </Button>
            </Link>
          )}
          {actions}
        </div>
      </div>
      {open && usedBy && usedBy.length > 0 && (
        <div id={listId} className="pl-7">
          <EmailsByOwner emails={usedBy} canOpen={canOpen} />
        </div>
      )}
    </li>
  );
}

/** An owner's update waiting on layouts the site customised. */
function UpdateNotice({ layouts }: { layouts: EmailTemplateRecord[] }) {
  const one = layouts.length === 1;
  return (
    <Alert variant="info" role="status">
      <AlertTitle>
        {one
          ? "1 layout has an update from its owner"
          : `${layouts.length} layouts have an update from their owner`}
      </AlertTitle>
      <AlertDescription>
        {layouts.map(layout => layout.name).join(", ")} changed since you
        customised {one ? "it" : "them"}. Open {one ? "it" : "each one"} to
        review the change.
      </AlertDescription>
    </Alert>
  );
}

/** Layouts kept as the previous engine sent them. */
function KeptNotice({ layouts }: { layouts: EmailTemplateRecord[] }) {
  const one = layouts.length === 1;
  return (
    <Alert variant="warning" role="status">
      <AlertTitle>
        {one
          ? "1 layout is kept as it was"
          : `${layouts.length} layouts are kept as they were`}
      </AlertTitle>
      <AlertDescription>
        {layouts.map(layout => layout.name).join(", ")} {one ? "holds" : "hold"}{" "}
        text the previous engine sent as written, and every email{" "}
        {one ? "it wraps" : "they wrap"} keeps sending exactly as before until
        someone changes those lines.
      </AlertDescription>
    </Alert>
  );
}

/**
 * Said above the list when a layout is kept on the previous engine or has
 * an owner's update waiting: a kept or changed layout affects every email it
 * wraps, so neither may pass unseen.
 */
function PendingNotices({ layouts }: { layouts: EmailTemplateRecord[] }) {
  const kept = layouts.filter(layout => layout.keptOnOldEngine);
  const updated = layouts.filter(layout => layout.ownerChanged);
  return (
    <>
      {updated.length > 0 && <UpdateNotice layouts={updated} />}
      {kept.length > 0 && <KeptNotice layouts={kept} />}
    </>
  );
}

/**
 * The layouts emails are sent in, each with the emails that use it, and the
 * partials layouts share. A layout opens in the same workbench as an email.
 */
export function LayoutsList(): JSX.Element {
  const {
    data: templates = [],
    isLoading,
    isError,
    error,
  } = useEmailTemplates();
  const { actionsFor, canOpen, dialogs } = useTemplateActions();

  const layouts = useMemo(
    () =>
      templates
        .filter(record => record.kind !== "template")
        .sort(
          (a, b) =>
            compareGroups(ownerGroupOf(a.owner), ownerGroupOf(b.owner)) ||
            a.name.localeCompare(b.name)
        ),
    [templates]
  );
  const usage = useMemo(() => emailsByLayout(templates), [templates]);

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {error?.message ?? "Failed to load layouts. Please try again."}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <section
      aria-labelledby="email-layouts-heading"
      className="space-y-3 rounded-lg border border-border bg-card"
    >
      <div className="border-b border-border p-4">
        <h2 id="email-layouts-heading" className="text-base font-semibold">
          Layouts
        </h2>
        <p className="text-sm text-muted-foreground">
          The frame around an email&apos;s content. Each email picks its layout
          in its settings.
        </p>
      </div>
      <div className="space-y-3 px-4 empty:hidden">
        <PendingNotices layouts={layouts} />
      </div>
      {isLoading ? (
        <Skeleton className="mx-4 mb-4 h-32 rounded-lg" />
      ) : layouts.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">
          No layouts yet.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {layouts.map(layout => (
            <LayoutRow
              key={layout.id}
              layout={layout}
              usedBy={
                layout.kind === "layout"
                  ? (usage.get(layout.id) ?? [])
                  : undefined
              }
              canOpen={canOpen}
              actions={
                <TemplateActionsMenu
                  name={layout.name}
                  actions={actionsFor(layout)}
                />
              }
            />
          ))}
        </ul>
      )}
      {dialogs}
    </section>
  );
}
