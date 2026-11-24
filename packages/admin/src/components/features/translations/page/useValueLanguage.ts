"use client";

/**
 * Marks the controls a field's value is written in with the value's language
 * and writing direction.
 *
 * The controls and not the field around them: a field's label and its help are
 * in the admin's own language, so marking the whole field would have a screen
 * reader speak "Excerpt" as Arabic and mirror the label to the right of an
 * English page. A field type draws its own controls, some of them after it has
 * mounted (the rich text editor loads when it is first shown), so they are
 * marked as they appear.
 *
 * @module components/features/translations/page/useValueLanguage
 */

import { useEffect, useState, type RefCallback } from "react";

/** The controls text is written in; a tick box or a date is in no language. */
const VALUE_CONTROLS = [
  'input[type="text"]',
  'input[type="email"]',
  'input[type="search"]',
  "input:not([type])",
  "textarea",
  '[contenteditable="true"]',
].join(",");

/** The language a value is in, as `lang` and `dir` spell it. */
export interface ValueLanguage {
  code: string;
  rtl: boolean;
}

export function directionOf({ rtl }: ValueLanguage): "rtl" | "ltr" {
  return rtl ? "rtl" : "ltr";
}

function mark(container: HTMLElement, language: ValueLanguage): void {
  for (const control of container.querySelectorAll(VALUE_CONTROLS)) {
    control.setAttribute("lang", language.code);
    control.setAttribute("dir", directionOf(language));
  }
}

/** A ref for the element holding the field, whose controls are marked. */
export function useValueLanguage(
  language: ValueLanguage
): RefCallback<HTMLElement> {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const { code, rtl } = language;
  useEffect(() => {
    if (container === null) return;
    const value = { code, rtl };
    mark(container, value);
    const observer = new MutationObserver(() => mark(container, value));
    observer.observe(container, {
      childList: true,
      subtree: true,
      // An editor turns its own element editable after it has mounted.
      attributes: true,
      attributeFilter: ["contenteditable"],
    });
    return () => observer.disconnect();
  }, [container, code, rtl]);
  return setContainer;
}
