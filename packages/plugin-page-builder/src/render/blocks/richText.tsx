import { defineBlock } from "../../core/registry";

import { renderMarkdown } from "./markdown";
import { str } from "./util";

/**
 * Long-form rich text authored as a safe Markdown subset (bold/italic/code/links,
 * headings, lists). Rendered to known-safe elements — no raw HTML. A full Lexical
 * WYSIWYG (reusing Nextly's editor) is the planned richer authoring surface.
 */
export const richText = defineBlock({
  type: "core/rich-text",
  version: 1,
  label: "Rich Text",
  icon: "Type",
  category: "basic",
  defaultProps: {
    markdown:
      "## Heading\n\nSome **bold** and *italic* text with a [link](https://example.com).\n\n- First point\n- Second point",
  },
  contentFields: [
    {
      name: "markdown",
      type: "textarea",
      label: "Content (Markdown)",
      bindable: true,
    },
  ],
  supports: {
    typography: true,
    color: { text: true },
    spacing: true,
    border: true,
    visibility: true,
    customCss: true,
    customAttributes: true,
  },
  render: ({ props, className }) => (
    <div className={className}>{renderMarkdown(str(props.markdown))}</div>
  ),
});
