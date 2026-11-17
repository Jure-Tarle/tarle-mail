/**
 * Senders a mailbox never gets AI reply drafts for, one rule per line:
 *   max@firma.de          exact address
 *   @newsletter.de        a domain and its subdomains (also without the @)
 *   *@*.mailchimp.com     wildcards, * matches anything
 *   /^(info|news)@/i      a regular expression between slashes
 * Blank lines and lines starting with # are ignored. Matching is case-insensitive.
 */
export type SenderRule = { source: string; test: (address: string) => boolean };

const MAX_PATTERN = 200;

function escapeRegExp(value: string): string {
	return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

/** One line as a rule, or an error message when it cannot be used. */
export function parseSenderRule(line: string): SenderRule | { error: string } | null {
	const source = line.trim();
	if (!source || source.startsWith("#")) return null;
	if (source.length > MAX_PATTERN) return { error: `Rule is longer than ${MAX_PATTERN} characters: ${source.slice(0, 40)}…` };
	const regex = /^\/(.+)\/([a-z]*)$/.exec(source);
	if (regex) {
		try {
			const pattern = new RegExp(regex[1], regex[2].includes("i") ? regex[2] : `${regex[2]}i`);
			return { source, test: (address) => pattern.test(address) };
		} catch {
			return { error: `Invalid regular expression: ${source}` };
		}
	}
	const lower = source.toLowerCase();
	if (lower.includes("*")) {
		const pattern = new RegExp(`^${lower.split("*").map(escapeRegExp).join(".*")}$`, "i");
		return { source, test: (address) => pattern.test(address) };
	}
	const at = lower.indexOf("@");
	if (at > 0) return { source, test: (address) => address === lower };
	const domain = lower.replace(/^@/, "");
	if (!domain.includes(".")) return { error: `Not an address, domain or pattern: ${source}` };
	return { source, test: (address) => { const host = address.slice(address.lastIndexOf("@") + 1); return host === domain || host.endsWith(`.${domain}`); } };
}

/** The usable rules and the lines that could not be read. */
export function parseSenderRules(text: string): { rules: SenderRule[]; errors: string[] } {
	const rules: SenderRule[] = [];
	const errors: string[] = [];
	for (const line of text.split(/\r?\n/)) {
		const parsed = parseSenderRule(line);
		if (!parsed) continue;
		if ("error" in parsed) errors.push(parsed.error);
		else rules.push(parsed);
	}
	return { rules, errors };
}

export function isSenderExcluded(address: string, text: string): boolean {
	const normalized = address.trim().toLowerCase();
	return !!normalized && parseSenderRules(text).rules.some((rule) => rule.test(normalized));
}
