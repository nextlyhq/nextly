/**
 * Core's five cards answered by a `system:` source, declared with
 * `defineWidget`: Content, Team, Continue where you left off, Upcoming
 * releases and Team activity. Each passes the checks every declaration is held
 * to; its `load` asks its source, as the caller its read services were bound
 * for, for the rows its size and density hold, at most its "Number of items",
 * and one more; and it is published as a card answered on the server, offered
 * on the condition and gate it always had.
 *
 * The sources are stood in for here, registered as core registers its own, so
 * what is checked is the question each card asks and what it makes of the
 * answer. What the sources themselves answer is their own tests'.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetWidgetRegistries } from "../../../di/registrations/register-widgets";
import * as loggerModule from "../../../observability/logger";
import type { ReadCaller } from "../../../services/dashboard/readable-resources";
import { rowsThatFit } from "../card-geometry";
import { contentTableWidget } from "../core-widgets/content-table";
import { continueWidget } from "../core-widgets/continue";
import { teamWidget } from "../core-widgets/team";
import { teamActivityWidget } from "../core-widgets/team-activity";
import { upcomingReleasesWidget } from "../core-widgets/upcoming-releases";
import { CORE_OWNER, declaredWidget } from "../declaration/declared-widgets";
import { widgetDeclarationFaults } from "../declaration/validate";
import { widgetGateHolds } from "../gate";
import type { WidgetQuery } from "../query";
import { getWidget } from "../registry";
import type { WidgetResult } from "../result";
import { clearSources } from "../sources";
import {
  ACTIVITY_SOURCE_ID,
  CONTENT_SOURCE_ID,
  CONTINUE_SOURCE_ID,
  RELEASES_SOURCE_ID,
  TEAM_SOURCE_ID,
} from "../system-source-ids";
import { clearSystemResolvers, registerSystemSource } from "../system-sources";

import { loadCard } from "./core-card-load";

/** What each stood-in source was asked, and by whom. */
const asked: { query: WidgetQuery; caller: ReadCaller }[] = [];

/** The answer each stood-in source gives, by source id. */
let answers: Record<string, WidgetResult> = {};

/**
 * Registers a stand-in for each source, answering `answers` and recording each
 * ask. Registered after boot, which handed core's cards their read of core's
 * sources: that read looks each source's resolver up when a card asks, so it
 * finds these.
 */
function standInSources(): void {
  clearSources();
  clearSystemResolvers();
  for (const id of [
    CONTENT_SOURCE_ID,
    TEAM_SOURCE_ID,
    CONTINUE_SOURCE_ID,
    RELEASES_SOURCE_ID,
    ACTIVITY_SOURCE_ID,
  ]) {
    registerSystemSource(
      {
        id,
        label: id,
        kind: "system",
        supports: ["list"],
        fields: [{ name: "id", type: "string", label: "Id" }],
      },
      async (query, caller) => {
        asked.push({ query, caller });
        return answers[id] ?? { op: "list", items: [] };
      }
    );
  }
}

beforeEach(() => {
  vi.spyOn(loggerModule, "getNextlyLogger").mockReturnValue({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as ReturnType<typeof loggerModule.getNextlyLogger>);
  asked.length = 0;
  answers = {};
  resetWidgetRegistries([]);
  standInSources();
});

afterEach(() => {
  vi.restoreAllMocks();
  clearSystemResolvers();
  clearSources();
});

/** An API key's caller: judged by its own grant, never by the person who made it. */
const KEY: ReadCaller = {
  user: { id: "u1" },
  authenticatedScope: { actorType: "apiKey", permissions: ["read-posts"] },
};

/** A card five rows tall at the medium tier. */
const FIVE_ROWS = { w: 6, h: 5, tier: "medium" } as const;

const CARDS = [
  contentTableWidget,
  teamWidget,
  continueWidget,
  upcomingReleasesWidget,
  teamActivityWidget,
];

describe("core's cards answered by a system source", () => {
  it.each(CARDS.map(card => [card.id, card] as const))(
    "%s passes the checks every declaration is held to, as core's own",
    (_id, card) => {
      expect(widgetDeclarationFaults(card, "core", true)).toEqual([]);
    }
  );

  it("each asks its source as the caller its services were bound for", async () => {
    await loadCard(contentTableWidget, {}, KEY, { size: FIVE_ROWS });
    await loadCard(teamWidget, {}, KEY, { size: FIVE_ROWS });
    await loadCard(continueWidget, {}, KEY, { size: FIVE_ROWS });
    await loadCard(upcomingReleasesWidget, {}, KEY, { size: FIVE_ROWS });
    await loadCard(teamActivityWidget, {}, KEY, { size: FIVE_ROWS });
    expect(asked.map(each => each.query.source)).toEqual([
      CONTENT_SOURCE_ID,
      TEAM_SOURCE_ID,
      CONTINUE_SOURCE_ID,
      RELEASES_SOURCE_ID,
      ACTIVITY_SOURCE_ID,
    ]);
    // The very caller the batch bound, its key scope included.
    for (const each of asked) expect(each.caller).toBe(KEY);
  });
});

describe("the rows each list card asks for", () => {
  it("are the rows its size holds, at most its number of items, and one more", async () => {
    // Five rows tall at the default density hold more than three, so the
    // reader's three is what is asked, and one more to say more exist.
    await loadCard(continueWidget, { limit: 3 }, KEY, { size: FIVE_ROWS });
    await loadCard(teamActivityWidget, { limit: 3 }, KEY, { size: FIVE_ROWS });
    expect(asked.map(each => each.query.limit)).toEqual([4, 4]);
  });

  it("are fewer on a shorter card, and more where its rows are compact", async () => {
    const short = { w: 6, h: 4, tier: "medium" } as const;
    await loadCard(teamActivityWidget, { limit: 10 }, KEY, { size: short });
    await loadCard(teamActivityWidget, { limit: 10, density: "compact" }, KEY, {
      size: short,
    });
    expect(asked.map(each => each.query.limit)).toEqual([
      rowsThatFit(short, { density: "default" }) + 1,
      rowsThatFit(short, { density: "compact" }) + 1,
    ]);
    // The control: compact rows are shorter, so the two asks differ.
    expect(asked[0]?.query.limit).toBeLessThan(asked[1]?.query.limit ?? 0);
  });

  it("are at most the ten a list draws for Content, and five for Upcoming releases, which offer no number", async () => {
    const tall = { w: 12, h: 8, tier: "large" } as const;
    await loadCard(contentTableWidget, {}, KEY, { size: tall });
    await loadCard(upcomingReleasesWidget, {}, KEY, { size: tall });
    expect(asked.map(each => each.query.limit)).toEqual([
      Math.min(10, rowsThatFit(tall, { density: "default" })) + 1,
      6,
    ]);
  });
});

describe("Continue where you left off", () => {
  it("asks its source for the tab its reader chose, Mine unless chosen", async () => {
    await loadCard(continueWidget, {}, KEY, { size: FIVE_ROWS });
    await loadCard(continueWidget, { tab: "team" }, KEY, { size: FIVE_ROWS });
    expect(asked.map(each => each.query.where)).toEqual([
      { tab: "mine" },
      { tab: "team" },
    ]);
  });

  it("puts its tab on its header, as its one quick setting", () => {
    resetWidgetRegistries([]);
    const settings = getWidget("core/continue")?.settings ?? [];
    expect(
      settings.filter(setting => setting.quick === true).map(s => s.name)
    ).toEqual(["tab"]);
  });
});

describe("what each card makes of its answer", () => {
  it("hands a list card the source's rows as JSON carries them, with what the same read counted", async () => {
    answers[ACTIVITY_SOURCE_ID] = {
      op: "list",
      items: [{ id: "a1", createdAt: new Date("2026-10-28T06:00:00.000Z") }],
      total: 12,
      atLeast: true,
    };
    await expect(
      loadCard(teamActivityWidget, {}, KEY, { size: FIVE_ROWS })
    ).resolves.toEqual({
      items: [{ id: "a1", createdAt: "2026-10-28T06:00:00.000Z" }],
      total: 12,
      atLeast: true,
    });
  });

  it("hands Team the counts its source sent, and never a count it left out", async () => {
    answers[TEAM_SOURCE_ID] = {
      op: "list",
      items: [{ figure: "users", count: 12 }],
    };
    await expect(
      loadCard(teamWidget, {}, KEY, { size: FIVE_ROWS })
    ).resolves.toEqual({ users: 12 });
  });

  it("leaves Upcoming releases off the dashboard while its answer is empty", () => {
    const isEmpty = upcomingReleasesWidget.isEmpty;
    expect(isEmpty?.({ items: [] })).toBe(true);
    expect(isEmpty?.({ items: [{ kind: "release", id: "r1" }] })).toBe(false);
  });

  it("refuses an answer of another op, as the batch refuses one", async () => {
    answers[CONTENT_SOURCE_ID] = { op: "count", total: 3 };
    await expect(
      loadCard(contentTableWidget, {}, KEY, { size: FIVE_ROWS })
    ).rejects.toThrow();
  });
});

describe("as core publishes them", () => {
  it("are each a card answered on the server, offered on the condition it always had", () => {
    resetWidgetRegistries([]);
    const offered = (id: string) => {
      const published = getWidget(id);
      return [
        id,
        // Answered on the server from the declaration core keeps for it.
        declaredWidget(id)?.owner === CORE_OWNER,
        published?.lifecycle,
        published?.visibleWhen,
      ];
    };
    expect(offered("core/content-table")).toEqual([
      "core/content-table",
      true,
      "conditional",
      "content:present",
    ]);
    expect(offered("core/continue")).toEqual([
      "core/continue",
      true,
      "conditional",
      "content:present",
    ]);
    expect(offered("core/team-activity")).toEqual([
      "core/team-activity",
      true,
      "conditional",
      "content:present",
    ]);
    expect(offered("core/upcoming-releases")).toEqual([
      "core/upcoming-releases",
      true,
      "conditional",
      "releases:present",
    ]);
    // The control: Team is always offered, to the readers its gate admits.
    expect(offered("core/team")).toEqual([
      "core/team",
      true,
      undefined,
      undefined,
    ]);
  });

  it("offer Upcoming releases to a holder of any one of its three permissions, and to no one else", () => {
    resetWidgetRegistries([]);
    const gate = getWidget("core/upcoming-releases")?.requiredPermission;
    for (const action of ["read", "create", "publish"]) {
      const held = `${action}-content-releases`;
      expect([held, widgetGateHolds(gate, slug => slug === held)]).toEqual([
        held,
        true,
      ]);
    }
    expect(widgetGateHolds(gate, slug => slug === "read-posts")).toBe(false);
  });

  it("offer Team to a reader who may read people and add or change them, and to no one else", () => {
    resetWidgetRegistries([]);
    const gate = getWidget("core/team")?.requiredPermission;
    const holding = (...slugs: string[]) =>
      widgetGateHolds(gate, slug => slugs.includes(slug));
    expect(holding("read-users", "update-users")).toBe(true);
    expect(holding("read-users", "create-users")).toBe(true);
    // Each half alone is not enough.
    expect(holding("read-users")).toBe(false);
    expect(holding("create-users", "update-users")).toBe(false);
  });
});
