/**
 * The create request that saves an entity created in the Schema Builder, from
 * the settings the dialog set (and the editor may have changed since) and every
 * field it is saved with.
 *
 * @module lib/builder/create-request
 */
import type { BuilderSettingsValues } from "@admin/components/features/schema-builder/BuilderSettingsModal";
import type { CreateComponentPayload } from "@admin/services/fieldGroupApi";
import type {
  CreateCollectionPayload,
  FieldDefinition,
} from "@admin/types/collection";
import type { UpdateSinglePayload } from "@admin/types/entities";

export function collectionCreatePayload(
  address: string,
  settings: BuilderSettingsValues,
  fields: FieldDefinition[]
): CreateCollectionPayload {
  const singular = settings.singularName.trim();
  return {
    name: address,
    labels: {
      singular,
      plural: settings.pluralName?.trim() || `${singular}s`,
    },
    description: settings.description,
    icon: settings.icon,
    // Code-first config can still set admin.group / admin.order; the Builder
    // does not surface them at create.
    status: settings.status === true,
    // Created as localized when Internationalization is on, so the collection
    // is not persisted as non-localized regardless of the switch.
    localized: settings.i18n === true,
    // Version history opt-in at create; the server resolves the boolean.
    versions: settings.versions === true,
    // Retention: how many durable versions to keep (false = unlimited,
    // undefined = the default 50). The server resolves it with the switch.
    versionsMaxPerDoc: settings.versionsMaxPerDoc,
    // Cache revalidation and webhook recording are on by default, so only an
    // explicit false is forwarded as off. The server resolves each boolean.
    revalidate: settings.revalidate !== false,
    webhooks: settings.webhooks !== false,
    // The server adds the system columns (id, title, slug, timestamps, status
    // when on); these are the fields the person added, the starting field
    // among them.
    fields,
  };
}

export function singleCreatePayload(
  address: string,
  settings: BuilderSettingsValues,
  fields: FieldDefinition[]
): UpdateSinglePayload {
  return {
    slug: address,
    label: settings.singularName.trim(),
    description: settings.description,
    // Code-first config can still set admin.group / admin.order; the Builder
    // does not surface them at create.
    admin: { icon: settings.icon },
    // Status passes through; the server adds its column on first enable.
    ...(settings.status === true ? { status: true } : {}),
    // The Internationalization flag at create; the companion table is
    // provisioned once a translatable field is added.
    ...(settings.i18n === true ? { localized: true } : {}),
    // Version history opt-in at create; the server resolves the boolean.
    ...(settings.versions === true ? { versions: true } : {}),
    // Retention, only when set (else the server default 50); false =
    // unlimited, a number = keep that many.
    ...(settings.versionsMaxPerDoc !== undefined
      ? { versionsMaxPerDoc: settings.versionsMaxPerDoc }
      : {}),
    // Cache revalidation and webhook recording are on by default, so only an
    // explicit opt-out is forwarded; omitting the key keeps the server default.
    ...(settings.revalidate === false ? { revalidate: false } : {}),
    ...(settings.webhooks === false ? { webhooks: false } : {}),
    // The server adds the system columns; these are the fields the person
    // added, the starting field among them.
    fields,
  };
}

export function fieldGroupCreatePayload(
  address: string,
  settings: BuilderSettingsValues,
  fields: FieldDefinition[]
): CreateComponentPayload {
  return {
    slug: address,
    label: settings.singularName.trim(),
    // Already normalised by the dialog, the one boundary both this request
    // and the manifest projection read from.
    description: settings.description,
    admin: {
      category: settings.category?.trim() || undefined,
      icon: settings.icon,
    },
    // The Internationalization flag at create; the companion table is
    // provisioned once a translatable field is added.
    ...(settings.i18n === true ? { localized: true } : {}),
    // The server adds the system columns; these are the fields the person
    // added.
    fields,
  };
}
