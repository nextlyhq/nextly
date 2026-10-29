import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { NextlyError } from "../../errors";
import { isReservedResourceSlug } from "../../schemas/_zod/rbac";
import {
  addressRefusalError,
  findSameSnakeCaseAddress,
  addressSnakeForm,
  type UsedAddress,
} from "../../shared/address-rule";

type ResourceType = "collection" | "single";

interface SlugOwner {
  resourceType: ResourceType;
  id: string;
}

interface SlugGuardOptions {
  currentResourceType?: ResourceType;
  currentResourceId?: string;
  /**
   * The kind the address is for, named in a refusal. Defaults to the kind of
   * the resource being renamed, and to a collection when neither is given.
   */
  addressKind?: ResourceType;
}

async function findSlugOwner(
  adapter: DrizzleAdapter,
  slug: string
): Promise<SlugOwner | null> {
  const collection = await adapter.selectOne<{ id: string }>(
    "dynamic_collections",
    {
      where: { and: [{ column: "slug", op: "=", value: slug }] },
      columns: ["id"],
    }
  );

  if (collection?.id) {
    return {
      resourceType: "collection",
      id: collection.id,
    };
  }

  const single = await adapter.selectOne<{ id: string }>("dynamic_singles", {
    where: { and: [{ column: "slug", op: "=", value: slug }] },
    columns: ["id"],
  });

  if (single?.id) {
    return {
      resourceType: "single",
      id: single.id,
    };
  }

  return null;
}

/**
 * The collections' and Singles' addresses that may share `slug`'s snake_case
 * form, other than the resource being renamed. The database narrows the rows
 * with a LIKE pattern every such address matches (the form's words, anything
 * between and after them) and the rule decides among them.
 */
async function findSnakeCaseNeighbours(
  adapter: DrizzleAdapter,
  slug: string,
  options: SlugGuardOptions | undefined
): Promise<UsedAddress[]> {
  const pattern = `${addressSnakeForm(slug).split("_").join("%")}%`;
  const kinds = [
    ["dynamic_collections", "collection"],
    ["dynamic_singles", "single"],
  ] as const;
  const found = await Promise.all(
    kinds.map(async ([table, resourceType]) => {
      const rows = await adapter.select<{ id: string; slug: string }>(table, {
        where: { and: [{ column: "slug", op: "LIKE", value: pattern }] },
        columns: ["id", "slug"],
      });
      return rows
        .filter(
          row =>
            !(
              resourceType === options?.currentResourceType &&
              row.id === options?.currentResourceId
            )
        )
        .map(row => ({ kind: resourceType, address: row.slug }));
    })
  );
  return found.flat();
}

export async function assertGlobalResourceSlugAvailable(
  adapter: DrizzleAdapter,
  slug: string,
  options?: SlugGuardOptions
): Promise<void> {
  const owner = await findSlugOwner(adapter, slug);

  const isSameResource =
    owner != null &&
    owner.resourceType === options?.currentResourceType &&
    owner.id === options?.currentResourceId;

  // A name that collides with a system resource's permissions may not be taken
  // as a slug on any path — create or rename, collection or single. Checked
  // before the uniqueness lookup because a system resource is not a dynamic
  // collection or single, so it would otherwise read as "available". A resource
  // that somehow already holds such a slug (created before the name became
  // reserved) may keep it: rejecting a no-op save would strand it with no way
  // to edit anything else.
  if (isReservedResourceSlug(slug) && !isSameResource) {
    throw NextlyError.validation({
      errors: [
        {
          path: "slug",
          code: "reserved_slug",
          message:
            "This name is reserved by Nextly and cannot be used as a slug. Choose a different name.",
        },
      ],
      logContext: { reason: "system-resource-slug", slug },
    });
  }

  if (!owner) {
    // A new address, for this resource: refused when its snake_case form is
    // another collection's or Single's, since two addresses that differ only
    // by `-` and `_` read as one. Asked only here, so an address a resource
    // already holds keeps working whatever its neighbours are.
    // The kind names the refusal; a caller that does not say it gets one
    // naming the address alone, since collections and Singles share it.
    const kind = options?.addressKind ?? options?.currentResourceType;
    const twin = findSameSnakeCaseAddress(
      kind ?? "collection",
      slug,
      await findSnakeCaseNeighbours(adapter, slug, options),
      { kindKnown: kind !== undefined }
    );
    if (twin) throw addressRefusalError(twin, slug);
    return;
  }

  if (isSameResource) {
    return;
  }

  // Public message stays generic (spec §13.8): no slug or resource-type
  // echoing. The conflict-target details flow into logContext for operators.
  throw NextlyError.duplicate({
    logContext: {
      slug,
      conflictResourceType: owner.resourceType,
      conflictResourceId: owner.id,
    },
  });
}
