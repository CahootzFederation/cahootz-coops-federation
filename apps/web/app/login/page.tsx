'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useAccount, useConnect, useDisconnect, useSignMessage } from 'wagmi';
import { useWeb3Modal } from '@web3modal/wagmi/react';
import { AlertCircle, ArrowRight, CheckCircle, Loader2, Mail, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/trpc/client';

type LoginMode = 'email' | 'wallet';
type EmailStep = 'email' | 'code';
type OnboardingStep = 'connect' | 'verify' | 'profile' | 'complete';

const MISSING_COOP_ID_MESSAGE =
  'This login link is missing a commons ID. Please open the login link from your commons portal.';

function AuthMessage({
  tone,
  children,
}: {
  tone: 'error' | 'info' | 'success';
  children: React.ReactNode;
}) {
  const toneClass = {
    error: 'border-red-200 bg-red-50 text-red-800',
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  }[tone];

  const Icon = tone === 'error' ? AlertCircle : CheckCircle;

  return (
    <div className={`flex items-start gap-3 rounded-[8px] border p-3 text-sm leading-6 ${toneClass}`}>
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function LoginShell({
  coopName,
  children,
}: {
  coopName: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen overflow-x-clip bg-[#f7f0e4] text-slate-950">
      <div className="grid min-h-screen lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="flex min-h-[320px] flex-col justify-between bg-[#111827] px-6 py-8 text-white sm:px-10 lg:min-h-screen lg:px-12 lg:py-12">
          <div className="flex items-center gap-3">
            <Image
              src="/cahootz-coops-mark.svg"
              alt="Cahootz"
              width={42}
              height={42}
              className="rounded-[8px] bg-white p-2"
              priority
            />
            <div>
              <p className="text-xs font-black uppercase tracking-normal text-orange-200">Cahootz Commons</p>
              <p className="text-sm font-semibold text-slate-300">{coopName} Portal</p>
            </div>
          </div>

          <div className="max-w-xl py-10 lg:py-0">
            <p className="mb-4 text-sm font-black uppercase tracking-normal text-orange-200">Member access</p>
            <h1 className="text-4xl font-black leading-[1.05] tracking-normal text-white sm:text-5xl">
              Enter the portal with the identity your commons knows.
            </h1>
            <p className="mt-6 max-w-md text-base leading-7 text-slate-300">
              Use a one-time email code for everyday access, or verify a wallet for governance and operator work.
            </p>
          </div>

          <div className="grid gap-3 text-sm text-slate-300 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            <div className="border-t border-white/15 pt-3">
              <p className="font-bold text-white">Email code</p>
              <p className="mt-1 leading-5">No password to remember.</p>
            </div>
            <div className="border-t border-white/15 pt-3">
              <p className="font-bold text-white">Wallet verify</p>
              <p className="mt-1 leading-5">For token-gated access.</p>
            </div>
            <div className="border-t border-white/15 pt-3">
              <p className="font-bold text-white">Commons scoped</p>
              <p className="mt-1 leading-5">Matched to this portal link.</p>
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center px-5 py-8 sm:px-8 lg:px-12">
          <div className="w-full max-w-[460px]">{children}</div>
        </section>
      </div>
    </main>
  );
}

function ModeButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof Mail;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-11 items-center justify-center gap-2 rounded-[8px] px-3 text-sm font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 ${
        active
          ? 'bg-slate-950 text-white shadow-sm'
          : 'text-slate-600 hover:bg-white hover:text-slate-950'
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function WalletStep({
  complete,
  current,
  label,
  step,
}: {
  complete: boolean;
  current: boolean;
  label: string;
  step: number;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
      <div
        className={`flex h-9 w-9 items-center justify-center rounded-full border text-sm font-black ${
          complete
            ? 'border-emerald-600 bg-emerald-600 text-white'
            : current
              ? 'border-slate-950 bg-slate-950 text-white'
              : 'border-slate-200 bg-white text-slate-500'
        }`}
      >
        {complete ? <CheckCircle className="h-4 w-4" /> : step}
      </div>
      <span className="text-xs font-bold text-slate-600">{label}</span>
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { open } = useWeb3Modal();
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { signMessageAsync } = useSignMessage();
  const { disconnect } = useDisconnect();

  const [loginMode, setLoginMode] = useState<LoginMode>('email');
  const [emailStep, setEmailStep] = useState<EmailStep>('email');
  const [email, setEmail] = useState('');
  const [loginCode, setLoginCode] = useState('');
  const [devLoginCode, setDevLoginCode] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('connect');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [_hasGovernanceToken, setHasGovernanceToken] = useState(false);
  const [coopId, setCoopId] = useState<string | null>(null);
  const [isCheckingCoopId, setIsCheckingCoopId] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const coopIdParam = params.get('coopId')?.trim();
    if (coopIdParam) {
      setCoopId(coopIdParam);
    } else {
      setError(MISSING_COOP_ID_MESSAGE);
    }
    setIsCheckingCoopId(false);
  }, []);

  const { data: coopConfig } = api.coopConfig.getActive.useQuery(
    { coopId: coopId ?? '' },
    { enabled: !!coopId }
  );

  const [profileData, setProfileData] = useState({
    name: '',
    email: '',
    phoneNumber: '',
  });

  useEffect(() => {
    if (isConnected && address && currentStep === 'connect') {
      setCurrentStep('verify');
      setLoginMode('wallet');
    }
  }, [isConnected, address, currentStep]);

  const coopName = coopConfig?.name || 'Commons';

  const requireCoopId = () => {
    if (coopId) {
      return coopId;
    }

    setError(MISSING_COOP_ID_MESSAGE);
    return null;
  };

  const switchMode = (mode: LoginMode) => {
    setLoginMode(mode);
    setError(null);
    setDevLoginCode(null);
  };

  const handleRequestEmailCode = async (event: React.FormEvent) => {
    event.preventDefault();
    const targetCoopId = requireCoopId();
    if (!targetCoopId) return;

    setIsLoading(true);
    setError(null);
    setDevLoginCode(null);

    try {
      const response = await fetch('/api/auth/email/request-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, coopId: targetCoopId }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to send login code');
      }

      setEmailStep('code');
      if (data.debugCode) {
        setDevLoginCode(data.debugCode);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to send login code');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyEmailCode = async (event: React.FormEvent) => {
    event.preventDefault();
    const targetCoopId = requireCoopId();
    if (!targetCoopId) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/email/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: loginCode, coopId: targetCoopId }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to verify login code');
      }

      router.push(`/portal/${data.activeCoopId || targetCoopId}`);
    } catch (err: any) {
      setError(err.message || 'Failed to verify login code');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConnectWallet = async () => {
    try {
      setError(null);
      await open();
    } catch (err: any) {
      try {
        const injectedConnector =
          connectors.find((connector) => connector.id === 'injected') ||
          connectors.find((connector) => connector.name.toLowerCase().includes('metamask'));

        if (!injectedConnector) {
          throw err;
        }

        await connectAsync({ connector: injectedConnector });
      } catch (fallbackError: any) {
        setError(fallbackError.message || err.message || 'Failed to connect wallet');
      }
    }
  };

  const handleVerifyGovernanceToken = async () => {
    const targetCoopId = requireCoopId();
    if (!targetCoopId) return;

    if (!address) {
      setError('No wallet connected');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const challengeResponse = await fetch('/api/auth/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });

      if (!challengeResponse.ok) {
        const errorData = await challengeResponse.json();
        throw new Error(errorData.error || 'Failed to get challenge');
      }

      const { message } = await challengeResponse.json();
      const signature = await signMessageAsync({ message });

      const verifyResponse = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, signature, message, coopId: targetCoopId }),
      });

      if (!verifyResponse.ok) {
        const errorData = await verifyResponse.json();
        throw new Error(errorData.error || 'Failed to verify signature');
      }

      const { hasProfile } = await verifyResponse.json();

      setHasGovernanceToken(true);

      if (hasProfile) {
        setCurrentStep('complete');
        router.push(`/portal/${targetCoopId}`);
      } else {
        setCurrentStep('profile');
      }
    } catch (err: any) {
      console.error('Verification error:', err);
      setError(err.message || 'Failed to verify governance token');
      disconnect();
      setCurrentStep('connect');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    const targetCoopId = requireCoopId();
    if (!targetCoopId) return;

    if (!address) {
      setError('No wallet connected');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      if (!profileData.name || !profileData.email || !profileData.phoneNumber) {
        throw new Error('Please fill in all required fields');
      }

      const response = await fetch('/api/auth/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: address,
          coopId: targetCoopId,
          ...profileData,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create profile');
      }

      setCurrentStep('complete');
    } catch (err: any) {
      setError(err.message || 'Failed to create profile');
    } finally {
      setIsLoading(false);
    }
  };

  const handleComplete = () => {
    const targetCoopId = requireCoopId();
    if (!targetCoopId) return;

    router.push(`/portal/${targetCoopId}`);
  };

  if (isCheckingCoopId) {
    return (
      <LoginShell coopName="Commons">
        <div className="rounded-[8px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3 text-sm font-semibold text-slate-600">
            <Loader2 className="h-5 w-5 animate-spin text-orange-600" />
            Loading portal access...
          </div>
        </div>
      </LoginShell>
    );
  }

  if (!coopId) {
    return (
      <LoginShell coopName="Commons">
        <div className="rounded-[8px] border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-black uppercase tracking-normal text-orange-700">Portal link required</p>
          <h2 className="mt-3 text-2xl font-black tracking-normal text-slate-950">Missing commons ID</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Open the login link from your commons portal so Cahootz can route you to the right space.
          </p>
          <div className="mt-5">
            <AuthMessage tone="error">
              <p>{MISSING_COOP_ID_MESSAGE}</p>
            </AuthMessage>
          </div>
        </div>
      </LoginShell>
    );
  }

  return (
    <LoginShell coopName={coopName}>
      <div className="rounded-[8px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-6">
          <p className="text-sm font-black uppercase tracking-normal text-orange-700">{coopName} Portal</p>
          <h2 className="mt-3 text-3xl font-black tracking-normal text-slate-950">Sign in</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Choose the access method tied to your commons membership.
          </p>
        </div>

        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-1 rounded-[8px] border border-slate-200 bg-slate-100 p-1">
            <ModeButton
              active={loginMode === 'email'}
              icon={Mail}
              label="Email"
              onClick={() => switchMode('email')}
            />
            <ModeButton
              active={loginMode === 'wallet'}
              icon={Wallet}
              label="Wallet"
              onClick={() => switchMode('wallet')}
            />
          </div>

          {error && (
            <AuthMessage tone="error">
              <p>{error}</p>
            </AuthMessage>
          )}

          {loginMode === 'email' && emailStep === 'email' && (
            <form onSubmit={handleRequestEmailCode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-bold text-slate-800">
                  Email address
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  className="h-12 rounded-[8px] border-slate-300 bg-white text-base"
                  required
                />
              </div>
              <Button
                type="submit"
                disabled={isLoading}
                className="h-12 w-full rounded-[8px] bg-slate-950 text-sm font-black text-white hover:bg-slate-800"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending code...
                  </>
                ) : (
                  <>
                    Email me a login code
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </form>
          )}

          {loginMode === 'email' && emailStep === 'code' && (
            <form onSubmit={handleVerifyEmailCode} className="space-y-4">
              <AuthMessage tone="info">
                <p>
                  We sent a six-digit code to <span className="font-bold">{email}</span>.
                  {devLoginCode ? ` Development code: ${devLoginCode}` : null}
                </p>
              </AuthMessage>
              <div className="space-y-2">
                <Label htmlFor="loginCode" className="text-sm font-bold text-slate-800">
                  Login code
                </Label>
                <Input
                  id="loginCode"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="123456"
                  value={loginCode}
                  onChange={(event) => setLoginCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  autoComplete="one-time-code"
                  className="h-12 rounded-[8px] border-slate-300 bg-white text-center text-lg font-black tracking-[0.2em]"
                  required
                />
              </div>
              <Button
                type="submit"
                disabled={isLoading || loginCode.length !== 6}
                className="h-12 w-full rounded-[8px] bg-slate-950 text-sm font-black text-white hover:bg-slate-800"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  'Sign in'
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setEmailStep('email');
                  setLoginCode('');
                  setDevLoginCode(null);
                  setError(null);
                }}
              >
                Use a different email
              </Button>
            </form>
          )}

          {loginMode === 'wallet' && (
            <div className="space-y-5">
              <div className="flex items-start gap-2">
                <WalletStep
                  step={1}
                  label="Connect"
                  current={currentStep === 'connect'}
                  complete={['verify', 'profile', 'complete'].includes(currentStep)}
                />
                <div className="mt-4 h-px flex-1 bg-slate-200" />
                <WalletStep
                  step={2}
                  label="Verify"
                  current={currentStep === 'verify'}
                  complete={['profile', 'complete'].includes(currentStep)}
                />
                <div className="mt-4 h-px flex-1 bg-slate-200" />
                <WalletStep
                  step={3}
                  label="Profile"
                  current={currentStep === 'profile'}
                  complete={currentStep === 'complete'}
                />
              </div>

              {currentStep === 'connect' && (
                <div className="space-y-4">
                  <p className="text-sm leading-6 text-slate-600">
                    Connect your Ethereum wallet if you already use one for {coopName}.
                  </p>
                  <Button
                    onClick={handleConnectWallet}
                    disabled={isLoading}
                    className="h-12 w-full rounded-[8px] bg-slate-950 text-sm font-black text-white hover:bg-slate-800"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Connecting...
                      </>
                    ) : (
                      'Connect Wallet'
                    )}
                  </Button>
                </div>
              )}

              {currentStep === 'verify' && (
                <div className="space-y-4">
                  <AuthMessage tone="info">
                    <p>
                      <strong>Wallet Connected:</strong> {address?.slice(0, 6)}...{address?.slice(-4)}
                    </p>
                  </AuthMessage>
                  <p className="text-sm leading-6 text-slate-600">
                    Sign a message to verify your wallet ownership.
                  </p>
                  <Button
                    onClick={handleVerifyGovernanceToken}
                    disabled={isLoading}
                    className="h-12 w-full rounded-[8px] bg-slate-950 text-sm font-black text-white hover:bg-slate-800"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      'Sign & Verify'
                    )}
                  </Button>
                </div>
              )}

              {currentStep === 'profile' && (
                <form onSubmit={handleCreateProfile} className="space-y-4">
                  <AuthMessage tone="success">
                    <p>Your wallet is verified.</p>
                  </AuthMessage>
                  <div className="space-y-2">
                    <Label htmlFor="name" className="text-sm font-bold text-slate-800">Full Name *</Label>
                    <Input
                      id="name"
                      type="text"
                      placeholder="John Doe"
                      value={profileData.name}
                      onChange={(event) => setProfileData({ ...profileData, name: event.target.value })}
                      className="h-12 rounded-[8px] border-slate-300 bg-white"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="profileEmail" className="text-sm font-bold text-slate-800">Email *</Label>
                    <Input
                      id="profileEmail"
                      type="email"
                      placeholder="john@example.com"
                      value={profileData.email}
                      onChange={(event) => setProfileData({ ...profileData, email: event.target.value })}
                      className="h-12 rounded-[8px] border-slate-300 bg-white"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phoneNumber" className="text-sm font-bold text-slate-800">Phone Number *</Label>
                    <Input
                      id="phoneNumber"
                      type="tel"
                      placeholder="(123) 456-7890"
                      value={profileData.phoneNumber}
                      onChange={(event) => setProfileData({ ...profileData, phoneNumber: event.target.value })}
                      className="h-12 rounded-[8px] border-slate-300 bg-white"
                      required
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={isLoading}
                    className="h-12 w-full rounded-[8px] bg-slate-950 text-sm font-black text-white hover:bg-slate-800"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Creating Profile...
                      </>
                    ) : (
                      'Create Profile'
                    )}
                  </Button>
                </form>
              )}

              {currentStep === 'complete' && (
                <div className="space-y-4 text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[8px] bg-emerald-50">
                    <CheckCircle className="h-9 w-9 text-emerald-600" />
                  </div>
                  <h3 className="text-lg font-black tracking-normal text-slate-950">All set</h3>
                  <p className="text-sm leading-6 text-slate-600">
                    You can now access the portal.
                  </p>
                  <Button
                    onClick={handleComplete}
                    className="h-12 w-full rounded-[8px] bg-slate-950 text-sm font-black text-white hover:bg-slate-800"
                  >
                    Go to Portal
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </LoginShell>
  );
}
