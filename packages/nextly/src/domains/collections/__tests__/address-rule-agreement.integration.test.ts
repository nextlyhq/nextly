/**
 * The Schema Builder's address check and the Builder's create agree, for every kind, on a real
 * database of each dialect.
 *
 * Each address is given to the check, through its route's dispatcher method, and then to the
 * Builder's create of that kind, through its own; the two answers must be the same: both accept,
 * or both refuse with the same code and message. The check is asked first, so the create sees
 * exactly the database the check answered about. A check that kept a rule of its own, or missed
 * one of the create's lookups, fails here for the address it judges differently.
 *
 * Each case has a fresh database, so an address one case creates is never in the way of another.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearServices } from "../../../di/register";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import type { AddressKind } from "../../../shared/address-rule";
import { ADDRESS_CASES } from "../../../shared/__tests__/helpers/address-cases";

const BODY = [{ name: "body", type: "text" }];

const KINDS: readonly AddressKind[] = ["collection", "single", "fieldGroup"];

/** A verdict as either side reports it: `null` for accepted, or the refusal's code and message. */
type Verdict = { code: string; message: string } | null;

/**
 * The addresses every kind is given: the rule's cases shared with the other roads, and the ones
 * the dialog meets as a person types.
 */
const CASES: readonly string[] = [
  ...ADDRESS_CASES,
  "",
  "1posts",
  "Posts",
  "my posts",
  "news/items",
  "users",
  "blog-posts",
];

/** A Builder create, as a development server runs it, where only it applies its DDL first. */
async function inDevelopment<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.NODE_ENV;
  vi.stubEnv("NODE_ENV", "development");
  try {
    return await run();
  } finally {
    vi.stubEnv("NODE_ENV", previous);
  }
}

/** The Builder's create of `kind` under `address`, through its own dispatcher method. */
function create(kind: AddressKind, address: string): Promise<unknown> {
  return inDevelopment(() => {
    if (kind === "collection") {
      return dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: address, label: "Thing", fields: BODY }
      );
    }
    if (kind === "single") {
      return dispatchSingles(
        "createSingle",
        {},
        { slug: address, label: "Thing", fields: BODY }
      );
    }
    return dispatchComponents(
      "createComponent",
      {},
      { slug: address, label: "Thing", fields: BODY }
    );
  });
}

/** The create's verdict: what its refusal reports, read as a client reads the error. */
async function createVerdict(
  kind: AddressKind,
  address: string
): Promise<Verdict> {
  try {
    await create(kind, address);
    return null;
  } catch (error) {
    const e = error as {
      code?: string;
      publicMessage?: string;
      publicData?: { errors?: { code: string; message: string }[] };
    };
    const first = e.publicData?.errors?.[0];
    if (first) return { code: first.code, message: first.message };
    return { code: String(e.code), message: String(e.publicMessage) };
  }
}

/** The check's verdict, through the route the dialog calls for `kind`. */
async function checkVerdict(
  kind: AddressKind,
  address: string
): Promise<Verdict> {
  const body = { address, pendingCreates: [] };
  const response = (await (kind === "collection"
    ? dispatchCollections(
        {} as ServiceContainer,
        "checkCollectionAddress",
        {},
        body
      )
    : kind === "single"
      ? dispatchSingles("checkSingleAddress", {}, body)
      : dispatchComponents("checkComponentAddress", {}, body))) as Response;
  const answer = (await response.json()) as { refusal: Verdict };
  return answer.refusal;
}

/** The check's verdict and the create's, asked in that order. */
async function bothVerdicts(
  kind: AddressKind,
  address: string
): Promise<{ check: Verdict; create: Verdict }> {
  const check = await checkVerdict(kind, address);
  return { check, create: await createVerdict(kind, address) };
}

for (const dialect of getConfiguredTestDialects()) {
  describe(`the address check and the Builder's create — ${dialect}`, () => {
    let t: TestNextly | undefined;
    let projectRoot: string;

    beforeEach(async () => {
      projectRoot = await mkdtemp(join(tmpdir(), "nextly-address-check-"));
      vi.spyOn(process, "cwd").mockReturnValue(projectRoot);
      clearServices();
      t = await createTestNextly({ dialect, basePath: projectRoot });
    }, 120_000);

    afterEach(async () => {
      await t?.destroy();
      t = undefined;
      clearServices();
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      await rm(projectRoot, { recursive: true, force: true });
    });

    it("the dialog's check and the server's rule agree for each kind", async () => {
      for (const kind of KINDS) {
        for (const address of CASES) {
          const { check, create: created } = await bothVerdicts(kind, address);
          expect(check, `${kind} '${address}'`).toEqual(created);
        }
      }
    }, 300_000);

    /** A field group `seo` recorded under a table name of its own, as older ones may be. */
    async function fieldGroupInACustomTable(): Promise<void> {
      const groups = t!.getService("fieldGroupRegistryService") as unknown as {
        registerComponent(data: object): Promise<unknown>;
      };
      await groups.registerComponent({
        slug: "seo",
        label: "SEO",
        tableName: "my_seo_block",
        fields: [{ name: "title", type: "text" }],
        source: "ui",
        locked: false,
        schemaHash: "seo",
      });
    }

    it("a field group's address held under a custom table name is used, by the check", async () => {
      await fieldGroupInACustomTable();
      expect(await checkVerdict("fieldGroup", "seo")).toEqual({
        code: "DUPLICATE",
        message: "Resource already exists.",
      });
    });

    it("a field group's address held under a custom table name refuses the create, which builds no table", async () => {
      await fieldGroupInACustomTable();
      expect(await createVerdict("fieldGroup", "seo")).toEqual({
        code: "DUPLICATE",
        message: "Resource already exists.",
      });
      expect(await t!.adapter.tableExists("comp_seo")).toBe(false);
    });

    it.each([
      // An address held exactly, where the two kinds must differ.
      ["single", "about", "collection", "about", "refused"],
      ["collection", "about", "single", "about", "refused"],
      // Only field groups hold this address; a collection may take it.
      ["fieldGroup", "seo", "collection", "seo", "accepted"],
      // One snake_case form, either way round, within and across collections and Singles.
      ["collection", "blog_posts", "collection", "blog-posts", "refused"],
      ["collection", "blog-posts", "collection", "blog_posts", "refused"],
      ["collection", "blog_posts", "single", "blog-posts", "refused"],
      ["collection", "blog-posts", "single", "blog_posts", "refused"],
      ["single", "blog_posts", "collection", "blog-posts", "refused"],
      ["single", "blog-posts", "collection", "blog_posts", "refused"],
      // A field group is compared with field groups only.
      ["collection", "blog_posts", "fieldGroup", "blog-posts", "accepted"],
      ["fieldGroup", "blog_posts", "fieldGroup", "blog-posts", "refused"],
      // A Single's tables: `foo-locales` holds the companion `foo` would need.
      ["single", "foo-locales", "single", "foo", "refused"],
    ] as const)(
      "beside a %s '%s', a %s '%s' is %s by both",
      async (heldKind, held, kind, address, outcome) => {
        await create(heldKind, held);
        const { check, create: created } = await bothVerdicts(kind, address);
        expect(check).toEqual(created);
        if (outcome === "accepted") expect(check).toBeNull();
        else expect(check).not.toBeNull();
      },
      120_000
    );
  });
}
