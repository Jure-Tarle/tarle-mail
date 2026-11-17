/** Whisper's own input rate: speech loses nothing, and a minute stays under 2 MB. */
const TARGET_RATE = 16_000;

/**
 * Re-encodes a browser recording as 16 kHz mono 16-bit WAV. Workers AI's speech model rejects the
 * WebM container Chrome and Firefox record in, while WAV works everywhere; the browser decodes its
 * own recording, so this needs no codec of its own. Returns null if the browser cannot decode it.
 */
export async function recordingToWav(recording: Blob): Promise<Blob | null> {
	try {
		const decoder = new AudioContext();
		const decoded = await decoder.decodeAudioData(await recording.arrayBuffer());
		await decoder.close();
		const frames = Math.max(1, Math.ceil(decoded.duration * TARGET_RATE));
		const offline = new OfflineAudioContext(1, frames, TARGET_RATE);
		const source = offline.createBufferSource();
		source.buffer = decoded;
		source.connect(offline.destination);
		source.start();
		const samples = (await offline.startRendering()).getChannelData(0);

		const buffer = new ArrayBuffer(44 + samples.length * 2);
		const view = new DataView(buffer);
		const text = (offset: number, value: string) => { for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index)); };
		text(0, "RIFF");
		view.setUint32(4, 36 + samples.length * 2, true);
		text(8, "WAVE");
		text(12, "fmt ");
		view.setUint32(16, 16, true);
		view.setUint16(20, 1, true);
		view.setUint16(22, 1, true);
		view.setUint32(24, TARGET_RATE, true);
		view.setUint32(28, TARGET_RATE * 2, true);
		view.setUint16(32, 2, true);
		view.setUint16(34, 16, true);
		text(36, "data");
		view.setUint32(40, samples.length * 2, true);
		for (let index = 0; index < samples.length; index++) {
			const sample = Math.max(-1, Math.min(1, samples[index]));
			view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
		}
		return new Blob([buffer], { type: "audio/wav" });
	} catch {
		return null;
	}
}
