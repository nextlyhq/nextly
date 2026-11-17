/**
 * What a panel control writes, in the words a developer reads: CSS as
 * `property: value` declarations joined by `; `, HTML as the tag or the
 * attribute. One function per kind of control, so a tooltip and the "Show
 * CSS names" line say the same thing for the same control.
 *
 * @module code-hints
 */
import {
  isTokenRef,
  scaledTokenText,
  tokenCustomProperty,
  type PropSchema,
  type StyleLeaf,
} from "@nextlyhq/blocks-engine";

/** One declaration: its property, and its value where one is known. */
export interface WrittenDeclaration {
  readonly property: string;
  readonly value?: string | undefined;
}

/** Declarations as a developer writes them: `a: b; c: d`. */
export function declarationsText(
  declarations: readonly WrittenDeclaration[]
): string {
  return declarations
    .map(({ property, value }) =>
      value === undefined || value === "" ? property : `${property}: ${value}`
    )
    .join("; ");
}

/**
 * A stored style value as text, where it is one a declaration can show: a
 * variable as the page's stylesheet names it, under the site's prefix.
 */
function valueText(value: unknown, tokenPrefix: string): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (isTokenRef(value)) {
    return scaledTokenText(
      `var(${tokenCustomProperty(value.$token, tokenPrefix)})`,
      value.times
    );
  }
  return undefined;
}

/**
 * What a catalog control writes: its leaf's CSS property, with the value it
 * holds or the option it offers. "min-height: 40px"; "flex-direction: column".
 */
export function leafWrites(
  leaf: StyleLeaf,
  value: unknown,
  tokenPrefix: string
): string {
  return declarationsText([
    { property: leaf.cssProperty, value: valueText(value, tokenPrefix) },
  ]);
}

/**
 * What a block's own setting writes, from its `code` hint: the one string for
 * the setting, or the one for the option it holds. `undefined` where the
 * setting declares none.
 */
export function propWrites(
  schema: Pick<PropSchema, "code">,
  value?: unknown
): string | undefined {
  const { code } = schema;
  if (typeof code === "string") return code;
  if (code === undefined || typeof value !== "string") return undefined;
  return code[value];
}

/** What a Section's Height shortcut writes, by choice. */
export function heightShortcutWrites(fullScreen: string): {
  readonly auto: string;
  readonly screen: string;
} {
  return {
    auto: declarationsText([{ property: "min-height", value: "auto" }]),
    screen: declarationsText([{ property: "min-height", value: fullScreen }]),
  };
}

/** What a Button's Size shortcut writes, by choice. */
export function sizeShortcutWrites(sizes: {
  readonly small: { readonly times: number; readonly text: string };
  readonly large: { readonly times: number; readonly text: string };
}): { readonly small: string; readonly medium: string; readonly large: string } {
  const scaled = (size: { times: number; text: string }) =>
    declarationsText([
      { property: "padding", value: `calc(<padding> * ${String(size.times)})` },
      { property: "font-size", value: size.text },
    ]);
  return {
    small: scaled(sizes.small),
    medium: declarationsText([{ property: "padding" }, { property: "font-size" }]),
    large: scaled(sizes.large),
  };
}

/** What a Button's Full width shortcut writes. */
export const FULL_WIDTH_WRITES: string = declarationsText([
  { property: "width", value: "100%" },
]);

/** What the builder's own Advanced rows write, by row. */
export const BUILT_IN_WRITES = {
  /** Anchor (ID): the root element's `id`. */
  anchor: "id",
  /** CSS classes: names added to the root element's `class`. */
  cssClasses: "class",
  /** Keep out of search previews. */
  searchPreviews: "data-nosnippet",
} as const;

/** What an HTML tag menu writes for a tag: the element, `<section>`. */
export function tagWrites(tag: string): string {
  return `<${tag}>`;
}
