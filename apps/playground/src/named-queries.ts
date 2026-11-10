/**
 * Named queries — e2e fixtures, registered only when
 * `NEXTLY_E2E_STYLE_FIXTURE=1`, like the collections they read.
 *
 * A collection list's custom source, for the browser tests of one served to
 * the public and drawn in the editor:
 *
 * - **Blog posts with a story** has rows of its own field schema. Each row
 *   is a blog post (`bound-entries`, its result) with the title of a story
 *   (`list-stories`, a collection it reads beside its result) and the
 *   homepage's title (`homepage`, a Single it reads). A page listing it must
 *   refresh when either of the last two changes, though neither is what the
 *   list lists. Its run copies each post's `internalNote`, which the public
 *   may not read, into its rows: the reader hands it over absent, so it can
 *   never reach the page.
 * - **Posts by title** has rows that are a collection's entries: `bound-entries`
 *   itself, projected to what visitors may read.
 * - **Priced blog posts** asks for one of each kind of input, for the
 *   editor's test of the Inputs group.
 * - **Featured posts (failing)** and **Blog posts with history notes** are
 *   the editor's failure and caution: a run that throws, and one reading a
 *   collection visitors can read nothing of.
 *
 * The first two take a required `match`, so a test lists only the rows it
 * made, the other tests' rows of the same collections left out.
 */
import {
  defineNamedQuery,
  param,
  type NamedQueryReader,
} from "@nextlyhq/plugin-sdk/blocks";

/** The text every row's title holds, as the list's input names it. */
const match = param.text({
  label: "Title words",
  required: true,
  maxLength: 80,
  placeholder: "Words in the title",
});

/** The blog posts whose title has `match`, in the list's window, by title. */
async function postsMatching(
  reader: NamedQueryReader,
  match: string,
  window: { readonly limit: number; readonly offset: number }
): Promise<Awaited<ReturnType<NamedQueryReader["find"]>>> {
  return await reader.find({
    collection: "bound-entries",
    filters: [{ field: "title", op: "contains", value: match }],
    sort: "title",
    limit: window.limit,
    offset: window.offset,
  });
}

const postsWithStory = defineNamedQuery({
  name: "e2e.posts-with-story",
  label: "Blog posts with a story",
  description: "Each blog post, with a story's title and the homepage's.",
  params: { match },
  reads: {
    collections: ["bound-entries", "list-stories"],
    singles: ["homepage"],
  },
  rows: {
    key: "id",
    fields: [
      { name: "id", type: "text" },
      { name: "title", type: "text" },
      { name: "story", type: "text" },
      { name: "headline", type: "text" },
      { name: "internalNote", type: "text" },
    ],
  },
  total: true,
  async run({ params, window, reader }) {
    const posts = await postsMatching(reader, params.match, window);
    const stories = await reader.find({
      collection: "list-stories",
      filters: [{ field: "title", op: "contains", value: params.match }],
      sort: "title",
      limit: 1,
      select: ["title"],
    });
    const homepage = await reader.findSingle({
      slug: "homepage",
      select: ["title"],
    });
    return {
      total: posts.meta.total,
      rows: posts.items.map(post => ({
        id: String(post.id),
        title: post.title,
        story: stories.items[0]?.title,
        headline: homepage?.title,
        // Copied as the reader gave it: absent, since visitors may not read
        // it. Were it present, the projection would still keep it only as
        // declared, so this is the case the page must survive.
        internalNote: post.internalNote,
      })),
    };
  },
});

const blogPosts = defineNamedQuery({
  name: "e2e.blog-posts",
  label: "Posts by title",
  description: "The blog posts whose title has the words you give.",
  params: { match },
  reads: { collections: ["bound-entries"] },
  rows: { collection: "bound-entries" },
  async run({ params, window, reader }) {
    return {
      rows: (await postsMatching(reader, params.match, window)).items,
    };
  },
});

/**
 * One of each input an author can be asked for, for the editor's browser
 * test of the Inputs group: a choice it needs, text, a day defaulting to
 * today, a number of days, yes or no, and an entry.
 */
const pricedPosts = defineNamedQuery({
  name: "e2e.priced-posts",
  label: "Priced blog posts",
  description: "Blog posts at or under a price, newest first.",
  params: {
    band: param.choice({
      label: "Price band",
      required: true,
      options: [
        { value: "low", label: "Under 50" },
        { value: "high", label: "50 and over" },
      ],
    }),
    keyword: param.text({
      label: "Keyword",
      maxLength: 80,
      placeholder: "Any words",
    }),
    from: param.day({ label: "From", default: "today" }),
    within: param.number({
      label: "Within",
      unit: "days",
      integer: true,
      min: 1,
      max: 365,
      default: 30,
    }),
    freeOnly: param.boolean({ label: "Free only" }),
    related: param.entry({ label: "Related page", collection: "block-pages" }),
  },
  reads: { collections: ["bound-entries", "block-pages"] },
  rows: { collection: "bound-entries" },
  total: true,
  async run({ params, window, reader, today }) {
    const from = params.from === "today" ? today : params.from;
    const until = new Date(`${from}T00:00:00.000Z`);
    until.setUTCDate(until.getUTCDate() - params.within);
    const posts = await reader.find({
      collection: "bound-entries",
      filters: [
        params.freeOnly
          ? { field: "price", op: "equals", value: 0 }
          : params.band === "low"
            ? { field: "price", op: "lt", value: 50 }
            : { field: "price", op: "gte", value: 50 },
        { field: "publishedAt", op: "gte", value: until.toISOString() },
        ...(params.keyword === undefined
          ? []
          : [
              {
                field: "title",
                op: "contains",
                value: params.keyword,
              } as const,
            ]),
        ...(params.related === undefined
          ? []
          : [
              {
                field: "relatedPage",
                op: "equals",
                value: params.related,
              } as const,
            ]),
      ],
      sort: "-publishedAt",
      limit: window.limit,
      offset: window.offset,
    });
    return { total: posts.meta.total, rows: posts.items };
  },
});

/**
 * A query whose run fails, for the editor's note on a failed run: the error
 * it throws carries words an author must never be shown.
 */
const failingPosts = defineNamedQuery({
  name: "e2e.failing-posts",
  label: "Featured posts (failing)",
  description: "A query whose upstream refuses every request.",
  reads: { collections: ["bound-entries"] },
  rows: { collection: "bound-entries" },
  run: () =>
    Promise.reject(new Error("upstream refused: ECONNREFUSED token=demo")),
});

/**
 * A query that reads a collection visitors can read nothing of
 * (`history-notes`, which declares no read rule), for the editor's caution
 * naming the fields a published list of it goes without. It lists blog
 * posts, so it still draws rows.
 */
const postsWithNotes = defineNamedQuery({
  name: "e2e.posts-with-notes",
  label: "Blog posts with history notes",
  description: "Each blog post, beside the newest history note.",
  reads: { collections: ["bound-entries", "history-notes"] },
  rows: { collection: "bound-entries" },
  async run({ window, reader }) {
    // A visitor reads none of it: the published page gets nothing here.
    await reader
      .find({ collection: "history-notes", limit: 1 })
      .catch(() => undefined);
    return {
      rows: (
        await reader.find({
          collection: "bound-entries",
          sort: "title",
          limit: window.limit,
          offset: window.offset,
        })
      ).items,
    };
  },
});

/** The playground's named queries, in the order the Source menu lists them. */
export const E2E_NAMED_QUERIES = [
  postsWithStory,
  blogPosts,
  pricedPosts,
  failingPosts,
  postsWithNotes,
] as const;
