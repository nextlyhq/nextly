/**
 * An entity made because a template needs it: a collection a link points at,
 * a field group a field uses. Named from its address ("blog_posts" is "Blog
 * posts"), with its kind's create defaults, the icon its name suggests, and
 * no fields beyond its kind's starting ones; the person adds the rest in its
 * editor. Owned by the entity that needs it, so that entity's save creates it
 * first, and its Discard all lets it go.
 *
 * @module components/features/schema-builder/new-entity/needed-entities
 */
import { suggestIcon } from "@admin/lib/builder/icon-suggestion";
import type { UnsavedEntity } from "@admin/lib/builder/unsaved-entities";

import type { BuilderConfig, BuilderKind } from "../builder-config";
import { createDefaults, normalizedSettings } from "../BuilderSettingsModal";
import { COLLECTION_BUILDER_CONFIG } from "../collection-builder-config";
import { FIELD_GROUP_BUILDER_CONFIG } from "../field-group-builder-config";

/** The kinds a template can need: collections it links to, field groups it uses. */
export type NeededKind = Extract<BuilderKind, "collection" | "field-group">;

const CONFIG: Record<NeededKind, BuilderConfig> = {
  collection: COLLECTION_BUILDER_CONFIG,
  "field-group": FIELD_GROUP_BUILDER_CONFIG,
};

/** A name for an address: its words, the first capitalized. */
function nameOfAddress(address: string): string {
  const words = address.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function neededEntity(
  kind: NeededKind,
  address: string,
  owner: NonNullable<UnsavedEntity["ownedBy"]>
): Omit<UnsavedEntity, "token"> {
  const config = CONFIG[kind];
  const name = nameOfAddress(address);
  return {
    kind,
    address,
    settings: normalizedSettings({
      ...createDefaults(config),
      singularName: name,
      // The name as the plural too: the address is often plural already
      // ("authors"), and either can be changed in its settings.
      pluralName: config.basicsFields.includes("pluralName") ? name : undefined,
      slug: address,
      icon: config.basicsFields.includes("icon") ? suggestIcon(name) : "",
    }),
    // The standard starting fields, which are none: the person adds its
    // fields in its editor.
    fields: [],
    ownedBy: owner,
  };
}
