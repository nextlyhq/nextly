/**
 * The dashboard layout endpoint against a real database, on every configured
 * dialect, through the real catch-all handler and real session cookies.
 *
 * The unit tests drive the endpoint over a stand-in service, which proves its
 * rules and nothing about a stored row. These prove the rules that are about
 * the ROW: what a read leaves behind, what a write keeps and refuses, and that
 * one computed default reaches everyone following it.
 */

// Must be set before the harness boots (env validation) and to sign tokens.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import {
  clearWidgets,
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

interface Placement {
  id: string;
  widgetId: string;
  width: string;
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
      defaultSize: "md",
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

    beforeEach(async () => {
      handle = await createTestNextly({ dialect });
      admin = await account("admin@example.com");
      editor = await account("editor@example.com");
      testWidget("first", 1000);
      testWidget("gated", 1010, { requiredPermission: "manage-the-vault" });
      testWidget("last", 1020, { defaultSize: "sm" });
    });

    afterEach(async () => {
      clearWidgets();
      await handle.destroy();
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
      expect(forEditor.map(p => p.width)).toEqual(["third", "quarter"]);
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
          .map(p => ({ ...p, width: "half", config: { range: 30 } })),
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
      ).toMatchObject({ width: "half", config: { range: 30 } });
    });

    it("reads a columns-format row without writing it, and converts every card", async () => {
      const seen = await read(editor);
      expect((await save(editor, seen, seen.placements)).status).toBe(200);
      const raw = JSON.stringify({
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
        ],
      });
      const { overwrite } = await rawRow(editor);
      await overwrite(raw);

      const converted = await read(editor);
      await read(editor);

      expect(ours(converted.placements)).toEqual([
        {
          id: "a",
          widgetId: "test/first",
          width: "quarter",
          removed: false,
          config: { k: "v" },
        },
        { id: "b", widgetId: "test/last", width: "half", removed: true },
      ]);
      expect((await rawRow(editor)).row).toEqual({ layout: raw, version: 1 });
    });

    describe("an arrangement that cannot be read", () => {
      async function unreadable(): Promise<LayoutRead> {
        const seen = await read(editor);
        expect((await save(editor, seen, seen.placements)).status).toBe(200);
        await (await rawRow(editor)).overwrite('{"schemaVersion":99}');
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
          layout: '{"schemaVersion":99}',
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
          layout: '{"schemaVersion":99}',
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
  }
);
