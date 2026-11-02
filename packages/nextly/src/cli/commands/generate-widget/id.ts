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

/**
 * Where a widget is generated: a site's own config, or a plugin package. `root`
 * is the project the command runs in, where its package.json is; a site's
 * config may sit below it, in `src/` or `config/`.
 */
export type WidgetTarget =
  | { kind: "site"; root: string; configPath: string }
  | { kind: "plugin"; root: string; packageName: string };

/** The namespace every widget a site declares is generated in. */
const SITE_NAMESPACE = "site";

const RESERVED = ["core", ...RETIRED_WIDGET_NAMESPACES];

/**
 * Namespaces a plugin's own name cannot become: core's, and the one a site's
 * widgets are generated in, so a plugin's widget never reads as the site's.
 */
const NOT_A_PLUGIN_NAMESPACE = [...RESERVED, SITE_NAMESPACE];

/** A name as a slug: lowercase letters, digits and single dashes. */
const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** A package's name without its scope, as a slug: `@acme/Shop` → `shop`. */
const ownName = (packageName: string): string =>
  slug(packageName.replace(/^@[^/]+\//, ""));

/**
 * A plugin's namespace: its package name without a scope, as a slug. A name
 * core keeps (`@acme/core`) takes its scope in front, `acme-core`, or
 * `-plugin` after it when it has no scope.
 */
function pluginNamespace(packageName: string): string {
  const scope = /^@([^/]+)\//.exec(packageName)?.[1];
  const own = ownName(packageName);
  if (!NOT_A_PLUGIN_NAMESPACE.includes(own)) return own;
  return scope === undefined ? `${own}-plugin` : `${slug(scope)}-${own}`;
}

/** The namespace a target's widgets are generated in, and why when it is not the obvious one. */
function namespaceFor(target: WidgetTarget): {
  namespace: string;
  because?: string;
} {
  if (target.kind === "site") return { namespace: SITE_NAMESPACE };
  const namespace = pluginNamespace(target.packageName);
  const own = ownName(target.packageName);
  return namespace === own
    ? { namespace }
    : {
        namespace,
        because: `its package's own name, "${own}", is reserved, so the namespace is "${namespace}"`,
      };
}

/** `open-orders` → `OpenOrders`. */
export function pascalCase(name: string): string {
  return name
    .split("-")
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/** `open-orders` → `openOrders`: the name a widget's declaration is exported as. */
export function camelCase(name: string): string {
  const pascal = pascalCase(name);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/**
 * Words TypeScript will not take as a variable's name in a module: the
 * reserved words, the strict mode ones, and the names strict mode keeps.
 */
const NOT_A_VARIABLE = new Set(
  (
    "break case catch class const continue debugger default delete do else enum export extends " +
    "false finally for function if import in instanceof new null return super switch this throw " +
    "true try typeof var void while with implements interface let package private protected " +
    "public static yield await arguments eval undefined"
  ).split(" ")
);

/** Why `name` cannot name a declaration once camelised, or nothing when it can. */
function identifierProblem(name: string): string | undefined {
  const exported = camelCase(name);
  if (/^[0-9]/.test(exported)) {
    return `"${name}" cannot name the widget's code: it would be exported as "${exported}", and a TypeScript name cannot start with a digit; start it with a letter`;
  }
  if (NOT_A_VARIABLE.has(exported)) {
    return `"${name}" cannot name the widget's code: "${exported}" is a reserved word in TypeScript; choose another, such as "${name}-widget"`;
  }
  return undefined;
}

export type WidgetIdAnswer =
  | { ok: true; id: string; namespace: string; name: string }
  | { ok: false; reason: string };

/** Why `namespace` is not the one `target`'s widgets are generated in, or nothing. */
function namespaceProblem(
  id: string,
  namespace: string,
  name: string,
  target: WidgetTarget
): string | undefined {
  const expected = namespaceFor(target);
  const example = `${expected.namespace}/open-orders`;
  const because =
    expected.because === undefined ? "" : ` (${expected.because})`;
  if (RESERVED.includes(namespace)) {
    return `"${namespace}/" is reserved for core; use "${example}"${because}`;
  }
  if (namespace === expected.namespace) return undefined;
  const whose =
    target.kind === "site"
      ? `a site's widgets are generated in "${SITE_NAMESPACE}/"`
      : `this plugin's widgets are generated in its own namespace, "${expected.namespace}/"${because}`;
  return `"${id}" is in "${namespace}/", but ${whose}: use "${expected.namespace}/${name}"`;
}

/**
 * The id `input` names for `target`, or why it cannot be one. A bare name such
 * as `open-orders` is placed in the target's namespace.
 */
export function widgetId(input: string, target: WidgetTarget): WidgetIdAnswer {
  const { namespace: expected } = namespaceFor(target);
  const id = input.includes("/") ? input : `${expected}/${input}`;
  if (!isValidWidgetId(id)) {
    return {
      ok: false,
      reason: `"${input}" is not a widget id: write <namespace>/<name> in lowercase letters, digits and dashes, such as "${expected}/open-orders", or just the name`,
    };
  }
  const [namespace, name] = id.split("/") as [string, string];
  const problem =
    namespaceProblem(id, namespace, name, target) ?? identifierProblem(name);
  return problem === undefined
    ? { ok: true, id, namespace, name }
    : { ok: false, reason: problem };
}
