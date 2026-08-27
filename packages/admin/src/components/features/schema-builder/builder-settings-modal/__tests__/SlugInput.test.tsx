// SlugInput is a controlled text input for an entity's slug, read-only once the
// entity exists.
//
// It previously had read and edit modes — a bold value, a pencil button, a
// "Done" — and four tests locked that UX. `7cdc8d8ee` ("stop offering an
// entity's slug for editing after creation") replaced the whole arrangement
// with a single `Input`, so those tests described a component that no longer
// exists and asserted against markup nothing rendered. They are replaced here
// rather than deleted: the component still has a contract, and leaving it
// uncovered would trade four failing tests for none at all.
//
// SlugInput is controlled, so these use a stateful wrapper — the same shape any
// real consumer (BasicsTab with react-hook-form) provides.
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
