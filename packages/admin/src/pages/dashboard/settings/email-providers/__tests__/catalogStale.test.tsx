/**
 * What a catalog that failed to REFRESH is allowed to change.
 *
 * TanStack Query keeps the descriptors it already fetched when a refetch
 * fails: the query reports `isError` while `data` still holds them. Every
 * surface here is built from that data, so in that state the page works and
 * the only untrue thing is the list's age.
 *
 * Treating it as "no catalog" makes each surface wrong in its own way — the
 * table claims its filter is empty while the filter works, and the edit page
 * treats the question of whether a type is installed as unanswered while the
 * form beside it answers it and disables every field.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type {
  EmailProviderDescriptor,
  EmailProviderRecord,
} from "@admin/services/emailProviderApi";

import EditEmailProviderPage from "../edit/[id]";
import { EmailProviderTable } from "../index";

const {
  useEmailProviders,
  useEmailProviderTypes,
  useEmailProvider,
  useRouter,
} = vi.hoisted(() => ({
  useEmailProviders: vi.fn(),
  useEmailProviderTypes: vi.fn(),
  useEmailProvider: vi.fn(),
  useRouter: vi.fn(),
}));

vi.mock("@admin/hooks/queries/useEmailProviders", () => ({
  useEmailProviders: (params: unknown) => useEmailProviders(params),
  useEmailProviderTypes: () => useEmailProviderTypes(),
  useEmailProvider: (id: unknown) => useEmailProvider(id),
  useDeleteEmailProvider: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDefaultProvider: () => ({ mutate: vi.fn(), isPending: false }),
  useTestProvider: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateEmailProvider: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@admin/hooks/useRouter", () => ({
  useRouter: () => useRouter(),
}));

const PROVIDER_ID = "11111111-1111-4111-8111-111111111111";

const PROVIDER: EmailProviderRecord = {
  id: PROVIDER_ID,
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

/** A plugin type this catalog knows nothing about. */
const OTHER: EmailProviderDescriptor = {
  type: "sendlayer",
  label: "SendLayer",
  capabilities: {},
  configFields: [],
};

/**
 * What the catalog query reports in each state, measured rather than assumed.
 *
 * A failed refetch is NOT `isSuccess: false, data: undefined` — the data
 * survives and only the status flips, which is exactly why the two failure
 * states have to be told apart by whether descriptors are present.
 */
const CATALOG = {
  loaded: (descriptors: EmailProviderDescriptor[]) => ({
    data: descriptors,
    isLoading: false,
    isSuccess: true,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  }),
  staleAfterFailedRefetch: (descriptors: EmailProviderDescriptor[]) => ({
    data: descriptors,
    isLoading: false,
    isSuccess: false,
    isError: true,
    isFetching: false,
    error: new Error("network"),
    refetch: vi.fn(),
  }),
  failedWithNothing: () => ({
    data: undefined,
    isLoading: false,
    isSuccess: false,
    isError: true,
    isFetching: false,
    error: new Error("network"),
    refetch: vi.fn(),
  }),
};

describe("the providers table when a catalog refresh fails", () => {
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

  it("says the list is stale rather than unavailable", () => {
    useEmailProviderTypes.mockReturnValue(
      CATALOG.staleAfterFailedRefetch([RESEND])
    );
    render(<EmailProviderTable />);

    // The destructive notice claims each row "falls back to its stored type"
    // and the filter "has nothing to offer". Both are built from the cache
    // here, so both still work and the sentence describes another page.
    expect(screen.queryByText(/catalog unavailable/i)).not.toBeInTheDocument();
    expect(screen.getByText(/could not be refreshed/i)).toBeInTheDocument();
  });

  it("still says unavailable when nothing was cached", () => {
    // The control. Without it, the case above would pass just as well from a
    // page that had stopped reporting catalog trouble at all.
    useEmailProviderTypes.mockReturnValue(CATALOG.failedWithNothing());
    render(<EmailProviderTable />);

    expect(screen.getByText(/catalog unavailable/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/could not be refreshed/i)
    ).not.toBeInTheDocument();
  });

  it("says neither when the catalog loaded", () => {
    useEmailProviderTypes.mockReturnValue(CATALOG.loaded([RESEND]));
    render(<EmailProviderTable />);

    expect(screen.queryByText(/catalog unavailable/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/could not be refreshed/i)
    ).not.toBeInTheDocument();
  });
});

describe("the edit page's Update button when a catalog refresh fails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRouter.mockReturnValue({
      route: { params: { id: PROVIDER_ID } },
      outside: false,
      pathname: "/dashboard/settings/email-providers/edit",
    });
    useEmailProvider.mockReturnValue({
      data: PROVIDER,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  function updateButton(): HTMLButtonElement {
    return screen.getByRole("button", {
      name: /update provider|save|update/i,
    }) as HTMLButtonElement;
  }

  it("is disabled when the cached catalog no longer has the stored type", () => {
    // The form reaches this same conclusion from these same cached
    // descriptors and disables every field. An enabled Update beneath its
    // notice submits an empty configuration and returns an unsupported-provider
    // error contradicting the notice that was on screen.
    useEmailProviderTypes.mockReturnValue(
      CATALOG.staleAfterFailedRefetch([OTHER])
    );
    render(<EditEmailProviderPage />);

    expect(updateButton()).toBeDisabled();
  });

  it("is enabled when the cached catalog still has it", () => {
    // The control. A page that simply disabled Update whenever the catalog
    // reported an error would pass the case above while making a stale
    // catalog unusable — the outcome the stale state exists to avoid.
    useEmailProviderTypes.mockReturnValue(
      CATALOG.staleAfterFailedRefetch([RESEND])
    );
    render(<EditEmailProviderPage />);

    expect(updateButton()).toBeEnabled();
  });

  it("is disabled while the catalog is still loading", () => {
    // The form renders its skeleton until the catalog settles, so the form id
    // this button targets is not on the page and the click is inert.
    useEmailProviderTypes.mockReturnValue({
      data: undefined,
      isLoading: true,
      isSuccess: false,
      isError: false,
      isFetching: true,
      error: null,
      refetch: vi.fn(),
    });
    render(<EditEmailProviderPage />);

    expect(updateButton()).toBeDisabled();
  });

  it("is disabled when the catalog failed with nothing cached", () => {
    // There is no form in this state — it renders a fatal alert instead — so
    // the button submits to an id that is not on the page.
    useEmailProviderTypes.mockReturnValue(CATALOG.failedWithNothing());
    render(<EditEmailProviderPage />);

    expect(updateButton()).toBeDisabled();
  });
});
