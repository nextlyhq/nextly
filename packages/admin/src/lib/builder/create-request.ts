/**
 * The create request that saves an entity created in the Schema Builder, from
 * the settings the dialog set (and the editor may have changed since) and every
 * field it is saved with.
 *
 * @module lib/builder/create-request
 */
import type { BuilderSettingsValues } from "@admin/components/features/schema-builder/BuilderSettingsModal";
import type {
  CreateCollectionPayload,
  FieldDefinition,
} from "@admin/types/collection";

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
