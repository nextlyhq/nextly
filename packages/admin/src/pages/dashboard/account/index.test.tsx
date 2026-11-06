/**
 * The signed-in person's own account page: their profile, saved through
 * `/me`, and the account place's blocks and tabs around it.
 */
import userEvent from "@testing-library/user-event";
import type { AdminContributionsMeta } from "nextly/config";
import { afterEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor, within } from "@admin/__tests__/utils";
import { registerComponent } from "@admin/lib/plugins/component-registry";

/** The signed-in person as `/me` holds them, what was written, and the place. */
const state = vi.hoisted(() => ({
  me: {
    id: "u1",
    name: "Ada",
    email: "ada@example.com",
    image: null as string | null,
  },
  written: [] as Array<[string, unknown]>,
  contributions: undefined as AdminContributionsMeta | undefined,
  /** The permissions the signed-in person holds. */
  held: ["read-media"] as string[],
}));

vi.mock("@admin/hooks/useApi", () => ({
  useApi: () => ({
    api: {
      protected: {
        get: async () => ({ ...state.me, interfaceLanguage: null }),
        patch: async (path: string, body: { name: string; image: string }) => {
          state.written.push([path, body]);
          state.me = { ...state.me, name: body.name, image: body.image };
          return { message: "Profile updated.", item: {} };
        },
      },
    },
  }),
}));
vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/context/providers/BrandingProvider")
  >()),
  useBranding: () => ({ contributions: state.contributions }),
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({
    hasPermission: (slug: string) => state.held.includes(slug),
  }),
}));
vi.mock("@admin/components/ui", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/components/ui")>()),
  toast: { success: vi.fn(), error: vi.fn() },
}));

import AccountPage from ".";

const BLOCK = "@acme/a/admin#AccountBlock";
const TAB = "@acme/a/admin#AccountTab";
registerComponent(BLOCK, ((props: { context?: unknown }) => (
  <pre data-testid="account-block">{JSON.stringify(props.context)}</pre>
)) as never);
registerComponent(TAB, () => <p>plugin tab body</p>);

afterEach(() => {
  state.me = { id: "u1", name: "Ada", email: "ada@example.com", image: null };
  state.written = [];
  state.contributions = undefined;
  state.held = ["read-media"];
});

/** The page's own card: the form holding the person's profile. */
async function profileForm(): Promise<HTMLElement> {
  const name = await screen.findByLabelText("Name");
  return name.closest("form")!;
}

describe("the account page", () => {
  it("with no contributions the page draws as before", async () => {
    render(<AccountPage />);

    // No strip, and the card sits straight in the page container, after the
    // page's heading: nothing wraps it.
    const form = await profileForm();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(form.parentElement).toBe(screen.getByTestId("page-container"));
    expect(screen.getByRole("heading", { name: "My Account" })).toBeTruthy();
  });

  it("draws the profile and the place's contributions", async () => {
    state.contributions = {
      account: {
        block: [
          { builtIn: "profile" },
          {
            plugin: "@acme/a",
            id: "acme-a.account-block",
            kind: "block",
            component: BLOCK,
          },
        ],
        tab: [
          {
            plugin: "@acme/a",
            id: "acme-a.account-tab",
            kind: "tab",
            label: "Security",
            component: TAB,
          },
        ],
      },
    };
    render(<AccountPage />);

    const form = await profileForm();
    const block = screen.getByTestId("account-block");
    expect(form.nextElementSibling).toBe(block);
    expect(JSON.parse(block.textContent ?? "")).toEqual({ userId: "u1" });
    const tabs = within(screen.getByRole("tablist"))
      .getAllByRole("tab")
      .map(tab => tab.textContent);
    expect(tabs).toEqual(["Profile", "Security"]);
  });

  it("shows the email for reading only", async () => {
    render(<AccountPage />);

    const email = (await screen.findByLabelText("Email")) as HTMLInputElement;
    expect(email.value).toBe("ada@example.com");
    expect(email.readOnly).toBe(true);
  });

  it("saves the name through /me, and shows what was stored", async () => {
    const user = userEvent.setup();
    render(<AccountPage />);

    const name = await screen.findByLabelText("Name");
    const save = screen.getByRole("button", { name: "Save changes" });
    // Nothing to save until something differs from what is stored.
    expect(save).toBeDisabled();

    await user.clear(name);
    await user.type(name, "  Ada Lovelace ");
    await user.click(save);

    await waitFor(() =>
      expect(state.written).toEqual([
        ["/me", { name: "Ada Lovelace", image: "" }],
      ])
    );
    // Read again after the save: the form shows the stored, trimmed name.
    await waitFor(() =>
      expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
        "Ada Lovelace"
      )
    );
  });

  it("offers no save for an empty name", async () => {
    const user = userEvent.setup();
    render(<AccountPage />);

    await user.clear(await screen.findByLabelText("Name"));

    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.getByText("Enter your name.")).toBeTruthy();
    expect(state.written).toEqual([]);
  });

  it("offers the avatar picker only to a reader of media, who can open it", async () => {
    // The picker lists the media library, which a person without
    // `read-media` is refused: they are shown their avatar, not a control
    // that would fail.
    state.held = [];
    const { unmount } = render(<AccountPage />);
    await screen.findByLabelText("Name");
    expect(
      screen.getByRole("button", { name: "Change avatar" })
    ).toBeDisabled();
    unmount();

    state.held = ["read-media"];
    render(<AccountPage />);
    await screen.findByLabelText("Name");
    expect(
      screen.getByRole("button", { name: "Change avatar" })
    ).not.toBeDisabled();
  });

  it("holds the name to what the users table stores", async () => {
    const user = userEvent.setup();
    render(<AccountPage />);

    const name = (await screen.findByLabelText("Name")) as HTMLInputElement;
    await user.clear(name);
    await user.type(name, "a".repeat(300));

    // Typing stops at the column's width, so the save never sends more.
    expect(name.value).toHaveLength(255);
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(state.written).toHaveLength(1));
    expect((state.written[0]?.[1] as { name: string }).name).toHaveLength(255);
  });
});
