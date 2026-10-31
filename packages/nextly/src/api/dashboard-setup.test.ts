/**
 * `PUT /api/dashboard/setup`'s `retire`: answered only once the host has
 * recorded "You're all set", and refused as a conflict when it has not, so the
 * card never keeps saying it will not show again over a retirement that did
 * not happen. The reader, the steps and the store are stood in for; the route,
 * its parsing and its error handling are real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const seams = vi.hoisted(() => ({
  setupCardData: vi.fn(),
  readSetupState: vi.fn(),
  changeSetupState: vi.fn(),
}));
vi.mock("./signed-in-person", () => ({
  signedInPerson: async () => ({ userId: "ana", authMethod: "session" }),
}));
vi.mock("./authenticated-read", async importOriginal => ({
  ...(await importOriginal<typeof import("./authenticated-read")>()),
  readCaller: async () => ({ user: { id: "ana" } }),
}));
vi.mock("../domains/widgets/setup-card", () => ({
  isSetupReader: async () => true,
  setupCardData: seams.setupCardData,
  changeSetupState: seams.changeSetupState,
}));
vi.mock("../domains/widgets/setup-reader", () => ({
  readSetupState: seams.readSetupState,
}));

import { putDashboardSetup } from "./dashboard-setup";

const untouched = {
  collapsed: false,
  dismissed: false,
  retiredAt: undefined,
  skipped: new Set(),
};

const retire = () =>
  putDashboardSetup(
    new Request("http://localhost/api/dashboard/setup", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ retire: { sampleRefused: true } }),
    })
  );

beforeEach(() => {
  vi.clearAllMocks();
  seams.changeSetupState.mockResolvedValue(untouched);
});

describe("asking the host to record You're all set", () => {
  it("answers 200 once the retirement is recorded, judged with what the route said", async () => {
    seams.setupCardData.mockResolvedValue({ allSet: true });
    seams.readSetupState.mockResolvedValue({
      ...untouched,
      retiredAt: "2026-10-31T09:00:00.000Z",
    });
    const res = await retire();
    expect(res.status).toBe(200);
    expect(seams.setupCardData).toHaveBeenCalledWith(
      { user: { id: "ana" } },
      expect.any(Date),
      { sampleRefused: true }
    );
  });

  it("refuses with 409 when the host finds a step open and records nothing", async () => {
    seams.setupCardData.mockResolvedValue({ allSet: false });
    seams.readSetupState.mockResolvedValue(untouched);
    const res = await retire();
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.message).toContain("not all set");
  });
});
