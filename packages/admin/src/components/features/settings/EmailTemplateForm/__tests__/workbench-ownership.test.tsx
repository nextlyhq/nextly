/**
 * Whose email it is decides what the workbench lets the site change.
 *
 * An owner's email shows its content read-only, with Override; overriding,
 * resetting (with Undo) and reviewing an owner's update each reach the server
 * through the workbench's own controls. The site's settings stay editable on
 * any email.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EmailTemplateRecord } from "@admin/services/emailTemplateApi";

import { EmailTemplateForm } from "../EmailTemplateForm";

const api = vi.hoisted(() => ({
  listTemplates: vi.fn(),
  previewDraft: vi.fn(),
  overrideTemplate: vi.fn(),
  resetTemplate: vi.fn(),
  compareTemplate: vi.fn(),
  applyOwnerUpdate: vi.fn(),
  undoOwnerUpdate: vi.fn(),
  updateTemplate: vi.fn(),
}));

vi.mock("@admin/services/emailTemplateApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/emailTemplateApi")>();
  return { ...actual, ...api };
});
vi.mock("@admin/hooks/queries/useEmailProviders", () => ({
  useEmailProviders: () => ({ data: { data: [] } }),
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({ hasPermission: () => true }),
}));
vi.mock("@admin/lib/navigation", () => ({ navigateTo: vi.fn() }));
// What these assert is whose field is editable, not how the editor edits
// (liquid-editor.test.tsx has that): an input carrying the editor's name,
// value and read-only state keeps five CodeMirror views out of every mount.
vi.mock("../liquid/LazyLiquidEditor", () => ({
  LazyLiquidEditor: (props: {
    label: string;
    value: string;
    readOnly: boolean;
    onChange: (value: string) => void;
  }) => (
    <input
      aria-label={props.label}
      value={props.value}
      readOnly={props.readOnly}
      onChange={event => props.onChange(event.target.value)}
    />
  ),
}));

function template(over: Partial<EmailTemplateRecord>): EmailTemplateRecord {
  return {
    id: "t1",
    name: "Welcome",
    slug: "welcome",
    kind: "template",
    subject: "Welcome to {{appName}}",
    htmlContent: "<p>Hi</p>",
    plainTextContent: null,
    preheader: "Glad you're here",
    layoutId: null,
    fromOverride: null,
    replyTo: null,
    variables: null,
    useLayout: true,
    isActive: true,
    providerId: null,
    attachments: null,
    createdAt: "2026-10-21T00:00:00.000Z",
    updatedAt: "2026-10-21T00:00:00.000Z",
    owner: { kind: "core" },
    description: "Sent when someone signs up",
    overridden: false,
    ownerChanged: false,
    setInCode: false,
    ...over,
  };
}

beforeEach(() => {
  api.listTemplates.mockResolvedValue([]);
  api.previewDraft.mockResolvedValue({ subject: "", html: "", text: "" });
});

afterEach(() => {
  cleanup();
  for (const fn of Object.values(api)) fn.mockReset();
});

function mount(record: EmailTemplateRecord) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <EmailTemplateForm
        mode="edit"
        template={record}
        isPending={false}
        onSubmit={() => {}}
      />
    </QueryClientProvider>
  );
}

const subjectField = () =>
  screen.getByRole("textbox", { name: "Subject" }) as HTMLInputElement;

describe("an owner's email", () => {
  it("shows its content read-only, with Override", () => {
    mount(template({ owner: { kind: "core" } }));
    expect(subjectField().readOnly).toBe(true);
    expect(
      (
        screen.getByRole("textbox", {
          name: "Preview text",
        }) as HTMLInputElement
      ).readOnly
    ).toBe(true);
    // From is the site's setting on any email.
    expect(
      (screen.getByRole("textbox", { name: "From" }) as HTMLInputElement)
        .readOnly
    ).toBe(false);
    expect(
      screen.getByText(/Nextly keeps this email up to date/)
    ).toBeDefined();
  });

  it("overrides it through the confirmation", async () => {
    const record = template({ owner: { kind: "core" } });
    api.overrideTemplate.mockResolvedValue({ ...record, overridden: true });
    mount(record);

    fireEvent.click(
      within(screen.getByTestId("workbench-header")).getByRole("button", {
        name: "Override",
      })
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Override Welcome?")).toBeDefined();
    fireEvent.click(within(dialog).getByRole("button", { name: "Override" }));
    await waitFor(() =>
      expect(api.overrideTemplate).toHaveBeenCalledWith("t1", undefined)
    );
  });
});

describe("the site's own email", () => {
  it("is editable, and has nothing to override", () => {
    mount(template({ owner: { kind: "site" } }));
    expect(subjectField().readOnly).toBe(false);
    expect(screen.queryByRole("button", { name: "Override" })).toBeNull();
    expect(screen.queryByTestId("ownership-notices")?.textContent ?? "").toBe(
      ""
    );
  });
});

describe("a customised email", () => {
  it("resets to the owner's version, and Undo puts the site's version back", async () => {
    // The site changed what the owner says about it, too: Reset gives that
    // back to the owner, and Undo must bring it back.
    const record = template({
      owner: { kind: "core" },
      overridden: true,
      description: "Our welcome",
      variables: [{ name: "plan", description: "The plan", required: true }],
    });
    api.resetTemplate.mockResolvedValue({ ...record, overridden: false });
    api.overrideTemplate.mockResolvedValue(record);
    api.updateTemplate.mockResolvedValue(record);
    mount(record);

    expect(subjectField().readOnly).toBe(false);
    fireEvent.click(
      screen.getByRole("button", { name: "Reset to Nextly's version" })
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(api.resetTemplate).toHaveBeenCalledWith("t1"));

    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(api.overrideTemplate).toHaveBeenCalledWith("t1", {
        subject: record.subject,
        htmlContent: record.htmlContent,
        plainTextContent: record.plainTextContent,
        preheader: record.preheader,
      })
    );
    await waitFor(() =>
      expect(api.updateTemplate).toHaveBeenCalledWith("t1", {
        description: "Our welcome",
        variables: record.variables,
      })
    );
  });

  it("offers no Undo for a Reset made while an owner update waits", async () => {
    // Undo overrides again, basing the override on the owner's version now:
    // with an update waiting, that would drop the update from review.
    const record = template({
      owner: { kind: "core" },
      overridden: true,
      ownerChanged: true,
    });
    api.resetTemplate.mockResolvedValue({
      ...record,
      overridden: false,
      ownerChanged: false,
    });
    mount(record);

    fireEvent.keyDown(screen.getByRole("button", { name: "More actions" }), {
      key: "Enter",
    });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Reset to Nextly's version" })
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/It can't be undone/)).toBeDefined();
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(api.resetTemplate).toHaveBeenCalledWith("t1"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("asks before Override or Reset drop unsaved settings", async () => {
    mount(template({ owner: { kind: "core" }, overridden: true }));
    fireEvent.change(screen.getByRole("textbox", { name: "From" }), {
      target: { value: "Shop <shop@example.com>" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Reset to Nextly's version" })
    );
    expect(
      await screen.findByText("Save or discard your changes first")
    ).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", { name: "Discard changes and continue" })
    );
    // On to the act it was asked for.
    expect(
      await screen.findByText("Reset Welcome to Nextly's version?")
    ).toBeDefined();
    expect(api.resetTemplate).not.toHaveBeenCalled();
  });

  it("opens the review when the owner updated it", async () => {
    api.compareTemplate.mockResolvedValue({
      base: {},
      theirs: {},
      mine: {},
      changes: [],
      review: "r",
    });
    mount(
      template({
        owner: { kind: "core" },
        overridden: true,
        ownerChanged: true,
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Review the changes" }));
    expect(await screen.findByText("Review Nextly's update")).toBeDefined();
    await waitFor(() => expect(api.compareTemplate).toHaveBeenCalledWith("t1"));
  });

  it("asks for unsaved edits to go before a review", async () => {
    mount(
      template({
        owner: { kind: "core" },
        overridden: true,
        ownerChanged: true,
      })
    );
    fireEvent.change(subjectField(), { target: { value: "Edited" } });
    fireEvent.click(screen.getByRole("button", { name: "Review the changes" }));
    expect(
      await screen.findByText("Save or discard your changes first")
    ).toBeDefined();
    expect(api.compareTemplate).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Discard changes and continue" })
    );
    await waitFor(() => expect(api.compareTemplate).toHaveBeenCalled());
    // Behind the open review, so hidden from the accessibility tree.
    const subject = screen.getByRole("textbox", {
      name: "Subject",
      hidden: true,
    }) as HTMLInputElement;
    expect(subject.value).toBe("Welcome to {{appName}}");
  });
});
