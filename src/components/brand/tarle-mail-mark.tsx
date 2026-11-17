/**
 * The Tarle Mail mark: a glossy blue envelope with a letter in it. The artwork lives in
 * public/brand/tarle-mail-mark.svg, which is also the source of the app icons
 * (regenerate them with `node scripts/generate-icons.mjs`).
 */
export function TarleMailMark({ className, title }: { className?: string; title?: string }) {
	return <img src="/brand/tarle-mail-mark.svg" alt={title ?? ""} aria-hidden={title ? undefined : true} className={className} draggable={false} />;
}
