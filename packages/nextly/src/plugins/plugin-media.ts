/**
 * `ctx.services.media`: the plugin view of the media library, with its writes
 * checked when the plugin says who it acts for.
 *
 * Each write takes {@link ServiceOpts} where the service takes a caller, as
 * `ctx.services.collections` does. A write made as a signed-in person is judged
 * as REST's media routes judge that person, by `SYSTEM_WRITE_POLICY.media`:
 * `create-media` to upload or make a folder, `update-media` to edit or move,
 * `delete-media` to delete. A write as `{ as: "public" }`, or
 * as a plugin-defined person, is refused as REST refuses an anonymous caller,
 * since the library has no rule such a caller can be judged by. A refusal runs
 * before any work, so the library stays as it was.
 *
 * The plugin acting as itself, with no options or `{ as: "system" }`, stays
 * trusted. A `user` named beside `system` is the one the write is attributed
 * to: a folder records them as its creator.
 *
 * @module plugins/plugin-media
 */

import { runWithCallerScope } from "../auth/caller-scope";
import type { AuthContext } from "../auth/middleware";
import { runAsPrincipal } from "../auth/principal-scope";
import type { RequestActor } from "../auth/request-actor";
import { checkWrite, directApiActor } from "../direct-api/namespaces/helpers";
import type { DirectAPIConfig } from "../direct-api/types";
import { SYSTEM_WRITE_POLICY } from "../domains/auth/system-write-policy";
import { NextlyError } from "../errors/nextly-error";
import type { MediaService } from "../services/media/media-service";
import type { RequestContext } from "../services/shared";

import { methodFacade } from "./service-facade";
import { resolveServiceOpts, type ServiceOpts } from "./service-opts";

/** The media reads a plugin is handed as they are. */
export const PLUGIN_MEDIA_READS = [
  "findById",
  "listMedia",
  "getStorageType",
  "hasStorage",
  "findFolderById",
  "listRootFolders",
  "listSubfolders",
  "getFolderContents",
  "isImage",
  "validateImage",
  "getImageDimensions",
] as const satisfies readonly (keyof MediaService)[];

/**
 * @deprecated Pass {@link ServiceOpts}. A `RequestContext` is still accepted
 * and read as `ServiceOpts`: its `user` is checked as that user, and its `role`
 * and `permissions` are ignored, since the roles a person holds are read from
 * their account on every plugin path.
 */
export type LegacyMediaCaller = RequestContext;

/** Who a media write is made as. */
export type PluginMediaCaller = ServiceOpts | LegacyMediaCaller;

type Arg<M extends keyof MediaService, I extends number> = Parameters<
  MediaService[M]
>[I];
type Result<M extends keyof MediaService> = ReturnType<MediaService[M]>;

/**
 * The media writes, each checked when the plugin says who it acts for. Where
 * a write also takes an `actor`, a checked one records the caller as the actor,
 * and refuses an actor naming anyone else.
 */
export interface PluginMediaWrites {
  /** @experimental Upload a file. Needs `create-media` when checked. */
  upload(
    input: Arg<"upload", 0>,
    opts?: PluginMediaCaller,
    actor?: RequestActor
  ): Result<"upload">;
  /** @experimental Upload several files. Needs `create-media` when checked. */
  bulkUpload(
    inputs: Arg<"bulkUpload", 0>,
    opts?: PluginMediaCaller,
    actor?: RequestActor
  ): Result<"bulkUpload">;
  /** @experimental Edit a file. Needs `update-media` when checked. */
  update(
    mediaId: string,
    input: Arg<"update", 1>,
    opts?: PluginMediaCaller,
    actor?: RequestActor
  ): Result<"update">;
  /** @experimental Move a file. Needs `update-media` when checked. */
  moveToFolder(
    mediaId: string,
    folderId: string | null,
    opts?: PluginMediaCaller,
    actor?: RequestActor
  ): Result<"moveToFolder">;
  /** @experimental Delete a file. Needs `delete-media` when checked. */
  delete(
    mediaId: string,
    opts?: PluginMediaCaller,
    actor?: RequestActor
  ): Result<"delete">;
  /** @experimental Delete several files. Needs `delete-media` when checked. */
  bulkDelete(
    mediaIds: string[],
    opts?: PluginMediaCaller,
    actor?: RequestActor
  ): Result<"bulkDelete">;
  /** @experimental Make a folder. Needs `create-media` when checked. */
  createFolder(
    input: Arg<"createFolder", 0>,
    opts?: PluginMediaCaller
  ): Result<"createFolder">;
  /** @experimental Rename or edit a folder. Needs `update-media` when checked. */
  updateFolder(
    folderId: string,
    input: Arg<"updateFolder", 1>,
    opts?: PluginMediaCaller
  ): Result<"updateFolder">;
  /** @experimental Delete a folder. Needs `delete-media` when checked. */
  deleteFolder(
    folderId: string,
    deleteContents?: boolean,
    opts?: PluginMediaCaller
  ): Result<"deleteFolder">;
}

/** `ctx.services.media`. */
export type PluginMediaService = Pick<
  MediaService,
  (typeof PLUGIN_MEDIA_READS)[number]
> &
  PluginMediaWrites;

/**
 * Where each write takes its caller, and whether an `actor` follows it. What
 * each asks of a checked caller is `SYSTEM_WRITE_POLICY.media`, the entry the
 * Direct API reads, so the two doors cannot ask different questions.
 */
const MEDIA_WRITES = {
  upload: { at: 1, actor: true },
  bulkUpload: { at: 1, actor: true },
  createFolder: { at: 1, actor: false },
  update: { at: 2, actor: true },
  moveToFolder: { at: 2, actor: true },
  updateFolder: { at: 2, actor: false },
  delete: { at: 1, actor: true },
  bulkDelete: { at: 1, actor: true },
  deleteFolder: { at: 2, actor: false },
} as const satisfies Record<
  keyof PluginMediaWrites & keyof typeof SYSTEM_WRITE_POLICY.media,
  { at: number; actor: boolean }
>;

/**
 * Whether `named` is someone other than `own`. An id is compared only when
 * both carry one: `{ type: "user" }` names no one else, and a key's own id is
 * not known here.
 */
function namesAnother(
  named: RequestActor | undefined,
  own: RequestActor | undefined
): boolean {
  if (!named) return false;
  if (!own || named.type !== own.type) return true;
  return named.id !== undefined && own.id !== undefined && named.id !== own.id;
}

/**
 * The actor a write records. A trusted write records whatever the plugin
 * named, as before. A checked write records its caller, and refuses an actor
 * naming anyone else. An actor naming only the caller's kind is the caller, and
 * a key carries no id the caller can be matched on, so a named key is matched
 * by kind alone; the actor recorded is still the caller's.
 */
function actorFor(
  name: keyof PluginMediaWrites,
  named: RequestActor | undefined,
  caller: AuthContext | null,
  config: DirectAPIConfig
): RequestActor | undefined {
  if (!caller) return named;
  const own = directApiActor({}, config);
  if (namesAnother(named, own)) {
    throw NextlyError.forbidden({
      logContext: {
        reason: "checked-media-write-names-another-actor",
        write: name,
        userId: caller.userId,
      },
    });
  }
  return own;
}

/** The caller a write's `ServiceOpts` names, as the seam takes one. */
function callerConfig(
  resolved: Awaited<ReturnType<typeof resolveServiceOpts>>
): DirectAPIConfig {
  return {
    overrideAccess: resolved.overrideAccess,
    user: resolved.user,
    actor: resolved.authenticatedScope,
  };
}

/** One write, with its caller resolved and, when checked, judged first. */
function checkedWrite(
  service: MediaService,
  name: keyof PluginMediaWrites
): (...args: unknown[]) => Promise<unknown> {
  const { at, actor: takesActor } = MEDIA_WRITES[name];
  const write = Reflect.get(service, name) as (
    ...args: unknown[]
  ) => Promise<unknown>;
  return async (...args: unknown[]) => {
    const opts = (args[at] ?? {}) as ServiceOpts;
    const resolved = await resolveServiceOpts(opts);
    const config = callerConfig(resolved);
    // The whole write runs as the call names it, as `services.collections`
    // runs its calls: with the person it names (or none) and the scope it
    // resolved. Without the fresh frame, a write made inside one of the
    // plugin's people's frames is recorded as that person, and anything the
    // write sets going runs with grants the call gave up.
    return runAsPrincipal(opts.principal ?? null, () =>
      runWithCallerScope(resolved.authenticatedScope, async () => {
        // The precondition, before any work: the Direct API's own write gate,
        // so a caller refused there is refused here, and on REST.
        const caller = await checkWrite(
          {},
          config,
          SYSTEM_WRITE_POLICY.media[name]
        );

        // Nothing past the caller travels but the service's own `actor`.
        const next: unknown[] = args.slice(0, at);
        next[at] = { ...resolved } satisfies RequestContext;
        if (takesActor) {
          next[at + 1] = actorFor(
            name,
            args[at + 1] as RequestActor | undefined,
            caller,
            config
          );
        }
        return write.apply(service, next);
      })
    );
  };
}

/** `ctx.services.media`, over the host's media service. */
export function mediaForPlugin(service: MediaService): PluginMediaService {
  const writes = Object.fromEntries(
    (Object.keys(MEDIA_WRITES) as (keyof PluginMediaWrites)[]).map(name => [
      name,
      checkedWrite(service, name),
    ])
  ) as unknown as PluginMediaWrites;
  return Object.freeze({
    ...methodFacade(service, PLUGIN_MEDIA_READS),
    ...writes,
  });
}
