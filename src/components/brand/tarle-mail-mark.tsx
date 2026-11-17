/**
 * The Tarle Mail mark: an envelope whose wide top edge and accent stem read as a "T".
 * Keep in sync with public/brand/tarle-mail-mark.svg, the source of the app icons
 * (regenerate them with `node scripts/generate-icons.mjs`).
 */
export function TarleMailMark({ className, title }: { className?: string; title?: string }) {
	return (
		<svg viewBox="0 0 512 512" className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
			<rect width="512" height="512" rx="112" fill="#0F1B2D" />
			<g fill="none" strokeLinecap="round" strokeLinejoin="round">
				<path d="M140 186V346H372V186" stroke="#F4F6F9" strokeWidth="26" />
				<path d="M150 196L256 280L362 196" stroke="#F4F6F9" strokeWidth="26" />
				<path d="M116 166H396" stroke="#F4F6F9" strokeWidth="40" />
				<path d="M256 300V346" stroke="#EE5A33" strokeWidth="36" />
			</g>
		</svg>
	);
}
