import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, HardDrive, Mail, ShieldCheck, Bot } from "@/components/icons";
import { TarleMailMark } from "@/components/brand/tarle-mail-mark";
import { getServerTranslator } from "@/lib/i18n/server";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { LanguageSelector } from "@/components/language-selector";
import { getHomeBranding } from "./home-server-utils";
import { HomeAuthProvider } from "./home-auth";
import { HomeHeaderActions } from "./home-header-actions";
import { HomeHeroActions } from "./home-hero-actions";
import { SOURCE_URL } from "./utils";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getHomeBranding();
  return {
    title: branding.appName,
    icons: { icon: branding.hasCustomIcon ? "/api/branding/icon" : "/icon-96.png" },
  };
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
    <img src="/api/branding/icon" height={32} width={32} alt="" className="h-8 w-8 rounded-lg" />
  ) : (
    <TarleMailMark className="h-8 w-8" />
  );

  return (
    <HomeAuthProvider initialUser={null}>
      <div className="min-h-[100dvh] bg-neutral-50 text-neutral-900">
        <header className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3" aria-label={t("home.homeLabel", { app: branding.appName })}>
            {logo}
            <span className="hidden text-base font-semibold tracking-tight sm:inline">{branding.appName}</span>
          </Link>
          <div className="flex items-center gap-2">
            <div className="hidden sm:block">
              <LanguageSelector variant="text" />
            </div>
            <HomeHeaderActions />
          </div>
        </header>

        <main>
          <section className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-4 pb-16 pt-10 sm:px-6 md:pt-16 lg:grid-cols-[1.25fr_0.75fr] lg:px-8 lg:pb-24">
            <div className="tm-rise flex max-w-2xl flex-col">
              <p className="mb-5 text-sm font-semibold text-[#c2410c] dark:text-[#f0805f]">{t("home.hero.eyebrow")}</p>
              <h1 className="text-4xl font-semibold leading-[1.05] tracking-tight text-neutral-950 sm:text-5xl xl:text-[3.5rem]">
                {t("home.hero.title")}
              </h1>
              <p className="mt-6 max-w-[46ch] text-lg leading-8 text-neutral-600">{t("home.hero.body")}</p>
              <HomeHeroActions />
            </div>

            <div className="tm-rise tm-rise-delay relative mx-auto aspect-square w-full max-w-[420px]">
              <div className="absolute inset-0 rounded-[28%] bg-[#0f1b2d]/[0.06] dark:bg-white/[0.04]" />
              <div className="absolute inset-[9%] rounded-[26%] bg-[#0f1b2d]/[0.08] dark:bg-white/[0.06]" />
              <TarleMailMark title={branding.appName} className="absolute inset-[18%] h-[64%] w-[64%] drop-shadow-[0_30px_60px_rgba(15,27,45,0.28)]" />
            </div>
          </section>

          <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6 lg:px-8">
            <h2 className="max-w-[24ch] text-3xl font-semibold tracking-tight text-neutral-950 sm:text-4xl">{t("home.features.title")}</h2>
            <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
              <article className="flex min-h-56 flex-col justify-between rounded-2xl bg-[#0f1b2d] p-7 text-[#f4f6f9] md:col-span-2">
                <Mail className="h-7 w-7 text-[#f0805f]" />
                <div>
                  <h3 className="text-2xl font-semibold tracking-tight">{t("home.feature.mail.title")}</h3>
                  <p className="mt-2 max-w-[52ch] leading-7 text-[#f4f6f9]/75">{t("home.feature.mail.body")}</p>
                </div>
              </article>
              <article className="flex min-h-56 flex-col justify-between rounded-2xl bg-white p-7 ring-1 ring-neutral-200">
                <CalendarDays className="h-7 w-7 text-neutral-500" />
                <div>
                  <h3 className="text-xl font-semibold tracking-tight text-neutral-950">{t("home.feature.calendar.title")}</h3>
                  <p className="mt-2 leading-7 text-neutral-600">{t("home.feature.calendar.body")}</p>
                </div>
              </article>
              <article className="flex min-h-56 flex-col justify-between rounded-2xl bg-white p-7 ring-1 ring-neutral-200">
                <HardDrive className="h-7 w-7 text-neutral-500" />
                <div>
                  <h3 className="text-xl font-semibold tracking-tight text-neutral-950">{t("home.feature.drive.title")}</h3>
                  <p className="mt-2 leading-7 text-neutral-600">{t("home.feature.drive.body")}</p>
                </div>
              </article>
              <article className="flex min-h-56 flex-col justify-between rounded-2xl bg-[#fdebe5] p-7 dark:bg-[#3a1d14]">
                <ShieldCheck className="h-7 w-7 text-[#c2410c] dark:text-[#f0805f]" />
                <div>
                  <h3 className="text-xl font-semibold tracking-tight text-neutral-950">{t("home.feature.access.title")}</h3>
                  <p className="mt-2 leading-7 text-neutral-700">{t("home.feature.access.body")}</p>
                </div>
              </article>
              <article className="flex min-h-56 flex-col justify-between rounded-2xl bg-white p-7 ring-1 ring-neutral-200">
                <Bot className="h-7 w-7 text-neutral-500" />
                <div>
                  <h3 className="text-xl font-semibold tracking-tight text-neutral-950">{t("home.feature.apps.title")}</h3>
                  <p className="mt-2 leading-7 text-neutral-600">{t("home.feature.apps.body")}</p>
                </div>
              </article>
            </div>
          </section>
        </main>

        <footer className="mx-auto flex max-w-6xl flex-col gap-3 border-t border-neutral-200 px-4 py-8 text-sm text-neutral-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <span className="flex items-center gap-2">
            <TarleMailMark className="h-5 w-5" />
            {t("home.footer.license")}
          </span>
          <a href={SOURCE_URL} className="font-medium text-neutral-700 hover:text-neutral-950">
            {t("home.source")}
          </a>
        </footer>
      </div>
    </HomeAuthProvider>
  );
}
