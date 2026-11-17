import assert from "node:assert/strict";
import test from "node:test";
import { isSenderExcluded, parseSenderRules } from "../src/lib/agent/sender-rules.ts";

const rules = ["max@firma.de", "@newsletter.de", "shop.example", "*@*.mailchimp.com", "/^(info|news)@/", "# a comment", ""].join("\n");

test("exact addresses, domains with subdomains, wildcards and regular expressions match", () => {
	assert.equal(isSenderExcluded("Max@Firma.de", rules), true);
	assert.equal(isSenderExcluded("moritz@firma.de", rules), false);
	assert.equal(isSenderExcluded("a@newsletter.de", rules), true);
	assert.equal(isSenderExcluded("a@mail.newsletter.de", rules), true);
	assert.equal(isSenderExcluded("a@notnewsletter.de", rules), false);
	assert.equal(isSenderExcluded("orders@shop.example", rules), true);
	assert.equal(isSenderExcluded("bounce@us5.mailchimp.com", rules), true);
	assert.equal(isSenderExcluded("info@anywhere.org", rules), true);
	assert.equal(isSenderExcluded("jure@tarle.de", rules), false);
});

test("unusable lines are reported instead of silently ignored", () => {
	const { rules: parsed, errors } = parseSenderRules("/(unclosed/\nnodomain\nok@x.de");
	assert.equal(parsed.length, 1);
	assert.equal(errors.length, 2);
});

test("no rules exclude nobody", () => {
	assert.equal(isSenderExcluded("a@b.de", ""), false);
});
