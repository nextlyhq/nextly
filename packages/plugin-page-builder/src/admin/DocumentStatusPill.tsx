"use client";

/**
 * Where the page being edited is in its life, shown inside the editor.
 *
 * The editor takes the whole window and asks the admin to hide its chrome, so
 * the status the entry and Single editors show beside the form is not on screen
 * while an author is in here. This answers the question the bar's buttons
 * don't: is this page live, a draft, or scheduled to go live?
 *
 * ## The life stage, and nothing about the work
 *
 * `useDocumentLifeStage` reports Draft, Published or Scheduled from the page's
 * lifecycle status and its scheduled publications, never from its history, so
 * a page unpublished since it was live reads Draft. It never says "Changed",
 * "Modified" or "Unsaved changes": the Save button says whether the work is
 * saved, and the Publish button whether the live page is behind ("Publish
 * changes"), so each state is said once.
 *
 * ## The words are shared and the colours are not
 *
 * The words come from the admin, so both editors call the same stage by the
 * same name. The COLOURS are this surface's own: the editor's chrome is drawn
 * from `--nx-builder-*` tokens, and borrowing the admin's palette would put a
 * panel's colours on a bar that is not that panel.
 *
 * @module @nextlyhq/plugin-page-builder/admin/DocumentStatusPill
 */

import { useDocumentLifeStage } from "@nextlyhq/plugin-sdk/admin";
import type { JSX } from "react";

import { StatusPill } from "./status-pill";

/**
 * @returns the pill, or nothing where no surrounding editor knows the page's
 *   life stage, or its collection has none
 */
export function DocumentStatusPill(): JSX.Element | null {
  const stage = useDocumentLifeStage();
  // Nothing rather than a guess. A blocks field also renders inside a create
  // form and inside previews, where no status has been persisted — and a pill
  // reading "Draft" there would be a claim nobody made.
  if (stage === null) return null;
  // Named for a reader, because "Draft" alone in a toolbar does not say
  // what it describes.
  return (
    <StatusPill
      state={stage.stage}
      label={stage.label}
      subject="Page status"
      {...(stage.detail === undefined ? {} : { detail: stage.detail })}
    />
  );
}
