// A config reload under `next dev` that moves a field into or out of a group is refused before it
// changes anything, naming the field and the command that carries its values: `nextly
// migrate:create`, whose file copies them. The push itself carries no values between a column and
// a group's JSON, so applied, a move into a group deletes the field's column with every value in
// it, and a move out of one adds an empty column while the values stay in the group, where nothing
// reads them. Refused whatever the data-loss consent says, as no consent names a move.
// Driven through `reloadNextlyConfig` itself, on every configured dialect.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineConfig } from "../../config";
import { getService } from "../../di/service-access";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../plugins/test-nextly";
import { reloadNextlyConfig } from "../reload-config";

const loaded = vi.hoisted(() => ({
  config: undefined as unknown,
}));
vi.mock("../../cli/utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../cli/utils/config-loader")>()),
  loadConfig: async () => ({
    config: loaded.config,
    configPath: "",
    dependencies: [],
  }),
}));

const SLUG = "rlmove";
const TABLE = `dc_${SLUG}`;

/** The collection with `subtitle` on the row (`row`) or inside the `meta` group (`grouped`). */
const configWith = (where: "row" | "grouped") =>
  defineConfig({
    collections: [
      defineCollection({
        slug: SLUG,
        fields: [
          { name: "title", type: "text" },
          ...(where === "row" ? [{ name: "subtitle", type: "text" }] : []),
          {
            name: "meta",
            type: "group",
            fields: [
              { name: "note", type: "text" },
              ...(where === "grouped"
                ? [{ name: "subtitle", type: "text" }]
                : []),
            ],
          },
        ] as never,
      }),
    ],
  });

describe.each(getConfiguredTestDialects())(
  "a config reload that moves a field into or out of a group (%s)",
  dialect => {
    let handle: TestNextly;
    let said: ReturnType<typeof vi.spyOn>[];

    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    /** Start on the config `where` places `subtitle` in, under next dev, with one entry. */
    async function startWith(where: "row" | "grouped"): Promise<void> {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      // The reload runs its schema work only under next dev.
      vi.stubEnv("NODE_ENV", "development");
      loaded.config = configWith(where);
      await reloadNextlyConfig();
      const meta =
        where === "grouped"
          ? `{"note":"N","subtitle":"Kept subtitle"}`
          : `{"note":"N"}`;
      await handle.adapter.executeQuery(
        `INSERT INTO ${q(TABLE)} (${q("id")}, ${q("title")}, ${q("slug")}, ${q("meta")}${where === "row" ? `, ${q("subtitle")}` : ""}) ` +
          `VALUES ('e1', 'P', 'p', '${meta}'${where === "row" ? ", 'Kept subtitle'" : ""})`
      );
      said = [
        vi.spyOn(console, "warn").mockImplementation(() => {}),
        vi.spyOn(console, "error").mockImplementation(() => {}),
      ];
    }

    afterEach(async () => {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      await handle?.destroy();
    });

    beforeEach(() => {
      // Consent to drop the field's column, which a move into a group would otherwise be taken as.
      vi.stubEnv("NEXTLY_ACCEPT_DATA_LOSS", TABLE);
    });

    async function columnsOf(name: string): Promise<string[]> {
      const rows = (await handle.adapter.executeQuery(
        dialect === "sqlite"
          ? `SELECT name AS name FROM pragma_table_info('${name}')`
          : dialect === "mysql"
            ? `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${name}'`
            : `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${name}'`
      )) as { name: string }[];
      return rows.map(row => row.name);
    }

    /** What the reload's own logger said, where it names what it held back. */
    let logged: string[] = [];

    const told = () =>
      [
        ...logged,
        ...said.flatMap(spy => spy.mock.calls.flat().map(String)),
      ].join("\n");

    /** A reload whose logger is captured, as the development server's is printed. */
    async function reload(): Promise<void> {
      logged = [];
      const note = (line: unknown) => {
        logged.push(String(line));
      };
      const logger = {
        warn: note,
        error: note,
        info: () => {},
        debug: () => {},
      };
      await reloadNextlyConfig({
        resolver: name =>
          name === "logger"
            ? logger
            : getService(name as Parameters<typeof getService>[0]),
      });
    }

    it("refuses a field moved into a group, keeping its column and every value", async () => {
      await startWith("row");
      loaded.config = configWith("grouped");
      await reload();

      expect(told()).toMatch(/subtitle/);
      expect(told()).toMatch(/migrate:create/);
      expect(await columnsOf(TABLE)).toContain("subtitle");
      const rows = (await handle.adapter.executeQuery(
        `SELECT ${q("subtitle")} AS subtitle FROM ${q(TABLE)}`
      )) as { subtitle: string | null }[];
      expect(rows.map(row => row.subtitle)).toEqual(["Kept subtitle"]);
    });

    it("refuses a field moved out of a group, adding no empty column", async () => {
      await startWith("grouped");
      loaded.config = configWith("row");
      await reload();

      expect(told()).toMatch(/subtitle/);
      expect(told()).toMatch(/migrate:create/);
      expect(await columnsOf(TABLE)).not.toContain("subtitle");
    });

    it("applies a field added to a group beside one that left another (no move: a different type)", async () => {
      // The positive control: a reload that changes the same places without a move still applies,
      // so the refusals above are the move's and not any change to the group's.
      await startWith("row");
      loaded.config = defineConfig({
        collections: [
          defineCollection({
            slug: SLUG,
            fields: [
              { name: "title", type: "text" },
              {
                name: "meta",
                type: "group",
                fields: [
                  { name: "note", type: "text" },
                  { name: "subtitle", type: "number" },
                ],
              },
            ] as never,
          }),
        ],
      });
      await reload();

      expect(await columnsOf(TABLE)).not.toContain("subtitle");
    });
  }
);
