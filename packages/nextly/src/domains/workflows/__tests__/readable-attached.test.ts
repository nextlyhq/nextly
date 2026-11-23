/**
 * What a workflow holds that a caller may read: every attached collection and
 * Single, each once, narrowed by the one read-access answer; and, with no
 * workflow attached anywhere, nothing, without asking that answer at all, so
 * the admin's workspace payload costs a site without workflows no read.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { registered, readable } = vi.hoisted(() => ({
  registered: { value: [] as { collections: string[]; singles: string[] }[] },
  readable: vi.fn(),
}));

vi.mock("../registry", () => ({
  registeredWorkflows: () => registered.value,
}));

vi.mock("../../../auth/entity-read-access", () => ({
  readableEntities: readable,
}));

import type { ReadAccessCaller } from "../../../auth/entity-read-access";
import {
  attachedEntitySlugs,
  readableAttachedEntities,
} from "../readable-attached";

const caller = { userId: "u1" } as unknown as ReadAccessCaller;

describe("readableAttachedEntities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registered.value = [];
  });

  it("answers nothing, asking nothing, where no workflow is attached", async () => {
    expect(await readableAttachedEntities(caller)).toEqual(new Set());
    expect(readable).not.toHaveBeenCalled();
  });

  it("asks once about every attached collection and Single, each named once", async () => {
    registered.value = [
      { collections: ["posts", "notes"], singles: ["home"] },
      { collections: ["notes"], singles: [] },
    ];
    readable.mockResolvedValue(new Set(["posts", "home"]));

    expect(await readableAttachedEntities(caller)).toEqual(
      new Set(["posts", "home"])
    );
    expect(readable).toHaveBeenCalledTimes(1);
    expect(readable).toHaveBeenCalledWith(["posts", "notes", "home"], caller);
    expect(attachedEntitySlugs()).toEqual(["posts", "notes", "home"]);
  });
});
