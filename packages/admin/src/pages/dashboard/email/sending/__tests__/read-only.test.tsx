// @vitest-environment jsdom
/**
 * A reader who may see providers but not change them sees the list in the
 * Sending tab without an action they'd be refused, and each action returns
 * with the grant the server checks for it.
 */
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import type {
  EmailProviderDescriptor,
  EmailProviderRecord,
} from "@admin/services/emailProviderApi";
import { holdsPermission } from "@admin/lib/permissions/holds-permission";

import { EmailProviderTable } from "../index";

vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: vi.fn(),
}));

vi.mock("@admin/hooks/queries/useEmailProviders", () => ({
  useEmailProviders: () => ({
    data: {
      data: [PROVIDER],
      meta: { total: 1, page: 0, limit: 10, totalPages: 1 },
    },
    isLoading: false,
    isError: false,
    error: null,
  }),
  useEmailProviderTypes: () => ({
    data: [RESEND],
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useDeleteEmailProvider: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDefaultProvider: () => ({ mutate: vi.fn(), isPending: false }),
  useTestProvider: () => ({ mutate: vi.fn(), isPending: false }),
}));

const PROVIDER: EmailProviderRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Transactional",
  type: "resend",
  fromEmail: "hello@example.com",
  fromName: "Example",
  configuration: {},
  isDefault: false,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const RESEND: EmailProviderDescriptor = {
  type: "resend",
  label: "Resend",
  capabilities: {},
  configFields: [],
};

function holding(slugs: string[]) {
  vi.mocked(useCurrentUserPermissions).mockReturnValue({
    // Asked as the product asks: a `manage-` permission counts as the plain
    // ones it stands for.
    hasPermission: (slug: string) => holdsPermission(new Set(slugs), slug),
    isLoading: false,
    hasAnswer: true,
    error: null,
  } as unknown as ReturnType<typeof useCurrentUserPermissions>);
}

async function rowActions(): Promise<string[]> {
  const triggers = screen.queryAllByRole("button", {
    name: /open menu|actions/i,
  });
  if (triggers.length === 0) return [];
  await userEvent.setup().click(triggers[triggers.length - 1]);
  return screen
    .getAllByRole("menuitem")
    .map(item => item.textContent?.trim() ?? "");
}

describe("the providers table, by grant", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows a reader who may only look the providers and no action", async () => {
    holding(["read-email-providers"]);
    render(<EmailProviderTable />);
    expect(screen.getAllByText("Transactional").length).toBeGreaterThan(0);
    expect(await rowActions()).toEqual([]);
  });

  it("offers a test send to someone who may create providers", async () => {
    holding(["read-email-providers", "create-email-providers"]);
    render(<EmailProviderTable />);
    expect(await rowActions()).toEqual(["Send Test"]);
  });

  it("offers a manager every action", async () => {
    holding(["manage-email-providers"]);
    render(<EmailProviderTable />);
    expect(await rowActions()).toEqual([
      "Edit",
      "Set Default",
      "Send Test",
      "Delete",
    ]);
  });
});
