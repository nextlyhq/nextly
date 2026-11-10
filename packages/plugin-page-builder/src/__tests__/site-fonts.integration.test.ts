/**
 * Adding a catalogue font over HTTP: the server downloads the files into the
 * site's media and registers faces at the site's own addresses.
 *
 * The catalogue is a local server standing in for Fontsource and jsDelivr,
 * named through the plugin's `fonts.catalogue` option. Nothing here reaches
 * the network; the plugin's real `ctx.fetch` reaches `localhost`, which it
 * allows only under test and development.
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { existsSync, rmSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { resolve as resolvePath } from "node:path";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import {
  definePlugin,
  NextlyError,
  type PluginDefinition,
} from "@nextlyhq/plugin-sdk";
import { eq } from "@nextlyhq/plugin-sdk/db";
import type { PluginDatabase } from "@nextlyhq/plugin-sdk/schema";
import { ServiceContainer } from "nextly";
import { createMediaHandlers } from "nextly/api/media-handlers";
import { buildClaims, signAccessToken } from "nextly/auth";
import { createDynamicHandlers } from "nextly/runtime";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { pageBuilder } from "../plugin";
import { siteOptions } from "../schema/tables";
import { FONTS_FOLDER_OPTION } from "../site-fonts/folder";
import { resolveFontOptions } from "../site-fonts/options";
import { siteFontRoutes, type SiteFontsDirectApi } from "../site-fonts/routes";
import { SITE_STYLE_SLUG } from "../site-style-storage";

const ORIGIN = "http://localhost";
const CSRF = "c".repeat(64);

/**
 * A woff2 file as far as any check here reads one: the signature, then the
 * TrueType flavour the media pipeline's sniffer looks for after it.
 */
function woff2(size = 64): Buffer {
  const bytes = Buffer.alloc(size, 0);
  bytes.write("wOF2", 0, "latin1");
  bytes.writeUInt32BE(0x00010000, 4);
  return bytes;
}

const LORA = {
  id: "lora",
  family: "Lora",
  subsets: ["latin", "latin-ext"],
  weights: [400, 500, 700],
  styles: ["normal", "italic"],
  defSubset: "latin",
  variable: false,
  category: "serif",
  license: "OFL-1.1",
  type: "google",
  npmVersion: "5.2.1",
  unicodeRange: { latin: "U+0000-00FF", "latin-ext": "U+0100-02BA" },
};

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

/** A stand-in catalogue: every path it is asked for, and what each answers. */
class FakeCatalogue {
  readonly asked: string[] = [];
  private routes = new Map<string, Handler>();
  private server = createServer((req, res) => {
    const path = req.url ?? "";
    this.asked.push(path);
    const route = this.routes.get(path);
    if (route === undefined) {
      res.writeHead(404).end();
      return;
    }
    route(req, res);
  });

  async start(): Promise<void> {
    // Both address families, since `localhost` may resolve to either.
    await new Promise<void>(resolve => this.server.listen(0, "::", resolve));
  }

  get origin(): string {
    return `http://localhost:${String((this.server.address() as AddressInfo).port)}`;
  }

  reset(): void {
    this.asked.length = 0;
    this.routes.clear();
    this.json("/v1/fonts?type=google", [LORA]);
    // How popular each family is, keyed by id as Fontsource's stats are.
    this.json("/v1/stats", {
      lora: { total: { npmDownloadMonthly: 52_000 } },
    });
    this.json("/v1/fonts/lora", LORA);
    for (const weight of [400, 500, 700]) {
      for (const style of ["normal", "italic"]) {
        this.font(
          `/fontsource/fonts/lora@5.2.1/latin-${String(weight)}-${style}.woff2`
        );
      }
    }
  }

  on(path: string, handler: Handler): void {
    this.routes.set(path, handler);
  }

  json(path: string, body: unknown): void {
    this.on(path, (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    });
  }

  font(path: string, bytes: Buffer = woff2(), type = "font/woff2"): void {
    this.on(path, (_req, res) => {
      res.writeHead(200, {
        "content-type": type,
        "content-length": bytes.length,
      });
      res.end(bytes);
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>(resolve => this.server.close(() => resolve()));
  }
}

const FILE_400 = "/fontsource/fonts/lora@5.2.1/latin-400-normal.woff2";
const FILE_500 = "/fontsource/fonts/lora@5.2.1/latin-500-normal.woff2";
const FILE_700 = "/fontsource/fonts/lora@5.2.1/latin-700-normal.woff2";

const LORA_400_700 = {
  id: "lora",
  weights: [400, 700],
  styles: ["normal"],
  subsets: ["latin"],
};

/**
 * A plugin depending on the page builder, so its `ctx.db` reaches the page
 * builder's tables: what a route handler called directly is handed, as the
 * dispatcher hands the page builder's own.
 */
interface Probe {
  db?: PluginDatabase;
  services?: { media: { deleteFolder(folderId: string): Promise<unknown> } };
}

function probePlugin(holder: Probe): PluginDefinition {
  return definePlugin({
    name: "@test/site-fonts-probe",
    version: "1.0.0",
    nextly: ">=0.0.0",
    dependsOn: { [PAGE_BUILDER_PLUGIN_NAME]: "*" },
    init(ctx) {
      holder.db = ctx.db;
      holder.services = ctx.services;
    },
  });
}

describe.each(getConfiguredTestDialects())(
  "adding a catalogue font (%s)",
  (dialect: TestDialect) => {
    const catalogue = new FakeCatalogue();
    const elsewhere = new FakeCatalogue();
    let current: TestNextly | undefined;
    const probe: Probe = {};

    /*
     * The harness stores media with the local adapter, which writes
     * `./public/uploads` and a `.gitignore` beside it. Removed afterwards, but
     * only when this suite is what created them.
     */
    const uploads = resolvePath("public");
    const ignore = resolvePath(".gitignore");
    let created = { uploads: false, ignore: false };

    beforeAll(async () => {
      created = { uploads: !existsSync(uploads), ignore: !existsSync(ignore) };
      await catalogue.start();
      await elsewhere.start();
    });

    afterAll(async () => {
      await catalogue.stop();
      await elsewhere.stop();
      if (created.uploads) rmSync(uploads, { recursive: true, force: true });
      if (created.ignore) rmSync(ignore, { force: true });
    });

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(
      limits: Record<string, number> = {}
    ): Promise<TestNextly> {
      catalogue.reset();
      elsewhere.reset();
      current = await createTestNextly({
        dialect,
        plugins: [
          pageBuilder({
            fonts: {
              catalogue: { api: catalogue.origin, files: catalogue.origin },
              limits: { timeoutMs: 1500, ...limits },
            },
          }),
          probePlugin(probe),
        ],
        seedPublic: true,
      });
      // The site's first user is its owner, granted everything. Made first,
      // so every person below holds only what the test gives them.
      await current.nextly.users.create({
        email: "owner@example.com",
        password: "Password123!",
        data: { name: "Owner", isActive: true },
      });
      return current;
    }

    let people = 0;
    let roles = 0;

    /** A signed-in person holding exactly the permissions named. */
    async function holding(t: TestNextly, ...slugs: string[]): Promise<string> {
      people += 1;
      const created = await t.nextly.users.create({
        email: `person-${String(people)}@example.com`,
        password: "Password123!",
        data: { name: `Person ${String(people)}`, isActive: true },
      });
      const userId = created.item.id;
      if (slugs.length > 0) {
        const permissions = await t.nextly.permissions.find({ limit: 500 });
        const ids = slugs.map(slug => {
          const found = permissions.items.find(item => item.slug === slug);
          if (found === undefined) throw new Error(`${slug} is not seeded`);
          return found.id;
        });
        roles += 1;
        const role = await t.nextly.roles.create({
          data: {
            name: `Role ${String(roles)}`,
            slug: `r-${String(roles)}`,
            permissionIds: ids,
          },
        });
        const assigned = await new ServiceContainer(
          t.adapter
        ).userRoles.assignRoleToUser(userId, role.item.id);
        expect(assigned.success).toBe(true);
      }
      const token = await signAccessToken(
        buildClaims({
          userId,
          email: created.item.email,
          name: `Person ${String(people)}`,
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? ""
      );
      return `nextly_session=${token}`;
    }

    /** One request through the real dispatcher, as a browser would make it. */
    async function call(
      method: "GET" | "POST" | "PATCH",
      path: string[],
      cookie: string,
      body?: unknown
    ): Promise<{ status: number; body: Record<string, unknown> }> {
      const handlers = createDynamicHandlers();
      const response = await handlers[method](
        new Request(`${ORIGIN}/api/${path.join("/")}`, {
          method,
          headers: {
            cookie: `${cookie}; nextly_csrf=${CSRF}`,
            "x-csrf-token": CSRF,
            origin: ORIGIN,
            "content-type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
        { params: Promise.resolve({ params: path }) }
      );
      const text = await response.text();
      return {
        status: response.status,
        body: (text === "" ? {} : JSON.parse(text)) as Record<string, unknown>,
      };
    }

    const plugin = (...sub: string[]) => [
      "plugins",
      ...PAGE_BUILDER_PLUGIN_NAME.split("/"),
      ...sub,
    ];

    /** What a route handler is handed, as the dispatcher builds it. */
    function routeContext(user: { id: string } | null = null) {
      const { db, services } = probe;
      if (db === undefined || services === undefined) {
        throw new Error("the probe did not boot");
      }
      return {
        self: { collections: {}, singles: {} },
        user,
        caller: { can: async () => true },
        fetch: (input: string, init?: RequestInit) => fetch(input, init),
        db,
        dialect,
        services,
      };
    }

    const add = (cookie: string, body: unknown = LORA_400_700) =>
      call("POST", plugin("site", "fonts"), cookie, body);

    async function storedFonts(t: TestNextly): Promise<unknown[]> {
      const doc = (await t.nextly.findSingle({
        slug: SITE_STYLE_SLUG,
        overrideAccess: true,
      })) as Record<string, unknown> | null;
      return Array.isArray(doc?.fonts) ? doc.fonts : [];
    }

    async function mediaCount(t: TestNextly): Promise<number> {
      const found = await t.nextly.media.find({
        overrideAccess: true,
        limit: 100,
      });
      return found.items.length;
    }

    /** Nothing was stored: no media, and the fonts as they were. */
    async function expectNothingStored(t: TestNextly): Promise<void> {
      expect(await mediaCount(t)).toBe(0);
      expect(await storedFonts(t)).toEqual([]);
    }

    const designer = (t: TestNextly) =>
      holding(t, "read-site-style", "update-site-style");

    it("downloads each file into the site's media and registers it at the site's own address", async () => {
      const t = await boot();
      const cookie = await designer(t);
      const answer = await add(cookie);
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      expect(answer.body.message).toBe("Lora was added to this site.");

      const fonts = (await storedFonts(t)) as Array<{
        family: string;
        weight: string;
        src: Array<{ url: string; format: string }>;
        source: unknown;
      }>;
      expect(fonts.map(face => face.weight)).toEqual(["400", "700"]);
      for (const face of fonts) {
        expect(face.family).toBe("Lora");
        expect(face.src[0]?.url).toMatch(/^\/api\/media\/[^/]+\/raw$/);
        expect(face.source).toEqual({
          kind: "google",
          id: "lora",
          licence: "OFL-1.1",
          category: "serif",
          subset: "latin",
        });
      }
      const media = await t.nextly.media.find({
        overrideAccess: true,
        limit: 10,
      });
      expect(media.items).toHaveLength(2);
      expect(media.items.every(item => item.mimeType === "font/woff2")).toBe(
        true
      );
      const folders = await t.nextly.media.folders.list({
        overrideAccess: true,
      });
      const fontsFolder = folders.find(folder => folder.name === "Fonts");
      expect(media.items.map(item => item.folderId)).toEqual([
        fontsFolder?.id,
        fontsFolder?.id,
      ]);

      // The site serves the bytes it stored, to a reader with no session.
      const id =
        /\/api\/media\/([^/]+)\/raw/.exec(fonts[0]?.src[0]?.url ?? "")?.[1] ??
        "";
      const served = await createMediaHandlers().GET(
        new Request(`${ORIGIN}/api/media/${id}/raw`),
        { params: Promise.resolve({ path: [id, "raw"] }) }
      );
      expect(served.status).toBe(200);
      expect(served.headers.get("content-type")).toContain("font/woff2");
      const bytes = Buffer.from(await served.arrayBuffer());
      expect(bytes.subarray(0, 4).toString("latin1")).toBe("wOF2");
      expect(catalogue.asked).toEqual([
        "/v1/fonts/lora",
        FILE_400,
        "/fontsource/fonts/lora@5.2.1/latin-700-normal.woff2",
      ]);
    });

    it("refuses a catalogue answer cut short, in its own words", async () => {
      const t = await boot();
      const cookie = await designer(t);
      catalogue.on("/v1/fonts/lora", (_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"id":"lora","fam');
      });
      const answer = await add(cookie);
      expect(answer.status).toBe(503);
      expect(JSON.stringify(answer.body)).toContain(
        "Google Fonts sent something"
      );
      await expectNothingStored(t);
    });

    it("downloads a variable family from the variable package's own release", async () => {
      const t = await boot();
      const cookie = await designer(t);
      // The static and variable packages are released separately, so the
      // family's `npmVersion` names no variable file.
      catalogue.json("/v1/fonts/inter", {
        ...LORA,
        id: "inter",
        family: "Inter",
        weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
        variable: true,
      });
      catalogue.json("/v1/version/inter", {
        latest: "5.2.1",
        latestVariable: "5.2.6",
      });
      const file = "/fontsource/fonts/inter:vf@5.2.6/latin-wght-normal.woff2";
      catalogue.font(file);
      const answer = await add(cookie, {
        id: "inter",
        weights: "variable",
        styles: ["normal"],
        subsets: ["latin"],
      });
      expect(answer.status).toBe(200);
      expect(catalogue.asked).toContain(file);
    });

    it("refuses a role without the site-design permission before asking the catalogue anything", async () => {
      const t = await boot();
      const cookie = await holding(t, "read-site-style");
      const answer = await add(cookie);
      expect(answer.status).toBe(403);
      expect(JSON.stringify(answer.body)).toContain(
        "You can’t change this site’s fonts."
      );
      expect(catalogue.asked).toEqual([]);
      const read = await call(
        "GET",
        plugin("site", "fonts", "catalogue"),
        cookie
      );
      expect(read.status).toBe(403);
      expect(catalogue.asked).toEqual([]);
      await expectNothingStored(t);
    });

    it.each([
      [
        "an id that walks out of the path",
        { ...LORA_400_700, id: "../../evil" },
      ],
      [
        "an id naming another host",
        { ...LORA_400_700, id: "evil.example.com/x" },
      ],
      [
        "an address of its own",
        { ...LORA_400_700, url: "https://evil.example.com/x.woff2" },
      ],
    ])("refuses %s, and fetches nothing", async (_case, body) => {
      const t = await boot();
      const answer = await add(await designer(t), body);
      expect(answer.status).toBe(400);
      expect(catalogue.asked).toEqual([]);
      await expectNothingStored(t);
    });

    it("refuses a redirect that leaves the configured host, and does not follow it", async () => {
      const t = await boot();
      catalogue.on(FILE_400, (_req, res) => {
        res.writeHead(302, { location: `${elsewhere.origin}/x.woff2` }).end();
      });
      const answer = await add(await designer(t));
      expect(answer.status).toBe(503);
      expect(JSON.stringify(answer.body)).toContain("isn’t a font file");
      expect(elsewhere.asked).toEqual([]);
      await expectNothingStored(t);
    });

    it("refuses a file over the cap, whether its length says so or not", async () => {
      const t = await boot({ bytesPerFile: 1024 });
      const cookie = await designer(t);
      catalogue.font(FILE_400, woff2(4096));
      expect((await add(cookie)).status).toBe(503);
      catalogue.on(FILE_400, (_req, res) => {
        // No length at all: only what arrives can be counted.
        res.writeHead(200, { "content-type": "font/woff2" });
        res.write(woff2(800));
        res.end(woff2(800));
      });
      expect((await add(cookie)).status).toBe(503);
      await expectNothingStored(t);
    });

    it("stops reading at the add's total rather than after the whole file", async () => {
      const t = await boot();
      const fonts = resolveFontOptions({
        catalogue: { api: catalogue.origin, files: catalogue.origin },
        limits: { bytesPerFile: 4096, bytesPerAdd: 1024, timeoutMs: 1500 },
      });
      if (fonts === false) throw new Error("the catalogue is on");
      catalogue.font(FILE_400, woff2(800));
      // The second file passes the total and then stalls past the add's time:
      // only a read stopped at the total answers before that time runs out.
      // Driven with a fetch that streams, as the host's own fetch hands over
      // only a whole body, under the host's cap.
      catalogue.on(FILE_700, (_req, res) => {
        res.writeHead(200, { "content-type": "font/woff2" });
        res.write(woff2(600));
        setTimeout(() => res.end(woff2(600)), 3000).unref();
      });
      const [, addRoute] = siteFontRoutes({
        fonts,
        nextly: async () => t.nextly as unknown as SiteFontsDirectApi,
      });
      const added = addRoute?.handler(
        new Request(`${ORIGIN}/x`, {
          method: "POST",
          body: JSON.stringify(LORA_400_700),
        }),
        routeContext()
      );
      const refusal: unknown = await added?.then(
        () => undefined,
        (error: unknown) => error
      );
      expect(NextlyError.isValidation(refusal)).toBe(true);
      expect(
        JSON.stringify(NextlyError.is(refusal) ? refusal.publicData : null)
      ).toContain("larger than one add allows");
      await expectNothingStored(t);
    });

    it("keeps both families when two adds write the site's fonts together", async () => {
      const t = await boot();
      catalogue.json("/v1/fonts/merriweather", {
        ...LORA,
        id: "merriweather",
        family: "Merriweather",
      });
      for (const weight of [400, 700]) {
        catalogue.font(
          `/fontsource/fonts/merriweather@5.2.1/latin-${String(weight)}-normal.woff2`
        );
      }
      const fonts = resolveFontOptions({
        catalogue: { api: catalogue.origin, files: catalogue.origin },
      });
      if (fonts === false) throw new Error("the catalogue is on");
      /*
       * Each write of the site's fonts waits until a second one is waiting
       * too, or half a second passes. Two adds that read before either
       * writes are then made to write together, the overlap a busy site
       * meets by chance; adds that take turns let the first through alone.
       */
      const real = t.nextly as unknown as SiteFontsDirectApi;
      const waiting: Array<() => void> = [];
      const together: SiteFontsDirectApi = {
        ...real,
        findSingle: args => real.findSingle(args),
        media: real.media,
        updateSingle: async args => {
          await new Promise<void>(resolve => {
            waiting.push(resolve);
            if (waiting.length === 2) for (const go of waiting) go();
            else setTimeout(resolve, 500).unref();
          });
          return real.updateSingle(args);
        },
      };
      const [, addRoute] = siteFontRoutes({
        fonts,
        nextly: async () => together,
      });
      const request = (id: string) =>
        addRoute?.handler(
          new Request(`${ORIGIN}/x`, {
            method: "POST",
            body: JSON.stringify({ ...LORA_400_700, id }),
          }),
          routeContext()
        );
      const answers = await Promise.all([
        request("lora"),
        request("merriweather"),
      ]);
      expect(answers.map(answer => answer?.status)).toEqual([200, 200]);
      const families = (
        (await storedFonts(t)) as Array<{ family: string }>
      ).map(face => face.family);
      expect(families.filter(name => name === "Lora")).toHaveLength(2);
      expect(families.filter(name => name === "Merriweather")).toHaveLength(2);
    });

    it("appends the faces with the version of the read it appended them to", async () => {
      // A save of the site's style between that read and the write refuses
      // the write, rather than losing what the save stored.
      const t = await boot();
      const fonts = resolveFontOptions({
        catalogue: { api: catalogue.origin, files: catalogue.origin },
      });
      if (fonts === false) throw new Error("the catalogue is on");
      const real = t.nextly as unknown as SiteFontsDirectApi;
      const readRevs: unknown[] = [];
      const sentRevs: unknown[] = [];
      const recording: SiteFontsDirectApi = {
        ...real,
        media: real.media,
        findSingle: async args => {
          const doc = await real.findSingle(args);
          readRevs.push((doc as Record<string, unknown> | null)?._rev);
          return doc;
        },
        updateSingle: async args => {
          sentRevs.push(args.data._rev);
          return real.updateSingle(args);
        },
      };
      const [, addRoute] = siteFontRoutes({
        fonts,
        nextly: async () => recording,
      });
      const answer = await addRoute?.handler(
        new Request(`${ORIGIN}/x`, {
          method: "POST",
          body: JSON.stringify(LORA_400_700),
        }),
        routeContext()
      );

      expect(answer?.status).toBe(200);
      expect(sentRevs).toHaveLength(1);
      expect(typeof sentRevs[0]).toBe("string");
      // The read the write appended to is the last one before it.
      expect(sentRevs[0]).toBe(readRevs.at(-1));
    });

    it("makes one Fonts folder when the first two adds start together", async () => {
      const t = await boot();
      catalogue.json("/v1/fonts/merriweather", {
        ...LORA,
        id: "merriweather",
        family: "Merriweather",
      });
      for (const weight of [400, 700]) {
        catalogue.font(
          `/fontsource/fonts/merriweather@5.2.1/latin-${String(weight)}-normal.woff2`
        );
      }
      const fonts = resolveFontOptions({
        catalogue: { api: catalogue.origin, files: catalogue.origin },
      });
      if (fonts === false) throw new Error("the catalogue is on");
      // Each look for the folder waits until a second one is looking too, or
      // half a second passes: two adds that look before either makes it would
      // then both make one.
      const real = t.nextly as unknown as SiteFontsDirectApi;
      const waiting: Array<() => void> = [];
      const together: SiteFontsDirectApi = {
        ...real,
        findSingle: args => real.findSingle(args),
        updateSingle: args => real.updateSingle(args),
        media: {
          ...real.media,
          upload: args => real.media.upload(args),
          delete: args => real.media.delete(args),
          folders: {
            ...real.media.folders,
            create: args => real.media.folders.create(args),
            list: async args => {
              await new Promise<void>(resolve => {
                waiting.push(resolve);
                if (waiting.length === 2) for (const go of waiting) go();
                else setTimeout(resolve, 500).unref();
              });
              return real.media.folders.list(args);
            },
          },
        },
      };
      const [, addRoute] = siteFontRoutes({
        fonts,
        nextly: async () => together,
      });
      // A folder records who made it, so the adds run as a real person.
      const maker = await t.nextly.users.create({
        email: "folder-maker@example.com",
        password: "Password123!",
        data: { name: "Folder Maker", isActive: true },
      });
      const request = (id: string) =>
        addRoute?.handler(
          new Request(`${ORIGIN}/x`, {
            method: "POST",
            body: JSON.stringify({ ...LORA_400_700, id }),
          }),
          routeContext({ id: maker.item.id })
        );
      await Promise.all([request("lora"), request("merriweather")]);
      const folders = await real.media.folders.list({ overrideAccess: true });
      expect(folders.filter(folder => folder.name === "Fonts")).toHaveLength(1);
    });

    /** The catalogue's options, as the routes are built from them. */
    function fontOptions() {
      const fonts = resolveFontOptions({
        catalogue: { api: catalogue.origin, files: catalogue.origin },
      });
      if (fonts === false) throw new Error("the catalogue is on");
      return fonts;
    }

    /** Merriweather in the catalogue, beside Lora, with its two files. */
    function offerMerriweather(): void {
      catalogue.json("/v1/fonts/merriweather", {
        ...LORA,
        id: "merriweather",
        family: "Merriweather",
      });
      for (const weight of [400, 700]) {
        catalogue.font(
          `/fontsource/fonts/merriweather@5.2.1/latin-${String(weight)}-normal.woff2`
        );
      }
    }

    /**
     * A point two calls wait at until both are there, or half a second
     * passes: two adds that both read before either writes are then made to
     * write together, the overlap a busy site meets by chance.
     */
    function meetingPoint(): () => Promise<void> {
      const waiting: Array<() => void> = [];
      return () =>
        new Promise<void>(resolve => {
          waiting.push(resolve);
          if (waiting.length === 2) for (const go of waiting) go();
          else setTimeout(resolve, 500).unref();
        });
    }

    /**
     * The add route of a route set of its own, as each server process builds
     * one: its own turn for writes and its own count of adds in flight.
     */
    function processAdd(api: SiteFontsDirectApi) {
      const [, addRoute] = siteFontRoutes({
        fonts: fontOptions(),
        nextly: async () => api,
      });
      if (addRoute === undefined) throw new Error("no add route");
      return (id: string, user: { id: string } | null = null) =>
        addRoute.handler(
          new Request(`${ORIGIN}/x`, {
            method: "POST",
            body: JSON.stringify({ ...LORA_400_700, id }),
          }),
          routeContext(user)
        );
    }

    /** The Direct API with every write of the Single held at `meet`, counted. */
    function writingAt(real: SiteFontsDirectApi, meet: () => Promise<void>) {
      const writes = { count: 0 };
      const api: SiteFontsDirectApi = {
        ...real,
        findSingle: args => real.findSingle(args),
        media: real.media,
        updateSingle: async args => {
          writes.count += 1;
          await meet();
          return real.updateSingle(args);
        },
      };
      return { api, writes };
    }

    /** Every claim row on the site's fonts folder, read past the routes. */
    async function claimRows(): Promise<{ value: string }[]> {
      const db = probe.db;
      if (db === undefined) throw new Error("the probe did not boot");
      const rows = await db
        .select(siteOptions)
        .where(eq(db.table(siteOptions).name, FONTS_FOLDER_OPTION))
        .all();
      return rows as unknown as { value: string }[];
    }

    /** The site's root "Fonts" folders. */
    async function fontsFolders(t: TestNextly): Promise<{ id: string }[]> {
      const folders = await t.nextly.media.folders.list({
        overrideAccess: true,
      });
      return folders.filter(folder => folder.name === "Fonts");
    }

    it("keeps both families when two server processes add them together, in one Fonts folder", async () => {
      const t = await boot();
      offerMerriweather();
      const real = t.nextly as unknown as SiteFontsDirectApi;
      const { api, writes } = writingAt(real, meetingPoint());
      const [lora, merriweather] = [processAdd(api), processAdd(api)];
      // A folder records who made it, a reference to a stored user, so the
      // adds run as a real person, as every add the route admits does. With
      // no user the folder cannot be made and the files go to the root.
      const maker = await t.nextly.users.create({
        email: "folder-maker@example.com",
        password: "Password123!",
        data: { name: "Folder Maker", isActive: true },
      });

      const answers = await Promise.all([
        lora("lora", { id: maker.item.id }),
        merriweather("merriweather", { id: maker.item.id }),
      ]);
      expect(answers.map(answer => answer.status)).toEqual([200, 200]);
      // CONTROL: one of the two writes was refused and made again, so the
      // two adds did read the same version before either wrote.
      expect(writes.count).toBe(3);
      const families = (
        (await storedFonts(t)) as Array<{ family: string }>
      ).map(face => face.family);
      expect(families.filter(name => name === "Lora")).toHaveLength(2);
      expect(families.filter(name => name === "Merriweather")).toHaveLength(2);

      const folders = await fontsFolders(t);
      expect(folders).toHaveLength(1);
      expect((await claimRows()).map(row => row.value)).toEqual([
        folders[0]?.id,
      ]);
      const media = await t.nextly.media.find({
        overrideAccess: true,
        limit: 100,
      });
      expect(media.items).toHaveLength(4);
      for (const item of media.items) {
        expect(item.folderId).toBe(folders[0]?.id);
      }
    });

    it("stores a family once when two server processes add it together, and deletes the second one's files", async () => {
      const t = await boot();
      const real = t.nextly as unknown as SiteFontsDirectApi;
      const { api, writes } = writingAt(real, meetingPoint());
      const [first, second] = [processAdd(api), processAdd(api)];

      const answers = await Promise.all([first("lora"), second("lora")]);
      expect(answers.map(answer => answer.status)).toEqual([200, 200]);
      const messages = await Promise.all(
        answers.map(
          async answer => ((await answer.json()) as { message: string }).message
        )
      );
      expect([...messages].sort()).toEqual([
        "Lora is already on this site.",
        "Lora was added to this site.",
      ]);
      // The refused add read again, found every face stored, and wrote
      // nothing more.
      expect(writes.count).toBe(2);
      const fonts = (await storedFonts(t)) as Array<{
        family: string;
        weight: string;
      }>;
      expect(fonts.map(face => `${face.family} ${face.weight}`)).toEqual([
        "Lora 400",
        "Lora 700",
      ]);
      expect(await mediaCount(t)).toBe(2);
    });

    it("makes one Fonts folder when two server processes add their first fonts together", async () => {
      const t = await boot();
      offerMerriweather();
      // Each look for the folder waits until a second one is looking too, or
      // half a second passes: two processes that look before either makes it
      // then both make one, and the claim keeps one of them.
      const real = t.nextly as unknown as SiteFontsDirectApi;
      const meet = meetingPoint();
      const looking: SiteFontsDirectApi = {
        ...real,
        findSingle: args => real.findSingle(args),
        updateSingle: args => real.updateSingle(args),
        media: {
          ...real.media,
          upload: args => real.media.upload(args),
          delete: args => real.media.delete(args),
          folders: {
            ...real.media.folders,
            create: args => real.media.folders.create(args),
            list: async args => {
              await meet();
              return real.media.folders.list(args);
            },
          },
        },
      };
      // A folder records who made it, so the adds run as a real person.
      const maker = await t.nextly.users.create({
        email: "folder-maker@example.com",
        password: "Password123!",
        data: { name: "Folder Maker", isActive: true },
      });
      const [lora, merriweather] = [processAdd(looking), processAdd(looking)];
      const answers = await Promise.all([
        lora("lora", { id: maker.item.id }),
        merriweather("merriweather", { id: maker.item.id }),
      ]);
      expect(answers.map(answer => answer.status)).toEqual([200, 200]);

      const folders = await fontsFolders(t);
      expect(folders).toHaveLength(1);
      expect((await claimRows()).map(row => row.value)).toEqual([
        folders[0]?.id,
      ]);
      const media = await t.nextly.media.find({
        overrideAccess: true,
        limit: 100,
      });
      expect(media.items).toHaveLength(4);
      for (const item of media.items) {
        expect(item.folderId).toBe(folders[0]?.id);
      }
    });

    it("makes and claims a new Fonts folder when the claimed one was deleted", async () => {
      const t = await boot();
      const db = probe.db;
      if (db === undefined) throw new Error("the probe did not boot");
      // A claim naming a folder no longer in the library.
      await db.insert(siteOptions, {
        name: FONTS_FOLDER_OPTION,
        value: "a-deleted-folder",
      });
      // CONTROL: no Fonts folder exists, so the one below is the add's.
      expect(await fontsFolders(t)).toEqual([]);

      const answer = await add(await designer(t));
      expect(answer.status).toBe(200);
      const folders = await fontsFolders(t);
      expect(folders).toHaveLength(1);
      expect((await claimRows()).map(row => row.value)).toEqual([
        folders[0]?.id,
      ]);
      const media = await t.nextly.media.find({
        overrideAccess: true,
        limit: 100,
      });
      for (const item of media.items) {
        expect(item.folderId).toBe(folders[0]?.id);
      }
    });

    it("refuses a request body past what an add can be, without waiting for the rest", async () => {
      const t = await boot();
      const fonts = resolveFontOptions({
        catalogue: { api: catalogue.origin, files: catalogue.origin },
      });
      if (fonts === false) throw new Error("the catalogue is on");
      const [, addRoute] = siteFontRoutes({
        fonts,
        nextly: async () => t.nextly as unknown as SiteFontsDirectApi,
      });
      // Far more than any add's body, and never finished: only a read that
      // stops at its limit answers.
      const endless = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(" ".repeat(64 * 1024)));
        },
      });
      const request = new Request(`${ORIGIN}/x`, {
        method: "POST",
        body: endless,
        duplex: "half",
      } as RequestInit);
      // Copied first, as a boundary in front of a route may: the copy's half
      // of the body is never read, so waiting on a cancel would wait forever.
      void request.clone();
      const answer = addRoute?.handler(request, routeContext());
      const refusal: unknown = await Promise.race([
        answer?.then(
          () => "answered",
          (error: unknown) => error
        ),
        new Promise(resolve => setTimeout(() => resolve("waited"), 2000)),
      ]);
      expect(NextlyError.isValidation(refusal)).toBe(true);
      expect(catalogue.asked).toEqual([]);
    });

    it("answers an empty catalogue as a list with no pages", async () => {
      const t = await boot();
      const cookie = await designer(t);
      catalogue.json("/v1/fonts?type=google", []);
      const read = await call(
        "GET",
        plugin("site", "fonts", "catalogue"),
        cookie
      );
      expect(read.status).toBe(200);
      expect(read.body).toMatchObject({
        items: [],
        meta: { total: 0, totalPages: 0, hasNext: false, hasPrev: false },
      });
      expect((read.body.meta as { limit: number }).limit).toBeGreaterThan(0);
    });

    it("refuses an answer that is not a woff2 file, by its type or by its bytes", async () => {
      const t = await boot();
      const cookie = await designer(t);
      catalogue.font(FILE_400, woff2(), "text/html");
      expect((await add(cookie)).status).toBe(503);
      catalogue.font(FILE_400, Buffer.from("GIF89a-not-a-font"));
      expect((await add(cookie)).status).toBe(503);
      await expectNothingStored(t);
    });

    it("gives up on a catalogue that does not answer in time", async () => {
      const t = await boot({ timeoutMs: 300 });
      catalogue.on(FILE_400, (_req, res) => {
        setTimeout(() => {
          res.writeHead(200, { "content-type": "font/woff2" }).end(woff2());
        }, 1000);
      });
      const answer = await add(await designer(t));
      expect(answer.status).toBe(503);
      expect(JSON.stringify(answer.body)).toContain("didn’t answer in time");
      await expectNothingStored(t);
    });

    it("deletes the files it stored when a later one cannot be stored", async () => {
      const t = await boot();
      const fonts = resolveFontOptions({
        catalogue: { api: catalogue.origin, files: catalogue.origin },
      });
      if (fonts === false) throw new Error("the catalogue is on");
      let uploads = 0;
      const real = t.nextly as unknown as SiteFontsDirectApi;
      const failingSecond: SiteFontsDirectApi = {
        ...real,
        findSingle: args => real.findSingle(args),
        updateSingle: args => real.updateSingle(args),
        media: {
          ...real.media,
          delete: args => real.media.delete(args),
          folders: real.media.folders,
          upload: async args => {
            uploads += 1;
            if (uploads === 2) throw new Error("storage refused the file");
            return real.media.upload(args);
          },
        },
      };
      const [, addRoute] = siteFontRoutes({
        fonts,
        nextly: async () => failingSecond,
      });
      await expect(
        addRoute?.handler(
          new Request(`${ORIGIN}/x`, {
            method: "POST",
            body: JSON.stringify({ ...LORA_400_700, weights: [400, 500, 700] }),
          }),
          routeContext()
        )
      ).rejects.toThrow("storage refused the file");
      expect(uploads).toBe(2);
      await expectNothingStored(t);
      expect(catalogue.asked).toContain(FILE_500);
    });

    it("adds nothing twice, and keeps a face another surface stored meanwhile", async () => {
      const t = await boot();
      const cookie = await designer(t);
      expect((await add(cookie)).status).toBe(200);
      const uploaded = {
        family: "Brand",
        src: [{ url: "/api/media/brand/raw", format: "woff2" }],
        source: { kind: "upload" },
      };
      const written = await call(
        "PATCH",
        ["singles", SITE_STYLE_SLUG],
        cookie,
        {
          fonts: [...(await storedFonts(t)), uploaded],
          _overwrite: true,
        }
      );
      expect(written.status).toBe(200);
      const again = await add(cookie, {
        ...LORA_400_700,
        weights: [400, 500, 700],
      });
      expect(again.status).toBe(200);
      const fonts = (await storedFonts(t)) as Array<{
        family: string;
        weight?: string;
      }>;
      expect(fonts.map(face => `${face.family} ${face.weight ?? ""}`)).toEqual([
        "Lora 400",
        "Lora 700",
        "Brand ",
        "Lora 500",
      ]);
      expect(await mediaCount(t)).toBe(3);
      const repeat = await add(cookie);
      expect(repeat.body.message).toBe("Lora is already on this site.");
      expect(await mediaCount(t)).toBe(3);
    });

    it("reads the catalogue once a day, and serves the last good copy when a refresh fails", async () => {
      const t = await boot();
      const cookie = await designer(t);
      const read = () =>
        call("GET", plugin("site", "fonts", "catalogue"), cookie);
      const first = await read();
      expect(first.status).toBe(200);
      // The canonical list envelope: the families as items, and where
      // previews load and when the catalogue was read in its meta.
      expect(first.body).toMatchObject({
        items: [
          { id: "lora", family: "Lora", category: "serif", popularity: 52_000 },
        ],
        meta: {
          total: 1,
          page: 1,
          totalPages: 1,
          hasNext: false,
          previewBase: catalogue.origin,
        },
      });
      expect((await read()).status).toBe(200);
      expect(
        catalogue.asked.filter(path => path.startsWith("/v1/fonts?"))
      ).toHaveLength(1);
      // The stats are read with the list and kept with it, never per open.
      expect(catalogue.asked.filter(path => path === "/v1/stats")).toHaveLength(
        1
      );

      const fonts = resolveFontOptions({
        catalogue: { api: catalogue.origin, files: catalogue.origin },
      });
      if (fonts === false) throw new Error("the catalogue is on");
      let clock = 0;
      const [readRoute] = siteFontRoutes({
        fonts,
        now: () => clock,
        nextly: async () => t.nextly as unknown as SiteFontsDirectApi,
      });
      const ctx = routeContext();
      const families = async () =>
        (
          (await (
            await readRoute?.handler(new Request(ORIGIN), ctx)
          )?.json()) as {
            items: unknown[];
          }
        ).items;
      expect(await families()).toHaveLength(1);
      catalogue.on("/v1/fonts?type=google", (_req, res) =>
        res.writeHead(503).end()
      );
      clock += 25 * 60 * 60 * 1000;
      expect(await families()).toHaveLength(1);
      expect(
        catalogue.asked.filter(path => path.startsWith("/v1/fonts?"))
      ).toHaveLength(3);
      expect(catalogue.asked.filter(path => path === "/v1/stats")).toHaveLength(
        3
      );
    });

    it("still refuses a face loading from another server, written straight to the Single", async () => {
      const t = await boot();
      const cookie = await designer(t);
      const answer = await call("PATCH", ["singles", SITE_STYLE_SLUG], cookie, {
        fonts: [
          {
            family: "Lora",
            src: [{ url: "https://fonts.gstatic.com/s/lora.woff2" }],
          },
        ],
        _overwrite: true,
      });
      expect(answer.status).toBeGreaterThanOrEqual(400);
      expect(await storedFonts(t)).toEqual([]);
    });
  }
);
