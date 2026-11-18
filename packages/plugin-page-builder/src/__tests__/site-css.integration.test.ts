/**
 * The site's CSS through Nextly's own request handler, on every configured
 * dialect: kept in the plugin's options table as a header row and parts of
 * at most 255 characters, which MySQL's `varchar(255)` holds even for
 * characters outside the Basic Multilingual Plane; saved only by a person
 * holding the site settings permission, never an API key; refused when it
 * changed since it was read, of two saves made from one read too; audited by
 * hash; and read back by the published route through the page builder.
 *
 * What separates a correct store from a plausible broken one:
 * - a part cut by UTF-16 units holds 127 emoji where 255 fit, and one cut at
 *   256 units refuses the insert on MySQL;
 * - a save that skips the compare-and-set lets both of two saves made from
 *   one read land, so neither is told it was replaced.
 */
// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { pageBuilderCustomCss } from "../custom-css";
import { pageBuilder } from "../plugin";
import { SCHEMA_PREFIX, siteOptions } from "../schema/tables";
import { sha256Hex } from "../sha256-hex";
import { SITE_CSS_SAVED_AUDIT } from "../site-code/css-route";
import { SITE_CSS_STALE } from "../site-code/site-css-store";

import { call, holding, person, post, sessionOf } from "./transfer-harness";

/** The plugin's options table, as the database names it. */
const OPTIONS_TABLE = `${SCHEMA_PREFIX}__${siteOptions.name}`;

/** The site CSS route, as the harness addresses it. */
const ROUTE = ["site", "css"];

/**
 * CSS longer than two parts, with a character outside the Basic Multilingual
 * Plane at a part's end and in the middle of the next.
 */
const CSS = `/* ${"a".repeat(251)}😀 */\nbody { --mark: "𝔸"; }\n${"p { margin: 0; }\n".repeat(30)}`;

describe.each(getConfiguredTestDialects())(
  "the site's CSS (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot() {
      const plugin = pageBuilder();
      current = await createTestNextly({
        dialect,
        plugins: [plugin],
        seedPublic: true,
      });
      // The site's first person is its owner, who holds every permission.
      const ownerId = await person(current, "owner");
      return {
        t: current,
        plugin,
        owner: await sessionOf(current, ownerId),
        ownerId,
      };
    }

    /** The CSS rows, by name, through the instance's own adapter. */
    async function cssRows(t: TestNextly): Promise<Map<string, string>> {
      const quote = (name: string) =>
        dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
      const rows = await t.adapter.executeQuery<{
        name: unknown;
        value: unknown;
      }>(
        `SELECT ${quote("name")}, ${quote("value")} FROM ${quote(OPTIONS_TABLE)} WHERE ${quote("name")} LIKE 'site-css%'`
      );
      return new Map(rows.map(row => [String(row.name), String(row.value)]));
    }

    /** The save audit rows' metadata. */
    async function auditRows(
      t: TestNextly
    ): Promise<Array<Record<string, unknown>>> {
      const rows = await t.adapter.select<{ metadata: unknown }>("audit_log", {
        where: {
          and: [{ column: "kind", op: "=", value: SITE_CSS_SAVED_AUDIT }],
        },
      });
      return rows.map(
        row =>
          (typeof row.metadata === "string"
            ? JSON.parse(row.metadata)
            : row.metadata) as Record<string, unknown>
      );
    }

    it("keeps CSS longer than a row in parts of 255 characters, and reads it back whole", async () => {
      const { t, owner, plugin } = await boot();
      const none = await call("GET", owner, ROUTE);
      expect(none.status).toBe(200);
      expect(none.body).toMatchObject({
        css: "",
        sha256: await sha256Hex(""),
        changedBy: null,
        changedAt: null,
      });

      const saved = await post(owner, ROUTE, {
        css: CSS,
        sha256: none.body.sha256,
      });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);

      // The parts each hold at most 255 characters, the first one full.
      const rows = await cssRows(t);
      const parts = [...rows.entries()]
        .filter(([name]) => name.startsWith("site-css:"))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, value]) => value);
      expect(parts.length).toBe(Math.ceil(Array.from(CSS).length / 255));
      expect(Array.from(parts[0] ?? "").length).toBe(255);
      expect(parts.join("")).toBe(CSS);

      const read = await call("GET", owner, ROUTE);
      expect(read.body).toMatchObject({
        css: CSS,
        sha256: await sha256Hex(CSS),
        changedBy: "owner",
      });
      expect(typeof read.body.changedAt).toBe("string");

      // The published route reads it through the page builder.
      expect(await pageBuilderCustomCss({ plugin }).readSite()).toBe(CSS);
    });

    it("refuses a save made from CSS someone has changed since, of two at once too", async () => {
      const { t, owner } = await boot();
      const empty = await sha256Hex("");
      const [first, second] = await Promise.all([
        post(owner, ROUTE, { css: "a { color: red; }", sha256: empty }),
        post(owner, ROUTE, { css: "a { color: blue; }", sha256: empty }),
      ]);
      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 409]);
      const refused = first.status === 409 ? first : second;
      expect(JSON.stringify(refused.body)).toContain(SITE_CSS_STALE);

      // Made from the empty CSS again, after one save landed.
      const stale = await post(owner, ROUTE, { css: "b{}", sha256: empty });
      expect(stale.status).toBe(409);
      expect(JSON.stringify(stale.body)).toContain(SITE_CSS_STALE);

      // Two at once made from the stored CSS: the header row is there, so
      // only its compare-and-set tells them apart.
      const read = await call("GET", owner, ROUTE);
      const [third, fourth] = await Promise.all([
        post(owner, ROUTE, { css: "c{}", sha256: read.body.sha256 }),
        post(owner, ROUTE, { css: "d{}", sha256: read.body.sha256 }),
      ]);
      expect([third.status, fourth.status].sort()).toEqual([200, 409]);
      // Two saves landed, each audited once.
      expect(await auditRows(t)).toHaveLength(2);
    });

    it("audits a save by its hashes and sizes, never the CSS", async () => {
      const { t, owner, ownerId } = await boot();
      const css = "main { gap: 1rem; }";
      await post(owner, ROUTE, { css, sha256: await sha256Hex("") });
      const rows = await t.adapter.select<{
        actor_user_id?: unknown;
        actorUserId?: unknown;
        metadata: unknown;
      }>("audit_log", {
        where: {
          and: [{ column: "kind", op: "=", value: SITE_CSS_SAVED_AUDIT }],
        },
      });
      expect(rows).toHaveLength(1);
      expect(String(rows[0]?.actor_user_id ?? rows[0]?.actorUserId)).toBe(
        ownerId
      );
      expect((await auditRows(t))[0]).toEqual({
        cssSha256: await sha256Hex(css),
        cssSha256Before: await sha256Hex(""),
        cssChars: css.length,
        cssCharsBefore: 0,
      });
      expect(JSON.stringify(rows)).not.toContain("gap");
    });

    it("refuses an API key, and a person without the site settings permission", async () => {
      const { t, owner } = await boot();
      const empty = await sha256Hex("");
      const author = await holding(t, ["read-media"]);
      expect((await call("GET", author.cookie, ROUTE)).status).toBe(403);
      expect(
        (await post(author.cookie, ROUTE, { css: "a{}", sha256: empty })).status
      ).toBe(403);
      // Nor may they read it to draw: they may edit nothing the builder opens.
      expect(
        (await call("GET", author.cookie, ["site", "css", "drawn"])).status
      ).toBe(403);

      const ownerRead = await call("GET", owner, ["site", "css", "drawn"]);
      expect(ownerRead).toEqual({ status: 200, body: { css: "" } });

      const ownerId = String(
        (await t.nextly.users.find({ limit: 1 })).items[0]?.id
      );
      const made = await t.nextly.apiKeys.create({
        userId: ownerId,
        name: "agent",
        tokenType: "full-access",
        expiresIn: "unlimited",
      });
      const byKey = await post({ bearer: made.key }, ROUTE, {
        css: "a{}",
        sha256: empty,
      });
      expect(byKey.status).toBe(403);
      expect(await cssRows(t)).toEqual(new Map());
    });

    it("refuses CSS the checker refuses, naming its line", async () => {
      const { t, owner } = await boot();
      const refused = await post(owner, ROUTE, {
        css: 'a { color: red; }\n@import "/x.css";',
        sha256: await sha256Hex(""),
      });
      expect(refused.status).toBe(400);
      expect(JSON.stringify(refused.body)).toContain(
        "Line 2: @import isn't allowed."
      );
      expect(await cssRows(t)).toEqual(new Map());
    });
  }
);
