// A save that moves a field into or out of a group tells the server so, on its preview and its
// apply alike (`hints.moves`), for every kind of entity; a save that moves nothing sends what it
// always has.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api/protectedApi", () => ({
  protectedApi: {
    post: vi.fn(async () => ({ message: "ok", newSchemaVersion: 2 })),
  },
}));

import { protectedApi } from "../../lib/api/protectedApi";
import { fieldGroupApi } from "../fieldGroupApi";
import { schemaApi } from "../schemaApi";
import { singleApi } from "../singleApi";

const post = protectedApi.post as unknown as ReturnType<typeof vi.fn>;
const body = () => post.mock.calls[0]?.[1] as Record<string, unknown>;
const hints = { moves: [{ from: ["summary"], to: ["meta", "summary"] }] };

describe("a save's moves, as each service sends them", () => {
  beforeEach(() => post.mockClear());

  it.each([
    [
      "a collection's preview",
      () => schemaApi.preview("posts", [], undefined, undefined, hints),
    ],
    [
      "a collection's apply",
      () =>
        schemaApi.apply(
          "posts",
          [],
          1,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          hints
        ),
    ],
    [
      "a Single's preview",
      () =>
        singleApi.previewSchemaChanges("home", [], undefined, undefined, hints),
    ],
    [
      "a Single's apply",
      () =>
        singleApi.applySchemaChanges(
          "home",
          [],
          1,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          hints
        ),
    ],
    [
      "a field group's preview",
      () => fieldGroupApi.previewSchemaChanges("seo", [], undefined, hints),
    ],
    [
      "a field group's apply",
      () =>
        fieldGroupApi.applySchemaChanges(
          "seo",
          [],
          1,
          undefined,
          undefined,
          undefined,
          undefined,
          hints
        ),
    ],
  ])("%s carries them", async (_name, call) => {
    await call();
    expect(body()).toMatchObject({ hints });
  });

  it("leaves them out where the save moves nothing", async () => {
    await schemaApi.preview("posts", []);
    expect(body()).not.toHaveProperty("hints");
  });
});
