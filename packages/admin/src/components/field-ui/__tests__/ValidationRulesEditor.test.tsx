/**
 * Guards the shared validation-rules editor.
 *
 * The property that matters is what it draws and what it does NOT: it renders
 * from the allowed set it is handed and has no opinion about field types at
 * all. Two surfaces previously decided by name — `type === "text" ||
 * type === "textarea"` — and a list of names cannot see a type it was not
 * written to know about, so a plugin-contributed type was offered nothing.
 *
 * The second property is that it stays neutral about storage: it reports the
 * rule core names `message`, and never the key a surface happens to store it
 * under.
 */
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import {
  drawsAnyValidationRule,
  EDITABLE_VALIDATION_RULES,
  ValidationRulesEditor,
} from "../ValidationRulesEditor";

describe("ValidationRulesEditor — draws exactly what it is allowed", () => {
  it("renders only the rules in the allowed set", () => {
    render(
      <ValidationRulesEditor
        allowed={["minLength", "maxLength"]}
        value={{}}
        onChange={vi.fn()}
      />
    );

    expect(screen.getByLabelText(/min length/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/max length/i)).toBeInTheDocument();
    // The control for the assertion above: a component that rendered every
    // rule would satisfy the two expectations and be wrong.
    expect(screen.queryByLabelText(/^pattern$/i)).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/custom error message/i)
    ).not.toBeInTheDocument();
  });

  it("renders nothing at all for an empty allowed set", () => {
    const { container } = render(
      <ValidationRulesEditor allowed={[]} value={{}} onChange={vi.fn()} />
    );
    expect(container.querySelectorAll("input")).toHaveLength(0);
  });

  it("ignores `required`, which every surface offers elsewhere", () => {
    // Drawing it here would draw it twice on every surface.
    const { container } = render(
      <ValidationRulesEditor
        allowed={["required"]}
        value={{}}
        onChange={vi.fn()}
      />
    );
    expect(container.querySelectorAll("input")).toHaveLength(0);
  });

  it("draws a rule it was handed even for a type it has never heard of", () => {
    // The whole point: no branch on a field type exists, so a plugin-contributed
    // type gets whatever its storage primitive entitles it to.
    render(
      <ValidationRulesEditor
        allowed={["pattern", "message"]}
        value={{}}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByLabelText(/^pattern$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/custom error message/i)).toBeInTheDocument();
  });
});

describe("ValidationRulesEditor — what it reports", () => {
  it("reports only the rule that changed, for the caller to merge", async () => {
    const onChange = vi.fn();
    render(
      <ValidationRulesEditor
        allowed={["pattern"]}
        value={{ minLength: 3 }}
        onChange={onChange}
      />
    );

    // Sending the whole value back would make a caller storing extra keys lose
    // them, and would hide which rule the author actually touched.
    await userEvent.type(screen.getByLabelText(/^pattern$/i), "a");
    expect(onChange).toHaveBeenCalled();
    const [reported] = onChange.mock.calls[0] as [Record<string, unknown>];
    expect(Object.keys(reported)).toEqual(["pattern"]);
  });

  it("names the message rule as core names it, not as a surface stores it", async () => {
    const onChange = vi.fn();
    render(
      <ValidationRulesEditor
        allowed={["message"]}
        value={{}}
        onChange={onChange}
      />
    );
    await userEvent.type(screen.getByLabelText(/custom error message/i), "x");
    const [reported] = onChange.mock.calls[0] as [Record<string, unknown>];
    expect(Object.keys(reported)).toEqual(["message"]);
    expect(reported).not.toHaveProperty("errorMessage");
  });

  it("does not claim the message describes the pattern, even beside one", () => {
    // Whether the message covers that one rule or every rule is the caller's
    // semantics, and this component cannot see them: the form runtime hands
    // the same string to required, length and format failures, so copy naming
    // the pattern would be shown for failures it does not describe.
    render(
      <ValidationRulesEditor
        allowed={["pattern", "message"]}
        value={{}}
        onChange={vi.fn()}
      />
    );
    expect(screen.queryByText(/the Pattern above/i)).not.toBeInTheDocument();
    // The control: the help text is present and general, so the assertion
    // above is about what it SAYS rather than about it having gone missing.
    expect(screen.getByText(/fails validation/i)).toBeInTheDocument();
  });
});

describe("drawsAnyValidationRule", () => {
  it("is false for a set this editor draws nothing from", () => {
    expect(drawsAnyValidationRule([])).toBe(false);
    expect(drawsAnyValidationRule(["required"])).toBe(false);
  });

  it("is true as soon as one drawable rule is present", () => {
    expect(drawsAnyValidationRule(["required", "message"])).toBe(true);
  });

  it("agrees with what the editor actually renders", () => {
    // The two must not drift: a surface asks this to decide whether to show its
    // own "no options" notice, and a wrong answer shows that notice beside a
    // rendered control, or hides it beside nothing.
    for (const rule of EDITABLE_VALIDATION_RULES) {
      const { container, unmount } = render(
        <ValidationRulesEditor allowed={[rule]} value={{}} onChange={vi.fn()} />
      );
      expect(drawsAnyValidationRule([rule])).toBe(true);
      expect(container.querySelectorAll("input").length).toBeGreaterThan(0);
      unmount();
    }
  });
});
