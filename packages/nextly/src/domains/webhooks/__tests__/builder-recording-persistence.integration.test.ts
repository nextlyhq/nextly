/**
 * A Builder-authored webhook opt-out has to survive a restart.
 *
 * The code-first `webhooks: false` option is republished from live config on
 * every boot, but a collection created in the Schema Builder has no config to
 * republish from — its decision exists only on the registry's `webhooks`
 * column. Without a boot-time read of that column the switch would hold for the
 * process that set it and every restart would silently resume recording
 * personal data to the outbox, where any subscribed endpoint receives it.
 *
 * The database is file-backed rather than in-memory because `createTestNextly`
 * disconnects the adapter as it boots, which would discard an in-memory schema
 * and make the second boot a fresh database instead of a restart.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

// Seeded at module load, before any import can read the lazily-cached `env`
// proxy: webhook signing secrets are encrypted under NEXTLY_SECRET, so
// `createEndpoint` throws without it. `??=` never clobbers a real environment.
process.env.NEXTLY_SECRET ??= "integration-test-application-secret";
// The Builder's create path only APPLIES its generated migration in
// development; under the default test env the table is never created and every
// entry write would fail, making a zero-event assertion pass vacuously.
// Restored below: integration files in this package share one fork, so leaving
// it set would change dev-only behaviour in every suite that runs after this.
const originalNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = "development";

import { createAdapter } from "../../../database/factory";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";

type Adapter = Awaited<ReturnType<typeof createAdapter>>;

interface EventRow {
  /** The outbox stores the entity slug under `resource_collection`. */
  resourceCollection: string;
  resourceId: string;
}

/** Subset of the endpoint service used to open the recording gate. */
interface EndpointService {
  createEndpoint: (
    input: Record<string, unknown>,
    userId: string
  ) => Promise<unknown>;
}

// Recording is endpoint-gated: with nothing subscribed there is no outbox to
// keep content out of, so the opt-out is only meaningful once an endpoint
// exists. An address literal avoids a DNS lookup in the URL guard.
const ENDPOINT_URL = "https://93.184.216.34/hooks";

/** The Builder's own create/update surface, as the admin calls it. */
interface BuilderHandler {
  createCollection: (data: Record<string, unknown>) => Promise<{
    success: boolean;
  }>;
  updateCollection: (
    params: { collectionName: string },
    body: Record<string, unknown>
  ) => Promise<{ success: boolean }>;
}

let dir: string;
let dbPath: string;
let current: TestNextly | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-wh-persist-"));
  dbPath = join(dir, "test.db");
});

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  rmSync(dir, { recursive: true, force: true });
});

afterAll(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

/**
 * Shut the running instance down and boot a fresh one against the same file, as
 * a restart would. Destroying first matters: two live connections to one SQLite
 * file is a resource leak and a source of lock flakiness.
 */
async function restart(): Promise<TestNextly> {
  await current?.destroy();
  current = undefined;
  return boot();
}

/** Boot against the shared file database, as a fresh process would. */
async function boot(): Promise<TestNextly> {
  process.env.DB_DIALECT = "sqlite";
  const adapter: Adapter = await createAdapter({
    type: "sqlite",
    url: `file:${dbPath}`,
  } as Parameters<typeof createAdapter>[0]);
  return createTestNextly({ adapter });
}

/**
 * Subscribe an endpoint so the outbox gate is open. Without one, every write is
 * skipped for a reason unrelated to the opt-out and the assertions below would
 * pass vacuously.
 */
async function subscribe(handle: TestNextly): Promise<void> {
  // `nextly_webhooks.created_by` references users.id, so the owner has to exist
  // before the endpoint can be inserted.
  await handle.adapter.executeQuery(
    "INSERT OR IGNORE INTO users (id, email, created_at, updated_at) VALUES ('user_1', 'dev@example.com', 0, 0)"
  );
  const service = handle.getService(
    "webhookEndpointService"
  ) as unknown as EndpointService;
  await service.createEndpoint(
    { name: "All events", url: ENDPOINT_URL, eventTypes: ["*"] },
    "user_1"
  );
}

async function events(handle: TestNextly): Promise<EventRow[]> {
  return handle.adapter.select<EventRow>("nextly_events");
}

async function eventsFor(
  handle: TestNextly,
  slug: string
): Promise<EventRow[]> {
  return (await events(handle)).filter(e => e.resourceCollection === slug);
}

describe("builder webhook opt-out persistence (integration)", () => {
  it("keeps a builder-authored opt-out in force across a restart", async () => {
    current = await boot();
    await subscribe(current);
    const builder = current.getService(
      "collectionsHandler"
    ) as unknown as BuilderHandler;
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    // Two collections through the Builder's own create path: one opted out of
    // recording, one left on the default.
    await builder.createCollection({
      name: "enquiries",
      label: "Enquiries",
      fields: [{ name: "message", type: "text" }],
      webhooks: false,
    });
    await builder.createCollection({
      name: "notes",
      label: "Notes",
      fields: [{ name: "body", type: "text" }],
    });

    await handler.createEntry(
      { collectionName: "enquiries", overrideAccess: true },
      { message: "my phone number is private" }
    );
    await handler.createEntry(
      { collectionName: "notes", overrideAccess: true },
      { body: "ordinary content" }
    );

    // The opt-out holds in the process that set it, and is scoped: the
    // collection left on the default still records.
    expect(await eventsFor(current, "enquiries")).toHaveLength(0);
    expect((await eventsFor(current, "notes")).length).toBeGreaterThan(0);

    // Restart. The policy registry starts empty, so anything still in force
    // after this can only have come from the stored column.
    current = await restart();
    const afterRestart =
      current.getService<CollectionsHandler>("collectionsHandler");

    await afterRestart.createEntry(
      { collectionName: "enquiries", overrideAccess: true },
      { message: "still private" }
    );

    expect(await eventsFor(current, "enquiries")).toHaveLength(0);
  });

  it("resumes recording once the switch is turned back on", async () => {
    current = await boot();
    await subscribe(current);
    const builder = current.getService(
      "collectionsHandler"
    ) as unknown as BuilderHandler;

    await builder.createCollection({
      name: "enquiries",
      label: "Enquiries",
      fields: [{ name: "message", type: "text" }],
      webhooks: false,
    });

    const updated = await builder.updateCollection(
      { collectionName: "enquiries" },
      { webhooks: true }
    );
    // Assert the update landed: a silently-failing update would make the
    // recording assertion below prove nothing.
    expect(updated.success).toBe(true);

    // Restart so the decision is re-read from the column rather than left over
    // in the process that performed the update.
    current = await restart();
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    await handler.createEntry(
      { collectionName: "enquiries", overrideAccess: true },
      { message: "no longer suppressed" }
    );

    expect((await eventsFor(current, "enquiries")).length).toBeGreaterThan(0);
  });
});
