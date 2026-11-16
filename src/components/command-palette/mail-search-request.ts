export const MAIL_SEARCH_REQUEST_EVENT = "mailflare:mail-search-request";

let pending: string | null = null;

/** Hands a search to the header search box: now if it is on a mail list, else when the next page mounts it. */
export function requestMailSearch(query: string, { live }: { live: boolean }): void {
	pending = query;
	if (live) window.dispatchEvent(new Event(MAIL_SEARCH_REQUEST_EVENT));
}

export function takeMailSearchRequest(): string | null {
	const query = pending;
	pending = null;
	return query;
}
