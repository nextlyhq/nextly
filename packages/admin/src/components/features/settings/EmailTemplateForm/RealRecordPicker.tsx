"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import { useId, type JSX } from "react";

import { useRealRecords } from "./useRealRecords";

/**
 * Fill the test data from a real record its owner offers, such as a real
 * order or a real user. Shown only where the owner offers records; read for
 * the preview, never saved.
 */
export function RealRecordPicker({
  templateId,
  onLoaded,
}: {
  templateId: string | undefined;
  onLoaded: (values: Record<string, unknown>) => void;
}): JSX.Element | null {
  const labelId = useId();
  const { offer, chosen, loading, loadError, choose } = useRealRecords(
    templateId,
    onLoaded
  );

  if (offer.kind === "asking" || offer.kind === "none") return null;
  if (offer.kind === "not-readable" || offer.kind === "failed") {
    return (
      <p
        className="mb-3 text-xs text-muted-foreground"
        data-testid="real-record-unavailable"
      >
        {offer.kind === "not-readable"
          ? "Real records are offered to people who can read them."
          : "Real records couldn't be listed."}
      </p>
    );
  }

  const { label, items } = offer.records;
  return (
    <div className="mb-3 space-y-1.5" data-testid="real-record-picker">
      <p id={labelId} className="text-xs font-medium text-foreground">
        Fill from {label.charAt(0).toLowerCase() + label.slice(1)}
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">None to choose yet.</p>
      ) : (
        <Select value={chosen} onValueChange={choose} disabled={loading}>
          <SelectTrigger className="h-8" aria-labelledby={labelId}>
            <SelectValue placeholder="Choose a record" />
          </SelectTrigger>
          <SelectContent>
            {items.map(item => (
              <SelectItem key={item.id} value={item.id}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {loadError ? (
        <p className="text-xs text-destructive" role="alert">
          {loadError}
        </p>
      ) : null}
    </div>
  );
}
