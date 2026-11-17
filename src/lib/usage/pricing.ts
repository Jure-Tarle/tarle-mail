/**
 * Cloudflare list prices and included allowances behind the cost forecast (Workers Paid plan,
 * USD, checked 2026-11). Re-check them against the pages below when Cloudflare changes its pricing.
 *
 * - Workers Paid, requests:  https://developers.cloudflare.com/workers/platform/pricing/
 * - D1 rows and storage:     https://developers.cloudflare.com/d1/platform/pricing/
 * - R2 Standard storage/ops: https://developers.cloudflare.com/r2/pricing/
 * - Email Sending:           https://developers.cloudflare.com/email-service/platform/pricing/
 */

/** One billed quantity: `included` comes with the plan, every unit beyond it costs `perUnit` dollars. */
export type Allowance = { included: number; perUnit: number };

/** Cloudflare bills storage in decimal gigabytes (1 GB = 1,000,000,000 bytes). */
export const GB = 1_000_000_000;

export const WORKERS_PAID_BASE_USD = 5;

export const PRICING = {
	d1: {
		/** Rows read: 25 billion included, then $0.001 per million. */
		rowsRead: { included: 25_000_000_000, perUnit: 0.001 / 1_000_000 },
		/** Rows written: 50 million included, then $1.00 per million. */
		rowsWritten: { included: 50_000_000, perUnit: 1 / 1_000_000 },
		/** Storage in GB-months: 5 GB included, then $0.75 per GB-month. */
		storageGb: { included: 5, perUnit: 0.75 },
	},
	r2: {
		/** Standard storage in GB-months: 10 GB included, then $0.015 per GB-month. */
		storageGb: { included: 10, perUnit: 0.015 },
		/** Class A operations (writes, lists): 1 million included, then $4.50 per million. */
		classA: { included: 1_000_000, perUnit: 4.5 / 1_000_000 },
		/** Class B operations (reads): 10 million included, then $0.36 per million. */
		classB: { included: 10_000_000, perUnit: 0.36 / 1_000_000 },
	},
	/** Email Sending: 3,000 messages a month included, then $0.35 per 1,000. */
	emailSending: { included: 3_000, perUnit: 0.35 / 1_000 },
	/** Workers requests: 10 million included, then $0.30 per million. */
	workerRequests: { included: 10_000_000, perUnit: 0.3 / 1_000_000 },
} satisfies Record<string, Allowance | Record<string, Allowance>>;

/** R2 operations billed as Class A, by the `actionType` name the analytics API reports. */
const R2_CLASS_A = new Set([
	"ListBuckets", "PutBucket", "ListObjects", "PutObject", "CopyObject", "CompleteMultipartUpload", "CreateMultipartUpload",
	"LifecycleStorageTierTransition", "ListMultipartUploads", "UploadPart", "UploadPartCopy", "ListParts",
	"PutBucketEncryption", "PutBucketCors", "PutBucketLifecycleConfiguration",
]);

/** R2 operations billed as Class B. DeleteObject, DeleteBucket and AbortMultipartUpload are free and match neither list. */
const R2_CLASS_B = new Set([
	"HeadBucket", "HeadObject", "GetObject", "UsageSummary", "GetBucketEncryption", "GetBucketLocation", "GetBucketCors", "GetBucketLifecycleConfiguration",
]);

/** Which R2 price class an operation falls in; null for free and unknown operations. A trailing `V2` (ListObjectsV2) counts as its base operation. */
export function r2OperationClass(actionType: string): "A" | "B" | null {
	const name = actionType.replace(/V2$/, "");
	if (R2_CLASS_A.has(name)) return "A";
	if (R2_CLASS_B.has(name)) return "B";
	return null;
}
