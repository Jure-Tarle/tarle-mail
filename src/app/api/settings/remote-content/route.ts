import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getDb } from "@/db";
import { contacts, users } from "@/db/schema";
import { requireSessionUser } from "@/lib/api/auth";
import { getEnv } from "@/lib/cloudflare";
import { getContactId } from "@/lib/contacts/utils";
import { trustRemoteContentSenderSchema, updateRemoteContentSettingsSchema } from "@/lib/validators";

// `?sender=` also reports whether the user has already allowed remote content from that address.
export async function GET(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	const mode = auth.user.remoteContentMode;
	const params = new URL(request.url).searchParams;
	// `?senders=1` lists the senders whose remote content the user has allowed, for the settings page.
	if (params.get("senders") === "1") {
		const rows = await getDb(env)
			.select({ email: contacts.email })
			.from(contacts)
			.where(and(eq(contacts.userId, auth.user.id), eq(contacts.remoteContentAllowed, true)))
			.orderBy(asc(contacts.email));
		return NextResponse.json({ mode, senders: rows.map((row) => row.email) });
	}
	const sender = params.get("sender")?.trim().toLowerCase();
	if (!sender || mode !== "new_sender") return NextResponse.json({ mode });
	const [contact] = await getDb(env)
		.select({ allowed: contacts.remoteContentAllowed, source: contacts.source })
		.from(contacts)
		.where(and(eq(contacts.userId, auth.user.id), eq(contacts.email, sender)))
		.limit(1);
	// Someone the user has written to or added is not a new sender.
	const known = !!contact && (contact.allowed || contact.source !== "inbound");
	return NextResponse.json({ mode, senderAllowed: known });
}

export async function PATCH(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;

	let mode;
	try {
		({ mode } = updateRemoteContentSettingsSchema.parse(await request.json()));
	} catch (error) {
		return NextResponse.json({ error: error instanceof ZodError ? error.flatten() : "Invalid request" }, { status: 400 });
	}

	await getDb(env).update(users).set({ remoteContentMode: mode }).where(eq(users.id, auth.user.id));
	return NextResponse.json({ mode });
}

// Remembers that the user allowed remote content from this sender.
export async function POST(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;

	let sender: string;
	try {
		({ sender } = trustRemoteContentSenderSchema.parse(await request.json()));
	} catch (error) {
		return NextResponse.json({ error: error instanceof ZodError ? error.flatten() : "Invalid request" }, { status: 400 });
	}

	await getDb(env)
		.insert(contacts)
		.values({ id: getContactId(auth.user.id, sender), userId: auth.user.id, email: sender, source: "inbound", remoteContentAllowed: true })
		.onConflictDoUpdate({ target: [contacts.userId, contacts.email], set: { remoteContentAllowed: true } });
	return NextResponse.json({ senderAllowed: true });
}

// Forgets that the user allowed remote content from this sender; the next message asks again.
export async function DELETE(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;

	let sender: string;
	try {
		({ sender } = trustRemoteContentSenderSchema.parse(await request.json()));
	} catch (error) {
		return NextResponse.json({ error: error instanceof ZodError ? error.flatten() : "Invalid request" }, { status: 400 });
	}

	await getDb(env)
		.update(contacts)
		.set({ remoteContentAllowed: false })
		.where(and(eq(contacts.userId, auth.user.id), eq(contacts.email, sender.trim().toLowerCase())));
	return NextResponse.json({ senderAllowed: false });
}
