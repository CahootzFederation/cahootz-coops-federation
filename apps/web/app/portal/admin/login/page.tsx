'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useWeb3Auth } from '@/hooks/use-web3-auth';

type Step = 'email' | 'code';

export default function AdminLoginPage() {
  const router = useRouter();
  const { checkAuth } = useWeb3Auth();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/admin/auth/request-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to send login code.');
      }
      setStep('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send login code.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/admin/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'That code is invalid or expired.');
      }
      await checkAuth();
      router.push('/portal/admin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code is invalid or expired.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Admin Sign In</h1>
        <p className="mt-1 text-sm text-slate-400">
          Enter an allowlisted admin email to receive a one-time code.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-[8px] border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {step === 'email' && (
        <form onSubmit={requestCode} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="admin-email" className="text-slate-300">Email address</Label>
            <Input
              id="admin-email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="bg-white text-slate-900 placeholder:text-slate-400"
            />
          </div>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Email me a login code'}
          </Button>
        </form>
      )}

      {step === 'code' && (
        <form onSubmit={verifyCode} className="space-y-4">
          <p className="text-sm text-slate-400">
            Enter the six-digit code sent to <span className="text-white">{email}</span>.
          </p>
          <div className="space-y-2">
            <Label htmlFor="admin-code" className="text-slate-300">Login code</Label>
            <Input
              id="admin-code"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              required
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              className="bg-white text-slate-900 placeholder:text-slate-400"
            />
          </div>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verify & Sign In'}
          </Button>
          <button
            type="button"
            className="text-sm text-slate-400 underline"
            onClick={() => { setStep('email'); setCode(''); setError(null); }}
          >
            Use a different email
          </button>
        </form>
      )}
    </div>
  );
}
