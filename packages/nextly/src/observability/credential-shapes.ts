/**
 * Credentials recognised by their shape, whatever they are called.
 *
 * A field named `token` says what it holds; a value under `value`, `detail`
 * or a header pair's second slot says nothing, and a provider's token is
 * still recognisable there by its documented form: a JWT, a GitHub, npm or
 * Stripe key, an AWS access key id. This is the one list of those forms. The
 * audit trail refuses a metadata value that has one, and every log writer
 * takes one out of any string it writes, so the two can never come to
 * disagree about what a credential looks like.
 *
 * Not a general secret detector, and not trying to be: each entry is the
 * documented shape of a token Nextly or a plugin could hold and pass along by
 * accident. A value with no such shape under a name that says nothing (an
 * opaque session id in `value`) cannot be told from ordinary data, and is not
 * guessed at.
 *
 * @module observability/credential-shapes
 */

/** How a whole value is held to a shape's token. */
type WholeValueRule = "is" | "starts" | "contains";

/** How a shape's token is searched for in running text. */
interface InTextRule {
  /**
   * The shortest match taken out, chosen from the credential's documented
   * form: a shorter one is a bare prefix named in prose (`whsec_`,
   * `sk_live_`) or a word that happens to begin like one (`xoxo-gossip`).
   */
  minLength: number;
  /**
   * Characters that may not sit directly before the token, besides a word
   * character, which none may. A JWT's own alphabet holds `-`, so one glued
   * to a word by `-` cannot be told from a longer first part of it; and a
   * long run of dashed words is then tried once, from its start, rather than
   * from every dash in it, which cost a long line its length squared.
   */
  notAfter?: string;
}

/**
 * One credential's documented form. `token` is the credential's own
 * characters as an unanchored, case-sensitive pattern; the whole-value test
 * and the search in running text are both derived from it, so they cannot
 * drift apart. `accept`, when given, is a further test of a match that a
 * pattern cannot express, held by both uses alike.
 */
type CredentialShape =
  | {
      token: string;
      value: WholeValueRule;
      accept?: (token: string) => boolean;
      inText: InTextRule;
    }
  | {
      token: string;
      value: WholeValueRule;
      accept?: (token: string) => boolean;
      /** Matched in any letter case; only for a shape not searched in text. */
      ignoreCase?: boolean;
      /** Not searched in text: text redaction reads it by a rule of its own. */
      inText: false;
    };

/** A base64url character, as a JWT's three parts are written. */
const B64URL = "[A-Za-z0-9_-]";

/**
 * A JWT: three base64url segments separated by dots. One definition, used on
 * its own and inside a token that embeds one.
 */
const JWT_TOKEN = `${B64URL}{8,}\\.${B64URL}{8,}\\.${B64URL}{8,}`;

/**
 * The longest JWT header read, in base64url characters (12 KiB decoded).
 * Ordinary headers are tens of characters; one carrying a certificate chain
 * (`x5c`) runs to a few thousand. A longer first part is not decoded, so a
 * hostile line costs a bounded step for each part it holds.
 */
const MAX_JOSE_HEADER_LENGTH = 16_384;

/** UTF-8 as RFC 7519 requires a JWT's header to be, refusing anything else. */
const UTF8 = new TextDecoder("utf-8", { fatal: true });

/**
 * Whether a JWT-shaped token's first part is a JOSE header: base64url for the
 * UTF-8 of a JSON object (RFC 7519, section 7.2) with a string `alg` member,
 * which RFC 7515 (section 4.1.1) and RFC 7516 say MUST be present, `"none"`
 * for an unsecured JWT included. Read by decoding rather than by how its
 * encoding starts, since JSON allows whitespace after the brace: `{ "alg"`
 * encodes to `eyAi` and a brace and a line break to `ewo`. A dotted name,
 * a version or a cursor whose first part is any other value is not one.
 */
function hasJoseHeader(token: string): boolean {
  const encoded = token.slice(0, token.indexOf("."));
  if (encoded.length > MAX_JOSE_HEADER_LENGTH) return false;
  let header: unknown;
  try {
    const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    header = JSON.parse(UTF8.decode(bytes));
  } catch {
    return false;
  }
  return (
    typeof header === "object" &&
    header !== null &&
    !Array.isArray(header) &&
    typeof (header as { alg?: unknown }).alg === "string"
  );
}

/**
 * The shortest token text redaction takes out for a shape whose every
 * documented credential is longer: each of the prefix-led shapes below says
 * how much longer. Twenty keeps a bare prefix and a word that begins like one
 * readable, and is below the shortest real token of each.
 */
const MIN_PREFIXED_TOKEN = 20;

/**
 * Every recognised shape. The user documentation lists the audit trail's set
 * exactly, so this promises what it does and no more.
 */
const CREDENTIAL_SHAPES: readonly CredentialShape[] = [
  // A JWT: three base64url segments separated by dots, the first a JOSE
  // header. A dotted name such as `plugin-accounts.identity.unlinked` has
  // three long parts too, and its first part decodes to no JSON. In text it
  // is a whole base64url run; its pattern's own floor is 26 characters.
  {
    token: JWT_TOKEN,
    value: "is",
    accept: hasJoseHeader,
    inText: { minLength: 26, notAfter: "-" },
  },
  // An HTTP authorization value carrying its scheme. In text, the `Bearer`
  // and `Basic` rule beside the other text rules reads it, keeping the scheme.
  {
    token: "(?:bearer|basic)\\s+\\S",
    value: "starts",
    ignoreCase: true,
    inText: false,
  },
  // A PEM private key or certificate block. In text the block is taken to its
  // end line, or to the end of the text when that never comes, so the key's
  // body goes with its header; a whole value has the shape wherever the
  // header sits, since the rest may match nothing. A header alone, with
  // nothing after it, is named in prose rather than holding a key.
  {
    token:
      "-----BEGIN [A-Z ]+-----(?:[\\s\\S]*?-----END [A-Z ]+-----|[\\s\\S]*)",
    value: "contains",
    inText: { minLength: MIN_PREFIXED_TOKEN },
  },
  // Stripe secret and restricted keys: the prefix and 24 characters or more.
  {
    token: "(?:sk|rk)_(?:live|test)_[A-Za-z0-9]*",
    value: "starts",
    inText: { minLength: MIN_PREFIXED_TOKEN },
  },
  // Webhook signing secrets: `whsec_` and base64 key bytes. The webhook
  // signer accepts a key of one byte, two characters (`whsec_YQ`), so a
  // shorter floor than the other prefixes: the prefix alone stays readable.
  {
    token: "whsec_[A-Za-z0-9+/=]*",
    value: "starts",
    inText: { minLength: "whsec_".length + 2 },
  },
  // A stateless GitHub App installation token, `ghs_<APPID>_<JWT>`: the app's
  // id, an underscore, then a whole JWT, taken as one token so neither the id
  // nor the JWT is left behind. GitHub's documented characters for it are
  // letters, digits, `.`, `-` and `_`; the id holds neither separator, the
  // `_` before the JWT nor the JWT's `.`. Its pattern's floor is 32.
  {
    token: `ghs_[A-Za-z0-9-]+_${JWT_TOKEN}`,
    value: "starts",
    inText: { minLength: MIN_PREFIXED_TOKEN },
  },
  // GitHub tokens: personal, OAuth, user-to-server, server-to-server, refresh,
  // and fine-grained personal; 40 and 93 characters.
  {
    token: "gh[pousr]_[A-Za-z0-9]{20,}",
    value: "starts",
    inText: { minLength: MIN_PREFIXED_TOKEN },
  },
  {
    token: "github_pat_[A-Za-z0-9_]*",
    value: "starts",
    inText: { minLength: MIN_PREFIXED_TOKEN },
  },
  // GitLab personal access tokens: the prefix and 20 characters or more.
  {
    token: "glpat-[A-Za-z0-9_-]*",
    value: "starts",
    inText: { minLength: MIN_PREFIXED_TOKEN },
  },
  // Slack bot, user and other `xox?-` tokens: dash-separated ids and a
  // secret, 50 characters or more.
  {
    token: "xox[abposre]-[A-Za-z0-9-]*",
    value: "starts",
    inText: { minLength: MIN_PREFIXED_TOKEN },
  },
  // AWS access key ids, long-term and temporary: exactly 20 characters.
  {
    token: "(?:AKIA|ASIA)[A-Z0-9]{16}",
    value: "is",
    inText: { minLength: MIN_PREFIXED_TOKEN },
  },
  // Google OAuth access tokens: well over a hundred characters.
  {
    token: "ya29\\.[A-Za-z0-9_-]*",
    value: "starts",
    inText: { minLength: MIN_PREFIXED_TOKEN },
  },
  // npm tokens: 40 characters.
  {
    token: "npm_[A-Za-z0-9]{20,}",
    value: "starts",
    inText: { minLength: MIN_PREFIXED_TOKEN },
  },
];

/** A shape's whole-value test: its token anchored as its rule says, then `accept`. */
function wholeValueTest(shape: CredentialShape): (value: string) => boolean {
  const anchored =
    shape.value === "is"
      ? `^(?:${shape.token})$`
      : shape.value === "starts"
        ? `^(?:${shape.token})`
        : shape.token;
  const ignoreCase = shape.inText === false && shape.ignoreCase === true;
  const pattern = new RegExp(anchored, ignoreCase ? "i" : "");
  const { accept } = shape;
  return value => {
    const match = pattern.exec(value);
    return match !== null && (accept === undefined || accept(match[0]));
  };
}

const WHOLE_VALUE_TESTS: readonly ((value: string) => boolean)[] =
  CREDENTIAL_SHAPES.map(wholeValueTest);

/** Whether a value has one of the credential shapes. */
export function looksLikeSecret(value: string): boolean {
  return WHOLE_VALUE_TESTS.some(test => test(value));
}

/** A shape as text is searched for it. */
interface TextShape {
  /** Sticky: matches only where `lastIndex` is set. */
  pattern: RegExp;
  minLength: number;
  accept?: (token: string) => boolean;
}

/**
 * A shape's token as text is searched for it. A token is matched whole: no
 * word character may sit on either side of it, so `job_ghp_…` or a longer
 * run of capitals holding `AKIA…` is part of a word, not a credential.
 */
function inTextSource(token: string, rule: InTextRule): string {
  return `(?<![A-Za-z0-9_${rule.notAfter ?? ""}])(?:${token})(?![A-Za-z0-9_])`;
}

const TEXT_SHAPES: readonly TextShape[] = CREDENTIAL_SHAPES.flatMap(shape =>
  shape.inText === false
    ? []
    : [
        {
          pattern: new RegExp(inTextSource(shape.token, shape.inText), "y"),
          minLength: shape.inText.minLength,
          accept: shape.accept,
        },
      ]
);

/**
 * Where in text any shape's pattern matches, before its length and `accept`
 * are asked. Every shape's pattern is one alternative, so a single scan finds
 * each place worth a closer look.
 */
const CANDIDATE_IN_TEXT = new RegExp(
  CREDENTIAL_SHAPES.flatMap(shape =>
    shape.inText === false ? [] : [inTextSource(shape.token, shape.inText)]
  ).join("|"),
  "g"
);

/**
 * The credential starting at `at` in `text`, or none: the first shape, in
 * list order, whose pattern matches there and whose match is long enough and
 * accepted. Asked of every shape, so one shape's refusal at a place never
 * hides another's credential there.
 */
function credentialAt(text: string, at: number): string | undefined {
  for (const shape of TEXT_SHAPES) {
    shape.pattern.lastIndex = at;
    const token = shape.pattern.exec(text)?.[0];
    if (
      token !== undefined &&
      token.length >= shape.minLength &&
      (shape.accept === undefined || shape.accept(token))
    ) {
      return token;
    }
  }
  return undefined;
}

/**
 * `text` with every token that has a credential's shape replaced by `marker`,
 * and every other character as it was. A place refused is passed by one
 * character, so a credential starting later inside what its pattern matched
 * (a JWT after a dotted name's first part) is still found.
 */
export function redactCredentialTokens(text: string, marker: string): string {
  const candidates = new RegExp(CANDIDATE_IN_TEXT.source, "g");
  let out = "";
  let from = 0;
  for (
    let found = candidates.exec(text);
    found;
    found = candidates.exec(text)
  ) {
    const token = credentialAt(text, found.index);
    if (token === undefined) {
      candidates.lastIndex = found.index + 1;
      continue;
    }
    out += `${text.slice(from, found.index)}${marker}`;
    from = found.index + token.length;
    candidates.lastIndex = from;
  }
  return out + text.slice(from);
}
