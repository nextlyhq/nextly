/**
 * The one numeric validation bound every editing surface draws.
 *
 * It exists because two surfaces drew it independently and disagreed: one
 * coerced with `Number` and constrained nothing, so a length of `2.7` or `-5`
 * could be typed and persisted; the other used `parseInt` with a floor of zero.
 * The three behaviours asserted here are exactly the ones they disagreed about.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ValidationNumberField } from "../ValidationNumberField";

describe("ValidationNumberField", () => {
  it("constrains a bound that counts things to whole, non-negative numbers", () => {
    render(
      <ValidationNumberField
        label="Min length"
        counts
        value={undefined}
        onChange={() => {}}
      />
    );

    const input = screen.getByLabelText("Min length");
    expect(input).toHaveAttribute("step", "1");
    expect(input).toHaveAttribute("min", "0");
  });

  it("leaves a bound on a value unconstrained", () => {
    // The separating property: a component that constrained everything would
    // satisfy the case above and silently forbid a negative minimum price.
    render(
      <ValidationNumberField
        label="Min"
        value={undefined}
        onChange={() => {}}
      />
    );

    const input = screen.getByLabelText("Min");
    expect(input).not.toHaveAttribute("step");
    expect(input).not.toHaveAttribute("min");
  });

  it("reports a cleared field as unset rather than as zero", async () => {
    const onChange = vi.fn();
    render(
      <ValidationNumberField
        label="Max length"
        counts
        value={5}
        onChange={onChange}
      />
    );

    await userEvent.clear(screen.getByLabelText("Max length"));

    expect(onChange).toHaveBeenCalledWith(undefined);
    // Zero is a legitimate bound, so it must never stand in for "no bound".
    expect(onChange).not.toHaveBeenCalledWith(0);
  });

  it("still reports an explicit zero as zero", async () => {
    const onChange = vi.fn();
    render(
      <ValidationNumberField
        label="Min length"
        counts
        value={undefined}
        onChange={onChange}
      />
    );

    await userEvent.type(screen.getByLabelText("Min length"), "0");

    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("gives two instances different ids so their labels cannot cross", () => {
    render(
      <>
        <ValidationNumberField
          label="Min length"
          value={undefined}
          onChange={() => {}}
        />
        <ValidationNumberField
          label="Max length"
          value={undefined}
          onChange={() => {}}
        />
      </>
    );

    const a = screen.getByLabelText("Min length");
    const b = screen.getByLabelText("Max length");
    expect(a.id).toBeTruthy();
    expect(b.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
  });

  it("connects its help text to the control", () => {
    render(
      <ValidationNumberField
        label="Min length"
        description="Minimum characters required."
        value={undefined}
        onChange={() => {}}
      />
    );

    const input = screen.getByLabelText("Min length");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      "Minimum characters required."
    );
  });

  it("names no description when it has none", () => {
    render(
      <ValidationNumberField
        label="Min"
        value={undefined}
        onChange={() => {}}
      />
    );

    // A dangling `aria-describedby` points assistive technology at nothing.
    expect(screen.getByLabelText("Min")).not.toHaveAttribute(
      "aria-describedby"
    );
  });
});
