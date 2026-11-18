/**
 * A fixture plugin for the e2e suite: a page check provider registered
 * through the page builder's `pageChecks` service, the way a plugin adds its
 * own checks. A block saying "Fixture problem" is listed under Publishing,
 * and choosing it opens the block's Text.
 *
 * Registered only on the e2e suite's own server (`NEXTLY_E2E_STYLE_FIXTURE`),
 * like the other test fixtures, so a contributor's Page checks never list it.
 */
import { definePlugin } from "@nextlyhq/plugin-sdk";
import type {
  PageCheckFinding,
  PageCheckProvider,
  PageCheckProviderService,
} from "@nextlyhq/plugin-sdk/blocks";

/** The words a block says for the fixture to list it. */
const FIXTURE_PROBLEM_TEXT = "Fixture problem";

/** Every block saying the fixture's words, as one finding each. */
function findingsIn(document: unknown): PageCheckFinding[] {
  const nodes = (document as { nodes?: unknown } | null)?.nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes.flatMap((node: unknown): PageCheckFinding[] => {
    const { id, props } = (node ?? {}) as {
      id?: unknown;
      props?: { text?: unknown };
    };
    if (typeof id !== "string" || props?.text !== FIXTURE_PROBLEM_TEXT) {
      return [];
    }
    return [
      {
        nodeId: id,
        what: "Fixture problem found",
        why: "The test fixture lists any block saying its words.",
        todo: "Change the block's words.",
        fix: { tab: "content", id: "text" },
      },
    ];
  });
}

const provider: PageCheckProvider = {
  id: "page-check-fixture",
  group: "publishing",
  check: page => Promise.resolve(findingsIn(page.document)),
};

export const pageCheckFixturePlugin = definePlugin({
  name: "page-check-fixture",
  version: "0.0.0",
  nextly: "*",
  init(ctx) {
    const service = ctx.services.plugins["@nextlyhq/plugin-page-builder"]
      ?.pageChecks as PageCheckProviderService | undefined;
    service?.register(provider);
  },
});
