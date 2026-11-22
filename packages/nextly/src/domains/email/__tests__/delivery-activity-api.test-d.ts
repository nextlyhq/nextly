/**
 * The Activity reads' Direct API, checked at the type level: the reads that
 * take only filters can be called with none, on the instance and on the
 * module's `nextly` singleton alike, and every type is exported from the
 * package's root.
 */

import { expectTypeOf } from "vitest";

import type { EmailDeliveriesNamespace } from "../../../direct-api/namespaces/email";
import type { nextly } from "../../../direct-api/nextly";
import type * as root from "../../../index";

type Singleton = (typeof nextly)["emailDeliveries"];

// Called with no arguments, as the namespace declares.
expectTypeOf<Singleton["find"]>().toBeCallableWith();
expectTypeOf<Singleton["findQueued"]>().toBeCallableWith();
expectTypeOf<Singleton["lastSent"]>().toBeCallableWith();
expectTypeOf<Singleton["overdue"]>().toBeCallableWith();
expectTypeOf<EmailDeliveriesNamespace["find"]>().toBeCallableWith();

// The singleton answers what the instance answers.
expectTypeOf<ReturnType<Singleton["find"]>>().toEqualTypeOf<
  ReturnType<EmailDeliveriesNamespace["find"]>
>();
expectTypeOf<ReturnType<Singleton["findQueuedByID"]>>().toEqualTypeOf<
  ReturnType<EmailDeliveriesNamespace["findQueuedByID"]>
>();

// Exported from the root, for code that names them.
expectTypeOf<root.DeliveryDetail>().toHaveProperty("timeline");
expectTypeOf<root.QueuedEmailDetail>().toHaveProperty("templateCaused");
expectTypeOf<root.TemplatesLastSent>().toHaveProperty("keptSince");
