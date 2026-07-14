import { defineBlock } from "../../core/registry";

import { renderMarkdown } from "./markdown";
import { str } from "./util";

/**
 * Tabs via the CSS radio-hack — server-rendered, no client JS. Each instance emits a
 * small scoped <style> keyed by node id (globally unique) so instances don't collide.
 * Without CSS support, all panels remain visible (graceful degradation).
 */
export const tabs = defineBlock({
  type: "core/tabs",
  version: 1,
  label: "Tabs",
  icon: "Layers",
  category: "layout",
  defaultProps: {
    items: [
      { title: "Tab one", content: "First tab content." },
      { title: "Tab two", content: "Second tab content." },
    ],
  },
  contentFields: [
    {
      name: "items",
      type: "repeater",
      label: "Tabs",
      addLabel: "Add tab",
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
    const id = node.id;
    const rules = items
      .map(
        (_, i) =>
          `#nx-tab-${id}-${i}:checked~.nx-pb-tab-panels-${id}>div:nth-child(${i + 1}){display:block}` +
          `#nx-tab-${id}-${i}:checked~.nx-pb-tab-labels-${id}>label:nth-child(${i + 1}){border-bottom-color:#4f46e5;font-weight:600}`
      )
      .join("");
    const css = `.nx-pb-tab-panels-${id}>div{display:none}${rules}`;
    return (
      <div className={className}>
        <style dangerouslySetInnerHTML={{ __html: css }} />
        {items.map((_, i) => (
          <input
            key={`r${i}`}
            type="radio"
            name={`nx-tabs-${id}`}
            id={`nx-tab-${id}-${i}`}
            defaultChecked={i === 0}
            style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
          />
        ))}
        <div
          className={`nx-pb-tab-labels-${id}`}
          style={{
            display: "flex",
            gap: 4,
            flexWrap: "wrap",
            borderBottom: "1px solid #e5e7eb",
          }}
        >
          {items.map((raw, i) => (
            <label
              key={`l${i}`}
              htmlFor={`nx-tab-${id}-${i}`}
              style={{
                padding: "8px 14px",
                cursor: "pointer",
                borderBottom: "2px solid transparent",
              }}
            >
              {str((raw as Record<string, unknown>)?.title, `Tab ${i + 1}`)}
            </label>
          ))}
        </div>
        <div className={`nx-pb-tab-panels-${id}`}>
          {items.map((raw, i) => (
            <div key={`p${i}`} style={{ padding: "14px 0" }}>
              {renderMarkdown(str((raw as Record<string, unknown>)?.content))}
            </div>
          ))}
        </div>
      </div>
    );
  },
});
