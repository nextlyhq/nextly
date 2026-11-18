/**
 * What a panel control writes, in the words a developer reads: CSS as
 * `property: value` declarations joined by `; `, HTML as the tag or the
 * attribute. One function per kind of control, so a tooltip and the "Show
 * CSS names" line say the same thing for the same control.
 *
 * @module code-hints
 */
import {
  compileStyleValues,
  type PropSchema,
  type StyleLeaf,
} from "@nextlyhq/blocks-engine";

import { LAYOUT_CSS_NAMES, type LayoutWrite } from "./plain-layout";

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

/** A catalog control, as far as saying what it writes goes. */
export interface WritingControl {
  /** The catalog property the control writes. */
  readonly property: string;
  /** Where inside the property's value it writes, outermost first. */
  readonly path: readonly string[];
  readonly leaf: Pick<StyleLeaf, "cssProperty">;
}

/**
 * What a catalog control writes for a value: the declarations the engine
 * compiles it to, the page's own CSS (a URL wrapped, a keyword expanded, a
 * variable under the site's prefix), or its CSS property alone while it holds
 * nothing the engine writes. "min-height: 40px"; "flex-direction: column".
 */
export function controlWrites(
  control: WritingControl,
  value: unknown,
  tokenPrefix: string
): string {
  if (value === undefined || value === null) return control.leaf.cssProperty;
  const nested = control.path.reduceRight<unknown>(
    (inner, key) => ({ [key]: inner }),
    value
  );
  const { declarations } = compileStyleValues(
    { [control.property]: nested },
    "",
    tokenPrefix
  );
  return declarations.length === 0
    ? control.leaf.cssProperty
    : declarationsText(declarations);
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
}): {
  readonly small: string;
  readonly medium: string;
  readonly large: string;
} {
  const scaled = (size: { times: number; text: string }) =>
    declarationsText([
      { property: "padding", value: `calc(<padding> * ${String(size.times)})` },
      { property: "font-size", value: size.text },
    ]);
  return {
    small: scaled(sizes.small),
    medium: declarationsText([
      { property: "padding" },
      { property: "font-size" },
    ]),
    large: scaled(sizes.large),
  };
}

/** What an Icon's Size shortcut writes: its font size alone, Medium clearing it. */
export function iconSizeShortcutWrites(sizes: {
  readonly small: string;
  readonly large: string;
}): {
  readonly small: string;
  readonly medium: string;
  readonly large: string;
} {
  return {
    small: declarationsText([{ property: "font-size", value: sizes.small }]),
    medium: declarationsText([{ property: "font-size" }]),
    large: declarationsText([{ property: "font-size", value: sizes.large }]),
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

/** The widths a device covers: from its lower bound up to its upper one. */
export interface DeviceRange {
  /** Its narrowest width, `undefined` for the narrowest device. */
  readonly from?: number | undefined;
  /** Its widest width, `undefined` for the widest device. */
  readonly to?: number | undefined;
}

/**
 * What Hide on writes for one device: `display: none` at that device's widths
 * alone. "display: none at 768–1023px"; the widest device has no upper bound
 * and the narrowest no lower one.
 */
export function hideOnWrites({ from, to }: DeviceRange): string {
  const hidden = declarationsText([{ property: "display", value: "none" }]);
  if (from !== undefined && to !== undefined) {
    return `${hidden} at ${String(from)}–${String(to)}px`;
  }
  if (from !== undefined) return `${hidden} at ${String(from)}px and wider`;
  if (to !== undefined) return `${hidden} at ${String(to)}px and narrower`;
  return hidden;
}

/** What an HTML tag menu writes for a tag: the element, `<section>`. */
export function tagWrites(tag: string): string {
  return `<${tag}>`;
}

/**
 * What a plain layout choice writes, from the writes it plans, so the hint
 * can't disagree with the write. A cleared value writes nothing; a choice
 * that only clears says the block flow it leaves.
 */
export function layoutWritesText(writes: readonly LayoutWrite[]): string {
  const declarations = writes
    .filter(write => write.value !== null)
    .map(write => ({
      property: LAYOUT_CSS_NAMES[write.property] ?? write.property,
      value: write.value ?? undefined,
    }));
  return declarations.length === 0
    ? "display: block"
    : declarationsText(declarations);
}
