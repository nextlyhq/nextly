/**
 * The advisory notice a plugin raises through the SDK.
 *
 * What these pin: it is core's own function, not a copy that records into a
 * collector nobody reads, and what it takes is a `HookWarning` less the
 * severity it sets itself, so a plugin can neither file a notice as a failure
 * nor omit what the admin shows.
 */
import { expectTypeOf } from "vitest";

import { recordAdvisoryNotice as coreRecordAdvisoryNotice } from "nextly";
import type { HookWarning } from "nextly";

import { recordAdvisoryNotice } from "@nextlyhq/plugin-sdk";
import type { AdvisoryNotice } from "@nextlyhq/plugin-sdk";

expectTypeOf(recordAdvisoryNotice).toEqualTypeOf(coreRecordAdvisoryNotice);
expectTypeOf(recordAdvisoryNotice).parameter(0).toEqualTypeOf<AdvisoryNotice>();
expectTypeOf(recordAdvisoryNotice).returns.toEqualTypeOf<void>();

expectTypeOf<AdvisoryNotice>().toEqualTypeOf<Omit<HookWarning, "severity">>();
expectTypeOf<AdvisoryNotice>().toEqualTypeOf<{
  phase: string;
  collection: string;
  code: string;
  message: string;
  entryId?: string;
}>();
