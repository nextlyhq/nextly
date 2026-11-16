/**
 * The roles holding a retired `manage-` permission are read in runs of ids,
 * so an install with more of them than one statement may bind still has each
 * named at startup and converted by `nextly upgrade`, on every dialect.
 */
import { describe, expect, it } from "vitest";

import { rolesHoldingRetiredManage } from "../retired-manage";

type Query = { where: { and: Array<{ column: string; value: unknown }> } };

describe("rolesHoldingRetiredManage", () => {
  it("reads the roles in runs no larger than one statement binds, and finds every one", async () => {
    const roleIds = Array.from({ length: 1200 }, (_, i) => `role-${i}`);
    const boundPerRead: number[] = [];
    const reader = {
      select: (table: string, query: Query): Promise<never[]> => {
        const rows: unknown[] =
          table === "permissions"
            ? [{ id: "manage-media-id", slug: "manage-media" }]
            : table === "role_permissions"
              ? roleIds.map(roleId => ({
                  roleId,
                  permissionId: "manage-media-id",
                }))
              : (() => {
                  const ids = query.where.and[0].value as string[];
                  boundPerRead.push(ids.length);
                  return ids.map(id => ({ id, name: id }));
                })();
        return Promise.resolve(rows as never[]);
      },
    };

    const holding = await rolesHoldingRetiredManage(
      reader as unknown as Parameters<typeof rolesHoldingRetiredManage>[0]
    );

    expect(holding).toHaveLength(roleIds.length);
    expect(Math.max(...boundPerRead)).toBeLessThanOrEqual(500);
  });
});
