/**
 * A suggestion offers and waits: each choice calls its own handler, and nothing
 * is called because the suggestion is on screen.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FieldConfig } from "nextly/config";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SuggestionBlock, type SuggestionBlockProps } from "../SuggestionBlock";

const choices = { onUse: vi.fn(), onEdit: vi.fn(), onDismiss: vi.fn() };

const BLOCK: SuggestionBlockProps = {
  field: { name: "bio", type: "textarea" } as unknown as FieldConfig,
  fieldLabel: "Biography",
  suggestion: { value: "رائدة" },
  language: { code: "ar", rtl: true },
  choices,
};

beforeEach(() => {
  for (const choice of Object.values(choices)) choice.mockReset();
});

describe("SuggestionBlock", () => {
  it("draws nothing where there is no suggestion", () => {
    const { container } = render(
      <SuggestionBlock {...BLOCK} suggestion={undefined} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the suggested value in its language and direction", () => {
    render(<SuggestionBlock {...BLOCK} />);
    const value = screen.getByText("رائدة").closest("[lang]");
    expect(value).toHaveAttribute("lang", "ar");
    expect(value).toHaveAttribute("dir", "rtl");
  });

  it("chooses nothing by being shown", () => {
    render(<SuggestionBlock {...BLOCK} />);
    for (const choice of Object.values(choices)) {
      expect(choice).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["Use", choices.onUse],
    ["Edit", choices.onEdit],
    ["Dismiss", choices.onDismiss],
  ] as const)("%s makes that choice alone", async (verb, chosen) => {
    const user = userEvent.setup();
    render(<SuggestionBlock {...BLOCK} />);
    await user.click(
      screen.getByRole("button", {
        name: `${verb} the suggestion for Biography`,
      })
    );
    expect(chosen).toHaveBeenCalledOnce();
    for (const other of Object.values(choices)) {
      if (other !== chosen) expect(other).not.toHaveBeenCalled();
    }
  });

  it("shows the value with no choices to a reader who may only look", () => {
    render(<SuggestionBlock {...BLOCK} choices={undefined} />);
    expect(screen.getByText("رائدة")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
