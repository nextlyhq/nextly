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
  Input,
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

/** Rows per request. Search, not paging, is how the rest are reached. */
const PAGE_SIZE = 50;

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

/** What to call a document, preferring the field an author would recognise. */
export function documentLabel(row: Record<string, unknown>): string {
  for (const field of ["title", "name", "label", "slug"]) {
    const candidate = row[field];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return typeof row.id === "string" ? row.id : "Untitled";
}

/**
 * One collection's matching documents, or null when it could not be read.
 *
 * `limit`, not `pageSize` — the other name is accepted and ignored, leaving
 * the default of 10. `status=all` because a form is usually configured
 * alongside the page it points at, and filtering to published shows "create
 * one first" while the page sits in the next tab. `depth=0` because this reads
 * five fields and would otherwise inherit the collection API's expansion,
 * pulling every nested relation of every row to fill a dropdown.
 */
async function fetchChoices(
  collection: string,
  query: string
): Promise<Choice[] | null> {
  const search = query ? `&search=${encodeURIComponent(query)}` : "";
  try {
    const response = await fetch(
      `/admin/api/collections/${collection}/entries` +
        `?limit=${PAGE_SIZE}&status=all&depth=0${search}`,
      { credentials: "include" }
    );
    if (!response.ok) return null;
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
    return null;
  }
}

/** One option, keyed and valued by the pair the caller stores. */
function renderChoice(choice: Choice) {
  return (
    <SelectItem
      key={`${choice.collection}:${choice.id}`}
      value={`${choice.collection}:${choice.id}`}
    >
      {choice.label}
    </SelectItem>
  );
}

/**
 * The matching documents for every configured collection, and which of them
 * could not be read.
 */
function useChoices(key: string, applied: string) {
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [failed, setFailed] = useState<readonly string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const wanted = key ? key.split(",") : [];

    void Promise.all(
      wanted.map(collection => fetchChoices(collection, applied))
    ).then(results => {
      if (cancelled) return;
      // WHICH collections failed, not merely whether any did: one unreadable
      // collection beside a readable-but-empty one otherwise reports "nothing
      // here" about a collection nobody could see.
      setFailed(wanted.filter((_, index) => results[index] === null));
      setChoices(
        results.filter((rows): rows is Choice[] => rows !== null).flat()
      );
    });

    return () => {
      cancelled = true;
    };
  }, [key, applied]);

  return { choices, setChoices, failed };
}

/**
 * Adds the selected document when the listing did not reach it.
 *
 * Keyed on the selection rather than on the collection list, because the
 * stored value arrives with the form and often AFTER this mounts — a hook
 * watching only the collections would capture the moment when nothing was
 * selected and never look again.
 *
 * A control that silently drops its own value is worse than one that cannot
 * list everything: the author sees blank, re-picks, and saves a different
 * destination than the one that was stored.
 */
function useSelectedChoice(
  selected: string | undefined,
  choices: Choice[] | null,
  setChoices: (update: (current: Choice[] | null) => Choice[]) => void
) {
  useEffect(() => {
    if (!selected || choices === null) return;
    const separator = selected.indexOf(":");
    const collection = selected.slice(0, separator);
    const id = selected.slice(separator + 1);
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
  }, [selected, choices, setChoices]);
}

/** The options, grouped by collection only when there is more than one. */
function Options({
  choices,
  collections,
}: {
  choices: Choice[];
  collections: readonly string[];
}) {
  if (collections.length <= 1) return <>{choices.map(renderChoice)}</>;
  return (
    <>
      {collections.map(collection => {
        const inCollection = choices.filter(
          choice => choice.collection === collection
        );
        if (inCollection.length === 0) return null;
        return (
          <SelectGroup key={collection}>
            <SelectLabel>{collection}</SelectLabel>
            {inCollection.map(renderChoice)}
          </SelectGroup>
        );
      })}
    </>
  );
}

/** What to say when there is nothing to choose, and why. */
function Empty({
  applied,
  collections,
}: {
  applied: string;
  collections: readonly string[];
}) {
  return (
    <p className="text-[12px] text-muted-foreground">
      {applied
        ? `No documents match “${applied}”.`
        : `No documents to redirect to yet. Create one in ${collections.join(" or ")} first.`}
    </p>
  );
}

export function RedirectPagePicker({
  collections,
  value,
  onChange,
}: RedirectPagePickerProps) {
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");

  // Typing should not issue a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setApplied(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  // `collections` is an array prop, so a new identity every render would
  // refetch forever; the join is the value that actually decides the request.
  const { choices, setChoices, failed } = useChoices(
    collections.join(","),
    applied
  );
  const selected = selectionKey(value, collections);
  useSelectedChoice(selected, choices, setChoices);

  if (choices === null) {
    return <p className="text-[12px] text-muted-foreground">Loading pages…</p>;
  }

  return (
    <div className="space-y-2">
      {/* Search rather than paging: a dropdown cannot usefully list a large
          collection, and a ceiling on how many pages to walk would leave the
          documents past it unreachable however high it were set. */}
      <Input
        aria-label="Search pages"
        value={query}
        onChange={event => setQuery(event.target.value)}
        placeholder="Search…"
      />

      {/* Reported BESIDE the choices rather than instead of them: a collection
          the author cannot read is a different problem from one that is empty,
          and the collections that did load are still choosable. */}
      {failed.length > 0 && (
        <p className="text-[12px] text-destructive">
          Could not read {failed.join(" or ")}. You may not have permission to
          list {failed.length > 1 ? "them" : "it"}, or the request failed.
        </p>
      )}

      {choices.length === 0 ? (
        failed.length < collections.length && (
          <Empty applied={applied} collections={collections} />
        )
      ) : (
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
            <Options choices={choices} collections={collections} />
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
