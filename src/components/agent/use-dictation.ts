"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/auth/client";
import { recordingToWav } from "./wav-encode";

export type DictationState = "idle" | "recording" | "transcribing";

/** Three minutes keeps a recording well under the server's size limit. */
const MAX_RECORDING_MS = 3 * 60 * 1000;

function pickMimeType(): string | undefined {
	// Whatever the browser records best; it is re-encoded as WAV before upload anyway.
	for (const type of ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]) {
		if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) return type;
	}
	return undefined;
}

export function isDictationSupported(): boolean {
	return typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

/**
 * Records speech in the browser and turns it into text on the server (Workers AI Whisper).
 * `toggle` starts a recording or stops it and transcribes; `cancel` drops it.
 */
export function useDictation({ language, onText, onError }: { language: string; onText: (text: string) => void; onError: (message: string) => void }) {
	const [state, setState] = useState<DictationState>("idle");
	const recorder = useRef<MediaRecorder | null>(null);
	const chunks = useRef<Blob[]>([]);
	const discard = useRef(false);
	const limitTimer = useRef<number | null>(null);
	const callbacks = useRef({ onText, onError });
	useEffect(() => { callbacks.current = { onText, onError }; });

	const release = () => {
		if (limitTimer.current) window.clearTimeout(limitTimer.current);
		limitTimer.current = null;
		recorder.current?.stream.getTracks().forEach((track) => track.stop());
		recorder.current = null;
	};

	useEffect(() => () => { discard.current = true; if (recorder.current?.state === "recording") recorder.current.stop(); release(); }, []);

	const transcribe = useCallback(async (recording: Blob) => {
		setState("transcribing");
		try {
			// WebM (Chrome, Firefox) is not accepted by the speech model, so every recording goes up as WAV.
			const blob = (await recordingToWav(recording)) ?? recording;
			const response = await authFetch(`/api/agent/transcribe?language=${encodeURIComponent(language)}`, {
				method: "POST",
				headers: { "Content-Type": blob.type || "application/octet-stream" },
				body: blob,
			});
			const data = (await response.json().catch(() => ({}))) as { text?: string; error?: string };
			if (!response.ok) throw new Error(data.error ?? "Speech could not be recognised");
			if (data.text) callbacks.current.onText(data.text);
		} catch (error) {
			callbacks.current.onError(error instanceof Error ? error.message : "Speech could not be recognised");
		} finally {
			setState("idle");
		}
	}, [language]);

	const start = useCallback(async () => {
		let stream: MediaStream;
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch {
			callbacks.current.onError("microphone");
			return;
		}
		const mimeType = pickMimeType();
		const next = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
		chunks.current = [];
		discard.current = false;
		next.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
		next.onstop = () => {
			const blob = new Blob(chunks.current, { type: next.mimeType || mimeType || "audio/webm" });
			release();
			if (discard.current || blob.size === 0) { setState("idle"); return; }
			void transcribe(blob);
		};
		recorder.current = next;
		next.start();
		setState("recording");
		limitTimer.current = window.setTimeout(() => { if (next.state === "recording") next.stop(); }, MAX_RECORDING_MS);
	}, [transcribe]);

	const toggle = useCallback(() => {
		if (state === "recording") recorder.current?.stop();
		else if (state === "idle") void start();
	}, [start, state]);

	const cancel = useCallback(() => {
		discard.current = true;
		if (recorder.current?.state === "recording") recorder.current.stop();
		else release();
		setState("idle");
	}, []);

	return { state, toggle, cancel };
}
