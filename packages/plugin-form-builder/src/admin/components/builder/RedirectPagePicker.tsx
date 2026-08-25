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

/** Rows per request, and the ceiling on how many requests one collection costs. */
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

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

  const [unreadable, setUnreadable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const wanted = key ? key.split(",") : [];

    /** One collection's documents, or null when it could not be read. */
    const load = async (collection: string): Promise<Choice[] | null> => {
      const page = async (offset: number) => {
        // `limit`, not `pageSize` — the other name is accepted and ignored,
        // leaving the default of 10. `status=all` because a form is usually
        // configured alongside the page it points at, and filtering to
        // published shows "publish one first" while the page sits in the next
        // tab. `depth=0` because this reads five fields and would otherwise
        // inherit the collection API's default expansion, pulling every
        // nested relation of every row to fill a dropdown.
        const response = await fetch(
          `/admin/api/collections/${collection}/entries` +
            `?limit=${PAGE_SIZE}&page=${offset}&status=all&depth=0`,
          { credentials: "include" }
        );
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as {
          items?: Record<string, unknown>[];
          meta?: { totalPages?: number };
        };
      };

      try {
        const first = await page(1);
        const rows = [...(first.items ?? [])];
        // Follow the pagination rather than stopping at one page: an author
        // whose document is number 101 could otherwise never select it, and a
        // form already pointing there would show blank. Bounded so a large
        // collection cannot hang the tab — what it cannot show, it says.
        const totalPages = Math.min(first.meta?.totalPages ?? 1, MAX_PAGES);
        for (let next = 2; next <= totalPages; next++) {
          rows.push(...((await page(next)).items ?? []));
        }
        return rows
          .filter(row => typeof row.id === "string")
          .map(row => ({
            collection,
            id: row.id as string,
            label: documentLabel(row),
          }));
      } catch {
        return null;
      }
    };

    void Promise.all(wanted.map(load)).then(perCollection => {
      if (cancelled) return;
      const readable = perCollection.filter(
        (rows): rows is Choice[] => rows !== null
      );
      // "Nothing to choose" and "could not read anything" are different
      // answers, and only one of them is the author's to fix. Reported apart,
      // because an editor without read permission was otherwise told the
      // collection was empty.
      setUnreadable(readable.length === 0 && wanted.length > 0);
      setChoices(readable.flat());
    });

    return () => {
      cancelled = true;
    };
  }, [key]);

  const selected = selectionKey(value, collections);

  /**
   * The selected document, when the listing did not reach it.
   *
   * Its own effect, keyed on the selection rather than on the collection list,
   * because the stored value arrives with the form and often AFTER this mounts
   * — an effect that only watched the collections would capture the moment
   * when nothing was selected yet and never look again.
   *
   * A control that silently drops its own value is worse than one that cannot
   * list everything: the author sees blank, re-picks, and saves a different
   * destination than the one that was stored.
   */
  useEffect(() => {
    if (!selected || choices === null) return;
    const [collection, ...rest] = selected.split(":");
    const id = rest.join(":");
    if (!id || choices.some(choice => choice.id === id)) return;

    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(
          `/admin/api/collections/${collection}/entries/${id}?depth=0`,
          { credentials: "include" }
        );
        if (!response.ok) return;
        const body = (await response.json()) as {
          item?: Record<string, unknown>;
        };
        const row = body.item;
        if (cancelled || !row || typeof row.id !== "string") return;
        setChoices(current => [
          { collection, id: row.id as string, label: documentLabel(row) },
          ...(current ?? []),
        ]);
      } catch {
        // The list still renders; the selection simply cannot be named.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selected, choices]);

  const grouped = collections.length > 1;

  if (choices === null) {
    return <p className="text-[12px] text-muted-foreground">Loading pages…</p>;
  }

  if (unreadable) {
    return (
      <p className="text-[12px] text-destructive">
        Could not read {collections.join(" or ")}. You may not have permission
        to list them, or the request failed.
      </p>
    );
  }

  if (choices.length === 0) {
    return (
      <p className="text-[12px] text-muted-foreground">
        No documents to redirect to yet. Create one in{" "}
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
