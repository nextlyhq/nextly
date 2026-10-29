// @vitest-environment jsdom
/**
 * Each layout with the emails it wraps, opening in the workbench, and a
 * layout kept on the previous engine or with an owner's update said, since
 * either affects every email it wraps.
 */
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type { EmailTemplateRecord } from "@admin/services/emailTemplateApi";

import { LayoutsList } from "../LayoutsList";

const { templates } = vi.hoisted(() => ({
  templates: { list: [] as EmailTemplateRecord[] },
}));

function record(
  id: string,
  name: string,
  over: Partial<EmailTemplateRecord> = {}
): EmailTemplateRecord {
  return {
    id,
    name,
    slug: id,
    kind: "template",
    subject: "",
    htmlContent: "",
    plainTextContent: null,
    preheader: null,
    layoutId: null,
    useLayout: true,
    isActive: true,
    overridden: false,
    ownerChanged: false,
    owner: { kind: "core" },
    ...over,
  } as EmailTemplateRecord;
}

vi.mock("@admin/hooks/queries/useEmailTemplates", () => ({
  useEmailTemplates: () => ({
    data: templates.list,
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

vi.mock("../../useTemplateActions", () => ({
  editRouteFor: (item: { id: string }) =>
    `/admin/email/messages/edit/${item.id}`,
  useTemplateActions: () => ({
    canOpen: true,
    actionsFor: () => [],
    dialogs: null,
  }),
}));

beforeEach(() => {
  templates.list = [
    record("default", "Default layout", {
      kind: "layout",
      slug: "default-layout",
      description: "The frame around every email that uses it.",
    }),
    record("plain", "Plain layout", {
      kind: "layout",
      owner: { kind: "site" },
    }),
    record("welcome", "Welcome"),
    record("reset", "Password reset"),
    record("notify", "Contact form: notify team", {
      layoutId: "plain",
      owner: { kind: "site" },
    }),
  ];
});

describe("the layouts list", () => {
  it("says how many emails each layout wraps, and lists them on request", async () => {
    const user = userEvent.setup();
    render(<LayoutsList />);

    expect(screen.getByText("Built from brand settings")).toBeTruthy();
    const toggle = screen.getByRole("button", { name: /Used by 2 emails/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("link", { name: "Welcome" })).toBeNull();

    await user.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.getByRole("link", { name: "Welcome" }).getAttribute("href")
    ).toBe("/admin/email/messages/edit/welcome");
    expect(
      screen.getByRole("button", { name: /Used by 1 email$/ })
    ).toBeTruthy();
  });

  it("opens each layout in the workbench", () => {
    render(<LayoutsList />);
    const openLinks = screen
      .getAllByRole("link")
      .filter(link => link.textContent === "Open")
      .map(link => link.getAttribute("href"));
    expect(openLinks).toEqual([
      "/admin/email/messages/edit/default",
      "/admin/email/messages/edit/plain",
    ]);
  });

  it("says a layout is kept as before, or has an owner's update waiting", () => {
    templates.list = templates.list.map(item =>
      item.id === "default"
        ? { ...item, overridden: true, ownerChanged: true }
        : item.id === "plain"
          ? { ...item, keptOnOldEngine: true }
          : item
    );
    render(<LayoutsList />);

    expect(
      screen.getByText("1 layout has an update from its owner")
    ).toBeTruthy();
    expect(screen.getByText("1 layout is kept as it was")).toBeTruthy();
    expect(screen.getByText("Update available")).toBeTruthy();
    expect(screen.getByText("Kept as before")).toBeTruthy();
    // Changed by the site, so the brand settings don't reach it.
    expect(screen.getByText("Customised")).toBeTruthy();
    expect(screen.queryByText("Built from brand settings")).toBeNull();
  });

  it("says nothing pending when nothing is", () => {
    render(<LayoutsList />);
    expect(screen.queryByText(/update from/)).toBeNull();
    expect(screen.queryByText(/kept as/)).toBeNull();
  });
});
