// @vitest-environment jsdom
/**
 * A new email asks for its name and where it starts, then opens the editor
 * with those answers.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fireEvent, render, screen } from "@admin/__tests__/utils";

import { CreateEmailDialog, createRouteFor } from "../CreateEmailDialog";

vi.mock("@admin/hooks/queries/useEmailTemplates", () => ({
  useEmailTemplates: () => ({ data: [] }),
}));

const navigateTo = vi.fn();
vi.mock("@admin/lib/navigation", () => ({
  navigateTo: (path: string) => navigateTo(path),
}));

beforeEach(() => {
  navigateTo.mockClear();
});

describe("CreateEmailDialog", () => {
  it("opens the editor with the name, starting blank", () => {
    render(<CreateEmailDialog open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Back-in-stock alert" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create email" }));
    expect(navigateTo).toHaveBeenCalledWith(
      "/admin/email/messages/create?name=Back-in-stock+alert"
    );
  });

  it("waits for a name", () => {
    render(<CreateEmailDialog open onOpenChange={() => {}} />);
    expect(
      (
        screen.getByRole("button", {
          name: "Create email",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });

  it("offers Code, the only way to make an email until Write mode", () => {
    render(<CreateEmailDialog open onOpenChange={() => {}} />);
    expect(screen.getByText("Code it")).toBeTruthy();
    expect(screen.queryByText("Write it")).toBeNull();
  });

  it("carries the email to copy", () => {
    expect(createRouteFor("Order shipped copy", "tpl_1")).toBe(
      "/admin/email/messages/create?name=Order+shipped+copy&duplicate=tpl_1"
    );
  });
});
