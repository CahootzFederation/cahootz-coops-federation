import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type React from "react";

interface SiteShellProps {
  children: React.ReactNode;
}

export function SiteShell({ children }: SiteShellProps) {
  return (
    <div className="min-h-screen bg-[#111111] text-white">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#111111]/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#f59e0b] text-lg font-black text-[#111111]">
              C
            </div>
            <div className="flex flex-col">
              <span className="text-xl font-bold leading-tight tracking-tight">
                Cahootz
              </span>
              <span className="text-xs leading-tight text-slate-400">
                Cooperative network
              </span>
            </div>
          </Link>

          <nav className="hidden items-center gap-8 text-sm md:flex">
            <Link href="/#features" className="text-slate-400 transition hover:text-white">
              Features
            </Link>
            <Link href="/blog" className="text-slate-400 transition hover:text-white">
              Blog
            </Link>
            <Link href="/#join" className="text-slate-400 transition hover:text-white">
              Join
            </Link>
          </nav>

          <Link
            href="/#join"
            className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-[#111111] transition hover:bg-[#f59e0b]"
          >
            Apply now
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </header>

      {children}

      <footer className="border-t border-white/10 bg-[#111111] px-5 py-10 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-5 md:flex-row">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f59e0b] font-black text-[#111111]">
              C
            </div>
            <span className="font-bold">Cahootz</span>
          </div>
          <div className="flex flex-col items-center gap-3 text-center md:items-end md:text-right">
            <p className="text-sm text-slate-400">
              The community platform for co-ops that want local spending, governance, and ownership in one loop.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4 md:justify-end">
              <Link
                href="/terms"
                className="text-sm font-semibold text-slate-300 transition hover:text-white"
              >
                Terms
              </Link>
              <Link
                href="/privacy"
                className="text-sm font-semibold text-slate-300 transition hover:text-white"
              >
                Privacy Policy
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
