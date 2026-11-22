/**
 * The super-admin role's Permissions section: the line names the collections
 * closed to super-admin, a collection set in code cannot be changed, and a
 * change is sent only with the password entered again.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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
  it("names the collections closed to super-admin in its line", async () => {
    renderSection();
    expect(
      await screen.findByText(
        "Super-admins have every permission, including new collections and plugins, except the collections closed to them: Payroll, Health records. This role can't be edited."
      )
    ).toBeInTheDocument();
  });

  it("keeps a collection set in code from being changed here", async () => {
    renderSection();
    const payroll = await screen.findByRole("switch", { name: /Payroll/ });
    expect(payroll).toBeDisabled();
    expect(screen.getByText("Set in code")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /Notes/ })).toBeEnabled();
  });

  it("sends a change only with the password entered again", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("switch", { name: /Notes/ }));

    const confirm = await screen.findByRole("button", { name: "Confirm" });
    // Nothing is sent without the password.
    expect(confirm).toBeDisabled();
    expect(api.patch).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Password"), "my password");
    await user.click(confirm);
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        "/roles/screen/closed-to-super-admin",
        { collection: "notes", closed: true, password: "my password" }
      )
    );
  });
});
