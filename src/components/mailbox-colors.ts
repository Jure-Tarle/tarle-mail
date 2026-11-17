import type { MailboxOption } from "./mailbox-provider";

/**
 * Account colours for telling mailboxes apart in a combined list, as Mailbird, Mimestream and
 * Thunderbird do. Mid-tone hues read on both light and dark surfaces.
 */
export const MAILBOX_PALETTE = ["#2563eb", "#059669", "#d97706", "#7c3aed", "#db2777", "#0891b2", "#ea580c", "#64748b"];

function hash(value: string): number {
	let result = 0;
	for (let index = 0; index < value.length; index++) result = (result * 31 + value.charCodeAt(index)) >>> 0;
	return result;
}

/**
 * A colour per mailbox: the user's own choice, otherwise automatic. Each automatic one starts from a hash of its id and takes the next free colour
 * on a clash, so a mailbox keeps its colour when the list is re-sorted and colours only repeat
 * beyond eight mailboxes.
 */
export function getMailboxColors(mailboxes: Pick<MailboxOption, "id" | "color">[]): Map<string, string> {
	const colors = new Map<string, string>();
	const taken = new Set<number>();
	// A colour the user picked always wins; automatic colours avoid the ones already chosen.
	for (const mailbox of mailboxes) {
		if (!mailbox.color) continue;
		colors.set(mailbox.id, mailbox.color);
		const slot = MAILBOX_PALETTE.indexOf(mailbox.color);
		if (slot !== -1) taken.add(slot);
	}
	for (const { id } of [...mailboxes].filter((mailbox) => !mailbox.color).sort((a, b) => a.id.localeCompare(b.id))) {
		let slot = hash(id) % MAILBOX_PALETTE.length;
		for (let tries = 0; tries < MAILBOX_PALETTE.length && taken.has(slot); tries++) slot = (slot + 1) % MAILBOX_PALETTE.length;
		taken.add(slot);
		colors.set(id, MAILBOX_PALETTE[slot]);
	}
	return colors;
}
