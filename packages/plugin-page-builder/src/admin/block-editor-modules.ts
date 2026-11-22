/**
 * The block modules the generated component map hands the editor, held until
 * the editor mounts.
 *
 * Its own module, apart from `contributed-blocks.ts`, because the admin entry
 * re-exports `registerBlockEditorModules` for the map and so loads this module
 * on every admin screen. Holding the modules needs nothing of the block
 * engine; registering their blocks does, and that happens in
 * `contributed-blocks.ts` when the editor mounts.
 *
 * @module @nextlyhq/plugin-page-builder/admin/block-editor-modules
 */
import type { BlockInspectorProps } from "@nextlyhq/blocks-engine";
import type { ComponentType } from "react";

/** What the generated component map hands over. */
export interface BlockEditorModules {
  /** Each declared `editorEntry`'s export, keyed by its component path. */
  readonly entries?: Readonly<Record<string, unknown>>;
  /** Each declared block's own inspector (`editor.component`), by its path. */
  readonly components?: Readonly<Record<string, unknown>>;
}

/**
 * What has been handed over, by path.
 *
 * Module state, as the component registry beside it is, because the map
 * registers once when the admin loads and the editor reads at every mount. A
 * later call for the same path replaces the module, which is what a hot
 * reload of the map does.
 */
const entries = new Map<string, unknown>();
const components = new Map<string, ComponentType<BlockInspectorProps>>();

/** Each declared `editorEntry`'s export, by its path, as handed over. */
export const declaredEditorEntries: ReadonlyMap<string, unknown> = entries;

/**
 * Hand the editor the block modules the site's plugins declared.
 *
 * Called by the generated component map (`nextly generate:types`), never by
 * hand: the map is what knows every declared path and imports each module
 * statically, which is the only way plugin code reaches a bundled admin.
 *
 * @experimental The page builder's contribution contract is still settling.
 */
export function registerBlockEditorModules(modules: BlockEditorModules): void {
  for (const [path, value] of Object.entries(modules.entries ?? {})) {
    entries.set(path, value);
  }
  for (const [path, value] of Object.entries(modules.components ?? {})) {
    if (isComponent(value)) components.set(path, value);
    else {
      console.warn(
        `[page-builder] "${path}" is declared as a block's inspector, but it ` +
          `exports ${describeValue(value)}, not a React component. The block keeps ` +
          `its generated controls.`
      );
    }
  }
}

/**
 * A block's own inspector, by the path its definition names, or `undefined`
 * when nothing registered it, in which case the editor keeps the generated
 * controls.
 */
export function contributedInspector(
  path: string
): ComponentType<BlockInspectorProps> | undefined {
  return components.get(path);
}

/**
 * Whether a value can be rendered as a component: a function, or one of the
 * objects `memo` and `forwardRef` return.
 */
function isComponent(
  value: unknown
): value is ComponentType<BlockInspectorProps> {
  if (typeof value === "function") return true;
  return typeof value === "object" && value !== null && "$$typeof" in value;
}

/** A short account of a value, for a warning a person reads. */
export function describeValue(value: unknown): string {
  if (value === undefined) return "nothing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}
