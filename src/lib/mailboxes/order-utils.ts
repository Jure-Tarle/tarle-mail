/** Puts mailboxes in the user's chosen order; ones the order does not mention keep their order after it. */
export function sortByMailboxOrder<T extends { id: string }>(rows: T[], order: readonly string[]): T[] {
	if (order.length === 0) return rows;
	const rank = new Map(order.map((id, index) => [id, index]));
	return rows
		.map((row, index) => ({ row, index }))
		.sort((a, b) => (rank.get(a.row.id) ?? order.length + a.index) - (rank.get(b.row.id) ?? order.length + b.index))
		.map(({ row }) => row);
}

/** Reads a stored order defensively: anything but an array of strings counts as no order. */
export function parseMailboxOrder(value: string | null | undefined): string[] {
	if (!value) return [];
	try {
		const parsed: unknown = JSON.parse(value);
		return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
	} catch {
		return [];
	}
}

const HEX_COLOR = /^#[0-9a-f]{6}$/;

/** Whether a value is a colour this app stores: lowercase "#rrggbb". */
export function isMailboxColor(value: unknown): value is string {
	return typeof value === "string" && HEX_COLOR.test(value);
}

/** Reads stored mailbox colours defensively, keeping only mailbox ids mapped to valid colours. */
export function parseMailboxColors(value: string | null | undefined): Record<string, string> {
	if (!value) return {};
	try {
		const parsed: unknown = JSON.parse(value);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => isMailboxColor(entry[1])));
	} catch {
		return {};
	}
}
