import type { MetadataRoute } from "next";
import { BRAND_ICON_VERSION } from "@/lib/branding/icon-version";

export default function manifest(): MetadataRoute.Manifest {
	return {
		name: "Tarle Mail",
		short_name: "Tarle Mail",
		description: "Email, anywhere.",
		id: "/",
		scope: "/",
		start_url: "/inbox",
		display: "standalone",
		background_color: "#ffffff",
		theme_color: "#ffffff",
		icons: [
			{ src: `/icon-192.png?v=${BRAND_ICON_VERSION}`, sizes: "192x192", type: "image/png" },
			{ src: `/icon-512.png?v=${BRAND_ICON_VERSION}`, sizes: "512x512", type: "image/png" },
		],
	};
}
