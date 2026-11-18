/**
 * The page check provider contract, as a provider plugin compiles against
 * it. Type-level claims only: the page builder's route tests what is done
 * with a provider at run time. What is held here is that a provider written
 * from this subpath alone type-checks, that its fixes are one of the two
 * kinds, and that its group is one of the list's.
 */
import { expectTypeOf } from "vitest";

import type {
  PageCheckFinding,
  PageCheckFix,
  PageCheckGroupName,
  PageCheckProvider,
  PageCheckProviderService,
  PageCheckRequest,
} from "@nextlyhq/plugin-sdk/blocks";

// A provider written against the subpath alone.
const provider = {
  id: "acme-checks",
  group: "search",
  check: async (page: PageCheckRequest): Promise<PageCheckFinding[]> =>
    page.entryId === null
      ? []
      : [
          {
            what: "Title is too long",
            why: "Search results cut it short.",
            todo: "Shorten the title.",
            fix: { settingsTab: "acme-seo" },
          },
        ],
} satisfies PageCheckProvider;

expectTypeOf(provider).toExtend<PageCheckProvider>();
expectTypeOf<PageCheckProviderService["register"]>()
  .parameter(0)
  .toEqualTypeOf<PageCheckProvider>();

// A fix is a block's setting or a tab of the page's settings, nothing else.
expectTypeOf<{ tab: "content"; id: "alt" }>().toExtend<PageCheckFix>();
expectTypeOf<{ settingsTab: "seo" }>().toExtend<PageCheckFix>();
// @ts-expect-error A setting on a tab the inspector doesn't have is no fix.
const notAFix: PageCheckFix = { tab: "layout", id: "x" };
void notAFix;

// The groups are the list's own.
expectTypeOf<PageCheckGroupName>().toEqualTypeOf<
  "accessibility" | "content" | "publishing" | "search"
>();
