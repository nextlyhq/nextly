/**
 * Every control in the rich-text toolbar has a name a screen reader can
 * announce. Most of them show only an icon, and a tooltip's text names
 * nothing until the tooltip opens, so each carries its name itself. The
 * colour buttons hold the native colour input a pointer lands on, which is
 * hidden from assistive technology so the button is the one control there.
 *
 * @module components/entries/fields/special/RichTextToolbar/RichTextToolbar.names.test
 */
import { TooltipProvider } from "@nextlyhq/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import type { RichTextFieldConfig } from "nextly/config";
import { useForm } from "react-hook-form";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { RichTextInput } from "../RichTextInput";

// Lexical's selection code touches DOM APIs jsdom does not implement.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  window.matchMedia =
    window.matchMedia ??
    (vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as typeof window.matchMedia);
});

// Every feature: a field that lists none offers them all.
const FIELD = {
  type: "richText",
  name: "body",
} as unknown as RichTextFieldConfig;

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function Harness() {
  const form = useForm<{ body: unknown }>({ defaultValues: { body: null } });
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RichTextInput name="body" field={FIELD} control={form.control} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

async function toolbar() {
  return within(
    await screen.findByRole("toolbar", { name: /text formatting/i })
  );
}

describe("rich-text toolbar names", () => {
  it("names every button", async () => {
    render(<Harness />);
    const buttons = (await toolbar()).getAllByRole("button");
    // POSITIVE CONTROL: the icon-only buttons are among those checked.
    expect(buttons.length).toBeGreaterThan(8);
    for (const button of buttons) {
      expect(button).toHaveAccessibleName();
    }
  });

  it("names the icon-only buttons by their tooltips' text", async () => {
    render(<Harness />);
    const bar = await toolbar();
    for (const name of [
      "Undo",
      "Redo",
      "Bold",
      "Italic",
      "Underline",
      "Text Color",
      "Background Color",
      "Clear Formatting",
      "More Formatting",
    ]) {
      expect(bar.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(
      bar.getByRole("button", { name: /^Alignment: / })
    ).toBeInTheDocument();
  });

  it("leaves no unnamed colour input inside the colour buttons", async () => {
    render(<Harness />);
    const bar = await toolbar();
    for (const name of ["Text Color", "Background Color"]) {
      const input = bar
        .getByRole("button", { name })
        .querySelector('input[type="color"]');
      // POSITIVE CONTROL: the input a pointer lands on is still there.
      expect(input).not.toBeNull();
      expect(input).toHaveAttribute("aria-hidden", "true");
      expect(input).toHaveAttribute("tabindex", "-1");
    }
  });
});
