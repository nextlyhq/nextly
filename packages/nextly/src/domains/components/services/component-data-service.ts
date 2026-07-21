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
   */
  async getComponentFields(slug: string): Promise<FieldConfig[] | null> {
    const record = await this.registryService.getComponentBySlug(slug);
    return record?.fields ?? null;
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
