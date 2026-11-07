"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

const SCRewardsHybrid = dynamic(
  () => import("@/components/portal/sc-rewards-hybrid"),
  {
    loading: () => (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    ),
    ssr: false,
  },
);

export default function SCRewardsPage() {
  return <SCRewardsHybrid />;
}
