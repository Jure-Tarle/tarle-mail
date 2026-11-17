/**
 * Encryption at rest for secrets Tarle Mail stores in its database, such as AI provider keys.
 *
 * AES-256-GCM with a key from the Worker secret SECRETS_ENCRYPTION_KEY (32 random bytes, base64).
 * Stored values look like `v1:<base64 of 12-byte IV + ciphertext>`. Without the secret, values are
 * stored as they are, so self-hosted setups keep working; `isSecretEncryptionEnabled` tells the UI.
 * A database dump or backup alone then never reveals the secrets.
 */

const PREFIX = "v1:";
const IV_BYTES = 12;
let cachedKey: { raw: string; key: Promise<CryptoKey> } | null = null;

function toBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
	const binary = atob(value);
	const bytes = new Uint8Array(new ArrayBuffer(binary.length));
	for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
	return bytes;
}

function importKey(raw: string): Promise<CryptoKey> {
	if (cachedKey?.raw === raw) return cachedKey.key;
	const bytes = fromBase64(raw.trim());
	if (bytes.length !== 32) throw new Error("SECRETS_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
	const key = crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
	cachedKey = { raw, key };
	return key;
}

export function isSecretEncryptionEnabled(env: Pick<CloudflareEnv, "SECRETS_ENCRYPTION_KEY">): boolean {
	return !!env.SECRETS_ENCRYPTION_KEY?.trim();
}

export function isEncryptedSecret(value: string): boolean {
	return value.startsWith(PREFIX);
}

/** Encrypts a secret for storage, or returns it unchanged when no encryption key is configured. */
export async function sealSecret(env: Pick<CloudflareEnv, "SECRETS_ENCRYPTION_KEY">, plaintext: string): Promise<string> {
	if (!isSecretEncryptionEnabled(env)) return plaintext;
	const key = await importKey(env.SECRETS_ENCRYPTION_KEY!);
	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)));
	const packed = new Uint8Array(IV_BYTES + ciphertext.length);
	packed.set(iv);
	packed.set(ciphertext, IV_BYTES);
	return PREFIX + toBase64(packed);
}

/**
 * Reads a stored secret. Plain values (stored before encryption was set up) come back unchanged;
 * an encrypted value without its key, or with the wrong one, comes back as null.
 */
export async function openSecret(env: Pick<CloudflareEnv, "SECRETS_ENCRYPTION_KEY">, stored: string): Promise<string | null> {
	if (!isEncryptedSecret(stored)) return stored;
	if (!isSecretEncryptionEnabled(env)) return null;
	try {
		const packed = fromBase64(stored.slice(PREFIX.length));
		const key = await importKey(env.SECRETS_ENCRYPTION_KEY!);
		const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: packed.slice(0, IV_BYTES) }, key, packed.slice(IV_BYTES));
		return new TextDecoder().decode(plaintext);
	} catch {
		return null;
	}
}
