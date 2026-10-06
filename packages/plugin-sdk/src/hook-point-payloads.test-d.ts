/**
 * A plugin types its own hook point by augmenting the SDK, the module it
 * installs, and the registries `ctx` hands every plugin then check against it.
 */
import { expectTypeOf } from "vitest";

import type {
  EmailPayloadFilterValue,
  PluginFilterRegistry,
} from "@nextlyhq/plugin-sdk";

declare module "@nextlyhq/plugin-sdk" {
  interface HookPointPayloads {
    "acme-search.query": {
      kind: "filter";
      value: { terms: string[] };
      context: { locale: string };
    };
  }
}

declare const filters: PluginFilterRegistry;

filters.add("acme-search.query", (value, context) => {
  expectTypeOf(value).toEqualTypeOf<{ terms: string[] }>();
  expectTypeOf(context).toEqualTypeOf<{ locale: string }>();
  return value;
});
// @ts-expect-error the value is the point's
void filters.apply("acme-search.query", { terms: "a" }, { locale: "en" });

// Core's seams arrive typed without any augmentation.
filters.add("email.beforeSend", value => {
  expectTypeOf(value).toEqualTypeOf<EmailPayloadFilterValue>();
  return value;
});
