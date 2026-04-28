import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";

import { NextlyError } from "../../errors";

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
  if (!owner) {
    return;
  }

  const isSameResource =
    owner.resourceType === options?.currentResourceType &&
    owner.id === options?.currentResourceId;

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
