"use client";

/**
 * Above the outline: the find box, Fold all and Unfold all, and the switch
 * between the outline and the form preview.
 */
import { Button, Input } from "@nextlyhq/ui";
import type { JSX } from "react";

export function OutlineToolbar({
  query,
  onQueryChange,
  onFoldAll,
  onUnfoldAll,
  preview,
  onPreviewChange,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  onFoldAll: () => void;
  onUnfoldAll: () => void;
  preview: boolean;
  onPreviewChange: (preview: boolean) => void;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        type="search"
        aria-label="Find a field"
        placeholder="Find a field by label, name or type"
        value={query}
        onChange={event => onQueryChange(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Escape") onQueryChange("");
        }}
        className="h-9 max-w-xs"
      />
      <Button type="button" variant="outline" size="sm" onClick={onFoldAll}>
        Fold all
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={onUnfoldAll}>
        Unfold all
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-pressed={preview}
        onClick={() => onPreviewChange(!preview)}
        className="ml-auto"
      >
        {preview ? "Show the outline" : "Preview the form"}
      </Button>
    </div>
  );
}
