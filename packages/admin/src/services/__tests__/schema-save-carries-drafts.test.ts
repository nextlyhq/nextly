// The Builder saves its settings only once the fields have applied, so a save that turns
// Draft/Published on would otherwise have its fields judged under the stored lifecycle, and a field
// taking one of the lifecycle's names would reach the database. The pending toggle rides with the
// fields on the preview and the apply of a collection and a Single, as the Internationalization
// toggle does.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api/protectedApi", () => ({
  protectedApi: {
    post: vi.fn(async () => ({ message: "ok", newSchemaVersion: 2 })),
  },
}));

import { protectedApi } from "../../lib/api/protectedApi";
import { schemaApi } from "../schemaApi";
import { singleApi } from "../singleApi";

const post = protectedApi.post as unknown as ReturnType<typeof vi.fn>;

const bodyOfLastCall = (): Record<string, unknown> =>
  post.mock.calls[post.mock.calls.length - 1][1] as Record<string, unknown>;

const SENDS = [
  {
    call: "the collection preview",
    send: (status?: boolean) =>
      schemaApi.preview("posts", [], undefined, status),
  },
  {
    call: "the collection apply",
    send: (status?: boolean) =>
      schemaApi.apply("posts", [], 1, undefined, undefined, undefined, status),
  },
  {
    call: "the Single preview",
    send: (status?: boolean) =>
      singleApi.previewSchemaChanges("home", [], undefined, status),
  },
  {
    call: "the Single apply",
    send: (status?: boolean) =>
      singleApi.applySchemaChanges(
        "home",
        [],
        1,
        undefined,
        undefined,
        undefined,
        status
      ),
  },
];

describe("a Builder schema save carries the pending Draft/Published toggle", () => {
  beforeEach(() => post.mockClear());

  for (const { call, send } of SENDS) {
    it(`${call} sends status:true and status:false as given`, async () => {
      await send(true);
      expect(bodyOfLastCall()).toMatchObject({ status: true });
      await send(false);
      expect(bodyOfLastCall()).toMatchObject({ status: false });
    });

    // Omitted, the server judges with the stored lifecycle alone.
    it(`${call} omits the key when no toggle is given`, async () => {
      await send(undefined);
      expect(bodyOfLastCall()).not.toHaveProperty("status");
    });
  }
});
