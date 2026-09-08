/**
 * Which resources the permissions page treats as built into Nextly rather than
 * as dynamic collections, and the order it shows them in.
 *
 * Kept as its own module rather than inline in the page so the parity test that
 * holds it against core's `SYSTEM_RESOURCES` does not have to import a React
 * page and everything it pulls in.
 *
 * Both views now DERIVE from one definition in `constants/permissions`, so they
 * can no longer disagree with each other — only with core, which is the
 * divergence the parity test is positioned to catch.
 */
import {
  SYSTEM_RESOURCES_IN_DISPLAY_ORDER,
  SYSTEM_RESOURCE_SET,
} from "../../../../constants/permissions";

/** Resources that are built-in to Nextly (not dynamic collections). */
export const SYSTEM_RESOURCES = SYSTEM_RESOURCE_SET;

/** Display order for the system group; collections follow alphabetically. */
export const SYSTEM_ORDER: readonly string[] =
  SYSTEM_RESOURCES_IN_DISPLAY_ORDER;
