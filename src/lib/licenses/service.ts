import type { LicenseEntitlements, LicenseStatus } from "./types";

// This fork runs every installation with the full Team feature set. There is no license
// server: upstream Mailflare checked a Paymug license here; that check and the activation
// flow were removed (AGPL-3.0 modification, see NOTICE.md).

export async function getLicenseStatus(_env: CloudflareEnv): Promise<LicenseStatus> {
	return {
		plan: "team",
		state: "active",
		features: [],
		seatLimit: null,
		instanceId: "self-hosted",
		instanceUrl: null,
		active: true,
		activatedAt: null,
		validatedAt: null,
	};
}

export async function getLicenseEntitlements(_env: CloudflareEnv): Promise<LicenseEntitlements> {
	return {
		plan: "team",
		canCustomizeBranding: true,
		canManageAccounts: true,
		canShareMailboxes: true,
		accountSeatLimit: null,
		canForwardEmail: true,
	};
}
