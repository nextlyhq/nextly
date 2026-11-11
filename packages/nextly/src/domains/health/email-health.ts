/**
 * The email line of System health: which provider sends the site's email, by
 * its label only ("Resend", "SMTP"), never its configuration or sender.
 *
 * The provider is the one a send without a named provider uses
 * (`EmailService.resolveProvider`): the stored default when it is on, else the
 * provider set in the site's code. The stored default is read by its type and
 * whether it is on, and nothing else, so no configuration is decrypted for it.
 * No provider at all is `null`, and the card says so; in production that is a
 * warning, since the site's password resets and invitations go nowhere.
 *
 * @module domains/health/email-health
 */

import { eq } from "drizzle-orm";

import { loadedDialect } from "../../database/dialect-tables";
import { getEmailProviderRegistry } from "../email/services/email-provider-registry";

import type { EmailHealth } from "./health-types";

export type { EmailHealth } from "./health-types";

/** The select chain this read makes, in the form all three dialects share. */
interface ProvidersDb {
  select: (fields: Record<string, unknown>) => {
    from: (table: unknown) => {
      where: (clause: unknown) => {
        limit: (n: number) => Promise<Record<string, unknown>[]>;
      };
    };
  };
}

/** A provider type's label, as the registry names it, or the type itself. */
function providerLabel(type: string): string {
  const registry = getEmailProviderRegistry();
  return registry.has(type) ? registry.get(type).label : type;
}

/**
 * The email line for the database `db` reaches.
 *
 * @param codeProvider - The type of the provider set in the site's code, if any
 */
export async function readEmailHealth(
  db: unknown,
  dialect: "postgresql" | "mysql" | "sqlite",
  codeProvider: string | undefined
): Promise<EmailHealth> {
  const { emailProviders: providers } = loadedDialect(dialect).tables;
  const [stored] = await (db as ProvidersDb)
    .select({ type: providers.type, isActive: providers.isActive })
    .from(providers)
    .where(eq(providers.isDefault, true))
    .limit(1);
  if (
    stored !== undefined &&
    Boolean(stored.isActive) &&
    typeof stored.type === "string"
  ) {
    return { provider: providerLabel(stored.type) };
  }
  if (codeProvider !== undefined && codeProvider !== "") {
    return { provider: providerLabel(codeProvider) };
  }
  return { provider: null };
}
