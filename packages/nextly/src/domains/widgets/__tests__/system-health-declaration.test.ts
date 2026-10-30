/**
 * Core's System health card, declared with `defineWidget`: it passes the checks
 * every declaration is held to, is never hidden for being empty, answers the
 * read it is handed, and only a super-admin is told it exists. Who is a
 * super-admin is the one decision's seam (`callerIsSuperAdmin`); everything
 * between it and the answer -- the registries, the audience, the source's own
 * precondition -- is real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReadAccessCaller } from "../../../auth/entity-read-access";
import { resetWidgetRegistries } from "../../../di/registrations/register-widgets";
import * as loggerModule from "../../../observability/logger";
import type { ReadCaller } from "../../../services/dashboard/readable-resources";
import {
  registerSystemHealthSource,
  systemProblemReaders,
} from "../../../services/dashboard/system-health-source";
import { createBatchScope } from "../batch-scope";
import { CORE_DECLARATIONS } from "../core-widgets";
import { CORE_DEFAULT_LAYOUT } from "../core-widgets/ids";
import {
  provideSystemHealth,
  systemHealthWidget,
  type SystemHealthData,
} from "../core-widgets/system-health";
import { bindReadServices } from "../declaration/read-services";
import { widgetDeclarationFaults } from "../declaration/validate";
import { widgetAudience } from "../visibility";

const { callerIsSuperAdmin, callerHoldsPermission, readableEntities } =
  vi.hoisted(() => ({
    callerIsSuperAdmin: vi.fn(),
    callerHoldsPermission: vi.fn(),
    readableEntities: vi.fn(),
  }));
vi.mock("../../../auth/entity-read-access", async importOriginal => {
  const actual =
    await importOriginal<typeof import("../../../auth/entity-read-access")>();
  return {
    ...actual,
    callerIsSuperAdmin,
    callerHoldsPermission,
    readableEntities,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(loggerModule, "getNextlyLogger").mockReturnValue({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as ReturnType<typeof loggerModule.getNextlyLogger>);
  callerHoldsPermission.mockResolvedValue(true);
  readableEntities.mockImplementation(
    async (slugs: string[]) => new Set(slugs)
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

const HEALTHY: SystemHealthData = {
  version: "1.2.3",
  migrations: { status: "ok", failed: 0, pending: 0 },
  schemaChanges: { failed: [], more: 0 },
  storage: { status: "ok" },
};

const person: ReadCaller = { user: { id: "u1" } };

const SESSION: ReadAccessCaller = {
  userId: "u1",
  authMethod: "session",
  permissions: [],
  roles: ["editor"],
};

/** The card's load as a batch runs it: with services bound to `caller`. */
function loadAs(caller: ReadCaller) {
  const signal = new AbortController().signal;
  const now = new Date("2026-10-30T06:00:00.000Z");
  return systemHealthWidget.load({
    settings: {},
    user: caller.user,
    signal,
    now,
    scope: createBatchScope().forOwner("core"),
    size: { w: 4, h: 3, tier: "medium" },
    services: bindReadServices({
      caller,
      prepare: () => Promise.reject(new Error("the card reads no collection")),
      signal,
      now,
    }),
  });
}

describe("core's System health, declared", () => {
  it("passes the checks every declaration is held to, as core's own", () => {
    expect(widgetDeclarationFaults(systemHealthWidget, "core", true)).toEqual(
      []
    );
  });

  it("is one of core's declarations, 4 x 3 by default and 4 x 2 at the least, and not on the default", () => {
    expect(CORE_DECLARATIONS.map(widget => widget.id)).toContain(
      "core/system-health"
    );
    expect(systemHealthWidget.size.default).toEqual({ w: 4, h: 3 });
    expect(systemHealthWidget.size.min).toEqual({ w: 4, h: 2 });
    expect(CORE_DEFAULT_LAYOUT.map(card => card.widget)).not.toContain(
      "core/system-health"
    );
  });

  it("is never hidden for being empty: all well is an answer too", () => {
    expect(systemHealthWidget.hidesWhenEmpty).toBeUndefined();
    expect(systemHealthWidget.isEmpty?.(HEALTHY)).toBe(false);
  });

  it("answers the read it is handed", async () => {
    const read = vi.fn().mockResolvedValue(HEALTHY);
    provideSystemHealth(read);
    await expect(loadAs(person)).resolves.toEqual(HEALTHY);
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe("only a super-admin is told System health exists", () => {
  it("is offered to a super-admin, and to nobody else", async () => {
    resetWidgetRegistries([]);
    callerIsSuperAdmin.mockResolvedValue(true);
    const asAdmin = (await widgetAudience(SESSION)).visible.map(w => w.id);
    callerIsSuperAdmin.mockResolvedValue(false);
    const asEditor = (await widgetAudience(SESSION)).visible.map(w => w.id);

    expect(asAdmin).toContain("core/system-health");
    // The must-differ half, with a control: the editor still sees core's
    // other cards, so the filter is not one that drops everything.
    expect(asEditor).not.toContain("core/system-health");
    expect(asEditor).toContain("core/note");
  });

  it("refuses the card's read for anyone else, before anything is read", async () => {
    registerSystemHealthSource();
    callerIsSuperAdmin.mockResolvedValue(false);
    // Refused, not failed: no adapter is registered in this process, so a
    // read that ran first would throw "not registered" rather than this.
    await expect(loadAs(person)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(callerIsSuperAdmin).toHaveBeenCalledTimes(1);
  });

  it("hides every system problem from anyone else", async () => {
    callerIsSuperAdmin.mockResolvedValue(false);
    const readers = systemProblemReaders(person);
    expect(readers.length).toBeGreaterThan(0);
    const signal = new AbortController().signal;
    for (const reader of readers) {
      expect(reader.kind).toBe("system");
      expect(reader.severity).toBe("critical");
      expect(await reader.visible?.(signal)).toBe(false);
    }
    callerIsSuperAdmin.mockResolvedValue(true);
    const asAdmin = systemProblemReaders(person);
    expect(await asAdmin[0]?.visible?.(signal)).toBe(true);
  });

  it("links a migration's item nowhere, naming the command instead, and the others to their admin page", () => {
    // 🔴 Linked to the card's anchor, a migration's Review led nowhere on any
    // dashboard without the card, the default one included.
    const byId = new Map(
      systemProblemReaders(person).map(reader => [reader.id, reader])
    );
    for (const id of [
      "core/system-migrations-failed",
      "core/system-migrations-pending",
    ]) {
      const reader = byId.get(id);
      expect(reader).toBeDefined();
      expect(reader).not.toHaveProperty("link");
      expect(reader?.reason).toContain(
        "Run nextly migrate:status to see which."
      );
    }
    expect(byId.get("core/system-schema-changes")?.link).toBe(
      "builder/collections"
    );
    expect(byId.get("core/system-storage")?.link).toBe("media");
  });
});
