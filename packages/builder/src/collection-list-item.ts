/**
 * The item a new Collection list starts with: ordinary blocks, already bound
 * to the entry each repeat draws, built from the collection's fields by one
 * fixed rule.
 *
 * - **Title:** the collection's title field, else its first text field named
 *   `title` or `name`. A Heading 3, linked to the entry's page when the
 *   collection's entries have pages.
 * - **Picture:** its first single upload field that takes images, or a
 *   single relation to the media library. An Image.
 * - **Summary:** its first text or long-text field named like `excerpt`,
 *   `summary`, `description`, `intro` or `subtitle`, else its first
 *   long-text field. A Text.
 *
 * Each starting layout arranges those: "Cards, 3 across" (a Card each, the
 * picture 16:9 above a linked title and the summary), "List rows" (a row of a
 * 96px square picture beside the title and summary, wrapping under it on a
 * phone) and
 * "Titles only" (linked titles alone). Every binding is an ordinary one, on
 * the item, so the author can change any of it after.
 *
 * Pure: the same fields give the same blocks, apart from their new ids.
 *
 * @module collection-list-item
 */
import {
  BASE_BREAKPOINT,
  fieldFitsProp,
  findNode,
  getBlock,
  makeNode,
  type PropSchema,
  type BlockDocument,
  type BlockNode,
  type NodeStyles,
  type StyleValues,
} from "@nextlyhq/blocks-engine";

import type { BuilderOp } from "./op-vocabulary";

/** The starting layouts an author picks from. */
export type StartingLayout = "cards" | "rows" | "titles";

/** One field an entry has, as the collection's readable fields list it. */
export interface ItemField {
  readonly name: string;
  readonly type: string;
  readonly hasMany?: boolean;
  readonly relationTo?: string | readonly string[];
  /**
   * For an upload field: whether it takes images. Absent, an upload field is
   * taken to: the media library is mostly pictures, and an Image bound to a
   * file that is not one draws its fallback.
   */
  readonly takesImages?: boolean;
}

/** What the rule reads of a collection. */
export interface ItemSource {
  readonly slug: string;
  /** The field the admin titles its entries by, where it says. */
  readonly titleField?: string;
  /** Whether its entries are served as pages of their own. */
  readonly entriesHavePages?: boolean;
  /** Every field a visitor may read. */
  readonly readable?: readonly ItemField[];
  /**
   * Whether a list may sort it by the date its entries were created on: a
   * collection with timestamps turned off has no such field, and a list
   * sorting by it is refused when saved.
   */
  readonly sortsByCreated?: boolean;
}

/** The fields the item binds, by role; `undefined` for a role with none. */
export interface ItemFields {
  readonly title?: string;
  readonly picture?: string;
  readonly summary?: string;
  /** Whether the title links to the entry's page. */
  readonly link: boolean;
}

/** The field types that hold longer words, as plain text. */
const LONG_TEXT_TYPES = new Set(["textarea"]);

/** Names a title field goes by, where the collection names none. */
const TITLE_NAMES = ["title", "name"];

/** Names a summary goes by, best first. */
const SUMMARY_NAMES = ["excerpt", "summary", "description", "intro", "subtitle"];

/**
 * Whether `field` may fill `prop` of `blockType` as it is: the engine's one
 * binding rule (`fieldFitsProp`), the rule a save judges the page by, so the
 * item never carries a binding the save refuses.
 */
function fits(field: ItemField, blockType: string, prop: string): boolean {
  const schema = (getBlock(blockType)?.props as Record<string, PropSchema | undefined> | undefined)?.[prop];
  if (schema === undefined) return false;
  return fieldFitsProp(
    {
      name: field.name,
      type: field.type,
      ...(field.hasMany === true ? { hasMany: true } : {}),
      ...(field.relationTo === undefined ? {} : { relationTo: field.relationTo }),
    },
    schema
  );
}

/** Whether `field` fills an Image's picture: the rule's answer, and an upload that takes images. */
function holdsPicture(field: ItemField): boolean {
  return field.takesImages !== false && fits(field, "core/image", "mediaId");
}

/** Whether `field` fills a Heading's words. */
function fillsTitle(field: ItemField): boolean {
  return fits(field, "core/heading", "text");
}

/** Whether `field` fills a Text's words. */
function fillsSummary(field: ItemField): boolean {
  return fits(field, "core/text", "text");
}

/** The fields the rule binds, read from the collection's readable fields. */
export function itemFieldsOf(source: ItemSource): ItemFields {
  const readable = source.readable ?? [];
  const single = readable.filter(field => field.hasMany !== true);
  const named = (
    names: readonly string[],
    takes: (field: ItemField) => boolean
  ): string | undefined => {
    for (const name of names) {
      const found = single.find(
        field => field.name.toLowerCase() === name && takes(field)
      );
      if (found !== undefined) return found.name;
    }
    return undefined;
  };
  // The admin's title field, where a heading may show it as it is: a number
  // or a date bound with no format is refused when the page is saved.
  const declaredTitle = single.find(
    field => field.name === source.titleField && fillsTitle(field)
  )?.name;
  const title = declaredTitle ?? named(TITLE_NAMES, fillsTitle);
  const summary =
    named(SUMMARY_NAMES, fillsSummary) ??
    single.find(
      field =>
        LONG_TEXT_TYPES.has(field.type) &&
        field.name !== title &&
        fillsSummary(field)
    )?.name;
  const picture = single.find(holdsPicture)?.name;
  return {
    ...(title === undefined ? {} : { title }),
    ...(picture === undefined ? {} : { picture }),
    ...(summary === undefined || summary === title ? {} : { summary }),
    link: source.entriesHavePages === true,
  };
}

/** A binding of a prop to the entry each repeat draws. */
function itemBinding(path: string) {
  return { $bind: path, source: "item" as const };
}

/** A block of `type` with its own defaults, or `undefined` while unknown. */
function blockOf(
  type: string,
  props: Record<string, unknown> = {},
  slots?: Record<string, BlockNode[]>
): BlockNode | undefined {
  const definition = getBlock(type);
  if (definition === undefined) return undefined;
  return makeNode(
    definition.name,
    definition.version,
    {
      ...structuredClone(
        (definition.defaultProps ?? {}) as Record<string, unknown>
      ),
      ...props,
    },
    slots
  );
}

/** `node` with these bindings and base style values added. */
function dressed(
  node: BlockNode | undefined,
  bindings: BlockNode["bindings"],
  base?: Record<string, string>
): BlockNode | undefined {
  if (node === undefined) return undefined;
  const styles: NodeStyles | undefined =
    base === undefined ? undefined : { base: { base } };
  return {
    ...node,
    ...(bindings === undefined ? {} : { bindings }),
    ...(styles === undefined ? {} : { styles }),
  };
}

/** The entry's title, linked to its page where entries have one. */
function titleBlock(
  fields: ItemFields,
  slug: string
): BlockNode | undefined {
  if (fields.title === undefined) return undefined;
  const linked = fields.link;
  return dressed(
    blockOf("core/heading", {
      level: "h3",
      ...(linked ? { entryCollection: slug } : {}),
    }),
    {
      text: itemBinding(fields.title),
      ...(linked ? { entryId: itemBinding("id") } : {}),
    }
  );
}

/** The entry's picture, shaped by `base`. */
function pictureBlock(
  fields: ItemFields,
  base: Record<string, string>
): BlockNode | undefined {
  if (fields.picture === undefined) return undefined;
  return dressed(
    blockOf("core/image"),
    { mediaId: itemBinding(fields.picture) },
    base
  );
}

/** The entry's summary. */
function summaryBlock(fields: ItemFields): BlockNode | undefined {
  if (fields.summary === undefined) return undefined;
  return dressed(blockOf("core/text"), { text: itemBinding(fields.summary) });
}

/** The blocks that are present, in order. */
function present(...nodes: (BlockNode | undefined)[]): BlockNode[] {
  return nodes.filter((node): node is BlockNode => node !== undefined);
}

/**
 * The blocks of the list's item for `layout`: what its repeated slot holds.
 * Empty where the collection has none of the fields the layout shows, which
 * leaves an empty item, as Skip does.
 */
export function startingItem(
  source: ItemSource,
  layout: StartingLayout
): BlockNode[] {
  const fields = itemFieldsOf(source);
  const title = titleBlock(fields, source.slug);
  if (layout === "titles") return present(title);
  if (layout === "cards") {
    const inside = present(
      pictureBlock(fields, {
        width: "100%",
        aspectRatio: "16 / 9",
        objectFit: "cover",
      }),
      title,
      summaryBlock(fields)
    );
    if (inside.length === 0) return [];
    const card = blockOf("core/card", {}, { children: inside });
    return present(card);
  }
  const words = present(title, summaryBlock(fields));
  const stack =
    words.length === 0
      ? undefined
      : dressed(blockOf("core/box", {}, { children: words }), undefined, {
          display: "flex",
          flexDirection: "column",
          gap: "0.25rem",
          minWidth: "0",
          // Beside the picture while the row has room for 12rem of words,
          // under it on a phone: the row wraps, with no device to name.
          flex: "1 1 12rem",
        });
  const picture = pictureBlock(fields, {
    width: "96px",
    height: "96px",
    aspectRatio: "1 / 1",
    objectFit: "cover",
    flex: "none",
  });
  const inside = present(picture, stack);
  if (inside.length === 0) return [];
  // A row only where there are two things to set side by side.
  if (inside.length === 1) return inside;
  return present(
    dressed(blockOf("core/box", {}, { children: inside }), undefined, {
      display: "flex",
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "flex-start",
      gap: "1rem",
    })
  );
}

/**
 * The style values the list itself takes for `layout`, at its base: Cards
 * lay the items in a grid, three across where there is room and one under
 * a phone's width, with no device to name (the Gallery's own default grid);
 * Titles only sets them closer together. List rows keep the list's own
 * spacing.
 */
function startingListStyles(
  layout: StartingLayout
): Record<string, string> | undefined {
  switch (layout) {
    case "cards":
      return {
        display: "grid",
        gridTemplateColumns:
          "repeat(auto-fit, minmax(max(calc(33.333% - 2rem), min(100%, 20rem)), 1fr))",
        gap: "1.5rem",
      };
    case "titles":
      return { gap: "0.5rem" };
    case "rows":
      return undefined;
  }
}

/** The slot of a list that its item is built in, repeated per entry. */
const ITEM_SLOT = "children";

/**
 * What choosing a source and a starting layout writes to a list, as ops to
 * apply together (ONE step): the source and the layout's own style values on
 * the list, whatever its item held taken out, and the item built for the
 * layout put in. `skip` sets the source and leaves an empty item to build.
 * `null` where there is no such list.
 */
export function planStartingList(
  document: BlockDocument,
  listId: string,
  source: ItemSource,
  layout: StartingLayout | "skip"
): BuilderOp[] | null {
  const list = findNode(document.nodes, listId);
  if (list === undefined) return null;
  const own = layout === "skip" ? undefined : startingListStyles(layout);
  const base: StyleValues = {
    ...(list.styles?.base?.[BASE_BREAKPOINT] ?? {}),
    ...own,
  };
  // A new list's Newest first sorts by `createdAt`, which a collection with
  // timestamps off does not have: there the list keeps no sort and draws in
  // the order its entries were created.
  const props: Record<string, unknown> = {
    ...list.props,
    collection: source.slug,
  };
  if (source.sortsByCreated === false && props.sort === "-createdAt") {
    delete props.sort;
  }
  const update: BuilderOp = {
    kind: "update",
    id: listId,
    patch: {
      props,
      ...(own === undefined
        ? {}
        : {
            styles: {
              ...list.styles,
              base: { ...list.styles?.base, [BASE_BREAKPOINT]: base },
            },
          }),
    },
  };
  const removed: BuilderOp[] = (list.slots?.[ITEM_SLOT] ?? []).map(child => ({
    kind: "remove",
    id: child.id,
  }));
  const item = layout === "skip" ? [] : startingItem(source, layout);
  const inserted: BuilderOp[] = item.map((node, index) => ({
    kind: "insert",
    node,
    at: { parentId: listId, slot: ITEM_SLOT, index },
  }));
  return [update, ...removed, ...inserted];
}
