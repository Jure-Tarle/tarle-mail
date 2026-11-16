import type { OutboundProviderConfig, OutboundProviderName, OutboundSendAttempt } from "@/lib/email/outbound-provider-types";
import { ProviderSendError, shouldFallBack } from "@/lib/providers/errors";

export type FallbackDeps = {
	/** Sends through one provider; throws when it fails. */
	send(config: OutboundProviderConfig): Promise<{ messageId: string }>;
	/** False when the provider's daily or monthly cap leaves no room for this message. */
	hasRoom(provider: OutboundProviderName): Promise<boolean>;
	/** Counts the message against the provider after it was accepted. */
	record(provider: OutboundProviderName): Promise<void>;
};

export type FallbackResult = { messageId: string; provider: OutboundProviderName; attempts: OutboundSendAttempt[] };

const trail = (attempts: OutboundSendAttempt[]) =>
	attempts.map((attempt) => `${attempt.provider}: ${attempt.detail ?? attempt.outcome}`).join("; ");

/**
 * Tries the providers in order. A provider over its quota is skipped; a rate limit, outage or
 * network failure moves on to the next one. A rejection that would repeat anywhere (an invalid
 * request, a permanent SMTP refusal) stops the walk and is reported as it was.
 */
export async function sendWithFallback(chain: OutboundProviderConfig[], deps: FallbackDeps): Promise<FallbackResult> {
	const attempts: OutboundSendAttempt[] = [];
	for (const config of chain) {
		const provider = config.provider;
		if (!await deps.hasRoom(provider)) {
			attempts.push({ provider, outcome: "skipped", detail: "sending limit reached" });
			continue;
		}
		try {
			const { messageId } = await deps.send(config);
			attempts.push({ provider, outcome: "sent" });
			// The message is out; a counter that cannot be written must not turn that into a failure.
			await deps.record(provider).catch((error) => console.error("Provider usage not recorded", error));
			return { messageId, provider, attempts };
		} catch (error) {
			const detail = error instanceof Error ? error.message : "send failed";
			attempts.push({ provider, outcome: "failed", detail });
			if (shouldFallBack(error)) console.warn(`Sending through ${provider} failed, trying the next provider: ${detail}`);
			else {
				if (attempts.length === 1) throw error;
				throw new ProviderSendError(trail(attempts), false, (error as { status?: number }).status);
			}
		}
	}
	const allSkipped = attempts.every((attempt) => attempt.outcome === "skipped");
	throw new ProviderSendError(allSkipped ? `Sending limit reached for every provider (${trail(attempts)})` : trail(attempts), false);
}
