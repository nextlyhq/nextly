import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import type { FieldConfig } from "../../../collections/fields/types";
import type { CollectionRelationshipService } from "../../../services/collections/collection-relationship-service";
import type { FieldGroupRegistryService } from "../../../services/field-groups/field-group-registry-service";
import type { Logger } from "../../../shared/types";
import type { SanitizedLocalizationConfig } from "../../i18n/config/types";

import {
  FieldGroupMutationService,
  type SaveComponentDataParams,
  type DeleteComponentDataParams,
} from "./field-group-mutation-service";
import {
  FieldGroupQueryService,
  type PopulateComponentDataParams,
  type PopulateComponentDataManyParams,
} from "./field-group-query-service";

export type {
  SaveComponentDataParams,
  DeleteComponentDataParams,
  PopulateComponentDataParams,
  PopulateComponentDataManyParams,
};

export class FieldGroupDataService {
  private readonly queryService: FieldGroupQueryService;
  private readonly mutationService: FieldGroupMutationService;

  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    private readonly registryService: FieldGroupRegistryService,
    relationshipService?: CollectionRelationshipService,
    // i18n: threaded to the query/mutation services so a localized embedded component
    // resolves/writes its translatable fields via `comp_<slug>_locales` per language.
    localization?: SanitizedLocalizationConfig
  ) {
    this.queryService = new FieldGroupQueryService(
      adapter,
      logger,
      registryService,
      relationshipService,
      localization
    );
    this.mutationService = new FieldGroupMutationService(
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

  /**
   * The component's physical table name as recorded in the registry.
   *
   * Callers that need to address a component's storage directly (a filter
   * subquery, for instance) must go through this rather than re-deriving the
   * name: a row written before names resolved canonically can still point at a
   * table the slug does not reconstruct. Returns null when the component is
   * unknown.
   */
  async getComponentTableName(
    slug: string,
    executor?: unknown
  ): Promise<string | null> {
    const record = await this.registryService.getComponentBySlug(
      slug,
      executor
    );
    return record?.tableName ?? null;
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

  /**
   * Verify every localized field group in a payload can be written, BEFORE the caller opens its
   * transaction. See {@link FieldGroupMutationService.assertLocalizedFieldGroupsWritable} — this
   * cannot run inside the transaction without risking pool starvation, and answering it first
   * keeps a refusal exactly as raised.
   *
   * Not optional bookkeeping: it is also what resolves each field group's readiness, which the
   * in-transaction write then reads. Skipping it leaves the write with no way to learn whether a
   * companion exists short of probing for one, which aborts the transaction on PostgreSQL when it
   * does not.
   */
  assertLocalizedFieldGroupsWritable(
    params: Pick<SaveComponentDataParams, "fields" | "data" | "locale">
  ): Promise<void> {
    return this.mutationService.assertLocalizedFieldGroupsWritable(params);
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
