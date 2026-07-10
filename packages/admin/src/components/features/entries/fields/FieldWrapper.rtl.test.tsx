/**
 * FieldWrapper — RTL direction (i18n M7)
 *
 * The active content locale's writing direction flows into the field wrapper via
 * EntryLocaleContext. When the locale is RTL, the wrapper renders `dir="rtl"` so the
 * input, label, and description mirror. LTR / non-localized editors are unaffected.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EntryLocaleProvider } from "../EntryLocaleContext";

import { FieldWrapper } from "./FieldWrapper";

const textField = { name: "title", type: "text", label: "Title" } as never;

function renderWrapper(rtl: boolean, horizontal = false) {
  return render(
    <EntryLocaleProvider value={{ locale: rtl ? "ar" : "en", rtl }}>
      <FieldWrapper field={textField} horizontal={horizontal}>
        <input data-testid="control" />
      </FieldWrapper>
    </EntryLocaleProvider>
  );
}

describe("FieldWrapper RTL direction", () => {
  it("marks the wrapper dir=rtl when the active locale is right-to-left", () => {
    renderWrapper(true);
    expect(screen.getByTestId("control").closest("[data-field]")).toHaveAttribute(
      "dir",
      "rtl"
    );
  });

  it("leaves dir unset for LTR locales", () => {
    renderWrapper(false);
    expect(
      screen.getByTestId("control").closest("[data-field]")
    ).not.toHaveAttribute("dir");
  });

  it("applies dir=rtl in horizontal layout too", () => {
    renderWrapper(true, true);
    expect(screen.getByTestId("control").closest("[data-field]")).toHaveAttribute(
      "dir",
      "rtl"
    );
  });

  it("defaults to LTR when no EntryLocale provider is present", () => {
    render(
      <FieldWrapper field={textField}>
        <input data-testid="control" />
      </FieldWrapper>
    );
    expect(
      screen.getByTestId("control").closest("[data-field]")
    ).not.toHaveAttribute("dir");
  });
});
