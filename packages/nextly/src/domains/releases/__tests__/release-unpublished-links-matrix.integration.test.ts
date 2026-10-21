/**
 * Every way a link finding could tell a reader more than they may read, as
 * one table.
 *
 * Each cell is a post linking, from one placement, to two authors: one through
 * a field anyone may view, one through a field only the editor-in-chief may
 * view. The placements are the shapes a link can sit in, including two where
 * the readable and the protected field share a name. Four readers read every
 * cell through every surface that reports links: the release's readiness, a
 * page's readiness, and the answer to adding the post.
 *
 * For every cell and reader:
 * - nothing the reader may not see appears: the protected author's id for
 *   anyone but the editor-in-chief, any author's id for a reader who may not
 *   read the post or the authors, and a protected field's own name;
 * - every link is counted exactly once: named, hidden, or in a hidden field,
 *   adding up to what a trusted read reports, deleted links by their count;
 *   for a reader who may not read the post at all, the post itself is the
 *   one count (the release's hidden documents), and no link is reported;
 * - what the reader may see is named;
 * - a reader who may not read the authors is told exactly the same of a
 *   link to one whether it is a draft, deleted or live: one hidden count
 *   per link, with no cause, field or id.
 *
 * Each cell's assertions are soft, so one run reports every cell that fails
 * rather than stopping at the first.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  group,
  relationship,
  repeater,
  text,
} from "../../../config";
import { writeFieldGroupType } from "../../../field-group-type";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ReadinessFinding } from "../readiness/evaluate-readiness";

import { seedLiveAuthor } from "./helpers/live-author";
import { keyHolding, rest } from "./helpers/rest-key";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** The only person a protected field's rule admits. */
const CHIEF = { email: "chief@example.com", name: "Chief" };

const guarded = {
  read: ({ req }: { req: { user?: { email?: string } } }) =>
    req.user?.email === CHIEF.email,
};

const OPEN = {
  read: () => true,
  update: () => true,
  publish: () => true,
  unpublish: () => true,
};

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    fieldGroups: [
      // Two block types whose link fields share a name, one protected.
      defineFieldGroup({
        slug: "quote",
        fields: [relationship({ name: "author", relationTo: "authors" })],
      }),
      defineFieldGroup({
        slug: "aside",
        fields: [
          relationship({
            name: "author",
            relationTo: "authors",
            access: guarded,
          }),
        ],
      }),
      defineFieldGroup({
        slug: "card",
        fields: [
          relationship({ name: "openAuthor", relationTo: "authors" }),
          relationship({
            name: "guardedAuthor",
            relationTo: "authors",
            access: guarded,
          }),
        ],
      }),
    ],
    collections: [
      defineCollection({
        slug: "authors",
        status: true,
        access: OPEN,
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: "posts",
        status: true,
        access: OPEN,
        fields: [
          text({ name: "title" }),
          relationship({ name: "openTop", relationTo: "authors" }),
          relationship({
            name: "guardedTop",
            relationTo: "authors",
            access: guarded,
          }),
          group({
            name: "meta",
            fields: [
              relationship({ name: "openAuthor", relationTo: "authors" }),
              relationship({
                name: "guardedAuthor",
                relationTo: "authors",
                access: guarded,
              }),
            ],
          }),
          // The readable and the protected leaf are both `deep.author`.
          group({
            name: "deep",
            fields: [
              relationship({ name: "author", relationTo: "authors" }),
              group({
                name: "nested",
                fields: [
                  relationship({
                    name: "author",
                    relationTo: "authors",
                    access: guarded,
                  }),
                ],
              }),
            ],
          }),
          repeater({
            name: "lines",
            fields: [
              relationship({ name: "openAuthor", relationTo: "authors" }),
              relationship({
                name: "guardedAuthor",
                relationTo: "authors",
                access: guarded,
              }),
            ],
          }),
          fieldGroup({
            name: "blocks",
            components: ["quote", "aside"],
            repeatable: true,
          }),
          fieldGroup({ name: "card", component: "card" }),
        ],
      }),
    ],
  });
  return current;
}

/** A field group instance of the named type, as a block list stores one. */
function typed(type: string, data: Record<string, unknown>) {
  const instance: Record<string, unknown> = { ...data };
  writeFieldGroupType(instance, type);
  return instance;
}

interface Placement {
  name: string;
  /** The post's fields linking `open` readably and `secret` protectedly. */
  data: (open: string, secret: string) => Record<string, unknown>;
  /** Protected field names unique to the protected leaf, never to be shown. */
  secretNames: string[];
}

const PLACEMENTS: Placement[] = [
  {
    name: "top level",
    data: (open, secret) => ({ openTop: open, guardedTop: secret }),
    secretNames: ["guardedTop"],
  },
  {
    name: "group",
    data: (open, secret) => ({
      meta: { openAuthor: open, guardedAuthor: secret },
    }),
    secretNames: ["guardedAuthor"],
  },
  {
    name: "nested group, colliding name",
    data: (open, secret) => ({
      deep: { author: open, nested: { author: secret } },
    }),
    secretNames: [],
  },
  {
    name: "repeater",
    data: (open, secret) => ({
      lines: [{ openAuthor: open, guardedAuthor: secret }],
    }),
    secretNames: ["guardedAuthor"],
  },
  {
    name: "block, colliding name",
    data: (open, secret) => ({
      blocks: [
        typed("quote", { author: open }),
        typed("aside", { author: secret }),
      ],
    }),
    secretNames: [],
  },
  {
    name: "field group",
    data: (open, secret) => ({
      card: { openAuthor: open, guardedAuthor: secret },
    }),
    secretNames: ["guardedAuthor"],
  },
];

type Reader = "chief" | "clerk" | "noSource" | "noTarget";

const READERS: Reader[] = ["chief", "clerk", "noSource", "noTarget"];

/** What one reader was told through one surface. */
interface Told {
  /** Every string the reader received about links. */
  text: string;
  named: number;
  hidden: number;
  inHiddenFields: number;
  /** The authors named by id. */
  namedIds: string[];
  /** Documents of the release the reader may not read, as counted. */
  hiddenDocuments: number;
}

/** The link findings of a readiness answer, as told. */
function toldByFindings(answer: {
  soft?: readonly ReadinessFinding[];
  hidden?: ReadonlyArray<{ count: number }>;
}): Told {
  const links = (answer.soft ?? []).filter(
    f => f.source === "core.unpublished-links"
  );
  const weight = (f: ReadinessFinding) => Number(f.detail?.count ?? 1);
  return {
    text: JSON.stringify(links),
    named: links
      .filter(f => f.code === "UNPUBLISHED_LINK")
      .reduce((sum, f) => sum + weight(f), 0),
    hidden: links
      .filter(f => f.code === "UNPUBLISHED_LINKS_HIDDEN")
      .reduce((sum, f) => sum + weight(f), 0),
    inHiddenFields: links
      .filter(f => f.code === "UNPUBLISHED_LINK_IN_HIDDEN_FIELD")
      .reduce((sum, f) => sum + weight(f), 0),
    namedIds: links
      .map(f => f.detail?.entryId)
      .filter((id): id is string => typeof id === "string"),
    hiddenDocuments: (answer.hidden ?? []).reduce((sum, h) => sum + h.count, 0),
  };
}

/** An add response's links, as told. */
function toldByReport(report: {
  links: Array<{ entryId: string }>;
  hiddenCount: number;
  inHiddenFields: number;
  deletedLinks: Array<{ count: number }>;
}): Told {
  return {
    text: JSON.stringify(report),
    named:
      report.links.length +
      report.deletedLinks.reduce((sum, d) => sum + d.count, 0),
    hidden: report.hiddenCount,
    inHiddenFields: report.inHiddenFields,
    namedIds: report.links.map(link => link.entryId),
    hiddenDocuments: 0,
  };
}

/** One cell: a placement, a link state, and the two authors it links to. */
interface Cell {
  placement: Placement;
  state: "draft" | "deleted" | "live";
  open: string;
  secret: string;
  post: string;
  releaseId: string;
  /** How many links a trusted read reports. */
  total: number;
}

/** What `reader` is told of `cell`, through every surface they can reach. */
async function surfacesFor(
  cell: Cell,
  reader: Reader,
  key: string
): Promise<Array<[string, Told]>> {
  const surfaces: Array<[string, Told]> = [];
  const single = await rest(key, "GET", [
    "releases",
    cell.releaseId,
    "readiness",
  ]);
  surfaces.push([
    "readiness",
    toldByFindings(single.json as Parameters<typeof toldByFindings>[0]),
  ]);
  const page = await rest(
    key,
    "GET",
    ["releases", "readiness"],
    undefined,
    `ids=${cell.releaseId}`
  );
  const entry = (
    page.json as { items: Array<Parameters<typeof toldByFindings>[0]> }
  ).items[0];
  surfaces.push(["page", toldByFindings(entry ?? {})]);
  // A reader who may not read the post cannot add it.
  if (reader === "noSource") return surfaces;
  const own = await rest(key, "POST", ["releases"], {
    title: `${reader} ${cell.placement.name} ${cell.state}`,
  });
  const added = await rest(
    key,
    "POST",
    ["releases", (own.json.item as { id: string }).id, "members"],
    {
      scopeKind: "collection",
      scopeSlug: "posts",
      entryId: cell.post,
      action: "publish",
    }
  );
  expect(added.status, `${cell.placement.name}, ${reader}: add`).toBe(201);
  const item = added.json.item as {
    unpublishedLinks: Parameters<typeof toldByReport>[0];
  };
  surfaces.push(["add", toldByReport(item.unpublishedLinks)]);
  return surfaces;
}

/** What `reader` must never be told of `cell`. */
function forbiddenFor(cell: Cell, reader: Reader): string[] {
  const unreadableTargets =
    reader === "noSource" || reader === "noTarget" ? [cell.open] : [];
  const protectedOnes =
    reader === "chief" ? [] : [cell.secret, ...cell.placement.secretNames];
  const unreadablePost = reader === "noSource" ? ["openAuthor", "openTop"] : [];
  return [...protectedOnes, ...unreadableTargets, ...unreadablePost];
}

/** Every assertion of one cell, reader and surface, all soft. */
/**
 * A reader who may not read the authors: the same answer for a draft, a
 * deleted and a live author, each link one count, never a cause, a field or
 * an id.
 */
function judgeNonReader(where: string, told: Told) {
  expect.soft(told.named, `${where}: classifies`).toBe(0);
  expect.soft(told.inHiddenFields, `${where}: classifies a field`).toBe(0);
  expect.soft(told.hidden, `${where}: counts`).toBe(2);
  expect.soft(told.text, `${where}: names a cause`).not.toContain("cause");
  expect.soft(told.text, `${where}: names a field`).not.toContain("fields");
}

/**
 * Every link counted exactly once: a post the reader may not read is one
 * hidden document, and none of its links is reported.
 */
function judgeCounts(cell: Cell, reader: Reader, where: string, told: Told) {
  const postHidden = reader === "noSource";
  if (reader === "noTarget") judgeNonReader(where, told);
  else {
    expect
      .soft(told.named + told.hidden + told.inHiddenFields, `${where}: counts`)
      .toBe(postHidden ? 0 : cell.total);
  }
  expect
    .soft(told.hiddenDocuments, `${where}: hidden documents`)
    .toBe(postHidden ? 1 : 0);
}

function judgeSurface(cell: Cell, reader: Reader, surface: string, told: Told) {
  const where = `${cell.placement.name}, ${cell.state}, ${reader}, ${surface}`;
  judgeCounts(cell, reader, where, told);
  // Nothing it may not see.
  for (const word of forbiddenFor(cell, reader)) {
    expect.soft(told.text, `${where}: leaks ${word}`).not.toContain(word);
  }
  // And what it may see, named.
  if (cell.state !== "draft") return;
  if (reader === "chief" || reader === "clerk") {
    expect
      .soft(told.namedIds, `${where}: names the open author`)
      .toContain(cell.open);
  }
  if (reader === "chief") {
    expect
      .soft(told.namedIds, `${where}: names the protected author to the chief`)
      .toContain(cell.secret);
  }
}

/** The four readers' keys, each held by a person of its own. */
async function readerKeys(t: TestNextly): Promise<Record<Reader, string>> {
  const editing = [
    "read-content-releases",
    "create-content-releases",
    "read-posts",
    "update-posts",
    "publish-posts",
  ];
  const person = (name: string) => ({
    email: `${name.toLowerCase()}@example.com`,
    name,
  });
  return {
    chief: (await keyHolding(t, [...editing, "read-authors"], CHIEF)).key,
    clerk: (await keyHolding(t, [...editing, "read-authors"], person("Clerk")))
      .key,
    noSource: (
      await keyHolding(
        t,
        ["read-content-releases", "read-authors"],
        person("Outsider")
      )
    ).key,
    noTarget: (await keyHolding(t, editing, person("Stranger"))).key,
  };
}

/** Lay one cell out: its authors, its post and a release holding the post. */
async function layOut(
  t: TestNextly,
  author: string,
  placement: Placement,
  state: Cell["state"]
): Promise<Cell> {
  const create = async (collection: string, data: object) => {
    const made = (await t.nextly.create({
      collection: collection as never,
      data: { title: collection, status: "draft", ...data } as never,
    })) as unknown as { item?: { id?: string }; id?: string };
    return String(made.item?.id ?? made.id);
  };
  const status = state === "live" ? "published" : "draft";
  const open = await create("authors", { status });
  const secret = await create("authors", { status });
  const post = await create("posts", placement.data(open, secret));
  if (state === "deleted") {
    for (const id of [open, secret]) {
      await t.nextly.delete({ collection: "authors" as never, id });
    }
  }
  const release = await t.nextly.releases.create({ title: "Cell" });
  await t.nextly.releases.addMember({
    releaseId: release.id,
    scopeKind: "collection",
    scopeSlug: "posts",
    entryId: post,
    locale: null,
    action: "publish",
    userId: author,
  });
  const trusted = toldByFindings(
    await t.nextly.releases.readiness({ releaseId: release.id })
  );
  const where = `${placement.name}, ${state}`;
  // Both links are found at all, so the cell reaches the mechanism; a live
  // link is nothing to note.
  expect(trusted.named, `${where}: trusted`).toBe(state === "live" ? 0 : 2);
  if (state === "draft") {
    expect(trusted.namedIds.sort(), where).toEqual([open, secret].sort());
  }
  return {
    placement,
    state,
    open,
    secret,
    post,
    releaseId: release.id,
    total: trusted.named,
  };
}

describe.each(getConfiguredTestDialects())(
  "a document's links, by placement, reader and state (%s)",
  dialect => {
    it("never tells a reader what they may not read, and counts every link once", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const keys = await readerKeys(t);
      let judged = 0;
      for (const placement of PLACEMENTS) {
        for (const state of ["draft", "deleted", "live"] as const) {
          const cell = await layOut(t, author, placement, state);
          for (const reader of READERS) {
            for (const [surface, told] of await surfacesFor(
              cell,
              reader,
              keys[reader]
            )) {
              judgeSurface(cell, reader, surface, told);
              judged += 1;
            }
          }
        }
      }
      // 6 placements x 3 states x (4 readers x 2 readiness surfaces + 3 adds).
      expect(judged).toBe(6 * 3 * (4 * 2 + 3));
    }, 900_000);
  }
);
