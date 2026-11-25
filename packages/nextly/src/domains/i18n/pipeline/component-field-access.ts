/**
 * The field update rules of the components a document holds inline, in a row of a repeater or in a
 * group: each declared on the component, and registered under it, so the document's own rules never
 * reach them. Asked of the body a save would send, as that save asks them.
 *
 * A component on the document itself has a table of its own, and is judged by the save of its row.
 *
 * @experimental
 *
 * @module domains/i18n/pipeline/component-field-access
 */
import type { AuthenticatedScope } from "../../../auth/authenticated-scope";
import type { FieldConfig } from "../../../collections/fields/types";
import { getService } from "../../../di";
import { anyFieldGroupHasAccessRule } from "../../../shared/lib/field-level-registry";
import type { UserContext } from "../../collections/services/collection-types";
import { applyInlineFieldGroupWriteAccess } from "../../field-groups/field-group-write-access";

/** The collection or Single a body is of. */
interface DocumentKind {
  readonly kind: "collection" | "single";
  readonly slug: string;
}

/** Who a body is judged as: never trusted code, which no rule is asked of. */
interface RuleCaller {
  user?: UserContext;
  authenticatedScope?: AuthenticatedScope;
}

/** The fields a document's collection or Single declares, as it is registered. */
async function declaredFields({
  kind,
  slug,
}: DocumentKind): Promise<readonly FieldConfig[]> {
  const record =
    kind === "collection"
      ? await getService("collectionRegistryService").getCollectionBySlug(slug)
      : await getService("singleRegistryService").getSingleBySlug(slug);
  return record?.fields ?? [];
}

/**
 * Removes from `data`, in place, each field of a component held inline that the caller may not
 * change. `data` holds containers as values. Nothing is read where no component has such a rule.
 */
export async function applyComponentUpdateRules(
  document: DocumentKind,
  caller: RuleCaller,
  data: Record<string, unknown>
): Promise<void> {
  if (!anyFieldGroupHasAccessRule("update")) return;
  await applyInlineFieldGroupWriteAccess({
    data,
    fields: await declaredFields(document),
    source: getService("fieldGroupDataService"),
    operation: "update",
    access: {
      overrideAccess: false,
      user: caller.user,
      authenticatedScope: caller.authenticatedScope,
    },
  });
}
