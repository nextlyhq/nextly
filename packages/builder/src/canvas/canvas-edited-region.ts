"use client";

/**
 * A region of the page's layout edited in place, drawn as the canvas draws
 * the page it edits: every conditioned block shown, whoever the visitor, a
 * block hidden on the device shown striped, and a placed component's
 * conditioned blocks shown too, so each can be seen and selected. The marks
 * blocks carry (locked, conditioned, hidden here) are the region's then, not
 * the page's: the page's blocks carry no address while the region is edited,
 * and its ids may repeat the region's.
 *
 * The stored document is never changed: only what is drawn.
 *
 * @module canvas-edited-region
 */

import type { BlockDocument } from "@nextlyhq/blocks-engine";
import type { PageRendererProps } from "@nextlyhq/blocks-react";
import { useMemo } from "react";

import { revealedForCanvas } from "../conditions/applied-conditions";

import {
  conditionMarksOf,
  lockMarksOf,
  type ConditionMarks,
  type LockMark,
} from "./canvas-block-marks";
import {
  drawnBreakpoints,
  useDeviceHiddenDrawing,
} from "./canvas-device-hidden";
import { revealedDefinitions } from "./canvas-drawn-page";
import type { CanvasEditingRegion } from "./canvas-props";

/** The marks the canvas writes on the blocks of the document it edits. */
export interface EditedMarks {
  readonly locks: ReadonlyMap<string, LockMark>;
  readonly conditions: ConditionMarks;
  readonly entryContent: ReadonlyMap<string, string>;
  readonly deviceHidden: ReadonlyMap<string, string>;
}

/** No region edited: an empty document to draw nothing from. */
const NO_REGION: BlockDocument = {
  formatVersion: 1,
  kind: "component",
  nodes: [],
};

/** A region carries no Entry content words: it draws no entry. */
const NO_WORDS: ReadonlyMap<string, string> = new Map();

/**
 * The region as drawn while it is edited, and the marks of the document the
 * canvas edits: the region's while one is edited, else `page`'s as the
 * canvas worked them out, unchanged.
 */
export function useEditedRegionDrawing(
  editing: CanvasEditingRegion | undefined,
  render: Omit<PageRendererProps, "document" | "siteStyles"> | undefined,
  siteStyles: PageRendererProps["siteStyles"],
  page: { document: BlockDocument } & Omit<EditedMarks, "locks">
): { drawn: CanvasEditingRegion | undefined; marks: EditedMarks } {
  const limits = render?.limits;
  const stored = editing?.document ?? NO_REGION;
  const definitions = editing?.definitions;
  // Every conditioned block drawn, as the page's are while it is edited.
  const revealed = useMemo(
    () => revealedForCanvas(stored, undefined, limits),
    [stored, limits]
  );
  const shownDefinitions = useMemo(
    () =>
      definitions === undefined
        ? undefined
        : revealedDefinitions(stored, definitions, limits),
    [stored, definitions, limits]
  );
  // A block hidden on the device shown, drawn anyway and striped.
  const deviceHidden = useDeviceHiddenDrawing(
    revealed,
    drawnBreakpoints(render, siteStyles),
    editing !== undefined
  );
  const regionMarks = useMemo(
    () => ({
      locks: lockMarksOf(stored),
      conditions: conditionMarksOf(stored, undefined, {
        ...(definitions === undefined ? {} : { definitions }),
        ...(limits === undefined ? {} : { limits }),
      }),
    }),
    [stored, definitions, limits]
  );
  const pageLocks = useMemo(() => lockMarksOf(page.document), [page.document]);
  return useMemo(() => {
    if (editing === undefined) {
      return {
        drawn: undefined,
        marks: {
          locks: pageLocks,
          conditions: page.conditions,
          entryContent: page.entryContent,
          deviceHidden: page.deviceHidden,
        },
      };
    }
    return {
      drawn: {
        area: editing.area,
        document: deviceHidden.document,
        ...(shownDefinitions === undefined
          ? {}
          : { definitions: shownDefinitions }),
      },
      marks: {
        ...regionMarks,
        entryContent: NO_WORDS,
        deviceHidden: deviceHidden.marks,
      },
    };
  }, [
    editing,
    deviceHidden,
    shownDefinitions,
    regionMarks,
    pageLocks,
    page.conditions,
    page.entryContent,
    page.deviceHidden,
  ]);
}
