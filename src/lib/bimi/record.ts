// BIMI (Brand Indicators for Message Identification): a TXT record at default._bimi.<domain>
// points to a square SVG logo that mail apps show next to mail from the domain once its DMARC
// policy is enforced. Gmail and Apple Mail additionally require a VMC or CMC certificate (the a=
// tag); this app shows logos without checking one.

export type BimiRecord = {
	/** The https address in l=; null when the domain declines a logo (empty l=). */
	logoUrl: string | null;
	/** The certificate address in a=, kept when this app rewrites a record. */
	authorityUrl: string | null;
};

export const isBimiRecord = (content: string) => /^\s*v\s*=\s*BIMI1\s*(?:;|$)/i.test(content);

/** DNS tools quote TXT values; the quotes are not part of the record. */
export function unquoteTxt(content: string): string {
	const chunks = content.match(/"([^"]*)"/g);
	return chunks ? chunks.map((chunk) => chunk.slice(1, -1)).join("") : content.trim();
}

function tags(record: string): Map<string, string> {
	const result = new Map<string, string>();
	for (const part of record.split(";")) {
		const index = part.indexOf("=");
		if (index <= 0) continue;
		const name = part.slice(0, index).trim().toLowerCase();
		if (name && !result.has(name)) result.set(name, part.slice(index + 1).trim());
	}
	return result;
}

export function parseBimiRecord(content: string): BimiRecord | null {
	if (!isBimiRecord(content)) return null;
	const parsed = tags(content);
	return {
		logoUrl: parsed.get("l")?.split(",")[0].trim() || null,
		authorityUrl: parsed.get("a")?.trim() || null,
	};
}

export function buildBimiRecord(logoUrl: string, authorityUrl?: string | null): string {
	return `v=BIMI1; l=${logoUrl};${authorityUrl ? ` a=${authorityUrl};` : ""}`;
}

/**
 * BIMI logos are shown only for mail under an enforced DMARC policy: p=quarantine or p=reject,
 * applied to all mail (no pct below 100). For a subdomain the record of its organizational domain
 * counts with its sp= tag, when there is one.
 */
export function dmarcEnforced(record: string | null, options: { subdomain?: boolean } = {}): boolean {
	if (!record || !/^\s*v\s*=\s*DMARC1\s*(?:;|$)/i.test(record)) return false;
	const parsed = tags(record);
	const policy = (options.subdomain ? (parsed.get("sp") ?? parsed.get("p")) : parsed.get("p"))?.toLowerCase();
	return (policy === "quarantine" || policy === "reject") && (parsed.get("pct") ?? "100") === "100";
}

/** Where the logo this app publishes for a domain is served from. */
export const publicLogoUrl = (origin: string, hostname: string) => `${origin.replace(/\/+$/, "")}/bimi/${hostname.toLowerCase()}.svg`;

/** The hostname behind a /bimi/<hostname>.svg path segment, or null for anything else. */
export function logoFileHostname(file: string): string | null {
	const match = /^([a-z0-9.-]{1,253})\.svg$/i.exec(file);
	return match ? match[1].toLowerCase() : null;
}
