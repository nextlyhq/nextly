/**
 * The id `generate:widget` writes a widget under, checked before anything is
 * written: `<namespace>/<name>` in lowercase slug form, in the namespace of
 * whoever ships it.
 *
 * Core accepts any namespace but its own and the retired ones; the scaffold is
 * stricter, so a generated widget starts where it belongs: a site's widgets in
 * `site/`, a plugin's in its own name. A bare name is placed there.
 *
 * @module cli/commands/generate-widget/id
 */
import { isValidWidgetId } from "../../../domains/widgets/definition";
import { RETIRED_WIDGET_NAMESPACES } from "../../../domains/widgets/retired-widget-namespaces";

/** Where a widget is generated: a site's own config, or a plugin package. */
export type WidgetTarget =
  | { kind: "site"; configPath: string }
  | { kind: "plugin"; root: string; packageName: string };

/** The namespace every widget a site declares is generated in. */
const SITE_NAMESPACE = "site";

const RESERVED = ["core", ...RETIRED_WIDGET_NAMESPACES];

/** A plugin's namespace: its package name without a scope, as a slug. */
function pluginNamespace(packageName: string): string {
  return packageName
    .replace(/^@[^/]+\//, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function namespaceFor(target: WidgetTarget): string {
  return target.kind === "site"
    ? SITE_NAMESPACE
    : pluginNamespace(target.packageName);
}

export type WidgetIdAnswer =
  | { ok: true; id: string; namespace: string; name: string }
  | { ok: false; reason: string };

/**
 * The id `input` names for `target`, or why it cannot be one. A bare name such
 * as `open-orders` is placed in the target's namespace.
 */
export function widgetId(input: string, target: WidgetTarget): WidgetIdAnswer {
  const expected = namespaceFor(target);
  const id = input.includes("/") ? input : `${expected}/${input}`;
  const example = `${expected}/open-orders`;
  if (!isValidWidgetId(id)) {
    return {
      ok: false,
      reason: `"${input}" is not a widget id: write <namespace>/<name> in lowercase letters, digits and dashes, such as "${example}", or just the name`,
    };
  }
  const [namespace, name] = id.split("/") as [string, string];
  if (RESERVED.includes(namespace)) {
    return {
      ok: false,
      reason: `"${namespace}/" is reserved for core; use "${example}"`,
    };
  }
  if (namespace !== expected) {
    const whose =
      target.kind === "site"
        ? `a site's widgets are generated in "${SITE_NAMESPACE}/"`
        : `this plugin's widgets are generated in its own namespace, "${expected}/"`;
    return {
      ok: false,
      reason: `"${id}" is in "${namespace}/", but ${whose}: use "${expected}/${name}"`,
    };
  }
  return { ok: true, id, namespace, name };
}
