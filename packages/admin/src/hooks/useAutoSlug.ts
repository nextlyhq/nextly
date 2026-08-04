"use client";

/**
 * useAutoSlug Hook
 *
 * Form-level slug auto-generator. Mounted once at the top of EntryForm or
 * SingleForm; watches a configurable title field and writes a slugified
 * value into a sibling slug field while the user hasn't manually edited
 * the slug.
 *
 * Why a form-level hook instead of per-field logic:
 * moved the title input out of the field-renderer pipeline (it now lives in
 * `EntrySystemHeader` as a plain `<input>` bound via `form.register`),
 * so the slug-gen useEffect that lived inside `TextInput` never fired
 * for the title anymore. Watching at the form level fixes that and also
 * lets the slug follow the *configured* title (e.g. `useAsTitle:
 * "headline"`), not a hardcoded `title` / `name`.
 *
 * Manual-edit detection: the hook tracks the last value it wrote. While
 * the live slug matches that ref (or is empty), the hook treats the
 * slug as auto-generated and keeps it in step with the title. As soon
 * as the user types something else into the slug field, the live value
 * diverges from the ref and the hook stops overwriting.
 *
 * @module hooks/useAutoSlug
 * @since 1.0.0
 */

import { useEffect, useRef } from "react";
import {
  useWatch,
  type FieldValues,
  type UseFormReturn,
} from "react-hook-form";

import { slugify } from "@admin/lib/utils";

export interface UseAutoSlugOptions<TValues extends FieldValues = FieldValues> {
  /**
   * The form instance to watch. Pass the `useForm()` return directly so
   * the hook can read `control`, `getValues`, and `setValue` without
   * needing a provider wrapper above the call site (EntryForm calls
   * useAutoSlug *before* it renders `<EntryFormProvider>`, so
   * `useFormContext()` would return null at that point).
   */
  form: UseFormReturn<TValues>;
  /**
   * Name of the field whose value drives the generated slug. Typically
   * "title", but may be any user-configurable field (e.g. "headline" if
   * the collection sets `admin.useAsTitle`).
   */
  titleFieldName: string;
  /**
   * Name of the slug field to write into. Typically "slug".
   */
  slugFieldName: string;
  /**
   * Disable the hook entirely. When false, no watching, no writes — the
   * hook short-circuits before it touches the form. Useful when the
   * collection has no slug field at all (the hook would otherwise
   * still register a benign watcher).
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Stop following the title, without unmounting the hook.
   *
   * A published entry's slug is a public contract: it is in inbound links, feeds, sitemaps, shares
   * and search results. Re-deriving it from an edited title silently retires a URL the author never
   * chose to change, and the old one 404s. No established CMS does this — WordPress, Ghost and
   * Contentful all stop tracking at first publish, Strapi stops as soon as the field is non-empty,
   * and Sanity never tracks at all.
   *
   * Distinct from `enabled`, deliberately. `enabled: false` means this form has no auto-slug
   * concept (a single, whose slug is fixed by config); `frozen` means the entry HAS one and has
   * outgrown it. Keeping them apart lets a caller that freezes still describe why, and lets the
   * manual-edit detection below stay meaningful for the unfrozen case.
   *
   * @default false
   */
  frozen?: boolean;
}

/**
 * useAutoSlug — write a slugified value into the slug field as the
 * title field changes, while the slug looks auto-generated.
 *
 * @example
 * ```tsx
 * function EntryForm({ titleField, slugField }) {
 *   const { form } = useEntryForm({...});
 *   useAutoSlug({
 *     form,
 *     titleFieldName: titleField?.name ?? "title",
 *     slugFieldName: slugField?.name ?? "slug",
 *     enabled: !!titleField && !!slugField,
 *   });
 *   return <form>…</form>;
 * }
 * ```
 */
export function useAutoSlug<TValues extends FieldValues = FieldValues>({
  form,
  titleFieldName,
  slugFieldName,
  enabled = true,
  frozen = false,
}: UseAutoSlugOptions<TValues>): void {
  const titleValue = useWatch({
    control: form.control,
    name: titleFieldName as never,
    disabled: !enabled,
  });
  const slugValue = useWatch({
    control: form.control,
    name: slugFieldName as never,
    disabled: !enabled,
  });

  // Track the last value we wrote so manual edits can be detected.
  // Once the live slug stops matching this ref, the user is steering
  // the slug themselves and we back off until the field is cleared.
  const lastGeneratedRef = useRef<string>("");
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    // Only operate when the slug field actually exists on the form.
    // Watching a non-existent path is harmless, but writing one would
    // silently introduce a phantom value that the form never declared.
    const values = form.getValues();
    if (!Object.prototype.hasOwnProperty.call(values, slugFieldName)) {
      return;
    }

    // Why: react-hook-form types watched values as `unknown`; coerce
    // safely to a string and bail when the title isn't string-like
    // (would yield "[object Object]" otherwise — meaningless slug).
    const currentTitle = typeof titleValue === "string" ? titleValue : "";
    const currentSlug = typeof slugValue === "string" ? slugValue : "";
    const generatedSlug = slugify(currentTitle);

    if (!initializedRef.current) {
      // First pass on mount. Seed the ref so manual-edit detection has
      // a baseline on the very next change.
      initializedRef.current = true;
      lastGeneratedRef.current = generatedSlug;

      // Existing slug matches what we'd generate — leave alone, treat as auto.
      if (currentSlug === generatedSlug) return;
      // Existing slug is non-empty and doesn't match — assume the user
      // (or seed data) set it deliberately, don't overwrite.
      if (currentSlug !== "") return;
    }

    const isStillAuto =
      currentSlug === "" || currentSlug === lastGeneratedRef.current;

    // Frozen entries seed the ref above and stop here. Checked after the mount pass rather than at
    // the top of the effect so the baseline is still established: the write is what must not
    // happen, not the bookkeeping that decides whether a later value was hand-edited.
    if (frozen) return;

    if (isStillAuto && generatedSlug !== currentSlug) {
      // shouldDirty stays false on the very first auto-write so we
      // don't trip the unsaved-changes warning before the user has
      // typed anything; subsequent writes mark dirty so Save is
      // enabled and the dirty pill lights up.
      const shouldMarkDirty = initializedRef.current;
      form.setValue(slugFieldName as never, generatedSlug as never, {
        shouldValidate: false,
        shouldDirty: shouldMarkDirty,
      });
      lastGeneratedRef.current = generatedSlug;
    }
  }, [
    enabled,
    frozen,
    form,
    titleFieldName,
    slugFieldName,
    titleValue,
    slugValue,
  ]);
}
