// Why: SlugInput shows the auto-derived slug with a dim "Slug:" label, the
// value bold next to it, and a Lucide pencil icon button to enter edit
// mode (PR B redesign). Once in edit mode, onChange propagates each
// keystroke so the parent form sees the override immediately. These tests
// lock the read/edit modes and the onChange contract so a refactor can't
// silently break the auto-derive UX.
//
// Note: SlugInput is a controlled component, so tests use a stateful wrapper
// (`<Controlled>`) that feeds onChange back into value — same pattern any
// real consumer (BasicsTab + react-hook-form) would use.
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

import { render, screen } from "@admin/__tests__/utils";

import { SlugInput } from "../SlugInput";

function Controlled(props: {
  initial: string;
  singular?: string;
  onChange?: (next: string) => void;
}) {
  const [value, setValue] = useState(props.initial);
  return (
    <SlugInput
      singular={props.singular ?? "Blog Post"}
      value={value}
      onChange={next => {
        setValue(next);
        props.onChange?.(next);
      }}
    />
  );
}

describe("SlugInput", () => {
  it("renders the slug value with a dim 'Slug:' label in read mode", () => {
    render(<Controlled initial="blog_post" />);
    expect(screen.getByText("blog_post")).toBeInTheDocument();
    // Why: PR G dropped the redundant "Slug:" prefix per feedback 2.
    // The Label above already says "Slug" so the prefix was duplicate.
    expect(screen.queryByText(/^Slug:/)).toBeNull();
  });

  it("renders a pencil icon edit button (no 'AUTO' badge, no 'Edit' text)", () => {
    render(<Controlled initial="blog_post" />);
    expect(screen.queryByText("AUTO")).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: /edit slug/i });
    // The button should contain an SVG (the pencil), not text 'Edit'.
    expect(button.querySelector("svg")).not.toBeNull();
    expect(button).not.toHaveTextContent(/^Edit$/);
  });

  it("reveals an input pre-filled with current value when Edit is clicked", async () => {
    const user = userEvent.setup();
    render(<Controlled initial="blog_post" />);
    await user.click(screen.getByRole("button", { name: /edit slug/i }));
    expect(screen.getByRole("textbox", { name: /slug/i })).toHaveValue(
      "blog_post"
    );
  });

  it("emits each keystroke as an onChange call when overriding", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled initial="blog_post" onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /edit slug/i }));
    const input = screen.getByRole("textbox", { name: /slug/i });
    await user.clear(input);
    await user.type(input, "post");
    expect(onChange).toHaveBeenLastCalledWith("post");
  });
});
