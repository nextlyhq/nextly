"use client";

/**
 * Media control (spec §9). Reuses the admin's MediaPickerDialog (public export) to choose
 * a library asset; on select it stores `{ mediaId, url, alt, width, height }` so the canvas
 * previews via `url` directly and the render path can re-resolve by `mediaId` through the
 * dataProvider. A manual URL + alt (accessibility) remain available as a fallback.
 */
import { MediaPickerDialog, type Media } from "@nextlyhq/admin";
import { Button, Input } from "@nextlyhq/ui";
import { useState } from "react";

import { ControlRow } from "./primitives";
import type { ControlProps } from "./types";

export interface MediaValue {
  mediaId?: string;
  url?: string;
  alt?: string;
  width?: number;
  height?: number;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function MediaControl({ value, onChange, label }: ControlProps) {
  const v = (value ?? {}) as MediaValue;
  const [open, setOpen] = useState(false);

  const onSelect = (media: Media[]) => {
    const m = media[0];
    if (m) {
      onChange({
        mediaId: m.id,
        url: m.url,
        alt: m.altText ?? "",
        width: m.width ?? undefined,
        height: m.height ?? undefined,
      });
    }
    setOpen(false);
  };

  return (
    <ControlRow label={label}>
      {v.url ? (
        <img
          src={v.url}
          alt={v.alt ?? ""}
          style={{
            maxWidth: "100%",
            maxHeight: 120,
            borderRadius: "var(--radius)",
            border: "1px solid hsl(var(--border))",
            marginBottom: 6,
          }}
        />
      ) : null}
      <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
        <Button variant="outline" onClick={() => setOpen(true)}>
          {v.url ? "Replace" : "Choose from library"}
        </Button>
        {v.url ? (
          <Button variant="ghost" onClick={() => onChange(undefined)}>
            Remove
          </Button>
        ) : null}
      </div>
      <Input
        value={str(v.url)}
        placeholder="…or paste an image URL"
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
      <MediaPickerDialog
        mode="single"
        open={open}
        onOpenChange={setOpen}
        onSelect={onSelect}
        accept="image/*"
        title="Select media"
      />
    </ControlRow>
  );
}
