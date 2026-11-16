import type { TranslationKey } from "@/lib/i18n/types";
import type { CommandItem } from "./types";

const NO_MATCH = -1;

function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Scores how well `query` matches `text` (both already normalized), or -1 for no match.
 * Exact beats prefix beats word-start beats substring beats in-order letters ("cmp" in "compose").
 */
function scoreText(text: string, query: string): number {
  if (text === query) return 100;
  if (text.startsWith(query)) return 90;
  const index = text.indexOf(query);
  if (index >= 0) {
    const wordStart = /[^\p{L}\p{N}]/u.test(text[index - 1] ?? " ");
    return (wordStart ? 80 : 60) - Math.min(index, 19) / 2;
  }

  let position = 0;
  let previous = -1;
  let skipped = 0;
  for (const char of query) {
    const found = text.indexOf(char, position);
    if (found < 0) return NO_MATCH;
    skipped += previous < 0 ? found : found - previous - 1;
    previous = found;
    position = found + 1;
  }
  // Letters scattered far apart across a long text are noise, not a match.
  return skipped > query.length * 3 ? NO_MATCH : 40 - skipped;
}

// A title hit outranks a hit in the subtitle, keywords or category.
function scoreCommand(cmd: CommandItem, token: string): number {
  const scores = [
    scoreText(normalize(cmd.title), token),
    scoreText(normalize(cmd.subtitle ?? ""), token) * 0.5,
    scoreText(normalize(cmd.category), token) * 0.4,
    ...(cmd.keywords ?? []).map((keyword) => scoreText(normalize(keyword), token) * 0.6),
  ];
  return Math.max(...scores);
}

/**
 * Filters commands by a fuzzy match on title, subtitle, category and keywords, best match first.
 * Every whitespace-separated word of the query has to match; an empty query keeps the order.
 */
export function filterCommands(commands: CommandItem[], query: string): CommandItem[] {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return commands;

  return commands
    .map((cmd, index) => {
      const scores = tokens.map((token) => scoreCommand(cmd, token));
      const score = scores.some((value) => value <= 0) ? NO_MATCH : scores.reduce((sum, value) => sum + value, 0);
      return { cmd, index, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.cmd);
}

/**
 * Group commands by their category string, groups in order of their first command.
 */
export function groupCommandsByCategory(
  commands: CommandItem[]
): Record<string, CommandItem[]> {
  return commands.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, CommandItem[]>);
}

/** The commands in the order they are listed, which is what arrow keys and Enter walk. */
export function flattenGroups(grouped: Record<string, CommandItem[]>): CommandItem[] {
  return Object.values(grouped).flat();
}

/** Translation key of a category heading; Admin and Search reuse labels that already exist. */
export function commandCategoryKey(category: string): TranslationKey {
  if (category === "Admin") return "account.admin";
  if (category === "Search") return "search.mail";
  return `shortcut.category.${category}` as TranslationKey;
}
