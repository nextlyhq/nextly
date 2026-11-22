/**
 * A start refuses a collection that opens its entries in a view it does not
 * have, before the adapter connects, and judges a disabled plugin's views as
 * declared, so switching one off never stops a start.
 *
 * The adapter here cannot connect, so registration fails either way: each
 * refusal is paired with a positive control showing the same boot gets past
 * the check, or the refusal would be satisfied by any rejection at all.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../route-handler/auth-handler", () => ({
  setBootedConfig: () => undefined,
}));

const { registerServices } = await import("../register");

const failingAdapter = { connect: () => undefined };

/** Notes: a title and a `blocks` field, opening in `opensIn`. */
function notes(opensIn: string) {
  return {
    slug: "notes",
    fields: [
      { name: "title", type: "text" },
      { name: "sections", type: "blocks" },
    ],
    admin: { opensIn },
  };
}

/** A plugin contributing the `blocks` field type and a `builder` view on it. */
function builderPlugin(enabled: boolean) {
  return {
    name: "@acme/builder",
    version: "1.0.0",
    nextly: "*",
    enabled,
    contributes: {
      fieldTypes: [
        { type: "blocks", storage: "json", component: "@acme/builder#Field" },
      ],
      admin: {
        documentViews: [
          {
            fieldType: "blocks",
            path: "builder",
            component: "@acme/builder#View",
          },
        ],
      },
    },
  };
}

async function bootError(config: Record<string, unknown>): Promise<string> {
  try {
    await registerServices({
      adapter: failingAdapter,
      ...config,
    } as unknown as Parameters<typeof registerServices>[0]);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

const REFUSED = /The collection "notes" opens its entries in "builder"/;

describe("a collection's opensIn at boot", () => {
  it("is refused when no plugin declares the view, naming the collection and the view", async () => {
    expect(
      await bootError({ collections: [notes("builder")], plugins: [] })
    ).toMatch(REFUSED);
  });

  it("gets past the check opening in the form", async () => {
    expect(
      await bootError({ collections: [notes("form")], plugins: [] })
    ).not.toMatch(/opens its entries in/);
  });

  it("gets past the check with the view's plugin switched off", async () => {
    expect(
      await bootError({
        collections: [notes("builder")],
        plugins: [builderPlugin(false)],
      })
    ).not.toMatch(/opens its entries in/);
  });
});
