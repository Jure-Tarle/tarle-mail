// BIMI logos are SVG Tiny Portable/Secure (SVG Tiny PS). The checks below follow the main rules of
// that profile and are modelled on OpenInbox (MIT). They validate; they do not sanitize. A logo is
// only ever shown through <img> and served with a sandboxing CSP, so nothing in it can run in the
// app's origin even if a check misses something.

export const BIMI_MAX_SVG_BYTES = 32 * 1024;

const attributes = (tag: string) =>
	new Map([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((m) => [m[1].toLowerCase(), m[2] ?? m[3]]));

/**
 * What must hold for any SVG we store or show, whoever published it: a bounded size, an <svg> root,
 * and nothing that runs, animates, declares entities or reaches other files.
 */
export function checkSvgSafety(svg: string): string | null {
	if (new TextEncoder().encode(svg).length > BIMI_MAX_SVG_BYTES) return "The logo is larger than 32 KB, the size mail apps accept.";
	const source = svg.replace(/<!--[\s\S]*?-->/g, "");
	const root = /<svg\b[^>]*>/i.exec(source);
	if (!root) return "This is not an SVG file.";
	if (source.slice(0, root.index).replace(/<\?xml[^>]*\?>/i, "").trim()) return "Nothing but the XML declaration may come before the <svg> element (no DOCTYPE).";
	if (/<!ENTITY/i.test(source)) return "The logo must not declare entities.";
	if (/<\s*(script|foreignObject|iframe|animate\w*|set)\b/i.test(source)) return "The logo must not contain scripts or animation.";
	if (/\son[a-z]+\s*=/i.test(source)) return "The logo must not contain event handlers.";
	if (/\s(?:xlink:)?href\s*=\s*["'](?!#)/i.test(source) || /url\(\s*["']?(?!#)/i.test(source) || /@import/i.test(source)) {
		return "The logo must not refer to other files or images, only to its own elements.";
	}
	return null;
}

/** The full BIMI profile check for a logo this app publishes; returns the first problem found. */
export function checkBimiSvg(svg: string): string | null {
	const unsafe = checkSvgSafety(svg);
	if (unsafe) return unsafe;
	const source = svg.replace(/<!--[\s\S]*?-->/g, "");
	const attrs = attributes(/<svg\b[^>]*>/i.exec(source)![0]);
	if (attrs.get("baseprofile") !== "tiny-ps" || attrs.get("version") !== "1.2") {
		return 'BIMI needs the SVG Tiny PS profile: the <svg> element must have version="1.2" and baseProfile="tiny-ps".';
	}
	if (attrs.has("x") || attrs.has("y")) return "The <svg> element must not have x or y attributes.";
	const box = attrs.get("viewbox")?.trim().split(/[\s,]+/).map(Number);
	const [width, height] = box?.length === 4 ? [box[2], box[3]] : [parseFloat(attrs.get("width") ?? ""), parseFloat(attrs.get("height") ?? "")];
	if (!(width > 0 && height > 0)) return "The logo needs a viewBox.";
	if (Math.abs(width - height) > 0.01 * width) return "The logo must be square.";
	if (!/<title\b[^>]*>[^<]*\S[^<]*<\/title>/i.test(source)) return "The logo needs a <title> with the brand name.";
	return null;
}
