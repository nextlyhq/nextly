import { expectTypeOf } from "vitest";

import type { BlockSupportKeys, BlockSupports } from "./block";
import type { StyleGroup } from "./style/catalog-types";

// The built-in support vocabulary IS the catalog's group list. Writing the keys
// out gives each one its own documentation; this is what stops the two lists
// drifting once they are written in two places. Adding a group without adding
// the key here, or the reverse, fails to compile.
expectTypeOf<keyof BlockSupportKeys>().toEqualTypeOf<StyleGroup>();

// A key outside that vocabulary is refused while it is being written, rather
// than at boot by the registry.
// @ts-expect-error "shadwo" is not a style group.
const misspelled: BlockSupports = { shadwo: true };
void misspelled;

// A group takes either a whole-group boolean or its named sub-flags.
expectTypeOf<BlockSupports["border"]>().toEqualTypeOf<
  boolean | Record<string, boolean> | undefined
>();
