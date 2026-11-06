/**
 * Core's Needs your attention card, declared with `defineWidget`: it passes the
 * checks every declaration is held to, leaves the dashboard only when nothing
 * is waiting and nothing went unchecked, answers the digest it is handed for
 * the card's own services, and is published as a card answered on the server
 * that the default dashboard places. That the digest is read as the caller
 * those services were bound for is the integration test's to show, through the
 * attention source's own registration.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetWidgetRegistries } from "../../../di/registrations/register-widgets";
import * as loggerModule from "../../../observability/logger";
import type { ReadCaller } from "../../../services/dashboard/readable-resources";
import type { AttentionDigestItem } from "../attention/digest-item";
import { allWidgets } from "../canonical";
import { CORE_DECLARATIONS } from "../core-widgets";
import { CORE_DEFAULT_LAYOUT } from "../core-widgets/ids";
import {
  needsAttentionWidget,
  provideAttentionDigest,
} from "../core-widgets/needs-attention";
import { createBatchScope } from "../batch-scope";
import { declaredWidget } from "../declaration/declared-widgets";
import { bindReadServices, boundCaller } from "../declaration/read-services";
import { widgetDeclarationFaults } from "../declaration/validate";
import { getWidget } from "../registry";

const digest = {
  read: vi.fn<Parameters<typeof provideAttentionDigest>[0]>(),
};

beforeEach(() => {
  vi.spyOn(loggerModule, "getNextlyLogger").mockReturnValue({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as ReturnType<typeof loggerModule.getNextlyLogger>);
});

afterEach(() => {
  vi.restoreAllMocks();
  digest.read.mockReset();
});

const OVERDUE: AttentionDigestItem = {
  id: "core/overdue-releases",
  kind: "overdue",
  label: "Overdue releases",
  count: 2,
  severity: "critical",
  link: "releases?tab=attention&reason=overdue",
  reason: "Still scheduled after its time.",
};

/** The card's verdict on an answer, by its declaration's own test. */
function isEmpty(items: AttentionDigestItem[]): boolean {
  const test = needsAttentionWidget.isEmpty;
  if (test === undefined) throw new Error("the card declares its empty test");
  return test({ items });
}

/** The card's load as a batch runs it: with services bound to `caller`. */
function loadAs(
  caller: ReadCaller,
  services = boundServices(caller),
  card = needsAttentionWidget
) {
  const signal = new AbortController().signal;
  const now = new Date("2026-10-28T06:00:00.000Z");
  return card.load({
    settings: {},
    user: caller.user,
    signal,
    now,
    scope: createBatchScope().forOwner("core"),
    // Its default size, as a batch hands a card the size it is drawn at.
    size: { w: 8, h: 3, tier: "medium" },
    services,
  });
}

function boundServices(caller: ReadCaller) {
  return bindReadServices({
    caller,
    prepare: () => Promise.reject(new Error("no query is checked here")),
    signal: new AbortController().signal,
    now: new Date("2026-10-28T06:00:00.000Z"),
  });
}

const person: ReadCaller["user"] = { id: "u1" };

describe("core's Needs your attention, declared", () => {
  it("passes the checks every declaration is held to, as core's own", () => {
    expect(widgetDeclarationFaults(needsAttentionWidget, "core", true)).toEqual(
      []
    );
  });

  it("is one of core's declarations, 8 x 3 by default and at most 12 wide", () => {
    expect(CORE_DECLARATIONS.map(widget => widget.id)).toContain(
      "core/needs-attention"
    );
    expect(needsAttentionWidget.hidesWhenEmpty).toBe(true);
    expect(needsAttentionWidget.size.default).toEqual({ w: 8, h: 3 });
    expect(needsAttentionWidget.size.max?.w).toBe(12);
  });

  it("is empty only when nothing is waiting: a failed item keeps the card shown", () => {
    expect(isEmpty([])).toBe(true);
    expect(isEmpty([OVERDUE])).toBe(false);
    // The must-differ case: a count that could not be read is not "clear".
    expect(isEmpty([{ ...OVERDUE, count: 0, failed: true }])).toBe(false);
  });

  it("answers the digest it is handed for the card's own services, signal and instant", async () => {
    provideAttentionDigest(digest.read);
    digest.read.mockResolvedValue([OVERDUE]);
    const caller: ReadCaller = { user: person };
    const services = boundServices(caller);

    const answer = await loadAs(caller, services);

    expect(answer).toEqual({ items: [OVERDUE] });
    expect(digest.read).toHaveBeenCalledTimes(1);
    const [given, opts] = digest.read.mock.calls[0] ?? [];
    // The very services the batch bound, which carry the caller: never a
    // caller rebuilt from the user, which would judge a key by its maker.
    expect(given).toBe(services);
    expect(opts?.now.toISOString()).toBe("2026-10-28T06:00:00.000Z");
    expect(opts?.signal).toBeInstanceOf(AbortSignal);
  });

  it("keeps the caller of services core bound, and refuses any other services", () => {
    const caller: ReadCaller = {
      user: person,
      authenticatedScope: { actorType: "apiKey", permissions: ["read-posts"] },
    };
    expect(boundCaller(boundServices(caller))).toBe(caller);
    // The same reads, copied onto an object core never bound: refused, so a
    // function that rebuilds its services cannot borrow another's caller.
    const forged = { ...boundServices(caller) };
    expect(() => boundCaller(forged)).toThrow();
  });

  it("answers across a second copy of its modules, as a Next.js server graph loads them", async () => {
    // The route that binds a card's services and the widget registered at
    // boot can each hold their own copy of these modules in one process.
    provideAttentionDigest(digest.read);
    digest.read.mockResolvedValue([OVERDUE]);
    const caller: ReadCaller = { user: person };
    const services = boundServices(caller);
    vi.resetModules();
    const readCopy = await import("../declaration/read-services");
    const cardCopy = await import("../core-widgets/needs-attention");
    expect(readCopy.boundCaller).not.toBe(boundCaller);
    expect(cardCopy.needsAttentionWidget).not.toBe(needsAttentionWidget);

    expect(readCopy.boundCaller(services)).toBe(caller);
    await expect(
      loadAs(caller, services, cardCopy.needsAttentionWidget)
    ).resolves.toEqual({ items: [OVERDUE] });
  });

  it("is published under core as a card answered on the server, and placed by the default", () => {
    resetWidgetRegistries([]);
    expect(getWidget("core/needs-attention")).toMatchObject({
      archetype: "custom",
      component: "core#NeedsAttention",
      hidesWhenEmpty: true,
    });
    // Answered on the server from the declaration core keeps for it.
    expect(declaredWidget("core/needs-attention")?.owner).toBe("core");
    const canonical = allWidgets().find(
      widget => widget.id === "core/needs-attention"
    );
    expect(canonical).toBeDefined();
    // Placed by core's own default, where it is the first card after setup: the default is
    // the one way a card is placed.
    expect(CORE_DEFAULT_LAYOUT.map(card => card.widget)).toContain(
      "core/needs-attention"
    );
  });
});
