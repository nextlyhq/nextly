/**
 * Seeds the pages the builder's speed check measures (`seed/speed-fixture`):
 * three images, the Layout's header and footer, a card component, the Layout,
 * and the 150, 4, 20 and 38-block pages, all published.
 *
 *   pnpm --filter playground exec tsx scripts/seed-speed-fixture.ts
 *
 * Run after the playground's own seed (the posts the large page lists come
 * from it), against whatever `DB_DIALECT` and `DATABASE_URL` name, so it seeds
 * SQLite, PostgreSQL and MySQL alike. The speed script runs it before it
 * builds; a deployed preview runs it once against its own database.
 *
 * Every row is found by its slug. A row already there is put back to the
 * fixture's shape rather than left as it is: the speed script edits and
 * publishes these pages while it measures, and the next run must measure the
 * same page, not whatever the last one left.
 *
 * Not part of `seed.ts`: a contributor's database, and the browser suites',
 * have no use for four large pages, and their page lists would change.
 *
 * @module scripts/seed-speed-fixture
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { getNextly } from "nextly";

import { isCliEntry } from "../../../scripts/cli-entry.mjs";
import config from "../nextly.config";
import {
  SPEED_FIXTURE_BLOCKS,
  SPEED_FIXTURE_SLUGS,
  speedCardDocument,
  speedFooterDocument,
  speedHeaderDocument,
  speedPageDocument,
  type SpeedFixturePage,
} from "../seed/speed-fixture";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MEDIA_DIR = path.resolve(HERE, "..", "seed", "media");

/** The seed's own pictures, stored again under names only this fixture uses. */
const IMAGES = [
  ["hero-desk.webp", "speed-fixture-1.webp"],
  ["sample-1.webp", "speed-fixture-2.webp"],
  ["sample-2.webp", "speed-fixture-3.webp"],
] as const;

/** The slice of the Nextly client this seeder uses. */
export interface SpeedFixtureStore {
  find(args: {
    collection: string;
    where: { slug: { equals: string } };
    limit: number;
  }): Promise<{ items: Array<{ id?: unknown; _rev?: unknown }> }>;
  create(args: {
    collection: string;
    data: Record<string, unknown>;
  }): Promise<{ item: { id?: unknown } }>;
  update(args: {
    collection: string;
    id: string;
    data: Record<string, unknown>;
  }): Promise<unknown>;
  media: {
    find(args: { search: string; limit: number }): Promise<{
      items: Array<{
        id?: unknown;
        filename?: string;
        originalFilename?: string;
      }>;
    }>;
    upload(args: {
      file: { data: Buffer; name: string; mimetype: string; size: number };
      altText: string;
    }): Promise<{ id: unknown }>;
  };
}

async function picture(
  nextly: SpeedFixtureStore,
  source: string,
  name: string
): Promise<string> {
  const found = await nextly.media.find({ search: name, limit: 5 });
  // Storage files the upload under a dated, unique key that ends in the name.
  const stored = found.items.find(
    item =>
      item.originalFilename === name ||
      item.filename === name ||
      item.filename?.endsWith(`-${name}`)
  );
  if (typeof stored?.id === "string") return stored.id;
  const data = await fs.readFile(path.join(MEDIA_DIR, source));
  const made = await nextly.media.upload({
    file: { data, name, mimetype: "image/webp", size: data.length },
    altText: "Speed fixture picture",
  });
  return String(made.id);
}

/**
 * The published row under `slug`, made with `data` when there is none, and
 * put back to `data` when there is: the version read is the one updated, so
 * an edit made in between is refused rather than overwritten.
 */
async function put(
  nextly: SpeedFixtureStore,
  collection: string,
  slug: string,
  data: Record<string, unknown>
): Promise<{ id: string; created: boolean }> {
  const found = await nextly.find({
    collection,
    where: { slug: { equals: slug } },
    limit: 1,
  });
  const row = found.items[0];
  if (typeof row?.id === "string") {
    await nextly.update({
      collection,
      id: row.id,
      data: { ...data, status: "published", _rev: row._rev },
    });
    return { id: row.id, created: false };
  }
  const made = await nextly.create({
    collection,
    data: { ...data, slug, status: "published" },
  });
  if (typeof made.item.id !== "string") {
    throw new Error(
      `[speed-fixture] creating ${collection}/${slug} answered no id`
    );
  }
  return { id: made.item.id, created: true };
}

const PAGE_TITLES: Record<SpeedFixturePage, string> = {
  large: "Speed fixture: 150 blocks",
  small: "Speed fixture: 4 blocks",
  twenty: "Speed fixture: 20 blocks",
  thirtyEight: "Speed fixture: 38 blocks",
};

/** Seeds every part of the fixture; returns the pages' ids by size. */
export async function seedSpeedFixture(
  nextly: SpeedFixtureStore
): Promise<Record<SpeedFixturePage, string>> {
  const media: string[] = [];
  for (const [source, name] of IMAGES) {
    media.push(await picture(nextly, source, name));
  }
  const header = await put(nextly, "components", SPEED_FIXTURE_SLUGS.header, {
    title: "Speed fixture header",
    area: "header",
    content: speedHeaderDocument(media),
  });
  const footer = await put(nextly, "components", SPEED_FIXTURE_SLUGS.footer, {
    title: "Speed fixture footer",
    area: "footer",
    content: speedFooterDocument(media),
  });
  const card = await put(nextly, "components", SPEED_FIXTURE_SLUGS.card, {
    title: "Speed fixture card",
    description: "A card with a picture, a title, a text and a link.",
    content: speedCardDocument(media),
  });
  const layout = await put(nextly, "layouts", SPEED_FIXTURE_SLUGS.layout, {
    title: "Speed fixture site",
    description: "The header and footer the speed fixture pages are drawn in.",
    areas: [
      { area: "header", component: header.id },
      { area: "footer", component: footer.id },
    ],
  });
  const ids = {} as Record<SpeedFixturePage, string>;
  for (const which of Object.keys(SPEED_FIXTURE_BLOCKS) as SpeedFixturePage[]) {
    const page = await put(nextly, "pages", SPEED_FIXTURE_SLUGS.pages[which], {
      title: PAGE_TITLES[which],
      layout: layout.id,
      noHeaderFooter: false,
      content: speedPageDocument(which, media, card.id),
    });
    ids[which] = page.id;
  }
  return ids;
}

// Top-level await is unavailable where tsx compiles this to CommonJS.
if (isCliEntry(import.meta.url)) {
  void (async () => {
    try {
      const nextly = (await getNextly({
        config,
      })) as unknown as SpeedFixtureStore;
      const ids = await seedSpeedFixture(nextly);
      // One line the speed script reads the page ids from.
      console.log(`[speed-fixture] ${JSON.stringify(ids)}`);
      process.exit(0);
    } catch (error) {
      console.error(
        "[speed-fixture] seed failed:",
        error instanceof Error ? (error.stack ?? error.message) : String(error)
      );
      process.exit(1);
    }
  })();
}
