"use client";

/**
 * A new Collection list's two steps, drawn on the canvas over the list: which
 * entries it shows, then how they start out.
 *
 * - **Show entries from** offers one button per collection visitors can read
 *   (the host's list), and "More sources…" where the site registers custom
 *   sources, which are chosen in the panel.
 * - **"<Collection> · choose a starting layout"** offers three tiles, "Cards,
 *   3 across", "List rows" and "Titles only", and Skip, which sets the source
 *   and leaves an empty item to build.
 *
 * A layout fills the list at once (`planStartingList`): the source, the
 * item, already bound to each entry, and the layout's spacing, joined to the
 * list's insert as ONE step, so one undo takes the whole list away.
 * Escape on the first step leaves a blank list; on the second it goes back.
 * Both steps are a group named by their heading, and their buttons are
 * reached with Tab and the arrow keys.
 *
 * @module collection-list-picker
 */
import { Button } from "@nextlyhq/ui";
import * as React from "react";

import {
  planStartingList,
  type ItemSource,
  type StartingLayout,
} from "./collection-list-item";
import type { ContentServices, LoopCollection } from "./content-services";
import type { FirstAdd } from "./first-add";
import { radioGroupStep } from "./roving-radios";

/** The words the two steps use, in one place. */
export const COLLECTION_PICKER_WORDS = {
  source: "Show entries from",
  moreSources: "More sources…",
  moreSourcesHint: "Choose a custom source in the panel.",
  loading: "Finding collections…",
  failed: "The collections couldn't be listed.",
  none: "No collection visitors can read.",
  layout: (label: string) => `${label} · choose a starting layout`,
  skip: "Skip",
  back: "Back",
} as const;

/** The starting layouts, in the order offered, with their words. */
export const STARTING_LAYOUTS: readonly {
  readonly key: StartingLayout;
  readonly label: string;
}[] = [
  { key: "cards", label: "Cards, 3 across" },
  { key: "rows", label: "List rows" },
  { key: "titles", label: "Titles only" },
];

/** What the picker reads from the host. */
export type CollectionPickerServices = Pick<
  ContentServices,
  "listLoopCollections" | "listCustomSources"
>;

/** A collection as the item rule reads it. */
export function itemSourceOf(collection: LoopCollection): ItemSource {
  return {
    slug: collection.slug,
    ...(collection.titleField === undefined
      ? {}
      : { titleField: collection.titleField }),
    ...(collection.entriesHavePages === undefined
      ? {}
      : { entriesHavePages: collection.entriesHavePages }),
    readable: (collection.readable ?? []).map(field => ({
      name: field.name,
      type: field.type,
      ...(field.hasMany === undefined ? {} : { hasMany: field.hasMany }),
      ...(field.relationTo === undefined
        ? {}
        : { relationTo: field.relationTo }),
      ...(field.takesImages === undefined
        ? {}
        : { takesImages: field.takesImages }),
    })),
  };
}

/** The host's collections, as the first step lists them. */
type Listing =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | {
      readonly kind: "ready";
      readonly collections: readonly LoopCollection[];
      readonly custom: boolean;
    };

/** The host's readable collections and whether it has custom sources. */
function useListing(services: CollectionPickerServices | undefined): Listing {
  const [listing, setListing] = React.useState<Listing>({ kind: "loading" });
  const list = services?.listLoopCollections;
  const custom = services?.listCustomSources;
  React.useEffect(() => {
    let live = true;
    if (list === undefined) {
      setListing({ kind: "failed" });
      return;
    }
    Promise.all([
      list(),
      custom === undefined ? Promise.resolve([]) : custom().catch(() => []),
    ]).then(
      ([collections, sources]) => {
        if (live) {
          setListing({
            kind: "ready",
            collections: [...collections].sort((a, b) =>
              a.label.localeCompare(b.label)
            ),
            custom: sources.length > 0,
          });
        }
      },
      () => {
        if (live) setListing({ kind: "failed" });
      }
    );
    return () => {
      live = false;
    };
  }, [list, custom]);
  return listing;
}

/** Arrow keys move between `buttons`, as a row of tiles is moved through. */
function arrowsBetween(
  event: React.KeyboardEvent,
  buttons: readonly (HTMLButtonElement | null)[],
  from: number
): void {
  const step = radioGroupStep(event.key);
  if (step === null || buttons.length === 0) return;
  event.preventDefault();
  const next = (from + step + buttons.length) % buttons.length;
  buttons[next]?.focus();
}

export interface CollectionListPickerProps {
  /** The list just added, or the selected list with no source. */
  readonly firstAdd: FirstAdd;
  /** The document the list is in, for the pick's write. */
  readonly document: Parameters<typeof planStartingList>[0];
  readonly services?: CollectionPickerServices | undefined;
  readonly onDone?: () => void;
}

/** The two steps over a list that has no source yet. */
export function CollectionListPicker({
  firstAdd,
  document,
  services,
  onDone,
}: CollectionListPickerProps): React.JSX.Element {
  const listing = useListing(services);
  const [source, setSource] = React.useState<LoopCollection | null>(null);
  const titleId = React.useId();
  const buttons = React.useRef<(HTMLButtonElement | null)[]>([]);
  const heading = React.useRef<HTMLParagraphElement | null>(null);

  // Each step starts with its first button focused, so the keyboard carries
  // on from a pick to the next step.
  React.useEffect(() => {
    buttons.current[0]?.focus({ preventScroll: true });
  }, [source, listing.kind]);

  const skip = (): void => {
    firstAdd.skip();
    onDone?.();
  };
  const pick = (layout: StartingLayout | "skip"): void => {
    if (source === null) return;
    const ops = planStartingList(
      document,
      firstAdd.nodeId,
      itemSourceOf(source),
      layout
    );
    if (ops === null) firstAdd.skip();
    else firstAdd.choose(ops);
    onDone?.();
  };

  buttons.current = [];
  const keep = (index: number) => (element: HTMLButtonElement | null) => {
    buttons.current[index] = element;
  };

  if (source !== null) {
    return (
      <div
        className="nx-first-add__body nx-list-picker"
        role="group"
        aria-labelledby={titleId}
        onKeyDown={event => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          setSource(null);
        }}
      >
        <p className="nx-first-add__title" id={titleId} ref={heading}>
          {COLLECTION_PICKER_WORDS.layout(source.label)}
        </p>
        <div className="nx-first-add__tiles nx-list-picker__layouts">
          {STARTING_LAYOUTS.map((layout, index) => (
            <button
              key={layout.key}
              ref={keep(index)}
              type="button"
              className="nx-list-picker__tile"
              data-layout={layout.key}
              tabIndex={index === 0 ? 0 : -1}
              onKeyDown={event =>
                arrowsBetween(event, buttons.current.slice(0, 3), index)
              }
              onClick={() => pick(layout.key)}
            >
              <LayoutGlyph layout={layout.key} />
              <span>{layout.label}</span>
            </button>
          ))}
        </div>
        <div className="nx-list-picker__actions">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setSource(null)}
          >
            {COLLECTION_PICKER_WORDS.back}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="nx-first-add__skip"
            onClick={() => pick("skip")}
          >
            {COLLECTION_PICKER_WORDS.skip}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="nx-first-add__body nx-list-picker"
      role="group"
      aria-labelledby={titleId}
      aria-busy={listing.kind === "loading"}
      onKeyDown={event => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        skip();
      }}
    >
      <p className="nx-first-add__title" id={titleId}>
        {COLLECTION_PICKER_WORDS.source}
      </p>
      {listing.kind === "loading" ? (
        <p className="nx-list-picker__note" role="status">
          {COLLECTION_PICKER_WORDS.loading}
        </p>
      ) : listing.kind === "failed" ? (
        <p className="nx-list-picker__note" role="status">
          {COLLECTION_PICKER_WORDS.failed}
        </p>
      ) : (
        <>
          {listing.collections.length === 0 ? (
            <p className="nx-list-picker__note">
              {COLLECTION_PICKER_WORDS.none}
            </p>
          ) : (
            <div className="nx-list-picker__sources">
              {listing.collections.map((collection, index) => (
                <Button
                  key={collection.slug}
                  ref={keep(index)}
                  type="button"
                  size="sm"
                  variant="outline"
                  tabIndex={index === 0 ? 0 : -1}
                  onKeyDown={event =>
                    arrowsBetween(event, buttons.current, index)
                  }
                  onClick={() => setSource(collection)}
                >
                  {collection.label}
                </Button>
              ))}
            </div>
          )}
          {listing.custom ? (
            <p className="nx-list-picker__note">
              <span className="nx-list-picker__more">
                {COLLECTION_PICKER_WORDS.moreSources}
              </span>{" "}
              {COLLECTION_PICKER_WORDS.moreSourcesHint}
            </p>
          ) : null}
        </>
      )}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="nx-first-add__skip"
        onClick={skip}
      >
        {COLLECTION_PICKER_WORDS.skip}
      </Button>
    </div>
  );
}

/** A small drawing of each starting layout, in the tile. */
function LayoutGlyph({
  layout,
}: {
  readonly layout: StartingLayout;
}): React.JSX.Element {
  const box = { width: 72, height: 44 };
  return (
    <svg
      className="nx-list-picker__glyph"
      viewBox={`0 0 ${String(box.width)} ${String(box.height)}`}
      aria-hidden="true"
      focusable="false"
    >
      {layout === "cards"
        ? [0, 1, 2].map(column => (
            <g key={column} transform={`translate(${String(column * 24 + 2)} 4)`}>
              <rect width="20" height="12" rx="2" className="nx-list-picker__fill" />
              <rect y="15" width="16" height="3" rx="1" />
              <rect y="21" width="20" height="2" rx="1" className="nx-list-picker__faint" />
              <rect y="25" width="14" height="2" rx="1" className="nx-list-picker__faint" />
            </g>
          ))
        : layout === "rows"
          ? [0, 1, 2].map(row => (
              <g key={row} transform={`translate(4 ${String(row * 14 + 2)})`}>
                <rect width="11" height="11" rx="2" className="nx-list-picker__fill" />
                <rect x="15" y="1" width="30" height="3" rx="1" />
                <rect x="15" y="6" width="46" height="2" rx="1" className="nx-list-picker__faint" />
              </g>
            ))
          : [0, 1, 2, 3].map(row => (
              <rect key={row} x="4" y={String(row * 10 + 4)} width={String(40 + (row % 2) * 16)} height="4" rx="1" />
            ))}
    </svg>
  );
}
