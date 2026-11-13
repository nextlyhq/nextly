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
 * said to replace the rules that crawler would otherwise follow.
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

/**
 * Pages no rule written for a part of the site names, each starting
 * differently: a rule keeping a crawler from all of them keeps it from the
 * whole site, where one naming a section (`/x`) keeps it from one only.
 */
const ANY_PAGES = ["/x9q-page", "/0", "/~z"];

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
  if (colon === -1) return { line, empty: false };
  return {
    line,
    field: bare.slice(0, colon).trim(),
    value: bare.slice(colon + 1).trim(),
    empty: false,
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
  const field = read.field?.toLowerCase();
  const value = read.value ?? "";
  const current = groups.at(-1);
  if (field === "user-agent") {
    addAgent(groups, current, read);
    return;
  }
  // An empty rule allows everything, which is no rule at all; a rule before
  // any group belongs to none.
  if ((field === "allow" || field === "disallow") && current && value !== "") {
    current.rules.push({
      allow: field === "allow",
      pattern: value,
      line: read.line,
    });
  }
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
  if (group === undefined || group.rules.length > 0) {
    group = { agents: [], agentLines: [], rules: [] };
    groups.push(group);
  }
  const written = read.value ?? "";
  const agent = written.toLowerCase();
  if (agent === "") return;
  group.agents.push(agent);
  group.agentLines.push({ agent, written, line: read.line });
}

/** Whether `pattern` matches `path`, `*` matching any run and `$` the end. */
function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body
    .split("*")
    .map(part => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}${anchored ? "$" : ""}`).test(path);
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
      rule.pattern.length > deciding.pattern.length ||
      (rule.pattern.length === deciding.pattern.length && rule.allow)
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
  const { line, field, value = "" } = read;
  if (field === undefined) return notARule(line);
  const lower = field.toLowerCase();
  if (lower === "allow" || lower === "disallow") {
    return pathRuleFinding(line, value, inGroup);
  }
  if (lower === "sitemap") return sitemapFinding(line, value);
  if (lower === "user-agent") return undefined;
  return otherFieldFinding(line, field);
}

/** The refusals of a rule that keeps a guarded crawler from the home page or the site. */
function guardFindings(groups: readonly RuleGroup[]): RuleFinding[] {
  const refused = new Map<number, RuleFinding>();
  for (const { agent, name } of GUARDED) {
    const each = ANY_PAGES.map(path => blockingRule(groups, agent, path));
    const site = each.every(rule => rule !== undefined) ? each[0] : undefined;
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
 * What is said about a group naming a crawler: one the AI tools choice
 * speaks for has its choice replaced; any other named crawler follows only
 * its own group, so it skips the rules for every crawler, the plugin's
 * included.
 */
function namedFindings(groups: readonly RuleGroup[]): RuleFinding[] {
  const findings: RuleFinding[] = [];
  for (const group of groups) {
    for (const { agent, written, line } of group.agentLines) {
      if (agent === "*") continue;
      const ai = AI_NAMES.get(agent);
      if (ai !== undefined) {
        const these =
          group.rules.length === 1
            ? "this rule replaces"
            : "these rules replace";
        findings.push({
          line,
          level: "note",
          message: `Line ${line} names ${ai}, so for ${ai} ${these} the AI tools choice above${rulesSaid(group)}.`,
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
    if (parsed.field?.toLowerCase() === "user-agent") inGroup = true;
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
