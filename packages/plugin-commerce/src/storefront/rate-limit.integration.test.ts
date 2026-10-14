/**
 * The cart's writes are rate-limited per client.
 *
 * In a file of its own: the limiter counts per process, so the writes that
 * use up the allowance here would refuse writes in any suite run after them
 * in the same file. One dialect is enough, since the limit is counted outside
 * the database.
 *
 * @module storefront/rate-limit.integration.test
 */
import {
  createTestNextly,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { money } from "../money/money";
import { commerce } from "../plugin";
import { createInMemoryCatalogueSource } from "../testing/in-memory-catalogue-source";

const ORIGIN = "http://localhost";
const CSRF = "b".repeat(64);

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe("the cart's rate limit", () => {
  it("refuses a client's writes past its allowance with 429, and still serves reads", async () => {
    current = await createTestNextly({
      plugins: [
        commerce({
          currency: "USD",
          catalogue: createInMemoryCatalogueSource({
            currency: "USD",
            items: [
              {
                reference: "bolt",
                name: "Bolt",
                price: { kind: "listed", unitPrice: money(25, "USD") },
                stock: { kind: "untracked" },
              },
            ],
          }).source,
        }),
      ],
    });
    const handlers = createDynamicHandlers();
    const segments = [
      "plugins",
      "@nextlyhq",
      "plugin-commerce",
      "cart",
      "lines",
    ];

    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) {
      const response = await handlers.POST(
        new Request(
          `${ORIGIN}/api/plugins/@nextlyhq/plugin-commerce/cart/lines`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie: `nextly_csrf=${CSRF}`,
              "x-csrf-token": CSRF,
              origin: ORIGIN,
            },
            body: JSON.stringify({ reference: "bolt", quantity: 1 }),
          }
        ),
        { params: Promise.resolve({ params: segments }) }
      );
      statuses.push(response.status);
      if (i === 60) {
        expect(await response.json()).toMatchObject({
          error: { code: "RATE_LIMITED" },
        });
        expect(response.headers.get("retry-after")).toMatch(/^\d+$/);
      }
    }
    expect(statuses.slice(0, 60).every(status => status === 200)).toBe(true);
    expect(statuses[60]).toBe(429);

    // Reads spend from their own allowance, so a shopper refused a write can
    // still see their cart.
    const read = await handlers.GET(
      new Request(`${ORIGIN}/api/plugins/@nextlyhq/plugin-commerce/cart`),
      {
        params: Promise.resolve({
          params: ["plugins", "@nextlyhq", "plugin-commerce", "cart"],
        }),
      }
    );
    expect(read.status).toBe(200);
  });
});
