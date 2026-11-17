import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useLanguage } from "@/components/language-provider";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { dnsAuthDescriptions, getDnsAuthItemClass } from "./utils";
import { ROW_GRID, StatusBadge, StatusRow } from "./status-row";
import CloudflareReceivingConfig from "./CloudflareReceivingConfig";
import ReceivingSetupSection from "./ReceivingSetupSection";
import SendingSetupSection from "./SendingSetupSection";
import DomainHealthSection from "./DomainHealthSection";
import TrackingHostSection from "./TrackingHostSection";
import BimiLogoSection from "./BimiLogoSection";
import type { DnsAuthRecord, DomainDnsDetailsProps } from "./types";

const TABS = ["dns", "receiving", "sending", "brand"] as const;
type DetailTab = (typeof TABS)[number];

/** Sections inside a tab panel sit in a grid, so their own top margin is dropped. */
const PANEL_GRID = "grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-8 [&>section]:mt-0 [&>section]:min-w-0";

export default function DomainDnsDetails({
	domain,
	dns,
	onSetup,
	setupRecord,
	setupMessage,
	onSendingProviderChange,
	sendingProviderBusy,
	sendingProviderMessage,
	onReceivingProviderChange,
	receivingProviderBusy,
	receivingProviderMessage,
	onDnsChanged,
}: DomainDnsDetailsProps) {
	const { t } = useLanguage();
	const audit = dns.audit;
	const manual = domain.zoneId === "manual" && !domain.dnsSkipped;
	const subdomain = dns.sendingSubdomain;
	const sendingOk = subdomain ? dns.sendingEnabled : manual && domain.sendingEnabled;
	const sendingLabel = subdomain
		? t("domains.sendingFor", { name: subdomain.name, state: dns.sendingEnabled ? t("domains.enabled") : t("domains.disabled") })
		: manual
			? domain.sendingEnabled
				? t("domains.sendingConfigured")
				: t("domains.sendingNotConfigured")
			: t("domains.sendingNotSet");
	const routingOk = dns.routing.missing.length === 0 && (dns.routing.records.length > 0 || domain.routingEnabled);
	const routingLabel = routingOk
		? t("domains.routingConfigured")
		: dns.routing.missing.length > 0
			? t("domains.recordsMissing", { count: dns.routing.missing.length })
			: t("domains.noRoutingRecords");

	const auditRow = (record: DnsAuthRecord) => {
		if (!audit) return null;
		const item = audit[record];
		const ok = item.status === "ok";
		return (
			<li key={record} className={`${ROW_GRID} ${getDnsAuthItemClass(item.status)}`}>
				<StatusBadge ok={ok} tone={item.status === "missing" ? "red" : "neutral"} />
				<span className="min-w-0">
					<span className="block font-medium text-neutral-900">{t("domains.recordLabel", { label: item.label })}</span>
					<span className="block text-xs text-neutral-500">{t(dnsAuthDescriptions[record])}</span>
				</span>
				{ok ? (
					<span className="min-w-0 break-all text-neutral-500">{item.found.length > 0 ? item.found.join(", ") : item.name}</span>
				) : (
					<Button
						variant="outline"
						size="sm"
						className="shrink-0 bg-white"
						disabled={manual || setupRecord === record}
						title={manual ? t("domains.manualDns") : t("domains.createRecord", { label: item.label })}
						onClick={() => onSetup?.(record)}
					>
						{setupRecord === record ? t("domains.settingUp") : t("domains.setup")}
					</Button>
				)}
			</li>
		);
	};

	const cloudflareConfig = (
		<ul className="space-y-2">
			<StatusRow ok={!!sendingOk} title={t("domains.emailSending")} hint={t("domains.emailSendingHint")}>{sendingLabel}</StatusRow>
			{auditRow("dkim")}
		</ul>
	);

	const cloudflareReceiving = (
		<CloudflareReceivingConfig domainId={domain.id} routingOk={routingOk} routingLabel={routingLabel} manual={manual} onChanged={onDnsChanged} />
	);

	const dnsRecordsSection = audit && (
		<section>
			<h2 className="text-base font-semibold text-neutral-900">{t("domains.setupTitle")}</h2>
			<p className="mt-0.5 text-sm text-neutral-500">
				{t("domains.setupDescription")}
			</p>
			<ul className="mt-3 space-y-2">
				{(["mx", "spf", "dmarc"] as DnsAuthRecord[]).map(auditRow)}
			</ul>
			{manual && (
				<p className="mt-2 text-xs text-neutral-500">
					{t("domains.manualDnsNote")}
				</p>
			)}
			{setupMessage && <p role="alert" className="mt-2 text-xs text-red-600">{setupMessage}</p>}
		</section>
	);

	const attention: Record<DetailTab, boolean> = {
		dns: !!audit && (["mx", "spf", "dmarc"] as DnsAuthRecord[]).some((record) => audit[record].status !== "ok"),
		receiving: domain.receivingProvider === "cloudflare" && !routingOk,
		sending: domain.sendingProvider === "cloudflare" && !(sendingOk && audit?.dkim.status === "ok"),
		brand: false,
	};
	// Open on the first category that needs work, so a fresh domain lands where setup continues.
	const [tab, setTab] = useState<DetailTab>(() => TABS.find((key) => attention[key]) ?? "dns");
	const tabRefs = useRef<Partial<Record<DetailTab, HTMLButtonElement | null>>>({});
	const idBase = `domain-${domain.id}`;

	const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		const index = TABS.indexOf(tab);
		const next =
			event.key === "ArrowRight" ? TABS[(index + 1) % TABS.length]
			: event.key === "ArrowLeft" ? TABS[(index - 1 + TABS.length) % TABS.length]
			: event.key === "Home" ? TABS[0]
			: event.key === "End" ? TABS[TABS.length - 1]
			: null;
		if (!next) return;
		event.preventDefault();
		setTab(next);
		tabRefs.current[next]?.focus();
	};

	return (
		<div className="min-w-0 pb-4 pt-2 sm:pb-5">
			<div role="tablist" aria-label={t("domains.tabs.label")} className="grid grid-cols-2 border-b border-neutral-200 sm:-mx-1 sm:flex sm:gap-1 sm:overflow-x-auto sm:px-1 sm:[scrollbar-width:none]">
				{TABS.map((key) => (
					<button
						key={key}
						ref={(element) => { tabRefs.current[key] = element; }}
						type="button"
						role="tab"
						id={`${idBase}-tab-${key}`}
						aria-selected={tab === key}
						aria-controls={`${idBase}-panel`}
						tabIndex={tab === key ? 0 : -1}
						onClick={() => setTab(key)}
						onKeyDown={onTabKeyDown}
						className={cn(
							"relative -mb-px flex min-h-11 shrink-0 cursor-pointer items-center gap-2 border-b-2 px-3 text-left text-sm sm:whitespace-nowrap font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-600",
							tab === key ? "border-blue-600 text-blue-700" : "border-transparent text-neutral-500 hover:text-neutral-900",
						)}
					>
						{t(`domains.tabs.${key}`)}
						{attention[key] && (
							<span className="h-2 w-2 rounded-full bg-amber-500">
								<span className="sr-only">{t("domains.tabs.needsAttention")}</span>
							</span>
						)}
					</button>
				))}
			</div>
			<div role="tabpanel" id={`${idBase}-panel`} aria-labelledby={`${idBase}-tab-${tab}`} className="pt-5">
				{tab === "dns" && (
					<div className={cn(PANEL_GRID, audit && "xl:grid-cols-[repeat(2,minmax(0,1fr))]")}>
						{dnsRecordsSection}
						<DomainHealthSection domainId={domain.id} onRepaired={onDnsChanged} />
					</div>
				)}
				{tab === "receiving" && (
					<div className={PANEL_GRID}>
						<ReceivingSetupSection
							domain={domain}
							onChange={onReceivingProviderChange}
							busy={receivingProviderBusy}
							message={receivingProviderMessage}
							cloudflareConfig={cloudflareReceiving}
							cloudflareOk={routingOk}
						/>
					</div>
				)}
				{tab === "sending" && (
					<div className={PANEL_GRID}>
						<SendingSetupSection
							domain={domain}
							onChange={onSendingProviderChange}
							busy={sendingProviderBusy}
							message={sendingProviderMessage}
							cloudflareConfig={cloudflareConfig}
							cloudflareOk={!!sendingOk && audit?.dkim.status === "ok"}
						/>
					</div>
				)}
				{tab === "brand" && (
					<div className={cn(PANEL_GRID, domain.sendingProvider !== "none" && "xl:grid-cols-[repeat(2,minmax(0,1fr))]")}>
						{domain.sendingProvider !== "none" && <TrackingHostSection domain={domain} />}
						<BimiLogoSection domain={domain} />
					</div>
				)}
			</div>
		</div>
	);
}
