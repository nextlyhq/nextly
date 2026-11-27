/**
 * The role grid shows the three AI permissions as system rows, each under a
 * column of its own verb: Use, Run and Manage. The columns come from the
 * stored actions, so the two verbs only the AI permissions use appear
 * without the grid being told about them.
 */
import { describe, expect, it } from "vitest";

import { organizePermissions } from "../../lib/permissions/calculations";
import type { Permission } from "../../types/ui/form";
import {
  SYSTEM_RESOURCE_SET,
  actionLabel,
  actionsForContentTypes,
} from "../permissions";

/** A stored AI permission, categorized as the role form does. */
function aiRow(resource: string, action: string): Permission {
  return {
    id: `${action}-${resource}`,
    name: `${action} ${resource}`,
    resource,
    action,
    slug: `${resource}.${action}`,
    category: SYSTEM_RESOURCE_SET.has(resource) ? "settings" : "collection-types",
  };
}

const AI_ROWS = [
  aiRow("ai", "use"),
  aiRow("bulk-ai-jobs", "run"),
  aiRow("ai-settings", "manage"),
];

describe("the AI permissions in the role grid", () => {
  it("are system rows, not content types", () => {
    const grouped = organizePermissions([
      ...AI_ROWS,
      aiRow("background-jobs", "manage"),
    ]);
    expect(grouped.settings.map(row => row.id).sort()).toEqual(
      ["ai", "ai-settings", "background-jobs", "bulk-ai-jobs"].sort()
    );
    expect(grouped["collection-types"]).toEqual([]);
  });

  it("get Use and Run columns from their stored actions", () => {
    const rows = organizePermissions([
      ...AI_ROWS,
      aiRow("background-jobs", "manage"),
    ]).settings;
    const columns = actionsForContentTypes(rows);
    expect(columns).toEqual(["manage", "run", "use"]);
    expect(columns.map(actionLabel)).toEqual(["Manage", "Run", "Use"]);
  });

  it("put each AI permission in its own verb's cell", () => {
    const rows = organizePermissions(AI_ROWS).settings;
    const cell = (id: string, action: string) =>
      rows.find(row => row.id === id)?.permissions[action]?.id;
    expect(cell("ai", "use")).toBe("use-ai");
    expect(cell("bulk-ai-jobs", "run")).toBe("run-bulk-ai-jobs");
    expect(cell("ai-settings", "manage")).toBe("manage-ai-settings");
  });
});
