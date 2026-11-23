/**
 * Direct API `nextly.files.*`: a collection's private files, from server code.
 *
 * `download` is the same checked download as `GET /admin/api/files/:slug/:id/download`
 * (`openFile`): the entry is read as the caller the call names, through the
 * collection's checked read, a refusal and a missing or unready file are one
 * "not found", and every download writes its `file.downloaded` audit row.
 *
 * Unlike every other Direct API call, there is no unchecked default: a call
 * that names neither a `user` nor a `principal` is refused, unless it says
 * `overrideAccess: true` itself, which trusted code reading a file for no
 * caller (a job, an export) must spell out.
 *
 * @module direct-api/namespaces/files
 * @experimental
 */
import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import { runAsPrincipal } from "../../auth/principal-scope";
import { unwrapServiceResult } from "../../dispatcher/helpers/service-envelope";
import {
  openFile,
  type FileReader,
  type OpenedFile,
} from "../../domains/files/file-downloads";
import { collections } from "../../domains/files/file-uploads";
import { NextlyError } from "../../errors/nextly-error";
import { assertRunnableAsPrincipal } from "../../plugins/principals/run-as";
import type { Principal } from "../../plugins/principals/types";
import type { UserContext } from "../types/shared";

/** What a download names: the file, and who it is opened for. */
export interface FileDownloadArgs {
  /** The collection with `files`. */
  collection: string;
  /** The file's entry id. */
  id: string;
  /** The staff user it is opened for, judged by their roles and permissions. */
  user?: UserContext;
  /** For an API key's call, the key's own scope, so it is judged by it. */
  actor?: AuthenticatedScope;
  /**
   * For an API key's call, the key's id, so the audit row names the key (as
   * an API key, with `user` as its maker) rather than its maker's session.
   */
  apiKeyId?: string;
  /** A signed-in person it is opened for, from `nextly.principals`. */
  principal?: Principal;
  /** Open it for no caller. Must be said; there is no unchecked default. */
  overrideAccess?: boolean;
}

/** @experimental A collection's private files. */
export interface FilesNamespace {
  /**
   * Open a ready private file for the caller named: its bytes as a stream, or
   * a link lasting at most a minute, as the collection's `delivery` says.
   * Throws "not found" when the caller may not read it, or it does not exist
   * or is not ready.
   */
  download(args: FileDownloadArgs): Promise<OpenedFile>;
}

/** Who the download is for, refused when the call names nobody. */
function readerOf(args: FileDownloadArgs): FileReader {
  if (args.principal !== undefined) {
    // A person is judged by the rules alone: no staff user, key or
    // override beside them, as on every call made as a person.
    assertRunnableAsPrincipal(args.principal, {
      overrideAccess: args.overrideAccess,
      user: args.user,
      actor: args.actor,
    });
    return {
      type: "principal",
      principal: { kind: args.principal.kind, id: args.principal.id },
    };
  }
  if (args.user !== undefined) {
    return args.apiKeyId === undefined
      ? { type: "staff", userId: args.user.id }
      : { type: "staff", userId: args.user.id, apiKeyId: args.apiKeyId };
  }
  if (args.overrideAccess === true) return { type: "system" };
  throw NextlyError.invalidInput({
    message:
      "files.download needs the user or principal it is opened for, or overrideAccess: true for trusted code opening it for nobody.",
    logContext: { reason: "file-download-without-caller" },
  });
}

/** The entry, read as `args` names, or `null` when refused or missing. */
async function readEntryAs(
  args: FileDownloadArgs,
  reader: FileReader
): Promise<{ fileStatus?: unknown } | null> {
  const read = () =>
    collections().getEntry({
      collectionName: args.collection,
      entryId: args.id,
      depth: 0,
      overrideAccess: reader.type === "system",
      ...(args.user !== undefined && reader.type === "staff"
        ? { user: args.user }
        : {}),
      ...(args.actor !== undefined && reader.type === "staff"
        ? { authenticatedScope: args.actor }
        : {}),
    });
  const found = await runAsPrincipal(
    reader.type === "principal" ? (args.principal ?? null) : null,
    read
  );
  if (found.success) return (found.data as { fileStatus?: unknown }) ?? null;
  if (found.statusCode === 403 || found.statusCode === 404) return null;
  return unwrapServiceResult(found, {
    reason: "file-entry-not-read",
    collection: args.collection,
  });
}

export function createFilesNamespace(): FilesNamespace {
  return {
    download: async args => {
      const reader = readerOf(args);
      return openFile(
        args.collection,
        args.id,
        () => readEntryAs(args, reader),
        reader
      );
    },
  };
}
