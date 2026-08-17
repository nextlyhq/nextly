/**
 * A plugin-contributed field type is offered the rules of the built-in type its
 * declared storage primitive behaves as.
 *
 * Before the rule set came from core, this tab decided what to draw from three
 * hardcoded sets of built-in type names. A plugin type is in none of them, so
 * it matched no branch and was offered nothing but the universal message field
 * — silently, because every branch looked correct.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BuilderField } from "../../types";
import { ValidationTab } from "../ValidationTab";

const branding = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => branding.current,
}));

const withPluginType = (type: string, storage: string) => {
  branding.current = {
    plugins: [{ name: "acme", enabled: true, fieldTypes: [{ type, storage }] }],
  };
};

const field = (type: string): BuilderField =>
  ({ name: "f", type, label: "F" }) as unknown as BuilderField;

describe("ValidationTab, plugin-contributed field types", () => {
  it("offers text rules to a plugin type stored as text", () => {
    withPluginType("acme-colour", "text");
    render(<ValidationTab field={field("acme-colour")} onChange={() => {}} />);

    expect(screen.getByLabelText("Min length")).toBeInTheDocument();
    expect(screen.getByLabelText("Max length")).toBeInTheDocument();
    expect(screen.getByLabelText("Pattern")).toBeInTheDocument();
    // The separating property: it must get TEXT rules specifically, not merely
    // some rules. A numeric bound would mean it fell through to a wrong branch.
    expect(screen.queryByLabelText("Min")).not.toBeInTheDocument();
  });

  it("offers numeric rules to a plugin type stored as a number", () => {
    withPluginType("acme-rating", "number");
    render(<ValidationTab field={field("acme-rating")} onChange={() => {}} />);

    expect(screen.getByLabelText("Min")).toBeInTheDocument();
    expect(screen.getByLabelText("Max")).toBeInTheDocument();
    expect(screen.queryByLabelText("Min length")).not.toBeInTheDocument();
  });

  it("offers only universal rules to a type no plugin claims", () => {
    branding.current = { plugins: [] };
    render(<ValidationTab field={field("acme-unknown")} onChange={() => {}} />);

    // Population before verdict: the tab rendered something, so the absences
    // below are facts about the markup rather than about an empty render.
    expect(screen.getByLabelText("Custom error message")).toBeInTheDocument();
    expect(screen.queryByLabelText("Min length")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Min")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Pattern")).not.toBeInTheDocument();
  });

  it("bounds a length rule to whole, non-negative numbers", () => {
    // A length is a count of things. Leaving step and min unset let `2.7` and
    // `-5` be typed into a persisted schema.
    withPluginType("acme-colour", "text");
    render(<ValidationTab field={field("acme-colour")} onChange={() => {}} />);

    const minLength = screen.getByLabelText("Min length");
    expect(minLength).toHaveAttribute("step", "1");
    expect(minLength).toHaveAttribute("min", "0");
  });

  it("leaves a numeric bound unconstrained, since a value may be negative or fractional", () => {
    withPluginType("acme-rating", "number");
    render(<ValidationTab field={field("acme-rating")} onChange={() => {}} />);

    const min = screen.getByLabelText("Min");
    expect(min).not.toHaveAttribute("step");
    expect(min).not.toHaveAttribute("min");
  });

  it("gives each control a unique id so two open editors cannot collide", () => {
    withPluginType("acme-colour", "text");
    const { container: a } = render(
      <ValidationTab field={field("acme-colour")} onChange={() => {}} />
    );
    const { container: b } = render(
      <ValidationTab field={field("acme-colour")} onChange={() => {}} />
    );

    const ids = (root: HTMLElement) =>
      [...root.querySelectorAll("input")].map(i => i.id);
    const first = ids(a);
    const second = ids(b);

    expect(first.length).toBeGreaterThan(0);
    expect(first).toEqual(second.map(() => expect.any(String)));
    // No id appears in both renders, so `label[for]` in one cannot resolve to
    // an input in the other.
    expect(first.filter(id => second.includes(id))).toEqual([]);
  });
});
