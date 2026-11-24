"use client";

import { useLanguage } from "@/components/language-provider";
import { useEffect, useRef, useState } from "react";
import { prepareReaderEmailHtml } from "@/lib/remote-images/reader";
import { collapseQuotedEmailHtml } from "@/app/(dashboard)/inbox/[messageId]/quote-collapse-utils";

const BASE_STYLE = `
:host { display:block; min-width:0; isolation:isolate; contain:paint; }
:host(.mf-dark) { filter:invert(1) hue-rotate(180deg); }
:host(.mf-dark) img, :host(.mf-dark) video, :host(.mf-dark) picture { filter:invert(1) hue-rotate(180deg); }
.email-quote-toggle { margin-top:1.4em; }
.email-quote-toggle > summary { cursor:pointer; list-style:none; width:26px; border-radius:20px; background:#ececec; text-align:center; }
.email-quote-toggle > summary::-webkit-details-marker { display:none; }
.email-quote-toggle > summary::before { content:'•••'; }
.email-quote-content { display:flow-root; }
:host(.mf-dense) p { margin-top:0; }
`;

/** Below this an email stays at this scale and scrolls sideways, because the text would be too small. */
const MIN_FIT_SCALE = 0.5;

export function EmailHtmlRenderer({ html, className, dense = false, preserveLeadingQuote = false, autoAllowRemote = false, onAllowRemote }: {
	html: string; className?: string;
	/** Tighter block spacing for short internal text such as notes. */
	dense?: boolean;
	preserveLeadingQuote?: boolean;
	/** Load remote content without a click; the reader can still block it. */
	autoAllowRemote?: boolean;
	/** Called when the reader chooses to load remote content. */
	onAllowRemote?: () => void;
}) {
	const { t } = useLanguage();
	const quoteToggleLabel = t("message.quote.toggle");
	const host = useRef<HTMLDivElement>(null);
	const [choice, setChoice] = useState<{ source: string; allow: boolean } | null>(null);
	const [hasRemote, setHasRemote] = useState(false);
	const allowRemote = choice?.source === html ? choice.allow : autoAllowRemote;
	// Mail is authored for white paper. Under the dark theme it is inverted
	// (images inverted back) instead of glaring as a white slab.
	useEffect(() => {
		const root = document.documentElement;
		const sync = () => host.current?.classList.toggle("mf-dark", root.classList.contains("dark"));
		sync();
		const observer = new MutationObserver(sync);
		observer.observe(root, { attributes: true, attributeFilter: ["class"] });
		return () => observer.disconnect();
	}, []);
	useEffect(() => {
		if (!host.current) return;
		host.current.dir = document.documentElement.dir || "ltr";
		const root = host.current.shadowRoot ?? host.current.attachShadow({ mode: "open" });
		const prepared = prepareReaderEmailHtml(html, {
			reader: true,
			allowRemote,
			proxyRemote: document.documentElement.dataset.remoteImageProxy !== "disabled",
		});
		setHasRemote(prepared.hasRemote);
		const base = document.createElement("style");
		base.textContent = `${BASE_STYLE}\n${prepared.rootTag} { display:block; font:14px/1.5 Arial,sans-serif; color:#202124; background:#fff; color-scheme:light; }\n${prepared.bodyTag} { display:block; }\n:host(.mf-dark) ${prepared.rootTag} { background:transparent; }\n:host(.mf-dense) ${prepared.rootTag} { background:transparent; }`;
		const content = document.createElement("template");
		content.innerHTML = collapseQuotedEmailHtml(prepared.html, preserveLeadingQuote, quoteToggleLabel) ?? "";
		root.replaceChildren(base, content.content);
		const mailBody = root.querySelector(prepared.bodyTag);
		// An LTR scroller cannot reach left-side overflow from an RTL email.
		if (mailBody) host.current.dir = window.getComputedStyle(mailBody).direction;
		// Newsletters are often laid out for a fixed width (600px tables, wide banners). Like Apple Mail
		// and Gmail, shrink such an email to fit the reading pane instead of scrolling it sideways; the
		// scroller stays only for the rare email that would become unreadably small.
		const hostElement = host.current;
		const mailRoot = root.querySelector<HTMLElement>(prepared.rootTag);
		let fittedWidth = -1;
		const fit = () => {
			if (!mailRoot) return;
			const available = hostElement.clientWidth;
			mailRoot.style.zoom = "";
			const natural = mailRoot.scrollWidth;
			fittedWidth = available;
			if (!available || natural <= available + 1) return;
			mailRoot.style.zoom = String(Math.max(MIN_FIT_SCALE, available / natural));
		};
		fit();
		// Re-fit when the pane changes width, and when images arrive and widen the layout.
		const resize = new ResizeObserver(() => { if (hostElement.clientWidth !== fittedWidth) fit(); });
		resize.observe(hostElement);
		root.addEventListener("load", fit, true);
		// Document fragment navigation does not automatically find IDs inside a shadow tree.
		const navigate = (event: Event) => {
			const target = event.target as Element | null;
			const anchor = target?.closest("a[href]");
			const href = anchor?.getAttribute("href");
			if (!href?.startsWith("#")) return;
			event.preventDefault();
			try {
				const id = decodeURIComponent(href.slice(1));
				const destination = root.getElementById(id) ?? Array.from(root.querySelectorAll("a[name]")).find(node => node.getAttribute("name") === id);
				destination?.scrollIntoView({ block: "start" });
			} catch { /* Ignore malformed fragments. */ }
		};
		root.addEventListener("click", navigate);
		return () => {
			root.removeEventListener("click", navigate);
			root.removeEventListener("load", fit, true);
			resize.disconnect();
		};
	}, [html, allowRemote, preserveLeadingQuote, quoteToggleLabel]);
	return <div className={`min-w-0 max-w-full ${className ?? ""}`}>
		{hasRemote && <div className="mb-2 flex justify-end">
			<button type="button" aria-pressed={allowRemote} className="rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-50"
				onClick={() => {
					if (!allowRemote) onAllowRemote?.();
					setChoice({ source: html, allow: !allowRemote });
				}}>
				{allowRemote ? null : t("message.allowRemote")}
			</button>
		</div>}
		<div className={`max-w-full overflow-x-auto${dense ? " mf-dense" : ""}`} ref={host} />
	</div>;
}
