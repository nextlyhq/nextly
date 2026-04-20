// Tiny typed client for the Mailpit HTTP API used by the E2E tests.
// Docs: https://mailpit.axllent.org/docs/api-v1/
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";

export interface MailpitMessageSummary {
  ID: string;
  From: { Address: string; Name: string };
  To: { Address: string; Name: string }[];
  Subject: string;
  Created: string;
}

export interface MailpitMessageFull extends MailpitMessageSummary {
  Text: string;
  HTML: string;
}

export async function listMessages(): Promise<MailpitMessageSummary[]> {
  const res = await fetch(`${MAILPIT}/api/v1/messages?limit=50`);
  if (!res.ok) throw new Error(`mailpit list failed: ${res.status}`);
  const body = await res.json();
  return body.messages ?? [];
}

export async function getMessage(id: string): Promise<MailpitMessageFull> {
  const res = await fetch(`${MAILPIT}/api/v1/message/${id}`);
  if (!res.ok) throw new Error(`mailpit get failed: ${res.status}`);
  return res.json();
}

export async function clearInbox(): Promise<void> {
  const res = await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });
  if (!res.ok) throw new Error(`mailpit clear failed: ${res.status}`);
}

// Poll the inbox until a message to `toAddress` arrives. Returns the first
// match. Throws after `timeoutMs`.
export async function waitForMessageTo(
  toAddress: string,
  timeoutMs = 15000
): Promise<MailpitMessageFull> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = await listMessages();
    const match = messages.find(m =>
      m.To.some(t => t.Address.toLowerCase() === toAddress.toLowerCase())
    );
    if (match) return getMessage(match.ID);
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`no email to ${toAddress} within ${timeoutMs}ms`);
}

// Extract the first URL in the message body (text or html) matching the
// predicate. Useful for grabbing the verification or reset link.
export function extractLink(
  msg: MailpitMessageFull,
  predicate: (url: string) => boolean
): string {
  const bodies = [msg.Text, msg.HTML].join("\n");
  const urls = bodies.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  const match = urls.find(predicate);
  if (!match) throw new Error(`no link matching predicate in message`);
  return match;
}
