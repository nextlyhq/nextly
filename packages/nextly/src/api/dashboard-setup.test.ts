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
// The site-wide store the sample answer is written to: any write to it fails the test.
const meta = vi.hoisted(() => {
  const rows = new Map<string, unknown>();
  return {
    rows,
    getEntry: vi.fn(async (key: string) =>
      rows.has(key)
        ? { present: true, value: rows.get(key) }
        : { present: false }
    ),
    insertIfAbsent: vi.fn(async (key: string, value: unknown) => {
      if (!rows.has(key)) rows.set(key, value);
    }),
    compareAndSet: vi.fn(async () => false),
    set: vi.fn(async (key: string, value: unknown) => {
      rows.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      rows.delete(key);
    }),
  };
});
vi.mock("../di", () => ({ getService: () => meta }));

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
  meta.rows.clear();
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

describe("a sample answer", () => {
  const put = (body: unknown) =>
    putDashboardSetup(
      new Request("http://localhost/api/dashboard/setup", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );

  it("is refused with any other change, before anything is written", async () => {
    for (const other of [
      { retire: { sampleRefused: true } },
      { collapsed: true },
      { skip: { kind: "invite", skipped: true } },
    ]) {
      const res = await put({ sample: "decline", ...other });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { message: string } };
      expect(body.error.message).toContain("on its own");
    }
    // Nothing was declined, and no reader's change was written either.
    expect(meta.insertIfAbsent).not.toHaveBeenCalled();
    expect(meta.compareAndSet).not.toHaveBeenCalled();
    expect(meta.set).not.toHaveBeenCalled();
    expect(seams.changeSetupState).not.toHaveBeenCalled();
    expect(seams.setupCardData).not.toHaveBeenCalled();
  });

  it("declines on its own", async () => {
    const res = await put({ sample: "decline" });
    expect(res.status).toBe(200);
    expect(meta.insertIfAbsent).toHaveBeenCalledWith(
      "seed.current",
      expect.objectContaining({ kind: "decline" })
    );
  });
});
