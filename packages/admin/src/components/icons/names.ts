/**
 * The set of icon names the barrel can render.
 *
 * Its own module rather than a line in the barrel, because the type has to
 * refer to the barrel's own exports and a module cannot describe itself
 * without the inline `import()` form that this package's lint rules forbid.
 *
 * @module components/icons/names
 */
import type * as Icons from "./index";

/**
 * Every icon name this admin can render, derived from the exports rather than
 * listed beside them, so a name and the export it refers to cannot disagree.
 *
 * Curated data that picks an icon — the plugin catalogue — types its icon
 * field as this, and a name the barrel does not carry stops compiling instead
 * of resolving to nothing and silently rendering the caller's generic
 * fallback.
 *
 * Not for icon names that arrive at runtime: a third-party plugin declares
 * `appearance.icon` as a free string this admin cannot constrain, so that path
 * keeps its fallback.
 */
export type AdminIconName = keyof typeof Icons;
