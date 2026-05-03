/**
 * Shared context passed to every domain registration function.
 *
 * The orchestrator (`register.ts`) creates this after bootstrapping the
 * adapter, logger, and media storage, then forwards it to each
 * `registerXServices()` entrypoint. Each registration reads what it needs
 * from the context and wires factories into the DI container.
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";

import type { HookRegistry } from "../../hooks/hook-registry";
import type { Logger } from "../../services/shared";
import type { IStorageAdapter } from "../../storage/types";
import type { ImageProcessor } from "../../storage/image-processor";
import { MediaStorage } from "../../storage/storage";
import type { DatabaseInstance } from "../../types/database-operations";
import type { NextlyServiceConfig } from "../register";

export interface RegistrationContext {
  /** Database adapter used by every service. */
  adapter: DrizzleAdapter;

  /**
   * Raw Drizzle instance extracted from the adapter, shared with legacy
   * services (e.g. CollectionFileManager, CollectionsHandler) that still
   * require a direct Drizzle reference.
   */
  adapterDrizzleDb: DatabaseInstance;

  /** Resolved logger (caller-provided or `consoleLogger`). */
  logger: Logger;

  /**
   * Plugin-transformed configuration. All downstream services see this
   * object, so plugin `config()` transformers are honored.
   */
  config: NextlyServiceConfig;

  /** Resolved base path for collection file operations. */
  basePath: string;

  /** Optional override for the dynamic schemas directory. */
  schemasDir?: string;

  /** Optional override for the dynamic migrations directory. */
  migrationsDir?: string;

  /**
   * Resolved storage adapter for legacy media services. Null when no
   * storage plugin or adapter was configured — media operations will
   * be unavailable in that case, but the app can still boot.
   */
  storage: IStorageAdapter | null;

  /** Initialized media storage manager (plugins already registered). */
  mediaStorage: MediaStorage;

  /** Image processor used by media services. */
  imageProcessor: ImageProcessor;

  /** Optional hook registry; when absent, a no-op registry is used. */
  hookRegistry?: HookRegistry;

  /** Optional password hasher forwarded to UserService. */
  passwordHasher?: NextlyServiceConfig["passwordHasher"];
}
