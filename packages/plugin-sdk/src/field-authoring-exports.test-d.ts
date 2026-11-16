/**
 * Field authoring through the SDK: the factories and types a plugin builds its
 * contributed collections from are core's own, re-exported, so a collection a
 * plugin authors here is the collection core reads.
 */
import { expectTypeOf } from "vitest";

import { date as coreDate, text as coreText } from "nextly";
import type { CollectionConfig as CoreCollectionConfig } from "nextly";

import { date, text } from "@nextlyhq/plugin-sdk";
import type { CollectionConfig } from "@nextlyhq/plugin-sdk";

expectTypeOf(date).toEqualTypeOf(coreDate);
expectTypeOf(text).toEqualTypeOf(coreText);
expectTypeOf<CollectionConfig>().toEqualTypeOf<CoreCollectionConfig>();
