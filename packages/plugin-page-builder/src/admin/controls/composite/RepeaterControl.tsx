"use client";

/**
 * Generic array-of-items editor (spec §4.3). Drives List / Icon List / Button Group /
 * Tabs / Accordion / Table / Gallery. Each item is an object edited via the field's
 * `itemFields`; supports add / remove / reorder. Value is the item array.
 */
import { contentDefaults } from "../../content/contentFields";
import { renderControl } from "../registerDefaultControls";
import type { ControlProps } from "../types";

type Item = Record<string, unknown>;

export function RepeaterControl({
  value,
  onChange,
  field,
  label,
}: ControlProps) {
  const itemFields = field?.itemFields ?? [];
  const items: Item[] = Array.isArray(value) ? (value as Item[]) : [];

  const commit = (next: Item[]) => onChange(next);
  const add = () => commit([...items, contentDefaults(itemFields)]);
  const remove = (i: number) => commit(items.filter((_, idx) => idx !== i));
  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  };
  const setField = (i: number, name: string, v: unknown) => {
    const next = items.slice();
    next[i] = { ...next[i], [name]: v };
    commit(next);
  };

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {label ? <span className="nx-pb-control-label">{label}</span> : null}
      {items.map((item, i) => (
        <div
          key={i}
          style={{
            display: "grid",
            gap: 6,
            padding: 8,
            border: "1px solid hsl(var(--border))",
            borderRadius: 6,
          }}
        >
          <div
            style={{ display: "flex", justifyContent: "space-between", gap: 4 }}
          >
            <span className="nx-pb-control-label">Item {i + 1}</span>
            <span style={{ display: "flex", gap: 4 }}>
              <button
                type="button"
                className="nx-pb-icon-btn"
                aria-label={`Move item ${i + 1} up`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="nx-pb-icon-btn"
                aria-label={`Move item ${i + 1} down`}
                disabled={i === items.length - 1}
                onClick={() => move(i, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className="nx-pb-icon-btn"
                aria-label={`Remove item ${i + 1}`}
                onClick={() => remove(i)}
              >
                ✕
              </button>
            </span>
          </div>
          {itemFields.map(sub => (
            <div key={sub.name}>
              {renderControl(sub.type, {
                label: sub.label,
                field: sub,
                value: item[sub.name],
                onChange: v => setField(i, sub.name, v),
              })}
            </div>
          ))}
        </div>
      ))}
      <button type="button" className="nx-pb-icon-btn" onClick={add}>
        + {field?.addLabel ?? "Add item"}
      </button>
    </div>
  );
}
