// @vitest-environment jsdom
/**
 * A new email asks for its name, where it starts and how it is made (written
 * in blocks or coded), then opens the editor with those answers.
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
    fireEvent.click(screen.getByRole("radio", { name: /Code it/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create email" }));
    expect(navigateTo).toHaveBeenCalledWith(
      "/admin/settings/email/messages/create?name=Back-in-stock+alert"
    );
  });

  it("opens a written email when Write it is chosen", () => {
    render(<CreateEmailDialog open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Order paid" },
    });
    fireEvent.click(screen.getByRole("radio", { name: /Write it/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create email" }));
    expect(navigateTo).toHaveBeenCalledWith(
      "/admin/settings/email/messages/create?name=Order+paid&format=written"
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

  it("offers Write and Code, neither chosen, and waits for a choice", () => {
    render(<CreateEmailDialog open onOpenChange={() => {}} />);
    const write = screen.getByRole("radio", { name: /Write it/ });
    const code = screen.getByRole("radio", { name: /Code it/ });
    expect(write.getAttribute("aria-checked")).toBe("false");
    expect(code.getAttribute("aria-checked")).toBe("false");
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Order paid" },
    });
    expect(
      (
        screen.getByRole("button", {
          name: "Create email",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });

  it("carries how a blank email is made", () => {
    expect(createRouteFor("Order paid", null, "written")).toBe(
      "/admin/settings/email/messages/create?name=Order+paid&format=written"
    );
    expect(createRouteFor("Order paid", null, "code")).toBe(
      "/admin/settings/email/messages/create?name=Order+paid"
    );
  });

  it("carries the email to copy", () => {
    expect(createRouteFor("Order shipped copy", "tpl_1")).toBe(
      "/admin/settings/email/messages/create?name=Order+shipped+copy&duplicate=tpl_1"
    );
  });
});
