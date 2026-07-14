import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

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
    registryService: ComponentRegistryService,
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
