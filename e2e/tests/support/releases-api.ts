/**
 * Releases written through the API, for the release specs.
 *
 * Each spec names what it writes with a stamp of its own, so what it reads
 * back is exactly what it wrote, whatever else the suite's database holds.
 *
 * @module e2e/tests/support/releases-api
 */
import { expect, type Page } from "@playwright/test";

const API = "/admin/api";

/**
 * What the helpers write through: a page, or any session's request context
 * wrapped as one, for a spec seeding through more than one account.
 */
export type Requester = Pick<Page, "request">;

/** The response's JSON, once the response is known to be a success. */
export async function ok<T>(
  response: Awaited<ReturnType<Page["request"]["post"]>>
): Promise<T> {
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as T;
}

/** A post to put in releases: a release with no documents is not scheduled. */
export async function post(page: Requester, stamp: string): Promise<string> {
  const { item } = await ok<{ item: { id: string } }>(
    await page.request.post(`${API}/collections/posts/entries`, {
      data: { title: `Release e2e ${stamp}`, slug: `release-e2e-${stamp}` },
    })
  );
  return item.id;
}

/** A release holding one post, created as a draft. */
export async function release(
  page: Requester,
  title: string,
  postId: string
): Promise<string> {
  const { item } = await ok<{ item: { id: string } }>(
    await page.request.post(`${API}/releases`, { data: { title } })
  );
  await ok(
    await page.request.post(`${API}/releases/${item.id}/members`, {
      data: {
        scopeKind: "collection",
        scopeSlug: "posts",
        entryId: postId,
        action: "publish",
      },
    })
  );
  return item.id;
}

/** Schedule a release for `at`, stated in `timezone`. */
export async function schedule(
  page: Requester,
  id: string,
  at: Date,
  timezone: string
): Promise<void> {
  await ok(
    await page.request.post(`${API}/releases/${id}/schedule`, {
      data: { at: at.toISOString(), timezone },
    })
  );
}

/** Run a release now, as Publish now does. */
export async function publishNow(page: Requester, id: string): Promise<void> {
  await ok(
    await page.request.post(`${API}/releases/${id}/publish`, { data: {} })
  );
}

/** Cancel a release. */
export async function cancel(page: Requester, id: string): Promise<void> {
  await ok(
    await page.request.post(`${API}/releases/${id}/cancel`, { data: {} })
  );
}

/**
 * How many releases each day from `from` to `to` holds, read in `timezone`,
 * from the calendar read the admin draws its grid from. A window of at most
 * six weeks, as that read takes.
 */
export async function releasesPerDay(
  page: Requester,
  from: string,
  to: string,
  timezone: string
): Promise<Map<string, number>> {
  const search = new URLSearchParams({ from, to, timezone });
  const response = await page.request.get(
    `${API}/releases/calendar?${search.toString()}`
  );
  expect(response.ok(), await response.text()).toBe(true);
  const read = (await response.json()) as {
    days: { date: string; total: number }[];
  };
  return new Map(read.days.map(day => [day.date, day.total]));
}

/**
 * Put one post into a release in one step, as the editor's Schedule… does:
 * `into` names the way, and the rest of `body` is that way's fields.
 */
export async function scheduleDocument(
  page: Requester,
  postId: string,
  action: "publish" | "unpublish",
  body: Record<string, unknown>
): Promise<string> {
  const { item } = await ok<{ item: { release: { id: string } } }>(
    await page.request.post(`${API}/releases/schedule-document`, {
      data: {
        document: {
          scopeKind: "collection",
          scopeSlug: "posts",
          entryId: postId,
          action,
        },
        ...body,
      },
    })
  );
  return item.release.id;
}

/** The documents a release holds, with what it does to each. */
export async function membersOf(
  page: Requester,
  id: string
): Promise<Array<{ entryId: string; action: string }>> {
  const { items } = await ok<{
    items: Array<{ entryId: string; action: string }>;
  }>(await page.request.get(`${API}/releases/${id}/members`));
  return items;
}

/** One release as its page reads it. */
export async function readRelease(
  page: Requester,
  id: string
): Promise<{ title: string; description: string | null; state: string }> {
  type Read = { title: string; description: string | null; state: string };
  // A detail read answers the release itself; an envelope is unwrapped.
  const body = await ok<Read | { item: Read }>(
    await page.request.get(`${API}/releases/${id}`)
  );
  return "item" in body ? body.item : body;
}
