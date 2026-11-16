import { NextResponse } from "next/server";
import { authorizeAdminRequest } from "./utils";

// Upstream's one-click update replaced the whole repository with hieunc229/mailflare, which would
// drop this fork's changes. Upstream releases are merged by hand instead (docs/upstream-sync.md).
export async function POST(request: Request) {
	const authorization = await authorizeAdminRequest(request);
	if ("error" in authorization) return authorization.error;
	return NextResponse.json(
		{ error: "This installation is a fork. Merge upstream releases into its repository and redeploy (see docs/upstream-sync.md)." },
		{ status: 400 },
	);
}
