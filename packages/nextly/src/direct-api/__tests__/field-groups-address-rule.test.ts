import { describe, expect, it, vi } from "vitest";

import { FieldGroupMetadataService } from "../../domains/field-groups/services/field-group-metadata-service";
import type { FieldGroupRegistryService } from "../../services/field-groups/field-group-registry-service";
import { judgeAddress } from "../../shared/address-rule";
import { ADDRESS_CASES } from "../../shared/__tests__/helpers/address-cases";
import type { Logger } from "../../shared/types";
import { createFieldGroupsNamespace } from "../namespaces/field-groups";

const logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

/** The namespace over the REAL service and a registry holding nothing. */
function namespaceOver(
  metadata?: Partial<FieldGroupMetadataService>
): ReturnType<typeof createFieldGroupsNamespace> {
  const registry = {
    registerComponent: vi.fn(async (row: Record<string, unknown>) => ({
      id: "comp-1",
      ...row,
    })),
    getAllComponents: vi.fn().mockResolvedValue([]),
  };
  const ctx = {
    fieldGroupRegistryService: registry,
    fieldGroupMetadataService:
      metadata ??
      new FieldGroupMetadataService(
        registry as unknown as FieldGroupRegistryService,
        logger
      ),
    logger,
  };
  return createFieldGroupsNamespace(
    ctx as unknown as Parameters<typeof createFieldGroupsNamespace>[0]
  );
}

/** The message a refusal carries, or `null` for a create that went through. */
async function verdictOf(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    const data = (error as { publicData?: { errors?: { message: string }[] } })
      .publicData;
    return data?.errors?.[0]?.message ?? (error as Error).message;
  }
}

describe("fieldGroups.create judges a new address by the one rule", () => {
  it.each(ADDRESS_CASES)("gives '%s' the rule's verdict", async address => {
    const namespace = namespaceOver();

    expect(
      await verdictOf(() =>
        namespace.create({
          slug: address,
          label: "Thing",
          fields: [{ type: "text", name: "title" }],
        })
      )
    ).toBe(judgeAddress("fieldGroup", address)?.message ?? null);
  });
});

describe("fieldGroups.update keeps an address the field group already has", () => {
  it("updates the fields of a field group whose address the rule refuses", async () => {
    // A field group the Builder created before the rule, under a SQL word it now refuses.
    const updateFieldGroup = vi.fn().mockResolvedValue({
      record: { id: "comp-1", slug: "select", fields: [] },
    });
    const namespace = namespaceOver({ updateFieldGroup });

    await namespace.update({
      slug: "select",
      data: { fields: [{ type: "text", name: "title" }] },
    });

    expect(updateFieldGroup).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "select" })
    );
  });
});
