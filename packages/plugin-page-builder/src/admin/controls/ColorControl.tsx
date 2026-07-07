"use client";

/**
 * Color control (spec §8). @nextlyhq/ui ships no color picker, so this is a compact one:
 * a native <input type="color">, a hex text field, a clear button, and — when a token
 * palette is provided — clickable token swatches. A raw color is stored as a string; a
 * token is stored as `{ token }` so the style compiler emits `var(--nx-<token>)`.
 */
import { Input } from "@nextlyhq/ui";

import type { TokenRef } from "../../core/types";
import { X } from "../icons";

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
      <div className="nx-pb-color-row">
        <input
          type="color"
          className="nx-pb-color-swatch"
          aria-label={`${label ?? "color"} picker`}
          value={/^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#000000"}
          onChange={e => onChange(e.target.value)}
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
            className="nx-pb-icon-btn"
            aria-label="Clear color"
            onClick={() => onChange(undefined)}
            style={{ padding: "6px 8px" }}
          >
            <X size={14} aria-hidden />
          </button>
        ) : null}
      </div>
      {tokens && tokens.length > 0 ? (
        <div className="nx-pb-color-tokens">
          {tokens.map(t => (
            <button
              key={t.name}
              type="button"
              className="nx-pb-color-token"
              data-active={token === t.name || undefined}
              title={t.label}
              aria-label={t.label}
              onClick={() => onChange({ token: t.name })}
              style={{ background: t.preview }}
            />
          ))}
        </div>
      ) : null}
    </ControlRow>
  );
}
