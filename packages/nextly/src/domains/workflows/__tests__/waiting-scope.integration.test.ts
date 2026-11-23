/**
 * `GET /workflows/waiting/scope` says whether anything can ever wait for the signed-in caller's
 * review: whether they may take the next step of any stage of content they may read, judged as the
 * waiting list judges it, with no document read. The admin shows "Waiting for my review" on it.
 * Signed-in callers only, about themselves alone, on every configured dialect.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import {
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";

import { bootSteps, person } from "./helpers/step-harness";

let t: TestNextly | undefined;

afterEach(async () => {
  await t?.destroy();
  t = undefined;
});

/** The scope, asked over REST by the signed-in person `userId`, or by no one. */
async function scopeAs(
  userId: string | null
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = { origin: "http://localhost" };
  if (userId !== null) {
    const token = await signAccessToken(
      buildClaims({
        userId,
        email: `${userId}@example.test`,
        name: userId,
        image: null,
        roleIds: [],
        sessionEpoch: 0,
      }),
      process.env.NEXTLY_SECRET!
    );
    headers.cookie = `nextly_session=${token}`;
  }
  const request = new Request("http://localhost/api/workflows/waiting/scope", {
    method: "GET",
    headers,
  });
  const response = await createDynamicHandlers().GET(request, {
    params: Promise.resolve({ params: ["workflows", "waiting", "scope"] }),
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

describe.each(getConfiguredTestDialects())(
  "what can wait for the caller's review (%s)",
  dialect => {
    it("says yes to a reviewer who may take a stage's next step, and no to a reader who may not", async () => {
      t = await bootSteps(dialect);
      await person(t, "sam", [
        ["read", "pages"],
        ["sign-off", "pages"],
      ]);
      await person(t, "reader", [["read", "pages"]]);

      // `stages` counts the stages whose next step the caller may take: Legal check's sign-off.
      expect(await scopeAs("sam")).toEqual({
        status: 200,
        body: { reviews: true, stages: expect.any(Number) },
      });
      expect((await scopeAs("sam")).body.stages).toBeGreaterThan(0);
      expect(await scopeAs("reader")).toEqual({
        status: 200,
        body: { reviews: false, stages: 0 },
      });
    });

    it("refuses a caller who is not signed in", async () => {
      t = await bootSteps(dialect);

      const answer = await scopeAs(null);
      expect(answer.status).toBe(401);
      expect(answer.body).not.toHaveProperty("reviews");
    });
  }
);
