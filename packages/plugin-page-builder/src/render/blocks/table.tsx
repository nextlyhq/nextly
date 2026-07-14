import type { CSSProperties } from "react";

import { defineBlock } from "../../core/registry";

import { str } from "./util";

const cell: CSSProperties = {
  border: "1px solid #e5e7eb",
  padding: "8px 10px",
  textAlign: "left",
};

/** A simple data table. Headers are comma-separated; each row's cells are pipe-separated. */
export const table = defineBlock({
  type: "core/table",
  version: 1,
  label: "Table",
  icon: "LayoutGrid",
  category: "basic",
  defaultProps: {
    headers: "Name, Role",
    rows: [{ cells: "Ada | Engineer" }, { cells: "Grace | Scientist" }],
  },
  contentFields: [
    { name: "headers", type: "text", label: "Headers (comma-separated)" },
    {
      name: "rows",
      type: "repeater",
      label: "Rows",
      addLabel: "Add row",
      itemFields: [
        { name: "cells", type: "text", label: "Cells (pipe | separated)" },
      ],
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
  render: ({ props, className }) => {
    const headers = str(props.headers)
      .split(",")
      .map(h => h.trim())
      .filter(Boolean);
    const rows = Array.isArray(props.rows) ? props.rows : [];
    return (
      <table
        className={className}
        style={{ borderCollapse: "collapse", width: "100%" }}
      >
        {headers.length ? (
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i} style={{ ...cell, background: "#f8fafc" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {rows.map((raw, r) => {
            const cells = str((raw as Record<string, unknown>)?.cells)
              .split("|")
              .map(c => c.trim());
            return (
              <tr key={r}>
                {cells.map((c, i) => (
                  <td key={i} style={cell}>
                    {c}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  },
});
