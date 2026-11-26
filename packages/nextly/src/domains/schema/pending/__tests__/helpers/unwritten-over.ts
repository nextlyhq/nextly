/**
 * The comparison `migrate:check` asks (`unwritten`), made for a test from entities and extension
 * tables it already holds: `migrate:create`'s plan of a run against the newest snapshot in the
 * folder (`pendingChanges`), read as `nextly migrate` reads it (`compareWithNewestSnapshot`). The
 * permissions are the snapshot's own, which the cases using it do not change.
 */
import { join } from "node:path";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import {
  compareWithNewestSnapshot,
  type UnwrittenChanges,
} from "../../../migrate/unwritten-changes";
import {
  type AppStreamTables,
  NO_APP_STREAM_TABLES,
} from "../../../migrate-create/app-stream";
import type { PermissionRecord } from "../../../migrate-create/declared-permissions";
import type { MinimalConfigEntity } from "../../../migrate-create/generate";
import { loadLatestSnapshot } from "../../../migrate-create/snapshot-io";
import { pendingChanges } from "../../plan-pending";

const NO_PERMISSIONS: PermissionRecord = {
  app: {},
  plugins: {},
  collections: {},
  singles: {},
};

export function unwrittenOver(args: {
  migrationsDir: string;
  dialect?: SupportedDialect;
  collections?: readonly MinimalConfigEntity[];
  singles?: readonly MinimalConfigEntity[];
  components?: readonly MinimalConfigEntity[];
  appStream?: AppStreamTables;
}): () => Promise<UnwrittenChanges> {
  return async () => {
    const latest = await loadLatestSnapshot(join(args.migrationsDir, "meta"));
    const entities = {
      collections: [...(args.collections ?? [])],
      singles: [...(args.singles ?? [])],
      components: [...(args.components ?? [])],
    };
    const permissions = latest?.data.permissions ?? NO_PERMISSIONS;
    const pending = await pendingChanges({
      inputs: {
        ...entities,
        appStream: args.appStream ?? NO_APP_STREAM_TABLES,
        latest,
      },
      dialect: args.dialect ?? "postgresql",
      migrationsDir: args.migrationsDir,
      permissions,
    });
    return compareWithNewestSnapshot({
      pending,
      entities,
      permissions,
      latest,
    });
  };
}
