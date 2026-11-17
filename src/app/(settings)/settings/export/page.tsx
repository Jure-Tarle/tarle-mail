"use client";

import { useState } from "react";
import { Download } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { Button } from "@/components/ui/button";
import { SettingsPanel } from "@/components/ui/settings-panel";
import type { ExportState } from "./types";
import { exportMailbox } from "./utils";

export default function SettingsExportPage() {
	const { t } = useLanguage();
	const { selectedMailbox } = useSelectedMailbox();
	const [exportState, setExportState] = useState<ExportState>({ error: null, loading: false });

	async function onExport() {
		if (!selectedMailbox?.id) return;
		setExportState({ error: null, loading: true });
		try {
			await exportMailbox(selectedMailbox.id, `${selectedMailbox.localPart}.mbox`);
		} catch (error) {
			setExportState({ error: error instanceof Error ? error.message : t("export.failed"), loading: false });
			return;
		}
		setExportState({ error: null, loading: false });
	}

	return (
		<div className="space-y-6">
			<h1 className="sr-only">{t("settings.nav.export")}</h1>
			<SettingsPanel title={t("export.title")} description={t("export.description")}>
				<Button type="button" variant="outline" disabled={!selectedMailbox || exportState.loading} onClick={onExport}>
					{exportState.loading ? t("export.preparing") : t("export.download")}
				</Button>
				{exportState.error && (
					<p className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
						{exportState.error}
					</p>
				)}
			</SettingsPanel>
		</div>
	);
}
