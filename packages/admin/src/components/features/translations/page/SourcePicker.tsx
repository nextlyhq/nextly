"use client";

/**
 * Which language a field is translated from: a choice where more than one can
 * be, and its name where only one can.
 *
 * @module components/features/translations/page/SourcePicker
 */

import type { JSX } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@admin/components/ui";

export interface SourcePickerProps {
  /** What the field is called, for the choice's own name. */
  fieldLabel: string;
  /** The languages the field can be translated from, in the site's order. */
  sources: readonly string[];
  /** The one shown. */
  source: string;
  /** A language's name. */
  labelOf: (code: string) => string;
  onChange: (code: string) => void;
}

export function SourcePicker({
  fieldLabel,
  sources,
  source,
  labelOf,
  onChange,
}: SourcePickerProps): JSX.Element {
  if (sources.length < 2) {
    return (
      <span className="text-xs leading-7 text-muted-foreground">
        {labelOf(source)}
      </span>
    );
  }
  return (
    <Select value={source} onValueChange={onChange}>
      <SelectTrigger
        className="h-7 w-auto max-w-32 px-2 text-xs"
        aria-label={`Source language for ${fieldLabel}`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {sources.map(code => (
          <SelectItem key={code} value={code}>
            {labelOf(code)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
