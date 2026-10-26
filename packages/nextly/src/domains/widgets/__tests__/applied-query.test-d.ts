/**
 * What settings hand back is typed as what they may hand back: a titled list
 * set to a collection it cannot title loses the source and fields it was
 * declared with, so a caller is told a declared `source` may be gone.
 */
import { expectTypeOf } from "vitest";

import { applyWidgetSettings } from "../settings";

const declared = {
  source: "collection:posts",
  op: "list" as const,
  select: ["title"],
};
const asked = applyWidgetSettings(declared, undefined, undefined);

// 🔴 Typed as the query it was given, `asked.source.toUpperCase()` compiled
// and threw at runtime: the source is optional, so a caller checks it first.
expectTypeOf(asked.source).toEqualTypeOf<string | undefined>();
expectTypeOf(asked.select).toEqualTypeOf<string[] | undefined>();
