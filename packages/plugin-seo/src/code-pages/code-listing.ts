/**
 * Every page built in code the running site has, from the three places one
 * is known: the build's own files (`code-pages/routes`), what the build
 * that is served recorded in the database while it rendered the site
 * (`code-pages/build-record`), and what the site states in the plugin's
 * `codeAddresses` (`code-pages/stated`). The one list the Pages screen, the
 * sitemap, llms.txt and the plain-text copies read.
 *
 * The build's files stay the cross-check: an address its prerender
 * manifest says answered not found is no page, however else it is known,
 * and an address no route of the build serves is no page either.
 *
 * @module code-pages/code-listing
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";

import {
  buildIdIn,
  readBuildRecord,
  type BuildRecord,
  type RecordedAddress,
} from "./build-record";
import type { BuildRecordStatus } from "./contract";
import { dynamicRouteServing, type CodeBuild, type CodeRoute } from "./routes";
import type { StatedAddress, StatedAddresses } from "./stated";

/** What the running site has of its pages built in code, and how it knows. */
export interface CodeListing extends CodeBuild {
  /**
   * What the build being served recorded, where its id could be read:
   * the id, how many pages it recorded, and when.
   */
  recorded?: BuildRecordStatus;
}

/**
 * The route file of the route serving `path` in `build`, where one does;
 * where the build names no route at all, as when its app paths can't be
 * read, `fallback`, since nothing then says the route is gone.
 */
function routeServing(
  build: CodeBuild,
  path: string,
  fallback: string
): string | undefined {
  const serving = dynamicRouteServing(path, build.dynamic);
  if (serving !== undefined) return serving.route;
  return build.routes.length === 0 && build.dynamic.length === 0
    ? fallback
    : undefined;
}

/**
 * `build`'s pages with those `recorded` and `stated` add: each address
 * once, the build's files first, then the record, then the options; never
 * one the build answered not found, nor one no route of the build serves.
 * Sorted by address.
 */
export function withKnownAddresses(
  build: CodeBuild,
  recorded: readonly RecordedAddress[],
  stated: readonly StatedAddress[]
): CodeRoute[] {
  const found = new Map(build.routes.map(route => [route.path, route]));
  const notFound = new Set(build.notFound ?? []);
  const add = (
    path: string,
    fallback: string,
    listedBy: NonNullable<CodeRoute["listedBy"]>
  ) => {
    if (found.has(path) || notFound.has(path)) return;
    const route = routeServing(build, path, fallback);
    if (route === undefined) return;
    found.set(path, {
      path,
      source: "dynamic",
      route,
      declared: true,
      listedBy,
    });
  };
  for (const each of recorded) {
    add(each.path, each.route ?? each.path, "build-record");
  }
  for (const each of stated) add(each.path, each.pattern, "options");
  return [...found.values()].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  );
}

/** What the record of `build` says, as the screen is told it. */
function statusOf(record: BuildRecord): BuildRecordStatus {
  return {
    build: record.buildId,
    pages: record.addresses.length,
    ...(record.recordedAt === undefined ? {} : { at: record.recordedAt }),
  };
}

/** Where the listing reads from. */
export interface CodeListingSources {
  /** What the build's files say, read when asked. */
  build: () => CodeBuild;
  /** The build directory, where its `BUILD_ID` is. */
  buildDir: () => string;
  /** What the site states in `codeAddresses`. */
  stated: StatedAddresses;
}

/**
 * Every page built in code the running site has (`CodeListing`): one read
 * of the build's record, by its id, and the site's stated params, kept a
 * short while.
 */
export async function readCodeListing(
  ctx: PluginContext,
  sources: CodeListingSources
): Promise<CodeListing> {
  const build = sources.build();
  const buildId = buildIdIn(sources.buildDir());
  const record =
    buildId === undefined ? undefined : await readBuildRecord(ctx, buildId);
  const stated = await sources.stated.addresses(ctx);
  return {
    ...build,
    routes: withKnownAddresses(build, record?.addresses ?? [], stated),
    ...(record === undefined ? {} : { recorded: statusOf(record) }),
  };
}
