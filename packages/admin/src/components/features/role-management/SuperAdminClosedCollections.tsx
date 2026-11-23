"use client";

/**
 * The super-admin role's Permissions section: what the role holds, and which
 * collections are closed to it, each with its mark.
 *
 * Closed collections come first and say so in words, not only by the switch,
 * so a long list reads at a glance. A collection whose code sets the mark
 * shows it and cannot be changed here; any other is changed through a dialog
 * that asks for the super-admin's password again
 * (`PATCH /roles/screen/closed-to-super-admin`, which checks it before
 * anything changes and writes the audit row).
 */

import { Badge, Label, Switch } from "@nextlyhq/ui";
import { useState, type JSX } from "react";

import {
  collectionName,
  inListOrder,
  refusalText,
  useChangeClosedMark,
  useMarkedCollections,
  type MarkedCollection,
} from "@admin/hooks/useClosedToSuperAdmin";

import { ClosedMarkDialog } from "./ClosedMarkDialog";

/** The change the dialog is asking a password for. */
interface PendingChange {
  collection: MarkedCollection;
  closed: boolean;
}

/** The line under a collection's name: where its mark is set, and whose it is. */
function detailOf(
  collection: MarkedCollection,
  pluginNames: ReadonlyMap<string, string>
): string {
  const parts: string[] = [];
  if (collection.closedToSuperAdmin.setIn === "code") {
    parts.push("Set in code, so it can't be changed here");
  }
  if (collection.plugin) {
    parts.push(
      `From ${pluginNames.get(collection.plugin) ?? collection.plugin}`
    );
  }
  return parts.join(" · ");
}

/** One collection's row: its name, its state in words, and its switch. */
function MarkRow({
  collection,
  pluginNames,
  busy,
  onChange,
}: {
  collection: MarkedCollection;
  pluginNames: ReadonlyMap<string, string>;
  busy: boolean;
  onChange: (closed: boolean) => void;
}): JSX.Element {
  const { closed, setIn } = collection.closedToSuperAdmin;
  const id = `closed-to-super-admin-${collection.slug}`;
  const detail = detailOf(collection, pluginNames);
  const detailId = detail ? `${id}-detail` : undefined;
  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor={id} className="text-sm font-medium text-foreground">
            {collectionName(collection)}
          </Label>
          {closed && <Badge variant="warning">Closed</Badge>}
        </div>
        {detail && (
          <p id={detailId} className="text-sm text-muted-foreground">
            {detail}
          </p>
        )}
      </div>
      <Switch
        id={id}
        checked={closed}
        disabled={setIn === "code" || busy}
        aria-describedby={detailId}
        onCheckedChange={(next: boolean) => onChange(next)}
      />
    </li>
  );
}

export function SuperAdminClosedCollections({
  pluginNames = new Map(),
}: {
  /** Each plugin's name as the admin shows it, by package name. */
  pluginNames?: ReadonlyMap<string, string>;
}): JSX.Element {
  const screen = useMarkedCollections();
  const [pending, setPending] = useState<PendingChange | null>(null);
  const change = useChangeClosedMark(() => setPending(null));

  const collections = inListOrder(screen.data ?? []);
  const closedCount = collections.filter(
    c => c.closedToSuperAdmin.closed
  ).length;
  const ask = (next: PendingChange | null) => {
    // A new request starts without the last one's refusal.
    change.reset();
    setPending(next);
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Super-admins have every permission, including new collections and
        plugins, and the role&apos;s permissions can&apos;t be edited. A
        collection can still be closed to them below.
      </p>

      <section
        aria-labelledby="closed-to-super-admin-heading"
        className="space-y-3"
      >
        <div className="space-y-1">
          <h3
            id="closed-to-super-admin-heading"
            className="text-sm font-medium text-foreground"
          >
            Collections closed to super-admins
          </h3>
          <p className="text-sm text-muted-foreground">
            A closed collection&apos;s entries are refused to every super-admin
            and full-access API key, yours included. Your app&apos;s own server
            code still reads them. Changing one asks for your password and is
            recorded in the audit log.
          </p>
        </div>

        {screen.isLoading && (
          <p className="text-sm text-muted-foreground" role="status">
            Loading collections…
          </p>
        )}
        {screen.isError && (
          <p className="text-sm font-medium text-danger-text" role="alert">
            The collections couldn&apos;t be loaded. Reload the page to try
            again.
          </p>
        )}
        {screen.isSuccess && (
          <>
            <p className="text-sm text-foreground" role="status">
              {closedCount === 0
                ? "No collection is closed to super-admins."
                : `${closedCount} of ${collections.length} collections ${
                    closedCount === 1 ? "is" : "are"
                  } closed to super-admins.`}
            </p>
            {collections.length > 0 && (
              <ul className="divide-y divide-border rounded-md border border-border bg-card">
                {collections.map(collection => (
                  <MarkRow
                    key={collection.slug}
                    collection={collection}
                    pluginNames={pluginNames}
                    busy={change.isPending}
                    onChange={next => ask({ collection, closed: next })}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <ClosedMarkDialog
        // A new request starts with an empty password field.
        key={
          pending ? `${pending.collection.slug}:${String(pending.closed)}` : ""
        }
        pending={
          pending
            ? {
                name: collectionName(pending.collection),
                closed: pending.closed,
              }
            : null
        }
        saving={change.isPending}
        refusal={refusalText(change.error)}
        onCancel={() => ask(null)}
        onConfirm={password =>
          pending &&
          change.mutate({
            collection: pending.collection.slug,
            closed: pending.closed,
            password,
          })
        }
      />
    </div>
  );
}
