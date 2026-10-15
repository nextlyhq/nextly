import type { FlowDeps } from "../flows/deps";
import { signIn } from "../flows/sign-in";
import { createAccount, writeAtVersion } from "../storage/accounts";

/** The password every test account is made with. */
export const TEST_PASSWORD = "a long passphrase";

/**
 * Makes an account with the test password, verified unless told otherwise,
 * and answers its id.
 */
export async function makeAccount(
  deps: FlowDeps,
  address: string,
  state: { verified?: boolean; deactivated?: boolean } = {}
): Promise<string> {
  const created = await createAccount(deps.db, deps.dialect, {
    address,
    name: "A",
    passwordHash: await deps.core.passwords.hash(TEST_PASSWORD),
  });
  if (created.status !== "created")
    throw new Error(`expected an account for ${address}`);
  await writeAtVersion(deps.db, created.account, {
    verifiedAt: state.verified === false ? null : new Date(),
    deactivatedAt: state.deactivated === true ? new Date() : null,
  });

  return created.account.id;
}

/** Signs the account in from a new browser, and answers the token that marks that browser known. */
export async function knownBrowserOf(
  deps: FlowDeps,
  address: string
): Promise<string> {
  const result = await signIn(deps, {
    address,
    password: TEST_PASSWORD,
    client: null,
  });
  if (result.status !== "signed-in")
    throw new Error(`expected ${address} to sign in`);

  return result.knownBrowserToken;
}
