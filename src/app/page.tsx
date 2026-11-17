import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Bot, CalendarDays, Globe2, HardDrive, Send, ShieldCheck } from "@/components/icons";
import { TarleMailMark } from "@/components/brand/tarle-mail-mark";
import { getServerTranslator } from "@/lib/i18n/server";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { LanguageSelector } from "@/components/language-selector";
import { getHomeBranding } from "./home-server-utils";
import { HomeAuthProvider } from "./home-auth";
import { HomeHeaderActions } from "./home-header-actions";
import { HomeHeroActions } from "./home-hero-actions";
import { LandingMotion } from "./landing-motion";
import { SOURCE_URL } from "./utils";
import { BRAND_ICON_VERSION } from "@/lib/branding/icon-version";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getHomeBranding();
  return {
    title: branding.appName,
    icons: { icon: `${branding.hasCustomIcon ? "/api/branding/icon" : "/icon-96.png"}?v=${BRAND_ICON_VERSION}` },
  };
}

/** A real screenshot of the app, with its dark-mode capture swapped in under the dark theme. */
function ProductShot({ name, alt, priority = false }: { name: "thread" | "mailboxes" | "compose" | "domains" | "usage"; alt: string; priority?: boolean }) {
  return (
    <div className="overflow-hidden rounded-[18px] bg-white shadow-[0_40px_90px_-40px_rgba(29,78,216,0.45)] ring-1 ring-black/5 dark:ring-white/10">
      <img src={`/landing/${name}-light.webp`} alt={alt} width={1600} height={1000} loading={priority ? "eager" : "lazy"} className="block h-auto w-full dark:hidden" />
      <img src={`/landing/${name}-dark.webp`} alt={alt} width={1600} height={1000} loading="lazy" className="hidden h-auto w-full dark:block" />
    </div>
  );
}

/** A feature chapter: copy on one side, a screenshot on the other; stacked with the copy first on small screens. */
function Chapter({ side, title, body, shot }: { side: "left" | "right"; title: string; body: string; shot: React.ReactNode }) {
  const shotFirst = side === "left";
  return (
    <section data-chapter={side} className={`mx-auto mt-28 grid max-w-7xl grid-cols-1 items-center gap-10 px-4 sm:px-6 md:mt-40 lg:gap-16 lg:px-8 ${shotFirst ? "lg:grid-cols-[1.35fr_0.65fr]" : "lg:grid-cols-[0.65fr_1.35fr]"}`}>
      <div className={shotFirst ? "lg:order-2" : undefined}>
        <h2 data-reveal className="text-4xl font-semibold leading-[1.08] tracking-[-0.03em] text-neutral-950 sm:text-5xl">{title}</h2>
        <p data-reveal className="mt-5 max-w-[42ch] text-lg leading-8 text-neutral-600">{body}</p>
      </div>
      <div data-chapter-shot className={shotFirst ? "lg:order-1" : undefined}>{shot}</div>
    </section>
  );
}

export default async function HomePage() {
  const [branding, t, sessionUser] = await Promise.all([
    getHomeBranding(),
    getServerTranslator(),
    // A session lookup failure must not take down the public landing page.
    getCurrentUser(getEnv()).catch(() => null),
  ]);
  // Signed-in users skip the landing page; the inbox restores their last-used mailbox.
  if (sessionUser && !sessionUser.disabled) redirect("/inbox");

  const logo = branding.hasCustomIcon ? (
    <img src="/api/branding/icon" height={28} width={28} alt="" className="h-7 w-7 rounded-lg" />
  ) : (
    <TarleMailMark className="h-8 w-8" />
  );

  return (
    <HomeAuthProvider initialUser={null}>
      <LandingMotion />
      <div className="min-h-[100dvh] overflow-x-clip bg-neutral-50 text-neutral-900">
        <header className="sticky top-0 z-30 border-b border-black/[0.04] bg-neutral-50/75 backdrop-blur-xl backdrop-saturate-150 dark:border-white/[0.06]">
          <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
            <Link href="/" className="flex items-center gap-2.5" aria-label={t("home.homeLabel", { app: branding.appName })}>
              {logo}
              <span className="hidden whitespace-nowrap text-[15px] font-semibold tracking-tight sm:inline">{branding.appName}</span>
            </Link>
            <div className="flex items-center gap-2">
              <div className="hidden sm:block">
                <LanguageSelector variant="text" />
              </div>
              <HomeHeaderActions />
            </div>
          </div>
        </header>

        <main>
          <section className="mx-auto flex max-w-4xl flex-col items-center px-4 pt-16 text-center sm:px-6 md:pt-20">
            <div data-hero-mark className="w-36 sm:w-44">
              <TarleMailMark title={branding.appName} className="h-auto w-full" />
            </div>
            <h1 data-hero-line className="mt-8 max-w-[16ch] text-5xl font-semibold leading-[1.04] tracking-[-0.035em] text-neutral-950 sm:text-6xl lg:text-7xl">
              {t("home.hero.title")}
            </h1>
            <p data-hero-line className="mt-6 max-w-[40ch] text-lg leading-8 text-neutral-600 sm:text-xl">
              {t("home.hero.body")}
            </p>
            <div data-hero-line className="flex flex-col items-center gap-x-6 sm:flex-row">
              <HomeHeroActions />
              <a href={SOURCE_URL} className="mt-4 text-[15px] font-medium text-[#1d4ed8] hover:underline sm:mt-9 dark:text-[#93c5fd]">
                {t("home.source")}
              </a>
            </div>
          </section>

          <section data-product-stage className="mx-auto mt-16 max-w-7xl px-4 [perspective:1600px] sm:px-6 md:mt-24 lg:px-8">
            <div data-product-shot>
              <ProductShot name="thread" alt={t("home.shot.thread")} priority />
            </div>
          </section>

          <Chapter side="right" title={t("home.chapter.inbox.title")} body={t("home.chapter.inbox.body")} shot={<ProductShot name="mailboxes" alt={t("home.shot.mailboxes")} />} />
          <Chapter side="left" title={t("home.chapter.compose.title")} body={t("home.chapter.compose.body")} shot={<ProductShot name="compose" alt={t("home.shot.compose")} />} />

          <section className="mx-auto mt-28 max-w-7xl px-4 sm:px-6 md:mt-40 lg:px-8">
            <div data-chapter="none" className="max-w-3xl">
              <h2 data-reveal className="text-4xl font-semibold leading-[1.08] tracking-[-0.03em] text-neutral-950 sm:text-6xl">{t("home.chapter.private.title")}</h2>
              <p data-reveal className="mt-5 max-w-[52ch] text-lg leading-8 text-neutral-600">{t("home.chapter.private.body")}</p>
            </div>
            <ul data-facts className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {([
                [ShieldCheck, "access", "lg:col-span-2"],
                [HardDrive, "storage", ""],
                [Send, "providers", ""],
                [CalendarDays, "apps", "lg:col-span-2"],
                [Bot, "agents", "lg:col-span-2"],
                [Globe2, "source", ""],
              ] as const).map(([Icon, key, span]) => (
                <li data-fact key={key} className={`flex flex-col rounded-3xl bg-white p-7 ring-1 ring-black/[0.04] dark:ring-white/[0.06] ${span}`}>
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-[#1d4ed8] dark:text-[#93c5fd]">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-6 text-xl font-semibold tracking-[-0.01em] text-neutral-950">{t(`home.feature.${key}.title`)}</h3>
                  <p className="mt-2 max-w-[48ch] text-base leading-7 text-neutral-600">{t(`home.feature.${key}.body`)}</p>
                </li>
              ))}
            </ul>
          </section>

          <Chapter side="right" title={t("home.chapter.domains.title")} body={t("home.chapter.domains.body")} shot={<ProductShot name="domains" alt={t("home.shot.domains")} />} />
          <Chapter side="left" title={t("home.chapter.usage.title")} body={t("home.chapter.usage.body")} shot={<ProductShot name="usage" alt={t("home.shot.usage")} />} />

          <section data-chapter="none" className="mx-auto mt-32 flex max-w-3xl flex-col items-center px-4 pb-28 text-center sm:px-6 md:mt-44">
            <div data-reveal className="w-20">
              <TarleMailMark className="h-auto w-full" />
            </div>
            <h2 data-reveal className="mt-6 text-4xl font-semibold tracking-[-0.03em] text-neutral-950 sm:text-5xl">{t("home.cta.title")}</h2>
            <div data-reveal>
              <HomeHeroActions />
            </div>
          </section>
        </main>

        <footer className="mx-auto flex max-w-7xl flex-col gap-3 border-t border-neutral-200 px-4 py-8 text-sm text-neutral-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <span>{t("home.footer.license")}</span>
          <a href={SOURCE_URL} className="font-medium text-neutral-700 hover:text-neutral-950">
            {t("home.source")}
          </a>
        </footer>
      </div>
    </HomeAuthProvider>
  );
}
