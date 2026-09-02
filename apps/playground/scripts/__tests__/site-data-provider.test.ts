/**
 * What a dynamic block reads, and the one place the two pagination models meet.
 *
 * `BlocksQuery` carries an OFFSET and Nextly reads by PAGE. Translating between
 * them is the only decision this adapter makes, and it is the kind that fails
 * quietly: serving entries 4 to 6 for a request that asked for 6 to 8 produces a
 * page that renders, looks plausible, and is wrong.
 */
import { describe, expect, it } from "vitest";

import { createSiteDataProvider } from "../../src/lib/site-content";

/** A reader that records what it was asked and answers with one row. */
function stubReader() {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    reader: {
      find: (args: Record<string, unknown>) => {
        calls.push(args);
        return Promise.resolve({
          items: [{ id: "a" }],
          meta: { total: 7 },
        });
      },
    } as never,
  };
}

describe("the site's data provider", () => {
  it("passes the collection through and reshapes the result", () => {
    /*
     * Nextly answers `{ items, meta: { total } }` and a block reads
     * `{ items, total }`. The counts live at different depths, so a provider
     * that forwarded the envelope unchanged would leave every block reading
     * `undefined` for its total.
     */
    const { reader, calls } = stubReader();

    return createSiteDataProvider(reader)
      .find({ collection: "posts", limit: 3 })
      .then(result => {
        expect(calls[0]).toMatchObject({ collection: "posts", limit: 3 });
        expect(result.items).toEqual([{ id: "a" }]);
        expect(result.total).toBe(7);
      });
  });

  it("reads as an ANONYMOUS visitor, never as the process", () => {
    /*
     * The precondition, and the reason it is asserted rather than trusted to a
     * comment: a stored block document names the collection it loops, and this
     * route answers anyone with a URL. `Nextly.find` defaults to a TRUSTED read
     * that evaluates no access rule and applies no lifecycle filter, so the
     * bare call hands a public page rows nobody was allowed to see.
     *
     * Measured against the seeded playground data before this was fixed: the
     * bare call returned 5 posts including 2 drafts, where the enforced and
     * published-only reads each returned 3.
     *
     * Both flags, because they answer different questions — access decides who
     * may see a row, the lifecycle decides whether it is public yet — so a test
     * asserting only one would pass on a provider that leaked the other.
     */
    const { reader, calls } = stubReader();

    return createSiteDataProvider(reader)
      .find({ collection: "posts", limit: 3 })
      .then(() => {
        expect(calls[0]).toMatchObject({
          overrideAccess: false,
          status: "published",
        });
      });
  });

  it("asks for no page at all when the query has no offset", () => {
    // The ordinary case, and the only one `core/collection-loop` produces: a
    // `page` sent unasked would pin every loop to the first page whatever the
    // reader's own default is.
    const { reader, calls } = stubReader();

    return createSiteDataProvider(reader)
      .find({ collection: "posts", limit: 3 })
      .then(() => {
        expect(Object.hasOwn(calls[0] ?? {}, "page")).toBe(false);
      });
  });

  it("turns an offset that IS a whole number of pages into that page", () => {
    // Offset 6 with limit 3 is the third page, counting from one.
    const { reader, calls } = stubReader();

    return createSiteDataProvider(reader)
      .find({ collection: "posts", limit: 3, offset: 6 })
      .then(() => {
        expect(calls[0]).toMatchObject({ limit: 3, page: 3 });
      });
  });

  it("REFUSES an offset that names no page, rather than serving the nearest", () => {
    /*
     * The decision this file exists for. Flooring offset 5 with limit 3 to page
     * 2 serves entries 4 to 6 for a request that asked for 6 to 8 — a wrong
     * answer that renders perfectly and that nobody reports, which is worse than
     * a failure.
     *
     * Unreachable today, because `core/collection-loop` sends no offset at all.
     * That is what makes the guard cheap rather than what makes it unnecessary:
     * the next block that reads a page of entries gets a loud failure instead of
     * a plausible one.
     */
    const { reader } = stubReader();

    return expect(
      createSiteDataProvider(reader).find({
        collection: "posts",
        limit: 3,
        offset: 5,
      })
    ).rejects.toThrow(/names no page/);
  });

  it("treats offset zero as the first page, not as a refusal", () => {
    // Must-differ: zero is a legal offset and divides every limit, so a guard
    // that refused it would reject the commonest explicit query there is.
    const { reader, calls } = stubReader();

    return createSiteDataProvider(reader)
      .find({ collection: "posts", limit: 3, offset: 0 })
      .then(() => {
        expect(Object.hasOwn(calls[0] ?? {}, "page")).toBe(false);
      });
  });
});
