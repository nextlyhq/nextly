/**
 * The newest declaration format this Nextly reads, in a module of its own
 * that imports nothing: the CLI's error catalogue names it in a refusal, and
 * everything the catalogue imports, every command loads at start-up.
 *
 * @module plugins/declaration/format-version
 */

/** @experimental The newest declaration format this Nextly reads. */
export const PLUGIN_PACKAGE_DECLARATION_FORMAT = 1 as const;
