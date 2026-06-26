import Link from "next/link";
import { Home, SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function CoopIndexFallbackPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-6 rounded-full bg-amber-500/10 p-4 text-amber-400">
          <SearchX className="h-10 w-10" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Choose a co-op page</h1>
        <p className="mt-4 text-base text-slate-300">
          Public co-op pages live at addresses like <span className="font-mono text-slate-100">/c/cahootz</span>.
        </p>
        <div className="mt-8">
          <Button asChild className="bg-amber-600 hover:bg-amber-700">
            <Link href="/">
              <Home className="mr-2 h-4 w-4" />
              Back to Home
            </Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
