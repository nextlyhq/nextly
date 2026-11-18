/**
 * A refused save's message, where the surface draws some fields out of
 * sight: a field the surface can show is named with "Show me", which closes
 * the message and shows it; a field it cannot show keeps its usual link.
 */
import { toast } from "@nextlyhq/ui";
import { fireEvent, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render } from "@admin/__tests__/utils";

import { FormErrorSummary } from "../FormErrorSummary";

vi.mock("@nextlyhq/ui", async orig => {
  const actual = await orig<typeof import("@nextlyhq/ui")>();
  return { ...actual, toast: { error: vi.fn(), dismiss: vi.fn() } };
});

/** The message's body, as the last toast was handed it, drawn on its own. */
function drawnMessage(): void {
  const options = vi.mocked(toast.error).mock.lastCall?.[1] as
    | { description?: ReactElement }
    | undefined;
  render(<>{options?.description}</>);
}

const errors = {
  summary: { type: "required", message: "Summary is required" },
  body: { type: "required", message: "Body is required" },
};

describe("a refused save's message, beside a surface that shows fields", () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.dismiss).mockClear();
  });

  it("names a field the surface can show with Show me, which shows it", () => {
    const show = vi.fn();
    render(
      <FormErrorSummary
        errors={errors}
        submitCount={1}
        reveal={path => (path === "summary" ? show : null)}
      />
    );
    drawnMessage();

    const showMe = screen.getByRole("button", { name: "Show me Summary" });
    expect(showMe).toHaveTextContent("Show me");
    fireEvent.click(showMe);
    expect(show).toHaveBeenCalledTimes(1);
    expect(toast.dismiss).toHaveBeenCalledWith("form-errors");
  });

  it("keeps the usual link for a field the surface cannot show", () => {
    render(
      <FormErrorSummary
        errors={errors}
        submitCount={1}
        reveal={path => (path === "summary" ? () => {} : null)}
      />
    );
    drawnMessage();

    expect(screen.getByRole("button", { name: "Body" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Show me Body" })
    ).not.toBeInTheDocument();
  });

  it("offers no Show me where no surface says how to show a field", () => {
    render(<FormErrorSummary errors={errors} submitCount={1} />);
    drawnMessage();

    expect(screen.queryByText("Show me")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Summary" })).toBeInTheDocument();
  });
});
