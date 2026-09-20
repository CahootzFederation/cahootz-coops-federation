import { redirect } from "next/navigation";
import { env } from "@/env";
import { getSession } from "@/lib/signature-verification";
import { isPlatformAdminEmail, isPlatformAdminWallet } from "@repo/trpc/lib/admin-config";
import { issueCommonsAdminToken } from "@repo/trpc/lib/commons-admin-token";
import CommonsAIClient from "./commons-ai-client";

export default async function CommonsAIPage() {
  const session = await getSession();
  if (!session) redirect("/portal/admin/login");
  if (!isPlatformAdminEmail(session.email) && !isPlatformAdminWallet(session.address)) redirect("/portal/admin");
  const token = issueCommonsAdminToken({ userId: session.userId, email: session.email, address: session.address });
  const configuredApiUrl = (env.NEXT_PUBLIC_API_URL || "http://localhost:3001/trpc").replace(/\/$/, "");
  const apiUrl = configuredApiUrl.endsWith("/trpc") ? configuredApiUrl : `${configuredApiUrl}/trpc`;
  return <CommonsAIClient apiUrl={apiUrl} token={token} />;
}
