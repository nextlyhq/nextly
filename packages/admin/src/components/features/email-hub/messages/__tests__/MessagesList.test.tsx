// @vitest-environment jsdom
/**
 * The Messages list: every email grouped by owner, with its state; search and
 * the notices that filter to the emails waiting on someone; actions only with
 * the grant the server checks for each; and when an email was last sent only
 * for someone who may read deliveries.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fireEvent, render, screen, within } from "@admin/__tests__/utils";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import type { EmailTemplateRecord } from "@admin/services/emailTemplateApi";
import { holdsPermission } from "@admin/lib/permissions/holds-permission";

import { MessagesList } from "../MessagesList";

const { useEmailTemplates } = vi.hoisted(() => ({
  useEmailTemplates: vi.fn(),
}));

vi.mock("@admin/hooks/queries/useEmailTemplates", () => ({
  useEmailTemplates: () => useEmailTemplates(),
  useDeleteEmailTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  usePreviewEmailTemplate: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: vi.fn(),
}));

function holding(slugs: string[]) {
  vi.mocked(useCurrentUserPermissions).mockReturnValue({
    // Asked as the product asks it.
    hasPermission: (slug: string) => holdsPermission(new Set(slugs), slug),
    isLoading: false,
    hasAnswer: true,
    error: null,
  } as unknown as ReturnType<typeof useCurrentUserPermissions>);
}

function email(overrides: Partial<EmailTemplateRecord>): EmailTemplateRecord {
  return {
    id: overrides.slug ?? "id",
    name: "An email",
    slug: "an-email",
    kind: "template",
    subject: "Hello",
    htmlContent: "<p>Hi</p>",
    plainTextContent: null,
    preheader: null,
    layoutId: null,
    fromOverride: null,
    replyTo: null,
    variables: null,
    useLayout: true,
    isActive: true,
    providerId: null,
    attachments: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    owner: { kind: "site" },
    description: null,
    overridden: false,
    ownerChanged: false,
    setInCode: false,
    keptOnOldEngine: false,
    ...overrides,
  };
}

const ACCOUNTS = { kind: "plugin", name: "accounts", installed: true } as const;

const EMAILS = [
  email({
    slug: "password-reset",
    name: "Password reset",
    owner: { kind: "core" },
    description: "Someone asks to reset their password",
  }),
  email({
    slug: "welcome",
    name: "Welcome",
    owner: { kind: "core" },
    overridden: true,
    setInCode: true,
  }),
  email({
    slug: "account-reset",
    name: "Reset a password",
    owner: ACCOUNTS,
    overridden: true,
    ownerChanged: true,
  }),
  email({
    slug: "account-closed",
    name: "Account closed",
    owner: ACCOUNTS,
    isActive: false,
  }),
  email({ slug: "spring-sale", name: "Spring sale", keptOnOldEngine: true }),
  email({ slug: "newsletter", name: "Newsletter" }),
  // Layouts are Design's, never Messages'.
  email({ slug: "default-layout", name: "Default layout", kind: "layout" }),
];

const MANAGER = [
  "read-email-templates",
  "create-email-templates",
  "update-email-templates",
  "delete-email-templates",
];

/** The table view, which is what a desktop reader sees. */
function table() {
  return screen.getByRole("table", { name: "Emails" });
}

beforeEach(() => {
  useEmailTemplates.mockReturnValue({
    data: EMAILS,
    isLoading: false,
    isError: false,
    error: null,
  });
  holding(MANAGER);
});

describe("MessagesList", () => {
  it("groups every email by owner: core, each plugin, then the site", () => {
    render(<MessagesList />);
    const headings = within(table())
      .getAllByRole("columnheader")
      .filter(cell => cell.getAttribute("scope") === "colgroup")
      .map(cell => cell.textContent);
    expect(headings).toEqual(["Nextly · 2", "accounts · 2", "This site · 2"]);
    expect(within(table()).queryByText("Default layout")).toBeNull();
  });

  it("names each email's state", () => {
    render(<MessagesList />);
    const rowOf = (name: string) =>
      within(table()).getByText(name).closest("tr") as HTMLElement;
    expect(within(rowOf("Password reset")).getByText("Default")).toBeTruthy();
    expect(within(rowOf("Welcome")).getByText("Customised")).toBeTruthy();
    expect(within(rowOf("Welcome")).getByText("Set in code")).toBeTruthy();
    expect(
      within(rowOf("Reset a password")).getByText("Update available")
    ).toBeTruthy();
    expect(within(rowOf("Account closed")).getByText("Off")).toBeTruthy();
    expect(
      within(rowOf("Spring sale")).getByText("Kept as before")
    ).toBeTruthy();
    expect(within(rowOf("Newsletter")).getByText("On")).toBeTruthy();
  });

  it("says what sends an email", () => {
    render(<MessagesList />);
    expect(
      within(table()).getByText("Someone asks to reset their password")
    ).toBeTruthy();
  });

  it("searches by name", () => {
    render(<MessagesList />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search emails" }), {
      target: { value: "sale" },
    });
    expect(within(table()).getByText("Spring sale")).toBeTruthy();
    expect(within(table()).queryByText("Welcome")).toBeNull();
  });

  it("says when nothing matches", () => {
    render(<MessagesList />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search emails" }), {
      target: { value: "no such email" },
    });
    expect(
      screen.getByText("No emails match the search and filters.")
    ).toBeTruthy();
  });

  it("names the emails waiting on an owner's update, and shows them", () => {
    render(<MessagesList />);
    expect(
      screen.getByText("1 email has an update from its owner")
    ).toBeTruthy();
    const notice = screen
      .getByText("1 email has an update from its owner")
      .closest('[role="alert"]') as HTMLElement;
    fireEvent.click(within(notice).getByRole("button", { name: "Show it" }));
    expect(within(table()).getByText("Reset a password")).toBeTruthy();
    expect(within(table()).queryByText("Welcome")).toBeNull();
  });

  it("shows a notice's emails even when an earlier search hid them", () => {
    render(<MessagesList />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search emails" }), {
      target: { value: "welcome" },
    });
    expect(within(table()).queryByText("Reset a password")).toBeNull();
    const notice = screen
      .getByText("1 email has an update from its owner")
      .closest('[role="alert"]') as HTMLElement;
    fireEvent.click(within(notice).getByRole("button", { name: "Show it" }));
    expect(within(table()).getByText("Reset a password")).toBeTruthy();
  });

  it("names the emails kept as the previous engine sent them", () => {
    render(<MessagesList />);
    expect(screen.getByText("1 email is kept as it was")).toBeTruthy();
  });

  it("shows each email as a card too, for phone width", () => {
    render(<MessagesList />);
    // Both views are in the page; CSS shows one per width. The cards carry
    // the same emails, grouped the same way.
    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(6);
    expect(
      screen
        .getByRole("region", { name: "accounts" })
        .querySelectorAll("article")
    ).toHaveLength(2);
  });

  describe("actions", () => {
    function menuFor(name: string) {
      const row = within(table()).getByText(name).closest("tr") as HTMLElement;
      return within(row).queryByRole("button", { name: `Actions for ${name}` });
    }

    it("offers a reader who may only look no action, and no link to edit", () => {
      holding(["read-email-templates"]);
      render(<MessagesList />);
      expect(menuFor("Newsletter")).toBeNull();
      expect(
        within(table()).queryByRole("link", { name: "Newsletter" })
      ).toBeNull();
    });

    it("links a manager's email names to the editor", () => {
      render(<MessagesList />);
      expect(
        within(table())
          .getByRole("link", { name: "Newsletter" })
          .getAttribute("href")
      ).toBe("/admin/email/messages/edit/newsletter");
    });

    it("gives the site's own email a Delete and an owner's email none", async () => {
      render(<MessagesList />);
      fireEvent.pointerDown(menuFor("Newsletter") as HTMLElement, {
        button: 0,
        pointerType: "mouse",
      });
      expect(
        await screen.findByRole("menuitem", { name: "Delete" })
      ).toBeTruthy();
      expect(screen.getByRole("menuitem", { name: "Open" })).toBeTruthy();
      expect(screen.getByRole("menuitem", { name: "Preview" })).toBeTruthy();
      expect(screen.getByRole("menuitem", { name: "Duplicate" })).toBeTruthy();
    });

    it("never offers Delete on an owner's email", async () => {
      render(<MessagesList />);
      fireEvent.pointerDown(menuFor("Password reset") as HTMLElement, {
        button: 0,
        pointerType: "mouse",
      });
      expect(
        await screen.findByRole("menuitem", { name: "Open" })
      ).toBeTruthy();
      expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
    });
  });

  describe("last sent", () => {
    beforeEach(() => {
      useEmailTemplates.mockReturnValue({
        data: EMAILS.map(record => ({
          ...record,
          lastSentAt:
            record.slug === "password-reset"
              ? "2026-10-20T10:00:00.000Z"
              : null,
        })),
        isLoading: false,
        isError: false,
        error: null,
      });
    });

    it("is not shown to someone who may not read deliveries", () => {
      holding(MANAGER);
      render(<MessagesList />);
      expect(
        within(table()).queryByRole("columnheader", { name: "Last sent" })
      ).toBeNull();
    });

    it("is shown to someone who may", () => {
      holding([...MANAGER, "read-email-deliveries"]);
      render(<MessagesList />);
      expect(
        within(table()).getByRole("columnheader", { name: "Last sent" })
      ).toBeTruthy();
      const row = within(table())
        .getByText("Newsletter")
        .closest("tr") as HTMLElement;
      expect(within(row).getByText("Never")).toBeTruthy();
    });

    it("is not shown while the list doesn't report it", () => {
      useEmailTemplates.mockReturnValue({
        data: EMAILS,
        isLoading: false,
        isError: false,
        error: null,
      });
      holding([...MANAGER, "read-email-deliveries"]);
      render(<MessagesList />);
      expect(
        within(table()).queryByRole("columnheader", { name: "Last sent" })
      ).toBeNull();
    });
  });
});
