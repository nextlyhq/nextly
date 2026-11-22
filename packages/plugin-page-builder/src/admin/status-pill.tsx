"use client";

/**
 * A document's status as a pill, drawn the builder's way: the top bar's pill
 * for the document being edited, and the template preview's chip and rows
 * for the entry a template is previewed with.
 *
 * The words are the admin's (`PILL_LABEL`), so every surface calls a state by
 * the same name; the colours are the editor's chrome tokens, for the reason
 * `DocumentStatusPill` gives.
 *
 * @module @nextlyhq/plugin-page-builder/admin/status-pill
 */
import { PILL_LABEL, type PillState } from "@nextlyhq/plugin-sdk/admin";
import type { JSX } from "react";

/**
 * A state the pill draws: the admin's, or "scheduled" for a page whose
 * publication is set for later, which only the editor's own pill shows.
 */
export type StatusPillState = PillState | "scheduled";

export interface StatusPillProps {
  /** Where the document stands, in the admin's words. */
  state: StatusPillState;
  /**
   * What the state is called, where the admin named it with the state (a
   * page's life stage); the admin's pill words otherwise.
   */
  label?: string;
  /** More about the state, on hover (when a scheduled page goes live). */
  detail?: string;
  /** What the pill describes, said to a screen reader before the state. */
  subject?: string;
  /** `sm` for a row or a chip, where the bar's size would crowd the line. */
  size?: "md" | "sm";
}

/**
 * The pill itself: one outline in the builder's border for every state,
 * muted words, and Published in the builder's text at semibold. Shared by the
 * top bar's pill and the template preview's chip and rows, so a document and
 * the entry it previews are told apart by their words alone, drawn one way.
 */
export function StatusPill({
  state,
  subject,
  label,
  detail,
  size = "md",
}: StatusPillProps): JSX.Element {
  const live = state === "published";
  return (
    // A plain reading rather than a control: nothing here is pressable, and a
    // pill that looks like a button in a bar full of buttons invites a click
    // that does nothing.
    <span
      data-status={state}
      {...(detail === undefined ? {} : { title: detail })}
      className={[
        "border-[color:var(--nx-builder-border)] inline-flex shrink-0 items-center whitespace-nowrap rounded-full border",
        size === "sm" ? "h-[18px] px-1.5 text-[11px]" : "px-2 py-0.5 text-xs",
        // Weight rather than a second hue carries "live", so the distinction
        // survives without colour and in both modes.
        live
          ? "text-[color:var(--nx-builder-text)] font-semibold"
          : "text-[color:var(--nx-builder-text-muted)] font-normal",
      ].join(" ")}
    >
      {subject === undefined ? null : (
        <span className="sr-only">{`${subject}: `}</span>
      )}
      {label ?? (state === "scheduled" ? "" : PILL_LABEL[state])}
    </span>
  );
}
