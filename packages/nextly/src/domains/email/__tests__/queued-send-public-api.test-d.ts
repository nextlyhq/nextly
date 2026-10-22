/**
 * The queued send's public types, checked at the type level.
 *
 * `queue` and `queueWithTemplate` promise every option their send takes, on
 * every surface that offers them, and a plugin may pass its transaction. A
 * runtime test cannot see a narrowed option or a surface whose declaration
 * dropped one, so these are stated exactly here.
 */

import { expectTypeOf } from "vitest";

import type {
  QueuedEmail,
  QueuedEmailState,
  QueueEmailArgs,
  QueueTemplateEmailArgs,
  SendEmailArgs,
  SendTemplateEmailArgs,
} from "../../../direct-api/types";
import type * as root from "../../../index";
import type { Nextly } from "../../../init/nextly-instance";
import type { PluginTransaction } from "../../../plugins/database/plugin-database";
import type { PluginEmailService } from "../../../plugins/plugin-context";
import type { EmailService } from "../services/email-service";

// Every option a send takes, and no other.
expectTypeOf<QueueEmailArgs>().toEqualTypeOf<SendEmailArgs>();
expectTypeOf<QueueTemplateEmailArgs>().toEqualTypeOf<SendTemplateEmailArgs>();

// The result names the email and where it stands, in the five states.
expectTypeOf<QueuedEmail>().toEqualTypeOf<{
  id: string;
  state: QueuedEmailState;
}>();
expectTypeOf<QueuedEmailState>().toEqualTypeOf<
  "waiting" | "sending" | "sent" | "failed" | "cancelled"
>();

// The package root exports the same types.
expectTypeOf<root.QueueEmailArgs>().toEqualTypeOf<QueueEmailArgs>();
expectTypeOf<root.QueueTemplateEmailArgs>().toEqualTypeOf<QueueTemplateEmailArgs>();
expectTypeOf<root.QueuedEmail>().toEqualTypeOf<QueuedEmail>();

// The instance a site's code holds offers both, as `send` is offered.
expectTypeOf<Nextly["email"]["queue"]>().toEqualTypeOf<
  (args: QueueEmailArgs) => Promise<QueuedEmail>
>();
expectTypeOf<Nextly["email"]["queueWithTemplate"]>().toEqualTypeOf<
  (args: QueueTemplateEmailArgs) => Promise<QueuedEmail>
>();

// A plugin queues with every option of its own send, plus its transaction.
type PluginQueueOptions = Parameters<PluginEmailService["queue"]>[0];
expectTypeOf<PluginQueueOptions>().toEqualTypeOf<
  Omit<Parameters<EmailService["send"]>[0], "templateSlug"> & {
    tx?: PluginTransaction;
  }
>();
type PluginTemplateOptions = NonNullable<
  Parameters<PluginEmailService["queueWithTemplate"]>[3]
>;
expectTypeOf<PluginTemplateOptions>().toEqualTypeOf<
  NonNullable<Parameters<EmailService["sendWithTemplate"]>[3]> & {
    tx?: PluginTransaction;
  }
>();
expectTypeOf<ReturnType<PluginEmailService["queue"]>>().toEqualTypeOf<
  Promise<QueuedEmail>
>();
