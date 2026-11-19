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
 *
 * A text style the site's CODE makes fluid follows the range too, with
 * nothing stored: the merge makes it again across the range the site stores,
 * on the published page, and a save of the class list stores no override of
 * it. Locked, it follows all the same, since nothing the site stores moves.
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { fluidValue, type NamedClass } from "@nextlyhq/blocks-engine";
import { createBlockResolver } from "@nextlyhq/blocks-react";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { createPublicBlocksPage } from "@nextlyhq/blocks-react/next";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { ServiceContainer } from "nextly";
import { buildClaims, signAccessToken } from "nextly/auth";
import { createDynamicHandlers } from "nextly/runtime";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { pageBuilder } from "../plugin";
import {
  classOverrideOf,
  configuredClassesAt,
  resolveSiteStyle,
  type SiteStyleData,
} from "../site-style";
import { loadSiteStyle } from "../site-style-load";
import { mergeSiteStyleSection } from "../site-style-merge";
import { readSiteStyleRecord } from "../site-style-record";
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

/** The sizes the code's text style was made fluid from. */
const CODE_SIZES = { small: 20, large: 40 };

/** A text style the site's code supplies, its Desktop size made fluid across the code's range. */
const CODE_FLUID = {
  id: "t-code-fluid",
  slug: "code-fluid",
  label: "Code fluid",
  orderIndex: 3,
  role: "text",
  styles: { base: { base: { fontSize: fluidValue(CODE_SIZES, OLD) } } },
  fluidSizes: { base: CODE_SIZES },
} as NamedClass;

/** A host's code: its breakpoints and the code's fluid text style. */
const codeSite = (style: NamedClass = CODE_FLUID): SiteStyleData => ({
  breakpoints: { viewport: [{ id: "base", label: "Desktop" }], container: [] },
  classes: [style],
});

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

    /** A size typed by hand over a fluid one: a clamp no range makes from its sizes. */
    const TYPED = "clamp(1rem, 2vw, 3rem)";

    /** One stored class, by id. */
    const entryOf = (
      classes: Record<string, unknown>[],
      id: string
    ): Record<string, unknown> | undefined =>
      classes.find(entry => entry.id === id);

    /**
     * The stored classes with Lead's Desktop size set to `size` and every
     * other key, its fluid sizes among them, as stored: a class write as an
     * API client might send it.
     */
    const withLeadSize = (
      classes: Record<string, unknown>[],
      size: unknown
    ): Record<string, unknown>[] =>
      classes.map(entry =>
        entry.id === "t-lead"
          ? { ...entry, styles: { base: { base: { fontSize: size } } } }
          : entry
      );

    it("drops a size's fluid sizes when a classes write changes the size beside them, keeping the size", async () => {
      const t = await boot();
      const designer = await holding(t, ...DESIGN);
      const before = await stored(t);
      const plainBefore = classText(before.classes, "t-plain");
      const saved = await patch(designer, {
        classes: withLeadSize(before.classes, "20px"),
        _overwrite: true,
      });
      expect(saved.status).toBe(200);
      const after = await stored(t);
      expect(Number(after.rev)).toBe(Number(before.rev) + 1);
      expect(sizeOf(after.classes, "t-lead")).toBe("20px");
      expect(entryOf(after.classes, "t-lead")).not.toHaveProperty("fluidSizes");
      expect(classText(after.classes, "t-plain")).toBe(plainBefore);
    });

    it("keeps a typed clamp on a copy of the style, with no fluid sizes beside it", async () => {
      const t = await boot();
      const designer = await holding(t, ...DESIGN);
      // The size typed by hand over the fluid one.
      const typed = await patch(designer, {
        classes: withLeadSize((await stored(t)).classes, TYPED),
        _overwrite: true,
      });
      expect(typed.status).toBe(200);
      // Then duplicated: the copy carries every key the stored style has.
      const read = (await stored(t)).classes;
      const lead = entryOf(read, "t-lead") ?? {};
      const copy = {
        ...lead,
        id: "t-lead-copy",
        slug: "lead-copy",
        label: "Lead copy",
        orderIndex: 2,
      };
      const duplicated = await patch(designer, {
        classes: [...read, copy],
        _overwrite: true,
      });
      expect(duplicated.status).toBe(200);
      const after = await stored(t);
      expect(sizeOf(after.classes, "t-lead")).toBe(TYPED);
      expect(sizeOf(after.classes, "t-lead-copy")).toBe(TYPED);
      expect(entryOf(after.classes, "t-lead")).not.toHaveProperty("fluidSizes");
      expect(entryOf(after.classes, "t-lead-copy")).not.toHaveProperty(
        "fluidSizes"
      );
    });

    it("keeps a typed clamp through a change of the range", async () => {
      const t = await boot();
      const designer = await holding(t, ...DESIGN);
      expect(
        (
          await patch(designer, {
            classes: withLeadSize((await stored(t)).classes, TYPED),
            _overwrite: true,
          })
        ).status
      ).toBe(200);
      expect(entryOf((await stored(t)).classes, "t-lead")).not.toHaveProperty(
        "fluidSizes"
      );
      expect(
        (await patch(designer, { tokens: tokensAcross(NEW), _overwrite: true }))
          .status
      ).toBe(200);
      const after = await stored(t);
      expect(sizeOf(after.classes, "t-lead")).toBe(TYPED);
      expect(entryOf(after.classes, "t-lead")).not.toHaveProperty("fluidSizes");
    });

    it("keeps the fluid sizes of a size the same write's range change makes again", async () => {
      // Stored with fluid sizes beside a size typed before they were dropped.
      const t = await boot({
        ...LEAD,
        styles: { base: { base: { fontSize: "24px" } } },
      });
      const designer = await holding(t, ...DESIGN);
      // One save: the new range, and Lead's size made from its sizes across
      // the old one, which the range change makes again across the new one.
      const read = (await stored(t)).classes;
      const saved = await patch(designer, {
        tokens: tokensAcross(NEW),
        classes: withLeadSize(read, fluidValue(SIZES, OLD)),
        _overwrite: true,
      });
      expect(saved.status).toBe(200);
      const after = await stored(t);
      expect(sizeOf(after.classes, "t-lead")).toBe(fluidValue(SIZES, NEW));
      expect(entryOf(after.classes, "t-lead")).toMatchObject({
        fluidSizes: { base: SIZES },
      });
    });

    it("keeps the fluid sizes of a size sent already made across the range the same write sets", async () => {
      const t = await boot();
      const designer = await holding(t, ...DESIGN);
      const read = (await stored(t)).classes;
      const saved = await patch(designer, {
        tokens: tokensAcross(NEW),
        classes: withLeadSize(read, fluidValue(SIZES, NEW)),
        _overwrite: true,
      });
      expect(saved.status).toBe(200);
      const after = await stored(t);
      expect(sizeOf(after.classes, "t-lead")).toBe(fluidValue(SIZES, NEW));
      expect(entryOf(after.classes, "t-lead")).toMatchObject({
        fluidSizes: { base: SIZES },
      });
    });

    /** A published page whose heading wears the code's fluid text style. */
    async function publishCodeStyledPage(t: TestNextly): Promise<void> {
      await t.nextly.create({
        collection: "pages",
        data: {
          title: "Fluid",
          slug: "fluid",
          content: {
            formatVersion: 1,
            kind: "page",
            nodes: [
              {
                id: "fluid-h",
                type: "core/heading",
                version: 1,
                props: { text: "Fluid heading", level: "h2" },
                classes: [CODE_FLUID.id],
              },
            ],
          },
          status: "published",
        },
        overrideAccess: true,
      });
    }

    /** The CSS of the published page, as a visitor is served it. */
    async function publishedCss(
      t: TestNextly,
      defaults: SiteStyleData
    ): Promise<string> {
      const route = createPublicBlocksPage({
        collections: ["pages"],
        field: "content",
        nextly: t.nextly as never,
        blocks: createBlockResolver(coreBlocks),
        styleContext: { breakpoints: defaults.breakpoints },
        siteStyles: {
          read: () => loadSiteStyle({ nextly: t.nextly, defaults }),
          singles: [SITE_STYLE_SLUG],
        },
      });
      const element = (await route.ContentPage({
        params: { slug: ["fluid"] },
      })) as ReactElement;
      const stream = await renderToReadableStream(element, {
        onError(error) {
          throw error;
        },
      });
      await stream.allReady;
      const html = await new Response(stream).text();
      return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
        .map(match => match[1])
        .join("\n");
    }

    /** The code style's Desktop size in the site style the published route loads. */
    async function loadedCodeSize(
      t: TestNextly,
      defaults: SiteStyleData
    ): Promise<unknown> {
      const style = await loadSiteStyle({ nextly: t.nextly, defaults });
      return sizeOf(
        (style.classes ?? []) as unknown as Record<string, unknown>[],
        CODE_FLUID.id
      );
    }

    it("makes a text style the code made fluid follow a range change on the published page, storing nothing for it", async () => {
      const code = codeSite();
      const t = await boot(LEAD, { siteStyle: code });
      const designer = await holding(t, ...DESIGN);
      await publishCodeStyledPage(t);
      expect(await publishedCss(t, code)).toContain(
        fluidValue(CODE_SIZES, OLD)
      );
      const before = await stored(t);

      const saved = await patch(designer, {
        tokens: tokensAcross(NEW),
        _overwrite: true,
      });
      expect(saved.status).toBe(200);

      const after = await stored(t);
      // Nothing of the code's style is stored: the stored classes are the
      // site's own two, as before.
      expect(entryOf(after.classes, CODE_FLUID.id)).toBeUndefined();
      expect(after.classes.map(entry => entry.id)).toEqual(
        before.classes.map(entry => entry.id)
      );
      // The page draws it across the new range, and no longer the old.
      expect(await loadedCodeSize(t, code)).toBe(fluidValue(CODE_SIZES, NEW));
      const css = await publishedCss(t, code);
      expect(css).toContain(fluidValue(CODE_SIZES, NEW));
      expect(css).not.toContain(fluidValue(CODE_SIZES, OLD));
    });

    it("stores no override of the code's fluid text style when the class list is next saved", async () => {
      const code = codeSite();
      const t = await boot(LEAD, { siteStyle: code });
      const designer = await holding(t, ...DESIGN);
      expect(
        (await patch(designer, { tokens: tokensAcross(NEW), _overwrite: true }))
          .status
      ).toBe(200);
      // The editor's next class-list save: a new style made beside the
      // library it draws, the code's style across the new range in it, and
      // only what differs from the code stored.
      const doc = await t.nextly.findSingle({
        slug: SITE_STYLE_SLUG,
        overrideAccess: true,
      });
      const drawn = resolveSiteStyle(code, readSiteStyleRecord(doc));
      const next = [
        ...(drawn.classes ?? []),
        { ...PLAIN, id: "t-new", slug: "new", label: "New", orderIndex: 4 },
      ] as NamedClass[];
      // Compared with the code's own clamp, the drawn style would read as
      // the site's edit: the case the derived code classes exist for.
      expect(
        classOverrideOf(code.classes, next).map(entry => entry.id)
      ).toContain(CODE_FLUID.id);
      const tier = classOverrideOf(
        configuredClassesAt(code, drawn.tokens),
        next
      );
      expect(
        (await patch(designer, { classes: tier, _overwrite: true })).status
      ).toBe(200);
      const after = await stored(t);
      expect(entryOf(after.classes, CODE_FLUID.id)).toBeUndefined();
      expect(entryOf(after.classes, "t-new")).toBeDefined();
      expect(await loadedCodeSize(t, code)).toBe(fluidValue(CODE_SIZES, NEW));
    });

    it("lets the range change when a locked text style the code made fluid follows it", async () => {
      const code = codeSite({ ...CODE_FLUID, locked: true } as NamedClass);
      const t = await boot(LEAD, { siteStyle: code });
      const designer = await holding(t, ...DESIGN);
      const before = await stored(t);
      const saved = await patch(designer, {
        tokens: tokensAcross(NEW),
        _overwrite: true,
      });
      // Not refused: the lock guards the site's edits, and nothing the site
      // stores moves for the code's style.
      expect(saved.status).toBe(200);
      const after = await stored(t);
      expect(Number(after.rev)).toBe(Number(before.rev) + 1);
      expect(entryOf(after.classes, CODE_FLUID.id)).toBeUndefined();
      expect(await loadedCodeSize(t, code)).toBe(fluidValue(CODE_SIZES, NEW));
      // And the next class-list save, which stores no override of it, is
      // not refused by the lock: a locked entry written outside the lock's
      // route would be.
      const drawn = resolveSiteStyle(
        code,
        readSiteStyleRecord(
          await t.nextly.findSingle({
            slug: SITE_STYLE_SLUG,
            overrideAccess: true,
          })
        )
      );
      const next = (drawn.classes ?? []).map(entry =>
        entry.id === "t-plain" ? { ...entry, label: "Plain text" } : entry
      );
      const tier = classOverrideOf(
        configuredClassesAt(code, drawn.tokens),
        next
      );
      expect(
        (await patch(designer, { classes: tier, _overwrite: true })).status
      ).toBe(200);
      expect(entryOf((await stored(t)).classes, CODE_FLUID.id)).toBeUndefined();
    });
  }
);
