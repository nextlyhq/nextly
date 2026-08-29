/**
 * The worklist decides the coarse read gate ONCE, and this pins what that costs.
 *
 * `GET /api/translations` calls `canReadEntity` for every localized collection
 * before it queries any of them — it has to, because a collection the caller
 * cannot read must not consume one of the capped fan-out slots nor have its
 * slug named back as unconsulted. Handing the resulting verdict to
 * `listEntries` as `routeAuthorized` is what stops the SAME decision being
 * taken a second time per collection.
 *
 * That matters beyond wasted work. A code-defined `access.read` rule is an
 * arbitrary async function: an operator may call an entitlements service from
 * it. Running it twice per collection doubles that load, and a transient
 * failure on the second call refuses a collection the first call allowed —
 * reporting it as unconsulted for a reason nothing on the screen can explain.
 *
 * The flag is only safe because it elides the COARSE gate alone. These cases
 * assert both halves: the re-check does not happen, and the collection's own
 * rules still decide the answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Authentication is not what these cases are about, and building a real session
// would put a login flow between the assertion and the behaviour it describes.
// The identity is stubbed; every AUTHORIZATION decision below is the real one,
// taken by the real services against a real database.
vi.mock("../../auth/middleware", async importActual => {
  const actual = await importActual<typeof import("../../auth/middleware")>();
  return {
    ...actual,
    requireAuthentication: vi.fn(async () => ({
      userId: "u1",
      userEmail: "u@x.test",
      userName: "U",
      authMethod: "session" as const,
      permissions: [] as string[],
      claims: {},
    })),
  };
});

import { defineCollection, text } from "../../config";
import { createTestNextly, type TestNextly } from "../../plugins/test-nextly";
import type { CollectionsHandler } from "../../services/collections-handler";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const USER = { id: "u1", email: "u@x.test", roles: [] };

/** Boot with a code-defined read rule we can count and steer. */
async function boot(read: () => boolean): Promise<{
  handler: CollectionsHandler;
  reads: ReturnType<typeof vi.fn>;
}> {
  const reads = vi.fn(() => read());
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: "pages",
        localized: true,
        access: { read: reads },
        fields: [text({ name: "title" })],
      }),
    ],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
  await current.nextly.create({
    collection: "pages",
    data: { title: "A" },
  });
  reads.mockClear();
  const handler = current.getService(
    "collectionsHandler"
  ) as unknown as CollectionsHandler;
  return { handler, reads };
}

describe("routeAuthorized on the worklist's list reads", () => {
  it("does NOT re-run the code-defined read rule the worklist already ran", async () => {
    // The whole point of forwarding the verdict. Without it this is 1, and the
    // worklist pays it once per localized collection on every refresh.
    const { handler, reads } = await boot(() => true);

    await handler.listEntries({
      collectionName: "pages",
      user: USER,
      routeAuthorized: true,
      limit: 10,
      status: "all" as const,
    });

    expect(reads).not.toHaveBeenCalled();
  });

  it("DOES run it when no prior verdict is attested", async () => {
    // The control. Without this the assertion above is satisfied by a rule that
    // is never consulted on either path, which would prove nothing at all.
    const { handler, reads } = await boot(() => true);

    await handler.listEntries({
      collectionName: "pages",
      user: USER,
      limit: 10,
      status: "all" as const,
    });

    expect(reads).toHaveBeenCalled();
  });

  it("refuses a caller the rule denies, when no prior verdict is attested", async () => {
    // Pins that the gate being skipped is a REAL gate — one that can say no.
    const { handler } = await boot(() => false);

    const result = await handler.listEntries({
      collectionName: "pages",
      user: USER,
      limit: 10,
      status: "all" as const,
    });

    expect(result?.success).toBe(false);
  });
});

describe("the worklist endpoint itself", () => {
  it("decides the coarse gate ONCE per collection, not twice", async () => {
    // The call site, not the platform semantics the cases above pin. If
    // `getTranslationWorklist` stops attesting the verdict it already has, the
    // rule runs a second time for every collection it queries and this fails.
    const { reads } = await boot(() => true);
    const { getTranslationWorklist } = await import("../translations");

    const res = await getTranslationWorklist(
      new Request("http://t/api/translations?locale=de&state=missing")
    );

    expect(res.status).toBe(200);
    // Exactly one: `canReadEntity`, before the fan-out. The list read must add
    // none.
    expect(reads).toHaveBeenCalledTimes(1);
  });

  it("🔴 answers the review state at all, rather than erroring before it starts", async () => {
    // 🔴 THE STATE THAT TAKES A DIFFERENT PATH. `stale` is the only value that resolves a physical
    // capability per collection before the fan-out, and it shipped asking a dependency-injection
    // container for a key nothing registers — so the tab returned an internal error on every
    // request while the other four states, which never enter that branch, stayed green.
    //
    // Every existing case here drives `state=missing`, which is why a whole broken tab passed a
    // suite that exercised the endpoint. A per-STATE smoke is the cheapest thing that would have
    // caught it, and it is cheap precisely because it asserts almost nothing: reaching a 200 is
    // the claim.
    const { getTranslationWorklist } = await import("../translations");
    await boot(() => true);

    for (const state of [
      "missing",
      "translated",
      "draft",
      "published",
      "stale",
    ] as const) {
      const res = await getTranslationWorklist(
        new Request(`http://t/api/translations?locale=de&state=${state}`)
      );
      expect(res.status, `state=${state} must not error`).toBe(200);
    }
  });
});
