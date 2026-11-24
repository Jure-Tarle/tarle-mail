import type { Mailbox } from "./types";

export function getMailboxAddress(mailbox: Pick<Mailbox, "localPart" | "hostname">): string {
	return `${mailbox.localPart}@${mailbox.hostname}`;
}

export function getMailboxName(mailbox: Pick<Mailbox, "displayName" | "localPart">): string {
	return mailbox.displayName?.trim() || mailbox.localPart;
}

export function getMailboxesBase(pathname: string) {
	return pathname.startsWith("/settings") ? "/settings/mailboxes" : "/mailboxes";
}

export type MailboxSortKey = "name" | "type" | "status" | "lastSignIn";
export type MailboxSort = { key: MailboxSortKey; dir: "asc" | "desc" };

const STATUS_ORDER = { active: 0, disabled: 1, pendingDeletion: 2 };

/**
 * Sorts the admin mailbox list by a column. Name ties fall back to the address so the order is
 * stable; mailboxes without a last sign-in (shared ones, never used) stay at the end in both directions.
 */
export function sortMailboxes<T extends Pick<Mailbox, "displayName" | "localPart" | "hostname" | "type" | "status" | "lastSignInAt">>(
	list: T[],
	sort: MailboxSort,
	labels: { personal: string; shared: string },
): T[] {
	const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
	const sign = sort.dir === "asc" ? 1 : -1;
	const byName = (a: T, b: T) => collator.compare(getMailboxName(a), getMailboxName(b)) || collator.compare(getMailboxAddress(a), getMailboxAddress(b));
	return [...list].sort((a, b) => {
		if (sort.key === "lastSignIn") {
			const aTime = a.type !== "shared" && a.lastSignInAt ? Date.parse(a.lastSignInAt) : null;
			const bTime = b.type !== "shared" && b.lastSignInAt ? Date.parse(b.lastSignInAt) : null;
			if (aTime === null || bTime === null) return aTime === bTime ? byName(a, b) : aTime === null ? 1 : -1;
			return sign * (aTime - bTime) || byName(a, b);
		}
		let primary = 0;
		if (sort.key === "type") primary = collator.compare(labels[a.type ?? "personal"], labels[b.type ?? "personal"]);
		if (sort.key === "status") primary = STATUS_ORDER[a.status ?? "active"] - STATUS_ORDER[b.status ?? "active"];
		return sign * (primary || byName(a, b));
	});
}
