/**
 * Importing a transfer file, against real instances, through Nextly's own
 * request handler with a signed session.
 *
 * What only a server shows: that a file exported from one site reproduces its
 * item in another, image and all; that each kind of clash is settled by the
 * choice made for it and leaves every existing item and page as it was; that
 * a file breaking a lock or making a loop is refused before anything is
 * written, media included; that a block type the site lacks refuses the import
 * until the site has it; that breakpoints map by exact width and nothing else;
 * that a changed site makes a stale preview unusable; that retired exposure
 * ids are stripped on the way in; and that an imported Layout never becomes
 * the site's default.
 *
 * @module __tests__/transfer-import.integration.test
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  COMPONENT_INSTANCE_TYPE,
  hasBlock,
  registerBlocks,
  type BlockNode,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";
import { definePlugin } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { COMPONENTS_SLUG } from "../collections/components";
import { LAYOUTS_SLUG } from "../collections/layouts";
import { PATTERNS_SLUG } from "../collections/patterns";
import { readLayoutSettings } from "../default-layout/store";
import { PAGE_BUILDER_SETTINGS_SLUG } from "../default-layout/settings-single";
import { pageBuilder } from "../plugin";
import { TRANSFER_JUDGEMENT_CONTEXT } from "../transfer/transfer-contract";
import { SITE_STYLE_SLUG } from "../site-style-storage";
import type {
  ImportChoices,
  ImportPreview,
  ImportResult,
  TransferFile,
} from "../transfer/transfer-contract";

import {
  created,
  holding,
  person,
  PNG,
  post,
  READS_EVERYTHING,
  SOURCE_BREAKPOINTS,
  sourceSite,
  unique,
  type SourceSite,
} from "./transfer-harness";

/** Everything an import of the source site's items writes. */
const WRITES_EVERYTHING = [
  ...READS_EVERYTHING,
  "create-components",
  "create-patterns",
  "create-layouts",
  "publish-components",
  "publish-patterns",
  "publish-layouts",
  "update-site-style",
  "create-media",
  "update-media",
];

/** A second PNG, other bytes under the same name. */
const OTHER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

/** A block a destination lacks until "its plugin" registers it. */
const WIDGET = "acme/transfer-widget";

/** A block whose only slot is locked `all` around two headings. */
const SEALED = "acme/transfer-sealed";

function registerSealed(): void {
  if (hasBlock(SEALED)) return;
  registerBlocks(
    [
      {
        name: SEALED,
        version: 1,
        description: "A block.",
        example: { props: {} },
        render: () => null,
        slots: {
          body: {
            defaultBlock: [
              { type: "core/heading", props: { text: "One", level: "h2" } },
              { type: "core/heading", props: { text: "Two", level: "h2" } },
            ],
            lock: "all",
          },
        },
      },
    ] as never,
    { source: "acme" }
  );
}

function registerWidget(): void {
  if (hasBlock(WIDGET)) return;
  registerBlocks(
    [
      {
        name: WIDGET,
        version: 1,
        description: "A block.",
        example: { props: {} },
        render: () => null,
      },
    ] as never,
    { source: "acme" }
  );
}

function heading(id: string): BlockNode {
  return {
    id,
    type: "core/heading",
    version: 1,
    props: { text: id, level: "h2" },
  };
}

/** A hand-made file holding one component per document given, the first the root. */
function fileOf(
  components: { id: string; nodes: BlockNode[] }[],
  extra: Partial<TransferFile> = {}
): TransferFile {
  return {
    format: "nextly-page-builder-transfer",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    root: { kind: "component", id: components[0]?.id ?? "" },
    components: components.map(entry => ({
      id: entry.id,
      title: `Imported ${entry.id}`,
      slug: unique(entry.id),
      status: "published",
      content: { formatVersion: 1, kind: "component", nodes: entry.nodes },
    })),
    patterns: [],
    layouts: [],
    classes: [],
    tokens: [],
    breakpoints: [],
    media: [],
    blockTypes: [],
    ...extra,
  };
}

/** Whether each component create a hook saw was an import's judging write. */
const judged: boolean[] = [];

/** Set to refuse every site-style write that changes breakpoints. */
const refuse = { breakpoints: false };

/** Set to have "another save" empty the shared styles right after one is written. */
const overwrite: { classes: boolean; site?: TestNextly } = { classes: false };

/**
 * Set to have "another save" of the site style land just before the import's
 * first site-style write: after the import read the style, before its write
 * is made.
 */
const interleave = { beforeStyleWrite: false };

/** A plugin recording, for every component create, whether it was judged. */
const recorder = definePlugin({
  name: "@t/transfer-recorder",
  version: "1.0.0",
  nextly: ">=0.0.0",
  init(ctx) {
    ctx.hooks.on("afterCreate", "components", hook => {
      const context = (hook as { context?: Record<string, unknown> }).context;
      judged.push(context?.[TRANSFER_JUDGEMENT_CONTEXT] === true);
    });
    ctx.hooks.on("afterUpdate", `single:${SITE_STYLE_SLUG}`, async () => {
      if (!overwrite.classes) return;
      overwrite.classes = false;
      await overwrite.site?.nextly.updateSingle({
        slug: SITE_STYLE_SLUG,
        data: { classes: [], _overwrite: true },
        overrideAccess: true,
      });
    });
    ctx.hooks.on("beforeUpdate", `single:${SITE_STYLE_SLUG}`, async hook => {
      const data = (hook as { data?: Record<string, unknown> }).data;
      if (refuse.breakpoints && data?.breakpoints !== undefined) {
        throw new Error("This site refuses breakpoint changes.");
      }
      if (interleave.beforeStyleWrite) {
        interleave.beforeStyleWrite = false;
        await overwrite.site?.nextly.updateSingle({
          slug: SITE_STYLE_SLUG,
          data: { classes: [], _overwrite: true },
          overrideAccess: true,
        });
      }
      return data;
    });
  },
});

describe.each(getConfiguredTestDialects())(
  "importing a transfer file (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(): Promise<TestNextly> {
      await current?.destroy();
      current = await createTestNextly({
        dialect,
        plugins: [pageBuilder(), recorder],
        seedPublic: true,
      });
      judged.length = 0;
      refuse.breakpoints = false;
      overwrite.classes = false;
      interleave.beforeStyleWrite = false;
      overwrite.site = current;
      // The instance's first user is its super admin, so it is made here and
      // never acts: every author below holds only what it is granted.
      await person(current, "owner");
      return current;
    }

    /** A source site's item, exported, the source then shut down. */
    async function exported(
      kind: "patterns" | "components" | "layouts",
      pick: (site: SourceSite) => string
    ): Promise<{ file: TransferFile; site: SourceSite }> {
      const t = await boot();
      const site = await sourceSite(t);
      const { cookie } = await holding(t, READS_EVERYTHING);
      const answer = await post(cookie, [
        "transfer",
        kind,
        pick(site),
        "export",
      ]);
      expect(answer.status).toBe(200);
      return { file: answer.body as unknown as TransferFile, site };
    }

    async function preview(
      cookie: string,
      file: TransferFile,
      choices: ImportChoices = {}
    ): Promise<ImportPreview> {
      const answer = await post(cookie, ["transfer", "import"], {
        file,
        choices,
        dryRun: true,
      });
      expect(answer.status).toBe(200);
      return (answer.body.item as ImportResult).preview;
    }

    async function apply(
      cookie: string,
      file: TransferFile,
      choices: ImportChoices = {}
    ): Promise<{
      status: number;
      body: Record<string, unknown>;
      result: ImportResult;
    }> {
      const seen = await preview(cookie, file, choices);
      const answer = await post(cookie, ["transfer", "import"], {
        file,
        choices,
        expect: seen.fingerprint,
      });
      return { ...answer, result: answer.body.item as ImportResult };
    }

    async function rows(t: TestNextly, collection: string) {
      const found = await t.nextly.find({
        collection,
        overrideAccess: true,
        status: "all",
        limit: 200,
        depth: 0,
        sort: ["id"],
      });
      return found.items as unknown as Record<string, unknown>[];
    }

    async function row(t: TestNextly, collection: string, id: string) {
      return (await t.nextly.findByID({
        collection,
        id,
        overrideAccess: true,
        status: "all",
        depth: 0,
      })) as unknown as Record<string, unknown>;
    }

    async function siteStyle(t: TestNextly) {
      return (await t.nextly.findSingle({
        slug: SITE_STYLE_SLUG,
        overrideAccess: true,
      })) as unknown as {
        classes?: { id: string; slug: string; styles: unknown }[];
        tokens?: { tokens: { name: string; values: { light: string } }[] };
        breakpoints?: BreakpointSet;
      };
    }

    async function mediaCount(t: TestNextly): Promise<number> {
      return (await t.nextly.media.find({ limit: 200 })).items.length;
    }

    /** Everything an import must leave alone, read as it stands. */
    async function snapshot(t: TestNextly) {
      return JSON.stringify({
        components: await rows(t, COMPONENTS_SLUG),
        patterns: await rows(t, PATTERNS_SLUG),
        layouts: await rows(t, LAYOUTS_SLUG),
        pages: await rows(t, "pages"),
        media: await mediaCount(t),
        style: await siteStyle(t),
      });
    }

    it("reproduces a pattern in an empty site, image, styles and variants included", async () => {
      const { file, site } = await exported("patterns", s => s.pattern);
      const t = await boot();
      await t.nextly.updateSingle({
        slug: SITE_STYLE_SLUG,
        data: { breakpoints: SOURCE_BREAKPOINTS, _overwrite: true },
      });
      const { cookie } = await holding(t, WRITES_EVERYTHING);

      const seen = await preview(cookie, file);
      expect(seen.problems).toEqual([]);
      expect(seen.ready).toBe(true);
      expect(seen.conflicts).toEqual([]);
      expect(seen.missingBlockTypes).toEqual([]);
      expect(seen.breakpoints.unmatched).toEqual([]);

      const answer = await apply(cookie, file);
      expect(answer.status).toBe(201);
      const created = answer.result.created;
      const pattern = await row(t, PATTERNS_SLUG, answer.result.rootId ?? "");
      const outerId = created?.components[site.outer] ?? "";
      const innerId = created?.components[site.inner] ?? "";
      const mediaId = created?.media[site.mediaId] ?? "";
      expect([outerId, innerId, mediaId].every(id => id !== "")).toBe(true);
      const patternNodes = (pattern.content as { nodes: BlockNode[] }).nodes;
      expect(patternNodes[0]?.props.componentId).toBe(outerId);

      const outer = (await row(t, COMPONENTS_SLUG, outerId)).content as {
        nodes: BlockNode[];
      };
      expect(outer.nodes[0]?.classes).toEqual(["c-card"]);
      expect(outer.nodes[1]?.props).toEqual({
        componentId: innerId,
        variant: "v-dark",
      });

      const inner = (await row(t, COMPONENTS_SLUG, innerId)).content as {
        nodes: BlockNode[];
        variants: Record<string, { overrides: Record<string, unknown> }>;
      };
      expect(inner.nodes[0]?.props.mediaId).toBe(mediaId);
      expect(inner.nodes[0]?.visibility).toEqual({ devices: { phone: false } });
      // The variant keeps its stable id, and its image points at the copy.
      expect(Object.keys(inner.variants)).toEqual(["v-dark"]);
      expect(inner.variants["v-dark"]?.overrides.photo).toBe(mediaId);

      const image = await t.nextly.media.findByID({ id: mediaId });
      expect(image?.originalFilename).toBe("dot.png");
      expect(image?.size).toBe(PNG.length);
      expect(image?.caption).toBe("One dot");

      const style = await siteStyle(t);
      expect(style.classes?.map(entry => [entry.id, entry.slug])).toEqual([
        ["c-card", "card"],
      ]);
      expect(style.tokens?.tokens.map(token => token.name)).toContain(
        "color.brand"
      );
    });

    describe("a file that clashes with what the site holds", () => {
      /**
       * The source site after its own pattern was exported, changed so each
       * kind clashes: the card style and the brand variable hold other values,
       * and dot.png is another image under the same name.
       */
      async function clashing() {
        const t = await boot();
        const site = await sourceSite(t);
        const { cookie } = await holding(t, WRITES_EVERYTHING);
        const answer = await post(cookie, [
          "transfer",
          "patterns",
          site.pattern,
          "export",
        ]);
        const file = answer.body as unknown as TransferFile;
        await t.nextly.updateSingle({
          slug: SITE_STYLE_SLUG,
          data: {
            tokens: {
              tokens: [
                {
                  name: "color.brand",
                  kind: "color",
                  values: { light: "#000000" },
                },
              ],
            },
            classes: [
              { id: "c-card", slug: "card", orderIndex: 0, styles: {} },
            ],
            _overwrite: true,
          },
        });
        await t.nextly.media.delete({ id: site.mediaId });
        const other = await t.nextly.media.upload({
          file: {
            data: OTHER_PNG,
            name: "dot.png",
            mimetype: "image/png",
            size: OTHER_PNG.length,
          },
        });
        const page = await created(t, "pages", {
          title: "Placing",
          slug: unique("page"),
          content: {
            formatVersion: 1,
            kind: "page",
            nodes: [
              {
                id: "p",
                type: COMPONENT_INSTANCE_TYPE,
                version: 1,
                props: { componentId: site.outer },
              },
            ],
          },
        });
        return { t, site, file, cookie, otherMedia: other.id, page };
      }

      it("adds every clashing item under a new name by default, changing nothing that is there", async () => {
        const { t, site, file, cookie, otherMedia } = await clashing();
        const before = await snapshot(t);

        const seen = await preview(cookie, file);
        expect(
          seen.conflicts.map(entry => [entry.kind, entry.choice]).sort()
        ).toEqual(
          [
            ["class", "rename"],
            ["component", "rename"],
            ["component", "rename"],
            ["media", "rename"],
            ["pattern", "rename"],
            ["token", "rename"],
          ].sort()
        );

        const answer = await apply(cookie, file);
        expect(answer.status).toBe(201);
        const created = answer.result.created;
        const outerId = created?.components[site.outer] ?? "";
        expect(outerId).not.toBe(site.outer);
        const outer = (await row(t, COMPONENTS_SLUG, outerId)) as {
          slug: string;
          content: { nodes: BlockNode[] };
        };
        const style = await siteStyle(t);
        const renamedClass = style.classes?.find(
          entry => entry.slug === "card-2"
        );
        expect(renamedClass).toBeDefined();
        expect(outer.content.nodes[0]?.classes).toEqual([renamedClass?.id]);
        expect(
          style.tokens?.tokens.find(token => token.name === "color.brand-2")
            ?.values.light
        ).toBe("#123456");
        expect(JSON.stringify(renamedClass?.styles)).toContain("color.brand-2");
        const mediaId = created?.media[site.mediaId] ?? "";
        expect(mediaId).not.toBe(otherMedia);
        expect(mediaId).not.toBe("");

        // Everything that was there is exactly as it was.
        const after = JSON.parse(await snapshot(t)) as Record<string, unknown>;
        const was = JSON.parse(before) as Record<string, unknown>;
        for (const kind of [
          "components",
          "patterns",
          "layouts",
          "pages",
        ] as const) {
          const now = new Map(
            (after[kind] as { id: string }[]).map(entry => [entry.id, entry])
          );
          for (const entry of was[kind] as { id: string }[]) {
            expect(now.get(entry.id)).toEqual(entry);
          }
        }
        const nowClasses = (after.style as { classes: { id: string }[] })
          .classes;
        for (const entry of (was.style as { classes: { id: string }[] })
          .classes) {
          expect(nowClasses.find(own => own.id === entry.id)).toEqual(entry);
        }
      });

      it("points the file's references at the existing items when chosen, adding none of them", async () => {
        const { t, site, file, cookie, otherMedia, page } = await clashing();
        const pageBefore = await row(t, "pages", page);
        const seen = await preview(cookie, file);
        const choices: ImportChoices = {
          conflicts: Object.fromEntries(
            seen.conflicts
              .filter(entry => entry.kind !== "pattern")
              .map(entry => [entry.key, "existing" as const])
          ),
        };
        const componentsBefore = (await rows(t, COMPONENTS_SLUG)).length;
        const classesBefore = (await siteStyle(t)).classes?.length;
        const mediaBefore = await mediaCount(t);

        const answer = await apply(cookie, file, choices);

        expect(answer.status).toBe(201);
        const pattern = await row(t, PATTERNS_SLUG, answer.result.rootId ?? "");
        expect(
          (pattern.content as { nodes: BlockNode[] }).nodes[0]?.props
            .componentId
        ).toBe(site.outer);
        expect((await rows(t, COMPONENTS_SLUG)).length).toBe(componentsBefore);
        expect((await siteStyle(t)).classes?.length).toBe(classesBefore);
        expect(await mediaCount(t)).toBe(mediaBefore);
        expect(answer.result.created?.media).toEqual({});
        expect(await row(t, "pages", page)).toEqual(pageBefore);
        void otherMedia;
      });
    });

    it("reuses an identical image and identical styles rather than adding copies", async () => {
      const t = await boot();
      const site = await sourceSite(t);
      const { cookie } = await holding(t, WRITES_EVERYTHING);
      const answer = await post(cookie, [
        "transfer",
        "components",
        site.inner,
        "export",
      ]);
      const file = answer.body as unknown as TransferFile;
      const mediaBefore = await mediaCount(t);

      const seen = await preview(cookie, file);
      expect(seen.reused).toEqual([
        {
          kind: "media",
          fileId: site.mediaId,
          name: "dot.png",
          existingId: site.mediaId,
        },
      ]);
      const applied = await apply(cookie, file);

      expect(applied.status).toBe(201);
      expect(await mediaCount(t)).toBe(mediaBefore);
      const inner = await row(t, COMPONENTS_SLUG, applied.result.rootId ?? "");
      expect(
        (inner.content as { nodes: BlockNode[] }).nodes[0]?.props.mediaId
      ).toBe(site.mediaId);
    });

    it("refuses a file whose components place each other, writing nothing, media included", async () => {
      const t = await boot();
      const { cookie } = await holding(t, WRITES_EVERYTHING);
      const instance = (to: string): BlockNode => ({
        id: `to-${to}`,
        type: COMPONENT_INSTANCE_TYPE,
        version: 1,
        props: { componentId: to },
      });
      const file = fileOf(
        [
          { id: "a", nodes: [instance("b")] },
          { id: "b", nodes: [instance("a")] },
        ],
        {
          media: [
            {
              id: "m",
              filename: "dot.png",
              mimeType: "image/png",
              size: PNG.length,
              sha256: (await import("node:crypto"))
                .createHash("sha256")
                .update(PNG)
                .digest("hex"),
              data: PNG.toString("base64"),
            },
          ],
        }
      );
      const before = await snapshot(t);

      const seen = await preview(cookie, file);
      expect(seen.ready).toBe(false);
      expect(seen.problems.map(problem => problem.code)).toEqual([
        "COMPONENT_CYCLE",
      ]);
      expect(seen.problems[0]?.message).toContain(
        "Imported a → Imported b → Imported a"
      );

      const answer = await post(cookie, ["transfer", "import"], {
        file,
        expect: seen.fingerprint,
      });
      expect(answer.status).toBe(422);
      expect(await snapshot(t)).toBe(before);
    });

    it("refuses a file that breaks a lock, writing nothing", async () => {
      const t = await boot();
      // Registered after the boot, which registers the site's blocks afresh.
      registerSealed();
      const { cookie } = await holding(t, WRITES_EVERYTHING);
      // The slot locked `all` holds one heading where it starts with two.
      const broken: BlockNode = {
        id: "s",
        type: SEALED,
        version: 1,
        props: {},
        slots: { body: [heading("One")] },
      };
      const file = fileOf([{ id: "locked", nodes: [broken] }]);
      const before = await snapshot(t);

      const seen = await preview(cookie, file);
      expect(seen.ready).toBe(false);
      expect(seen.problems.map(problem => problem.code)).toEqual([
        "REFUSED_BY_SITE",
      ]);

      const answer = await post(cookie, ["transfer", "import"], {
        file,
        expect: seen.fingerprint,
      });
      expect(answer.status).toBe(422);
      expect(await snapshot(t)).toBe(before);
    });

    it("lists a block type the site lacks and refuses until the site provides it", async () => {
      const t = await boot();
      const { cookie } = await holding(t, WRITES_EVERYTHING);
      const file = fileOf([
        { id: "w", nodes: [{ id: "x", type: WIDGET, version: 1, props: {} }] },
      ]);

      const missing = hasBlock(WIDGET) ? [] : [WIDGET];
      const seen = await preview(cookie, file);
      expect(seen.missingBlockTypes).toEqual(missing);
      if (missing.length > 0) {
        expect(seen.ready).toBe(false);
        const refused = await post(cookie, ["transfer", "import"], {
          file,
          expect: seen.fingerprint,
        });
        expect(refused.status).toBe(422);
        expect((await rows(t, COMPONENTS_SLUG)).length).toBe(0);
      }

      // The plugin providing it is installed.
      registerWidget();
      const answer = await apply(cookie, file);
      expect(answer.status).toBe(201);
      expect((await rows(t, COMPONENTS_SLUG)).length).toBe(1);
    });

    describe("breakpoints", () => {
      /**
       * A file with four breakpoints: `tablet` (991) styled, `phone` (479)
       * styled, `tiny` (320) styled, and `watch` (200) only hiding a block.
       */
      function breakpointFile(): TransferFile {
        const node: BlockNode = {
          id: "h",
          type: "core/heading",
          version: 1,
          props: { text: "x", level: "h2" },
          styles: {
            base: {
              base: { color: "#111111" },
              tablet: { color: "#222222" },
              phone: { color: "#333333" },
              tiny: { color: "#444444" },
            },
          },
          visibility: { devices: { watch: false, tablet: false } },
        };
        return fileOf([{ id: "bp", nodes: [node] }], {
          breakpoints: [
            { id: "tablet", label: "Tablet", axis: "viewport", maxWidth: 991 },
            { id: "phone", label: "Phone", axis: "viewport", maxWidth: 479 },
            { id: "tiny", label: "Tiny", axis: "viewport", maxWidth: 320 },
            { id: "watch", label: "Watch", axis: "viewport", maxWidth: 200 },
          ],
        });
      }

      /** A destination whose tablet is `md` at 991 and whose phone is 480. */
      async function destination(
        slugs: readonly string[],
        extra: { id: string; maxWidth: number }[] = []
      ) {
        const t = await boot();
        await t.nextly.updateSingle({
          slug: SITE_STYLE_SLUG,
          data: {
            breakpoints: {
              viewport: [
                { id: "md", label: "Medium", maxWidth: 991 },
                { id: "sm", label: "Small", maxWidth: 480 },
                ...extra.map(entry => ({ ...entry, label: entry.id })),
              ],
              container: [],
            },
            _overwrite: true,
          },
        });
        const author = await holding(t, slugs);
        return { t, cookie: author.cookie };
      }

      async function storedNode(
        t: TestNextly,
        id: string
      ): Promise<BlockNode | undefined> {
        const stored = await row(t, COMPONENTS_SLUG, id);
        return (stored.content as { nodes: BlockNode[] }).nodes[0];
      }

      it("maps only an exact width, and offers add to someone who may manage the site", async () => {
        const { t, cookie } = await destination([
          ...WRITES_EVERYTHING,
          "manage-page-builder-site",
        ]);
        const file = breakpointFile();

        const seen = await preview(cookie, file);
        expect(
          seen.breakpoints.matched.map(entry => [entry.fileId, entry.to.id])
        ).toEqual([["tablet", "md"]]);
        expect(
          seen.breakpoints.unmatched.map(entry => [
            entry.fileId,
            entry.styles,
            entry.hides,
            entry.mayAdd,
          ])
        ).toEqual([
          ["phone", 1, 0, true],
          ["tiny", 1, 0, true],
          ["watch", 0, 1, true],
        ]);
        expect(seen.ready).toBe(false);

        const answer = await apply(cookie, file, {
          breakpoints: { phone: "add", tiny: "drop", watch: "add" },
        });
        expect(answer.status).toBe(201);
        const node = await storedNode(t, answer.result.rootId ?? "");
        // Hidden on the tablet stays hidden on the site's own 991 breakpoint,
        // and on the added watch breakpoint.
        expect(node?.visibility).toEqual({
          devices: { watch: false, md: false },
        });
        expect(node?.styles).toEqual({
          base: {
            base: { color: "#111111" },
            md: { color: "#222222" },
            phone: { color: "#333333" },
          },
        });
        const style = await siteStyle(t);
        expect(
          style.breakpoints?.viewport.map(def => [def.id, def.maxWidth])
        ).toEqual([
          ["md", 991],
          ["sm", 480],
          ["phone", 479],
          ["watch", 200],
        ]);
      });

      it("does not offer add to an author who may not manage site settings, and drops on request", async () => {
        const { t, cookie } = await destination(WRITES_EVERYTHING);
        const file = breakpointFile();

        const seen = await preview(cookie, file);
        expect(seen.breakpoints.unmatched.every(entry => !entry.mayAdd)).toBe(
          true
        );
        expect(seen.breakpoints.unmatched[0]?.whyNotAdd).toContain(
          "manage site settings"
        );

        const refused = await post(cookie, ["transfer", "import"], {
          file,
          choices: {
            breakpoints: { phone: "add", tiny: "drop", watch: "drop" },
          },
          dryRun: true,
        });
        expect(
          (refused.body.item as ImportResult).preview.problems.map(
            problem => problem.code
          )
        ).toEqual(["BREAKPOINT_NOT_ADDABLE"]);

        const answer = await apply(cookie, file, {
          breakpoints: { phone: "drop", tiny: "drop", watch: "drop" },
        });
        expect(answer.status).toBe(201);
        const node = await storedNode(t, answer.result.rootId ?? "");
        expect(node?.styles).toEqual({
          base: { base: { color: "#111111" }, md: { color: "#222222" } },
        });
        expect(node?.visibility).toEqual({ devices: { md: false } });
        expect((await siteStyle(t)).breakpoints?.viewport).toHaveLength(2);
      });

      it("does not offer add on a full axis, and still imports by dropping", async () => {
        const full = [1, 2, 3, 4, 5].map(n => ({
          id: `f${String(n)}`,
          maxWidth: 1000 + n,
        }));
        const { cookie } = await destination(
          [...WRITES_EVERYTHING, "manage-page-builder-site"],
          full
        );

        const seen = await preview(cookie, breakpointFile());
        expect(seen.breakpoints.unmatched.every(entry => !entry.mayAdd)).toBe(
          true
        );
        expect(seen.breakpoints.unmatched[0]?.whyNotAdd).toContain(
          "most it can hold"
        );

        const answer = await apply(cookie, breakpointFile(), {
          breakpoints: { phone: "drop", tiny: "drop", watch: "drop" },
        });
        expect(answer.status).toBe(201);
      });

      it("returns a new preview when a breakpoint changed since the preview", async () => {
        const { t, cookie } = await destination(WRITES_EVERYTHING);
        const file = breakpointFile();
        const choices: ImportChoices = {
          breakpoints: { phone: "drop", tiny: "drop", watch: "drop" },
        };
        const seen = await preview(cookie, file, choices);
        expect(seen.ready).toBe(true);

        // The site's 991 breakpoint becomes 990 between preview and apply.
        await t.nextly.updateSingle({
          slug: SITE_STYLE_SLUG,
          data: {
            breakpoints: {
              viewport: [
                { id: "md", label: "Medium", maxWidth: 990 },
                { id: "sm", label: "Small", maxWidth: 480 },
              ],
              container: [],
            },
            _overwrite: true,
          },
        });
        const answer = await post(cookie, ["transfer", "import"], {
          file,
          choices,
          expect: seen.fingerprint,
        });

        expect(answer.status).toBe(409);
        // Previewed again, the site's own 990 no longer matches the file's 991.
        const fresh = await preview(cookie, file, choices);
        expect(fresh.breakpoints.matched).toEqual([]);
        expect(fresh.fingerprint).not.toBe(seen.fingerprint);
        expect((await rows(t, COMPONENTS_SLUG)).length).toBe(0);
      });
    });

    it("strips a retired exposure id from a placement it imports", async () => {
      const t = await boot();
      const { cookie } = await holding(t, WRITES_EVERYTHING);
      const slug = unique("retiring");
      const exposure = (id: string) => ({
        id,
        label: id,
        nodeId: "h",
        propPath: "text",
        type: "text",
      });
      const component = await created(t, COMPONENTS_SLUG, {
        title: "Retiring",
        slug,
        status: "published",
        content: {
          formatVersion: 1,
          kind: "component",
          nodes: [heading("h")],
          exposed: [exposure("kept"), exposure("gone")],
        },
      });
      // A published removal retires the exposure.
      await t.nextly.update({
        collection: COMPONENTS_SLUG,
        id: component,
        data: {
          status: "published",
          content: {
            formatVersion: 1,
            kind: "component",
            nodes: [heading("h")],
            exposed: [exposure("kept")],
          },
          _overwrite: true,
        },
        overrideAccess: true,
      });
      const file: TransferFile = {
        ...fileOf([{ id: "c", nodes: [heading("h")] }]),
        root: { kind: "pattern", id: "p" },
        components: [
          {
            id: "c",
            title: "Retiring",
            slug,
            status: "published",
            content: {
              formatVersion: 1,
              kind: "component",
              nodes: [heading("h")],
            },
          },
        ],
        patterns: [
          {
            id: "p",
            title: "Using it",
            slug: unique("using"),
            status: "published",
            granularity: "section",
            content: {
              formatVersion: 1,
              kind: "pattern",
              nodes: [
                {
                  id: "i",
                  type: COMPONENT_INSTANCE_TYPE,
                  version: 1,
                  props: {
                    componentId: "c",
                    overrides: { kept: "Yes", gone: "No" },
                  },
                },
              ],
            },
          },
        ],
      };

      const answer = await apply(cookie, file, {
        conflicts: { "component:c": "existing" },
      });

      expect(answer.status).toBe(201);
      const pattern = await row(t, PATTERNS_SLUG, answer.result.rootId ?? "");
      expect(
        (pattern.content as { nodes: BlockNode[] }).nodes[0]?.props
      ).toEqual({
        componentId: component,
        overrides: { kept: "Yes" },
      });
    });

    it("takes back the shared styles and variables it added when a later site write fails", async () => {
      const { file } = await exported("patterns", s => s.pattern);
      const t = await boot();
      const { cookie } = await holding(t, [
        ...WRITES_EVERYTHING,
        "manage-page-builder-site",
      ]);
      const before = await snapshot(t);
      const choices: ImportChoices = {
        breakpoints: Object.fromEntries(
          file.breakpoints.map(entry => [entry.id, "add" as const])
        ),
      };
      const seen = await preview(cookie, file, choices);
      expect(seen.ready).toBe(true);

      refuse.breakpoints = true;
      const answer = await post(cookie, ["transfer", "import"], {
        file,
        choices,
        expect: seen.fingerprint,
      });

      expect(answer.status).toBeGreaterThanOrEqual(400);
      // No shared style or variable is left behind: an empty list where none
      // was stored reads the same as none.
      const after = await siteStyle(t);
      expect(after.classes ?? []).toEqual([]);
      expect(after.tokens?.tokens ?? []).toEqual([]);
      const unchanged = (raw: string) => {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        delete parsed.style;
        return parsed;
      };
      expect(unchanged(await snapshot(t))).toEqual(unchanged(before));
    });

    it("refuses in the preview a variable the site style would refuse", async () => {
      const t = await boot();
      const { cookie } = await holding(t, WRITES_EVERYTHING);
      const file = fileOf([{ id: "v", nodes: [heading("h")] }], {
        tokens: [
          {
            name: "color.odd",
            kind: "not-a-kind" as never,
            values: { light: "#000000" },
          },
        ],
      });
      const before = await snapshot(t);

      const seen = await preview(cookie, file);

      expect(seen.ready).toBe(false);
      expect(seen.problems.map(problem => problem.code)).toEqual([
        "REFUSED_BY_SITE",
      ]);
      expect(await snapshot(t)).toBe(before);
    });

    it("compares breakpoints only for a caller who may read the site style", async () => {
      const t = await boot();
      await t.nextly.updateSingle({
        slug: SITE_STYLE_SLUG,
        data: { breakpoints: SOURCE_BREAKPOINTS, _overwrite: true },
      });
      const { cookie } = await holding(
        t,
        WRITES_EVERYTHING.filter(slug => slug !== "read-site-style")
      );
      const file = fileOf([{ id: "b", nodes: [heading("h")] }], {
        breakpoints: [
          { id: "tablet", label: "Tablet", axis: "viewport", maxWidth: 991 },
        ],
      });

      const seen = await preview(cookie, file);

      expect(seen.breakpoints.matched).toEqual([]);
      expect(JSON.stringify(seen)).not.toContain('"to"');
      expect(seen.problems).toContainEqual({
        code: "NOT_GRANTED",
        message: expect.stringContaining("read the site style"),
      });
    });

    it("finds the identical image past the first page of same-named files", async () => {
      const { file, site } = await exported("components", s => s.inner);
      const t = await boot();
      const identical = await t.nextly.media.upload({
        file: {
          data: PNG,
          name: "dot.png",
          mimetype: "image/png",
          size: PNG.length,
        },
      });
      for (let n = 0; n < 50; n += 1) {
        await t.nextly.media.upload({
          file: {
            data: OTHER_PNG,
            name: `dot-${String(n)}.png`,
            mimetype: "image/png",
            size: OTHER_PNG.length,
          },
        });
      }
      const { cookie } = await holding(t, WRITES_EVERYTHING);

      const seen = await preview(cookie, file);

      expect(seen.reused).toContainEqual({
        kind: "media",
        fileId: site.mediaId,
        name: "dot.png",
        existingId: identical.id,
      });
    });

    it("imports nothing when another save drops the shared styles it just added", async () => {
      const { file } = await exported("components", s => s.outer);
      const t = await boot();
      const { cookie } = await holding(t, WRITES_EVERYTHING);
      const before = await snapshot(t);
      const seen = await preview(cookie, file, {
        breakpoints: Object.fromEntries(
          file.breakpoints.map(entry => [entry.id, "drop" as const])
        ),
      });
      expect(seen.ready).toBe(true);

      overwrite.classes = true;
      const answer = await post(cookie, ["transfer", "import"], {
        file,
        choices: {
          breakpoints: Object.fromEntries(
            file.breakpoints.map(entry => [entry.id, "drop"])
          ),
        },
        expect: seen.fingerprint,
      });

      expect(answer.status).toBe(409);
      const unchanged = (raw: string) => {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        delete parsed.style;
        return parsed;
      };
      expect(unchanged(await snapshot(t))).toEqual(unchanged(before));
    });

    it("imports nothing when the site style is saved between its read and its write", async () => {
      // The append sends the version the site style was read at, so a save
      // landing in between refuses it rather than being replaced by it.
      const { file } = await exported("components", s => s.outer);
      const t = await boot();
      const { cookie } = await holding(t, WRITES_EVERYTHING);
      const before = await snapshot(t);
      const drop = {
        breakpoints: Object.fromEntries(
          file.breakpoints.map(entry => [entry.id, "drop" as const])
        ),
      };
      const seen = await preview(cookie, file, drop);
      expect(seen.ready).toBe(true);

      interleave.beforeStyleWrite = true;
      const answer = await post(cookie, ["transfer", "import"], {
        file,
        choices: drop,
        expect: seen.fingerprint,
      });

      expect(answer.status).toBe(409);
      expect(interleave.beforeStyleWrite).toBe(false);
      const unchanged = (raw: string) => {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        delete parsed.style;
        return parsed;
      };
      expect(unchanged(await snapshot(t))).toEqual(unchanged(before));
    });

    it("adds a variable by its stable id when this site has another under the same name", async () => {
      const t = await boot();
      await t.nextly.updateSingle({
        slug: SITE_STYLE_SLUG,
        data: {
          tokens: {
            tokens: [
              {
                id: "brand-here",
                name: "color.brand",
                kind: "color",
                values: { light: "#000000" },
              },
            ],
          },
          _overwrite: true,
        },
      });
      const { cookie } = await holding(t, WRITES_EVERYTHING);
      const node: BlockNode = {
        ...heading("h"),
        styles: { base: { base: { color: { $token: "brand-there" } } } },
      };
      const file = fileOf([{ id: "c", nodes: [node] }], {
        tokens: [
          {
            id: "brand-there",
            name: "color.brand",
            kind: "color",
            values: { light: "#123456" },
          },
        ],
      });

      const answer = await apply(cookie, file);

      expect(answer.status).toBe(201);
      const tokens = (await siteStyle(t)).tokens?.tokens as {
        id?: string;
        name: string;
      }[];
      expect(tokens.map(token => token.id ?? token.name).sort()).toEqual([
        "brand-here",
        "brand-there",
      ]);
      const stored = await row(t, COMPONENTS_SLUG, answer.result.rootId ?? "");
      expect(
        (stored.content as { nodes: BlockNode[] }).nodes[0]?.styles
      ).toEqual({
        base: { base: { color: { $token: "brand-there" } } },
      });
    });

    it("sets an imported image's caption only for a caller who may update media", async () => {
      const { file, site } = await exported("components", s => s.inner);
      const t = await boot();
      const { cookie } = await holding(
        t,
        WRITES_EVERYTHING.filter(slug => slug !== "update-media")
      );

      const answer = await apply(cookie, file, {
        breakpoints: Object.fromEntries(
          file.breakpoints.map(entry => [entry.id, "drop" as const])
        ),
      });

      expect(answer.status).toBe(201);
      const mediaId = answer.result.created?.media[site.mediaId] ?? "";
      const image = await t.nextly.media.findByID({ id: mediaId });
      expect(image?.originalFilename).toBe("dot.png");
      expect(image?.caption ?? null).toBeNull();
    });

    it("tells the hooks a write is judged, and commits without saying so", async () => {
      const t = await boot();
      const { cookie } = await holding(t, WRITES_EVERYTHING);
      const file = fileOf([{ id: "j", nodes: [heading("h")] }]);

      await preview(cookie, file);
      expect(judged).toEqual([true]);

      const answer = await apply(cookie, file);
      expect(answer.status).toBe(201);
      // The apply's own preview, its judgement, then the write that stays.
      expect(judged).toEqual([true, true, true, false]);
    });

    it("renames around an item the caller may not read without naming it or offering it", async () => {
      const t = await boot();
      const slug = unique("hidden");
      await created(t, COMPONENTS_SLUG, {
        title: "Secret header",
        slug,
        status: "published",
        content: { formatVersion: 1, kind: "component", nodes: [heading("s")] },
      });
      const { cookie } = await holding(t, [
        "create-components",
        "publish-components",
      ]);
      const base = fileOf([{ id: "c", nodes: [heading("h")] }]);
      const file: TransferFile = {
        ...base,
        components: base.components.map(item => ({ ...item, slug })),
      };

      const seen = await preview(cookie, file);

      expect(seen.conflicts).toEqual([]);
      expect(JSON.stringify(seen)).not.toContain("Secret header");
      expect(seen.added).toEqual([
        { kind: "component", fileId: "c", name: "Imported c (2)" },
      ]);
    });

    it("never makes an imported Layout the default, even the source's own default", async () => {
      const source = await boot();
      const site = await sourceSite(source);
      const slugs = {
        layouts: LAYOUTS_SLUG,
        settings: PAGE_BUILDER_SETTINGS_SLUG,
      };
      // The source's default becomes the Layout exported.
      const manager = await holding(source, [
        "read-layouts",
        "update-layouts",
        "publish-layouts",
        "manage-page-builder-site",
      ]);
      const made = await post(manager.cookie, [
        "layouts",
        site.layout,
        "make-default",
      ]);
      expect(made.status).toBe(200);
      expect(
        (await readLayoutSettings(source.nextly, slugs)).defaultLayout
      ).toBe(site.layout);
      const reader = await holding(source, READS_EVERYTHING);
      const exportedAnswer = await post(reader.cookie, [
        "transfer",
        "layouts",
        site.layout,
        "export",
      ]);
      const file = exportedAnswer.body as unknown as TransferFile;

      const t = await boot();
      await created(t, "pages", {
        title: "A page",
        slug: unique("page"),
        content: { formatVersion: 1, kind: "page", nodes: [heading("x")] },
      });
      const before = await readLayoutSettings(t.nextly, slugs);
      const { cookie } = await holding(t, [
        ...WRITES_EVERYTHING,
        "manage-page-builder-site",
      ]);

      const answer = await apply(cookie, file, {
        breakpoints: Object.fromEntries(
          file.breakpoints.map(entry => [entry.id, "drop" as const])
        ),
      });

      expect(answer.status).toBe(201);
      const after = await readLayoutSettings(t.nextly, slugs);
      expect(after.defaultLayout).toBe(before.defaultLayout);
      expect(after.defaultLayout).not.toBe(answer.result.rootId);
    });
  }
);
