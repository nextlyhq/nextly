/**
 * The notice on an email kept on its first engine: it names what keeps it
 * there, and reads it as Liquid only once the edits are saved and the author
 * confirms. A refusal from the server is shown with the server's reason.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EmailTemplateRecord } from "@admin/services/emailTemplateApi";

const mutate = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("@admin/hooks/queries/useEmailTemplates", () => ({
  useTemplateEngine: () => ({
    data: {
      kept: true,
      reasons: [
        {
          field: "htmlContent",
          label: "HTML",
          reason: "uses a filter the previous engine wrote as text",
        },
      ],
    },
  }),
  useReadAsLiquid: () => ({ mutate, isPending: false }),
}));
vi.mock("@admin/components/ui", () => ({ toast }));

import { KeptOnOldEngineNotice } from "../KeptOnOldEngineNotice";

const RECORD = { id: "t1", name: "Members" } as EmailTemplateRecord;

beforeEach(() => {
  mutate.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});
afterEach(cleanup);

describe("the kept-on-old-engine notice", () => {
  it("names what keeps the email on its first engine", () => {
    render(<KeptOnOldEngineNotice record={RECORD} isDirty={false} />);

    expect(screen.getByTestId("kept-reasons").textContent).toContain(
      "HTML: uses a filter the previous engine wrote as text"
    );
  });

  it("waits for unsaved edits to be saved", () => {
    render(<KeptOnOldEngineNotice record={RECORD} isDirty />);

    const button = screen.getByRole("button", { name: "Read it as Liquid" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Save your changes/)).toBeDefined();
  });

  it("reads it as Liquid only once the author confirms", () => {
    render(<KeptOnOldEngineNotice record={RECORD} isDirty={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Read it as Liquid" }));
    expect(mutate).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Read Members as Liquid?")).toBeDefined();

    fireEvent.click(
      within(dialog).getByRole("button", { name: /Read as Liquid/ })
    );
    expect(mutate).toHaveBeenCalledWith("t1", expect.anything());
  });

  it("shows the server's reason when it refuses", () => {
    mutate.mockImplementation((_id, handlers) =>
      handlers.onError(
        new Error(
          "Change the text that was flagged (HTML) before reading this template as Liquid."
        )
      )
    );
    render(<KeptOnOldEngineNotice record={RECORD} isDirty={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Read it as Liquid" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /Read as Liquid/,
      })
    );

    expect(toast.error).toHaveBeenCalledWith("Still kept as before", {
      description:
        "Change the text that was flagged (HTML) before reading this template as Liquid.",
    });
  });
});
