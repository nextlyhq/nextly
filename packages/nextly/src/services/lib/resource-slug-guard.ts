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
 * The collections and Singles whose address has the same snake_case form as
 * `slug`, other than the resource being renamed. The snake_case form doubles as
 * the LIKE pattern: each `_` matches one `-` or `_`, so the database narrows
 * the rows and the rule decides among them.
 */
async function findSnakeCaseNeighbours(
  adapter: DrizzleAdapter,
  slug: string,
  options: SlugGuardOptions | undefined
): Promise<UsedAddress[]> {
  const neighbours: UsedAddress[] = [];
  const kinds = [
    ["dynamic_collections", "collection"],
    ["dynamic_singles", "single"],
  ] as const;
  for (const [table, resourceType] of kinds) {
    const rows = await adapter.select<{ id: string; slug: string }>(table, {
      where: {
        and: [{ column: "slug", op: "LIKE", value: addressSnakeForm(slug) }],
      },
      columns: ["id", "slug"],
    });
    for (const row of rows) {
      const isSelf =
        resourceType === options?.currentResourceType &&
        row.id === options?.currentResourceId;
      if (!isSelf) neighbours.push({ kind: resourceType, address: row.slug });
    }
  }
  return neighbours;
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
    const twin = findSameSnakeCaseAddress(
      options?.addressKind ?? options?.currentResourceType ?? "collection",
      slug,
      await findSnakeCaseNeighbours(adapter, slug, options)
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
