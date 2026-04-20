/**
 * System Services Module
 *
 * Internal services for managing Nextly's system-level operations
 * including database schema initialization, migrations, and system
 * table management.
 *
 * @module services/system
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { SystemTableService } from '@nextly/services/system';
 *
 * const service = new SystemTableService(adapter, logger);
 * await service.ensureSystemTables();
 * ```
 */

export {
  SystemTableService,
  type SystemTableStatus,
  type SystemTableInitResult,
  type SystemMigrationSQL,
} from "./system-table-service";
