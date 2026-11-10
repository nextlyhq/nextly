/**
 * A boot records which started plugin provides each capability, and a
 * shutdown forgets it.
 *
 * The route helpers act on this record at request time: a page asks the
 * page-metadata provider for its head. So the record has to be the running
 * process's, written where the started plugins are recorded and cleared where
 * they are, or a destroyed instance would leave its provider answering pages
 * for the next one.
 */
import { afterEach, describe, expect, it } from "vitest";

import { capabilityProvider } from "../capabilities";
import { definePlugin } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const provider = definePlugin({
  name: "@test/page-metadata",
  version: "1.0.0",
  nextly: ">=0.0.0",
  provides: ["page-metadata"],
  contributes: {
    services: { pageMetadata: () => ({ resolve: () => ({}) }) },
  },
});

describe("the capability providers a boot records", () => {
  it("names the started plugin that provides page metadata", async () => {
    current = await createTestNextly({ plugins: [provider] });
    expect(capabilityProvider("page-metadata")).toBe("@test/page-metadata");
  });

  it("forgets the provider once the instance is destroyed", async () => {
    current = await createTestNextly({ plugins: [provider] });
    await current.destroy();
    current = undefined;
    expect(capabilityProvider("page-metadata")).toBeUndefined();
  });

  it("refuses to boot a page-metadata provider with no resolver service", async () => {
    const declaredOnly = definePlugin({
      name: "@test/declared-only",
      version: "1.0.0",
      nextly: ">=0.0.0",
      provides: ["page-metadata"],
    });
    await expect(
      createTestNextly({ plugins: [declaredOnly] })
    ).rejects.toMatchObject({
      logContext: { reason: "page-metadata-service-missing" },
    });
  });
});
