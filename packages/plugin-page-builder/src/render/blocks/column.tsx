import { columnStructure } from "../../core/block-structure";
import { defineBlock } from "../../core/registry";

import { str } from "./util";

/**
 * One cell of a `core/columns` row.
 *
 * Exists so a column is a block rather than a wrapper. The row used to build an
 * anonymous flex child around each of its children, which meant a column had no
 * identity: nothing to select, nothing to give a width, a background or an
 * alignment to, and nothing an author could target at a breakpoint. Naming it
 * gives every one of those a home for free, because a block already has props,
 * styles and supports.
 *
 * `width` is authored as a CSS length or left empty. Empty means "share the
 * remaining space equally", which is what a row of columns should do before
 * anyone has said otherwise — so the common case needs no decision, and the
 * uncommon one is a single field.
 */
export const column = defineBlock({
  // Structure spread in rather than restated, so the slot this block draws and
  // the slot the validator enforces cannot drift apart.
  ...columnStructure,
  version: 1,
  label: "Column",
  icon: "Columns",
  category: "layout",
  defaultProps: { width: "", verticalAlign: "" },
  contentFields: [
    {
      name: "width",
      type: "text",
      label: "Width",
      placeholder: "auto",
    },
    {
      name: "verticalAlign",
      type: "select",
      label: "Vertical align",
      options: ["", "flex-start", "center", "flex-end", "stretch"].map(v => ({
        value: v,
        label: v === "" ? "inherit from row" : v,
      })),
    },
  ],
  supports: {
    color: { background: true, link: true },
    background: true,
    spacing: true,
    border: true,
    shadow: true,
    dimensions: { minHeight: true },
    visibility: true,
    customCss: true,
    customAttributes: true,
  },
  render: ({ props, slots, className }) => {
    const width = str(props.width, "");
    const align = str(props.verticalAlign, "");
    return (
      <div
        className={className}
        style={{
          // A stated width is honoured exactly; an empty one shares the row.
          // `minWidth: 0` in both cases, because a flex item defaults to
          // `min-width: auto` and refuses to shrink below its content — which
          // is how one long unbroken string pushes a whole row out of its
          // container.
          ...(width === ""
            ? { flex: "1 1 240px" }
            : { flex: `0 0 ${width}`, width }),
          minWidth: 0,
          ...(align === "" ? {} : { alignSelf: align }),
        }}
      >
        {slots.default}
      </div>
    );
  },
});
