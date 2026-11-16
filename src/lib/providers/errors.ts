/**
 * A failed send. `fallback` says whether another provider could do better: rate limits (429),
 * provider outages (5xx), transient SMTP replies (4xx) and network failures can; a rejected
 * request (HTTP 4xx, permanent SMTP 5xx) would fail the same way anywhere.
 */
export class ProviderSendError extends Error {
	constructor(message: string, readonly fallback: boolean, readonly status?: number) {
		super(message);
		this.name = "ProviderSendError";
	}
}

export function httpFailure(provider: string, status: number, detail: string | undefined): ProviderSendError {
	return new ProviderSendError(`${provider}: ${detail || `request failed (${status})`}`, status === 429 || status >= 500, status);
}

/** Wraps a fetch that never got an answer (DNS, TLS, reset, timeout) so callers see which provider it was. */
export function networkFailure(provider: string, error: unknown): ProviderSendError {
	const reason = error instanceof Error ? error.message : "network error";
	return new ProviderSendError(`${provider}: ${reason}`, true);
}

/** Errors from the SES and Cloudflare adapters carry a numeric `status` when the provider answered. */
export function shouldFallBack(error: unknown): boolean {
	if (error instanceof ProviderSendError) return error.fallback;
	const status = (error as { status?: unknown } | null)?.status;
	if (typeof status === "number") return status === 429 || status >= 500;
	return true;
}

export async function readErrorDetail(response: Response): Promise<string | undefined> {
	const text = await response.text().catch(() => "");
	if (!text) return undefined;
	try {
		const body = JSON.parse(text) as Record<string, unknown>;
		const detail = body.message ?? body.error ?? body.ErrorMessage ?? body.code;
		return typeof detail === "string" && detail ? detail.slice(0, 300) : undefined;
	} catch {
		return text.slice(0, 300);
	}
}
