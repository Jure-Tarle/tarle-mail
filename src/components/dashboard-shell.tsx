"use client";

import { usePathname } from "next/navigation";
import { AdminNav } from "@/components/admin-nav";
import { DashboardNav } from "@/components/dashboard-nav";
import { isAdminRoute } from "@/components/mode-switch-utils";

export function DashboardShellNav() {
	const pathname = usePathname();
	return isAdminRoute(pathname) ? <AdminNav /> : <DashboardNav />;
}
