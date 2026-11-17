import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheck, HardDrive, Globe2 } from "@/components/icons";
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

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getHomeBranding();
  return {
    title: branding.appName,
    icons: { icon: branding.hasCustomIcon ? "/api/branding/icon" : "/icon-96.png" },
  };
}

/** A real screenshot of the app, with its dark-mode capture swapped in under the dark theme. */
function ProductShot({ name, alt, priority = false }: { name: "thread" | "inbox" | "domains"; alt: string; priority?: boolean }) {
  return (
    <div className="overflow-hidden rounded-[18px] bg-white shadow-[0_40px_90px_-40px_rgba(29,78,216,0.45)] ring-1 ring-black/5 dark:ring-white/10">
      <img src={`/landing/${name}-light.webp`} alt={alt} width={1600} height={1000} loading={priority ? "eager" : "lazy"} className="block h-auto w-full dark:hidden" />
      <img src={`/landing/${name}-dark.webp`} alt={alt} width={1600} height={1000} loading="lazy" className="hidden h-auto w-full dark:block" />
    </div>
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
          <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
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

          <section data-product-stage className="mx-auto mt-16 max-w-6xl px-4 [perspective:1600px] sm:px-6 md:mt-24 lg:px-8">
            <div data-product-shot>
              <ProductShot name="thread" alt={t("home.shot.thread")} priority />
            </div>
          </section>

          <section data-chapter="right" className="mx-auto mt-28 grid max-w-6xl grid-cols-1 items-center gap-10 px-4 sm:px-6 md:mt-40 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
            <div className="max-w-md">
              <h2 data-reveal className="text-4xl font-semibold leading-[1.08] tracking-[-0.03em] text-neutral-950 sm:text-5xl">{t("home.chapter.inbox.title")}</h2>
              <p data-reveal className="mt-5 text-lg leading-8 text-neutral-600">{t("home.chapter.inbox.body")}</p>
            </div>
            <div data-chapter-shot>
              <ProductShot name="inbox" alt={t("home.shot.inbox")} />
            </div>
          </section>

          <section className="mx-auto mt-28 max-w-5xl px-4 text-center sm:px-6 md:mt-40 lg:px-8">
            <div data-chapter="none">
              <h2 data-reveal className="mx-auto max-w-[18ch] text-4xl font-semibold leading-[1.08] tracking-[-0.03em] text-neutral-950 sm:text-6xl">{t("home.chapter.private.title")}</h2>
              <p data-reveal className="mx-auto mt-5 max-w-[46ch] text-lg leading-8 text-neutral-600">{t("home.chapter.private.body")}</p>
            </div>
            <ul data-facts className="mx-auto mt-14 grid max-w-4xl grid-cols-1 gap-10 text-left sm:grid-cols-3">
              {([
                [ShieldCheck, "home.fact.access"],
                [HardDrive, "home.fact.storage"],
                [Globe2, "home.fact.source"],
              ] as const).map(([Icon, key]) => (
                <li data-fact key={key} className="border-t border-neutral-200 pt-5">
                  <Icon className="h-6 w-6 text-[#1d4ed8] dark:text-[#93c5fd]" />
                  <p className="mt-3 text-base font-medium leading-7 text-neutral-800">{t(key)}</p>
                </li>
              ))}
            </ul>
          </section>

          <section data-chapter="left" className="mx-auto mt-28 grid max-w-6xl grid-cols-1 items-center gap-10 px-4 sm:px-6 md:mt-40 lg:grid-cols-[1.2fr_0.8fr] lg:px-8">
            <div data-chapter-shot className="order-2 lg:order-1">
              <ProductShot name="domains" alt={t("home.shot.domains")} />
            </div>
            <div className="order-1 max-w-md lg:order-2">
              <h2 data-reveal className="text-4xl font-semibold leading-[1.08] tracking-[-0.03em] text-neutral-950 sm:text-5xl">{t("home.chapter.domains.title")}</h2>
              <p data-reveal className="mt-5 text-lg leading-8 text-neutral-600">{t("home.chapter.domains.body")}</p>
            </div>
          </section>

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

        <footer className="mx-auto flex max-w-6xl flex-col gap-3 border-t border-neutral-200 px-4 py-8 text-sm text-neutral-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <span>{t("home.footer.license")}</span>
          <a href={SOURCE_URL} className="font-medium text-neutral-700 hover:text-neutral-950">
            {t("home.source")}
          </a>
        </footer>
      </div>
    </HomeAuthProvider>
  );
}
