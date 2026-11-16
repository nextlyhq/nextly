/**
 * The one request a bot check makes: the visitor's token, with the site's
 * secret, to the provider's verification endpoint, answered with what the
 * provider said. Its own module so the request is made in one place, and so a
 * test can stand in for the provider.
 *
 * @module handlers/bot-check-send
 */

/** The bot-check providers a form can use. */
export type BotProvider = "recaptcha" | "turnstile";

/** Where each provider verifies a token. */
const VERIFY_URLS: Readonly<Record<BotProvider, string>> = {
  recaptcha: "https://www.google.com/recaptcha/api/siteverify",
  turnstile: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
};

/** The hosts those requests go to, for the plugin's outbound allowlist. */
export const VERIFY_HOSTS: Readonly<Record<BotProvider, string>> = {
  recaptcha: "www.google.com",
  turnstile: "challenges.cloudflare.com",
};

/** A fetch the plugin may use: core's `ctx.fetch`, held to its allowlist. */
export type VerifyFetch = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Ask `provider` whether `token` is good, as both providers take it: a form
 * post of the secret, the token and, where known, the visitor's address.
 * Answers the provider's JSON; throws when it could not be reached or did
 * not answer 200.
 */
export async function sendVerification(
  fetch: VerifyFetch,
  provider: BotProvider,
  request: { secret: string; token: string; ip?: string }
): Promise<unknown> {
  const body = new URLSearchParams({
    secret: request.secret,
    response: request.token,
    ...(request.ip ? { remoteip: request.ip } : {}),
  });
  const response = await fetch(VERIFY_URLS[provider], {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!response.ok) {
    throw new Error(`${provider} verification answered ${response.status}`);
  }
  return response.json();
}
