/**
 * The seam a field type a plugin adds uses to say which references its
 * stored value holds.
 *
 * Core cannot know what a plugin's value means, so the plugin declares one
 * visit over it: called with the value and a function to hand each reference
 * it holds to, it returns the value with each reference replaced by what that
 * function answered. The same visit lists references (every answer keeps the
 * reference) and rewrites them (an answer gives the new id or address), so
 * the two cannot disagree. A plugin field type that declares no shape is read
 * as JSON, for the media addresses under `src` or `url`.
 *
 * The plugin SDK's archive declaration fills this map; core holds no plugin
 * logic of its own here.
 *
 * @module domains/data/references/plugin-reference-shapes
 */

/** A reference a plugin field type's value holds. */
export type PluginFieldReference =
  /** An entry's or media item's id, in the collection named. */
  | { collection: string; id: string }
  /** A media file's address. */
  | { url: string };

/**
 * What a plugin field type declares: a visit over its stored value, already
 * parsed from JSON when the dialect returned a string. `at` answers the id or
 * address to store in place of each reference, or `undefined` to keep it. A
 * visit that changes nothing returns the value it was given.
 */
export interface PluginReferenceShape {
  visit(
    value: unknown,
    at: (reference: PluginFieldReference) => string | undefined
  ): unknown;
}

/** The declared shapes, by the field type a plugin adds. */
export type PluginReferenceShapes = ReadonlyMap<string, PluginReferenceShape>;
