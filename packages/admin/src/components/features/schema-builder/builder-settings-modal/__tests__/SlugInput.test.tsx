// SlugInput is a controlled text input for an entity's slug, and it stops
// accepting edits once the entity exists.
//
// That read-only-after-creation rule is the contract worth locking: a slug is
// an address. Renaming one after anything points at it breaks those links
// silently, so the component refuses rather than warning, and these cases
// assert the refusal is a property of the rendered input rather than of a
// wrapper that happens not to pass a handler.
//
// It is controlled, so every case drives it through a stateful wrapper — the
// same shape a real consumer provides (BasicsTab, via react-hook-form). Testing
// it uncontrolled would let a typed character appear on screen from React's own
// DOM state and read as the component accepting input it never received.
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { SlugInput } from "../SlugInput";

function Controlled(props: {
  initial: string;
  singular?: string;
  readOnly?: boolean;
  onChange?: (next: string) => void;
}) {
  const [value, setValue] = useState(props.initial);
  return (
    <SlugInput
      singular={props.singular ?? "Blog Post"}
      value={value}
      readOnly={props.readOnly ?? false}
      onChange={next => {
        setValue(next);
        props.onChange?.(next);
      }}
    />
  );
}

describe("SlugInput", () => {
  it("shows the slug as the input's value", () => {
    render(<Controlled initial="blog_post" />);
    expect(screen.getByRole("textbox", { name: /slug/i })).toHaveValue(
      "blog_post"
    );
  });

  it("names itself for a screen reader, since the field carries no visible label of its own", () => {
    render(<Controlled initial="blog_post" />);
    expect(screen.getByLabelText("Slug")).toBeInTheDocument();
  });

  it("emits each keystroke, so the parent form sees an override immediately", () => {
    const onChange = vi.fn();
    render(<Controlled initial="" onChange={onChange} />);
    const input = screen.getByRole("textbox", { name: /slug/i });
    return userEvent.type(input, "post").then(() => {
      expect(onChange).toHaveBeenLastCalledWith("post");
    });
  });

  it("refuses edits when read-only but keeps the value reachable", async () => {
    // `readOnly` rather than `disabled`, which is the component's own stated
    // decision and the separating property between them: a disabled input
    // leaves the tab order, so an existing entity's slug would stop being
    // selectable, copyable and reachable by a screen reader. Asserting only
    // "typing does nothing" would pass for `disabled` too.
    const onChange = vi.fn();
    render(<Controlled initial="blog_post" readOnly onChange={onChange} />);
    const input = screen.getByRole("textbox", { name: /slug/i });

    await userEvent.type(input, "x");
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue("blog_post");

    expect(input).not.toBeDisabled();
    input.focus();
    expect(input).toHaveFocus();
  });
});
