'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount, useConnect, useDisconnect, useSignMessage } from 'wagmi';
import { useWeb3Modal } from '@web3modal/wagmi/react';
import { AlertCircle, CheckCircle, Loader2, Mail, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/trpc/client';

type LoginMode = 'email' | 'wallet';
type EmailStep = 'email' | 'code';
type OnboardingStep = 'connect' | 'verify' | 'profile' | 'complete';

const MISSING_COOP_ID_MESSAGE =
  'This login link is missing a commons ID. Please open the login link from your commons portal.';

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
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex items-center gap-3 p-6 text-sm text-gray-600">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading login page...
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!coopId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-2xl">Missing Commons ID</CardTitle>
            <CardDescription>
              We need to know which commons you are signing in to before showing the login form.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-start gap-2 rounded-md bg-red-50 p-3 text-sm text-red-800">
              <AlertCircle className="h-5 w-5 flex-shrink-0" />
              <p>{MISSING_COOP_ID_MESSAGE}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Welcome to {coopName} Portal</CardTitle>
          <CardDescription>
            Sign in with your email, or connect a wallet if you use one.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1">
            <Button
              type="button"
              variant={loginMode === 'email' ? 'default' : 'ghost'}
              className="h-10"
              onClick={() => switchMode('email')}
            >
              <Mail className="mr-2 h-4 w-4" />
              Email
            </Button>
            <Button
              type="button"
              variant={loginMode === 'wallet' ? 'default' : 'ghost'}
              className="h-10"
              onClick={() => switchMode('wallet')}
            >
              <Wallet className="mr-2 h-4 w-4" />
              Wallet
            </Button>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md bg-red-50 p-3 text-sm text-red-800">
              <AlertCircle className="h-5 w-5 flex-shrink-0" />
              <p>{error}</p>
            </div>
          )}

          {loginMode === 'email' && emailStep === 'email' && (
            <form onSubmit={handleRequestEmailCode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <Button type="submit" disabled={isLoading} className="w-full">
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending code...
                  </>
                ) : (
                  'Email me a login code'
                )}
              </Button>
            </form>
          )}

          {loginMode === 'email' && emailStep === 'code' && (
            <form onSubmit={handleVerifyEmailCode} className="space-y-4">
              <div className="rounded-md bg-blue-50 p-3 text-sm text-blue-800">
                We sent a six-digit code to {email}.
                {devLoginCode ? ` Development code: ${devLoginCode}` : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="loginCode">Login code</Label>
                <Input
                  id="loginCode"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="123456"
                  value={loginCode}
                  onChange={(event) => setLoginCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  autoComplete="one-time-code"
                  required
                />
              </div>
              <Button type="submit" disabled={isLoading || loginCode.length !== 6} className="w-full">
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
              <div className="flex items-center justify-between">
                <div className="flex flex-col items-center">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-full ${
                    currentStep === 'connect' ? 'bg-blue-600 text-white' :
                    ['verify', 'profile', 'complete'].includes(currentStep) ? 'bg-green-600 text-white' :
                    'bg-gray-300 text-gray-600'
                  }`}>
                    {['verify', 'profile', 'complete'].includes(currentStep) ? <CheckCircle className="h-5 w-5" /> : '1'}
                  </div>
                  <span className="mt-1 text-xs">Connect</span>
                </div>
                <div className="mx-2 h-0.5 flex-1 bg-gray-300" />
                <div className="flex flex-col items-center">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-full ${
                    currentStep === 'verify' ? 'bg-blue-600 text-white' :
                    ['profile', 'complete'].includes(currentStep) ? 'bg-green-600 text-white' :
                    'bg-gray-300 text-gray-600'
                  }`}>
                    {['profile', 'complete'].includes(currentStep) ? <CheckCircle className="h-5 w-5" /> : '2'}
                  </div>
                  <span className="mt-1 text-xs">Verify</span>
                </div>
                <div className="mx-2 h-0.5 flex-1 bg-gray-300" />
                <div className="flex flex-col items-center">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-full ${
                    currentStep === 'profile' ? 'bg-blue-600 text-white' :
                    currentStep === 'complete' ? 'bg-green-600 text-white' :
                    'bg-gray-300 text-gray-600'
                  }`}>
                    {currentStep === 'complete' ? <CheckCircle className="h-5 w-5" /> : '3'}
                  </div>
                  <span className="mt-1 text-xs">Profile</span>
                </div>
              </div>

              {currentStep === 'connect' && (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">
                    Connect your Ethereum wallet if you already use one for {coopName}.
                  </p>
                  <Button onClick={handleConnectWallet} disabled={isLoading} className="w-full">
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
                  <div className="rounded-md bg-blue-50 p-3">
                    <p className="text-sm text-blue-800">
                      <strong>Wallet Connected:</strong> {address?.slice(0, 6)}...{address?.slice(-4)}
                    </p>
                  </div>
                  <p className="text-sm text-gray-600">
                    Sign a message to verify your wallet ownership.
                  </p>
                  <Button onClick={handleVerifyGovernanceToken} disabled={isLoading} className="w-full">
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
                  <div className="rounded-md bg-green-50 p-3">
                    <p className="text-sm text-green-800">
                      Your wallet is verified.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="name">Full Name *</Label>
                    <Input
                      id="name"
                      type="text"
                      placeholder="John Doe"
                      value={profileData.name}
                      onChange={(event) => setProfileData({ ...profileData, name: event.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="profileEmail">Email *</Label>
                    <Input
                      id="profileEmail"
                      type="email"
                      placeholder="john@example.com"
                      value={profileData.email}
                      onChange={(event) => setProfileData({ ...profileData, email: event.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phoneNumber">Phone Number *</Label>
                    <Input
                      id="phoneNumber"
                      type="tel"
                      placeholder="(123) 456-7890"
                      value={profileData.phoneNumber}
                      onChange={(event) => setProfileData({ ...profileData, phoneNumber: event.target.value })}
                      required
                    />
                  </div>
                  <Button type="submit" disabled={isLoading} className="w-full">
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
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                    <CheckCircle className="h-10 w-10 text-green-600" />
                  </div>
                  <h3 className="text-lg font-semibold">All Set!</h3>
                  <p className="text-sm text-gray-600">
                    You can now access the portal.
                  </p>
                  <Button onClick={handleComplete} className="w-full">
                    Go to Portal
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
