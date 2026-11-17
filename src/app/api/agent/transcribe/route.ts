import { getEnv } from "@/lib/cloudflare";
import { getCurrentUser } from "@/lib/auth/cookies";
import { hasValidSessionMutationOrigin } from "@/lib/auth/origin";
import { allowAgentRequest } from "@/lib/agent/rate-limit";
import { getAgentEnabled } from "@/lib/agent/provider";

/** Speech recognition runs on Cloudflare Workers AI, so dictation needs no extra key and the audio stays in the account. */
const TRANSCRIPTION_MODEL = "@cf/openai/whisper-large-v3-turbo";
/** About five minutes of compressed speech; the browser stops recording well before this. */
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

function toBase64(bytes: Uint8Array): string {
	let binary = "";
	for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
	return btoa(binary);
}

/**
 * Turns a recorded voice note from the assistant input into text. The body is the raw audio from
 * the browser's MediaRecorder (WebM/Opus or MP4/AAC); `?language=` is the interface language,
 * because the model otherwise assumes English.
 */
export async function POST(request: Request) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
	if (!hasValidSessionMutationOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
	if (!env.AI) return Response.json({ error: "Dictation needs Cloudflare Workers AI" }, { status: 503 });
	if (!(await getAgentEnabled(env))) return Response.json({ error: "The assistant is turned off" }, { status: 403 });
	if (!await allowAgentRequest(env, `transcribe:${user.id}`)) return Response.json({ error: "Rate limit exceeded" }, { status: 429 });

	const declared = Number(request.headers.get("content-length") ?? 0);
	if (declared > MAX_AUDIO_BYTES) return Response.json({ error: "The recording is too long" }, { status: 413 });
	const audio = new Uint8Array(await request.arrayBuffer());
	if (audio.byteLength === 0) return Response.json({ error: "No audio received" }, { status: 400 });
	if (audio.byteLength > MAX_AUDIO_BYTES) return Response.json({ error: "The recording is too long" }, { status: 413 });

	const language = new URL(request.url).searchParams.get("language")?.toLowerCase().split("-")[0];
	try {
		const result = await env.AI.run(TRANSCRIPTION_MODEL, {
			audio: toBase64(audio),
			task: "transcribe",
			...(language && /^[a-z]{2}$/.test(language) ? { language } : {}),
			vad_filter: true,
		} as never) as { text?: string };
		return Response.json({ text: (result.text ?? "").trim() }, { headers: { "Cache-Control": "no-store" } });
	} catch (error) {
		console.error("transcribe", error);
		return Response.json({ error: "Speech could not be recognised" }, { status: 502 });
	}
}
