"use client";

/**
 * Media control. Stores `{ mediaId?, url, alt }`. Task 6 wires the admin
 * MediaPickerDialog for choosing a library asset; this base version supports a direct
 * URL + alt text (accessibility) so the control is usable and the shape is stable.
 */
import { Input } from "@nextlyhq/ui";

import { ControlRow } from "./primitives";
import type { ControlProps } from "./types";

export interface MediaValue {
  mediaId?: string;
  url?: string;
  alt?: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function MediaControl({ value, onChange, label }: ControlProps) {
  const v = (value ?? {}) as MediaValue;
  return (
    <ControlRow label={label}>
      {v.url ? (
        <img
          src={v.url}
          alt={v.alt ?? ""}
          style={{
            maxWidth: "100%",
            maxHeight: 120,
            borderRadius: 6,
            border: "1px solid #e5e7eb",
            marginBottom: 6,
          }}
        />
      ) : null}
      <Input
        value={str(v.url)}
        placeholder="Image URL"
        aria-label={`${label ?? "media"} url`}
        onChange={e => onChange({ ...v, url: e.target.value })}
      />
      <Input
        value={str(v.alt)}
        placeholder="Alt text (describe the image)"
        aria-label={`${label ?? "media"} alt text`}
        style={{ marginTop: 4 }}
        onChange={e => onChange({ ...v, alt: e.target.value })}
      />
    </ControlRow>
  );
}
