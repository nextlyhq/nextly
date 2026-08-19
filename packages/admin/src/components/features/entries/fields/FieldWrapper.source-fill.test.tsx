/**
 * FieldWrapper — the source-fill action, in BOTH layouts.
 *
 * The wrapper has two render branches, vertical and horizontal, and the
 * horizontal one exists for checkboxes. It already rendered the source HINT and
 * did not render the ACTION, so a localized checkbox showed its source text and
 * offered no way to take it — the two branches disagreeing rather than a
 * decision about checkboxes. Only `password` can never be localized, so a schema
 * author declaring `localized: true` on a checkbox is a supported thing to do.
 *
 * Each layout is asserted against the other, so a fix applied to one branch and
 * forgotten in the other fails here rather than shipping.
 */

import { render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";

import {
  EntryLocaleProvider,
  type EntryLocaleContextValue,
} from "../EntryLocaleContext";
import { TranslationFieldProvider } from "../TranslationMode/TranslationFieldContext";

import { FieldWrapper } from "./FieldWrapper";

/** Localized explicitly: a checkbox is shared by default, and may be declared otherwise. */
const checkboxField = {
  name: "featured",
  type: "checkbox",
  label: "Featured",
  localized: true,
} as never;
const textField = {
  name: "title",
  type: "text",
  label: "Title",
  localized: true,
} as never;

function renderField({
  field,
  horizontal,
  source,
}: {
  field: unknown;
  horizontal: boolean;
  source?: Record<string, unknown>;
}) {
  const locale: EntryLocaleContextValue = {
    rtl: false,
    collectionLocalized: true,
    isNonDefaultLocale: true,
  };

  function Harness() {
    const form = useForm<Record<string, unknown>>({
      defaultValues: { featured: false, title: "" },
    });
    return (
      <FormProvider {...form}>
        <EntryLocaleProvider value={locale}>
          <TranslationFieldProvider
            value={
              source ? { sourceValues: source, sourceLabel: "English" } : {}
            }
          >
            <FieldWrapper field={field as never} horizontal={horizontal}>
              <input data-testid="control" />
            </FieldWrapper>
          </TranslationFieldProvider>
        </EntryLocaleProvider>
      </FormProvider>
    );
  }

  return render(<Harness />);
}

describe("FieldWrapper source-fill", () => {
  it("offers the action on a localized field in the VERTICAL layout", () => {
    renderField({
      field: textField,
      horizontal: false,
      source: { title: "Hi" },
    });
    expect(
      screen.getByRole("button", { name: /use the english text for title/i })
    ).toBeInTheDocument();
  });

  it("offers the action on a localized field in the HORIZONTAL layout", () => {
    // The branch checkboxes take. It rendered the source hint and not the
    // action, so the field said what the source was and gave no way to use it.
    renderField({
      field: checkboxField,
      horizontal: true,
      source: { featured: true },
    });
    expect(
      screen.getByRole("button", { name: /use the english text for featured/i })
    ).toBeInTheDocument();
  });

  it("offers nothing in EITHER layout when there is no source", () => {
    // The negative control for both branches at once: without it, "the action
    // renders" would pass on a wrapper that renders it unconditionally.
    for (const horizontal of [false, true]) {
      const { unmount } = renderField({
        field: horizontal ? checkboxField : textField,
        horizontal,
      });
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("offers nothing on a SHARED field, in either layout", () => {
    // A shared field holds one value for every language, so there is no source
    // to take — the action would write the value onto itself.
    const shared = { name: "price", type: "number", label: "Price" } as never;
    for (const horizontal of [false, true]) {
      const { unmount } = renderField({
        field: shared,
        horizontal,
        source: { price: 10 },
      });
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      unmount();
    }
  });
});
