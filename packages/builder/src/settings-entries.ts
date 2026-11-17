/**
 * The selected block's settings as entries of the settings index, read from
 * what each tab draws: the block's inspection for Content and Advanced (with
 * the builder's own Visibility and HTML rows), the Style tab's sections for
 * Style.
 *
 * @module settings-entries
 */
import type { BlockNode, PropSchema } from "@nextlyhq/blocks-engine";

import { BUILT_IN_WRITES } from "./code-hints";
import {
  advancedRowsBySection,
  HTML_SECTION,
  VISIBILITY_SECTION,
} from "./inspector-advanced-tab";
import {
  builderContentSectionOf,
  type BlockInspection,
  type EditableProp,
} from "./inspector";
import { offersNeverQuote } from "./never-quote";
import { propLabel } from "./prop-label";
import {
  sectionEntries,
  type IndexedRow,
  type SettingEntry,
} from "./settings-index";
import type { StyleSection } from "./style-inspector";

/** What a prop writes into the page, every spelling its schema gives. */
function writesOf(schema: Pick<PropSchema, "code">): readonly string[] {
  const { code } = schema;
  if (code === undefined) return [];
  return typeof code === "string" ? [code] : Object.values(code);
}

/** A drawn prop as an index row. */
function propRow(row: EditableProp): IndexedRow {
  return {
    id: row.name,
    label: propLabel(row.name, row.schema),
    options: row.options,
    css: writesOf(row.schema),
    set: row.value !== undefined,
  };
}

/** The props a section draws. */
function drawnRows(rows: readonly EditableProp[]): IndexedRow[] {
  return rows.filter(row => row.offered).map(propRow);
}

/** The Content tab's settings: the builder's own section, then the block's. */
export function contentEntries(inspection: BlockInspection): SettingEntry[] {
  const own = builderContentSectionOf(inspection.blockName);
  const builder =
    own === undefined
      ? []
      : sectionEntries("content", { key: own, label: own }, [
          { id: `builder:${own}`, label: own, set: false },
        ]);
  const sections = inspection.sections.content;
  if (sections.length === 0) {
    // A block with no sections draws its rows bare.
    return sectionEntries(
      "content",
      { key: "", label: "" },
      drawnRows(inspection.props.filter(row => row.schema.group !== "style"))
    );
  }
  return [
    ...builder,
    ...sections.flatMap(section =>
      sectionEntries(
        "content",
        { key: section.label, label: section.label },
        drawnRows(section.rows)
      )
    ),
  ];
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
  const { htmlRows, visibilityRows, others } = advancedRowsBySection(
    inspection.sections.advanced
  );
  const conditions = node?.visibility?.conditions;
  const visibility: IndexedRow[] = [
    { id: "visibleOn", label: "Visible on", set: hiddenSomewhere(node) },
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
    ...drawnRows(visibilityRows),
  ];
  const { cssId, attributes } = inspection.html;
  const otherAttributes = Object.keys(attributes ?? {}).filter(
    name => name !== "class"
  );
  const html: IndexedRow[] = [
    ...drawnRows(htmlRows),
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
      set: (attributes?.class ?? "") !== "",
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
        drawnRows(section.rows)
      )
    ),
  ];
}

/** The CSS properties a Style property's controls write. */
function cssOf(property: StyleSection["properties"][number]): string[] {
  const names = new Set<string>();
  for (const control of property.controls) {
    if ("cssProperty" in control.leaf) names.add(control.leaf.cssProperty);
  }
  return [...names];
}

/**
 * The Style tab's settings: each section's properties, and the block's own
 * settings it draws there (Content width, a Section's Height), under the
 * section that draws them.
 */
export function styleEntries(
  sections: readonly StyleSection[],
  inspection: BlockInspection | null
): SettingEntry[] {
  const props = inspection?.sections.styleProps ?? [];
  return sections.flatMap(section => {
    const own = props.find(each => each.key === section.key)?.rows ?? [];
    return sectionEntries("style", section, [
      ...drawnRows(own),
      ...section.properties.map(property => ({
        id: property.property,
        label: property.label,
        css: cssOf(property),
        set: property.set,
      })),
    ]);
  });
}
