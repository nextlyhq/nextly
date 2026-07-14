import { defineBlock } from "../../core/registry";

import { renderMarkdown } from "./markdown";
import { str } from "./util";

/** Collapsible sections via native <details> — server-rendered, accessible, no JS. */
export const accordion = defineBlock({
  type: "core/accordion",
  version: 1,
  label: "Accordion",
  icon: "Layers",
  category: "layout",
  defaultProps: {
    multiOpen: false,
    items: [
      { title: "Section one", content: "Content for the first section." },
      { title: "Section two", content: "Content for the second section." },
    ],
  },
  contentFields: [
    { name: "multiOpen", type: "boolean", label: "Allow multiple open" },
    {
      name: "items",
      type: "repeater",
      label: "Sections",
      addLabel: "Add section",
      itemFields: [
        { name: "title", type: "text", label: "Title" },
        { name: "content", type: "textarea", label: "Content (Markdown)" },
      ],
    },
  ],
  supports: {
    spacing: true,
    border: true,
    visibility: true,
    customCss: true,
    customAttributes: true,
  },
  render: ({ props, node, className }) => {
    const items = Array.isArray(props.items) ? props.items : [];
    const single = props.multiOpen !== true;
    return (
      <div className={className}>
        {items.map((raw, i) => {
          const it = (raw ?? {}) as Record<string, unknown>;
          return (
            <details
              key={i}
              open={i === 0}
              name={single ? `acc-${node.id}` : undefined}
              style={{ borderBottom: "1px solid #e5e7eb" }}
            >
              <summary
                style={{
                  cursor: "pointer",
                  padding: "10px 0",
                  fontWeight: 600,
                }}
              >
                {str(it.title, `Section ${i + 1}`)}
              </summary>
              <div style={{ padding: "0 0 10px" }}>
                {renderMarkdown(str(it.content))}
              </div>
            </details>
          );
        })}
      </div>
    );
  },
});
