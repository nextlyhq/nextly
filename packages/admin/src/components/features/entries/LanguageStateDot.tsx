"use client";

/**
 * LanguageStateDot — the one mark that says where a language stands.
 *
 * Its own module because the surfaces that draw it have nothing else in common:
 * the language panel in the document rail, and the entry list's column. It
 * previously lived beside the header's language control, which was the reader
 * that happened to be written first — so deleting that control would have taken
 * the dot with it, or left a file named after something no longer in it.
 *
 * The vocabulary it renders lives in `translation-meta`, with the rest of what
 * a `_translations` map can be read for. Imported from there directly rather
 * than through a re-export, so there is one place to look.
 *
 * @module components/features/entries/LanguageStateDot
 */

import { cn } from "@admin/lib/utils";

import type { LanguageState } from "./translation-meta";

/**
 * The dot encodes state by shape first: filled (published), filled in the
 * positive scale (translated), half-filled (draft), outline (missing). Colour
 * comes from the semantic scales only.
 */
export function StateDot({ state }: { state: LanguageState }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-2 rounded-full shrink-0",
        state === "published" && "bg-foreground",
        state === "translated" && "bg-success-600 dark:bg-success-400",
        state === "draft" &&
          "border-[1.5px] border-foreground/70 [background:linear-gradient(90deg,currentColor_50%,transparent_50%)] text-foreground/70",
        // Full strength rather than an alpha: the outline is the only thing
        // that renders this dot, so it is a UI boundary held to 3:1. At /60 it
        // measured 2.87:1 on the page surface; the token itself reaches 7.55:1
        // and stays quieter than the draft dot above it.
        state === "missing" && "border-[1.5px] border-muted-foreground"
      )}
    />
  );
}
