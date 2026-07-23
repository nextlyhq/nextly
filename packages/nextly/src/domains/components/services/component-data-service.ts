import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import type { FieldConfig } from "../../../collections/fields/types";
import type { CollectionRelationshipService } from "../../../services/collections/collection-relationship-service";
import type { ComponentRegistryService } from "../../../services/components/component-registry-service";
import type { Logger } from "../../../shared/types";
import type { SanitizedLocalizationConfig } from "../../i18n/config/types";

import {
  ComponentMutationService,
  type SaveComponentDataParams,
  type DeleteComponentDataParams,
} from "./component-mutation-service";
import {
  ComponentQueryService,
  type PopulateComponentDataParams,
  type PopulateComponentDataManyParams,
} from "./component-query-service";

export type {
  SaveComponentDataParams,
  DeleteComponentDataParams,
  PopulateComponentDataParams,
  PopulateComponentDataManyParams,
};

export class ComponentDataService {
  private readonly queryService: ComponentQueryService;
  private readonly mutationService: ComponentMutationService;

  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    private readonly registryService: ComponentRegistryService,
    relationshipService?: CollectionRelationshipService,
    // i18n: threaded to the query/mutation services so a localized embedded component
    // resolves/writes its translatable fields via `comp_<slug>_locales` per language.
    localization?: SanitizedLocalizationConfig
  ) {
    this.queryService = new ComponentQueryService(
      adapter,
      logger,
      registryService,
      relationshipService,
      localization
    );
    this.mutationService = new ComponentMutationService(
      adapter,
      logger,
      registryService,
      localization
    );
  }

  /**
   * The component's own field definitions, resolved from the registry so
   * Schema-Builder components (which exist only in the database) are covered as
   * well as config-defined ones. Callers that must reason about fields nested
   * inside a component reference use this rather than reaching for the registry
   * directly. Returns null when the component is unknown.
   *
   * `executor` is forwarded so a caller already inside a write transaction can
   * read on that transaction's connection. Without it the lookup takes a
   * second pooled connection while the transaction still holds its own, which
   * stalls against a small pool.
   */
  async getComponentFields(
    slug: string,
    executor?: unknown
  ): Promise<FieldConfig[] | null> {
    const record = await this.registryService.getComponentBySlug(
      slug,
      executor
    );
    return record?.fields ?? null;
  }

  /**
   * Whether the component's OWN definition is localized — i.e. its translatable
   * field values route to the per-locale companion (`comp_<slug>_locales`)
   * table. Mirrors the storage gate in the component mutation service
   * (`meta.localized !== true` keeps all data on the shared main table
   * regardless of inner field types), so a caller can tell a per-locale
   * component write apart from a shared one without re-deriving it from the
   * inner field types.
   */
  async isComponentLocalized(
    slug: string,
    executor?: unknown
  ): Promise<boolean> {
    const record = await this.registryService.getComponentBySlug(
      slug,
      executor
    );
    return record?.localized === true;
  }

  setRelationshipService(service: CollectionRelationshipService): void {
    this.queryService.setRelationshipService(service);
  }

  saveComponentData(params: SaveComponentDataParams): Promise<void> {
    return this.mutationService.saveComponentData(params);
  }

  saveComponentDataInTransaction(
    tx: TransactionContext,
    params: SaveComponentDataParams
  ): Promise<void> {
    return this.mutationService.saveComponentDataInTransaction(tx, params);
  }

  deleteComponentData(params: DeleteComponentDataParams): Promise<void> {
    return this.mutationService.deleteComponentData(params);
  }

  deleteComponentDataInTransaction(
    tx: TransactionContext,
    params: DeleteComponentDataParams
  ): Promise<void> {
    return this.mutationService.deleteComponentDataInTransaction(tx, params);
  }

  populateComponentData(
    params: PopulateComponentDataParams
  ): Promise<Record<string, unknown>> {
    return this.queryService.populateComponentData(params);
  }

  populateComponentDataMany(
    params: PopulateComponentDataManyParams
  ): Promise<Record<string, unknown>[]> {
    return this.queryService.populateComponentDataMany(params);
  }
}
