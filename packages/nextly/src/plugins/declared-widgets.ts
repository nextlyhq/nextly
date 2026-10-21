/**
 * The dashboard widgets a site's config declares, kept as types from `definePlugin` through
 * `defineConfig`, so the admin component map generated for the site can check each component it
 * registers against the widget that names its path.
 *
 * Types only: nothing here exists at run time, and `defineConfig` returns the same object it did.
 *
 * @module plugins/declared-widgets
 */

import type {
  AnyWidget,
  ComponentPathOf,
  WidgetComponentMap,
} from "../domains/widgets/declaration/define-widget";

import type { PluginDefinition } from "./plugin-context";

/**
 * The key under which a config made by `defineConfig` records, as a type, the widgets it
 * declares. Declared and never set, so the record costs nothing at run time and no reader of a
 * config can find it there.
 */
export declare const declaredWidgets: unique symbol;

/** What `defineConfig` adds to the type of the config it returns: the widgets it declares. */
export interface DeclaredWidgetsRecord<W extends AnyWidget> {
  readonly [declaredWidgets]?: W;
}

/**
 * The widgets each plugin declares, from the plugins' own types. A plugin whose widgets' types
 * were not kept (a plain object, JavaScript, or a factory returning `PluginDefinition`) brings
 * `AnyWidget`, which `TypedWidgets` then leaves out.
 */
export type WidgetsOfPlugins<P extends readonly unknown[]> =
  P[number] extends infer Each
    ? Each extends PluginDefinition<infer W>
      ? W
      : never
    : never;

/**
 * The widgets a config declares, given the config or the module that exports it: its default
 * export when it has one, as the config loader reads it, or the module itself.
 *
 * A config typed `any`, as a JavaScript config is when imported for its type, declares none
 * here: the map then checks nothing, rather than failing.
 *
 * @experimental Meant to become stable surface once the plugin API's shape for widgets settles.
 */
export type WidgetsOf<C> = RecordedWidgets<
  C extends { readonly default: infer Default } ? Default : C
>;

type RecordedWidgets<C> = 0 extends 1 & C
  ? never
  : C extends { readonly [declaredWidgets]?: infer W }
    ? W
    : never;

/**
 * The widgets whose component path is a literal: the ones a map can be checked against.
 *
 * 🔴 Without this, one widget whose component path is a plain `string` (declared from a
 * variable, say) switches the check off for everyone: a mapped type over a union of keys that
 * includes `string` becomes an index signature, which absorbs every literal key and accepts any
 * component. A widget typed only as `AnyWidget` names no path at all, so it never reaches here.
 */
type TypedWidgets<W> = W extends AnyWidget
  ? string extends ComponentPathOf<W>
    ? never
    : W
  : never;

/**
 * The type a site's generated admin component map is checked against: each typed widget's
 * declared component path, where the map has it, holding a component that takes that widget's
 * props, and any other path (a page, a field editor, an untyped plugin's widget) holding anything.
 *
 * A typed path may be absent. The config's type includes every branch of the config, a plugin
 * added only when some setting is on among them, while the map holds what the config registered
 * when it was generated. That every declared component is registered is the admin's own check at
 * run time, which refuses to serve without one; this one is about the pairing.
 *
 * ```ts
 * import type * as siteConfig from "../../nextly.config";
 * const registered = { … } satisfies DeclaredComponentMap<typeof siteConfig>;
 * ```
 *
 * @experimental Meant to become stable surface once the plugin API's shape for widgets settles.
 */
export type DeclaredComponentMap<C> = Partial<
  WidgetComponentMap<TypedWidgets<WidgetsOf<C>>>
> &
  Readonly<Record<string, unknown>>;
