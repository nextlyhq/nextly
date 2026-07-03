"use client";

/**
 * Small controlled inputs used by both the Content and Style inspector tabs. Each is a
 * thin wrapper over @nextlyhq/ui primitives conforming to ControlProps. Kept in one file
 * because they are tiny and share the ControlRow label chrome.
 */
import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@nextlyhq/ui";
import { type ReactNode, useId } from "react";

import type { ControlProps } from "./types";

const UNITS = ["px", "%", "rem", "em", "vw", "vh"];

export function ControlRow({
  label,
  htmlFor,
  children,
}: {
  label?: string;
  htmlFor?: string;
  children: ReactNode;
}): ReactNode {
  return (
    <div style={{ display: "grid", gap: 4, marginBottom: 10 }}>
      {label ? (
        <Label htmlFor={htmlFor} style={{ fontSize: 12, color: "#6b7280" }}>
          {label}
        </Label>
      ) : null}
      {children}
    </div>
  );
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function TextControl({ value, onChange, label, field }: ControlProps) {
  const id = useId();
  return (
    <ControlRow label={label} htmlFor={id}>
      <Input
        id={id}
        value={str(value)}
        placeholder={field?.placeholder}
        onChange={e => onChange(e.target.value)}
      />
    </ControlRow>
  );
}

export function TextareaControl({
  value,
  onChange,
  label,
  field,
}: ControlProps) {
  const id = useId();
  return (
    <ControlRow label={label} htmlFor={id}>
      <Textarea
        id={id}
        rows={3}
        value={str(value)}
        placeholder={field?.placeholder}
        onChange={e => onChange(e.target.value)}
      />
    </ControlRow>
  );
}

export function NumberControl({ value, onChange, label }: ControlProps) {
  const id = useId();
  return (
    <ControlRow label={label} htmlFor={id}>
      <Input
        id={id}
        type="number"
        value={typeof value === "number" ? value : str(value)}
        onChange={e =>
          onChange(e.target.value === "" ? undefined : Number(e.target.value))
        }
      />
    </ControlRow>
  );
}

export function BooleanControl({ value, onChange, label }: ControlProps) {
  const id = useId();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 10,
      }}
    >
      <Label htmlFor={id} style={{ fontSize: 12, color: "#6b7280" }}>
        {label}
      </Label>
      <Switch
        id={id}
        checked={value === true}
        onCheckedChange={checked => onChange(checked)}
      />
    </div>
  );
}

export function SelectControl({ value, onChange, label, field }: ControlProps) {
  const options = field?.options ?? [];
  return (
    <ControlRow label={label}>
      <Select value={str(value)} onValueChange={v => onChange(v)}>
        <SelectTrigger>
          <SelectValue placeholder="Select…" />
        </SelectTrigger>
        <SelectContent>
          {options.map(o => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </ControlRow>
  );
}

const ALIGN = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
  { value: "justify", label: "Justify" },
];

export function AlignControl({ value, onChange, label }: ControlProps) {
  return (
    <ControlRow label={label}>
      <div style={{ display: "flex", gap: 4 }} role="group" aria-label={label}>
        {ALIGN.map(a => (
          <button
            key={a.value}
            type="button"
            aria-pressed={value === a.value}
            onClick={() => onChange(value === a.value ? undefined : a.value)}
            style={{
              flex: 1,
              padding: "6px 4px",
              fontSize: 12,
              cursor: "pointer",
              border: "1px solid #e5e7eb",
              borderRadius: 6,
              background: value === a.value ? "#eef2ff" : "#fff",
              color: value === a.value ? "#4338ca" : "#374151",
            }}
          >
            {a.label}
          </button>
        ))}
      </div>
    </ControlRow>
  );
}

/** Splits a CSS length like "12px" into number + unit for editing. */
function splitLength(v: unknown): { n: string; unit: string } {
  const s = str(v).trim();
  const m = /^(-?\d*\.?\d+)(px|%|rem|em|vw|vh)?$/.exec(s);
  if (!m) return { n: "", unit: "px" };
  return { n: m[1], unit: m[2] ?? "px" };
}

export function DimensionControl({ value, onChange, label }: ControlProps) {
  const { n, unit } = splitLength(value);
  const emit = (nextN: string, nextUnit: string) =>
    onChange(nextN === "" ? undefined : `${nextN}${nextUnit}`);
  return (
    <ControlRow label={label}>
      <div style={{ display: "flex", gap: 4 }}>
        <Input
          type="number"
          value={n}
          style={{ flex: 1 }}
          onChange={e => emit(e.target.value, unit)}
        />
        <Select value={unit} onValueChange={u => emit(n, u)}>
          <SelectTrigger style={{ width: 80 }}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {UNITS.map(u => (
              <SelectItem key={u} value={u}>
                {u}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </ControlRow>
  );
}

export function LinkControl({ value, onChange, label }: ControlProps) {
  const v = (value ?? {}) as { href?: string; target?: string };
  const id = useId();
  return (
    <ControlRow label={label} htmlFor={id}>
      <Input
        id={id}
        value={str(v.href)}
        placeholder="https://…"
        onChange={e => onChange({ ...v, href: e.target.value })}
      />
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          color: "#6b7280",
          marginTop: 4,
        }}
      >
        <input
          type="checkbox"
          checked={v.target === "_blank"}
          onChange={e =>
            onChange({ ...v, target: e.target.checked ? "_blank" : undefined })
          }
        />
        Open in new tab
      </label>
    </ControlRow>
  );
}
