/**
 * "May this caller read the collection?" under a read rule that answers a
 * filter: yes, the entries it matches. And a read that question then lets
 * run applies the filter, so a document outside it stays unreadable.
 *
 * The property that separates a correct answer from a plausible broken one
 * is the second half. Answering "yes" alone would let the reads behind the
 * question, a document's autosave or its lock, show a document the rule
 * excludes. So each case reads one document the filter matches and one it
 * does not, and compares the second with a document that does not exist.
 *
 * @module domains/collections/__tests__/read-rule-filter-may-read.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import { userWhoMay } from "../../../__tests__/fixtures/permission-holders";
import { runWithAccessMemo } from "../../../auth/access/request-memo";
import { canReadEntity } from "../../../auth/entity-read-access";
import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { readAccessCaller } from "../../../auth/entity-read-access";
import { defineCollection, text } from "../../../config";
import { getAutosaveForDocument } from "../../../dispatcher/handlers/versions-methods";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";

// Integration files share fixed system-table names, so this file keeps its
// own collection slug.
const NOTES = "rulefilter_mayread_notes";
const READER = "rulefilter-mayread-reader";
const ORIGIN = "http://localhost";

/** A read rule answering `value`, unchecked by the filter type, as untyped code may. */
const answering = (value: unknown) => () => value as boolean;

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

interface Seeded {
  t: TestNextly;
  /** An entry the filter matches. */
  inside: string;
  /** An entry it does not match. */
  outside: string;
  /** An id an entry had, and no entry has now. */
  gone: string;
}

async function boot(): Promise<Seeded> {
  const t = await createTestNextly({
    collections: [
      defineCollection({
        slug: NOTES,
        versions: true,
        access: { read: answering({ team: { equals: "public" } }) },
        fields: [text({ name: "title" }), text({ name: "team" })],
      }),
    ],
  });
  current = t;
  // The rule narrows the read permission, so the reader holds it.
  await userWhoMay(t, READER, "read", [NOTES]);
  const made = async (team: string) => {
    const created = await t.nextly.create({
      collection: NOTES,
      data: { title: team, team },
    });
    return String((created.item as { id: string | number }).id);
  };
  const inside = await made("public");
  const outside = await made("staff");
  const gone = await made("staff");
  await t.nextly.delete({ collection: NOTES, id: gone });
  return { t, inside, outside, gone };
}

const reader = readAccessCaller({ user: { id: READER } });

/** What reading `id`'s autosave answers the reader, inside one request. */
async function autosaveRead(id: string): Promise<unknown> {
  try {
    await runWithAccessMemo(() =>
      getAutosaveForDocument({
        scopeKind: "collection",
        slug: NOTES,
        entryId: id,
        user: { id: READER },
        params: {},
      })
    );
    return "read";
  } catch (error) {
    const refused = error as { statusCode?: unknown; code?: unknown };
    return { statusCode: refused.statusCode, code: refused.code };
  }
}

/** The reader's REST read of who holds `id`'s lock: its status. */
async function lockRead(id: string): Promise<number> {
  const token = await signAccessToken(
    buildClaims({
      userId: READER,
      email: `${READER}@example.test`,
      name: READER,
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET ?? ""
  );
  const segments = ["document-lock"];
  const search = `?scopeKind=collection&slug=${NOTES}&entryId=${id}`;
  const res = await createDynamicHandlers().GET(
    new Request(`${ORIGIN}/api/${segments.join("/")}${search}`, {
      headers: { origin: ORIGIN, cookie: `nextly_session=${token}` },
    }),
    { params: Promise.resolve({ params: segments }) }
  );
  return res.status;
}

describe("may read the collection, under a read rule that answers a filter", () => {
  it("answers yes inside a request, and no outside one, where the filter cannot be kept", async () => {
    await boot();
    expect(await runWithAccessMemo(() => canReadEntity(NOTES, reader))).toBe(
      true
    );
    // Nothing outside a request could carry the filter to a read it lets
    // run, so the answer refuses rather than let that read run unfiltered.
    expect(await canReadEntity(NOTES, reader)).toBe(false);
  });

  it("reads the autosave of an entry the filter matches, and answers one outside it as a missing entry", async () => {
    const { inside, outside, gone } = await boot();
    expect(await autosaveRead(inside)).toBe("read");
    const missing = await autosaveRead(gone);
    // POPULATION CONTROL: a missing entry is refused, so the comparison is of
    // two refusals.
    expect(missing).toMatchObject({ statusCode: 404 });
    expect(await autosaveRead(outside)).toEqual(missing);
  });

  it("reads the lock of an entry the filter matches, and refuses one outside it", async () => {
    const { inside, outside } = await boot();
    expect(await lockRead(inside)).toBe(200);
    expect(await lockRead(outside)).toBe(403);
  });
});
