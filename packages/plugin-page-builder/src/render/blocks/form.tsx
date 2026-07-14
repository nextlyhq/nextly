import { defineBlock } from "../../core/registry";

import { safeUrl, str } from "./util";

const INPUT_TYPES = new Set([
  "text",
  "email",
  "tel",
  "number",
  "url",
  "date",
  "textarea",
]);

/**
 * A static HTML form posting to an action URL. For richer forms (validation, storage,
 * spam protection), integrate the Nextly form-builder plugin.
 */
export const form = defineBlock({
  type: "core/form",
  version: 1,
  label: "Form",
  icon: "Mail",
  category: "content",
  defaultProps: {
    action: "",
    method: "post",
    submitText: "Submit",
    fields: [
      { label: "Name", name: "name", type: "text", required: true },
      { label: "Email", name: "email", type: "email", required: true },
      { label: "Message", name: "message", type: "textarea", required: false },
    ],
  },
  contentFields: [
    { name: "action", type: "text", label: "Action URL" },
    {
      name: "method",
      type: "select",
      label: "Method",
      options: [
        { value: "post", label: "POST" },
        { value: "get", label: "GET" },
      ],
    },
    {
      name: "fields",
      type: "repeater",
      label: "Fields",
      addLabel: "Add field",
      itemFields: [
        { name: "label", type: "text", label: "Label" },
        { name: "name", type: "text", label: "Name attribute" },
        {
          name: "type",
          type: "select",
          label: "Type",
          options: [
            "text",
            "email",
            "tel",
            "number",
            "url",
            "date",
            "textarea",
          ].map(v => ({ value: v, label: v })),
        },
        { name: "required", type: "boolean", label: "Required" },
      ],
    },
    { name: "submitText", type: "text", label: "Submit label" },
  ],
  supports: {
    spacing: true,
    border: true,
    visibility: true,
    customCss: true,
    customAttributes: true,
  },
  render: ({ props, className }) => {
    const fields = Array.isArray(props.fields) ? props.fields : [];
    const action = safeUrl(props.action) || undefined;
    const method = props.method === "get" ? "get" : "post";
    return (
      <form
        className={className}
        action={action}
        method={method}
        style={{ display: "grid", gap: 12 }}
      >
        {fields.map((raw, i) => {
          const f = (raw ?? {}) as Record<string, unknown>;
          const type = INPUT_TYPES.has(str(f.type)) ? str(f.type) : "text";
          const name = str(f.name) || `field-${i}`;
          const required = f.required === true;
          return (
            <label key={i} style={{ display: "grid", gap: 4 }}>
              <span>
                {str(f.label)}
                {required ? " *" : ""}
              </span>
              {type === "textarea" ? (
                <textarea name={name} required={required} rows={4} />
              ) : (
                <input type={type} name={name} required={required} />
              )}
            </label>
          );
        })}
        <button type="submit" style={{ padding: "10px 20px", borderRadius: 8 }}>
          {str(props.submitText, "Submit")}
        </button>
      </form>
    );
  },
});
