/**
 * A fluid text style carried by a design-token file from one site to
 * another, stored through the Single's own writes as the editor's import
 * makes them (the variables and site data first, then the classes), and
 * following a change of the importing site's fluid range afterwards.
 *
 * The file is written and read by the engine's own DTCG writer and reader,
 * the ones the editor's export and import call. The two sizes a text style's
 * size was made from with "Fluid…" travel in the file's Nextly extension, so
 * the stored class keeps them and the range change made later remakes it.
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  dtcgToTokens,
  fluidValue,
  NEXTLY_EXTENSION,
  resolveSiteTokens,
  tokensToDtcg,
  type DtcgNode,
  type NamedClass,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { ServiceContainer } from "nextly";
import { buildClaims, signAccessToken } from "nextly/auth";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { pageBuilder } from "../plugin";
import { SITE_STYLE_SLUG } from "../site-style-storage";

const ORIGIN = "http://localhost";
const CSRF = "c".repeat(64);
const SINGLE = `singles/${SITE_STYLE_SLUG}`;
const DESIGN = ["read-site-style", "update-site-style"];

type Range = { min: number; max: number };

/** The exporting site's fluid range, and the range changed to later. */
const EXPORTED_ON: Range = { min: 320, max: 1440 };
const LATER: Range = { min: 400, max: 800 };
/** The default range, which a site stating none uses. */
const DEFAULT: Range = { min: 360, max: 1280 };
const SIZES = { small: 24, large: 48 };

/** A text style whose Desktop size was made fluid across `range`. */
const titleAcross = (range: Range): NamedClass => ({
  id: "t-title",
  slug: "title",
  label: "Title",
  orderIndex: 0,
  role: "text",
  styles: { base: { base: { fontSize: fluidValue(SIZES, range) } } },
  fluidSizes: { base: SIZES },
});

/** The importing site's own text style, stored before the import. */
const OWN: NamedClass = {
  id: "t-own",
  slug: "own",
  label: "Own",
  orderIndex: 0,
  role: "text",
  styles: { base: { base: { fontSize: "18px" } } },
};

describe.each(getConfiguredTestDialects())(
  "a fluid text style imported from a design-token file (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    /** A site storing these tokens and classes, written as nobody. */
    async function site(
      tokens: Record<string, unknown>,
      classes: readonly NamedClass[]
    ): Promise<TestNextly> {
      await current?.destroy();
      current = await createTestNextly({
        dialect,
        plugins: [pageBuilder({})],
        seedPublic: true,
      });
      const t = current;
      // The site's first user is its owner, granted everything. Made first, so
      // the designer below holds only what the test gives them.
      await t.nextly.users.create({
        email: "owner@example.com",
        password: "Password123!",
        data: { name: "Owner", isActive: true },
      });
      // As nobody, which the Single's guards trust: the fixture, not the
      // behaviour under test.
      await t.nextly.updateSingle({
        slug: SITE_STYLE_SLUG,
        data: { tokens: { tokens: [], ...tokens }, classes, _overwrite: true },
        overrideAccess: true,
      });
      return t;
    }

    /** A signed-in person holding Design's read and change permissions. */
    async function designer(t: TestNextly): Promise<string> {
      const created = await t.nextly.users.create({
        email: "designer@example.com",
        password: "Password123!",
        data: { name: "Designer", isActive: true },
      });
      const userId = created.item.id;
      const permissions = await t.nextly.permissions.find({ limit: 500 });
      const ids = DESIGN.map(slug => {
        const found = permissions.items.find(item => item.slug === slug);
        if (found === undefined) throw new Error(`${slug} is not seeded`);
        return found.id;
      });
      const role = await t.nextly.roles.create({
        data: { name: "Design", slug: "design", permissionIds: ids },
      });
      const assigned = await new ServiceContainer(
        t.adapter
      ).userRoles.assignRoleToUser(userId, role.item.id);
      expect(assigned.success).toBe(true);
      const token = await signAccessToken(
        buildClaims({
          userId,
          email: created.item.email,
          name: "Designer",
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? ""
      );
      return `nextly_session=${token}`;
    }

    /** One write of the Single through the real dispatcher, as the editor makes it. */
    async function patch(cookie: string, body: unknown): Promise<number> {
      const params = SINGLE.split("/");
      const response = await createDynamicHandlers().PATCH(
        new Request(`${ORIGIN}/api/${SINGLE}`, {
          method: "PATCH",
          headers: {
            cookie: `${cookie}; nextly_csrf=${CSRF}`,
            "x-csrf-token": CSRF,
            origin: ORIGIN,
            "content-type": "application/json",
          },
          body: JSON.stringify({ ...(body as object), _overwrite: true }),
        }),
        { params: Promise.resolve({ params }) }
      );
      await response.text();
      return response.status;
    }

    /** The stored tokens and classes, as the database hands them back. */
    async function stored(t: TestNextly): Promise<{
      tokens: Record<string, unknown>;
      classes: NamedClass[];
    }> {
      const doc = (await t.nextly.findSingle({
        slug: SITE_STYLE_SLUG,
        overrideAccess: true,
      })) as Record<string, unknown>;
      // SQLite stores a JSON column as text; the others hand back values.
      const read = (raw: unknown): unknown =>
        typeof raw === "string" ? JSON.parse(raw) : raw;
      return {
        tokens: (read(doc.tokens) ?? {}) as Record<string, unknown>,
        classes: (read(doc.classes) ?? []) as NamedClass[],
      };
    }

    /** The design-token file a site writes from what it stores. */
    async function exported(t: TestNextly): Promise<DtcgNode> {
      const { tokens, classes } = await stored(t);
      const made = tokensToDtcg(resolveSiteTokens(tokens as SiteTokenSet), {
        textStyles: classes,
      });
      return JSON.parse(JSON.stringify(made.document)) as DtcgNode;
    }

    /**
     * A file imported as the editor's import stores it: the file's fluid
     * range with the site's tokens first, then its text styles added after
     * the site's classes, each step one write of the Single.
     */
    async function imported(
      t: TestNextly,
      cookie: string,
      file: DtcgNode
    ): Promise<string[]> {
      const read = dtcgToTokens(file);
      const now = await stored(t);
      const range = read.site?.fluidRange;
      if (range !== undefined) {
        expect(
          await patch(cookie, { tokens: { ...now.tokens, fluidRange: range } })
        ).toBe(200);
      }
      const added = (read.textStyles ?? []).map((style, at) => ({
        ...style,
        orderIndex: now.classes.length + at,
      }));
      expect(await patch(cookie, { classes: [...now.classes, ...added] })).toBe(
        200
      );
      return read.issues.map(entry => entry.message);
    }

    /** The stored title, with its Desktop size. */
    const titleIn = (classes: readonly NamedClass[]) => {
      const title = classes.find(entry => entry.id === "t-title");
      return {
        size: title?.styles.base?.base?.fontSize,
        fluidSizes: title?.fluidSizes,
      };
    };

    it("stores the imported style with its fluid sizes, and a later range change remakes it", async () => {
      const from = await site({ fluidRange: EXPORTED_ON }, [
        titleAcross(EXPORTED_ON),
      ]);
      const file = await exported(from);
      const t = await site({}, [OWN]);
      const cookie = await designer(t);

      expect(await imported(t, cookie, file)).toEqual([]);
      const after = await stored(t);
      expect(after.tokens.fluidRange).toEqual(EXPORTED_ON);
      expect(titleIn(after.classes)).toEqual({
        size: fluidValue(SIZES, EXPORTED_ON),
        fluidSizes: { base: SIZES },
      });

      expect(
        await patch(cookie, {
          tokens: { ...after.tokens, fluidRange: LATER },
        })
      ).toBe(200);
      expect(titleIn((await stored(t)).classes)).toEqual({
        size: fluidValue(SIZES, LATER),
        fluidSizes: { base: SIZES },
      });
    });

    it("makes a style from a site on the default range follow the importing site's own range", async () => {
      const from = await site({}, [titleAcross(DEFAULT)]);
      const file = await exported(from);
      const own: Range = { min: 400, max: 960 };
      const t = await site({ fluidRange: own }, [OWN]);
      const cookie = await designer(t);

      expect(await imported(t, cookie, file)).toEqual([]);
      const after = await stored(t);
      // The file states no range, so the site keeps its own, and the save
      // makes the new sizes' clamp across it, as the editor's import does.
      expect(after.tokens.fluidRange).toEqual(own);
      expect(titleIn(after.classes)).toEqual({
        size: fluidValue(SIZES, own),
        fluidSizes: { base: SIZES },
      });

      expect(
        await patch(cookie, {
          tokens: { ...after.tokens, fluidRange: LATER },
        })
      ).toBe(200);
      expect(titleIn((await stored(t)).classes).size).toBe(
        fluidValue(SIZES, LATER)
      );
    });

    it("stores a size its fluid sizes don't make as it is, without them, and a range change leaves it", async () => {
      const from = await site({ fluidRange: EXPORTED_ON }, [
        titleAcross(EXPORTED_ON),
      ]);
      const file = await exported(from);
      // The file edited by hand: a size typed beside the sizes.
      const own = (file.$extensions as DtcgNode)[NEXTLY_EXTENSION] as DtcgNode;
      const kept = (own.textStyles as DtcgNode[])[0] as DtcgNode;
      kept.styles = { base: { base: { fontSize: "2.5rem" } } };
      const t = await site({}, [OWN]);
      const cookie = await designer(t);

      expect(await imported(t, cookie, file)).toHaveLength(1);
      const after = await stored(t);
      expect(titleIn(after.classes)).toEqual({
        size: "2.5rem",
        fluidSizes: undefined,
      });

      expect(
        await patch(cookie, {
          tokens: { ...after.tokens, fluidRange: LATER },
        })
      ).toBe(200);
      expect(titleIn((await stored(t)).classes).size).toBe("2.5rem");
    });
  }
);
