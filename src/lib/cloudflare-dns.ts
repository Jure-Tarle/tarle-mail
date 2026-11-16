import { cfRequest } from "@/lib/cloudflare-api";
import type { CfDnsRecord } from "@/lib/cloudflare-api.types";
import type { CloudflareDnsRecordCreate } from "@/lib/cloudflare-dns.types";

export async function listMxRecords(
	env: CloudflareEnv,
	zoneId: string,
	hostname: string,
): Promise<CfDnsRecord[]> {
	return cfRequest<CfDnsRecord[]>(
		env,
		`/zones/${zoneId}/dns_records?type=MX&name=${encodeURIComponent(hostname)}&per_page=5000`,
	);
}

export async function listDnsRecords(
	env: CloudflareEnv,
	zoneId: string,
	params: { type: string; name: string },
): Promise<CfDnsRecord[]> {
	return cfRequest<CfDnsRecord[]>(
		env,
		`/zones/${zoneId}/dns_records?type=${encodeURIComponent(params.type)}&name=${encodeURIComponent(params.name)}&per_page=5000`,
	);
}

/** Every record at `name` regardless of type, so one request answers MX, TXT and CNAME lookups alike. */
export async function listDnsRecordsByName(
	env: CloudflareEnv,
	zoneId: string,
	name: string,
): Promise<CfDnsRecord[]> {
	return cfRequest<CfDnsRecord[]>(
		env,
		`/zones/${zoneId}/dns_records?name=${encodeURIComponent(name)}&per_page=5000`,
	);
}

/** Rewrites only the content of one record; its name, type, TTL and any other field stay as they are. */
export async function updateDnsRecordContent(
	env: CloudflareEnv,
	zoneId: string,
	recordId: string,
	content: string,
): Promise<CfDnsRecord> {
	return cfRequest<CfDnsRecord>(env, `/zones/${zoneId}/dns_records/${recordId}`, {
		method: "PATCH",
		body: JSON.stringify({ content }),
	});
}

export async function deleteDnsRecord(
	env: CloudflareEnv,
	zoneId: string,
	recordId: string,
): Promise<void> {
	await cfRequest<unknown>(env, `/zones/${zoneId}/dns_records/${recordId}`, {
		method: "DELETE",
	});
}

export async function createDnsRecord(
	env: CloudflareEnv,
	zoneId: string,
	record: CloudflareDnsRecordCreate,
): Promise<CfDnsRecord> {
	return cfRequest<CfDnsRecord>(env, `/zones/${zoneId}/dns_records`, {
		method: "POST",
		body: JSON.stringify(record),
	});
}
