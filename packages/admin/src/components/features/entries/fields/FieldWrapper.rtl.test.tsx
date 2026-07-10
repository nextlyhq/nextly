/**
 * FieldWrapper — per-field i18n affordances (M7, design spec §10)
 *
 * Two behaviours, both driven by EntryLocaleContext + the shared `isFieldLocalized` classifier:
 *  - RTL: a *translatable* field edited in an RTL language renders `dir="rtl"`. Shared fields and
 *    LTR languages stay LTR.
 *  - "Shared across languages" affordance: in a multilingual collection, a non-translatable field
 *    is marked so editors know its value applies to every language (spec §7/§10).
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  EntryLocaleProvider,
  type EntryLocaleContextValue,
} from "../EntryLocaleContext";

import { FieldWrapper } from "./FieldWrapper";

const textField = { name: "title", type: "text", label: "Title" } as never;
// `number` is a shared-by-default type (not text-like), so it is never translatable.
const numberField = { name: "price", type: "number", label: "Price" } as never;

function ctx(over: Partial<EntryLocaleContextValue>): EntryLocaleContextValue {
  return {
    rtl: false,
    collectionLocalized: false,
    isNonDefaultLocale: false,
    ...over,
  };
}

function renderField(
  field: unknown,
  over: Partial<EntryLocaleContextValue>,
  horizontal = false
) {
  return render(
    <EntryLocaleProvider value={ctx(over)}>
      <FieldWrapper field={field as never} horizontal={horizontal}>
        <input data-testid="control" />
      </FieldWrapper>
    </EntryLocaleProvider>
  );
}

const wrapperOf = () =>
  screen.getByTestId("control").closest("[data-field]") as HTMLElement;

describe("FieldWrapper RTL direction", () => {
  it("flips a translatable field RTL in a right-to-left language", () => {
    renderField(textField, { locale: "ar", rtl: true, collectionLocalized: true });
    expect(wrapperOf()).toHaveAttribute("dir", "rtl");
  });

  it("leaves dir unset for LTR locales", () => {
    renderField(textField, { locale: "en", rtl: false, collectionLocalized: true });
    expect(wrapperOf()).not.toHaveAttribute("dir");
  });

  it("does NOT flip a shared field even in an RTL language", () => {
    // `number` is shared → language-neutral → stays LTR.
    renderField(numberField, { locale: "ar", rtl: true, collectionLocalized: true });
    expect(wrapperOf()).not.toHaveAttribute("dir");
  });

  it("applies dir=rtl in horizontal layout for a translatable field", () => {
    renderField(textField, { locale: "ar", rtl: true, collectionLocalized: true }, true);
    expect(wrapperOf()).toHaveAttribute("dir", "rtl");
  });

  it("defaults to LTR when no EntryLocale provider is present", () => {
    render(
      <FieldWrapper field={textField} horizontal={false}>
        <input data-testid="control" />
      </FieldWrapper>
    );
    expect(wrapperOf()).not.toHaveAttribute("dir");
  });
});

describe("FieldWrapper shared-across-languages affordance", () => {
  it("marks a shared field in a multilingual collection", () => {
    renderField(numberField, { collectionLocalized: true });
    expect(screen.getByText("Shared")).toBeInTheDocument();
  });

  it("does NOT mark a translatable field", () => {
    renderField(textField, { collectionLocalized: true });
    expect(screen.queryByText("Shared")).not.toBeInTheDocument();
  });

  it("shows no affordance when the collection is not localized", () => {
    renderField(numberField, { collectionLocalized: false });
    expect(screen.queryByText("Shared")).not.toBeInTheDocument();
  });
});
