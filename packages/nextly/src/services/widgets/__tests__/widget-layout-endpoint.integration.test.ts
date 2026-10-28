/**
 * The dashboard layout endpoint against a real database, on every configured
 * dialect, through the real catch-all handler and real session cookies.
 *
 * The unit tests drive the endpoint over a stand-in service, which proves its
 * rules and nothing about a stored row. These prove the rules that are about
 * the ROW: what a read leaves behind, what a write keeps and refuses, that
 * one computed default reaches everyone following it, and that a row of an
 * earlier format is read as no row and replaced by its owner's next write.
 */

// Must be set before the harness boots (env validation) and to sign tokens.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import {
  deregisterWidget,
  listWidgets,
  registerWidget,
} from "../../../domains/widgets/registry";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import { layoutRowId } from "../../../schemas/widget-layout";
import { WidgetLayoutService } from "../widget-layout-service";

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

// Each test makes several real requests through the whole handler, each one a
// dozen queries. The package's 30 s default fits a local database; set
// NEXTLY_TEST_SLOW_DB=1 when the database is across a network. CI keeps the
// default, so a slow query there still fails.
if (process.env.NEXTLY_TEST_SLOW_DB === "1") {
  vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });
}

interface Placement {
  id: string;
  widgetId: string;
  w: number;
  h: number;
  removed: boolean;
  config?: Record<string, unknown>;
}

interface LayoutRead {
  placements: Placement[];
  available: string[];
  version: number;
  source: string;
  scope: string;
}

/** Only this test's widgets: core registers its own beside them at boot. */
const ours = (placements: readonly Placement[]) =>
  placements.filter(p => p.widgetId.startsWith("test/"));

function testWidget(
  id: string,
  defaultOrder: number,
  extra: Record<string, unknown> = {}
) {
  registerWidget(
    {
      id: `test/${id}`,
      title: id,
      archetype: "text",
      size: { default: { w: 4, h: 3 } },
      defaultOrder,
      content: id,
      ...extra,
    },
    { source: "@test/layout" }
  );
}

describe.each(getConfiguredTestDialects())(
  "the layout endpoint (%s)",
  dialect => {
    let handle: TestNextly;
    /** The first account, the super admin; and a second with no grants. */
    let admin: string;
    let editor: string;

    async function account(email: string): Promise<string> {
      const nextly = handle.nextly as unknown as {
        users: {
          create: (a: { data: Record<string, unknown> }) => Promise<{
            item: { id: string };
          }>;
        };
      };
      const created = await nextly.users.create({
        data: { email, password: "Password123!", name: email, isActive: true },
      });
      return created.item.id;
    }

    async function cookie(userId: string): Promise<string> {
      const token = await signAccessToken(
        buildClaims({
          userId,
          email: `${userId}@example.com`,
          name: userId,
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET!
      );
      return `nextly_session=${token}`;
    }

    async function call(
      userId: string,
      method: "GET" | "PUT" | "DELETE",
      options: { body?: unknown; query?: Record<string, string> } = {}
    ): Promise<Response> {
      const handlers = createDynamicHandlers();
      const query = options.query
        ? `?${new URLSearchParams(options.query)}`
        : "";
      const request = new Request(
        `http://localhost/api/dashboard/layout${query}`,
        {
          method,
          headers: {
            cookie: await cookie(userId),
            ...(options.body === undefined
              ? {}
              : { "content-type": "application/json" }),
          },
          ...(options.body === undefined
            ? {}
            : { body: JSON.stringify(options.body) }),
        }
      );
      const context = {
        params: Promise.resolve({ params: ["dashboard", "layout"] }),
      };
      if (method === "GET") return handlers.GET(request, context);
      if (method === "PUT") return handlers.PUT(request, context);
      return handlers.DELETE(request, context);
    }

    async function read(userId: string): Promise<LayoutRead> {
      const res = await call(userId, "GET");
      expect(res.status).toBe(200);
      return (await res.json()) as LayoutRead;
    }

    async function save(
      userId: string,
      seen: LayoutRead,
      placements: Placement[],
      extra: Record<string, unknown> = {}
    ): Promise<Response> {
      return call(userId, "PUT", {
        body: {
          placements,
          version: seen.version,
          scope: seen.scope,
          ...extra,
        },
      });
    }

    /** A service over the same adapter, used only to reach the row directly. */
    function service(): WidgetLayoutService {
      return new WidgetLayoutService(handle.adapter, silentLogger);
    }

    /** The stored text and version, read from the table, not through the decoder. */
    async function rawRow(userId: string) {
      const internals = service() as unknown as {
        db: {
          select: (f: unknown) => {
            from: (t: unknown) => {
              where: (w: unknown) => Promise<Array<Record<string, unknown>>>;
            };
          };
          update: (t: unknown) => {
            set: (v: unknown) => { where: (w: unknown) => Promise<unknown> };
          };
        };
        table: { id: unknown; layout: unknown; version: unknown };
      };
      const { eq } = await import("drizzle-orm");
      const where = eq(
        internals.table.id as never,
        layoutRowId("user", userId)
      );
      const rows = await internals.db
        .select({
          layout: internals.table.layout,
          version: internals.table.version,
        })
        .from(internals.table)
        .where(where);
      return {
        row: rows[0] as { layout: string; version: number } | undefined,
        overwrite: (layout: string) =>
          internals.db.update(internals.table).set({ layout }).where(where),
      };
    }

    // ONE instance per dialect, booted once: a boot creates a database and
    // pushes the whole schema, which on a networked server is most of a test's
    // time budget. Each test still starts clean: a fresh editor account (so no
    // row of an earlier test can be read), the admin's row removed, and this
    // test's widgets registered anew, beside the widgets the boot registered.
    let accounts = 0;
    let bootWidgets: string[] = [];
    beforeAll(async () => {
      handle = await createTestNextly({ dialect });
      bootWidgets = listWidgets().map(w => w.id);
      // The first account of an instance is its super admin.
      admin = await account("admin@example.com");
    }, 120_000);

    afterAll(async () => {
      await handle?.destroy();
    });

    beforeEach(async () => {
      // Every test reads the registry a real boot leaves, whichever ran
      // before it: an earlier test's clean-up must not take core's widgets.
      expect(listWidgets().map(w => w.id)).toEqual(bootWidgets);
      accounts += 1;
      editor = await account(`editor-${accounts}@example.com`);
      const stored = await service().getLayout("user", admin);
      if (stored.version > 0) {
        await service().deleteLayout("user", admin, stored.version);
      }
      testWidget("first", 1000);
      testWidget("gated", 1010, { requiredPermission: "manage-the-vault" });
      testWidget("last", 1020, { size: { default: { w: 3, h: 2 } } });
    });

    // Only this suite's widgets: the instance outlives the test, and so must
    // the widgets its boot registered.
    afterEach(() => {
      for (const { id } of listWidgets()) {
        if (id.startsWith("test/")) deregisterWidget(id);
      }
    });

    it("gives two people with no arrangement the same default, less what one may not see", async () => {
      const forAdmin = ours((await read(admin)).placements);
      const forEditor = ours((await read(editor)).placements);

      expect(forAdmin.map(p => p.widgetId)).toEqual([
        "test/first",
        "test/gated",
        "test/last",
      ]);
      expect(forEditor).toEqual(
        forAdmin.filter(p => p.widgetId !== "test/gated")
      );
      expect(forEditor.map(p => [p.w, p.h])).toEqual([
        [4, 3],
        [3, 2],
      ]);
    });

    it("brings a change to the default to a person following it", async () => {
      const before = ours((await read(editor)).placements);
      testWidget("between", 1005);
      const after = ours((await read(editor)).placements);

      expect(before.map(p => p.widgetId)).toEqual(["test/first", "test/last"]);
      expect(after.map(p => p.widgetId)).toEqual([
        "test/first",
        "test/between",
        "test/last",
      ]);
    });

    it("leaves a saved arrangement as it was when the default, the widgets or someone else change", async () => {
      const seen = await read(editor);
      const arranged = [
        ...seen.placements.filter(p => p.widgetId === "test/last"),
        ...seen.placements
          .filter(p => p.widgetId === "test/first")
          .map(p => ({ ...p, w: 6, h: 4, config: { range: 30 } })),
      ];
      expect((await save(editor, seen, arranged)).status).toBe(200);
      const stored = (await rawRow(editor)).row;

      // The default changes, a widget arrives, and someone else saves.
      testWidget("arrived", 1001);
      const other = await read(admin);
      expect((await save(admin, other, ours(other.placements))).status).toBe(
        200
      );

      expect((await rawRow(editor)).row).toEqual(stored);
      const now = await read(editor);
      // Offered, never placed.
      expect(ours(now.placements).map(p => p.id)).toEqual(
        ours(arranged).map(p => p.id)
      );
      expect(now.available).toContain("test/arrived");
      // And the settings came back exactly as saved.
      expect(
        now.placements.find(p => p.widgetId === "test/first")
      ).toMatchObject({ w: 6, h: 4, config: { range: 30 } });
    });

    describe("a row of an earlier format", () => {
      /**
       * A row of each earlier format, as those releases wrote it, holding
       * every field that format stored, each different from the default: a
       * moved and resized card, a removal, settings, a skipped Get started
       * step, the unarranged mark and a card of a widget nobody declares.
       */
      const EARLIER: ReadonlyArray<[number, string]> = [
        [
          1,
          JSON.stringify({
            schemaVersion: 1,
            placements: [
              {
                id: "b",
                widgetId: "test/last",
                order: 0,
                hidden: true,
                size: "lg",
                height: "tall",
              },
              {
                id: "a",
                widgetId: "test/first",
                order: 1,
                hidden: false,
                size: "sm",
                config: { k: "v" },
              },
            ],
          }),
        ],
        [
          2,
          JSON.stringify({
            schemaVersion: 2,
            columnCount: 2,
            placements: [
              {
                id: "b",
                widgetId: "test/last",
                column: 1,
                order: 0,
                hidden: true,
                size: "lg",
              },
              {
                id: "a",
                widgetId: "test/first",
                column: 0,
                order: 0,
                hidden: false,
                size: "sm",
                config: { k: "v" },
              },
              {
                id: "old",
                widgetId: "core/onboarding-checklist",
                column: 0,
                order: 1,
                hidden: false,
              },
            ],
          }),
        ],
        [
          3,
          JSON.stringify({
            schemaVersion: 3,
            unarranged: true,
            placements: [
              {
                id: "started",
                widgetId: "core/get-started",
                width: "half",
                removed: true,
                config: { acted: true, skipped: ["invite"] },
              },
              { id: "b", widgetId: "test/last", width: "full", removed: true },
              {
                id: "a",
                widgetId: "test/first",
                width: "quarter",
                removed: false,
                config: { k: "v" },
              },
            ],
          }),
        ],
      ];

      /** A row for `userId` holding `raw`, written as that release wrote it. */
      async function earlierRow(userId: string, raw: string): Promise<void> {
        const seen = await read(userId);
        expect((await save(userId, seen, seen.placements)).status).toBe(200);
        await (await rawRow(userId)).overwrite(raw);
      }

      for (const [version, raw] of EARLIER) {
        it(`reads a version ${version} row as the default, without writing it`, async () => {
          const fresh = await read(editor);
          await earlierRow(editor, raw);

          const first = await read(editor);
          const second = await read(editor);

          // 🔴 Exactly what the reader was handed before they had a row: no
          // card, size, setting, removal or skip of the earlier row.
          expect(first.source).toBe("default");
          expect(first.placements).toEqual(fresh.placements);
          expect(second.placements).toEqual(fresh.placements);
          // The row's own version, so the next write replaces it.
          expect(first.version).toBe(1);
          // And the reads left the row's text exactly as it was.
          expect((await rawRow(editor)).row).toEqual({
            layout: raw,
            version: 1,
          });
        });

        it(`replaces a version ${version} row at a single-card write with a version 4 row holding only that write`, async () => {
          // The same write by someone with no row at all is what this one
          // must store: the earlier row is replaced as an absent one is
          // created, nothing of it carried.
          const noRow = await account(
            `no-row-${version}-${accounts}@example.com`
          );
          await earlierRow(editor, raw);
          // A removal outside customise mode: the one card changed.
          const removeFirst = (userId: string, seen: LayoutRead) =>
            save(
              userId,
              seen,
              seen.placements.map(p =>
                p.widgetId === "test/first" ? { ...p, removed: true } : p
              ),
              { arranged: false }
            );

          // 🔴 Accepted without asking: an earlier row is not unreadable.
          expect((await removeFirst(editor, await read(editor))).status).toBe(
            200
          );
          expect((await removeFirst(noRow, await read(noRow))).status).toBe(
            200
          );

          const mine = (await rawRow(editor)).row;
          const created = (await rawRow(noRow)).row;
          expect(mine?.version).toBe(2);
          expect(mine?.layout).toBe(created?.layout);
          const stored = JSON.parse(mine?.layout ?? "null") as {
            schemaVersion: number;
            placements: Placement[];
          };
          expect(stored.schemaVersion).toBe(4);
          expect(ours(stored.placements)).toEqual([
            {
              id: "test/first",
              widgetId: "test/first",
              w: 4,
              h: 3,
              removed: true,
            },
            {
              id: "test/gated",
              widgetId: "test/gated",
              w: 4,
              h: 3,
              removed: false,
            },
            {
              id: "test/last",
              widgetId: "test/last",
              w: 3,
              h: 2,
              removed: false,
            },
          ]);
          const after = await read(editor);
          expect(ours(after.placements).map(p => [p.id, p.removed])).toEqual([
            ["test/first", true],
            ["test/last", false],
          ]);
        });
      }

      it("is replaced by a full save without a confirmation", async () => {
        await earlierRow(editor, EARLIER[2]![1]);
        const seen = await read(editor);
        const arranged = [...ours(seen.placements)].reverse();
        expect((await save(editor, seen, arranged)).status).toBe(200);

        const after = await read(editor);
        expect(after.source).toBe("own");
        expect(ours(after.placements)).toEqual(arranged);
        expect((await rawRow(editor)).row?.version).toBe(2);
      });
    });

    // A row with no version, one of version 0 (below the range this core
    // wrote) and one of a version a newer core wrote: none is an earlier
    // format to reset, and each stays on the unreadable path.
    describe.each([
      ["no version", '{"placements":[]}'],
      ["version 0", '{"schemaVersion":0,"placements":[]}'],
      ["version 99", '{"schemaVersion":99}'],
    ])("an arrangement that cannot be read: %s", (_name, text) => {
      async function unreadable(): Promise<LayoutRead> {
        const seen = await read(editor);
        expect((await save(editor, seen, seen.placements)).status).toBe(200);
        await (await rawRow(editor)).overwrite(text);
        return read(editor);
      }

      it("shows the default and says so, leaving the row as it was", async () => {
        const shown = await unreadable();
        expect(shown.source).toBe("unreadable");
        expect(ours(shown.placements).map(p => p.widgetId)).toEqual([
          "test/first",
          "test/last",
        ]);
        expect((await rawRow(editor)).row).toEqual({
          layout: text,
          version: 1,
        });
      });

      it("refuses a single-card write and an unconfirmed save, changing nothing", async () => {
        const shown = await unreadable();
        const removedOne = shown.placements.map(p =>
          p.widgetId === "test/first" ? { ...p, removed: true } : p
        );

        expect(
          (await save(editor, shown, removedOne, { arranged: false })).status
        ).toBe(409);
        expect((await save(editor, shown, shown.placements)).status).toBe(409);
        expect((await rawRow(editor)).row).toEqual({
          layout: text,
          version: 1,
        });
      });

      it("is replaced by a save the person confirmed", async () => {
        const shown = await unreadable();
        const res = await save(editor, shown, shown.placements, {
          replaceUnreadable: true,
        });
        expect(res.status).toBe(200);
        expect((await read(editor)).source).toBe("own");
      });
    });

    describe("a card's settings on a dashboard nobody arranged", () => {
      // A setting changed outside customise mode is a single-card write: the
      // row stays unarranged, so the reader keeps following the default.
      const withConfig = (
        placements: Placement[],
        config: Record<string, unknown>
      ) =>
        placements.map(p =>
          p.widgetId === "test/first" ? { ...p, config } : p
        );

      it("keeps the setting, still following the default", async () => {
        const seen = await read(editor);
        const res = await save(
          editor,
          seen,
          withConfig(seen.placements, { limit: 7 }),
          { arranged: false }
        );
        expect(res.status).toBe(200);

        const after = await read(editor);
        const first = after.placements.find(p => p.widgetId === "test/first");
        expect(first?.config).toEqual({ limit: 7 });
        // Still a row that follows the default, not a snapshot.
        expect((await rawRow(editor)).row?.layout as string).toContain(
          '"unarranged":true'
        );
      });

      it("reads a row that holds only a removal exactly as before", async () => {
        const seen = await read(editor);
        const removedOne = seen.placements.map(p =>
          p.widgetId === "test/first" ? { ...p, removed: true } : p
        );
        expect(
          (await save(editor, seen, removedOne, { arranged: false })).status
        ).toBe(200);

        const after = await read(editor);
        expect(
          ours(after.placements).map(p => [p.widgetId, p.removed, p.config])
        ).toEqual([
          ["test/first", true, undefined],
          ["test/last", false, undefined],
        ]);
      });

      it("is the person's own: another person holding the same widget sees no setting", async () => {
        const seen = await read(editor);
        expect(
          (
            await save(
              editor,
              seen,
              withConfig(seen.placements, { limit: 7 }),
              {
                arranged: false,
              }
            )
          ).status
        ).toBe(200);

        const theirs = await read(admin);
        const first = theirs.placements.find(p => p.widgetId === "test/first");
        expect(first).toBeDefined();
        expect(first?.config).toBeUndefined();
      });

      it("carries over when the person later arranges their dashboard", async () => {
        const seen = await read(editor);
        expect(
          (
            await save(
              editor,
              seen,
              withConfig(seen.placements, { limit: 7 }),
              {
                arranged: false,
              }
            )
          ).status
        ).toBe(200);

        // The admin arranges from what it was handed, which now holds the
        // setting, so a first arranged save keeps it.
        const handed = await read(editor);
        const arranged = [...ours(handed.placements)].reverse();
        expect((await save(editor, handed, arranged)).status).toBe(200);

        const after = await read(editor);
        expect(
          after.placements.find(p => p.widgetId === "test/first")?.config
        ).toEqual({ limit: 7 });
        expect(after.source).toBe("own");
      });
    });

    it("after a saved reset, brings later changes to the default to the reader", async () => {
      // The reset removes the row rather than storing today's default, so the
      // reader follows the default again: a widget declared afterwards
      // reaches them, as it reaches someone who never arranged anything.
      const seen = await read(editor);
      const arranged = [...ours(seen.placements)].reverse();
      expect((await save(editor, seen, arranged)).status).toBe(200);

      const before = await read(editor);
      const reset = await call(editor, "DELETE", {
        query: { version: String(before.version), scope: before.scope },
      });
      expect(reset.status).toBe(200);

      testWidget("declared-later", 1015);
      const after = await read(editor);
      expect(after.source).toBe("default");
      expect(after.version).toBe(0);
      expect(ours(after.placements).map(p => p.widgetId)).toEqual([
        "test/first",
        "test/declared-later",
        "test/last",
      ]);
    });

    it("refuses a reset staged in a stale tab, keeping the newer arrangement", async () => {
      const first = await read(editor);
      expect((await save(editor, first, first.placements)).status).toBe(200);
      const staleTab = await read(editor);

      // Another tab saves after the stale one read.
      const otherTab = await read(editor);
      const newer = [...otherTab.placements].reverse();
      expect((await save(editor, otherTab, newer)).status).toBe(200);

      const res = await call(editor, "DELETE", {
        query: { version: String(staleTab.version), scope: staleTab.scope },
      });
      expect(res.status).toBe(409);
      expect((await read(editor)).placements.map(p => p.id)).toEqual(
        newer.map(p => p.id)
      );

      // From a current read, the reset goes through and the default is back.
      const current = await read(editor);
      const ok = await call(editor, "DELETE", {
        query: { version: String(current.version), scope: current.scope },
      });
      expect(ok.status).toBe(200);
      expect((await read(editor)).source).toBe("default");
    });

    describe("the Get started card", () => {
      const STARTED = "core/get-started";

      interface StartedRead extends LayoutRead {
        defaultPlacements: Placement[];
        getStarted: {
          drawn: boolean;
          answer: {
            unknown: boolean;
            steps: Array<{ key: string; status: string }>;
          } | null;
        };
      }

      /** A read, held to its one rule: the card is handed exactly when it is said to be drawn. */
      async function readStarted(
        userId: string,
        query?: Record<string, string>
      ): Promise<StartedRead> {
        const res = await call(userId, "GET", query ? { query } : {});
        expect(res.status).toBe(200);
        const body = (await res.json()) as StartedRead;
        const handed = body.placements.some(
          p => p.widgetId === STARTED && !p.removed
        );
        expect(handed).toBe(body.getStarted.drawn);
        return body;
      }

      it("is drawn first, at full width, while a step waits, with its steps from the same read", async () => {
        const seen = await readStarted(admin);
        expect(seen.placements[0]).toMatchObject({
          widgetId: STARTED,
          w: 12,
          removed: false,
        });
        expect(seen.defaultPlacements[0]?.widgetId).toBe(STARTED);
        expect(
          seen.getStarted.answer?.steps.some(s => s.status === "open")
        ).toBe(true);
        expect(seen.available).not.toContain(STARTED);
      });

      it("keeps a dismissal and its skips on the server, answers its steps only when asked, and comes back with them", async () => {
        const seen = await readStarted(admin);
        const card = seen.placements.find(p => p.widgetId === STARTED)!;
        const settings = { acted: true, skipped: ["invite"] };
        const dismissed = seen.placements.map(p =>
          p.id === card.id ? { ...p, removed: true, config: settings } : p
        );
        expect(
          (await save(admin, seen, dismissed, { arranged: false })).status
        ).toBe(200);

        const after = await readStarted(admin);
        expect(after.placements.find(p => p.id === card.id)).toMatchObject({
          removed: true,
          config: settings,
        });
        expect(after.getStarted).toEqual({ drawn: false, answer: null });
        const asked = await readStarted(admin, { getStarted: "1" });
        expect(asked.getStarted.answer).not.toBeNull();

        const restored = after.placements.map(p =>
          p.id === card.id ? { ...p, removed: false } : p
        );
        expect(
          (await save(admin, after, restored, { arranged: false })).status
        ).toBe(200);
        const back = await readStarted(admin);
        expect(back.getStarted.drawn).toBe(true);
        expect(back.placements.find(p => p.id === card.id)?.config).toEqual(
          settings
        );
      });

      it("comes back, drawn and with no skips, for a reader whose earlier-format row removed it", async () => {
        // 🔴 Nothing of an earlier row is carried: not its removal of the
        // card, not the steps it skipped.
        const seen = await read(admin);
        expect((await save(admin, seen, seen.placements)).status).toBe(200);
        await (
          await rawRow(admin)
        ).overwrite(
          JSON.stringify({
            schemaVersion: 3,
            placements: [
              {
                id: "started",
                widgetId: STARTED,
                width: "full",
                removed: true,
                config: { acted: true, skipped: ["invite"] },
              },
            ],
          })
        );
        const after = await readStarted(admin);
        const card = after.placements.find(p => p.widgetId === STARTED);
        expect(card).toEqual(
          expect.objectContaining({ id: STARTED, removed: false })
        );
        expect(card?.config).toBeUndefined();
        expect(after.getStarted.drawn).toBe(true);
      });

      it("says setup could not be checked, and stays drawn, when the registry cannot be listed", async () => {
        const registry = handle.getService(
          "collectionRegistryService"
        ) as unknown as { getAllSlugs: () => Promise<string[]> };
        const failing = vi
          .spyOn(registry, "getAllSlugs")
          .mockRejectedValue(new Error("registry down"));
        try {
          const seen = await readStarted(admin);
          expect(seen.getStarted.drawn).toBe(true);
          expect(seen.getStarted.answer?.unknown).toBe(true);
          // Never shown as waiting on the strength of a registry that did not answer.
          expect(
            seen.getStarted.answer?.steps.some(
              s =>
                (s.key === "collection" || s.key === "entry") &&
                s.status === "open"
            )
          ).toBe(false);
        } finally {
          failing.mockRestore();
        }
      });
    });
  }
);
