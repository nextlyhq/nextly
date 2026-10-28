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

/**
 * One credential's documented form. `token` is the credential's own
 * characters as an unanchored, case-sensitive pattern; the whole-value test
 * and the search in running text are both derived from it, so they cannot
 * drift apart.
 */
type CredentialShape =
  | {
      token: string;
      value: WholeValueRule;
      /**
       * Searched for in running text. `lead`, when given, is a further
       * condition on how the token starts there, narrowing it where a looser
       * match would catch ordinary words.
       */
      inText: { lead?: string };
    }
  | {
      token: string;
      value: WholeValueRule;
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
 * Every recognised shape. The user documentation lists the audit trail's set
 * exactly, so this promises what it does and no more.
 */
const CREDENTIAL_SHAPES: readonly CredentialShape[] = [
  // A JWT: three base64url segments separated by dots. In text it must also
  // start as one does, its header a JSON object (`{"` encodes to `eyJ`): a
  // dotted name such as `plugin-accounts.identity.unlinked` has three long
  // parts too.
  {
    token: JWT_TOKEN,
    value: "is",
    inText: { lead: "eyJ" },
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
  // header sits, since the rest may match nothing.
  {
    token:
      "-----BEGIN [A-Z ]+-----(?:[\\s\\S]*?-----END [A-Z ]+-----|[\\s\\S]*)",
    value: "contains",
    inText: {},
  },
  // Stripe secret and restricted keys, and webhook signing secrets.
  {
    token: "(?:sk|rk)_(?:live|test)_[A-Za-z0-9]*",
    value: "starts",
    inText: {},
  },
  { token: "whsec_[A-Za-z0-9+/=]*", value: "starts", inText: {} },
  // A stateless GitHub App installation token, `ghs_<APPID>_<JWT>`: the app's
  // id, an underscore, then a whole JWT, taken as one token so neither the id
  // nor the JWT is left behind. GitHub's documented characters for it are
  // letters, digits, `.`, `-` and `_`; the id holds neither separator, the
  // `_` before the JWT nor the JWT's `.`.
  {
    token: `ghs_[A-Za-z0-9-]+_${JWT_TOKEN}`,
    value: "starts",
    inText: {},
  },
  // GitHub tokens: personal, OAuth, user-to-server, server-to-server, refresh,
  // and fine-grained personal.
  { token: "gh[pousr]_[A-Za-z0-9]{20,}", value: "starts", inText: {} },
  { token: "github_pat_[A-Za-z0-9_]*", value: "starts", inText: {} },
  // GitLab personal access tokens.
  { token: "glpat-[A-Za-z0-9_-]*", value: "starts", inText: {} },
  // Slack bot, user and other `xox?-` tokens.
  { token: "xox[abposre]-[A-Za-z0-9-]*", value: "starts", inText: {} },
  // AWS access key ids, long-term and temporary.
  { token: "(?:AKIA|ASIA)[A-Z0-9]{16}", value: "is", inText: {} },
  // Google OAuth access tokens.
  { token: "ya29\\.[A-Za-z0-9_-]*", value: "starts", inText: {} },
  // npm tokens.
  { token: "npm_[A-Za-z0-9]{20,}", value: "starts", inText: {} },
];

/** Each shape's token anchored as its whole-value rule says. */
const WHOLE_VALUE_SHAPES: readonly RegExp[] = CREDENTIAL_SHAPES.map(shape => {
  const anchored =
    shape.value === "is"
      ? `^(?:${shape.token})$`
      : shape.value === "starts"
        ? `^(?:${shape.token})`
        : shape.token;
  const ignoreCase = shape.inText === false && shape.ignoreCase === true;
  return new RegExp(anchored, ignoreCase ? "i" : "");
});

/** Whether a value has one of the credential shapes. */
export function looksLikeSecret(value: string): boolean {
  return WHOLE_VALUE_SHAPES.some(shape => shape.test(value));
}

/** A shape's token as text is searched for it, or none for a shape that isn't. */
function inTextPattern(shape: CredentialShape): string[] {
  if (shape.inText === false) return [];
  const lead = shape.inText.lead ? `(?=${shape.inText.lead})` : "";
  return [`${lead}(?:${shape.token})`];
}

/**
 * Every shape searched for in text, as one pattern. A token is matched whole:
 * no word character may sit on either side of it, so `job_ghp_…` or a longer
 * run of capitals holding `AKIA…` is part of a word, not a credential.
 */
const CREDENTIAL_TOKEN_IN_TEXT = new RegExp(
  `(?<![A-Za-z0-9_])(?:${CREDENTIAL_SHAPES.flatMap(inTextPattern).join("|")})(?![A-Za-z0-9_])`,
  "g"
);

/**
 * The shortest token text redaction takes out. Every documented credential is
 * longer; a shorter match is a prefix named in prose ("secrets start with
 * `whsec_`") or a word that happens to begin like one (`xoxo-gossip`).
 */
const MIN_TOKEN_IN_TEXT = 20;

/**
 * `text` with every token that has a credential's shape replaced by `marker`,
 * and every other character as it was.
 */
export function redactCredentialTokens(text: string, marker: string): string {
  return text.replace(CREDENTIAL_TOKEN_IN_TEXT, token =>
    token.length >= MIN_TOKEN_IN_TEXT ? marker : token
  );
}
