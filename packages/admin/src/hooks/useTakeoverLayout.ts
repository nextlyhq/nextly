"use client";

/**
 * useTakeoverLayout — the entry/single form body under the takeover rule.
 *
 * `takeoverLayout` already answers the three underlying questions once each:
 * which field types take the body over, which fields control their conditions,
 * and what the body reduces to for a given set of controller values. What was
 * written twice is the ORDER those answers are asked in and the wiring between
 * them — the watch subscription that makes the layout recompute when the author
 * switches modes, and the name→value pairing the reducer expects.
 *
 * That sequence is a derived view of one question, so it is asked here once and
 * every form asks this hook. Recomposing it per call site is what lets two
 * editors that must agree drift apart while both continue to look correct.
 *
 * @module hooks/useTakeoverLayout
 */

import type { UseFormReturn } from "react-hook-form";

import { useBranding } from "@admin/context/providers/BrandingProvider";
import {
  computeMainFields,
  takeoverControllerNames,
  takeoverTypesFromBranding,
  type LayoutField,
  type TakeoverType,
} from "@admin/lib/builder/takeoverLayout";

export interface UseTakeoverLayoutResult<T extends LayoutField> {
  /**
   * The fields to render in the form body: the whole body, or — while a
   * takeover field is active — just that field and its condition controller.
   */
  mainFields: T[];
  /**
   * The fields any takeover field's condition watches. The toolbar reads the
   * first of these to draw the control that switches modes, so it comes from
   * the same computation that decided the layout rather than from a second
   * scan that could disagree with it.
   */
  controllerNames: string[];
  /**
   * The registered takeover types themselves, for callers that must run the
   * same reduction over values the form does not hold — the entry editor
   * computes a past version's body from that version's own snapshot.
   */
  takeoverTypes: TakeoverType[];
}

/**
 * @param fields - every field the document declares, system fields included
 * @param form - the form whose values decide which takeover fields are active
 * @returns the body to render, its condition controllers, and the takeover types
 */
export function useTakeoverLayout<T extends LayoutField>(
  fields: T[],
  form: UseFormReturn<Record<string, unknown>>
): UseTakeoverLayoutResult<T> {
  const branding = useBranding();
  const takeoverTypes = takeoverTypesFromBranding(branding.plugins);
  const controllerNames = takeoverControllerNames(fields, takeoverTypes);
  /*
   * The controller values, read through `watch` so the body recomputes when the
   * author switches modes rather than only when the form remounts.
   *
   * `watch` answers a name list POSITIONALLY, so the result is zipped back onto
   * the names it was asked for: the reducer takes a keyed record, and handing it
   * the bare array would look up every condition against `undefined` and report
   * no takeover as active.
   */
  const watched = controllerNames.length ? form.watch(controllerNames) : [];
  const values = Object.fromEntries(
    controllerNames.map((n, i) => [n, watched[i]])
  );

  return {
    mainFields: computeMainFields(fields, { takeoverTypes, values }),
    controllerNames,
    takeoverTypes,
  };
}
