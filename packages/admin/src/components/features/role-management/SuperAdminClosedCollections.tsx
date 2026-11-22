"use client";

/**
 * The super-admin role's Permissions section: the line saying what the role
 * holds, naming the collections closed to it, and each collection's mark,
 * which a super-admin changes by entering their password again.
 *
 * A collection whose code sets the mark shows it and cannot be changed here.
 * The change is sent to `PATCH /roles/screen/closed-to-super-admin`, which
 * checks the password before anything changes and writes the audit row.
 */

import { Label, Switch } from "@nextlyhq/ui";
import { useState, type JSX } from "react";

import {
  collectionName,
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

/** The sentence naming what the role holds, and what is closed to it. */
function holdsLine(closed: readonly MarkedCollection[]): string {
  if (closed.length === 0) {
    return "Super-admins have every permission, including new collections and plugins. This role can't be edited.";
  }
  return `Super-admins have every permission, including new collections and plugins, except the collections closed to them: ${closed
    .map(collectionName)
    .join(", ")}. This role can't be edited.`;
}

/** One collection's row: its name, where its mark is set, and its switch. */
function MarkRow({
  collection,
  busy,
  onChange,
}: {
  collection: MarkedCollection;
  busy: boolean;
  onChange: (closed: boolean) => void;
}): JSX.Element {
  const setInCode = collection.closedToSuperAdmin.setIn === "code";
  const id = `closed-to-super-admin-${collection.slug}`;
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2">
      <Label htmlFor={id} className="flex flex-col gap-0.5">
        <span className="text-sm text-foreground">
          {collectionName(collection)}
        </span>
        {setInCode && (
          <span className="text-xs text-muted-foreground">Set in code</span>
        )}
      </Label>
      <Switch
        id={id}
        checked={collection.closedToSuperAdmin.closed}
        disabled={setInCode || busy}
        onCheckedChange={(next: boolean) => onChange(next)}
      />
    </li>
  );
}

export function SuperAdminClosedCollections(): JSX.Element {
  const screen = useMarkedCollections();
  const [pending, setPending] = useState<PendingChange | null>(null);
  const change = useChangeClosedMark(() => setPending(null));

  const collections = screen.data ?? [];
  const closed = collections.filter(c => c.closedToSuperAdmin.closed);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{holdsLine(closed)}</p>
      {screen.isError && (
        <p className="text-sm text-destructive">
          The collections closed to super-admins could not be loaded.
        </p>
      )}
      {collections.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-foreground">
            Closed to super-admins
          </h3>
          <p className="text-sm text-muted-foreground">
            A closed collection&apos;s entries are refused to every super-admin
            and full-access key, including yours. Changing one asks for your
            password and is recorded in the audit log.
          </p>
          <ul className="divide-y divide-border rounded-md border border-border">
            {collections.map(collection => (
              <MarkRow
                key={collection.slug}
                collection={collection}
                busy={change.isPending}
                onChange={next => setPending({ collection, closed: next })}
              />
            ))}
          </ul>
        </div>
      )}

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
        onCancel={() => setPending(null)}
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
