/**
 * Where a downloaded template comes from, and what a failed download says.
 *
 * A content template is downloaded at the tag of this CLI's own release, so
 * it comes from the same release as the packages the project declares; a
 * --branch takes it from that branch. Codeload names an archive's top folder
 * after the ref, but not as it is spelled (a tag loses its `v`, observed on
 * 2026-10-17 for `v0.0.2-alpha.66`), so the archives here are built that way.
 * A missing release and an unreachable GitHub each say their own way on.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "tar";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cleanupDownload,
  resolveTemplateSource,
} from "../lib/download-template";
import type { NextlySource } from "../lib/nextly-release";

const RELEASE = "0.0.2-alpha.40";
const source: NextlySource = { kind: "release", cliVersion: RELEASE };

let work: string;

beforeEach(async () => {
  work = await mkdtemp(path.join(tmpdir(), "nextly-download-"));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(work, { recursive: true, force: true });
});

/** A gzipped archive with Codeload's layout, under the given top folder. */
async function archive(top: string): Promise<Buffer> {
  const root = path.join(work, "src");
  for (const [file, text] of [
    ["templates/base/package.json", "{}"],
    ["templates/blog/page.tsx", "export default 1;"],
    ["packages/nextly/index.ts", "not a template"],
  ]) {
    await mkdir(path.dirname(path.join(root, top, file)), { recursive: true });
    await writeFile(path.join(root, top, file), text);
  }
  const out = path.join(work, "archive.tgz");
  await create({ gzip: true, cwd: root, file: out }, [top]);
  return readFile(out);
}

function serve(body: Buffer, status = 200) {
  const fetch = vi.fn(
    async () => new Response(status === 200 ? body : null, { status })
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("downloading a content template", () => {
  it("downloads it at this release's tag, whose archive folder has no v", async () => {
    const fetch = serve(await archive(`nextly-${RELEASE}`));

    const template = await resolveTemplateSource("blog", { source });
    try {
      expect(String(fetch.mock.calls[0]?.[0])).toMatch(
        new RegExp(`/tar\\.gz/v${RELEASE.replace(/\./g, "\\.")}$`)
      );
      expect(
        await readFile(path.join(template.templatePath, "page.tsx"), "utf8")
      ).toBe("export default 1;");
      expect(
        await readFile(path.join(template.basePath, "package.json"), "utf8")
      ).toBe("{}");
    } finally {
      await cleanupDownload(template);
    }
  });

  // Codeload turns a branch's `/` into `-` in the folder name.
  it("takes it from a branch when one is given", async () => {
    const fetch = serve(await archive("nextly-feature-blog-cards"));

    const template = await resolveTemplateSource("blog", {
      branch: "feature/blog-cards",
      source,
    });
    try {
      expect(String(fetch.mock.calls[0]?.[0])).toMatch(
        /\/tar\.gz\/feature\/blog-cards$/
      );
      expect(
        await readFile(path.join(template.templatePath, "page.tsx"), "utf8")
      ).toBe("export default 1;");
    } finally {
      await cleanupDownload(template);
    }
  });

  it("names --branch when GitHub has no template for this release", async () => {
    serve(Buffer.alloc(0), 404);

    await expect(resolveTemplateSource("blog", { source })).rejects.toThrow(
      new RegExp(
        `no blog template for this create-nextly-app's release, ${RELEASE.replace(/\./g, "\\.")}.*--branch`
      )
    );
  });

  // Another ref would fail the same way, so the way on is to try again or to
  // read the templates from disk.
  it("names --local-template when GitHub cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );

    const error = await resolveTemplateSource("blog", { source }).catch(
      (thrown: Error) => thrown
    );

    expect(String(error)).toMatch(
      /Could not reach GitHub.*fetch failed.*Try again.*--local-template/
    );
    expect(String(error)).not.toMatch(/--branch/);
  });
});
