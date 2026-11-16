/**
 * The address check's route parses the request, and leaves the address itself to the rule.
 *
 * A request whose address is missing, not a string, or far past the rule's limit is answered with
 * the rule's own verdict, as the create answers it, rather than with a refusal of the request's
 * shape: the check promises the create's answer for any address it is given.
 */
import { describe, expect, it, vi } from "vitest";

import { judgeAddress } from "../../../shared/address-rule";

vi.mock("../../helpers/di", () => ({
  getAdapterFromDI: () => ({
    selectOne: vi.fn(async () => null),
    select: vi.fn(async () => []),
  }),
  getFieldGroupMetadataServiceFromDI: () => ({
    assertNewAddressAvailable: vi.fn(async () => {}),
  }),
  getSingleRegistryFromDI: () => ({ getAllSingles: vi.fn(async () => []) }),
}));

import { respondAddressCheck } from "../address-check-route";

async function refusalFor(body: unknown) {
  const response = await respondAddressCheck("collection", body);
  return ((await response.json()) as { refusal: unknown }).refusal;
}

describe("the address check's request", () => {
  it.each([
    ["no address at all", {}, undefined],
    ["an address that is not a string", { address: 42 }, 42],
    [
      "an address far past the limit",
      { address: "a".repeat(1001) },
      "a".repeat(1001),
    ],
  ])("with %s, answers the rule's verdict", async (_label, body, address) => {
    const rule = judgeAddress("collection", address);
    expect(rule).not.toBeNull();
    expect(await refusalFor(body)).toEqual({
      code: rule?.code,
      message: rule?.message,
    });
  });
});
