import { NextResponse } from "next/server";
import { assertPrimaryAdmin } from "@/lib/auth/admin";
import { requireUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { isNodeRuntime } from "@/lib/runtime";
import type {
  GitHubContentResponse,
  PackageMetadata,
  UpdateConfigurationItem,
  UpdateDispatchConfig,
  UpdateStatus,
} from "./types";
import packageMetadata from "../../../../../package.json";

const GITHUB_API_URL = "https://api.github.com";
const GITHUB_API_VERSION = "2026-03-10";
const UPDATE_SOURCE_REPOSITORY = "hieunc229/mailflare";

export async function authorizeAdminRequest(request: Request) {
  const env = getEnv();
  let user: Awaited<ReturnType<typeof requireUser>>;

  try {
    user = await requireUser(env, request);
  } catch {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  try {
    assertPrimaryAdmin(user);
  } catch {
    return {
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { env };
}

function getDispatchConfig(env: CloudflareEnv): UpdateDispatchConfig {
  const token = env.GITHUB_UPDATE_TOKEN?.trim();
  const repository = env.GITHUB_UPDATE_REPO?.trim();
  const ref = env.GITHUB_UPDATE_REF?.trim();

  if (!token) {
    throw new Error("GITHUB_UPDATE_TOKEN must be configured");
  }

  if (!repository) {
    throw new Error(
      "GITHUB_UPDATE_REPO must be configured as owner/repository",
    );
  }

  return { token, repository, ref: ref || undefined };
}

function getUpdateConfiguration(env: CloudflareEnv): UpdateConfigurationItem[] {
  return [
    {
      name: "GITHUB_UPDATE_TOKEN",
      configured: !!env.GITHUB_UPDATE_TOKEN?.trim(),
    },
    {
      name: "GITHUB_UPDATE_REPO",
      configured: !!env.GITHUB_UPDATE_REPO?.trim(),
    },
  ];
}

async function githubRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<{ data?: T; response: Response }> {
  const env = getEnv();

  const response = await fetch(`${GITHUB_API_URL}${path}`, {
    cache: "no-store",
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_UPDATE_TOKEN || ""}`,
      "User-Agent": "mailflare",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      ...init?.headers,
    },
  });

  if (response.statusText === "Forbidden") {
    return {
      response,
      data: { error: response.statusText } as T,
    };
  }

  const data =
    response.status === 204 ? undefined : ((await response.json()) as T);

  return { data, response };
}

function parseVersion(version: string): number[] {
  const normalized = version.trim().replace(/^v/, "").split("-")[0];
  const parts = normalized.split(".");

  if (
    parts.length < 1 ||
    parts.length > 3 ||
    parts.some((part) => !/^\d+$/.test(part))
  ) {
    throw new Error(`Invalid application version: ${version}`);
  }

  return [0, 1, 2].map((index) => Number(parts[index] ?? 0));
}

function isNewerVersion(
  targetVersion: string,
  currentVersion: string,
): boolean {
  const target = parseVersion(targetVersion);
  const current = parseVersion(currentVersion);

  for (let index = 0; index < target.length; index += 1) {
    if (target[index] !== current[index]) {
      return target[index] > current[index];
    }
  }

  return false;
}

async function getTargetVersion(): Promise<string> {
  // const sourceConfig: UpdateDispatchConfig = {
  //   repository: UPDATE_SOURCE_REPOSITORY,
  //   token,
  // };
  // const ref = await getDispatchRef(sourceConfig);
  const { data, response } = await githubRequest<GitHubContentResponse>(
    `/repos/${UPDATE_SOURCE_REPOSITORY}/contents/package.json`,
  );

  if (!response.ok || !data?.content || data.encoding !== "base64") {
    throw new Error(
      data?.message ?? "Could not read the target repository version",
    );
  }

  const dataStr = atob(data.content.replace(/\n/g, ""));

  const packageJson = JSON.parse(dataStr) as PackageMetadata;
  if (!packageJson.version) {
    throw new Error("The target repository package.json has no version");
  }

  return packageJson.version;
}

export async function getUpdateStatus(
  env: CloudflareEnv,
): Promise<UpdateStatus> {
  const currentVersion = packageMetadata.version;

  if (isNodeRuntime(env)) {
    return { configuration: [], configured: false, currentVersion };
  }

  const configuration = getUpdateConfiguration(env);
  const configured = configuration.every((item) => item.configured);

  if (!configured) {
    return {
      configuration,
      configured,
      currentVersion,
    };
  }

  getDispatchConfig(env);
  const targetVersion = await getTargetVersion();

  return {
    available: isNewerVersion(targetVersion, currentVersion),
    configuration,
    configured,
    currentVersion,
    repository: UPDATE_SOURCE_REPOSITORY,
    targetVersion,
  };
}
