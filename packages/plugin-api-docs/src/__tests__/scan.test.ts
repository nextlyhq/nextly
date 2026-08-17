/**
 * Tests for the filesystem mount scanner.
 *
 * The pure parser and mount-path derivation are exercised with string literals;
 * one filesystem integration test builds a temp project tree at runtime and
 * scans it — the headline check: the media factory mounted twice must yield TWO
 * distinct mounts, distinguished only by the verbs each route file re-exports.
 *
 * @module __tests__/scan
 * @since alpha
 */
import { describe, expect, it } from "vitest";

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  classifyRouteSource,
  deriveMountPath,
  scanAppDirectory,
} from "../scan";

describe("classifyRouteSource", () => {
  it("classifies the dynamic catch-all (nextly/runtime, arrow-wrapped verbs)", () => {
    const code = `
import { createDynamicHandlers } from "nextly/runtime";
const h = createDynamicHandlers({ config: cfg });
export const GET = (req, ctx) => h.GET(req, ctx);
export const POST = (req, ctx) => h.POST(req, ctx);
export const PUT = (req, ctx) => h.PUT(req, ctx);
export const PATCH = (req, ctx) => h.PATCH(req, ctx);
export const DELETE = (req, ctx) => h.DELETE(req, ctx);
export const OPTIONS = (req) => h.OPTIONS(req);
`;
    expect(classifyRouteSource(code)).toEqual({
      kind: "nextly",
      source: { kind: "dynamic-catchall" },
      verbs: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    });
  });

  it("classifies the auth'd media mount (full CRUD verbs)", () => {
    const code = `
import { createMediaHandlers } from "nextly/api/media-handlers";
const h = createMediaHandlers({ config: cfg, requireAuth: true });
export const GET = h.GET;
export const POST = h.POST;
export const PATCH = h.PATCH;
export const DELETE = h.DELETE;
`;
    expect(classifyRouteSource(code)).toEqual({
      kind: "nextly",
      source: { kind: "media" },
      verbs: ["GET", "POST", "PATCH", "DELETE"],
    });
  });

  it("classifies the public media mount (GET only) — the double-mount twin", () => {
    const code = `
import { createMediaHandlers } from "nextly/api/media-handlers";
const h = createMediaHandlers({ config: cfg });
export const GET = h.GET;
`;
    expect(classifyRouteSource(code)).toEqual({
      kind: "nextly",
      source: { kind: "media" },
      verbs: ["GET"],
    });
  });

  it("classifies a subpath re-export and ignores a fake export in a JSDoc comment", () => {
    // The block comment contains a decoy export with SINGLE quotes and a
    // DIFFERENT verb set — identical verbs could not distinguish stripping
    // from no-stripping, since both would yield the same result.
    const code = `
/**
 * \`\`\`typescript
 * export { GET, POST, DELETE } from 'nextly/api/health';
 * \`\`\`
 */
export { GET, HEAD } from "nextly/api/health";
`;
    expect(classifyRouteSource(code)).toEqual({
      kind: "nextly",
      source: { kind: "api-subpath", subpath: "health" },
      verbs: ["GET", "HEAD"],
    });
  });

  it("returns non-nextly for a user-owned route with no nextly import", () => {
    const code = `
export async function GET() {
  return Response.json({ ok: true });
}
`;
    expect(classifyRouteSource(code)).toEqual({ kind: "non-nextly" });
  });

  it("flags a nextly reference it cannot classify as unrecognized, with a reason", () => {
    const code = `
import { defineConfig } from "nextly/config";
export const GET = () => {};
`;
    const result = classifyRouteSource(code);
    expect(result.kind).toBe("unrecognized");
    if (result.kind === "unrecognized") {
      expect(result.reason).toContain("nextly/config");
    }
  });

  it("flags media-handlers imported without calling the factory", () => {
    const code = `
import { createMediaHandlers } from "nextly/api/media-handlers";
export const GET = someOtherHandler;
`;
    const result = classifyRouteSource(code);
    expect(result.kind).toBe("unrecognized");
    if (result.kind === "unrecognized") {
      expect(result.reason).toContain("createMediaHandlers");
    }
  });
});

describe("deriveMountPath", () => {
  it("derives a catch-all mount under src/app", () => {
    expect(
      deriveMountPath("/proj/src/app/admin/api/[[...params]]/route.ts")
    ).toBe("/admin/api/[[...params]]");
  });

  it("derives a plain mount under app/", () => {
    expect(deriveMountPath("/proj/app/api/health/route.ts")).toBe(
      "/api/health"
    );
  });

  it("strips route-group segments, which are not part of the URL", () => {
    expect(deriveMountPath("/proj/src/app/(frontend)/feed.xml/route.ts")).toBe(
      "/feed.xml"
    );
  });

  it("normalizes Windows backslash paths", () => {
    expect(
      deriveMountPath("C:\\proj\\src\\app\\api\\media\\[[...path]]\\route.ts")
    ).toBe("/api/media/[[...path]]");
  });

  it("throws when the file is not under an app/ directory", () => {
    expect(() => deriveMountPath("/proj/server/handlers/route.ts")).toThrow(
      /app\//
    );
  });
});

describe("scanAppDirectory (filesystem)", () => {
  // Builds a temp project mirroring the standard scaffold, scans it, and asserts
  // the headline property: one media factory, two distinct mounts.
  function buildTempProject(): string {
    const root = mkdtempSync(join(tmpdir(), "nextly-docs-scan-"));
    const write = (rel: string, content: string): void => {
      const full = join(root, "app", rel);
      // dirname is OS-separator-aware; a raw lastIndexOf("/") misses on Windows.
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, "utf8");
    };

    write("admin/api/[[...params]]/route.ts", `${catchAll}\n`);
    write("admin/api/media/[[...path]]/route.ts", `${adminMedia}\n`);
    write("api/media/[[...path]]/route.ts", `${publicMedia}\n`);
    write("api/health/route.ts", `${health}\n`);
    // A user-owned route — must be skipped, not classified.
    write("api/custom/route.ts", `${userRoute}\n`);
    // A nextly reference in an unknown shape — must surface as unrecognized.
    write("api/odd/route.ts", `${oddRoute}\n`);
    return root;
  }

  it("discovers the media double-mount as two distinct mounts", () => {
    const root = buildTempProject();
    try {
      const { routes } = scanAppDirectory(root);
      const media = routes.filter(r => r.source.kind === "media");
      expect(media).toHaveLength(2);

      const admin = media.find(
        r => r.mountPath === "/admin/api/media/[[...path]]"
      );
      const pub = media.find(r => r.mountPath === "/api/media/[[...path]]");
      expect(admin?.verbs).toEqual(["GET", "POST", "PATCH", "DELETE"]);
      expect(pub?.verbs).toEqual(["GET"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("discovers the catch-all and the subpath re-export", () => {
    const root = buildTempProject();
    try {
      const { routes } = scanAppDirectory(root);

      const catchAll = routes.find(r => r.source.kind === "dynamic-catchall");
      expect(catchAll?.mountPath).toBe("/admin/api/[[...params]]");

      const health = routes.find(
        r => r.source.kind === "api-subpath" && r.source.subpath === "health"
      );
      expect(health).toEqual({
        filePath: expect.stringMatching(/api[\\/]health[\\/]route\.ts$/),
        mountPath: "/api/health",
        source: { kind: "api-subpath", subpath: "health" },
        verbs: ["GET", "HEAD"],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips user routes and surfaces unrecognized nextly references", () => {
    const root = buildTempProject();
    try {
      const { routes, unrecognized } = scanAppDirectory(root);

      // Four nextly mounts: catch-all + two media + health.
      expect(routes).toHaveLength(4);
      expect(routes.some(r => r.mountPath === "/api/custom")).toBe(false);

      expect(unrecognized).toHaveLength(1);
      expect(unrecognized[0]?.reason).toContain("nextly/config");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---- shared fixture sources (mirror the real route-file shapes) ------------

const catchAll = `
import { createDynamicHandlers } from "nextly/runtime";
import cfg from "../../nextly.config";
const h = createDynamicHandlers({ config: cfg });
export const GET = (req, ctx) => h.GET(req, ctx);
export const POST = (req, ctx) => h.POST(req, ctx);
export const PUT = (req, ctx) => h.PUT(req, ctx);
export const PATCH = (req, ctx) => h.PATCH(req, ctx);
export const DELETE = (req, ctx) => h.DELETE(req, ctx);
export const OPTIONS = (req) => h.OPTIONS(req);
`;

const adminMedia = `
import { createMediaHandlers } from "nextly/api/media-handlers";
import cfg from "../../../nextly.config";
const h = createMediaHandlers({ config: cfg, requireAuth: true });
export const GET = h.GET;
export const POST = h.POST;
export const PATCH = h.PATCH;
export const DELETE = h.DELETE;
`;

const publicMedia = `
import { createMediaHandlers } from "nextly/api/media-handlers";
import cfg from "../../../../nextly.config";
const h = createMediaHandlers({ config: cfg });
export const GET = h.GET;
`;

const health = `
/**
 * Decoy with different verbs + single quotes; the real export below wins.
 * \`\`\`typescript
 * export { GET, POST, DELETE } from 'nextly/api/health';
 * \`\`\`
 */
export { GET, HEAD } from "nextly/api/health";
`;

const userRoute = `
export async function GET() {
  return Response.json({ ok: true });
}
`;

const oddRoute = `
import { defineConfig } from "nextly/config";
export const GET = () => {};
`;
