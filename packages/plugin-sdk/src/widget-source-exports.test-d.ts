/**
 * The widget contract as a plugin author imports it from the SDK: one way to
 * add a widget, and the source contract core keeps for its own resolvers.
 *
 * A plugin adds widgets only under `contributes.dashboard`, each declared with
 * `defineWidget`, whose `load` reads data as the person asking. Neither
 * `contributes.admin.widgets` nor `contributes.widgetSources` is a field, as
 * the SDK publishes the types.
 *
 * Asserted with `expectTypeOf` rather than `@ts-expect-error`, because a
 * directive suppresses ANY error on the line beneath it: it would keep passing
 * if the key came back as a field and the line failed for another reason.
 * `not.toHaveProperty` is evaluated, and names the key it is about.
 */

import { expectTypeOf } from "vitest";

import type {
  PluginAdminContributions,
  PluginContributions,
  ResolverOptions,
  WidgetSourceResolver,
} from "@nextlyhq/plugin-sdk";

// 🔴 The assertions the file exists for: either key coming back as a field
// fails here, on its own line.
expectTypeOf<PluginContributions>().not.toHaveProperty("widgetSources");
expectTypeOf<PluginAdminContributions>().not.toHaveProperty("widgets");

// The controls: the same form reads these types through the SDK, which do
// carry the one door and the admin keys that stay.
expectTypeOf<PluginContributions>().toHaveProperty("dashboard");
expectTypeOf<PluginAdminContributions>().toHaveProperty("pages");

// Core's resolver takes the host's options in third place, the one bag a
// concern the host adds later becomes a field of.
expectTypeOf<Parameters<WidgetSourceResolver>[2]>().toEqualTypeOf<
  ResolverOptions | undefined
>();
