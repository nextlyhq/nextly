"use client";

/**
 * The Content tab's prop groups: several props a block declares that an
 * author reads as one thing, drawn as one control where the first of them
 * (the group's lead) would sit, with no row of their own for the rest.
 *
 * One list of finders, each asked of the block's props, so a link and an
 * image's source and alt text are entries in it rather than cases in the
 * panel. A finder names its group's props by name and type; the block
 * schemas stay as they are.
 *
 * A group draws the bind button for the props an author binds on their own
 * (an image's source, its alt text, a link's address) through the
 * inspector's `bindable` wrapper, so the chip, its menu and its notes are the
 * one implementation every row uses. The rest of a group's props qualify
 * those (how a link opens, whether an image is decorative, which entry a
 * button points at, a list's query) and are set through the group's own
 * control, so the group names exactly which it offers as `bindable`.
 *
 * @module prop-groups
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import type * as React from "react";

import type { ContentServices } from "./content-controls";
import { ImageAltField, ImageSourceField } from "./image-controls";
import { imageGroupOf } from "./image-group";
import type { EditableProp } from "./inspector";
import { LinkGroupField } from "./link-control";
import { linkGroupOf } from "./link-group";
import { LIST_QUERY_PROPS, ListQueryField } from "./list-query-controls";

/** What a group may say about one prop's binding beyond its name. */
export interface BindableOptions {
  /**
   * The group's other props a bind empties in the same edit: those the block
   * would follow before the bound prop, such as a button's entry reference
   * before its address.
   */
  readonly clearsOnBind?: readonly string[];
  /**
   * A link's address and the two halves of the entry reference it follows
   * first, where the bound prop is a link's destination: the picker also
   * offers the entries a relation names, whose pick binds the entry's id,
   * and a bound entry id is drawn in the address's place.
   */
  readonly entryLink?: {
    readonly link: string;
    readonly collection: string;
    readonly id: string;
  };
}

/**
 * Wrap one prop's field with its binding controls: the field and a bind
 * button while unbound, the bound chip, Fallback and menu in its place once
 * bound. Hands the field back as it is for a prop no field can fill.
 */
export type BindableWrapper = (
  propName: string,
  field: React.ReactNode,
  options?: BindableOptions
) => React.ReactNode;

/** What a group is drawn with. */
export interface PropGroupContext {
  /** The block's props, as the inspector reads them. */
  readonly props: readonly EditableProp[];
  /** Whether one prop may be set where the block sits. */
  readonly writable: (name: string) => boolean;
  /** The id of the lock reason a held control points to. */
  readonly reasonId: string;
  readonly services: ContentServices | undefined;
  /** Every set of props the block can be placed with: see `BlockInspection`. */
  readonly placedWith: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /** Write several props as one edit. */
  readonly onCommitMany: (
    changes: Readonly<Record<string, unknown>>
  ) => BlockDocument | null | void;
  /** The document the block is in, for a group that reads around it. */
  readonly document: BlockDocument;
  /** The block's id. */
  readonly nodeId: string;
  /** Whether the canvas draws this block's empty state, for a list. */
  readonly showsEmpty: boolean;
  /** Draw a list's empty state on the canvas, or its entries again. */
  readonly onShowEmpty?: ((empty: boolean) => void) | undefined;
  /**
   * The count of the latest ask, from a list's canvas note, to fix this
   * list's sort: each new count takes the author to its first sort row.
   */
  readonly sortFieldAsked?: number | undefined;
  /** Tag a list on the canvas while a new source waits for an input. */
  readonly onStillShowing?: ((words: string | undefined) => void) | undefined;
  /**
   * The inspector's binding controls for one of the group's props, for the
   * props the group names as `bindable`. Absent, as in a component's
   * placement panel, the group draws its fields alone.
   */
  readonly bindable?: BindableWrapper | undefined;
}

/** One group of a block's props. */
export interface PropGroup {
  /** The prop the group is drawn in place of. */
  readonly lead: string;
  /** Every prop the group draws, its lead included. */
  readonly drawn: ReadonlySet<string>;
  /**
   * The props the group offers a bind button for, each through
   * `PropGroupContext.bindable`; the others it draws are set through its own
   * control only.
   */
  readonly bindable: ReadonlySet<string>;
  /** The group's control. */
  readonly render: (context: PropGroupContext) => React.JSX.Element;
}

type PropGroupFinder = (props: readonly EditableProp[]) => readonly PropGroup[];

/** A link and what qualifies it: see `link-group`. */
const linkGroups: PropGroupFinder = props => {
  const group = linkGroupOf(props);
  if (group === undefined) return [];
  return [
    {
      lead: group.link,
      drawn: group.drawn,
      // Where it goes. Its target and rel qualify that address. The entry
      // reference is bound only from the address's own picker, to a related
      // entry's id, which writes both halves at once (its id bound and its
      // collection set), so it has no bind button of its own.
      bindable: new Set([group.link]),
      render: context => <LinkGroupField group={group} {...context} />,
    },
  ];
};

/** An image's source, and its alt text: see `image-group`. */
const imageGroups: PropGroupFinder = props => {
  const group = imageGroupOf(props);
  if (group === undefined) return [];
  const { source, alt } = group;
  return [
    ...(source === undefined
      ? []
      : [
          {
            lead: source.media,
            drawn: source.drawn,
            // The picture, by its library id or, in URL mode, its address.
            bindable: new Set([source.media, source.address]),
            render: (context: PropGroupContext) => (
              <ImageSourceField
                group={source}
                // The chip says the library's alt text only where no alt
                // row of its own says it.
                showLibraryAlt={alt === undefined}
                {...context}
              />
            ),
          },
        ]),
    ...(alt === undefined
      ? []
      : [
          {
            lead: alt.alt,
            drawn: alt.drawn,
            // The words; whether the image is decorative is a mode of the
            // same menu, not a value of its own to fill.
            bindable: new Set([alt.alt]),
            render: (context: PropGroupContext) => (
              <ImageAltField group={alt} {...context} />
            ),
          },
        ]),
  ];
};

/**
 * A collection list's query: its source, filters, sort and window, drawn as
 * one group where its collection sits. Asked for by the block declaring its
 * filters with `display: "listFilters"`, beside the props the engine's
 * `readListQuery` reads, so no prop of another block is drawn by it.
 */
const listQueryGroups: PropGroupFinder = props => {
  const asks = props.some(
    prop => prop.name === "filters" && prop.schema.display === "listFilters"
  );
  if (!asks || !props.some(prop => prop.name === "collection")) return [];
  const drawn = new Set<string>(
    LIST_QUERY_PROPS.filter(name => props.some(prop => prop.name === name))
  );
  return [
    {
      lead: "collection",
      drawn,
      // A list's query is chosen, not filled from a field.
      bindable: new Set<string>(),
      render: context => <ListQueryField {...context} />,
    },
  ];
};

/** Every finder, in the order its groups claim props. */
const FINDERS: readonly PropGroupFinder[] = [
  linkGroups,
  imageGroups,
  listQueryGroups,
];

/**
 * The groups among a block's props, in finder order. A group naming a prop
 * an earlier group already draws is left out, so no prop is drawn twice and
 * no write reaches a prop through two controls.
 */
export function propGroupsOf(props: readonly EditableProp[]): PropGroup[] {
  const claimed = new Set<string>();
  const groups: PropGroup[] = [];
  for (const group of FINDERS.flatMap(find => find(props))) {
    if ([...group.drawn].some(name => claimed.has(name))) continue;
    for (const name of group.drawn) claimed.add(name);
    groups.push(group);
  }
  return groups;
}
