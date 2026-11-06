/**
 * Where a site widget's component is resolved from, and who it is named as.
 *
 * A site declares a widget's view component as a plugin does,
 * `"<module>#<Export>"`, with one rule for the module: a path relative to the
 * config file (`"./dashboard/revenue#Revenue"`), or a package name. The
 * generated component map imports a relative one from its own folder, so the
 * same spelling works in development, in `generate:types` and in the CI check,
 * whatever path aliases the app defines. An alias (`"@/…"`, `"~/…"`) is
 * refused at startup, since nothing that writes or checks the map resolves it.
 *
 * Its own module, with NO imports: both startup's check of the site config and
 * the code generator read it, and neither should carry the other's weight.
 *
 * @module domains/widgets/declaration/site-component
 */

/** How a fault, and the component map, name the site config as an owner. */
export const SITE_CONFIG = "the site config";

/** Whether a component's module is written relative to the config file. */
export function isConfigRelative(module: string): boolean {
  return module.startsWith("./") || module.startsWith("../");
}

/** A package name, scoped or not, with an optional subpath: what a plugin's component names. */
const PACKAGE_NAME = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:\/.*)?$/i;

/**
 * Why a site widget's component cannot be listed in the map, or `undefined`
 * when it can: its module is neither relative to the config file nor a package
 * name. The fault says what to write instead.
 */
export function siteComponentProblem(component: string): string | undefined {
  const hash = component.indexOf("#");
  const module = hash === -1 ? component : component.slice(0, hash);
  if (isConfigRelative(module) || PACKAGE_NAME.test(module)) return undefined;
  const member = hash === -1 ? "default" : component.slice(hash + 1);
  const relative = module.replace(/^(?:[@~]\/|\/)/, "");
  return `view.component "${component}" names a module the component map cannot resolve: write it relative to the config file: ./${relative}#${member}`;
}
