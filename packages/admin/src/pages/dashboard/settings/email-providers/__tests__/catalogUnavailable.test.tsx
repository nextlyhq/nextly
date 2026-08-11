/**
 * What an unavailable provider catalog is allowed to take away.
 *
 * The row actions ask the catalog whether a provider's type is still
 * installed, and an empty catalog answers "no" for two very different reasons:
 * the plugin is genuinely gone, or the request that would have said so failed.
 * Only the first is a reason to withhold Set Default and Send Test.
 */

import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type {
  EmailProviderDescriptor,
  EmailProviderRecord,
} from "@admin/services/emailProviderApi";

import { EmailProviderTable } from "../index";

const { useEmailProviders, useEmailProviderTypes } = vi.hoisted(() => ({
  useEmailProviders: vi.fn(),
  useEmailProviderTypes: vi.fn(),
}));

vi.mock("@admin/hooks/queries/useEmailProviders", () => ({
  useEmailProviders: (params: unknown) => useEmailProviders(params),
  useEmailProviderTypes: () => useEmailProviderTypes(),
  useDeleteEmailProvider: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDefaultProvider: () => ({ mutate: vi.fn(), isPending: false }),
  useTestProvider: () => ({ mutate: vi.fn(), isPending: false }),
}));

const PROVIDER: EmailProviderRecord = {
  id: "ep_1",
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

const RESEND_DESCRIPTOR: EmailProviderDescriptor = {
  type: "resend",
  label: "Resend",
  capabilities: {},
  configFields: [],
};

/** What `useEmailProviderTypes` returns in each of the three states. */
const CATALOG = {
  loaded: (descriptors: EmailProviderDescriptor[]) => ({
    data: descriptors,
    isSuccess: true,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  failed: () => ({
    data: undefined,
    isSuccess: false,
    isError: true,
    isFetching: false,
    refetch: vi.fn(),
  }),
};

/** Open the row's action menu and list what it offers. */
async function openRowActions(): Promise<string[]> {
  const user = userEvent.setup();
  const triggers = screen.getAllByRole("button", {
    name: /open menu|actions/i,
  });
  await user.click(triggers[triggers.length - 1]);
  return screen
    .getAllByRole("menuitem")
    .map(item => item.textContent?.trim() ?? "");
}

describe("row actions when the provider catalog did not load", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEmailProviders.mockReturnValue({
      data: {
        data: [PROVIDER],
        meta: { total: 1, page: 0, limit: 10, totalPages: 1 },
      },
      isLoading: false,
      isError: false,
      error: null,
    });
  });

  it("still offers Set Default and Send Test", async () => {
    useEmailProviderTypes.mockReturnValue(CATALOG.failed());
    render(<EmailProviderTable />);

    const actions = await openRowActions();

    // The provider itself loaded and its type is almost certainly installed —
    // nothing here established otherwise. Withholding both actions on the
    // strength of a failed request removes them from every working provider.
    expect(actions).toContain("Set Default");
    expect(actions).toContain("Send Test");
  });

  it("says the catalog is unavailable, with a way to retry", () => {
    useEmailProviderTypes.mockReturnValue(CATALOG.failed());
    render(<EmailProviderTable />);

    // Without this the page renders as though nothing is wrong, while the
    // type column silently falls back to the stored id and the type filter is
    // empty.
    expect(screen.getByText(/catalog unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("withholds them once the catalog says the type is gone", async () => {
    // The control. If this passed with the catalog LOADED and empty, the two
    // cases above would prove nothing: the gate would simply be gone.
    useEmailProviderTypes.mockReturnValue(CATALOG.loaded([]));
    render(<EmailProviderTable />);

    const actions = await openRowActions();

    expect(actions).not.toContain("Set Default");
    expect(actions).not.toContain("Send Test");
    // Deleting an orphaned row is the whole reason it is still listed.
    expect(actions).toContain("Delete");
  });

  it("offers them for a type the catalog confirms", async () => {
    useEmailProviderTypes.mockReturnValue(CATALOG.loaded([RESEND_DESCRIPTOR]));
    render(<EmailProviderTable />);

    const actions = await openRowActions();

    expect(actions).toContain("Set Default");
    expect(actions).toContain("Send Test");
    expect(screen.queryByText(/catalog unavailable/i)).not.toBeInTheDocument();
  });
});
