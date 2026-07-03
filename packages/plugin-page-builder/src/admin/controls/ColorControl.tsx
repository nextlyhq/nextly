"use client";

/**
 * Color control (spec §8). @nextlyhq/ui ships no color picker, so this is a minimal one:
 * a native <input type="color">, a hex text field, and — when a token palette is provided
 * — clickable token swatches. A raw color is stored as a string; a token is stored as
 * `{ token }` so the style compiler emits `var(--nx-<token>)`.
 */
import { Input } from "@nextlyhq/ui";

import type { TokenRef } from "../../core/types";

import { ControlRow } from "./primitives";
import type { ControlProps } from "./types";

function isToken(v: unknown): v is TokenRef {
  return typeof v === "object" && v !== null && "token" in v;
}

export function ColorControl({ value, onChange, label, tokens }: ControlProps) {
  const token = isToken(value) ? value.token : undefined;
  const hex = typeof value === "string" ? value : "";
  return (
    <ControlRow label={label}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          type="color"
          aria-label={`${label ?? "color"} picker`}
          value={/^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#000000"}
          onChange={e => onChange(e.target.value)}
          style={{
            width: 32,
            height: 32,
            padding: 0,
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            background: "none",
          }}
        />
        <Input
          value={token ? `token:${token}` : hex}
          placeholder="#000000"
          onChange={e => onChange(e.target.value)}
          style={{ flex: 1 }}
        />
        {value !== undefined ? (
          <button
            type="button"
            aria-label="Clear color"
            onClick={() => onChange(undefined)}
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 6,
              background: "#fff",
              padding: "4px 8px",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            ✕
          </button>
        ) : null}
      </div>
      {tokens && tokens.length > 0 ? (
        <div
          style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}
        >
          {tokens.map(t => (
            <button
              key={t.name}
              type="button"
              title={t.label}
              aria-label={t.label}
              onClick={() => onChange({ token: t.name })}
              style={{
                width: 20,
                height: 20,
                borderRadius: 4,
                cursor: "pointer",
                background: t.preview,
                border:
                  token === t.name ? "2px solid #4338ca" : "1px solid #e5e7eb",
              }}
            />
          ))}
        </div>
      ) : null}
    </ControlRow>
  );
}
