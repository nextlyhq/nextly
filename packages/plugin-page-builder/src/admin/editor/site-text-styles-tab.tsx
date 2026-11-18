"use client";

/**
 * The Type tab's "Text styles", drawn by the builder (`TextStylesSection`)
 * over the class surface: making, copying and renaming are whole-list class
 * edits, and a part's change is a write of one style's styles, each a step
 * of the editor's undo, as a block style's are; lock and removal go through
 * the shared styles' routes, which refuse to remove a text style a block or
 * a Site text row uses, saying where.
 *
 * Shown read-only to a role without `update-site-style`, which the server
 * would refuse anyway.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/site-text-styles-tab
 */
import type { BreakpointSet } from "@nextlyhq/blocks-engine";
import {
  TextStylesSection,
  type PageClassBlocks,
  type SharedStylesHost,
} from "@nextlyhq/builder/shell";
import { useCan } from "@nextlyhq/plugin-sdk/client";
import { useMemo, type JSX } from "react";

import { useSharedStylesClient } from "../shared-styles-client";

import type { ClassSurface } from "./site-style-class-surface";
import { useVariablesStudio } from "./site-style-tokens-studio";
import { useUsageHere, useUsageReadKey } from "./usage-here";

/** The site's text styles, inside the tokens studio's frame. */
export function TextStylesTab({
  classes,
  breakpoints,
  pageBlocks,
}: {
  classes: ClassSurface;
  /** The site's devices, which a text style's size is set for. */
  breakpoints: BreakpointSet | undefined;
  /**
   * The blocks on the open page wearing each style, unsaved edits included,
   * so a text style one of them wears is not removed from under it.
   */
  pageBlocks: PageClassBlocks;
}): JSX.Element | null {
  const studio = useVariablesStudio();
  const mayChange = useCan("update-site-style");
  const here = useUsageHere();
  const access = useSharedStylesClient(here, useUsageReadKey(here));
  const { writeStyles } = classes;
  const host = useMemo<SharedStylesHost>(
    () => ({ mayChange, writeStyles }),
    [mayChange, writeStyles]
  );
  if (studio === null) return null;
  return (
    <TextStylesSection
      library={classes.library}
      tokens={studio.tokens}
      mode={studio.header?.mode ?? "light"}
      breakpoints={breakpoints}
      readOnly={!mayChange}
      onEditClasses={classes.edit}
      host={host}
      access={access}
      pageBlocks={pageBlocks}
      onTokens={studio.onChange}
    />
  );
}
