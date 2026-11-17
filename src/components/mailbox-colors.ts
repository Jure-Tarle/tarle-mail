import type { MailboxOption } from "./mailbox-provider";

/**
 * Account colours for telling mailboxes apart in a combined list, as Mailbird, Mimestream and
 * Thunderbird do. Mid-tone hues read on both light and dark surfaces.
 */
const PALETTE = ["#2563eb", "#059669", "#d97706", "#7c3aed", "#db2777", "#0891b2", "#ea580c", "#64748b"];

function hash(value: string): number {
	let result = 0;
	for (let index = 0; index < value.length; index++) result = (result * 31 + value.charCodeAt(index)) >>> 0;
	return result;
}

/**
 * A colour per mailbox. Each mailbox starts from a hash of its id and takes the next free colour
 * on a clash, so a mailbox keeps its colour when the list is re-sorted and colours only repeat
 * beyond eight mailboxes.
 */
export function getMailboxColors(mailboxes: Pick<MailboxOption, "id">[]): Map<string, string> {
	const colors = new Map<string, string>();
	const taken = new Set<number>();
	for (const { id } of [...mailboxes].sort((a, b) => a.id.localeCompare(b.id))) {
		let slot = hash(id) % PALETTE.length;
		for (let tries = 0; tries < PALETTE.length && taken.has(slot); tries++) slot = (slot + 1) % PALETTE.length;
		taken.add(slot);
		colors.set(id, PALETTE[slot]);
	}
	return colors;
}

/** The shortest label that still tells mailboxes apart: the local part when they share one domain. */
export function getMailboxShortLabels(mailboxes: Pick<MailboxOption, "id" | "localPart" | "hostname">[]): Map<string, string> {
	const oneDomain = new Set(mailboxes.map((mailbox) => mailbox.hostname)).size <= 1;
	return new Map(mailboxes.map((mailbox) => [mailbox.id, oneDomain ? mailbox.localPart : `${mailbox.localPart}@${mailbox.hostname}`]));
}
