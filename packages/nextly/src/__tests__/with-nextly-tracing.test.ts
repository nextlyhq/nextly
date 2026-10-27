/**
 * `withNextly()` adds the database drivers and adapters to the files Next.js
 * traces into a deployment, under the top-level `outputFileTracingIncludes`.
 *
 * Next.js reads that key at the top level only. Under `experimental` it warns
 * on every build that the key is unrecognized and has moved, then copies it to
 * the top level by assignment, replacing whatever the app had put there. So
 * the app's own entries are merged with Nextly's, never replaced, and nothing
 * is written under `experimental`. The last case parses the result with the
 * installed Next.js's own config schema, the check behind that warning.
 */
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { withNextly } from "../next";

type Includes = Record<string, string[]>;

const PG = "./node_modules/pg/**/*";

/** `withNextly()` on a config typed as Next.js reads it: any key, any value. */
const wrap = (config: Record<string, unknown>) => withNextly(config);

describe("withNextly's file tracing includes", () => {
  it("adds the drivers to the top-level key, not under experimental", () => {
    const config = wrap({});
    const includes = config.outputFileTracingIncludes as Includes;
    expect(includes["/**"]).toContain(PG);
    expect(includes["/**"]).toContain("./node_modules/drizzle-orm/**/*");
    expect(config.experimental ?? {}).not.toHaveProperty(
      "outputFileTracingIncludes"
    );
  });

  it("keeps the app's own top-level entries, for every route pattern", () => {
    const config = wrap({
      outputFileTracingIncludes: {
        "/**": ["./content/**/*"],
        "/api/report": ["./templates/report.hbs"],
      },
    });
    const includes = config.outputFileTracingIncludes as Includes;
    expect(includes["/**"]).toEqual(
      expect.arrayContaining(["./content/**/*", PG])
    );
    expect(includes["/**"][0]).toBe("./content/**/*");
    expect(includes["/api/report"]).toEqual(["./templates/report.hbs"]);
  });

  it("moves an app's own experimental entries to the top level, keeping its other experimental options", () => {
    const config = wrap({
      experimental: {
        outputFileTracingIncludes: { "/admin": ["./admin-assets/**/*"] },
        optimizePackageImports: ["lucide-react"],
      },
      outputFileTracingIncludes: { "/**": ["./content/**/*"] },
    });
    const includes = config.outputFileTracingIncludes as Includes;
    expect(includes["/admin"]).toEqual(["./admin-assets/**/*"]);
    expect(includes["/**"]).toEqual(
      expect.arrayContaining(["./content/**/*", PG])
    );
    expect(config.experimental).toEqual({
      optimizePackageImports: ["lucide-react"],
    });
  });

  it("lists each file once when the app already names one of Nextly's", () => {
    const config = wrap({ outputFileTracingIncludes: { "/**": [PG] } });
    const includes = config.outputFileTracingIncludes as Includes;
    expect(includes["/**"].filter(entry => entry === PG)).toHaveLength(1);
  });

  it("passes the installed Next.js config schema, with no unrecognized key", () => {
    // Next.js's own schema, which prints "Invalid next.config options
    // detected" for what it does not recognise.
    const require = createRequire(import.meta.url);
    const { configSchema } = require("next/dist/server/config-schema.js") as {
      configSchema: {
        safeParse(value: unknown): {
          success: boolean;
          error?: { issues: unknown[] };
        };
      };
    };
    const result = configSchema.safeParse(
      wrap({
        experimental: { optimizePackageImports: ["lucide-react"] },
        outputFileTracingIncludes: { "/**": ["./content/**/*"] },
      })
    );
    expect(result.error?.issues ?? []).toEqual([]);
    expect(result.success).toBe(true);
  });
});
