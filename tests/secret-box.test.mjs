import assert from "node:assert/strict";
import test from "node:test";
import { isEncryptedSecret, openSecret, sealSecret } from "../src/lib/crypto/secret-box.ts";

const key = Buffer.from(new Uint8Array(32).map((_, index) => index)).toString("base64");
const env = { SECRETS_ENCRYPTION_KEY: key };

test("a sealed secret opens again and is not stored in plain text", async () => {
	const sealed = await sealSecret(env, "sk-ant-secret-1234");
	assert.ok(isEncryptedSecret(sealed));
	assert.ok(!sealed.includes("secret-1234"));
	assert.equal(await openSecret(env, sealed), "sk-ant-secret-1234");
	assert.notEqual(await sealSecret(env, "same"), await sealSecret(env, "same"));
});

test("without a key secrets stay as they are, and plain values from before still open", async () => {
	assert.equal(await sealSecret({}, "plain"), "plain");
	assert.equal(await openSecret(env, "plain-legacy"), "plain-legacy");
});

test("a sealed secret does not open without its key or with another one", async () => {
	const sealed = await sealSecret(env, "value");
	assert.equal(await openSecret({}, sealed), null);
	const other = { SECRETS_ENCRYPTION_KEY: Buffer.from(new Uint8Array(32).fill(7)).toString("base64") };
	assert.equal(await openSecret(other, sealed), null);
});
