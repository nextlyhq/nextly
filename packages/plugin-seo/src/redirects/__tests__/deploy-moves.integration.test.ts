/**
 * A deploy that moves a published page's address, found by the catch-up at
 * the next start, leaves a permanent redirect from the old address, as a
 * save would. The route has already moved, so a redirect that cannot be
 * saved does not keep the old address: it is listed as a broken link. A page
 * left without an address by a clash gets no redirect to the address it lost.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { definePlugin, type PluginContext } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly";
import { eq, inArray } from "@nextlyhq/plugin-sdk/db";
import { afterEach, describe, expect, it } from "vitest";

import { catchUp, lastCatchUp } from "../../address-record/catch-up";
import {
  claimRows,
  forgetNote,
  noteRows,
  seoContext,
} from "../../address-record/__tests__/record-tables";
import { claimKey } from "../../address-record/rows";
import { addressClaims } from "../../schema/tables";
import { readNotFoundLog } from "../../not-found/log";
import { keptSeoContext } from "../../not-found/report";
import { seoPlugin } from "../../plugin";
import { REDIRECTS_SLUG } from "../collection";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const faults = { failRedirects: false, failClaimOf: "" };

async function boot(dialect: TestDialect) {
  faults.failRedirects = false;
  faults.failClaimOf = "";
  current = await createTestNextly({
    dialect,
    plugins: [
      seoPlugin({ collections: ["pages", "posts"] }),
      definePlugin({
        name: "@test/redirect-faults",
        version: "1.0.0",
        nextly: ">=0.0.0",
        init(ctx: PluginContext) {
          ctx.hooks.on("beforeCreate", REDIRECTS_SLUG, () => {
            if (faults.failRedirects)
              throw new Error("the redirect store is down");
          });
          // A start that stops part-way: a record beside the SEO plugin's
          // fails one claim, which undoes the whole move.
          ctx.publicAddresses.participate({
            holderOf: async () => null,
            record: async batch => {
              if (
                batch.some(update =>
                  update.holds.some(held => held.path === faults.failClaimOf)
                )
              ) {
                throw new Error("the start stopped here");
              }
            },
          });
        },
      }),
    ],
    collections: ["pages", "posts"].map(slug =>
      defineCollection({
        slug,
        status: true,
        fields: [text({ name: "title" }), text({ name: "slug" })],
        publicAddress: "/{slug}",
      })
    ),
  });
  return current;
}

async function publish(t: TestNextly, collection: string, slug: string) {
  const created = await t.nextly.create({
    collection,
    data: { title: slug, slug, status: "published" },
  });
  return String(created.item.id);
}

async function rows(_t: TestNextly) {
  return claimRows();
}

/**
 * Make the record say `holder` holds `path`, as it did before a deploy moved
 * the page, and forget the fingerprint, as the changed template would.
 */
async function heldBeforeTheDeploy(
  t: TestNextly,
  holder: { collection: string; id: string },
  path: string
) {
  const seo = seoContext();
  const columns = seo.db.table(addressClaims);
  for (const row of await rows(t)) {
    if (
      row.holderCollection === holder.collection &&
      row.holderId === holder.id
    ) {
      await seo.db
        .update(addressClaims, {
          path,
          claimKey: claimKey("address", "en", path),
        })
        .where(eq(columns.id, String(row.id)));
    }
  }
  await forgetNote("fingerprint");
}

/** Run the catch-up again, as the next start would. */
async function restart(options?: Parameters<typeof catchUp>[0]) {
  if (lastCatchUp() === undefined) throw new Error("no catch-up ever started");
  return catchUp(options);
}

async function redirects(t: TestNextly) {
  const { items } = await t.nextly.find({
    collection: REDIRECTS_SLUG,
    limit: 500,
  });
  return Object.fromEntries(
    (items as Record<string, unknown>[]).map(row => [
      `${row.locale}|${row.source}`,
      `${row.target} ${row.permanent ? "permanent" : "temporary"} ${row.origin}`,
    ])
  );
}

async function notFound(_t: TestNextly) {
  const seo = keptSeoContext();
  if (!seo) throw new Error("the SEO plugin never started");
  return (await readNotFoundLog(seo)).map(row => `${row.path} ${row.kind}`);
}

async function held(t: TestNextly) {
  return Object.fromEntries(
    (await rows(t))
      .filter(row => row.kind === "address")
      .map(row => [`${row.locale}|${row.path}`, String(row.holderCollection)])
  );
}

describe.each(getConfiguredTestDialects())("a deploy's moves (%s)", dialect => {
  it("leave a permanent redirect from the address a page held before", async () => {
    const t = await boot(dialect);
    const page = await publish(t, "pages", "new");
    await restart();
    await heldBeforeTheDeploy(t, { collection: "pages", id: page }, "/old");

    await restart();

    expect(await redirects(t)).toEqual({
      "en|/old": "/new permanent automatic",
    });
    expect(await held(t)).toEqual({
      "en|/new": "pages",
      "en|/old": REDIRECTS_SLUG,
    });
  });

  it("send a page's old address to that page, when another page moves on from its new one", async () => {
    const t = await boot(dialect);
    // After the deploy, A is at `/b`, and B, which was at `/b`, is at `/c`.
    const a = await publish(t, "pages", "b");
    const b = await publish(t, "posts", "c");
    await restart();
    await heldBeforeTheDeploy(t, { collection: "pages", id: a }, "/a");
    await heldBeforeTheDeploy(t, { collection: "posts", id: b }, "/b");

    await restart();

    expect(await redirects(t)).toEqual({ "en|/a": "/b permanent automatic" });
    expect(await held(t)).toEqual({
      "en|/a": REDIRECTS_SLUG,
      "en|/b": "pages",
      "en|/c": "posts",
    });
  });

  it("still leave the redirect after a start that stopped between letting go and claiming", async () => {
    const t = await boot(dialect);
    const page = await publish(t, "pages", "new");
    await restart();
    await heldBeforeTheDeploy(t, { collection: "pages", id: page }, "/old");
    faults.failClaimOf = "/new";
    await restart();
    expect(await held(t)).toEqual({});

    faults.failClaimOf = "";
    await restart();

    expect(await redirects(t)).toEqual({
      "en|/old": "/new permanent automatic",
    });
    expect(await held(t)).toEqual({
      "en|/new": "pages",
      "en|/old": REDIRECTS_SLUG,
    });
    expect((await noteRows()).filter(row => row.kind === "pending")).toEqual(
      []
    );
  });

  it("send the old address where the page is now, when a save moved it during the start", async () => {
    const t = await boot(dialect);
    const page = await publish(t, "pages", "new");
    await restart();
    await heldBeforeTheDeploy(t, { collection: "pages", id: page }, "/old");

    await restart({
      // A person saves the page at a third address while the start runs.
      afterReleases: async () => {
        await t.nextly.update({
          collection: "pages",
          id: page,
          data: { slug: "latest", _overwrite: true },
        });
      },
    });

    expect(await redirects(t)).toEqual({
      "en|/old": "/latest permanent automatic",
    });
    expect(await held(t)).toEqual({
      "en|/latest": "pages",
      "en|/old": REDIRECTS_SLUG,
    });
  });

  it("list the old address as a broken link where its redirect cannot be saved", async () => {
    const t = await boot(dialect);
    const page = await publish(t, "pages", "new");
    await restart();
    await heldBeforeTheDeploy(t, { collection: "pages", id: page }, "/old");
    faults.failRedirects = true;

    await restart();

    expect(await redirects(t)).toEqual({});
    expect(await held(t)).toEqual({ "en|/new": "pages" });
    expect(await notFound(t)).toEqual(["/old moved"]);
  });

  it("leave no redirect to an address the page then lost to the page already holding it", async () => {
    const t = await boot(dialect);
    const holder = await publish(t, "pages", "new");
    await restart();
    // Made where a save could not refuse it: the record forgets the page
    // holding `/new` while a second page is published there.
    const seo = seoContext();
    await seo.db
      .delete(addressClaims)
      .where(inArray(seo.db.table(addressClaims).kind, ["address", "range"]));
    const loser = await publish(t, "posts", "new");
    await heldBeforeTheDeploy(t, { collection: "posts", id: loser }, "/old");
    await seo.db.insert(addressClaims, {
      claimKey: claimKey("address", "en", "/new"),
      kind: "address",
      locale: "en",
      path: "/new",
      holderCollection: "pages",
      holderId: holder,
    });

    const report = await restart();

    expect(report.lost.map(lost => lost.holder.id)).toEqual([loser]);
    expect(await redirects(t)).toEqual({});
    expect(await held(t)).toEqual({ "en|/new": "pages" });
  });
});
