/**
 * The super-admin role's Permissions section: the line names the collections
 * closed to super-admin, a collection set in code cannot be changed, and a
 * change is sent only with the password entered again.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock("@admin/lib/api/protectedApi", () => ({ protectedApi: api }));
vi.mock("@admin/components/ui", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { SuperAdminClosedCollections } from "./SuperAdminClosedCollections";

function collection(
  slug: string,
  plural: string,
  closedToSuperAdmin: { closed: boolean; setIn: "code" | "admin" | null }
) {
  return {
    slug,
    kind: "collection",
    labels: { singular: plural, plural },
    plugin: null,
    declaredRules: [],
    closedToSuperAdmin,
  };
}

function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SuperAdminClosedCollections />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.patch.mockReset();
  api.get.mockResolvedValue({
    items: [
      collection("payroll", "Payroll", { closed: true, setIn: "code" }),
      collection("notes", "Notes", { closed: false, setIn: null }),
      collection("health", "Health records", { closed: true, setIn: "admin" }),
      {
        slug: "site",
        kind: "single",
        labels: { singular: "Site" },
        plugin: null,
        declaredRules: [],
      },
    ],
  });
  api.patch.mockResolvedValue({ message: "ok" });
});

describe("the super-admin role's section", () => {
  it("says how many collections are closed, and lists those first, each marked in words", async () => {
    renderSection();
    expect(
      await screen.findByText("2 of 3 collections are closed to super-admins.")
    ).toBeInTheDocument();
    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows.map(row => within(row).getByRole("switch").id)).toEqual([
      "closed-to-super-admin-health",
      "closed-to-super-admin-payroll",
      "closed-to-super-admin-notes",
    ]);
    expect(within(rows[0]).getByText("Closed")).toBeInTheDocument();
    expect(within(rows[2]).queryByText("Closed")).not.toBeInTheDocument();
  });

  it("keeps a collection set in code from being changed here, and says why", async () => {
    renderSection();
    const payroll = await screen.findByRole("switch", { name: /Payroll/ });
    expect(payroll).toBeDisabled();
    expect(payroll).toHaveAccessibleDescription(
      "Set in code, so it can't be changed here"
    );
    expect(screen.getByRole("switch", { name: /Notes/ })).toBeEnabled();
  });

  it("sends a change only with the password entered again", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("switch", { name: /Notes/ }));

    const confirm = await screen.findByRole("button", {
      name: "Close collection",
    });
    // Nothing is sent without the password; the field has the focus.
    expect(confirm).toBeDisabled();
    expect(screen.getByLabelText("Your password")).toHaveFocus();
    expect(api.patch).not.toHaveBeenCalled();

    await user.keyboard("my password{Enter}");
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        "/roles/screen/closed-to-super-admin",
        { collection: "notes", closed: true, password: "my password" }
      )
    );
  });

  it("shows a refusal beside the password, and keeps the dialog open to try again", async () => {
    api.patch.mockRejectedValueOnce(
      Object.assign(new Error("Invalid email or password."), {
        code: "AUTH_INVALID_CREDENTIALS",
      })
    );
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("switch", { name: /Notes/ }));
    await user.type(await screen.findByLabelText("Your password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Close collection" }));

    // Said as the password it is, not the sign-in form's words.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That password isn't right. Try again."
    );
    expect(screen.getByLabelText("Your password")).toHaveAttribute(
      "aria-invalid",
      "true"
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
