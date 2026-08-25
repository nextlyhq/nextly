"use client";

/**
 * Picks the document a form redirects to after submission.
 *
 * The plugin cannot reach the admin's own relationship input: `@nextlyhq/admin`
 * is not on the plugin import boundary, and `plugin-sdk/admin` does not
 * re-export it. This is the narrow version of that control — one value, chosen
 * from the collections the site configured as redirect targets.
 *
 * @module admin/components/builder/RedirectPagePicker
 */

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import { useEffect, useState } from "react";

import { parseRedirectReference } from "../../../utils/redirect-reference";

/** One selectable document, reduced to what the control shows and stores. */
interface Choice {
  collection: string;
  id: string;
  label: string;
}

interface RedirectPagePickerProps {
  /** Collections configured as redirect targets, in configuration order. */
  collections: readonly string[];
  /** The stored relationship value, in whatever shape it was saved. */
  value: unknown;
  onChange: (next: { relationTo: string; value: string } | undefined) => void;
}

/**
 * The document a stored value points at, as `collection:id`.
 *
 * The reading is `parseRedirectReference`, not a second copy of it: the picker
 * and the submit handler have to agree about which document a stored value
 * names, and two readers that agree today would drift — silently, because a
 * control showing the wrong page still shows a page.
 */
export function selectionKey(
  value: unknown,
  collections: readonly string[]
): string | undefined {
  const reference = parseRedirectReference(value, collections);
  return reference ? `${reference.collection}:${reference.id}` : undefined;
}

/** What to call a document in the list, preferring what an author would recognise. */
export function documentLabel(row: Record<string, unknown>): string {
  for (const field of ["title", "name", "label", "slug"]) {
    const candidate = row[field];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return typeof row.id === "string" ? row.id : "Untitled";
}

export function RedirectPagePicker({
  collections,
  value,
  onChange,
}: RedirectPagePickerProps) {
  const [choices, setChoices] = useState<Choice[] | null>(null);

  // `collections` is an array prop, so a new identity every render would
  // refetch forever; the join is the value that actually decides the request.
  const key = collections.join(",");

  useEffect(() => {
    let cancelled = false;
    const wanted = key ? key.split(",") : [];

    Promise.all(
      wanted.map(async (collection): Promise<Choice[]> => {
        try {
          // `limit`, not `pageSize` — the other name is accepted and ignored,
          // leaving the default of 10. `status=all` because a form is usually
          // configured alongside the page it points at: filtering to published
          // only shows "publish one first" while the page sits in the next tab,
          // which reads as the control being broken.
          const response = await fetch(
            `/admin/api/collections/${collection}/entries?limit=100&status=all`,
            { credentials: "include" }
          );
          if (!response.ok) return [];
          const body = (await response.json()) as {
            items?: Record<string, unknown>[];
          };
          return (body.items ?? [])
            .filter(row => typeof row.id === "string")
            .map(row => ({
              collection,
              id: row.id as string,
              label: documentLabel(row),
            }));
        } catch {
          // One unreadable collection must not blank the whole control; the
          // others are still choosable and the empty state explains the rest.
          return [];
        }
      })
    )
      .then(perCollection => {
        if (!cancelled) setChoices(perCollection.flat());
      })
      // Each request already degrades to an empty list, so this is only
      // reachable if the state update itself throws; an empty list is the
      // honest result either way.
      .catch(() => {
        if (!cancelled) setChoices([]);
      });

    return () => {
      cancelled = true;
    };
  }, [key]);

  const selected = selectionKey(value, collections);
  const grouped = collections.length > 1;

  if (choices === null) {
    return <p className="text-[12px] text-muted-foreground">Loading pages…</p>;
  }

  if (choices.length === 0) {
    return (
      <p className="text-[12px] text-muted-foreground">
        No documents to redirect to yet. Publish one in{" "}
        {collections.join(" or ")} first.
      </p>
    );
  }

  return (
    <Select
      value={selected ?? ""}
      onValueChange={next => {
        const separator = next.indexOf(":");
        if (separator < 0) return onChange(undefined);
        onChange({
          relationTo: next.slice(0, separator),
          value: next.slice(separator + 1),
        });
      }}
    >
      <SelectTrigger aria-label="Redirect page" className="w-full">
        <SelectValue placeholder="Choose a page" />
      </SelectTrigger>
      <SelectContent>
        {grouped
          ? collections.map(collection => {
              const inCollection = choices.filter(
                choice => choice.collection === collection
              );
              if (inCollection.length === 0) return null;
              return (
                <SelectGroup key={collection}>
                  <SelectLabel>{collection}</SelectLabel>
                  {inCollection.map(choice => (
                    <SelectItem
                      key={`${choice.collection}:${choice.id}`}
                      value={`${choice.collection}:${choice.id}`}
                    >
                      {choice.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              );
            })
          : choices.map(choice => (
              <SelectItem
                key={`${choice.collection}:${choice.id}`}
                value={`${choice.collection}:${choice.id}`}
              >
                {choice.label}
              </SelectItem>
            ))}
      </SelectContent>
    </Select>
  );
}
