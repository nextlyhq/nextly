import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import type { TransactionContext } from "@revnixhq/adapter-drizzle/types";

import type { CollectionRelationshipService } from "../../../services/collections/collection-relationship-service";
import type { ComponentRegistryService } from "../../../services/components/component-registry-service";
import type { Logger } from "../../../shared/types";

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
    relationshipService?: CollectionRelationshipService
  ) {
    this.queryService = new ComponentQueryService(
      adapter,
      logger,
      registryService,
      relationshipService
    );
    this.mutationService = new ComponentMutationService(
      adapter,
      logger,
      registryService
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
