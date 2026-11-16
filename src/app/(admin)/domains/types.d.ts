export type SendingProvider = "none" | "cloudflare" | "resend" | "ses" | "brevo" | "mailjet" | "smtp";
export type ReceivingProvider = "none" | "cloudflare" | "resend" | "ses";

export type Domain = {
	id: string;
	hostname: string;
	status: string;
	routingEnabled: boolean;
	sendingEnabled: boolean;
	sendingRequested: boolean;
	sendingProvider: SendingProvider;
	receivingProvider: ReceivingProvider;
	zoneId: string;
	/** Added with DNS skipped: the Cloudflare zone is attached on first setup. */
	dnsSkipped?: boolean;
};

export type DomainPreflight = {
	hostname: string;
	zone: { id: string; name: string };
};

export type DomainPreflightResponse = {
	ok: boolean;
	domain?: DomainPreflight;
	error?: string;
};

export type DnsRecord = {
	type?: string;
	name?: string;
	content?: string;
	priority?: number;
};

export type DnsAuthRecord = "mx" | "spf" | "dkim" | "dmarc";

export type DnsAuthStatus = "ok" | "missing" | "unknown";

export type DnsAuthCheck = {
	record: DnsAuthRecord;
	label: string;
	name: string;
	status: DnsAuthStatus;
	found: string[];
};

export type DomainDnsAudit = Record<DnsAuthRecord, DnsAuthCheck>;

export type DnsStatusSummary = {
	routing: { configured: boolean; missing: string[] };
	sending: { configured: boolean; records: string[] };
	auth?: Record<DnsAuthRecord, DnsAuthStatus>;
};

export type DomainDnsView = {
	routing: {
		records: DnsRecord[];
		missing: DnsRecord[];
		status?: string;
	};
	sending: DnsRecord[];
	sendingEnabled: boolean;
	dkimSelector?: string;
	sendingSubdomain?: { name: string; tag: string };
	audit?: DomainDnsAudit;
};

export type HealthStatus = "ok" | "missing" | "wrong" | "unknown" | "skipped";
export type HealthCheckId = "mx" | "spf" | "dkim" | "dmarc" | "routing" | "catchAll";

export type HealthCheck = {
	id: HealthCheckId;
	label: string;
	status: HealthStatus;
	message: string;
	found: string[];
	expected: string[];
};

export type DomainHealth = {
	hostname: string;
	manual: boolean;
	checkedAt: string;
	checks: HealthCheck[];
	/** The repairs a click would make, each with the key the server expects back. */
	plan: { key: string; checkId: HealthCheckId; summary: string }[];
};

export type RepairResult = { key: string; summary: string; ok: boolean; error?: string };

export type DomainDnsCache =Record<string, { domain: Domain; dns: DomainDnsView }>;

export type DomainDnsDetailsProps = {
	domain: Domain;
	dns: DomainDnsView;
	onSendingProviderChange?: (provider: SendingProvider) => void;
	sendingProviderBusy?: boolean;
	sendingProviderMessage?: string | null;
	onReceivingProviderChange?: (provider: ReceivingProvider) => void;
	receivingProviderBusy?: boolean;
	receivingProviderMessage?: string | null;
	/** Reload the DNS view after a setup that changed the zone. */
	onDnsChanged?: () => void;
	onSetup?: (record: DnsAuthRecord) => void;
	setupRecord?: DnsAuthRecord | null;
	setupMessage?: string | null;
};

export type DomainItemCardProps = {
	item: Domain;
	dns?: DnsStatusSummary;
	dnsDetails?: DomainDnsView;
	onSendingProviderChange?: (provider: SendingProvider) => void;
	sendingProviderBusy?: boolean;
	sendingProviderMessage?: string | null;
	onReceivingProviderChange?: (provider: ReceivingProvider) => void;
	receivingProviderBusy?: boolean;
	receivingProviderMessage?: string | null;
	onDnsChanged?: () => void;
	dnsLoading?: boolean;
	dnsError?: string | null;
	expanded?: boolean;
	remove: { mutate: (id: string) => void; isPending: boolean };
	onToggleDns: (id: string) => void;
	onSetup?: (record: DnsAuthRecord) => void;
	setupRecord?: DnsAuthRecord | null;
	setupMessage?: string | null;
};
