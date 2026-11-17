/** Why an AI provider response means "try the next key", and how long to rest the key that got it. */
export type ProviderKeyFailure = { reason: "rejected" | "rate_limited" | "unavailable"; cooldownMs: number };

const HOUR = 60 * 60 * 1000;

/**
 * Classifies a provider response for key failover. Invalid or unpaid keys rest a day, rate limits for
 * as long as the provider asks (a minute when it does not say), overloads and outages for 30 seconds.
 * Anything else, including bad requests that another key would fail the same way, is not a failover.
 */
export function classifyProviderKeyFailure(status: number, retryAfter: string | null): ProviderKeyFailure | null {
	if (status === 401 || status === 402 || status === 403) return { reason: "rejected", cooldownMs: 24 * HOUR };
	if (status === 429) {
		const seconds = retryAfter ? Number(retryAfter) : Number.NaN;
		const fromDate = retryAfter && Number.isNaN(seconds) ? Date.parse(retryAfter) - Date.now() : Number.NaN;
		const wait = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Number.isFinite(fromDate) && fromDate > 0 ? fromDate : 60_000;
		return { reason: "rate_limited", cooldownMs: Math.min(wait, HOUR) };
	}
	if (status === 500 || status === 502 || status === 503 || status === 504 || status === 529) return { reason: "unavailable", cooldownMs: 30_000 };
	return null;
}

/** Usable keys first in their order, resting ones after them as a last resort, disabled ones never. */
export function orderAgentKeysForUse<T extends { position: number; disabled: boolean; cooldownUntil: Date | null }>(keys: T[], now = Date.now()): T[] {
	const active = keys.filter((key) => !key.disabled).sort((a, b) => a.position - b.position);
	const ready = active.filter((key) => !key.cooldownUntil || key.cooldownUntil.getTime() <= now);
	const resting = active.filter((key) => key.cooldownUntil && key.cooldownUntil.getTime() > now)
		.sort((a, b) => a.cooldownUntil!.getTime() - b.cooldownUntil!.getTime());
	return [...ready, ...resting];
}
