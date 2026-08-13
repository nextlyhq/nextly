/**
 * The release this admin bundle belongs to.
 *
 * Injected at build time from `package.json` by the tsup and vitest `define`
 * blocks, mirroring how core resolves `__NEXTLY_CORE_VERSION__`. No runtime
 * `package.json` read as core has: this bundle targets the browser, where
 * there is no module resolver to fall back to.
 *
 * A consumer that bundles this package from SOURCE gets `undefined`, because
 * neither `define` runs. That is the contributor playground, which aliases
 * `@nextlyhq/admin` to `src/index.ts` — so the install command it renders is
 * unpinned, and that is correct rather than broken: a dev checkout has no
 * published release to name. An installed project resolves the built `dist`,
 * where the constant is a literal.
 *
 * @module lib/admin-version
 */

declare const __NEXTLY_ADMIN_VERSION__: string | undefined;

/**
 * The concrete admin version (e.g. `"0.0.2-alpha.57"`), or `undefined` when
 * the constant was not injected.
 *
 * `undefined` rather than a `"0.0.0"` sentinel, because the only caller uses
 * this to pin a package specifier: a sentinel would produce an install command
 * for a version that does not exist, which is worse than the unpinned command
 * it replaced. Callers have to handle not knowing.
 */
export function adminVersion(): string | undefined {
  const injected =
    typeof __NEXTLY_ADMIN_VERSION__ !== "undefined"
      ? __NEXTLY_ADMIN_VERSION__
      : undefined;
  return injected && injected.length > 0 ? injected : undefined;
}
