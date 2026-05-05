// Why: lock the resolution chain in RepeaterRowLabel so the Builder's
// "Collapsed row title" dropdown (rowLabelField) actually wires through to
// what users see at edit time. Regression coverage for the Task 5 PR 6 fix
// where the knob was previously dead code (Builder wrote it, renderer
// ignored it).
import type { RepeaterFieldConfig } from "@revnixhq/nextly/config";
import { describe, expect, it } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { RepeaterRowLabel } from "../RepeaterRowLabel";

const baseField = {
  type: "repeater" as const,
  name: "items",
  labels: { singular: "Item", plural: "Items" },
  fields: [],
} as RepeaterFieldConfig;

describe("RepeaterRowLabel resolution chain", () => {
  it("uses explicit rowLabelField when set", () => {
    const field: RepeaterFieldConfig = {
      ...baseField,
      name: "faqs",
      labels: { singular: "FAQ", plural: "FAQs" },
      // @ts-expect-error rowLabelField isn't on the public type yet but the
      // Builder writes it and PR 6 of Task 5 reads it. Feature-flag the cast
      // until the public type catches up in PR 7.
      rowLabelField: "question",
    };
    render(
      <RepeaterRowLabel
        index={0}
        field={field}
        data={{ question: "Why does this exist?", answer: "Because." }}
      />
    );
    expect(screen.getByText("Why does this exist?")).toBeInTheDocument();
  });

  it("falls back to auto-detect (title) when rowLabelField is absent", () => {
    render(
      <RepeaterRowLabel
        index={0}
        field={baseField}
        data={{ title: "First item", body: "Body text" }}
      />
    );
    expect(screen.getByText("First item")).toBeInTheDocument();
  });

  it("falls back to auto-detect (name) when title is empty", () => {
    render(
      <RepeaterRowLabel
        index={0}
        field={baseField}
        data={{ title: "", name: "Named one" }}
      />
    );
    expect(screen.getByText("Named one")).toBeInTheDocument();
  });

  it("falls back to '{singular} {index+1}' when no detectable field has a value", () => {
    const field: RepeaterFieldConfig = {
      ...baseField,
      name: "things",
      labels: { singular: "Thing", plural: "Things" },
    };
    render(<RepeaterRowLabel index={2} field={field} data={{ value: 42 }} />);
    expect(screen.getByText("Thing 3")).toBeInTheDocument();
  });

  it("falls back when rowLabelField points at a non-existent sub-field", () => {
    const field: RepeaterFieldConfig = {
      ...baseField,
      // @ts-expect-error see comment above
      rowLabelField: "nonexistent",
    };
    render(
      <RepeaterRowLabel
        index={0}
        field={field}
        data={{ title: "Fallback works" }}
      />
    );
    expect(screen.getByText("Fallback works")).toBeInTheDocument();
  });

  it("falls back when rowLabelField value is empty string", () => {
    const field: RepeaterFieldConfig = {
      ...baseField,
      // @ts-expect-error see comment above
      rowLabelField: "question",
    };
    render(
      <RepeaterRowLabel
        index={0}
        field={field}
        data={{ question: "", title: "Title fallback" }}
      />
    );
    expect(screen.getByText("Title fallback")).toBeInTheDocument();
  });
});
