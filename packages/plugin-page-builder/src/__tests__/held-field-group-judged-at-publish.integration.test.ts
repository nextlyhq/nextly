/**
 * A field-group instance held in a working draft, judged before it can go
 * live: when the draft is saved, against the drafts, and when it is
 * published, against what visitors are served.
 *
 * A blocks field judges its composition through the entry write it is
 * handed; with none it judges nothing. A held save hands the instance the
 * held write, as a draft, so a value past the composition rules is refused
 * when it is saved rather than kept until someone publishes it. Publishing
 * writes the instance rows through the component write, which judges them
 * with the publish's write as the instance sees it; those cases guard that.
 * The host has a blocks field of its own named as the instance's, so a lock
 * read through the host would find the host's value, not the instance's.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
  expandSlotDefaults,
  hasBlock,
  makeNode,
  registerBlocks,
  registryBlockSource,
  registryNestingSource,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { definePlugin } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  text,
} from "nextly/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { COMPONENTS_SLUG } from "../collections/components";
import { BLOCKS_TYPE } from "../fields/blocksField";
import { pageBuilder } from "../plugin";

type Node = Record<string, unknown>;

const heading = (id: string): Node => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text: id, level: 2 },
});

const box = (id: string, children: Node[]): Node => ({
  id,
  type: "core/box",
  version: 1,
  props: {},
  slots: { children },
});

const placing = (id: string, componentId: string): Node => ({
  id,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId },
});

const pageOf = (nodes: unknown[]) => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

/** A blocks field, as code declares one. */
const blocks = (name: string) => ({ name, type: BLOCKS_TYPE }) as never;

/** A card whose body only takes content, for the lock case. */
function registerSealedCard(): void {
  if (hasBlock("fg/sealed-card")) return;
  const base = {
    version: 1,
    description: "A block.",
    example: { props: {} },
    render: () => null,
  };
  registerBlocks(
    [
      {
        ...base,
        name: "fg/headline",
        props: {
          text: { type: "text", role: "content" },
          align: { type: "select" },
        },
        defaultProps: { text: "Title", align: "left" },
      },
      {
        ...base,
        name: "fg/sealed-card",
        slots: {
          body: {
            defaultBlock: [{ type: "fg/headline" }],
            lock: "contentOnly",
          },
        },
      },
    ] as never,
    { source: "test" } as never
  );
}

function sealedCard(align: string): BlockNode {
  const card = makeNode(
    "fg/sealed-card",
    1,
    {},
    expandSlotDefaults(
      "fg/sealed-card",
      registryBlockSource(),
      registryNestingSource()
    )
  );
  card.slots!.body![0]!.props.align = align;
  return card;
}

/**
 * The validation issue codes a refused write carries, or none for a write
 * that saved. Any other failure is rethrown, so a write that failed for
 * another reason never reads as a save.
 */
async function refusalCodes(write: Promise<unknown>): Promise<string[]> {
  try {
    await write;
    return [];
  } catch (error) {
    const errors = (
      error as { publicData?: { errors?: Array<{ code: string }> } }
    ).publicData?.errors;
    if (errors === undefined) throw error;
    return errors.map(issue => issue.code);
  }
}

/**
 * A component published two deep, with a pending draft one deep: which form a
 * save is judged against decides whether a page placing it fits.
 */
async function seedSwing(t: TestNextly): Promise<string> {
  const swinging = await t.nextly.create({
    collection: COMPONENTS_SLUG,
    data: {
      title: "swing",
      slug: "swing",
      status: "published",
      content: {
        formatVersion: DOCUMENT_FORMAT_VERSION,
        kind: "component",
        nodes: [box("s1", [heading("s2")])],
      },
    },
    overrideAccess: true,
  });
  const id = String(swinging.item.id);
  await t.nextly.update({
    collection: COMPONENTS_SLUG,
    id,
    data: {
      content: {
        formatVersion: DOCUMENT_FORMAT_VERSION,
        kind: "component",
        nodes: [heading("s1")],
      },
      _overwrite: true,
    },
    overrideAccess: true,
  });
  return id;
}

const LIMITS = { ...DEFAULT_LIMITS, maxDepth: 4 };

/** A field type whose validator records the write it is shown. */
const PROBE_TYPE = "payload-probe";

function payloadProbe(
  seen: Record<string, unknown>[],
  // The language of each write it is shown, where a case asks for it.
  locales: (string | undefined)[] = []
) {
  return definePlugin({
    name: "@test/payload-probe",
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: {
      fieldTypes: [
        {
          type: PROBE_TYPE,
          storage: "text",
          component: "@test/payload-probe/admin#Probe",
          // Asked for an empty value too, so a held save that leaves the
          // probe unset still shows what it was handed.
          validateEmpty: true,
          validate: (
            _value: unknown,
            args: {
              data: Record<string, unknown>;
              write?: { locale?: string };
            }
          ) => {
            seen.push(args.data);
            locales.push(args.write?.locale);
            return true as const;
          },
        },
      ],
    },
  } as never);
}

describe.each(getConfiguredTestDialects())(
  "a field-group instance held in a working draft (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let deep = "";
    let swing = "";
    const seen: Record<string, unknown>[] = [];

    beforeAll(async () => {
      t = await createTestNextly({
        dialect,
        // A small depth limit, so a too-deep page stays short.
        plugins: [pageBuilder({ limits: LIMITS }), payloadProbe(seen)],
        fieldGroups: [
          defineFieldGroup({
            slug: "herobox",
            fields: [
              text({ name: "title" }),
              blocks("content"),
              // A plugin field type's validator is shown the write's payload.
              { name: "probe", type: PROBE_TYPE } as never,
            ],
          }),
        ],
        collections: [
          defineCollection({
            // Drafts, so an edit to a live poster is held until published.
            slug: "posters",
            status: true,
            versions: { drafts: true },
            fields: [
              text({ name: "title" }),
              // The host's own blocks field, named as the instance's is.
              blocks("content"),
              fieldGroup({ name: "hero", component: "herobox" }),
            ],
          }),
        ],
      });
      registerSealedCard();
      // Two deep, published with no pending draft: the same in a draft and live.
      const created = await t.nextly.create({
        collection: COMPONENTS_SLUG,
        data: {
          title: "deep",
          slug: "deep",
          status: "published",
          content: {
            formatVersion: DOCUMENT_FORMAT_VERSION,
            kind: "component",
            nodes: [box("d1", [heading("d2")])],
          },
        },
        overrideAccess: true,
      });
      deep = String(created.item.id);
      swing = await seedSwing(t);
    });

    afterAll(async () => {
      await t?.destroy();
    });

    /** A live poster with an empty hero, and its id. */
    async function livePoster(): Promise<string> {
      const made = await t.nextly.create({
        collection: "posters" as never,
        data: { title: "Poster", status: "published" } as never,
        overrideAccess: true,
      });
      return String(made.item.id);
    }

    /** An edit to a live poster, held as its working draft. */
    const hold = (id: string, hero: Record<string, unknown>) =>
      t.nextly.update({
        collection: "posters" as never,
        id,
        data: { hero, _overwrite: true } as never,
        overrideAccess: true,
      });

    /** The held draft put live, as the admin's Publish does. */
    const publish = (id: string) =>
      t.nextly.update({
        collection: "posters" as never,
        id,
        data: { status: "published", _overwrite: true } as never,
        overrideAccess: true,
      });

    /** The hero the live poster shows. */
    async function liveHero(id: string): Promise<unknown> {
      const read = (await t.nextly.findByID({
        collection: "posters" as never,
        id,
        overrideAccess: true,
      })) as { hero?: { content?: unknown } } | null;
      return read?.hero?.content ?? null;
    }

    it("refuses a publish whose held instance composes past the limit as it goes live", async () => {
      // Three boxes over the swing: its draft (one deep) fits, its published
      // form (two deep) does not. A held save is judged against the drafts,
      // the publish against what visitors are served.
      const id = await livePoster();
      const page = pageOf([
        box("p1", [box("p2", [box("p3", [placing("i1", swing)])])]),
      ]);
      expect(await refusalCodes(hold(id, { content: page }))).toEqual([]);

      expect(await refusalCodes(publish(id))).toEqual(["depth-exceeded"]);
      // Nothing of the held instance went live.
      expect(await liveHero(id)).toBeNull();
    });

    it("publishes a held instance that fits as it goes live", async () => {
      // CONTROL: two boxes over the swing end at the limit in either form.
      const id = await livePoster();
      const page = pageOf([box("p1", [box("p2", [placing("i1", swing)])])]);
      expect(await refusalCodes(hold(id, { content: page }))).toEqual([]);
      expect(await refusalCodes(publish(id))).toEqual([]);
      expect(await liveHero(id)).toMatchObject({ kind: "page" });
    });

    it("shows a field inside the held instance the patch as sent", async () => {
      // As an ordinary update shows it: the fields the save sent, with the
      // instance, and no status the save did not send.
      const id = await livePoster();
      seen.length = 0;
      expect(
        await refusalCodes(
          hold(id, { title: "Held", content: pageOf([]), probe: "seen" })
        )
      ).toEqual([]);
      // Each pass that shows the write: the ones carrying the instance by
      // its host field's name. A pass judging the instance's own row shows
      // the instance, which has a title of its own.
      const keys = JSON.stringify(seen.map(data => Object.keys(data)));
      expect(seen.length, keys).toBeGreaterThan(0);
      for (const shown of seen) {
        expect(Object.hasOwn(shown, "status"), keys).toBe(false);
        // The host's own title was not sent, so it is not shown as sent.
        expect(Object.hasOwn(shown, "title"), keys).toBe(false);
        expect(shown.hero, keys).toMatchObject({ title: "Held" });
      }
    });

    it("refuses a held save whose instance composes past the limit in every form", async () => {
      // Past the limit as a draft too, so the held save itself is refused,
      // as the same value saved live would be.
      const id = await livePoster();
      const page = pageOf([
        box("p1", [box("p2", [box("p3", [placing("i1", deep)])])]),
      ]);
      expect(await refusalCodes(hold(id, { content: page }))).toEqual([
        "depth-exceeded",
      ]);
    });

    it("judges a held instance's lock against its own starting blocks, never the host's, so a loosened card is refused", async () => {
      const id = await livePoster();
      // The host's own field holds the same card loosened past its lock, as an
      // older writer could have left it: planted past every check. Read as the
      // instance's baseline, it would pass the instance's loosening as
      // unchanged.
      const card = sealedCard("right");
      const loosened = pageOf([card]);
      await t.adapter.update(
        "dc_posters",
        {
          content: dialect === "sqlite" ? JSON.stringify(loosened) : loosened,
        },
        { and: [{ column: "id", op: "=", value: id }] }
      );

      expect(await refusalCodes(hold(id, { content: pageOf([card]) }))).toEqual(
        ["locked-slot-content-only"]
      );
      // CONTROL: the card at its starting design is held, and publishes.
      expect(
        await refusalCodes(hold(id, { content: pageOf([sealedCard("left")]) }))
      ).toEqual([]);
      expect(await refusalCodes(publish(id))).toEqual([]);
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "a held instance in a site with languages (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    const locales: (string | undefined)[] = [];

    beforeAll(async () => {
      t = await createTestNextly({
        dialect,
        plugins: [pageBuilder(), payloadProbe([], locales)],
        localization: { locales: ["en", "de"], defaultLocale: "en" },
        fieldGroups: [
          defineFieldGroup({
            slug: "badgebox",
            fields: [
              text({ name: "title" }),
              { name: "probe", type: PROBE_TYPE } as never,
            ],
          }),
        ],
        collections: [
          defineCollection({
            // No languages of its own: its instances and the library they
            // read are still kept per language.
            slug: "banners",
            status: true,
            versions: { drafts: true },
            fields: [
              text({ name: "title" }),
              fieldGroup({ name: "badge", component: "badgebox" }),
            ],
          }),
        ],
      });
    });

    afterAll(async () => {
      await t?.destroy();
    });

    /** The languages the probe was shown for a held save in `locale`. */
    async function heldIn(locale?: string): Promise<(string | undefined)[]> {
      const made = await t.nextly.create({
        collection: "banners" as never,
        data: { title: "Banner", status: "published" } as never,
        overrideAccess: true,
      });
      locales.length = 0;
      await t.nextly.update({
        collection: "banners" as never,
        id: String(made.item.id),
        data: {
          badge: { title: "Held", probe: "seen" },
          _overwrite: true,
        } as never,
        ...(locale === undefined ? {} : { locale }),
        overrideAccess: true,
      });
      expect(locales.length).toBeGreaterThan(0);
      return [...new Set(locales)];
    }

    it("judges a held save's instance in the language the save names", async () => {
      expect(await heldIn("de")).toEqual(["de"]);
    });

    it("judges one that names an empty language in the default", async () => {
      // An empty language is no language, as the write's locale check reads it.
      expect(await heldIn("")).toEqual([undefined]);
    });

    it("judges one that names no language in the default", async () => {
      // CONTROL: absent, which a reader takes as the default language.
      expect(await heldIn()).toEqual([undefined]);
    });
  }
);
