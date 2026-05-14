/**
 * Generator pipeline — `collect` phase.
 *
 * Reads from the three runtime registries (collections / singles /
 * components) and bundles them with any explicitly supplied module
 * contributors into a single result the inference phases consume.
 *
 * The phase is intentionally tiny:
 *   - one parallel fetch from the three registry adapters
 *   - pass-through of the modules array
 *   - no transformation, no field mapping
 *
 * Why a Registries interface (vs importing the concrete services
 * directly): the generator stays decoupled from the runtime registry
 * implementations. The route handler is the only place that wires the
 * real CollectionRegistryService / SingleRegistryService / etc. to this
 * interface. That keeps the generator pure and easy to unit-test, and
 * lets future variants (e.g. a build-time CLI snapshot) supply their own
 * sources of truth.
 *
 * @module nextly/openapi/generator/collect
 */

import type { CollectionConfig } from "../../collections/config/define-collection";
import type { ComponentConfig } from "../../components/config/types";
import type { SingleConfig } from "../../singles/config/types";

import type { ModuleContributor } from "./define-module";

export interface Registries {
  collections: {
    getAllCollections: () => Promise<readonly CollectionConfig[]>;
  };
  singles: {
    getAllSingles: () => Promise<readonly SingleConfig[]>;
  };
  components: {
    getAllComponents: () => Promise<readonly ComponentConfig[]>;
  };
}

export interface CollectResult {
  collections: readonly CollectionConfig[];
  singles: readonly SingleConfig[];
  components: readonly ComponentConfig[];
  modules: readonly ModuleContributor[];
}

export async function collect(args: {
  registries: Registries;
  modules: readonly ModuleContributor[];
}): Promise<CollectResult> {
  const [collections, singles, components] = await Promise.all([
    args.registries.collections.getAllCollections(),
    args.registries.singles.getAllSingles(),
    args.registries.components.getAllComponents(),
  ]);
  return {
    collections,
    singles,
    components,
    modules: args.modules,
  };
}
