/**
 * A field group's fields are read-only inside its hosts on every road a request saves a host's
 * fields by: the Schema Builder's creates, updates, previews and applies of a collection, a Single
 * and a field group, and the schema REST routes. On each, a save whose field-group field carries
 * a copy of the field group's fields with one added is refused with `FIELD_GROUP_READ_ONLY`, and
 * the host's registry row is as it was (none, for a create). The same save carrying the copy
 * unchanged, as a read hands it out, goes through, so the refusal is the change's and not the
 * copy's.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PATCH as patchCollectionRoute } from "../../../api/collections-schema-detail";
import { POST as postCollectionRoute } from "../../../api/collections-schema";
import { PATCH as patchFieldGroupRoute } from "../../../api/field-groups-detail";
import { POST as postFieldGroupRoute } from "../../../api/field-groups";
import { PATCH as patchSingleRoute } from "../../../api/singles-schema-detail";
import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { resetSessionStandingForTests } from "../../../auth/session/session-standing";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import { MIGRATION_TARGET } from "../migration/target";
import { clearRegistryRowCache } from "../../dynamic-collections/services/collection-row-cache";

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };

type Field = Record<string, unknown>;
type Kind = "collection" | "single" | "fieldGroup";

const CARD = "ferw_card";
const NOTE: Field = { name: "note", type: "text" };
const SUMMARY: Field = { name: "summary", type: "text" };
const HEADLINE: Field = { name: "headline", type: "text" };
const cardRef: Field = { name: "card", type: "component", component: CARD };

/** The host of each kind, its slug and the registry table its row is in. */
const HOST: Record<Kind, { slug: string; registry: string }> = {
  collection: { slug: "ferw_posts", registry: "dynamic_collections" },
  single: { slug: "ferw_home", registry: "dynamic_singles" },
  fieldGroup: { slug: "ferw_frame", registry: MIGRATION_TARGET.registryTable },
};

/** A host's fields with the field group's fields copied in: unchanged, or with one added. */
const withCopy = (copy: Field[]): Field[] => [
  HEADLINE,
  { ...cardRef, fields: copy },
];
const ECHO = withCopy([NOTE, SUMMARY]);
const CHANGED = withCopy([NOTE, SUMMARY, { name: "extra", type: "text" }]);

let instance: TestNextly | undefined;
let basePath: string;

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), "nextly-fg-every-road-"));
  // A Builder save applies its change, and records the entity, in development only.
  vi.stubEnv("NODE_ENV", "development");
});

afterEach(async () => {
  try {
    await instance?.destroy();
  } finally {
    instance = undefined;
    resetSessionStandingForTests();
    vi.unstubAllEnvs();
    await rm(basePath, { recursive: true, force: true });
  }
});

/** A super-admin's session headers, made once per boot: the first user created is the super-admin. */
const sessions = new WeakMap<TestNextly, Promise<Record<string, string>>>();
function superAdminSession(t: TestNextly): Promise<Record<string, string>> {
  let session = sessions.get(t);
  if (session === undefined) {
    session = newSuperAdminSession(t);
    sessions.set(t, session);
  }
  return session;
}

async function newSuperAdminSession(
  t: TestNextly
): Promise<Record<string, string>> {
  const seeder = t.getService("permissionSeedService") as unknown as {
    seedSystemPermissions: () => Promise<unknown>;
  };
  await seeder.seedSystemPermissions();
  const direct = t.nextly as unknown as {
    users: {
      create(a: {
        email: string;
        password: string;
        data: Record<string, unknown>;
      }): Promise<{ item: { id: string } }>;
    };
  };
  const userId = (
    await direct.users.create({
      email: "owner@example.com",
      password: "Password123!",
      data: { name: "Owner", isActive: true },
    })
  ).item.id;
  const token = await signAccessToken(
    buildClaims({
      userId,
      email: "owner@example.com",
      name: "Owner",
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET!
  );
  return {
    cookie: `nextly_session=${token}`,
    "content-type": "application/json",
  };
}

async function rest(
  t: TestNextly,
  method: "POST" | "PATCH",
  path: string,
  body: unknown
): Promise<Request> {
  return new Request(`http://localhost${path}`, {
    method,
    headers: await superAdminSession(t),
    body: JSON.stringify(body),
  });
}

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

/** A host's registry row as stored, or null where there is none. */
async function hostRow(
  t: TestNextly,
  kind: Kind
): Promise<Record<string, unknown> | null> {
  const { registry, slug } = HOST[kind];
  const rows = await (t.adapter as unknown as DrizzleAdapter).executeQuery<
    Record<string, unknown>
  >(`SELECT * FROM ${registry} WHERE slug = '${slug}'`);
  return rows[0] ?? null;
}

async function schemaVersionOf(t: TestNextly, kind: Kind): Promise<number> {
  return Number((await hostRow(t, kind))?.schema_version ?? 1);
}

/** The Builder's create of each kind of host. */
const builderCreate: Record<Kind, (fields: Field[]) => Promise<unknown>> = {
  collection: fields =>
    dispatchCollections(
      {} as ServiceContainer,
      "createCollection",
      {},
      { name: HOST.collection.slug, label: "Posts", fields }
    ),
  single: fields =>
    dispatchSingles(
      "createSingle",
      {},
      { slug: HOST.single.slug, label: "Home", fields }
    ),
  fieldGroup: fields =>
    dispatchComponents(
      "createComponent",
      {},
      { slug: HOST.fieldGroup.slug, label: "Frame", fields }
    ),
};

interface Road {
  road: string;
  kind: Kind;
  /** A create road starts from no host; an update road from one the Builder created. */
  creates: boolean;
  send(t: TestNextly, fields: Field[]): Promise<unknown>;
}

const {
  collection: POSTS,
  single: HOME,
  fieldGroup: FRAME,
} = {
  collection: HOST.collection.slug,
  single: HOST.single.slug,
  fieldGroup: HOST.fieldGroup.slug,
};

const ROADS: Road[] = [
  {
    road: "the Builder's collection create",
    kind: "collection",
    creates: true,
    send: (_t, fields) => builderCreate.collection(fields),
  },
  {
    road: "the Builder's collection update",
    kind: "collection",
    creates: false,
    send: (_t, fields) =>
      dispatchCollections(
        {} as ServiceContainer,
        "updateCollection",
        { collectionName: POSTS },
        { fields }
      ),
  },
  {
    road: "the Builder's collection preview",
    kind: "collection",
    creates: false,
    send: (_t, fields) =>
      dispatchCollections(
        {} as ServiceContainer,
        "previewSchemaChanges",
        { collectionName: POSTS },
        { fields }
      ),
  },
  {
    road: "the Builder's collection apply",
    kind: "collection",
    creates: false,
    send: async (t, fields) =>
      dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: POSTS },
        {
          fields,
          confirmed: true,
          schemaVersion: await schemaVersionOf(t, "collection"),
        }
      ),
  },
  {
    road: "the collection schema route's POST",
    kind: "collection",
    creates: true,
    send: async (t, fields) =>
      postCollectionRoute(
        await rest(t, "POST", "/api/collections/schema", {
          slug: POSTS,
          labels: { singular: "Post", plural: "Posts" },
          fields,
        })
      ),
  },
  {
    road: "the collection schema route's PATCH",
    kind: "collection",
    creates: false,
    send: async (t, fields) =>
      patchCollectionRoute(
        await rest(t, "PATCH", `/api/collections/schema/${POSTS}`, { fields }),
        params(POSTS)
      ),
  },
  {
    road: "the Builder's Single create",
    kind: "single",
    creates: true,
    send: (_t, fields) => builderCreate.single(fields),
  },
  {
    road: "the Builder's Single update",
    kind: "single",
    creates: false,
    send: (_t, fields) =>
      dispatchSingles("updateSingleSchema", { slug: HOME }, { fields }),
  },
  {
    road: "the Builder's Single preview",
    kind: "single",
    creates: false,
    send: (_t, fields) =>
      dispatchSingles("previewSingleSchemaChanges", { slug: HOME }, { fields }),
  },
  {
    road: "the Builder's Single apply",
    kind: "single",
    creates: false,
    send: async (t, fields) =>
      dispatchSingles(
        "applySingleSchemaChanges",
        { slug: HOME },
        {
          fields,
          confirmed: true,
          schemaVersion: await schemaVersionOf(t, "single"),
        }
      ),
  },
  {
    road: "the Single schema route's PATCH",
    kind: "single",
    creates: false,
    send: async (t, fields) =>
      patchSingleRoute(
        await rest(t, "PATCH", `/api/singles/schema/${HOME}`, { fields }),
        params(HOME)
      ),
  },
  {
    road: "the Builder's field group create",
    kind: "fieldGroup",
    creates: true,
    send: (_t, fields) => builderCreate.fieldGroup(fields),
  },
  {
    road: "the Builder's field group update",
    kind: "fieldGroup",
    creates: false,
    send: (_t, fields) =>
      dispatchComponents("updateComponent", { slug: FRAME }, { fields }),
  },
  {
    road: "the Builder's field group preview",
    kind: "fieldGroup",
    creates: false,
    send: (_t, fields) =>
      dispatchComponents(
        "previewComponentSchemaChanges",
        { slug: FRAME },
        { fields }
      ),
  },
  {
    road: "the Builder's field group apply",
    kind: "fieldGroup",
    creates: false,
    send: async (t, fields) =>
      dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: FRAME },
        {
          fields,
          confirmed: true,
          schemaVersion: await schemaVersionOf(t, "fieldGroup"),
        }
      ),
  },
  {
    road: "the field group route's POST",
    kind: "fieldGroup",
    creates: true,
    send: async (t, fields) =>
      postFieldGroupRoute(
        await rest(t, "POST", "/api/field-groups", {
          slug: FRAME,
          label: "Frame",
          fields,
        })
      ),
  },
  {
    road: "the field group route's PATCH",
    kind: "fieldGroup",
    creates: false,
    send: async (t, fields) =>
      patchFieldGroupRoute(
        await rest(t, "PATCH", `/api/field-groups/${FRAME}`, { fields }),
        params(FRAME)
      ),
  },
];

type Outcome = { accepted: true } | { refused: unknown };

/**
 * What a road answered: accepted, or the refusal's per-field errors (its message when it has
 * none). A road answers through a thrown error or, over REST, through a response.
 */
async function outcomeOf(run: () => Promise<unknown>): Promise<Outcome> {
  let result: unknown;
  try {
    result = await run();
  } catch (error) {
    const e = error as { publicData?: { errors?: unknown }; message?: string };
    return { refused: e.publicData?.errors ?? e.message };
  } finally {
    clearRegistryRowCache();
  }
  if (result instanceof Response && result.status >= 400) {
    const body = (await result.json()) as {
      error?: { message?: string; data?: { errors?: unknown } };
    };
    return { refused: body.error?.data?.errors ?? body.error?.message };
  }
  return { accepted: true };
}

const READ_ONLY: Outcome = {
  refused: [
    {
      path: "card",
      code: "FIELD_GROUP_READ_ONLY",
      message: `card holds the field group ${CARD}, whose fields are changed only in its own editor: a change there reaches every collection, Single and field group using it. Change ${CARD} in its own editor.`,
    },
  ],
};

describe.each(getConfiguredTestDialects())(
  "a field group's fields read-only on every road (%s)",
  (dialect: TestDialect) => {
    async function boot(): Promise<TestNextly> {
      instance = await createTestNextly({ dialect, basePath, db: DB });
      expect(
        await outcomeOf(() =>
          dispatchComponents(
            "createComponent",
            {},
            { slug: CARD, label: "Card", fields: [NOTE, SUMMARY] }
          )
        )
      ).toEqual({ accepted: true });
      return instance;
    }

    it.each(ROADS)(
      "$road refuses a save that changes the field group's fields, nothing written",
      async road => {
        const t = await boot();
        if (!road.creates) {
          expect(
            await outcomeOf(() => builderCreate[road.kind]([HEADLINE, cardRef]))
          ).toEqual({ accepted: true });
        }
        const before = await hostRow(t, road.kind);

        expect(await outcomeOf(() => road.send(t, CHANGED))).toEqual(READ_ONLY);

        expect(await hostRow(t, road.kind)).toEqual(before);
        // The same save with the copy as a read hands it out changes no field group: accepted.
        expect(await outcomeOf(() => road.send(t, ECHO))).toEqual({
          accepted: true,
        });
      }
    );

    /** The field group's own edit, in its own editor. */
    async function editCard(t: TestNextly, fields: Field[]): Promise<void> {
      const card = await t
        .getService("fieldGroupRegistryService")
        .getComponent(CARD);
      expect(
        await outcomeOf(() =>
          dispatchComponents(
            "applyComponentSchemaChanges",
            { slug: CARD },
            {
              fields,
              confirmed: true,
              schemaVersion: card.schemaVersion ?? 1,
            }
          )
        )
      ).toEqual({ accepted: true });
    }

    /** Fields as the Schema Builder writes each one, what it leaves out written as off. */
    const builderSpelled = (fields: Field[]): Field[] =>
      fields.map(field => ({
        ...field,
        label: field.name,
        required: false,
        unique: false,
        index: false,
      }));

    // A host whose definition already holds a copy of the field group's fields, which the field
    // group's own editor then changes: a save that sends the host back as it holds it, changing
    // something else, changes no field group and goes through, however either copy is spelled.
    const HELD_COPIES: { what: string; held: Field[]; sent: Field[] }[] = [
      {
        what: "as it is stored",
        held: [NOTE, SUMMARY],
        sent: [NOTE, SUMMARY],
      },
      {
        what: "as the Schema Builder writes each field",
        held: [NOTE, SUMMARY],
        sent: builderSpelled([NOTE, SUMMARY]),
      },
      {
        what: "without the Schema Builder's defaults its copy holds",
        held: builderSpelled([NOTE, SUMMARY]),
        sent: [NOTE, SUMMARY],
      },
    ];
    const UPDATES = ROADS.filter(road => !road.creates);

    it.each(
      UPDATES.flatMap(road => HELD_COPIES.map(copy => ({ ...road, ...copy })))
    )(
      "$road takes a host that held a copy before the field group changed, sent back $what",
      async road => {
        const t = await boot();
        expect(
          await outcomeOf(() =>
            builderCreate[road.kind]([
              HEADLINE,
              { ...cardRef, fields: road.held },
            ])
          )
        ).toEqual({ accepted: true });
        await editCard(t, [NOTE, SUMMARY, { name: "extra", type: "text" }]);

        // A copy that is neither what the host holds nor what the field group does is an edit: a
        // setting changed, a field added, one removed, and the two in another order.
        const before = await hostRow(t, road.kind);
        for (const edited of [
          [NOTE, { ...SUMMARY, required: true }],
          [NOTE, SUMMARY, { name: "other", type: "text" }],
          [NOTE],
          [SUMMARY, NOTE],
        ]) {
          expect(
            await outcomeOf(() =>
              road.send(t, [HEADLINE, { ...cardRef, fields: edited }])
            )
          ).toEqual(READ_ONLY);
        }
        expect(await hostRow(t, road.kind)).toEqual(before);

        expect(
          await outcomeOf(() =>
            road.send(t, [
              { ...HEADLINE, label: "Headline" },
              { ...cardRef, fields: road.sent },
            ])
          )
        ).toEqual({ accepted: true });
      }
    );

    // A road that saves through a service compares a save's copies inside that service's schema
    // exclusion, and writes them in it: no other schema change lands between the two. Proved by a
    // field group's own edit begun while the comparison reads it.
    const SERVICE_ROADS = ROADS.filter(road =>
      [
        "the Builder's collection create",
        "the Builder's collection update",
        "the Builder's Single create",
        "the Builder's Single update",
        "the Builder's field group create",
        "the Builder's field group update",
        "the field group route's POST",
        "the field group route's PATCH",
      ].includes(road.road)
    );
    const EXTRA: Field = { name: "extra", type: "text" };

    it.each(SERVICE_ROADS)(
      "$road holds off the field group's own edit while it compares and writes",
      async road => {
        const t = await boot();
        if (!road.creates) {
          expect(
            await outcomeOf(() => builderCreate[road.kind]([HEADLINE, cardRef]))
          ).toEqual({ accepted: true });
        }
        const groups = t.getService("fieldGroupRegistryService");
        const read = groups.getAllFieldLists.bind(groups);
        const cardVersion = (await groups.getComponent(CARD)).schemaVersion;

        // The comparison reads the field group first, then its own editor's save lands before the
        // host's write: the edit a comparison outside the exclusion would let through. Begun in a
        // context of its own, so its schema change is another one's, not a nested one the save's
        // exclusion would let in.
        let begin: () => void = () => undefined;
        const asked = new Promise<void>(resolve => {
          begin = resolve;
        });
        const edit = (async (): Promise<Outcome> => {
          await asked;
          // The field group's own editor's save: it changes the field group's table, so it takes the
          // schema exclusion.
          return outcomeOf(() =>
            dispatchComponents(
              "applyComponentSchemaChanges",
              { slug: CARD },
              {
                fields: [NOTE, SUMMARY, EXTRA],
                confirmed: true,
                schemaVersion: cardVersion ?? 1,
              }
            )
          );
        })();
        let concurrent: Outcome | undefined;
        let raced = false;
        vi.spyOn(groups, "getAllFieldLists").mockImplementation(async () => {
          const found = await read();
          // The edit itself reads the lists too: only the comparison's own read starts it.
          if (!raced) {
            raced = true;
            begin();
            concurrent = await Promise.race([
              edit,
              new Promise<Outcome>(resolve =>
                setTimeout(() => resolve({ refused: "timed out" }), 8000)
              ),
            ]);
          }
          return found;
        });

        expect(await outcomeOf(() => road.send(t, ECHO))).toEqual({
          accepted: true,
        });

        // Refused, not merely late: the save held the exclusion.
        expect(concurrent).toEqual({ refused: expect.anything() });
        expect(concurrent).not.toEqual({ refused: "timed out" });
        vi.restoreAllMocks();
        const card = await groups.getComponent(CARD);
        expect(
          (card.fields as unknown as Field[]).map(field => field.name)
        ).toEqual(["note", "summary"]);
      }
    );
  }
);
