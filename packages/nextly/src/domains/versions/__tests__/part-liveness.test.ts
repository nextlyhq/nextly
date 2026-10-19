/**
 * A due release decides whether a document is served before its stored status
 * does, as it does for the public read.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { describe, expect, it } from "vitest";

import type { ReleaseVisibility } from "../../releases/release-visibility";
import { readPartIsLive } from "../part-liveness";

/** An adapter whose main row holds `status`, and nothing else. */
function adapterWithStatus(status: string): DrizzleAdapter {
  return {
    dialect: "sqlite",
    selectOne: () => Promise.resolve({ status }),
  } as unknown as DrizzleAdapter;
}

function visibility(decisions: {
  reveal?: string[];
  hide?: string[];
}): ReleaseVisibility {
  return {
    decisions: () =>
      Promise.resolve({
        reveal: decisions.reveal ?? [],
        hide: decisions.hide ?? [],
      }),
  };
}

const entity = {
  slug: "notes",
  tableName: "dc_notes",
  fields: [],
  status: true,
};

describe("readPartIsLive", () => {
  it("is not live while a due release withdraws it, whatever its row says", async () => {
    await expect(
      readPartIsLive({
        adapter: adapterWithStatus("published"),
        scopeKind: "collection",
        entity,
        entryId: "e1",
        part: null,
        defaultLocale: null,
        visibility: visibility({ hide: ["e1"] }),
      })
    ).resolves.toBe(false);
  });

  it("is live while a due release publishes it, before the release writes it", async () => {
    await expect(
      readPartIsLive({
        adapter: adapterWithStatus("draft"),
        scopeKind: "collection",
        entity,
        entryId: "e1",
        part: null,
        defaultLocale: null,
        visibility: visibility({ reveal: ["e1"] }),
      })
    ).resolves.toBe(true);
  });

  it("follows the stored status when no release is due", async () => {
    for (const [status, live] of [
      ["published", true],
      ["draft", false],
    ] as const) {
      await expect(
        readPartIsLive({
          adapter: adapterWithStatus(status),
          scopeKind: "collection",
          entity,
          entryId: "e1",
          part: null,
          defaultLocale: null,
          visibility: visibility({}),
        })
      ).resolves.toBe(live);
    }
  });
});
