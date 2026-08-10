"use client";

import { useState } from "react";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, DollarSign, Coins } from "lucide-react";
import { api } from "@/lib/trpc/client";
import CheckoutForm from "@/components/buy/checkout-form";
import { env } from "@/env";

// Load Stripe publishable key from environment
const stripePromise = loadStripe(
  env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || ""
);

const PRESET_AMOUNTS = [25, 50, 100, 250];

export default function BuyPage() {
  const [amount, setAmount] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [transactionId, setTransactionId] = useState("");
  const [isCreatingIntent, setIsCreatingIntent] = useState(false);
  const [error, setError] = useState("");

  const createPaymentIntentMutation = api.onramp.createPaymentIntent.useMutation();

  const handleAmountChange = (value: string) => {
    // Only allow numbers and decimal point
    if (value === "" || /^\d*\.?\d{0,2}$/.test(value)) {
      setAmount(value);
      setError("");
    }
  };

  const handleCreatePaymentIntent = async () => {
    const amountUSD = parseFloat(amount);

    // Validation
    if (!amountUSD || amountUSD < 10) {
      setError("Minimum purchase is $10");
      return;
    }

    if (amountUSD > 10000) {
      setError("Maximum purchase is $10,000");
      return;
    }

    setIsCreatingIntent(true);
    setError("");

    try {
      const result = await createPaymentIntentMutation.mutateAsync({
        amountUSD,
        processor: "stripe",
      });

      setClientSecret(result.clientSecret);
      setTransactionId(result.transactionId);
    } catch (err) {
      console.error("Error creating payment intent:", err);
      setError(
        err instanceof Error ? err.message : "Failed to initialize payment. Please try again."
      );
    } finally {
      setIsCreatingIntent(false);
    }
  };

  const handleReset = () => {
    setClientSecret("");
    setTransactionId("");
    setAmount("");
    setError("");
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-950 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amber-500/10 mb-4">
            <Coins className="w-8 h-8 text-amber-500" />
          </div>
          <h1 className="text-4xl font-bold text-white mb-2">Buy Unity Coins</h1>
          <p className="text-slate-400">
            Purchase UC tokens to participate in the commons economy
          </p>
        </div>

        {!clientSecret ? (
          // Amount selection screen
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white">Enter Amount</CardTitle>
              <CardDescription className="text-slate-400">
                Choose how many Unity Coins you want to purchase
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Preset amounts */}
              <div>
                <Label className="text-slate-400 mb-3 block">Quick Select</Label>
                <div className="grid grid-cols-4 gap-2">
                  {PRESET_AMOUNTS.map((preset) => (
                    <Button
                      key={preset}
                      variant={amount === preset.toString() ? "default" : "outline"}
                      onClick={() => setAmount(preset.toString())}
                      className={
                        amount === preset.toString()
                          ? "bg-amber-500 hover:bg-amber-600 text-white"
                          : "border-slate-600 text-slate-300 hover:bg-slate-700"
                      }
                    >
                      ${preset}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Custom amount */}
              <div>
                <Label className="text-slate-400 mb-2 block">Custom Amount</Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                  <Input
                    type="text"
                    placeholder="Enter amount"
                    value={amount}
                    onChange={(e) => handleAmountChange(e.target.value)}
                    className="pl-10 bg-slate-900 border-slate-600 text-white text-lg h-12"
                  />
                </div>
              </div>

              {/* UC preview */}
              {amount && parseFloat(amount) >= 10 && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                  <p className="text-amber-100 text-sm mb-1">You will receive</p>
                  <p className="text-amber-400 text-3xl font-bold">
                    {parseFloat(amount).toFixed(2)} UC
                  </p>
                  <p className="text-amber-200/60 text-xs mt-1">1 UC = 1 USD</p>
                </div>
              )}

              {/* Info */}
              <div className="bg-slate-900 rounded-lg p-4 space-y-1 text-sm text-slate-400">
                <p>• Minimum: $10 USD</p>
                <p>• Maximum: $10,000 USD</p>
                <p>• Processing time: Instant</p>
                <p>• Payment method: Credit/Debit Card</p>
              </div>

              {/* Error */}
              {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
              )}

              {/* Continue button */}
              <Button
                onClick={handleCreatePaymentIntent}
                disabled={
                  isCreatingIntent ||
                  !amount ||
                  parseFloat(amount) < 10 ||
                  parseFloat(amount) > 10000
                }
                className="w-full bg-amber-500 hover:bg-amber-600 text-white h-12 text-lg font-semibold"
              >
                {isCreatingIntent ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Initializing...
                  </>
                ) : (
                  `Continue to Payment`
                )}
              </Button>
            </CardContent>
          </Card>
        ) : (
          // Payment form screen
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret,
              appearance: {
                theme: "night",
                variables: {
                  colorPrimary: "#f59e0b",
                  colorBackground: "#1e293b",
                  colorText: "#ffffff",
                  colorDanger: "#ef4444",
                  fontFamily: "system-ui, sans-serif",
                  borderRadius: "8px",
                },
              },
            }}
          >
            <CheckoutForm
              amount={parseFloat(amount)}
              transactionId={transactionId}
              onReset={handleReset}
            />
          </Elements>
        )}

        {/* Security notice */}
        <div className="mt-6 text-center">
          <p className="text-slate-500 text-sm">
            🔒 Payments are processed securely through Stripe
          </p>
          <p className="text-slate-600 text-xs mt-1">
            Your payment information is never stored on our servers
          </p>
        </div>
      </div>
    </div>
  );
}
