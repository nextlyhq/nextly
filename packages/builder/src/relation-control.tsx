"use client";

/**
 * The Content tab's control for a prop that points at one entry of a
 * collection: `{ type: "relation", relationTo: "<collection>" }`.
 *
 * Only the entry's id is stored, as a media prop stores only the file's: the
 * page resolves it when it draws, so an entry renamed in its collection stays
 * right on the page. The title shown here is read back through the host's
 * `findEntries`, which reads with the signed-in author's own access, so the
 * control never shows an entry the author could not open in the admin.
 *
 * Searching is a field and a list of matches, each a button that chooses it.
 * The list is read when the field is first focused and again as the author
 * types, a short pause after the last key, and a newer read cancels the one in
 * flight so a slow answer cannot replace a later one.
 *
 * @module relation-control
 */

import { Button, Input } from "@nextlyhq/ui";
import { Check } from "lucide-react";
import * as React from "react";

import type { ContentControlProps, FoundEntry } from "./content-controls";
import { propLabel } from "./inspector";

/** How long typing pauses before the matches are read again. */
const SEARCH_PAUSE_MS = 200;

/** How many matches one read asks for. */
const MATCHES_SHOWN = 10;

type FindEntries = NonNullable<
  NonNullable<ContentControlProps["services"]>["findEntries"]
>;

/** The matches for what is typed, while the field has been focused. */
type Matches =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "found"; readonly entries: readonly FoundEntry[] }
  | { readonly kind: "failed" };

/**
 * Read the matches for `search` in `collection`, once `active`, a pause after
 * the last change, cancelling a read a newer one replaces.
 */
function useMatches(
  find: FindEntries | undefined,
  collection: string | undefined,
  search: string,
  active: boolean
): Matches {
  const [matches, setMatches] = React.useState<Matches>({ kind: "idle" });
  React.useEffect(() => {
    if (!active || find === undefined || collection === undefined) return;
    const controller = new AbortController();
    setMatches({ kind: "loading" });
    const timer = setTimeout(() => {
      find({
        collection,
        search: search.trim(),
        limit: MATCHES_SHOWN,
        signal: controller.signal,
      }).then(
        entries => {
          if (!controller.signal.aborted) {
            setMatches({ kind: "found", entries });
          }
        },
        () => {
          if (!controller.signal.aborted) setMatches({ kind: "failed" });
        }
      );
    }, SEARCH_PAUSE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [find, collection, search, active]);
  return matches;
}

/**
 * The stored entry's title, read once per id. `undefined` while it is read
 * or when nothing is stored; `null` when the author can't read the entry or
 * it is gone, which the control says rather than showing a bare id.
 */
function useChosenTitle(
  find: FindEntries | undefined,
  collection: string | undefined,
  stored: string | null,
  known: FoundEntry | null
): string | null | undefined {
  const [title, setTitle] = React.useState<{
    id: string;
    title: string | null;
  } | null>(null);
  const knownTitle = known?.id === stored ? known?.title : undefined;
  React.useEffect(() => {
    if (stored === null || knownTitle !== undefined) return;
    if (find === undefined || collection === undefined) return;
    const controller = new AbortController();
    // A failed read names nothing: the entry is said to be unreadable rather
    // than the read's error being shown where a title belongs.
    const titleOf = async (): Promise<string | null> => {
      try {
        const entries = await find({
          collection,
          ids: [stored],
          limit: 1,
          signal: controller.signal,
        });
        return entries.find(entry => entry.id === stored)?.title ?? null;
      } catch {
        return null;
      }
    };
    void titleOf().then(found => {
      if (!controller.signal.aborted) setTitle({ id: stored, title: found });
    });
    return () => controller.abort();
  }, [find, collection, stored, knownTitle]);
  if (stored === null) return undefined;
  if (knownTitle !== undefined) return knownTitle;
  return title?.id === stored ? title.title : undefined;
}

/** What the control says about the stored entry. */
function chosenWords(
  stored: string | null,
  title: string | null | undefined
): string {
  if (stored === null) return "Nothing chosen.";
  if (title === undefined) return "Loading the chosen entry…";
  if (title === null)
    return "An entry you can't open here, or one that was removed.";
  return title;
}

export function RelationControl({
  id,
  prop,
  disabled,
  onCommit,
  services,
  label: labelOverride,
}: ContentControlProps): React.JSX.Element {
  const label = labelOverride ?? propLabel(prop.name, prop.schema);
  const collection =
    typeof prop.schema.relationTo === "string" && prop.schema.relationTo !== ""
      ? prop.schema.relationTo
      : undefined;
  const stored =
    typeof prop.value === "string" && prop.value !== "" ? prop.value : null;
  const find = services?.findEntries;
  const [search, setSearch] = React.useState("");
  const [active, setActive] = React.useState(false);
  // The last entry chosen here, so its title shows at once rather than after
  // a read of what was just picked.
  const [chosen, setChosen] = React.useState<FoundEntry | null>(null);
  const matches = useMatches(find, collection, search, active && !disabled);
  const title = useChosenTitle(find, collection, stored, chosen);
  const unavailable =
    collection === undefined
      ? "This field names no collection to choose from."
      : find === undefined
        ? "Entries can't be searched here."
        : undefined;
  return (
    <div
      className="nx-inspector__field nx-inspector__field--stacked"
      data-content-control="relation"
    >
      <p className="nx-inspector__field-name" id={`${id}-label`}>
        {label}
      </p>
      <div
        className="nx-inspector__relation"
        role="group"
        aria-labelledby={`${id}-label`}
      >
        <div className="nx-inspector__relation-chosen">
          <p className="nx-inspector__note" data-relation-chosen="">
            {chosenWords(stored, title)}
          </p>
          {stored === null ? null : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              aria-label={`Clear ${label}`}
              onClick={() => onCommit(prop.name, undefined)}
            >
              Clear
            </Button>
          )}
        </div>
        {unavailable === undefined ? (
          <>
            <Input
              id={id}
              type="search"
              value={search}
              disabled={disabled}
              aria-label={`Search ${label}`}
              placeholder="Search"
              onFocus={() => setActive(true)}
              onChange={event => setSearch(event.target.value)}
            />
            <MatchList
              matches={matches}
              stored={stored}
              disabled={disabled}
              onChoose={entry => {
                setChosen(entry);
                onCommit(prop.name, entry.id);
              }}
            />
          </>
        ) : (
          <p className="nx-inspector__note">{unavailable}</p>
        )}
      </div>
    </div>
  );
}

/** The matches, each a button choosing it, or what the read came to. */
function MatchList({
  matches,
  stored,
  disabled,
  onChoose,
}: {
  matches: Matches;
  stored: string | null;
  disabled: boolean;
  onChoose: (entry: FoundEntry) => void;
}): React.JSX.Element | null {
  if (matches.kind === "idle") return null;
  if (matches.kind === "loading") {
    return (
      <p className="nx-inspector__note" role="status">
        Searching…
      </p>
    );
  }
  if (matches.kind === "failed") {
    return (
      <p className="nx-inspector__note" role="alert">
        The entries couldn&apos;t be loaded. Try again in a moment.
      </p>
    );
  }
  if (matches.entries.length === 0) {
    return (
      <p className="nx-inspector__note" role="status">
        No entries match.
      </p>
    );
  }
  return (
    <ul className="nx-inspector__relation-matches">
      {matches.entries.map(entry => (
        <li key={entry.id}>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            aria-pressed={entry.id === stored}
            // The whole title on hover, since a long one is cut to the row.
            title={entry.title}
            onClick={() => onChoose(entry)}
          >
            <span className="nx-inspector__relation-title">{entry.title}</span>
            {entry.id === stored ? (
              <Check
                aria-hidden="true"
                className="nx-inspector__relation-tick"
              />
            ) : null}
          </Button>
        </li>
      ))}
    </ul>
  );
}
