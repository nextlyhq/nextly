import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { NextlyError } from "../../errors";
import { isReservedResourceSlug } from "../../schemas/_zod/rbac";

type ResourceType = "collection" | "single";

interface SlugOwner {
  resourceType: ResourceType;
  id: string;
}

interface SlugGuardOptions {
  currentResourceType?: ResourceType;
  currentResourceId?: string;
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
