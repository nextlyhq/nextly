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
}

/** One group of a block's props. */
export interface PropGroup {
  /** The prop the group is drawn in place of. */
  readonly lead: string;
  /** Every prop the group draws, its lead included. */
  readonly drawn: ReadonlySet<string>;
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
            render: (context: PropGroupContext) => (
              <ImageAltField group={alt} {...context} />
            ),
          },
        ]),
  ];
};

/** Every finder, in the order its groups claim props. */
const FINDERS: readonly PropGroupFinder[] = [linkGroups, imageGroups];

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
