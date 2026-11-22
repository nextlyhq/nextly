/**
 * Every title and slug a collection's rows hold, whatever their state: what
 * the seed reads before it names the set and the starter components it
 * creates, so it never takes a name an author already holds.
 *
 * @module default-layout/taken-names
 */
import type { DefaultLayoutDirectApi } from "./store";

/** How many rows one page of the scan reads. */
const NAME_SCAN_PAGE_SIZE = 100;

/**
 * Every stored row's title and slug, read as the only columns asked for.
 *
 * Every state is read, because a draft holds its slug's unique value as
 * firmly as a published row does, and paged to the end, so a clash past the
 * first page still moves the name.
 */
export async function takenNames(
  nextly: Pick<DefaultLayoutDirectApi, "find">,
  collection: string
): Promise<{ titles: Set<string>; slugs: Set<string> }> {
  const titles = new Set<string>();
  const slugs = new Set<string>();
  for (let page = 1; ; page += 1) {
    const found = await nextly.find({
      collection,
      status: "all",
      limit: NAME_SCAN_PAGE_SIZE,
      page,
      // A fixed order, so the pages partition the rows. Sorting by id needs
      // no id in the selection.
      sort: "id",
      depth: 0,
      // The scan compares names and nothing else.
      select: { title: true, slug: true },
      overrideAccess: true,
    });
    for (const row of found.items) {
      const { title, slug } = row as { title?: unknown; slug?: unknown };
      if (typeof title === "string") titles.add(title);
      if (typeof slug === "string") slugs.add(slug);
    }
    if (!found.meta.hasNext) return { titles, slugs };
  }
}
