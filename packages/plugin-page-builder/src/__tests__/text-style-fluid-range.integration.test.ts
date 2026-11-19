/**
 * A text style's fluid size following a change of the site's fluid range, on
 * a real site, through the Single's own write as the editor makes it.
 *
 * The range lives in the tokens section and a text style in the classes
 * section, so the write that changes the range has to make the text style's
 * size again in that same write: one stored version, the same
 * `update-site-style` permission, nothing for a class without fluid sizes,
 * nothing on a save that leaves the range alone, and nothing at all when a
 * locked text style follows the range.
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { fluidValue } from "@nextlyhq/blocks-engine";
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
import { classOverrideOf } from "../site-style";
import { mergeSiteStyleSection } from "../site-style-merge";
import { SITE_STYLE_SLUG } from "../site-style-storage";

const ORIGIN = "http://localhost";
const CSRF = "c".repeat(64);
const SINGLE = `singles/${SITE_STYLE_SLUG}`;
const DESIGN = ["read-site-style", "update-site-style"];

const OLD = { min: 360, max: 1280 };
const NEW = { min: 400, max: 800 };
const SIZES = { small: 16, large: 32 };

/** A fluid type size, as "Fluid…" makes one. */
const fluidToken = (range: { min: number; max: number }) => ({
  id: "t-display",
  name: "font-size.display",
  label: "Display",
  kind: "dimension",
  values: { light: fluidValue(SIZES, range) },
  fluid: SIZES,
});

/** The tokens section across a range: the fluid variable and Site text row made across it. */
const tokensAcross = (range: { min: number; max: number }) => ({
  tokens: [fluidToken(range)],
  fluidRange: range,
  siteText: {
    h2: { fontSize: fluidValue(SIZES, range), fluid: SIZES, lineHeight: 1.1 },
  },
});

/** A text style whose Desktop size was made fluid across the old range. */
const LEAD = {
  id: "t-lead",
  slug: "lead",
  label: "Lead",
  orderIndex: 0,
  role: "text",
  styles: { base: { base: { fontSize: fluidValue(SIZES, OLD) } } },
  fluidSizes: { base: SIZES },
};

/** A text style stored before fluid sizes existed. */
const PLAIN = {
  id: "t-plain",
  slug: "plain",
  label: "Plain",
  orderIndex: 1,
  role: "text",
  styles: { base: { base: { fontSize: "18px", lineHeight: 1.4 } } },
};

describe.each(getConfiguredTestDialects())(
  "a text style's fluid size and the site's fluid range (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    /** A site storing the old range, a fluid text style and a plain one. */
    async function boot(
      lead: Record<string, unknown> = LEAD,
      config: Parameters<typeof pageBuilder>[0] = {}
    ) {
      current = await createTestNextly({
        dialect,
        plugins: [pageBuilder(config)],
        seedPublic: true,
      });
      const t = current;
      // The site's first user is its owner, granted everything. Made first, so
      // every person below holds only what the test gives them.
      await t.nextly.users.create({
        email: "owner@example.com",
        password: "Password123!",
        data: { name: "Owner", isActive: true },
      });
      // As nobody, which the Single's guards trust: the fixture, not the
      // behaviour under test.
      await t.nextly.updateSingle({
        slug: SITE_STYLE_SLUG,
        data: {
          tokens: tokensAcross(OLD),
          classes: [lead, PLAIN],
          _overwrite: true,
        },
        overrideAccess: true,
      });
      return t;
    }

    let people = 0;
    let roles = 0;

    /** A signed-in person holding exactly the permissions named. */
    async function holding(t: TestNextly, ...slugs: string[]): Promise<string> {
      people += 1;
      const created = await t.nextly.users.create({
        email: `fluid-${people}@example.com`,
        password: "Password123!",
        data: { name: `Person ${people}`, isActive: true },
      });
      const userId = created.item.id;
      const permissions = await t.nextly.permissions.find({ limit: 500 });
      const ids = slugs.map(slug => {
        const found = permissions.items.find(item => item.slug === slug);
        if (found === undefined) throw new Error(`${slug} is not seeded`);
        return found.id;
      });
      roles += 1;
      const role = await t.nextly.roles.create({
        data: {
          name: `Fluid ${roles}`,
          slug: `f-${roles}`,
          permissionIds: ids,
        },
      });
      const assigned = await new ServiceContainer(
        t.adapter
      ).userRoles.assignRoleToUser(userId, role.item.id);
      expect(assigned.success).toBe(true);
      const token = await signAccessToken(
        buildClaims({
          userId,
          email: created.item.email,
          name: `Person ${people}`,
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? ""
      );
      return `nextly_session=${token}`;
    }

    /** One write of the Single through the real dispatcher, as the editor makes it. */
    async function patch(
      cookie: string,
      body: unknown
    ): Promise<{ status: number; body: Record<string, unknown> }> {
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
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ params }) }
      );
      const text = await response.text();
      return {
        status: response.status,
        body: (text === "" ? {} : JSON.parse(text)) as Record<string, unknown>,
      };
    }

    /** The stored document, each section as the database hands it back. */
    async function stored(t: TestNextly): Promise<{
      rev: unknown;
      tokens: string;
      classes: Record<string, unknown>[];
      classesText: string;
    }> {
      const doc = (await t.nextly.findSingle({
        slug: SITE_STYLE_SLUG,
        overrideAccess: true,
      })) as Record<string, unknown>;
      // SQLite stores a JSON column as text; the others hand back values.
      const read = (raw: unknown): unknown =>
        typeof raw === "string" ? JSON.parse(raw) : raw;
      const classes = read(doc.classes) as Record<string, unknown>[];
      return {
        rev: doc._rev,
        tokens: JSON.stringify(read(doc.tokens)),
        classes,
        classesText: JSON.stringify(classes),
      };
    }

    /** One stored class, by id, as text: byte for byte as stored. */
    const classText = (
      classes: Record<string, unknown>[],
      id: string
    ): string => JSON.stringify(classes.find(entry => entry.id === id));

    /** A stored class's Desktop size. */
    const sizeOf = (classes: Record<string, unknown>[], id: string): unknown =>
      (
        classes.find(entry => entry.id === id) as
          | { styles: { base: { base: { fontSize: unknown } } } }
          | undefined
      )?.styles.base.base.fontSize;

    it("remakes a fluid text style in the one write that changes the range, leaving a plain one as it was", async () => {
      const t = await boot();
      const designer = await holding(t, ...DESIGN);
      const before = await stored(t);
      const plainBefore = classText(before.classes, "t-plain");

      const saved = await patch(designer, {
        tokens: tokensAcross(NEW),
        _overwrite: true,
      });
      expect(saved.status).toBe(200);

      const after = await stored(t);
      // One write: the version moved by exactly one, and that version holds
      // the classes made again.
      expect(Number(after.rev)).toBe(Number(before.rev) + 1);
      expect(sizeOf(after.classes, "t-lead")).toBe(fluidValue(SIZES, NEW));
      expect(
        (
          after.classes.find(entry => entry.id === "t-lead") as {
            fluidSizes?: unknown;
          }
        ).fluidSizes
      ).toEqual({ base: SIZES });
      expect(classText(after.classes, "t-plain")).toBe(plainBefore);
    });

    it("leaves the classes alone on a save of another field", async () => {
      const t = await boot();
      const designer = await holding(t, ...DESIGN);
      const before = await stored(t);
      const saved = await patch(designer, { fonts: [], _overwrite: true });
      expect(saved.status).toBe(200);
      const after = await stored(t);
      expect(Number(after.rev)).toBe(Number(before.rev) + 1);
      expect(after.classesText).toBe(before.classesText);
    });

    it("remakes nothing when the same range is saved again", async () => {
      const t = await boot();
      const designer = await holding(t, ...DESIGN);
      const body = { tokens: tokensAcross(NEW), _overwrite: true };
      expect((await patch(designer, body)).status).toBe(200);
      const first = await stored(t);
      expect((await patch(designer, body)).status).toBe(200);
      const second = await stored(t);
      expect(second.classesText).toBe(first.classesText);
      expect(sizeOf(second.classes, "t-lead")).toBe(fluidValue(SIZES, NEW));
    });

    it("refuses a range change to a role that may read Design but not change it, and stores nothing", async () => {
      const t = await boot();
      const reader = await holding(t, "read-site-style");
      const before = await stored(t);
      const refused = await patch(reader, {
        tokens: tokensAcross(NEW),
        _overwrite: true,
      });
      expect(refused.status).toBe(403);
      const after = await stored(t);
      expect(after.tokens).toBe(before.tokens);
      expect(after.classesText).toBe(before.classesText);
    });

    it("makes a size made fluid under the old range again when its save lands after a range change", async () => {
      const t = await boot();
      const designer = await holding(t, ...DESIGN);
      const made = { small: 14, large: 28 };
      // Designer A reads the classes and makes Plain fluid under the old range.
      const read = await stored(t);
      const mine = read.classes.map(entry =>
        entry.id === "t-plain"
          ? {
              ...entry,
              styles: { base: { base: { fontSize: fluidValue(made, OLD) } } },
              fluidSizes: { base: made },
            }
          : entry
      );
      // Designer B saves the new range first.
      expect(
        (await patch(designer, { tokens: tokensAcross(NEW), _overwrite: true }))
          .status
      ).toBe(200);
      // A's save is refused as stale, read again and merged onto B's, and
      // sent with the classes alone, as the editor's retry sends it.
      const theirs = (await stored(t)).classes;
      const retry = mergeSiteStyleSection(
        "classes",
        read.classes,
        mine,
        theirs,
        "mine"
      ).value;
      expect(
        (await patch(designer, { classes: retry, _overwrite: true })).status
      ).toBe(200);
      const after = await stored(t);
      expect(sizeOf(after.classes, "t-plain")).toBe(fluidValue(made, NEW));
      expect(sizeOf(after.classes, "t-lead")).toBe(fluidValue(SIZES, NEW));
    });

    it("refuses a range change a locked fluid text style follows, naming it, and stores nothing", async () => {
      const t = await boot({ ...LEAD, locked: true });
      const designer = await holding(t, ...DESIGN);
      const before = await stored(t);
      const refused = await patch(designer, {
        tokens: tokensAcross(NEW),
        _overwrite: true,
      });
      expect(refused.status).toBe(409);
      const said = JSON.stringify(refused.body);
      expect(said).toContain("The fluid range wasn't changed");
      expect(said).toContain("the text style Lead is locked");
      expect(said).toContain("Unlock it first");
      // No partial write: the range, the variables, Site text and the classes
      // are all as they were.
      const after = await stored(t);
      expect(after.rev).toBe(before.rev);
      expect(after.tokens).toBe(before.tokens);
      expect(after.classesText).toBe(before.classesText);
    });

    it("stores the sizes alone for a text style the site's code supplies, and the size then follows the range", async () => {
      // The code's text style already holds the clamp "Fluid…" makes, so the
      // sizes are the whole edit the author saves.
      const configured = {
        id: "t-code-lead",
        slug: "code-lead",
        label: "Code lead",
        orderIndex: 2,
        role: "text" as const,
        styles: { base: { base: { fontSize: fluidValue(SIZES, OLD) } } },
      };
      const t = await boot(LEAD, { siteStyle: { classes: [configured] } });
      const designer = await holding(t, ...DESIGN);
      const before = await stored(t);
      // What the editor saves: the stored tier the edited library leaves,
      // the code's entries dropped where unchanged.
      const edited = [
        ...before.classes,
        { ...configured, fluidSizes: { base: SIZES } },
      ] as Parameters<typeof classOverrideOf>[1];
      const tier = classOverrideOf([configured], edited);
      const saved = await patch(designer, { classes: tier, _overwrite: true });
      expect(saved.status).toBe(200);
      const kept = await stored(t);
      expect(
        kept.classes.find(entry => entry.id === "t-code-lead")
      ).toMatchObject({ fluidSizes: { base: SIZES } });

      expect(
        (
          await patch(designer, {
            tokens: tokensAcross(NEW),
            _overwrite: true,
          })
        ).status
      ).toBe(200);
      expect(sizeOf((await stored(t)).classes, "t-code-lead")).toBe(
        fluidValue(SIZES, NEW)
      );
    });
  }
);
