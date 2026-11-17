/**
 * A document's history, as the SDK hands it to a plugin.
 *
 * What these pin: every type `ctx.services.versions` takes or returns is named from the SDK, and
 * is the very type the service's signature uses, so a plugin that writes one down never imports
 * from core and never holds a copy that drifts from what the service gives it. A name missing
 * from the SDK fails to import here; a forwarded name that is not the signature's own fails the
 * equality.
 */
import { expectTypeOf } from "vitest";

import type {
  AutosaveSupersession,
  AutosaveWriteResult,
  ContentEventRecord,
  ContentEventSubject,
  PendingEditCursor,
  PendingEditOrder,
  PluginVersionsService,
  RestoreVersionResult,
  SubjectEventsQuery,
  VersionListOptions,
  VersionMeta,
  VersionRef,
  VersionRow,
  VersionStatus,
} from "@nextlyhq/plugin-sdk";

type Service = PluginVersionsService;

// Reading versions.
expectTypeOf<Parameters<Service["list"]>[0]>().toEqualTypeOf<VersionRef>();
expectTypeOf<Parameters<Service["list"]>[1]>().toEqualTypeOf<
  VersionListOptions | undefined
>();
expectTypeOf<Awaited<ReturnType<Service["list"]>>>().toEqualTypeOf<
  VersionMeta[]
>();
expectTypeOf<Awaited<ReturnType<Service["get"]>>>().toEqualTypeOf<VersionRow>();
expectTypeOf<Awaited<ReturnType<Service["getAutosave"]>>>().toEqualTypeOf<
  (VersionRow & { superseded?: AutosaveSupersession }) | undefined
>();
expectTypeOf<
  Parameters<Service["pendingEditRows"]>[0]["order"]
>().toEqualTypeOf<PendingEditOrder>();
expectTypeOf<
  Parameters<Service["pendingEditRows"]>[0]["after"]
>().toEqualTypeOf<PendingEditCursor | undefined>();
expectTypeOf<Awaited<ReturnType<Service["pendingEditRows"]>>>().toEqualTypeOf<
  VersionMeta[]
>();

// Writing: a recovery point and a restore.
expectTypeOf<
  Parameters<Service["autosave"]>[0]["status"]
>().toEqualTypeOf<VersionStatus>();
expectTypeOf<
  Awaited<ReturnType<Service["autosave"]>>
>().toEqualTypeOf<AutosaveWriteResult>();
expectTypeOf<
  Awaited<ReturnType<Service["restore"]>>
>().toEqualTypeOf<RestoreVersionResult>();

// Reading content events.
expectTypeOf<
  Parameters<Service["listEvents"]>[0]
>().toEqualTypeOf<ContentEventSubject>();
expectTypeOf<Parameters<Service["listEvents"]>[1]>().toEqualTypeOf<
  SubjectEventsQuery | undefined
>();
expectTypeOf<
  Awaited<ReturnType<Service["listEvents"]>>["items"]
>().toEqualTypeOf<ContentEventRecord[]>();
