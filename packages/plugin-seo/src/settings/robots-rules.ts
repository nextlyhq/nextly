/**
 * A site's own robots.txt lines, served after the plugin's own: read line by
 * line, and judged the way crawlers read the file (RFC 9309, as Google and
 * Bing apply it).
 *
 * Each line is checked as the person types and again as the value is saved
 * and served, by this one reading: a rule that keeps every crawler, Googlebot
 * or Bingbot away from the home page or the whole site is refused, since
 * robots.txt does not keep a page out of Google's index and Hide from search
 * does; a line no crawler reads is warned about; a line that is not a
 * standard rule is kept with a note; a group naming a crawler by name is
 * said to join or take the place of the rules that crawler would otherwise
 * follow.
 *
 * It imports only the crawler list, so the settings screen reads it without
 * server code.
 *
 * @module settings/robots-rules
 */
import { AI_CRAWLERS } from "../outputs/ai-crawlers";

/** The most lines the box keeps, and the longest line. */
export const MAX_OWN_RULE_LINES = 200;
const MAX_LINE_LENGTH = 500;

/** How much a finding about one line matters. */
export type FindingLevel = "refused" | "warning" | "note";

/** What the reading found about one line of the box. */
export interface RuleFinding {
  /** The line's number in the box, from 1. */
  line: number;
  level: FindingLevel;
  message: string;
}

/** One allow or disallow rule, and the line of the file it was written on. */
export interface PathRule {
  allow: boolean;
  /** The path pattern, as written: `*` for any characters, `$` for the end. */
  pattern: string;
  line: number;
}

/** One group: the crawlers it names, in lower case, and its rules. */
export interface RuleGroup {
  agents: string[];
  /** The line of each name, by name, for what is said about it. */
  agentLines: { agent: string; written: string; line: number }[];
  rules: PathRule[];
  /**
   * Whether an allow or disallow line followed its names, an empty one
   * included: a name after that starts a group of its own.
   */
  ruled?: boolean;
}

/** One line read as a `name: value` field, where it is one. */
interface ReadLine {
  line: number;
  /** The field's name as written, trimmed. */
  field?: string;
  /** The value, trimmed, without a trailing comment. */
  value?: string;
  /** Nothing but space or a comment. */
  empty: boolean;
  /**
   * The standard rule the line is read as, as Google's parser reads it:
   * a frequent misspelling or a name only begun (`Dissalow`, `Useragent`,
   * `Disallowed`) counts, so the guards judge what Google applies.
   */
  rule?: StandardField;
  /** Written with a space where the colon goes, which Google accepts. */
  noColon?: boolean;
}

/** The standard rules, by lower-case name. */
type StandardField = "user-agent" | "allow" | "disallow" | "sitemap";

/**
 * The names Google's parser reads as each standard rule: each by how it
 * begins, misspellings it accepts included (github.com/google/robotstxt,
 * robots.cc, read 2026-11-13). `disallow` is tried before `allow`, which it
 * does not begin with.
 */
const GOOGLE_NAMES: readonly (readonly [StandardField, readonly string[]])[] = [
  ["user-agent", ["user-agent", "useragent", "user agent"]],
  [
    "disallow",
    ["disallow", "dissallow", "dissalow", "disalow", "diasllow", "disallaw"],
  ],
  ["allow", ["allow"]],
  ["sitemap", ["sitemap", "site-map"]],
];

/** The standard rule Google reads a field name as, where it reads one. */
function ruleNamed(field: string): StandardField | undefined {
  const lower = field.toLowerCase();
  return GOOGLE_NAMES.find(([, names]) =>
    names.some(name => lower.startsWith(name))
  )?.[0];
}

/** The rules every robots.txt reader knows, by lower-case name. */
const STANDARD_FIELDS = ["user-agent", "allow", "disallow", "sitemap"];
const SPELLED: Record<string, string> = {
  "user-agent": "User-agent",
  allow: "Allow",
  disallow: "Disallow",
  sitemap: "Sitemap",
};

/**
 * Characters a robots.txt line cannot hold: control characters, which some
 * readers treat as an end of line, and the Unicode line breaks, which could
 * start a line the box never showed.
 */
const LINE_BREAKS = new Set([0x85, 0x2028, 0x2029]);

/** Whether `text` holds one of the characters above: a tab is not one of them. */
function holdsControl(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (
      (code < 0x20 && code !== 0x09) ||
      code === 0x7f ||
      LINE_BREAKS.has(code)
    ) {
      return true;
    }
  }
  return false;
}

/** A field's name: a letter, then letters, digits, `-` and `_`. */
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** The crawlers the refusal is judged for, and how a sentence names each. */
const GUARDED: readonly { agent: string; name: string }[] = [
  { agent: "*", name: "every crawler" },
  { agent: "googlebot", name: "Googlebot" },
  { agent: "bingbot", name: "Bingbot" },
];

/** The names of the AI crawlers the AI tools choice speaks for, in lower case. */
const AI_NAMES: ReadonlyMap<string, string> = new Map(
  AI_CRAWLERS.map(crawler => [crawler.name.toLowerCase(), crawler.name])
);

/** The lines of `text`, however its lines end. */
function linesOf(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

/** One line, read as a field where it is one. */
function readLine(text: string, line: number): ReadLine {
  const hash = text.indexOf("#");
  const bare = (hash === -1 ? text : text.slice(0, hash)).trim();
  if (bare === "") return { line, empty: true };
  const colon = bare.indexOf(":");
  if (colon === -1) {
    // Google takes a space for the colon where the line is a name and a
    // value and nothing more.
    const spaced = /^(\S+)[ \t]+(\S+)$/.exec(bare);
    const rule = spaced === null ? undefined : ruleNamed(spaced[1] ?? "");
    if (spaced === null || rule === undefined) return { line, empty: false };
    return {
      line,
      field: spaced[1] ?? "",
      value: spaced[2] ?? "",
      empty: false,
      rule,
      noColon: true,
    };
  }
  const field = bare.slice(0, colon).trim();
  const rule = ruleNamed(field);
  return {
    line,
    field,
    value: bare.slice(colon + 1).trim(),
    empty: false,
    ...(rule === undefined ? {} : { rule }),
  };
}

/** The groups of `text`: each run of User-agent lines and the rules after it. */
export function groupsOf(text: string): RuleGroup[] {
  return groupsFrom(
    linesOf(text).map((each, index) => readLine(each, index + 1))
  );
}

/** The groups of lines already read. */
function groupsFrom(lines: readonly ReadLine[]): RuleGroup[] {
  const groups: RuleGroup[] = [];
  for (const read of lines) addToGroups(groups, read);
  return groups;
}

/** `groups` with one more line read: a crawler's name, or a rule of the last group. */
function addToGroups(groups: RuleGroup[], read: ReadLine): void {
  const field = read.rule;
  const value = read.value ?? "";
  const current = groups.at(-1);
  if (field === "user-agent") {
    addAgent(groups, current, read);
    return;
  }
  // A rule before any group belongs to none.
  if ((field !== "allow" && field !== "disallow") || current === undefined) {
    return;
  }
  // Any rule ends the group's names, an empty one too, though an empty rule
  // allows everything and so adds nothing to match.
  current.ruled = true;
  if (value !== "") {
    current.rules.push({
      allow: field === "allow",
      pattern: value,
      line: read.line,
    });
  }
}

/**
 * The crawler a User-agent line names, as crawlers match it: its product
 * token, the leading letters, `_` and `-`, in lower case (RFC 9309), so
 * `Googlebot*` and `Googlebot/2.1` both name Googlebot, as Google reads
 * them; `*` names every crawler.
 */
function productToken(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("*")) return "*";
  return (/^[A-Za-z_-]+/.exec(trimmed)?.[0] ?? "").toLowerCase();
}

/**
 * A crawler's name: added to the last group while it has no rules yet, else
 * starting a group of its own.
 */
function addAgent(
  groups: RuleGroup[],
  current: RuleGroup | undefined,
  read: ReadLine
): void {
  let group = current;
  if (group === undefined || group.ruled === true) {
    group = { agents: [], agentLines: [], rules: [] };
    groups.push(group);
  }
  const written = read.value ?? "";
  const agent = productToken(written);
  if (agent === "") return;
  group.agents.push(agent);
  group.agentLines.push({ agent, written, line: read.line });
}

/** The characters a path may spell either way, encoded or not (RFC 3986). */
const UNRESERVED = /[A-Za-z0-9\-._~]/;

/**
 * A path or a rule's pattern with its encodings made one, as RFC 9309 asks
 * before they are compared: an encoded unreserved character decoded, every
 * other encoding in upper case, and any character beyond ASCII encoded as
 * UTF-8. A reserved character keeps the form it was written in, so `%2F` is
 * never a path's `/`. `*` and `$` are ASCII and pass as written.
 */
function normalizedPath(value: string): string {
  let out = "";
  for (let at = 0; at < value.length; at++) {
    const char = value[at] ?? "";
    const hex = value.slice(at + 1, at + 3);
    if (char === "%" && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      const decoded = String.fromCharCode(Number.parseInt(hex, 16));
      out += UNRESERVED.test(decoded) ? decoded : `%${hex.toUpperCase()}`;
      at += 2;
      continue;
    }
    // Read from the text itself, so a character beyond the basic plane is
    // read whole, both halves of its surrogate pair.
    const code = value.codePointAt(at) ?? 0;
    if (code > 0x7e) {
      const whole = String.fromCodePoint(code);
      out += encodeURIComponent(whole);
      at += whole.length - 1;
      continue;
    }
    out += char;
  }
  return out;
}

/**
 * Whether `pattern` matches `path`: from its start, `*` matching any run of
 * characters and a closing `$` its end. Both are normalized first. Matched
 * by the greedy two-pointer walk, which backs up only to the last `*`, so a
 * pattern of many wildcards costs at most the product of the two lengths,
 * never the exponential time a backtracking regular expression can take.
 */
function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const glob = normalizedPath(anchored ? pattern.slice(0, -1) : pattern);
  // A pattern not anchored at the end matches any path it begins.
  const wanted = anchored ? glob : `${glob}*`;
  const text = normalizedPath(path);
  let p = 0;
  let t = 0;
  let star = -1;
  let resume = 0;
  while (t < text.length) {
    if (p < wanted.length && wanted[p] !== "*" && wanted[p] === text[t]) {
      p++;
      t++;
    } else if (p < wanted.length && wanted[p] === "*") {
      star = p++;
      resume = t;
    } else if (star !== -1) {
      p = star + 1;
      t = ++resume;
    } else {
      return false;
    }
  }
  while (p < wanted.length && wanted[p] === "*") p++;
  return p === wanted.length;
}

/**
 * The rules `agent` follows: those of every group naming it, joined; or,
 * where no group names it, those of every group for every crawler (`*`).
 */
function rulesFor(groups: readonly RuleGroup[], agent: string): PathRule[] {
  const name = agent.toLowerCase();
  const named = groups.filter(group => group.agents.includes(name));
  const followed =
    named.length > 0
      ? named
      : groups.filter(group => group.agents.includes("*"));
  return followed.flatMap(group => group.rules);
}

/** How specific a rule is: the length of its pattern once normalized. */
function specificity(rule: PathRule): number {
  return normalizedPath(rule.pattern).length;
}

/**
 * The rule that keeps `agent` away from `path`, where one does: of the rules
 * it follows, the longest that matches decides, an allow winning a tie.
 */
export function blockingRule(
  groups: readonly RuleGroup[],
  agent: string,
  path: string
): PathRule | undefined {
  let deciding: PathRule | undefined;
  for (const rule of rulesFor(groups, agent)) {
    if (!matches(rule.pattern, path)) continue;
    if (
      deciding === undefined ||
      specificity(rule) > specificity(deciding) ||
      (specificity(rule) === specificity(deciding) && rule.allow)
    ) {
      deciding = rule;
    }
  }
  return deciding?.allow === false ? deciding : undefined;
}

/** The number of single-character edits between two words. */
function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = row;
  }
  return previous[b.length] ?? 0;
}

/** The standard rule a misspelt name is close to, where it is close to one. */
function meantField(field: string): string | undefined {
  const lower = field.toLowerCase();
  const squeezed = lower.replace(/[\s_-]/g, "");
  return STANDARD_FIELDS.find(
    standard =>
      squeezed === standard.replace(/-/g, "") ||
      (lower.length >= 4 && distance(lower, standard) <= 2)
  );
}

/** What is wrong with the characters of a line, if anything. */
function characterProblem(text: string, line: number): RuleFinding | undefined {
  if (holdsControl(text)) {
    return {
      line,
      level: "refused",
      message: `Line ${line} holds a character robots.txt can't carry.`,
    };
  }
  if (text.length > MAX_LINE_LENGTH) {
    return {
      line,
      level: "refused",
      message: `Line ${line} is longer than ${MAX_LINE_LENGTH} characters.`,
    };
  }
  return undefined;
}

/** The warning for a line crawlers skip, with what a rule looks like. */
function notARule(line: number): RuleFinding {
  return {
    line,
    level: "warning",
    message: `Line ${line} isn't a rule, so crawlers will skip it. A rule is a name, a colon and a value, such as Disallow: /search.`,
  };
}

/** What an allow or disallow line says: refused outside a group, warned without a path. */
function pathRuleFinding(
  line: number,
  value: string,
  inGroup: boolean
): RuleFinding | undefined {
  if (!inGroup) {
    return {
      line,
      level: "refused",
      message: `Line ${line} needs a User-agent line above it, saying which crawlers it is for.`,
    };
  }
  return value === "" || value.startsWith("/") || value.startsWith("*")
    ? undefined
    : {
        line,
        level: "warning",
        message: `Line ${line}: a path starts with /, such as /search.`,
      };
}

/** What a sitemap line says: warned unless it names a whole address. */
function sitemapFinding(line: number, value: string): RuleFinding | undefined {
  return /^https?:\/\/\S+$/i.test(value)
    ? undefined
    : {
        line,
        level: "warning",
        message: `Line ${line}: a sitemap is named by its whole address, such as https://example.com/sitemap.xml.`,
      };
}

/**
 * What a line that is not a standard rule says: a misspelt one is warned
 * about with the rule it is close to, any other kept with a note.
 */
function otherFieldFinding(line: number, field: string): RuleFinding {
  const meant = meantField(field);
  if (meant !== undefined) {
    return {
      line,
      level: "warning",
      message: `Line ${line}: "${field}" isn't a rule crawlers know, so they will skip it. Did you mean ${SPELLED[meant] ?? meant}?`,
    };
  }
  if (!FIELD_NAME.test(field)) return notARule(line);
  return {
    line,
    level: "note",
    message: `Line ${line} isn't a standard robots.txt rule. It's kept; crawlers may ignore it.`,
  };
}

/** What one line's field says on its own, whatever group it is in. */
function fieldFinding(
  read: ReadLine,
  inGroup: boolean
): RuleFinding | undefined {
  const { line, field, value = "", rule } = read;
  if (field === undefined) return notARule(line);
  if (rule === undefined) return otherFieldFinding(line, field);
  const spelling = spellingFinding(read, rule);
  if (rule === "allow" || rule === "disallow") {
    // A refusal says more than a spelling, so it wins over one.
    const found = pathRuleFinding(line, value, inGroup);
    return found?.level === "refused" ? found : (spelling ?? found);
  }
  if (rule === "sitemap") return spelling ?? sitemapFinding(line, value);
  return spelling;
}

/**
 * The warning for a rule Google reads but others may not: a name misspelt
 * or only begun, or a space where the colon goes.
 */
function spellingFinding(
  read: ReadLine,
  rule: StandardField
): RuleFinding | undefined {
  const { line, field = "" } = read;
  const spelled = SPELLED[rule] ?? rule;
  if (read.noColon === true) {
    return {
      line,
      level: "warning",
      message: `Line ${line} has no colon after ${spelled}. Google reads it as a rule; other crawlers may skip it.`,
    };
  }
  if (field.toLowerCase() === rule) return undefined;
  return {
    line,
    level: "warning",
    message: `Line ${line}: "${field}" is misspelt. Google reads it as ${spelled}; other crawlers may skip it.`,
  };
}

/** Whether a pattern matches every path: `/`, `/*` or `*`, with no end. */
function matchesEverything(pattern: string): boolean {
  // Anchored at the end, only a wildcard reaches every path (`/*$`).
  if (pattern.endsWith("$")) return /^\/?\*+$/.test(pattern.slice(0, -1));
  return /^\/?\**$/.test(pattern) && pattern !== "";
}

/**
 * A character no rule can name: a control character, which reading the box
 * refuses and the plugin's own lines never hold, and which a path keeps as
 * it is when normalized. A path spelled with it matches a pattern only
 * through that pattern's wildcards.
 */
const NAMED_BY_NO_RULE = "\u0001";

/**
 * The most general page an allow pattern opens: its wildcards and, where it
 * does not end with `$`, its end filled with a character no rule names. A
 * rule matching this page matches every page the pattern names, since only
 * its own wildcards can take that character; so where none longer closes
 * it, the allow opens a page, and where one does, it opens none.
 */
function generalPageOf(pattern: string, fresh: string): string {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const rooted = body.startsWith("/") ? body : `/${body}`;
  const filled = rooted.replaceAll("*", fresh);
  return anchored ? filled : `${filled}${fresh}`;
}

/**
 * The rule that keeps `agent` away from the whole site, where one does: a
 * disallow matching every path that no allow overrides, but one opening the
 * home page alone (`/$`), which leaves every other page blocked. A rule that
 * names part of the site is never one, however many parts are named.
 */
function wholeSiteRule(
  groups: readonly RuleGroup[],
  agent: string
): PathRule | undefined {
  const rules = rulesFor(groups, agent);
  const everything = rules.filter(
    rule => !rule.allow && matchesEverything(rule.pattern)
  );
  const widest = everything.sort((a, b) => specificity(b) - specificity(a))[0];
  if (widest === undefined) return undefined;
  // An exception counts only where it leaves a page other than the home
  // page open under the rules as crawlers apply them, judged at the most
  // general page it names. One a longer disallow overrides opens nothing.
  const opened = rules.some(rule => {
    if (!rule.allow) return false;
    const page = generalPageOf(rule.pattern, NAMED_BY_NO_RULE);
    return page !== "/" && blockingRule(groups, agent, page) === undefined;
  });
  return opened ? undefined : widest;
}

/** The refusals of a rule that keeps a guarded crawler from the home page or the site. */
function guardFindings(groups: readonly RuleGroup[]): RuleFinding[] {
  const refused = new Map<number, RuleFinding>();
  for (const { agent, name } of GUARDED) {
    const site = wholeSiteRule(groups, agent);
    const home = blockingRule(groups, agent, "/");
    const rule = site ?? home;
    if (rule === undefined || refused.has(rule.line)) continue;
    const what = site === undefined ? "the home page" : "the whole site";
    refused.set(rule.line, {
      line: rule.line,
      level: "refused",
      message: `Line ${rule.line} would keep ${name} away from ${what}, so it can't be saved. robots.txt doesn't keep pages out of Google's index anyway. To keep pages out of search, use Hide from search on a page or a content type.`,
    });
  }
  return [...refused.values()];
}

/** Paths joined for a sentence: "a", "a and b", "a, b and c". */
function joined(paths: readonly string[]): string {
  if (paths.length <= 1) return paths.join("");
  return `${paths.slice(0, -1).join(", ")} and ${paths.at(-1) ?? ""}`;
}

/** What a group's rules let a crawler do, for the sentence about it. */
function rulesSaid(group: RuleGroup): string {
  const allowed = group.rules
    .filter(rule => rule.allow)
    .map(rule => rule.pattern);
  const kept = group.rules
    .filter(rule => !rule.allow)
    .map(rule => rule.pattern);
  const parts = [
    ...(allowed.length > 0 ? [`it may read ${joined(allowed)}`] : []),
    ...(kept.length > 0
      ? [`it is asked to stay away from ${joined(kept)}`]
      : []),
  ];
  return parts.length === 0 ? "" : `: ${parts.join(" and ")}`;
}

/**
 * What is said about a group naming a crawler. A crawler joins every group
 * naming it, so one the AI tools choice speaks for follows these rules with
 * the choice's own group for it, and only an Allow opens what the choice
 * closes; any named crawler skips the rules for every crawler, the plugin's
 * included.
 */
function namedFindings(groups: readonly RuleGroup[]): RuleFinding[] {
  const findings: RuleFinding[] = [];
  for (const group of groups) {
    for (const { agent, written, line } of group.agentLines) {
      if (agent === "*") continue;
      const ai = AI_NAMES.get(agent);
      if (ai !== undefined) {
        const these = group.rules.length === 1 ? "this rule" : "these rules";
        findings.push({
          line,
          level: "note",
          message: `Line ${line} names ${ai}, so ${ai} follows ${these} joined with what the AI tools choice above asks of it, and no longer the rules for every crawler${rulesSaid(group)}. A page the choice keeps it from opens only with an Allow line.`,
        });
      } else {
        findings.push({
          line,
          level: "note",
          message: `Line ${line} names ${written}, so ${written} follows only the rules under it and skips those for every crawler, Nextly's own included.`,
        });
      }
    }
  }
  return findings;
}

/** What reading the box found: each finding, in line order, and whether any refuses. */
export interface OwnRulesRead {
  findings: RuleFinding[];
  /** Whether a finding refuses the box, so it can't be saved or served. */
  refused: boolean;
  /** The box's groups, as crawlers read them. */
  groups: RuleGroup[];
}

/** Reads the box's lines: what each says, and whether any refuses it. */
export function readOwnRules(text: string): OwnRulesRead {
  const lines = linesOf(text);
  if (lines.length > MAX_OWN_RULE_LINES) {
    return {
      findings: [
        {
          line: MAX_OWN_RULE_LINES + 1,
          level: "refused",
          message: `Keep your own rules to ${MAX_OWN_RULE_LINES} lines.`,
        },
      ],
      refused: true,
      groups: [],
    };
  }
  const findings: RuleFinding[] = [];
  const read: ReadLine[] = [];
  let inGroup = false;
  lines.forEach((each, index) => {
    const line = index + 1;
    const problem = characterProblem(each, line);
    if (problem !== undefined) {
      findings.push(problem);
      return;
    }
    const parsed = readLine(each, line);
    read.push(parsed);
    if (parsed.empty) return;
    if (parsed.rule === "user-agent") inGroup = true;
    const finding = fieldFinding(parsed, inGroup);
    if (finding !== undefined) findings.push(finding);
  });
  const groups = groupsFrom(read);
  findings.push(...guardFindings(groups), ...namedFindings(groups));
  findings.sort((a, b) => a.line - b.line);
  return {
    findings,
    refused: findings.some(finding => finding.level === "refused"),
    groups,
  };
}

/** Where the settings screen asks which sitemap pages the box's rules block. */
export const ROBOTS_RULES_CHECK_ROUTE_PATH = "/settings/robots-rules-check";

/** The pages one line of the box blocks: how many, and the first few by path. */
export interface BlockedPagesOfLine {
  line: number;
  /** The rule, as a line of robots.txt, such as `Disallow: /blog`. */
  rule: string;
  count: number;
  /** The first pages it blocks, by path. */
  examples: string[];
}

/** What the check answers for the box's text. */
export interface RobotsRulesCheckBody {
  /** Each line that blocks pages the sitemap lists, in line order. */
  lines: BlockedPagesOfLine[];
  /**
   * The key of every blocked page together, which a confirmation is saved
   * with: a rule that comes to block other pages asks again.
   */
  pagesKey: string;
}

/**
 * The header robots.txt is served with when the plugin writes it. The
 * screen reads the site's robots.txt for it: a file served without it is
 * the site's own, which wins over the plugin's.
 */
export const ROBOTS_SERVED_BY_HEADER = "x-nextly-robots";
