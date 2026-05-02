// Why: SlugInput shows the auto-derived slug with an AUTO badge, and reveals
// an editable input on Edit. Once the user overrides, onChange propagates
// each keystroke so the parent form sees the override immediately. These
// tests lock the read/edit modes and the onChange contract so a refactor
// can't silently break the auto-derive UX.
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
  it("renders the slug value with an AUTO badge in read mode", () => {
    render(<Controlled initial="blog_post" />);
    expect(screen.getByText("blog_post")).toBeInTheDocument();
    expect(screen.getByText("AUTO")).toBeInTheDocument();
  });

  it("reveals an input pre-filled with current value when Edit is clicked", async () => {
    const user = userEvent.setup();
    render(<Controlled initial="blog_post" />);
    await user.click(screen.getByRole("button", { name: /edit/i }));
    expect(screen.getByRole("textbox", { name: /slug/i })).toHaveValue(
      "blog_post"
    );
  });

  it("emits each keystroke as an onChange call when overriding", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled initial="blog_post" onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /edit/i }));
    const input = screen.getByRole("textbox", { name: /slug/i });
    await user.clear(input);
    await user.type(input, "post");
    expect(onChange).toHaveBeenLastCalledWith("post");
  });

  it("hides the AUTO badge once the user has clicked Edit", async () => {
    const user = userEvent.setup();
    render(<Controlled initial="blog_post" />);
    await user.click(screen.getByRole("button", { name: /edit/i }));
    expect(screen.queryByText("AUTO")).not.toBeInTheDocument();
  });
});
