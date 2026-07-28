import { describe, expect, it } from "vitest";
process.env.NEXTLY_SECRET ??= "s";
process.env.NODE_ENV = "development";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAdapter } from "../../../database/factory";
import { createTestNextly } from "../../../plugins/test-nextly";
import { isWebhookRecordingEnabled } from "../recording-policy";

describe("dbg2", () => {
  it("dumps", async () => {
    process.env.DB_DIALECT = "sqlite";
    const dbPath = join(mkdtempSync(join(tmpdir(), "dbg2-")), "t.db");
    const adapter = await createAdapter({
      type: "sqlite",
      url: `file:${dbPath}`,
    } as never);
    const t = await createTestNextly({ adapter });
    const b = t.getService("collectionsHandler") as never as {
      createCollection: (d: Record<string, unknown>) => Promise<unknown>;
    };
    const res = await b.createCollection({
      name: "enquiries",
      label: "E",
      fields: [{ name: "message", type: "text" }],
      webhooks: false,
    });
    const rows = await t.adapter.select<Record<string, unknown>>(
      "dynamic_collections"
    );
    const out = [
      "CREATE " + JSON.stringify(res).slice(0, 200),
      "ROWS " +
        JSON.stringify(
          rows.map(r => ({
            slug: r.slug,
            source: r.source,
            webhooks: r.webhooks,
          })),
          null,
          2
        ),
      "POLICY enquiries recording=" +
        isWebhookRecordingEnabled("collection", "enquiries"),
    ];
    writeFileSync("/tmp/dbg2.txt", out.join("\n"));
    await t.destroy();
    expect(true).toBe(true);
  });
});
