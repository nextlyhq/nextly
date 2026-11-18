// The first save of a table an earlier Nextly version made converts it, and the server writes a
// conversion only when the apply confirms it by its key (`acknowledgedConversions`). Each kind's
// apply sends the keys it is given, and leaves the key out when there are none, as a save of a
// table with nothing to convert has always sent it.
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

const bodyOfLastCall = (): Record<string, unknown> =>
  post.mock.calls[post.mock.calls.length - 1][1] as Record<string, unknown>;

const KEYS = ["dc_posts", "body"];

const APPLIES: {
  name: string;
  apply: (acknowledged?: readonly string[]) => Promise<unknown>;
}[] = [
  {
    name: "a collection",
    apply: acknowledged =>
      schemaApi.apply(
        "posts",
        [],
        1,
        undefined,
        undefined,
        undefined,
        undefined,
        acknowledged
      ),
  },
  {
    name: "a Single",
    apply: acknowledged =>
      singleApi.applySchemaChanges(
        "notice",
        [],
        1,
        undefined,
        undefined,
        undefined,
        undefined,
        acknowledged
      ),
  },
  {
    name: "a field group",
    apply: acknowledged =>
      fieldGroupApi.applySchemaChanges(
        "card",
        [],
        1,
        undefined,
        undefined,
        undefined,
        acknowledged
      ),
  },
];

describe.each(APPLIES)("the apply of $name", ({ apply }) => {
  beforeEach(() => post.mockClear());

  it("sends the keys of the conversions the review confirmed", async () => {
    await apply(KEYS);
    expect(bodyOfLastCall()).toMatchObject({ acknowledgedConversions: KEYS });
  });

  it("leaves the key out when there is nothing to confirm", async () => {
    await apply([]);
    expect(bodyOfLastCall()).not.toHaveProperty("acknowledgedConversions");
    await apply(undefined);
    expect(bodyOfLastCall()).not.toHaveProperty("acknowledgedConversions");
  });
});
