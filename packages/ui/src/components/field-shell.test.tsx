// @vitest-environment jsdom
/**
 * A field's width is a NAME, not a measurement, and each name caps the control
 * rather than the row. The row still spans its container so the label and the
 * error message align with everything above and below them; only the control
 * is constrained. Asserting the cap on the row instead would pass while
 * producing ragged labels.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FieldShell } from "./field-shell";

describe("FieldShell", () => {
  it("caps a half-width control at the half token", () => {
    const { container } = render(
      <FieldShell label="Name" width="half">
        <input aria-label="Name" />
      </FieldShell>
    );
    const control = container.querySelector("input")?.parentElement;
    expect(control?.className).toContain("--nx-field-half");
  });

  it("caps a full-width control at the full token", () => {
    const { container } = render(
      <FieldShell label="Description" width="full">
        <input aria-label="Description" />
      </FieldShell>
    );
    const control = container.querySelector("input")?.parentElement;
    expect(control?.className).toContain("--nx-field-full");
  });

  it("leaves a fill control uncapped", () => {
    const { container } = render(
      <FieldShell label="Body" width="fill">
        <input aria-label="Body" />
      </FieldShell>
    );
    const control = container.querySelector("input")?.parentElement;
    expect(control?.className).not.toContain("max-w-");
  });

  it("defaults to half when no width is given", () => {
    const { container } = render(
      <FieldShell label="Slug">
        <input aria-label="Slug" />
      </FieldShell>
    );
    const control = container.querySelector("input")?.parentElement;
    expect(control?.className).toContain("--nx-field-half");
  });

  it("renders a description only when one is supplied", () => {
    const { rerender } = render(
      <FieldShell label="Name" description="Shown in the key list.">
        <input aria-label="Name" />
      </FieldShell>
    );
    expect(screen.getByText("Shown in the key list.")).toBeDefined();

    rerender(
      <FieldShell label="Name">
        <input aria-label="Name" />
      </FieldShell>
    );
    expect(screen.queryByText("Shown in the key list.")).toBeNull();
  });

  it("renders an error only when one is supplied", () => {
    render(
      <FieldShell label="Name" error="Name is required">
        <input aria-label="Name" />
      </FieldShell>
    );
    expect(screen.getByText("Name is required")).toBeDefined();
  });
});
