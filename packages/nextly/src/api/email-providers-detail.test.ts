// The mounted detail route answers with the same document the catch-all
// router serves: the provider, masked, together with its sending domain's
// status. One read, so the record and the status describe one saved state —
// a provider edited between two reads would otherwise pair one
// configuration's page with another's DNS expectations.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth/middleware", () => ({
  requireAnyPermission: vi.fn(),
  isErrorResponse: vi.fn(),
}));

vi.mock("../auth/middleware/to-nextly-error", () => ({
  toNextlyAuthError: vi.fn((errResponse: unknown) => {
    return new Error(`auth error: ${JSON.stringify(errResponse)}`);
  }),
}));

vi.mock("../init", () => ({
  getCachedNextly: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../di", () => ({
  container: {
    get: vi.fn(),
    has: vi.fn().mockReturnValue(false),
  },
}));

import { requireAnyPermission } from "../auth/middleware";
import { container } from "../di";

import { GET } from "./email-providers-detail";

/** A signed-in person, as the permission gate answers them. */
const asSession = (): void => {
  (requireAnyPermission as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    userId: "user-1",
    authMethod: "session",
  });
};

const PROVIDER = {
  id: "p1",
  name: "Resend",
  type: "resend",
  fromEmail: "no-reply@example.com",
  configuration: { apiKey: "••••••" },
};

const getProvider = vi.fn();
const getProviderWithDomainStatus = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  (container.get as ReturnType<typeof vi.fn>).mockReturnValue({
    getProvider,
    getProviderWithDomainStatus,
  });
});

const get = (id = "p1") =>
  GET(new Request(`http://x/api/email-providers/${id}`), {
    params: Promise.resolve({ id }),
  });

describe("the mounted provider detail route", () => {
  it("reads through getProviderWithDomainStatus, domain status included", async () => {
    asSession();
    getProviderWithDomainStatus.mockResolvedValue({
      ...PROVIDER,
      domainStatus: {
        domain: "example.com",
        status: "verified",
        records: [],
      },
    });

    const res = await get();

    expect(res.status).toBe(200);
    expect(getProviderWithDomainStatus).toHaveBeenCalledWith("p1");
    // The old read stays out: one shape on every surface, not two.
    expect(getProvider).not.toHaveBeenCalled();
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toHaveProperty("domainStatus");
  });
});
