/**
 * The share popover's panel: what it asks the server for, and what it shows.
 *
 * The server decides who may share and what is live, and its integration suite
 * proves that on every dialect. These pin the screen: the lifetime an editor
 * chooses is the one minted, each live link is shown with who made it, when it
 * ends and how often it was opened, revoking names that link and that
 * document, and revoking everything asks first.
 */
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor, within } from "@admin/__tests__/utils";

const api = vi.hoisted(() => ({
  mint: vi.fn(),
  list: vi.fn(),
  revoke: vi.fn(),
  revokeDocument: vi.fn(),
}));
vi.mock("@admin/services/previewLinkApi", () => ({ previewLinkApi: api }));

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("@admin/components/ui", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/components/ui")>()),
  toast,
}));

import { SharePreviewPanel } from "../SharePreviewPanel";

const DOCUMENT = { collection: "posts", entryId: "e1" };

const LINK = {
  kind: "link" as const,
  id: "link-a",
  locale: null,
  createdBy: { id: "u1", name: "Ada Editor" },
  createdAt: "2030-01-01T09:00:00.000Z",
  expiresAt: "2030-01-02T09:00:00.000Z",
  openCount: 3,
  lastOpenedAt: "2030-01-01T10:00:00.000Z",
};

function renderPanel() {
  return render(<SharePreviewPanel document={DOCUMENT} onClose={vi.fn()} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  api.list.mockResolvedValue({ items: [], total: 0 });
  api.mint.mockResolvedValue({
    id: "new",
    token: "t",
    url: "https://site.example/api/preview?token=t",
    expiresAt: "2030-01-02T09:00:00.000Z",
    embeddable: false,
    viewports: [],
  });
  api.revoke.mockResolvedValue({ id: "link-a", revokedAt: "x" });
  api.revokeDocument.mockResolvedValue({ revoked: 1 });
});

describe("SharePreviewPanel", () => {
  it("mints for one day unless another lifetime is chosen", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(
      screen.getByRole("button", { name: "Create and copy link" })
    );

    await waitFor(() => expect(api.mint).toHaveBeenCalledTimes(1));
    expect(api.mint).toHaveBeenCalledWith({
      ...DOCUMENT,
      ttlSeconds: 24 * 60 * 60,
    });
  });

  it("mints for the lifetime the editor chose, and copies the link", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("radio", { name: "7 days" }));
    await user.click(
      screen.getByRole("button", { name: "Create and copy link" })
    );

    await waitFor(() => expect(api.mint).toHaveBeenCalledTimes(1));
    expect(api.mint).toHaveBeenCalledWith({
      ...DOCUMENT,
      ttlSeconds: 7 * 24 * 60 * 60,
    });
    // userEvent installs a clipboard of its own, so the copy is read back
    // from it rather than from a stub.
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Preview link copied.")
    );
    expect(await navigator.clipboard.readText()).toBe(
      "https://site.example/api/preview?token=t"
    );
    // The new link is on the list straight away: the list is read again.
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });

  it("shows the create button busy, once, while a link is being made", async () => {
    let finish: (value: unknown) => void = () => {};
    api.mint.mockReturnValue(new Promise(resolve => (finish = resolve)));
    const user = userEvent.setup();
    const { container } = renderPanel();

    const create = screen.getByRole("button", { name: "Create and copy link" });
    await user.click(create);

    await waitFor(() => expect(create).toBeDisabled());
    expect(container.querySelector(".animate-spin")).not.toBeNull();
    finish({ id: "n", token: "t", url: null, expiresAt: "x" });
  });

  it("says a link can only be copied when it is made", () => {
    renderPanel();
    expect(
      screen.getByText(/A link can only be copied when it is made/)
    ).toBeInTheDocument();
  });

  it("lists each live link with its maker, end and openings", async () => {
    api.list.mockResolvedValue({
      items: [
        LINK,
        { ...LINK, id: "link-b", createdBy: null, openCount: 0 },
        { ...LINK, id: "link-c", createdBy: { id: "u3", name: null } },
      ],
      total: 3,
    });
    renderPanel();

    const rows = await screen.findAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText("Ada Editor")).toBeInTheDocument();
    expect(within(rows[0]!).getByText(/Opened 3 times/)).toBeInTheDocument();
    expect(within(rows[0]!).getByText(/^Ends /)).toBeInTheDocument();
    // A maker whose account is gone is never named.
    expect(within(rows[1]!).getByText("A deleted user")).toBeInTheDocument();
    expect(within(rows[1]!).getByText(/Not opened yet/)).toBeInTheDocument();
    // A maker still there but with no name is not called deleted.
    expect(within(rows[2]!).getByText("An unnamed user")).toBeInTheDocument();
  });

  it("revokes exactly the link chosen, for this document", async () => {
    api.list.mockResolvedValue({
      items: [LINK, { ...LINK, id: "link-b" }],
      total: 2,
    });
    const user = userEvent.setup();
    renderPanel();

    const [first] = await screen.findAllByRole("button", {
      name: /^Revoke the link/,
    });
    await user.click(first!);

    await waitFor(() =>
      expect(api.revoke).toHaveBeenCalledWith("link-a", DOCUMENT)
    );
    expect(api.revokeDocument).not.toHaveBeenCalled();
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });

  it("shows the earlier links as one row, ended only all together", async () => {
    api.list.mockResolvedValue({
      items: [{ kind: "older", latestEnd: "2030-01-08T09:00:00.000Z" }],
      total: 0,
    });
    renderPanel();

    expect(await screen.findByText("Earlier links")).toBeInTheDocument();
    expect(
      screen.getByText(/can only be revoked all together/)
    ).toBeInTheDocument();
    // No row of its own to revoke: the older links have no id.
    expect(screen.queryByRole("listitem")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Revoke all links to this page" })
    ).toBeInTheDocument();
  });

  it("asks before revoking every link, and then revokes this document's", async () => {
    api.list.mockResolvedValue({ items: [LINK], total: 1 });
    const user = userEvent.setup();
    renderPanel();

    await user.click(
      await screen.findByRole("button", {
        name: "Revoke all links to this page",
      })
    );
    // Nothing yet: the first press only asks.
    expect(api.revokeDocument).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Revoke all" }));
    await waitFor(() =>
      expect(api.revokeDocument).toHaveBeenCalledWith(DOCUMENT)
    );
  });

  it("offers no revoke-all when there is nothing to revoke", async () => {
    renderPanel();

    expect(
      await screen.findByText("No live links to this page.")
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Revoke all links to this page" })
    ).toBeNull();
  });

  it("says why the list is missing when it cannot be read", async () => {
    api.list.mockRejectedValue(new Error("You don't have access to this."));
    renderPanel();

    expect(
      await screen.findByText("You don't have access to this.")
    ).toBeInTheDocument();
  });
});

describe("SharePreviewPanel, with more live links than it shows", () => {
  it("says it shows only the newest, and that revoking all ends every one", async () => {
    api.list.mockResolvedValue({ items: [LINK], total: 73 });
    renderPanel();

    expect(
      await screen.findByText(/Showing the newest 1 of 73 live links/)
    ).toBeInTheDocument();
  });
});
