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

/**
 * The only fields this control reads, in the order `documentLabel` prefers.
 *
 * One declaration, used to build the request AND to choose the label, so a
 * field added to one cannot go missing from the other.
 */
const LABEL_FIELDS = ["id", "title", "name", "label", "slug"] as const;

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
  for (const field of LABEL_FIELDS.filter(name => name !== "id")) {
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
  query: string,
  page: number
): Promise<{ rows: Choice[]; hasMore: boolean } | null> {
  const search = query ? `&search=${encodeURIComponent(query)}` : "";
  try {
    // `select` as well as `depth=0`. Without it every scalar and JSON field of
    // up to fifty documents is downloaded per collection — for page-builder
    // documents that is the whole block tree — to fill a dropdown that reads
    // five fields.
    const response = await fetch(
      `/admin/api/collections/${collection}/entries` +
        `?limit=${PAGE_SIZE}&page=${page}&status=all&depth=0` +
        `&select=${LABEL_FIELDS.join(",")}${search}`,
      { credentials: "include" }
    );
    if (!response.ok) return null;
    const body = (await response.json()) as {
      items?: Record<string, unknown>[];
      meta?: { totalPages?: number };
    };
    return {
      rows: (body.items ?? [])
        .filter(row => typeof row.id === "string")
        .map(row => ({
          collection,
          id: row.id as string,
          label: documentLabel(row),
        })),
      // Reported rather than assumed, so the control can offer the rest
      // instead of truncating where the author cannot see it.
      hasMore: page < (body.meta?.totalPages ?? 1),
    };
  } catch {
    return null;
  }
}

/**
 * Existing choices plus new ones, de-duplicated on the pair that identifies a
 * document. Order is preserved so a list does not reshuffle under the author.
 */
function mergeChoices(
  existing: readonly Choice[],
  incoming: readonly Choice[]
): Choice[] {
  const seen = new Set(existing.map(c => `${c.collection}:${c.id}`));
  const merged = [...existing];
  for (const choice of incoming) {
    const key = `${choice.collection}:${choice.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(choice);
  }
  return merged;
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
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  // Per collection, not shared. A shared counter advances every collection
  // when any one of them has more, so a collection whose page N failed is
  // never asked for page N again — and if its N+1 succeeds the warning clears
  // too, leaving those documents absent with nothing on screen saying so.
  const [pages, setPages] = useState<Record<string, number>>({});

  // A new query is a new list, not more of the old one.
  //
  // The SAME reference is returned when there is nothing to clear. Writing a
  // fresh `{}` every time is a state change even when the map is already
  // empty, and the fetch effect below depends on `pages` — so each query
  // change ran the fetch once with the old map, cancelled it, and ran it
  // again. Every collection was requested twice per search and the first
  // answer discarded.
  useEffect(() => {
    setPages(current => (Object.keys(current).length === 0 ? current : {}));
  }, [key, applied]);

  useEffect(() => {
    let cancelled = false;
    const wanted = key ? key.split(",") : [];
    setLoading(true);

    void Promise.all(
      wanted.map(collection =>
        fetchChoices(collection, applied, pages[collection] ?? 1)
      )
    ).then(results => {
      if (cancelled) return;
      setLoading(false);

      // WHICH collections failed, not merely whether any did: one unreadable
      // collection beside a readable-but-empty one otherwise reports "nothing
      // here" about a collection nobody could see.
      setFailed(wanted.filter((_, index) => results[index] === null));

      const loaded = results.filter(
        (result): result is { rows: Choice[]; hasMore: boolean } =>
          result !== null
      );
      setHasMore(loaded.some(result => result.hasMore));

      const rows = loaded.flatMap(result => result.rows);
      const first = wanted.every(collection => (pages[collection] ?? 1) === 1);
      // Merged by identity rather than appended. A retry re-requests a page
      // that already succeeded for its siblings, and appending would list
      // those documents twice — duplicate options, and duplicate React keys.
      // Keyed, a repeated page is a no-op whatever caused the repeat.
      setChoices(current => mergeChoices(first ? [] : (current ?? []), rows));
    });

    return () => {
      cancelled = true;
    };
  }, [key, applied, pages]);

  return {
    choices,
    setChoices,
    failed,
    hasMore,
    loading,
    /**
     * Advances only the collections that have more to give, and RETRIES the
     * ones whose last page failed rather than stepping over it.
     *
     * Guarded on the in-flight flag: two clicks before the first resolves
     * either batch into a double increment or cancel the pending effect, and a
     * skipped page is then absent from a list that reports having loaded it.
     */
    loadMore: () => {
      if (loading) return;
      setPages(current => {
        const next: Record<string, number> = { ...current };
        for (const collection of key ? key.split(",") : []) {
          // A failed collection stays on its page so the retry asks for the
          // page it never got.
          if (failed.includes(collection)) continue;
          next[collection] = (current[collection] ?? 1) + 1;
        }
        return next;
      });
    },
    /** Ask the failed collections again, without advancing anyone. */
    retryFailed: () => {
      if (!loading) setPages(current => ({ ...current }));
    },
  };
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
  // Whether the stored selection could not be read. A controlled `Select`
  // holding a value with no matching option renders BLANK, which looks
  // identical to "nothing chosen" — so an author with a perfectly good
  // destination is invited to pick over it. Reported rather than swallowed.
  const [unreadable, setUnreadable] = useState(false);

  useEffect(() => {
    if (!selected || choices === null) return;
    const separator = selected.indexOf(":");
    const collection = selected.slice(0, separator);
    const id = selected.slice(separator + 1);
    // Collection AND id: two configured collections can hold the same id, and
    // matching on id alone skips the fetch while the option that is actually
    // selected is absent.
    if (
      !id ||
      choices.some(
        choice => choice.id === id && choice.collection === collection
      )
    ) {
      setUnreadable(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        // `status=all` for the same reason the listing carries it: a stored
        // target may be a draft, and a published-only read answers 404.
        const response = await fetch(
          `/admin/api/collections/${collection}/entries/${id}?depth=0&status=all`,
          { credentials: "include" }
        );
        if (!response.ok) {
          if (!cancelled) setUnreadable(true);
          return;
        }
        // A by-id read answers with the document ITSELF. Only mutations carry
        // the `{ message, item }` envelope.
        const row = (await response.json()) as Record<string, unknown>;
        if (cancelled) return;
        if (!row || typeof row.id !== "string") {
          setUnreadable(true);
          return;
        }
        setUnreadable(false);
        setChoices(current => [
          { collection, id: row.id as string, label: documentLabel(row) },
          ...(current ?? []),
        ]);
      } catch {
        if (!cancelled) setUnreadable(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selected, choices, setChoices]);

  return unreadable;
}

/**
 * The options, grouped by the collection each one came from.
 *
 * The groups are derived from the CHOICES, not from the configured list. A
 * stored target whose collection was removed since the form was saved is
 * recovered by id and belongs in the list — filtering by configuration
 * dropped it, leaving the control blank over a value that is still stored,
 * with the unreadable warning cleared because the recovery had succeeded.
 *
 * That divergence was visible in the code before it was visible on screen: the
 * single-collection branch rendered every choice and the grouped branch
 * filtered them, so the same state produced different pickers depending on how
 * many collections a site happened to configure. One path now.
 */
export interface ChoiceGroup {
  collection: string;
  label: string;
  /** True when this collection is no longer a configured redirect target. */
  removed: boolean;
  choices: Choice[];
}

/**
 * The choices arranged into groups, in configuration order, with collections
 * that are no longer configured last and marked.
 *
 * Derived from the CHOICES rather than from the configured list, which is the
 * whole point: a stored target whose collection was removed is recovered by id
 * and belongs in the list.
 */
export function groupChoices(
  choices: readonly Choice[],
  collections: readonly string[]
): ChoiceGroup[] {
  const present = [...new Set(choices.map(choice => choice.collection))];
  const order = [
    ...collections.filter(name => present.includes(name)),
    ...present.filter(name => !collections.includes(name)),
  ];

  return order.map(collection => {
    const removed = !collections.includes(collection);
    return {
      collection,
      // Named as unavailable rather than hidden: the value is still stored and
      // the server refuses a save into a collection with no pattern, so an
      // author needs to see what is set in order to change it.
      label: removed ? `${collection} — no longer configured` : collection,
      removed,
      choices: choices.filter(choice => choice.collection === collection),
    };
  });
}

function Options({
  choices,
  collections,
}: {
  choices: Choice[];
  collections: readonly string[];
}) {
  const groups = groupChoices(choices, collections);
  if (groups.length <= 1 && !groups[0]?.removed) {
    return <>{choices.map(renderChoice)}</>;
  }
  return (
    <>
      {groups.map(group => (
        <SelectGroup key={group.collection}>
          <SelectLabel>{group.label}</SelectLabel>
          {group.choices.map(renderChoice)}
        </SelectGroup>
      ))}
    </>
  );
}

/**
 * What to say when there is nothing to choose, and why.
 *
 * `collections` here is the READABLE ones. Passing the full configured list
 * asserted that a collection which could not be read is empty — printed
 * directly beneath the notice saying it could not be read.
 */
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
        : collections.length === 0
          ? "No collection is configured as a redirect target."
          : `No documents to redirect to yet. Create one in ${collections.join(" or ")} first.`}
    </p>
  );
}

/**
 * The things this control has to say that its options cannot.
 *
 * Three separate states, kept apart deliberately. A collection that could not
 * be read, a saved page that cannot be IDENTIFIED because no collection is
 * configured to look it up in, and a saved page whose lookup FAILED are three
 * different situations, and each one previously appeared as an empty control —
 * which reads as "nothing is set" and invites an author to overwrite a
 * destination they were never shown.
 */
function PickerNotices({
  failed,
  loading,
  onRetry,
  unidentifiable,
  unreadableSelection,
}: {
  failed: readonly string[];
  loading: boolean;
  onRetry: () => void;
  unidentifiable: boolean;
  unreadableSelection: boolean;
}) {
  return (
    <>
      {failed.length > 0 && (
        <p className="text-[12px] text-destructive">
          Could not read {failed.join(" or ")}. You may not have permission to
          list {failed.length > 1 ? "them" : "it"}, or the request failed.{" "}
          <button
            type="button"
            onClick={onRetry}
            disabled={loading}
            className="underline underline-offset-2 disabled:no-underline"
          >
            Try again
          </button>
        </p>
      )}

      {unidentifiable && (
        <p className="text-[12px] text-muted-foreground">
          A page is saved on this form, but it cannot be identified without a
          configured redirect collection. Choosing a different confirmation
          replaces it.
        </p>
      )}

      {unreadableSelection && (
        <p className="text-[12px] text-destructive">
          This form has a page selected that could not be read. Leave it as it
          is unless you mean to change it — saving a new choice replaces the
          stored one.
        </p>
      )}
    </>
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
  const {
    choices,
    setChoices,
    failed,
    hasMore,
    loading,
    loadMore,
    retryFailed,
  } = useChoices(collections.join(","), applied);
  const selected = selectionKey(value, collections);
  // A value is stored and this control cannot say WHICH document it is: a bare
  // id names no collection, and with none configured there is nowhere to look
  // it up. Distinct from an unreadable selection, which is a failed request
  // rather than missing information.
  const unidentifiable = value != null && selected === undefined;
  const selectionUnreadable = useSelectedChoice(selected, choices, setChoices);

  if (choices === null) {
    return <p className="text-[12px] text-muted-foreground">Loading pages…</p>;
  }

  return (
    <div className="space-y-2">
      {/* Search rather than paging: a dropdown cannot usefully list a large
          collection, and a ceiling on how many pages to walk would leave the
          documents past it unreachable however high it were set. */}
      {/* Nothing to search when no collection is listed — the only entry in
          the control then is the stored target, recovered by id. */}
      {collections.length > 0 && (
        <Input
          aria-label="Search pages"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search…"
        />
      )}

      {/* Reported BESIDE the choices rather than instead of them: a collection
          the author cannot read is a different problem from one that is empty,
          and the collections that did load are still choosable. */}
      <PickerNotices
        failed={failed}
        loading={loading}
        onRetry={retryFailed}
        unidentifiable={unidentifiable}
        unreadableSelection={selectionUnreadable}
      />

      {choices.length === 0 ? (
        failed.length < collections.length && (
          <Empty
            applied={applied}
            collections={collections.filter(name => !failed.includes(name))}
          />
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

      {/* The rest of the matches, reachable rather than silently absent. A cap
          with no way past it makes a document beyond it unselectable however
          high the cap is set. */}
      {hasMore && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loading}
          className="text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:no-underline disabled:opacity-60"
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
