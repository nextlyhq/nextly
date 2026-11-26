/**
 * A site's field-group names as a message shows them, read from the storage catalog rather than
 * written out. A leaf, since command definitions read it before any command runs.
 *
 * @module domains/field-groups/services/field-group-names-shown
 */
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { MIGRATION_TARGET } from "../migration/target";

/** The legacy names: the registry, and a group's table. */
export const LEGACY_NAMES_SHOWN = `${STORAGE_FORMAT.registryTable}, ${STORAGE_FORMAT.tablePrefix}<slug>`;

/** The current names: the registry, and a group's table. */
export const CURRENT_NAMES_SHOWN = `${MIGRATION_TARGET.registryTable}, ${MIGRATION_TARGET.tablePrefix}<slug>`;
