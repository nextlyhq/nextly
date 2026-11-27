/**
 * The copies of root files kept to serve while the address record catches
 * up: kept and read back on every dialect, replaced by a later answer, and
 * written with their digest together, so two answers kept at once never
 * leave one's digest beside the other's copy. A digest matching no copy would
 * stop every later answer with the same words from being kept.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly";
import { afterEach, describe, expect, it } from "vitest";

import { holdNextStatement } from "../../__tests__/count-statements";
import { seoContext } from "../../address-record/__tests__/record-tables";
import { lastStartWork } from "../../start-work";
import {
  noteKey,
  putNotesTogether,
  readNotes,
} from "../../address-record/store";
import { seoPlugin } from "../../plugin";
import { keepCopy, keptCopy } from "../last-good";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<void> {
  current = await createTestNextly({
    dialect,
    plugins: [seoPlugin({ collections: ["pages"] })],
    collections: [
      defineCollection({
        slug: "pages",
        fields: [text({ name: "title" })],
        publicAddress: "/{title}",
      }),
    ],
  });
  // The start's own background work, its commits among them, done first.
  await lastStartWork();
}

const XML = "application/xml; charset=utf-8";

describe.each(getConfiguredTestDialects())(
  "the root files' kept copies (%s)",
  dialect => {
    it("are kept, read back, and replaced by a later answer", async () => {
      await boot(dialect);
      const seo = seoContext();
      expect(await keptCopy(seo, "sitemap")).toBeUndefined();

      await keepCopy(seo, "sitemap", { body: "<urlset/>", contentType: XML });
      const first = await keptCopy(seo, "sitemap");
      expect(first).toMatchObject({ body: "<urlset/>", contentType: XML });
      expect(Number.isNaN(Date.parse(first?.keptAt ?? ""))).toBe(false);

      await keepCopy(seo, "sitemap", {
        body: "<urlset><url/></urlset>",
        contentType: XML,
      });
      expect((await keptCopy(seo, "sitemap"))?.body).toBe(
        "<urlset><url/></urlset>"
      );
      // Each file is kept under its own name.
      expect(await keptCopy(seo, "other")).toBeUndefined();
    });

    it("keeps a file larger than one MySQL TEXT column holds, whole, and a shorter one after it", async () => {
      await boot(dialect);
      const seo = seoContext();
      // Over 64 KB in UTF-8 many times over, with characters of two, three
      // and four bytes, one of them written as two halves (a surrogate
      // pair) that a part must never split.
      const line = "<url><loc>https://acme.example/é/€/😀</loc></url>\n";
      const large = `<urlset>${line.repeat(8000)}</urlset>`;
      expect(Buffer.byteLength(large, "utf8")).toBeGreaterThan(5 * 65_535);
      await keepCopy(seo, "sitemap", { body: large, contentType: XML });
      expect((await keptCopy(seo, "sitemap"))?.body).toBe(large);

      // A shorter copy after it is read back as itself, not with the longer
      // copy's last parts.
      const small = `<urlset>${line}</urlset>`;
      await keepCopy(seo, "sitemap", { body: small, contentType: XML });
      expect((await keptCopy(seo, "sitemap"))?.body).toBe(small);
    });
  }
);

const postgres = getConfiguredTestDialects().filter(
  dialect => dialect === "postgresql"
);

describe.each(postgres)("notes written together (%s)", dialect => {
  it("leave one writer's values in every note when two write at once", async () => {
    await boot(dialect);
    const seo = seoContext();
    const keys = [noteKey("together-a"), noteKey("together-b")];
    const pair = (value: string) => keys.map(key => ({ key, value }));
    // Made first, so the writes below are the paired updates alone.
    await putNotesTogether(seo, pair("0"));

    // The first writer holds both notes, its commit not yet sent.
    const freeze = holdNextStatement(dialect, /^\s*commit/i);
    const first = putNotesTogether(seo, pair("1"));
    await freeze.reached;
    const second = putNotesTogether(seo, pair("2"));
    let secondDone = false;
    void second.then(() => {
      secondDone = true;
    });
    // The second waits for the first, rather than writing between its two.
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(secondDone).toBe(false);

    freeze.release();
    await first;
    await second;
    const { notes } = await readNotes(seo, keys);
    expect(keys.map(key => notes.get(key))).toEqual(["2", "2"]);
  }, 30_000);
});
