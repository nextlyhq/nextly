/**
 * Nextly Initialization — Service Config Builder
 *
 * Merges caller-provided configuration with the loaded `nextly.config.ts`
 * into a final `NextlyServiceConfig` passed to the DI container.
 *
 * Extracted from `init.ts` so initialization orchestration can stay
 * focused on cache/lifecycle concerns.
 *
 * @module init/build-service-config
 */

import type { SanitizedNextlyConfig } from "../collections/config/define-config";
import type { NextlyServiceConfig } from "../di/register";
import { getImageProcessor } from "../storage/image-processor";

/**
 * Configuration options for getNextly().
 *
 * Extends NextlyServiceConfig with an optional `config` property
 * that allows passing a pre-loaded nextly.config.ts configuration.
 */
export interface GetNextlyOptions extends Partial<NextlyServiceConfig> {
  /**
   * Pre-loaded Nextly configuration from nextly.config.ts.
   *
   * If provided, storage plugins will be extracted from this config.
   * This is the recommended way to integrate with nextly.config.ts
   * since dynamic config loading is not supported in Next.js runtime.
   *
   * @example
   * ```typescript
   * import { getNextly } from '@revnixhq/nextly';
   * import nextlyConfig from '../nextly.config';
   *
   * const nextly = await getNextly({ config: nextlyConfig });
   * ```
   */
  config?: SanitizedNextlyConfig;
}

/**
 * Build the final service configuration.
 *
 * Priority:
 * 1. Explicitly provided storagePlugins take precedence
 * 2. Storage plugins from provided config (nextly.config.ts) are used if available
 * 3. Collections from nextly.config.ts are forwarded if not explicitly provided
 * 4. Plugins from nextly.config.ts are forwarded if not explicitly provided
 * 5. Default image processor is used if not provided
 *
 * @param providedConfig - Config options provided by the user
 * @returns Complete service configuration
 */
export function buildServiceConfig(
  providedConfig?: GetNextlyOptions
): NextlyServiceConfig {
  // Start with provided config or empty object
  const serviceConfig: Partial<NextlyServiceConfig> = {};

  // Copy over service config properties (excluding 'config')
  if (providedConfig) {
    const { config: nextlyConfig, ...rest } = providedConfig;
    Object.assign(serviceConfig, rest);

    // If storagePlugins not explicitly provided, use from nextly.config.ts
    if (!serviceConfig.storagePlugins && nextlyConfig?.storage) {
      serviceConfig.storagePlugins = nextlyConfig.storage;
      if (nextlyConfig.storage.length > 0) {
        console.log(
          `[Nextly] Using ${nextlyConfig.storage.length} storage plugin(s) from config`
        );
      }
    }

    // If collections not explicitly provided, use from nextly.config.ts
    if (!serviceConfig.collections && nextlyConfig?.collections) {
      serviceConfig.collections = nextlyConfig.collections;
      if (nextlyConfig.collections.length > 0) {
        console.log(
          `[Nextly] Using ${nextlyConfig.collections.length} collection(s) from config`
        );
      }
    }

    // If singles not explicitly provided, use from nextly.config.ts
    if (!serviceConfig.singles && nextlyConfig?.singles) {
      serviceConfig.singles = nextlyConfig.singles;
      if (nextlyConfig.singles.length > 0) {
        console.log(
          `[Nextly] Using ${nextlyConfig.singles.length} single(s) from config`
        );
      }
    }

    // If components not explicitly provided, use from nextly.config.ts
    if (!serviceConfig.components && nextlyConfig?.components) {
      serviceConfig.components = nextlyConfig.components;
      if (nextlyConfig.components.length > 0) {
        console.log(
          `[Nextly] Using ${nextlyConfig.components.length} component(s) from config`
        );
      }
    }

    // If plugins not explicitly provided, use from nextly.config.ts
    if (!serviceConfig.plugins && nextlyConfig?.plugins) {
      serviceConfig.plugins = nextlyConfig.plugins;
      if (nextlyConfig.plugins.length > 0) {
        console.log(
          `[Nextly] Using ${nextlyConfig.plugins.length} plugin(s) from config`
        );
      }
    }

    // If users config not explicitly provided, use from nextly.config.ts
    if (!serviceConfig.users && nextlyConfig?.users) {
      serviceConfig.users = nextlyConfig.users;
    }

    // If email config not explicitly provided, use from nextly.config.ts
    if (!serviceConfig.email && nextlyConfig?.email) {
      serviceConfig.email = nextlyConfig.email;
    }

    // If apiKeys config not explicitly provided, use from nextly.config.ts
    if (!serviceConfig.apiKeys && nextlyConfig?.apiKeys) {
      serviceConfig.apiKeys = nextlyConfig.apiKeys;
    }

    // If security config not explicitly provided, use from nextly.config.ts
    if (!serviceConfig.security && nextlyConfig?.security) {
      serviceConfig.security = nextlyConfig.security;
    }
  }

  // Ensure imageProcessor is always provided
  if (!serviceConfig.imageProcessor) {
    serviceConfig.imageProcessor = getImageProcessor();
  }

  return serviceConfig as NextlyServiceConfig;
}
