"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3,
  ClipboardList,
  Coins,
  FileText,
  Grid3X3,
  Landmark,
  LogOut,
  Menu,
  Settings,
  Store,
  Users,
  Vote,
  Wallet,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { useCoin } from "@/hooks/use-platform-config";
import { useWeb3Auth } from "@/hooks/use-web3-auth";

interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const dashboardLink: NavItem = {
  title: "Dashboard",
  href: "/portal",
  icon: BarChart3,
};

const memberLinks: NavItem[] = [
  dashboardLink,
  {
    title: "Members",
    href: "/portal/members",
    icon: Users,
  },
  {
    title: "Proposals",
    href: "/portal/proposals",
    icon: Vote,
  },
  {
    title: "Settings",
    href: "/portal/settings",
    icon: Settings,
  },
];

const adminReviewLinks: NavItem[] = [
  {
    title: "Applications",
    href: "/portal/applications",
    icon: ClipboardList,
  },
  {
    title: "Apps",
    href: "/portal/apps",
    icon: Grid3X3,
  },
  {
    title: "Rules",
    href: "/portal/proposals/config",
    icon: FileText,
  },
];

const commerceLinks: NavItem[] = [
  {
    title: "Stores",
    href: "/portal/stores",
    icon: Store,
  },
  {
    title: "Treasury",
    href: "/portal/treasury",
    icon: Landmark,
  },
  {
    title: "Wealth Fund",
    href: "/portal/wealth-fund",
    icon: Wallet,
  },
  {
    title: "Rewards",
    href: "/portal/sc-rewards",
    icon: Coins,
  },
];

export function PortalNav({ coopId }: { coopId?: string }) {
  const pathname = usePathname();
  const { logout, isAdmin, adminRole, address } = useWeb3Auth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const coin = useCoin(coopId);
  const [navOpen, setNavOpen] = useState(false);
  const { data: coopConfig } = api.coopConfig.getActive.useQuery(
    { coopId: coopId ?? "" },
    { enabled: !!coopId }
  );
  const coopName = coopConfig?.name || "Portal";
  
  // Get current user info
  const { data: currentUser } = api.user.getUserByWallet.useQuery(
    { walletAddress: address || "", coopId },
    { enabled: !!address }
  );

  // Prefix all nav links with coopId if provided
  const prefixHref = (href: string) => {
    if (!coopId) return href;
    return `/portal/${coopId}${href.replace("/portal", "")}`;
  };

  const isActive = (href: string) => {
    const path = prefixHref(href);
    if (href === "/portal") {
      return pathname === path;
    }
    if (href === "/portal/proposals" && pathname.startsWith(`${path}/config`)) {
      return false;
    }
    return pathname === path || pathname.startsWith(`${path}/`);
  };

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  const handleLogout = async () => {
    if (isLoggingOut) return;

    setIsLoggingOut(true);
    try {
      await logout(coopId);
    } catch (error) {
      console.error("Error logging out:", error);
    } finally {
      setIsLoggingOut(false);
    }
  };

  const renderLink = (item: NavItem, tone: "member" | "admin") => {
    const Icon = item.icon;
    const active = isActive(item.href);

    return (
      <Link
        key={item.href}
        href={prefixHref(item.href)}
        className={cn(
          "group flex min-w-fit items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
          active
            ? tone === "admin"
              ? "border-amber-400/40 bg-amber-400/10 text-amber-100"
              : "border-emerald-400/40 bg-emerald-400/10 text-emerald-100"
            : "border-transparent text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-100"
        )}
      >
        <Icon
          className={cn(
            "h-4 w-4",
            active
              ? tone === "admin"
                ? "text-amber-300"
                : "text-emerald-300"
              : "text-zinc-500 group-hover:text-zinc-300"
          )}
        />
        <span className="font-medium">{item.title}</span>
      </Link>
    );
  };

  const renderGroup = (
    label: string,
    items: NavItem[],
    tone: "member" | "admin"
  ) => (
    <div className="min-w-0 space-y-1">
      <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-600">
        {label}
      </p>
      <div className="flex flex-wrap gap-2 rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-1.5">
        {items.map((item) => renderLink(item, tone))}
      </div>
    </div>
  );

  const navGroups: {
    label: string;
    items: NavItem[];
    tone: "member" | "admin";
  }[] = [
    { label: "Workspace", items: memberLinks, tone: "member" },
    ...(isAdmin
      ? [
          { label: "Admin", items: adminReviewLinks, tone: "admin" as const },
          { label: "Money & commerce", items: commerceLinks, tone: "admin" as const },
        ]
      : []),
  ];

  const activeNavItem =
    navGroups.flatMap((group) => group.items).find((item) => isActive(item.href)) ??
    dashboardLink;
  const ActiveIcon = activeNavItem.icon;

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-[#0b0d10]/95 text-white backdrop-blur">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex min-h-16 flex-col gap-3 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center justify-between gap-4">
            <Link href={prefixHref("/portal")} className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-amber-500 text-sm font-bold text-zinc-950">
                {coin.symbol}
              </div>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold leading-5">Co-op Portal</p>
                <p className="truncate text-xs text-zinc-500">{coopName}</p>
              </div>
            </Link>

            <div className="flex shrink-0 items-center gap-3 lg:hidden">
              {isAdmin && (
                <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-100">
                  Admin
                </Badge>
              )}
              <button
                onClick={handleLogout}
                disabled={isLoggingOut}
                className="rounded-md border border-zinc-800 p-2 text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-white disabled:opacity-50"
                title="Logout"
              >
                <LogOut className={cn("h-4 w-4", isLoggingOut && "animate-pulse")} />
              </button>
            </div>
          </div>

          <div className="hidden items-center gap-3 lg:flex">
            <div className="text-right">
              <div className="flex items-center justify-end gap-2">
                <p className="max-w-48 truncate text-sm font-medium text-zinc-100">
                  {currentUser?.name || "User"}
                </p>
                <Badge
                  className={cn(
                    "border",
                    isAdmin
                      ? "border-amber-400/30 bg-amber-400/10 text-amber-100"
                      : "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
                  )}
                >
                  {isAdmin ? "Admin" : "Member"}
                </Badge>
              </div>
              <p className="max-w-80 truncate text-xs text-zinc-500">
                {currentUser?.email || "No email set"}
                {isAdmin && adminRole ? ` • ${adminRole}` : ""}
              </p>
            </div>
            <button
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="rounded-md border border-zinc-800 p-2 text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-white disabled:opacity-50"
              title="Logout"
            >
              <LogOut className={cn("h-4 w-4", isLoggingOut && "animate-pulse")} />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-zinc-900 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950 text-zinc-400">
              <ActiveIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-600">
                Current page
              </p>
              <p className="truncate text-sm font-semibold text-zinc-100">
                {activeNavItem.title}
              </p>
            </div>
          </div>

          <button
            type="button"
            aria-expanded={navOpen}
            aria-controls="portal-navigation-menu"
            onClick={() => setNavOpen((open) => !open)}
            className="flex shrink-0 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-900 hover:text-white"
          >
            {navOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            {navOpen ? "Hide navigation" : "Navigation"}
          </button>
        </div>

        {navOpen && (
          <nav
            id="portal-navigation-menu"
            className={cn(
              "grid gap-3 pb-3",
              isAdmin
                ? "lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.75fr)_minmax(0,1.3fr)]"
                : "lg:grid-cols-1"
            )}
          >
            {navGroups.map((group) => renderGroup(group.label, group.items, group.tone))}
          </nav>
        )}
      </div>
    </header>
  );
}
