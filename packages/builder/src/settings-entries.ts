/**
 * The selected block's settings as entries of the settings index, read from
 * what each tab draws: the block's inspection for Content and Advanced (with
 * the builder's own Visibility and HTML rows), the Style tab's sections for
 * Style.
 *
 * @module settings-entries
 */
import {
  BASE_BREAKPOINT,
  type BlockNode,
  type BreakpointSet,
  type PropSchema,
} from "@nextlyhq/blocks-engine";

import {
  ACCORDION_BLOCK,
  ACCORDION_ICON_WORDS,
  ACCORDION_ICONS,
  accordionIconHoldsValue,
} from "./accordion-icon";
import {
  BUTTON_BLOCK,
  ICON_BLOCK,
  SECTION_BLOCK,
  sizesOffered,
  type ShortcutAt,
} from "./block-shortcuts";
import {
  HEIGHT_LABELS,
  SHORTCUT_IDS,
  SIZE_LABELS,
} from "./block-shortcuts-field";
import { BUILT_IN_WRITES } from "./code-hints";
import {
  COLUMNS_LAYOUTS,
  COLUMNS_ROW,
  stackOf,
  stackTiers,
} from "./columns-layout";
import { CONTENT_WIDTH_CHOICES } from "./content-width-control";
import {
  addableRows,
  arrangeCssProperties,
  CSS_PROPERTIES_SECTION,
  writtenCss,
  type CssPropertyRow,
} from "./css-properties";
import {
  galleryColumnsHoldValue,
  GALLERY_COLUMNS,
  GALLERY_MOBILE,
} from "./gallery-columns";
import { GALLERY_BLOCK } from "./gallery-pictures";
import {
  builderContentSectionsOf,
  contentRowsOf,
  type BlockInspection,
  type EditableProp,
} from "./inspector";
import {
  advancedRowsBySection,
  HTML_SECTION,
  VISIBILITY_SECTION,
} from "./inspector-advanced-tab";
import { offersNeverQuote } from "./never-quote";
import {
  childAxisRows,
  LAYOUT_CSS_NAMES,
  offersChildAxis,
  type ChildAxis,
  type ParentArrangement,
  type PlainFlow,
} from "./plain-layout";
import { CHILD_SIZE_IDS } from "./plain-parent-controls";
import { propLabel } from "./prop-label";
import {
  sectionEntries,
  type IndexedRow,
  type SettingEntry,
} from "./settings-index";
import type { StyleSection } from "./style-inspector";
import { keywordLabel } from "./style-keyword-labels";
import { readStyleValue } from "./style-values";

/** What a prop writes into the page, every spelling its schema gives. */
function writesOf(schema: Pick<PropSchema, "code">): readonly string[] {
  const { code } = schema;
  if (code === undefined) return [];
  return typeof code === "string" ? [code] : Object.values(code);
}

/** An option's label, where the schema names one. */
function optionLabelOf(schema: PropSchema, option: string): string {
  const labels = (schema as { optionLabels?: Readonly<Record<string, string>> })
    .optionLabels;
  return labels?.[option] ?? option;
}

/** A drawn prop as an index row; a binding of its own counts as set. */
function propRow(row: EditableProp, bound: ReadonlySet<string>): IndexedRow {
  return {
    id: row.name,
    label: propLabel(row.name, row.schema),
    // As the author reads them: a select's labels, not its stored values.
    options: row.options.map(option => optionLabelOf(row.schema, option)),
    css: writesOf(row.schema),
    set: row.value !== undefined || bound.has(row.name),
  };
}

/** The props a block binds to data, which hold a setting of their own. */
function boundProps(node: BlockNode | undefined): ReadonlySet<string> {
  const bindings = (node as { bindings?: Record<string, unknown> } | undefined)
    ?.bindings;
  return new Set(Object.keys(bindings ?? {}));
}

/** The props a section draws. */
function drawnRows(
  rows: readonly EditableProp[],
  bound: ReadonlySet<string>
): IndexedRow[] {
  return rows.filter(row => row.offered).map(row => propRow(row, bound));
}

/**
 * The controls a Gallery's builder-drawn sections hold: Add images in
 * Pictures, and Columns and On mobile in Layout, the latter only where the
 * site has a mobile tier, as the section draws it.
 */
function galleryRows(
  node: BlockNode,
  section: string,
  breakpoints: BreakpointSet | undefined
): IndexedRow[] {
  if (section === "Pictures") {
    return [{ id: "galleryAddImages", label: "Add images", set: false }];
  }
  const tiers = stackTiers(breakpoints);
  const set = galleryColumnsHoldValue(node, tiers);
  const columns: IndexedRow = {
    id: "galleryColumns",
    label: "Columns",
    options: GALLERY_COLUMNS.map(String),
    css: ["grid-template-columns"],
    set,
  };
  if (tiers.mobile === undefined) return [columns];
  return [
    columns,
    {
      id: "galleryMobile",
      label: "On mobile",
      options: GALLERY_MOBILE.map(String),
      css: ["grid-template-columns"],
      set,
    },
  ];
}

/**
 * The controls a builder-drawn Content section holds: Columns' Layout tiles,
 * Stack on and its Reverse, set as the section's own dot says; a Gallery's,
 * by section.
 */
function builderRows(
  node: BlockNode | undefined,
  breakpoints: BreakpointSet | undefined,
  section: string
): IndexedRow[] {
  if (node?.type === GALLERY_BLOCK) {
    return galleryRows(node, section, breakpoints);
  }
  // An Accordion's Icon: the questions' icon, a style value.
  if (node?.type === ACCORDION_BLOCK) {
    return [
      {
        id: "disclosureIcon",
        label: "Icon",
        options: ACCORDION_ICONS.map(each => ACCORDION_ICON_WORDS[each]),
        set: accordionIconHoldsValue(node),
      },
    ];
  }
  if (node === undefined || node.type !== COLUMNS_ROW) return [];
  const tiers = stackTiers(breakpoints);
  const template = readStyleValue(node.styles, {
    state: "base",
    breakpoint: BASE_BREAKPOINT,
    property: "gridTemplateColumns",
    path: [],
  });
  const stacked = stackOf(node, tiers, "base").on !== "never";
  const layout: IndexedRow = {
    id: "columnsLayout",
    label: "Layout",
    // The tiles' own words: "2 equal", "Wide left".
    options: COLUMNS_LAYOUTS.map(each => each.label),
    css: ["grid-template-columns"],
    set: template !== undefined,
  };
  // Stack on is drawn only where the site has a tablet or mobile tier.
  if (tiers.tablet === undefined && tiers.mobile === undefined) return [layout];
  return [
    layout,
    { id: "stackOn", label: "Stack on", css: ["flex-direction"], set: stacked },
    {
      id: "reverseStacked",
      label: "Reverse when stacked",
      css: ["flex-direction"],
      set: stacked,
    },
  ];
}

/** The Content tab's settings: the builder's own section, then the block's. */
export function contentEntries(
  inspection: BlockInspection,
  node: BlockNode | undefined,
  breakpoints?: BreakpointSet
): SettingEntry[] {
  const bound = boundProps(node);
  // The builder's own sections come first, drawn whatever else the tab holds.
  const builder = builderContentSectionsOf(inspection.blockName).flatMap(own =>
    sectionEntries(
      "content",
      { key: own, label: own },
      builderRows(node, breakpoints, own)
    )
  );
  const sections = inspection.sections.content;
  if (sections.length === 0 && builder.length === 0) {
    // A block with no sections draws its Content rows bare.
    return sectionEntries(
      "content",
      { key: "", label: "" },
      drawnRows(contentRowsOf(inspection), bound)
    );
  }
  const own = sections.flatMap(section =>
    sectionEntries(
      "content",
      { key: section.label, label: section.label },
      drawnRows(section.rows, bound)
    )
  );
  // An Accordion's Icon is drawn after its Behaviour, so it is read there.
  return inspection.blockName === ACCORDION_BLOCK
    ? [...own, ...builder]
    : [...builder, ...own];
}

/** Whether a block is hidden on any device. */
function hiddenSomewhere(node: BlockNode | undefined): boolean {
  const devices = node?.visibility?.devices;
  return devices !== undefined && Object.values(devices).some(shown => !shown);
}

/** The Advanced tab's settings: Visibility, HTML, then the block's own. */
export function advancedEntries(
  inspection: BlockInspection,
  node: BlockNode | undefined
): SettingEntry[] {
  const bound = boundProps(node);
  const { htmlRows, visibilityRows, others } = advancedRowsBySection(
    inspection.sections.advanced
  );
  const conditions = node?.visibility?.conditions;
  const visibility: IndexedRow[] = [
    { id: "hideOn", label: "Hide on", set: hiddenSomewhere(node) },
    {
      id: "showWhen",
      label: "Show when",
      set: Array.isArray(conditions) && conditions.length > 0,
    },
    ...(node !== undefined && offersNeverQuote(node)
      ? [
          {
            id: "neverQuote",
            label: "Keep out of search previews",
            css: [BUILT_IN_WRITES.searchPreviews],
            set: node.nosnippet === true,
          },
        ]
      : []),
    ...drawnRows(visibilityRows, bound),
  ];
  const { cssId, attributes } = inspection.html;
  const otherAttributes = Object.keys(attributes ?? {}).filter(
    name => name !== "class"
  );
  const html: IndexedRow[] = [
    ...drawnRows(htmlRows, bound),
    {
      id: "anchor",
      label: "Anchor (ID)",
      css: [BUILT_IN_WRITES.anchor],
      set: cssId !== undefined,
    },
    {
      id: "cssClasses",
      label: "CSS classes",
      css: [BUILT_IN_WRITES.cssClasses],
      set: typeof node?.cssClasses === "string" && node.cssClasses !== "",
    },
    {
      id: "attributes",
      label: "Attributes",
      css: otherAttributes,
      set: otherAttributes.length > 0,
    },
  ];
  return [
    ...sectionEntries(
      "advanced",
      { key: "visibility", label: VISIBILITY_SECTION },
      visibility
    ),
    ...sectionEntries("advanced", { key: "html", label: HTML_SECTION }, html),
    ...others.flatMap(section =>
      sectionEntries(
        "advanced",
        { key: `own:${section.label}`, label: section.label },
        drawnRows(section.rows, bound)
      )
    ),
  ];
}

/**
 * A block setting Style draws with a control of its own, given that
 * control's choices: Content width's Boxed and Full width.
 */
function withDrawnChoices(row: IndexedRow): IndexedRow {
  if (row.id !== CONTAINED_PROP) return row;
  return {
    ...row,
    options: CONTENT_WIDTH_CHOICES.map(choice => choice.label),
  };
}

/** The prop Content width's choice is stored in. */
const CONTAINED_PROP = "contained";

/**
 * The shortcuts the Size section draws above its fields: a Section's Height,
 * a Button's Size and Full width, by the words they're drawn with, each set
 * where the block stores what it writes at the edited address.
 */
function shortcutRows(
  node: BlockNode | undefined,
  at: ShortcutAt
): IndexedRow[] {
  if (node === undefined) return [];
  const stores = (property: string) =>
    readStyleValue(node.styles, {
      state: at.state,
      breakpoint: at.breakpoint,
      property,
      path: [],
    }) !== undefined;
  if (node.type === SECTION_BLOCK) {
    return [
      {
        id: SHORTCUT_IDS.height,
        label: "Height",
        options: Object.values(HEIGHT_LABELS),
        css: ["min-height"],
        set: stores("minHeight"),
      },
    ];
  }
  if (node.type === ICON_BLOCK) {
    return [
      {
        id: SHORTCUT_IDS.size,
        label: "Size",
        options: Object.values(SIZE_LABELS),
        css: ["font-size"],
        set: stores("fontSize"),
      },
    ];
  }
  if (node.type !== BUTTON_BLOCK) return [];
  return [
    ...(sizesOffered(node)
      ? [
          {
            id: SHORTCUT_IDS.size,
            label: "Size",
            options: Object.values(SIZE_LABELS),
            css: ["padding", "font-size"],
            set: stores("padding") || stores("fontSize"),
          },
        ]
      : []),
    {
      id: SHORTCUT_IDS.fullWidth,
      label: "Full width",
      css: ["width"],
      set: stores("width"),
    },
  ];
}

/**
 * "Inside its parent"'s Width, and its Height under a Row or a Grid, by the
 * words they're drawn with, set where the block holds a share of its own.
 * None where the parent isn't known: nothing draws them.
 */
function childSizeRows(
  parent: ParentArrangement | undefined,
  sections: readonly StyleSection[],
  flow: PlainFlow | undefined
): IndexedRow[] {
  if (parent === undefined) return [];
  const choices = ["Fill", "Fit", "Fixed"];
  // Each axis is set by what it writes, wherever its rows are (a width is
  // Size's): a share's or an order's value says nothing of the other axis.
  const stored = new Set(
    sections
      .flatMap(section => section.properties)
      .filter(property => property.set)
      .map(property => property.property)
  );
  const holds = (properties: readonly string[]) =>
    properties.some(property => stored.has(property));
  return [
    {
      id: CHILD_SIZE_IDS.width,
      label: "Width",
      options: choices,
      css: cssNamesOf(written("width")),
      set: holds(written("width")),
    },
    ...(offersChildAxis(parent, "height", flow)
      ? [
          {
            id: CHILD_SIZE_IDS.height,
            label: "Height",
            options: choices,
            css: cssNamesOf(written("height")),
            set: holds(written("height")),
          },
        ]
      : []),
  ];

  /** What a size's choices write, its own size included. */
  function written(axis: ChildAxis): string[] {
    return [axis, ...childAxisRows(parent as ParentArrangement, axis, flow)];
  }
}

/** Layout properties by their CSS names, as a search spells them. */
function cssNamesOf(properties: readonly string[]): string[] {
  return properties.map(property => LAYOUT_CSS_NAMES[property] ?? property);
}

/**
 * A Style property's choices, in the words its controls draw them with
 * (Position's "Sticky"), so a choice is found by its name.
 */
function optionsOf(property: StyleSection["properties"][number]): string[] {
  const labels = new Set<string>();
  for (const control of property.controls) {
    const leaf = control.leaf as {
      readonly kind: string;
      readonly cssProperty?: string;
      readonly values?: readonly string[];
    };
    if (leaf.kind !== "keyword" || leaf.cssProperty === undefined) continue;
    for (const keyword of leaf.values ?? []) {
      labels.add(keywordLabel(leaf.cssProperty, keyword));
    }
  }
  return [...labels];
}

/**
 * "CSS properties"' settings: those holding a value, drawn as its rows, and
 * those the block can use but doesn't show, which a search offers to add. By
 * their plain names, found by their CSS names too.
 */
function cssPropertyEntries(extras: readonly CssPropertyRow[]): SettingEntry[] {
  const addable = new Set(addableRows(extras, new Set()));
  return sectionEntries(
    "style",
    CSS_PROPERTIES_SECTION,
    extras
      .filter(each => each.row.set || addable.has(each))
      .map(each => ({
        id: each.id,
        label: each.plainName,
        options: optionsOf(each.row),
        css: [each.cssName, ...writtenCss(each.row)],
        set: each.row.set,
        addable: !each.row.set,
      }))
  );
}

/**
 * The Style tab's settings: each section's properties it draws, and the
 * block's own settings it draws there (Content width, a Section's Height),
 * under the section that draws them; then "CSS properties".
 */
export function styleEntries(
  sections: readonly StyleSection[],
  inspection: BlockInspection | null,
  shortcuts?: { node: BlockNode | undefined; at: ShortcutAt },
  parent?: ParentArrangement,
  flow?: PlainFlow,
  arranges?: boolean
): SettingEntry[] {
  const props = inspection?.sections.styleProps ?? [];
  // Arranged as the tab draws them, so a search finds a row where it is
  // drawn, and nothing it doesn't draw.
  // The block's own shortcuts are drawn only where it is edited itself.
  const arranged = arrangeCssProperties(sections, {
    blockType: shortcuts?.node?.type,
    arranges,
  });
  return [
    ...arranged.sections.flatMap(section => {
      const own = props.find(each => each.key === section.key)?.rows ?? [];
      return sectionEntries("style", section, [
        ...(section.key === "inside-parent"
          ? childSizeRows(parent, sections, flow)
          : []),
        ...(section.key === "size" && shortcuts !== undefined
          ? shortcutRows(shortcuts.node, shortcuts.at)
          : []),
        ...drawnRows(own, new Set()).map(withDrawnChoices),
        ...section.properties
          .filter(property => property.common)
          .map(property => ({
            id: property.property,
            label: property.label,
            options: optionsOf(property),
            css: writtenCss(property),
            set: property.set,
          })),
      ]);
    }),
    ...cssPropertyEntries(arranged.extras),
  ];
}
