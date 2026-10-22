/**
 * Field write rules on the field-group instances a write stores inline.
 *
 * An instance directly on a document is stored in its field group's own table
 * and judged by the save that writes it there. One inside a group, a repeater
 * row or another instance has no table: it is stored inline, in its
 * container's column, so no field-group save reaches it, and this judges it
 * instead, through the same walk the read passes use.
 *
 * @module domains/field-groups/field-group-write-access
 */

import type { FieldConfig } from "../../collections/fields/types";
import { keepDeniedAtStored } from "../../shared/lib/denied-change";
import {
  anyFieldGroupHasAccessRule,
  applyFieldWriteAccess,
  callerAccessGrants,
} from "../../shared/lib/field-level-registry";
import { resolveComponentFieldMap } from "../versions/tag-component-types";

import {
  forEachFieldGroupInstance,
  type FieldGroupFieldsBySlug,
} from "./field-group-instances";
import {
  lookupOncePerFieldGroup,
  type FieldGroupFieldsSource,
} from "./live-read-access";
import type { FieldGroupWriteAccess } from "./services/field-group-mutation-service";

/**
 * An update's field rules, applied in place, with every value they deny
 * inside a container kept as the row holds it: the entity's own (`ownRules`)
 * and those of the field groups it stores inline.
 *
 * A group or repeater is written whole, so a denied child removed from the
 * update would otherwise be cleared from the row: `keepDeniedAtStored` puts
 * the stored value back, the one answer a promotion gives the same question.
 * `stored` is the row in the update's representation.
 */
export async function keepDeniedAtStoredOnUpdate(params: {
  data: Record<string, unknown>;
  stored: Record<string, unknown>;
  fields: readonly FieldConfig[];
  source: FieldGroupFieldsSource | undefined;
  access: FieldGroupWriteAccess;
  executor?: unknown;
  /**
   * The entity's own field rules on the document it is given, in place: run
   * first, so a group of the entity's that a rule removes whole is not walked
   * for the field groups inside it.
   */
  ownRules: (document: Record<string, unknown>) => Promise<void>;
}): Promise<void> {
  if (params.access.overrideAccess) return;
  const kept = await keepDeniedAtStored({
    update: params.data,
    stored: params.stored,
    applyRules: async document => {
      await params.ownRules(document);
      await applyInlineFieldGroupWriteAccess({
        data: document,
        fields: params.fields,
        source: params.source,
        operation: "update",
        access: params.access,
        executor: params.executor,
      });
    },
  });
  // In place: the caller holds this object, and so may what it was handed to.
  for (const key of Object.keys(params.data)) delete params.data[key];
  Object.assign(params.data, kept);
}

/**
 * Remove, in place, every field of an inline field-group instance in `data`
 * that the writer may not set, by that field group's own rules.
 *
 * `operation` is the document's: an inline instance has no row of its own to
 * exist or not, so it is created with the document and updated with it.
 * Nothing is looked up unless some field group declares a rule for it.
 */
export async function applyInlineFieldGroupWriteAccess(params: {
  data: Record<string, unknown>;
  fields: readonly FieldConfig[];
  source: FieldGroupFieldsSource | undefined;
  operation: "create" | "update";
  access: FieldGroupWriteAccess;
  /** The write's transaction-bound executor, when it holds a connection. */
  executor?: unknown;
}): Promise<void> {
  const { access, operation } = params;
  if (access.overrideAccess) return;
  if (!anyFieldGroupHasAccessRule(operation)) return;
  const source = params.source;
  const fieldGroupFields = source
    ? await resolveComponentFieldMap(
        [...params.fields],
        lookupOncePerFieldGroup({
          getComponentFields: slug =>
            source.getComponentFields(slug, params.executor),
        })
      )
    : new Map<string, FieldConfig[]>();
  await judgeFieldGroupInstances({
    data: params.data,
    fields: params.fields,
    fieldGroupFields,
    operation,
    access: {
      ...access,
      grants:
        access.grants ??
        callerAccessGrants(
          access.user,
          access.authenticatedScope,
          params.executor
        ),
    },
    // One stored in its own table is judged by the save that writes it there.
    inlineOnly: true,
  });
}

/** The one judgment both passes make, over the instances the walk reaches. */
async function judgeFieldGroupInstances(params: {
  data: Record<string, unknown>;
  fields: readonly FieldConfig[];
  fieldGroupFields: FieldGroupFieldsBySlug;
  operation: "create" | "update";
  access: FieldGroupWriteAccess;
  inlineOnly: boolean;
}): Promise<void> {
  const { access } = params;
  await forEachFieldGroupInstance(
    params.data,
    params.fields,
    params.fieldGroupFields,
    async ({ instance, slug, inline }) => {
      if (params.inlineOnly && !inline) return;
      await applyFieldWriteAccess({
        kind: "fieldGroup",
        slug,
        data: instance,
        operation: params.operation,
        user: access.user,
        authenticatedScope: access.authenticatedScope,
        overrideAccess: false,
        grants: access.grants,
      });
    },
    // A write's value is live, so a single field group's instance is judged by
    // the field group its field declares, whatever type it claims.
    { declaredComponentDecides: true }
  );
}
