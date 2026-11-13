// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { fireEvent, render, screen } from "@admin/__tests__/utils";

import { TemplateDeleteDialog } from "../TemplateDialogs";

const { useTemplateSenders } = vi.hoisted(() => ({
  useTemplateSenders: vi.fn(),
}));

vi.mock("@admin/hooks/queries/useEmailTemplates", () => ({
  usePreviewEmailTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useTemplateSenders: (id: string | null) => useTemplateSenders(id),
}));

describe("TemplateDeleteDialog", () => {
  it("renders nothing when closed or template is null", () => {
    useTemplateSenders.mockReturnValue({
      data: undefined,
      isLoading: false,
    });

    const { container } = render(
      <TemplateDeleteDialog
        open={false}
        onOpenChange={vi.fn()}
        template={{ id: "t1", name: "Custom email" }}
        onConfirm={vi.fn()}
        isLoading={false}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows checking status while senders are being fetched", () => {
    useTemplateSenders.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    render(
      <TemplateDeleteDialog
        open={true}
        onOpenChange={vi.fn()}
        template={{ id: "t1", name: "Custom email" }}
        onConfirm={vi.fn()}
        isLoading={false}
      />
    );

    expect(screen.getByText("Checking what sends this email...")).toBeTruthy();
  });

  it("names the settings that will stop sending when references exist", () => {
    useTemplateSenders.mockReturnValue({
      data: {
        declared: [],
        referenced: [
          "Form: Contact Us, Notify team",
          "Form: Feedback, Autoresponder",
        ],
        complete: true,
      },
      isLoading: false,
    });

    render(
      <TemplateDeleteDialog
        open={true}
        onOpenChange={vi.fn()}
        template={{ id: "t1", name: "Contact autoresponder" }}
        onConfirm={vi.fn()}
        isLoading={false}
      />
    );

    expect(
      screen.getByText("Deleting this template will affect what sends it:")
    ).toBeTruthy();
    expect(screen.getByText("Form: Contact Us, Notify team")).toBeTruthy();
    expect(screen.getByText("Form: Feedback, Autoresponder")).toBeTruthy();
    expect(
      screen.getByText(
        "These will stop sending emails once the template is deleted."
      )
    ).toBeTruthy();
  });

  it("says some references couldn't be checked when complete is false", () => {
    useTemplateSenders.mockReturnValue({
      data: {
        declared: [],
        referenced: [],
        complete: false,
      },
      isLoading: false,
    });

    render(
      <TemplateDeleteDialog
        open={true}
        onOpenChange={vi.fn()}
        template={{ id: "t1", name: "Custom email" }}
        onConfirm={vi.fn()}
        isLoading={false}
      />
    );

    expect(
      screen.getByText("Some references couldn't be checked.")
    ).toBeTruthy();
  });

  it("allows cancelling or confirming the delete", () => {
    useTemplateSenders.mockReturnValue({
      data: { declared: [], referenced: [], complete: true },
      isLoading: false,
    });

    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();

    render(
      <TemplateDeleteDialog
        open={true}
        onOpenChange={onOpenChange}
        template={{ id: "t1", name: "Custom email" }}
        onConfirm={onConfirm}
        isLoading={false}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("disables buttons and shows spinner when delete is in progress", () => {
    useTemplateSenders.mockReturnValue({
      data: { declared: [], referenced: [], complete: true },
      isLoading: false,
    });

    render(
      <TemplateDeleteDialog
        open={true}
        onOpenChange={vi.fn()}
        template={{ id: "t1", name: "Custom email" }}
        onConfirm={vi.fn()}
        isLoading={true}
      />
    );

    expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty(
      "disabled",
      true
    );
    expect(screen.getByRole("button", { name: "Deleting..." })).toHaveProperty(
      "disabled",
      true
    );
  });
});
