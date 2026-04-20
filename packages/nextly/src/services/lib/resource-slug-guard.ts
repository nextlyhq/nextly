import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";

import { ServiceError, ServiceErrorCode } from "../../errors";

type ResourceType = "collection" | "single";

interface SlugOwner {
  resourceType: ResourceType;
  id: string;
}

interface SlugGuardOptions {
  currentResourceType?: ResourceType;
  currentResourceId?: string;
}

function createConflictMessage(slug: string, owner: SlugOwner): string {
  return `Slug "${slug}" is already used by a ${owner.resourceType}. Slugs must be unique across collections and singles.`;
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
  if (!owner) {
    return;
  }

  const isSameResource =
    owner.resourceType === options?.currentResourceType &&
    owner.id === options?.currentResourceId;

  if (isSameResource) {
    return;
  }

  throw new ServiceError(
    ServiceErrorCode.DUPLICATE_KEY,
    createConflictMessage(slug, owner),
    {
      slug,
      conflictResourceType: owner.resourceType,
      conflictResourceId: owner.id,
    }
  );
}
