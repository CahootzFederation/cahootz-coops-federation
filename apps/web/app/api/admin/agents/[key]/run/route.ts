import { NextResponse } from 'next/server';
import { getSession } from '@/lib/signature-verification';
import { isPlatformAdminWallet, isPlatformAdminEmail } from '@repo/trpc/lib/admin-config';
import { getAgent } from '@repo/trpc/agents/registry';

/**
 * Runs a registered agent with form input from the admin playground.
 * This calls the real OpenAI API (via the Agents SDK) and costs real
 * money per call - kept behind the same platform-admin session gate as
 * the rest of /portal/admin.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const session = await getSession();

  if (!session || !(isPlatformAdminWallet(session.address) || isPlatformAdminEmail(session.email))) {
    return NextResponse.json({ error: 'Platform admin access required' }, { status: 403 });
  }

  const { key } = await params;
  const agent = getAgent(key);

  if (!agent) {
    return NextResponse.json({ error: `No agent registered with key "${key}"` }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = agent.inputSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const output = await agent.run(parsed.data);
    return NextResponse.json({ output });
  } catch (error) {
    console.error(`[admin-agents] "${key}" run failed:`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Agent run failed.' },
      { status: 500 }
    );
  }
}
