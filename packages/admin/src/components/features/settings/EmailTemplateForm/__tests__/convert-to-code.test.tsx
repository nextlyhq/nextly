/**
 * Convert to code: offered for a saved written email the site owns, behind a
 * dialog that says it cannot be undone, refused while edits are unsaved, and
 * sent as the new format alone, so the server writes the code from the blocks
 * it has saved.
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
import { ConvertToCodeDialog } from "../written/ConvertToCodeDialog";

const api = vi.hoisted(() => ({
  listTemplates: vi.fn(),
  previewDraft: vi.fn(),
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

function template(over: Partial<EmailTemplateRecord>): EmailTemplateRecord {
  return {
    id: "t1",
    name: "Order shipped",
    slug: "order-shipped",
    kind: "template",
    subject: "Your order has shipped",
    htmlContent: "",
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
    createdAt: "2026-11-20T00:00:00.000Z",
    updatedAt: "2026-11-20T00:00:00.000Z",
    owner: { kind: "site" },
    description: null,
    overridden: false,
    ownerChanged: false,
    setInCode: false,
    format: "written",
    blocks: {
      version: 1,
      blocks: [{ type: "heading", text: [{ type: "text", text: "Shipped" }] }],
    },
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

async function openMenu() {
  fireEvent.keyDown(screen.getByRole("button", { name: "More actions" }), {
    key: "Enter",
  });
}

describe("Convert to code", () => {
  it("sends only the new format, so the server writes the code from the saved blocks", async () => {
    api.updateTemplate.mockResolvedValue(template({ format: "code" }));
    mount(template({}));
    await openMenu();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Convert to code…" })
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Convert to code?",
    });
    expect(within(dialog).getByText(/can't be undone/)).toBeDefined();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Convert to code" })
    );
    await waitFor(() =>
      expect(api.updateTemplate).toHaveBeenCalledWith("t1", { format: "code" })
    );
  });

  it("is not offered for a coded email", async () => {
    mount(template({ format: "code", blocks: null, htmlContent: "<p>Hi</p>" }));
    await openMenu();
    // The menu is open with the coded email's other acts, and no conversion.
    expect(await screen.findAllByRole("menuitem")).not.toHaveLength(0);
    expect(
      screen.queryByRole("menuitem", { name: "Convert to code…" })
    ).toBeNull();
  });
});

describe("the Convert to code dialog", () => {
  const props = {
    open: true,
    onOpenChange: () => {},
    isPending: false,
  };

  it("refuses while there are unsaved changes, which the code would miss", () => {
    const onConvert = vi.fn();
    render(<ConvertToCodeDialog {...props} dirty onConvert={onConvert} />);
    expect(screen.getByRole("status").textContent).toContain(
      "Save your changes first"
    );
    const button = screen.getByRole("button", {
      name: "Convert to code",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("shows the code it becomes when it is known, and says when it appears otherwise", () => {
    const { rerender } = render(
      <ConvertToCodeDialog {...props} dirty={false} onConvert={() => {}} />
    );
    expect(screen.getByText(/open in the code editor once/)).toBeDefined();
    rerender(
      <ConvertToCodeDialog
        {...props}
        dirty={false}
        source="<h1>Shipped</h1>"
        onConvert={() => {}}
      />
    );
    expect(
      screen.getByLabelText("The code this email becomes").textContent
    ).toBe("<h1>Shipped</h1>");
  });
});
