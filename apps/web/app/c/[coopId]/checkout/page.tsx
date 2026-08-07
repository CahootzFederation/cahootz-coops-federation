"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, CheckCircle2, XCircle, Store, BadgeCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useCart } from "@/contexts/cart-context";
import { api } from "@/lib/trpc/client";
import { useWeb3Auth } from "@/hooks/use-web3-auth";
import { usePostHog } from "posthog-js/react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { env } from "@/env";

const stripePromise = loadStripe(env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);

interface ShippingAddressFields {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

const emptyShippingAddress: ShippingAddressFields = {
  line1: "",
  line2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "US",
};

function formatStatus(value?: string | null) {
  if (!value) return "No commons membership";
  return value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function getStatusClasses(value?: string | null) {
  switch (value) {
    case "ACTIVE":
    case "APPROVED":
      return "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300";
    case "PENDING":
    case "SUBMITTED":
    case "UNDER_REVIEW":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "REJECTED":
    case "SUSPENDED":
      return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
    default:
      return "border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";
  }
}

function shortenAddress(address?: string | null) {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatCurrencyFromCents(cents?: number | null) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format((cents ?? 0) / 100);
}

function formatScAmount(amount?: number | null) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(amount ?? 0);
}

function formatShippingAddress(address: ShippingAddressFields) {
  const street = [address.line1.trim(), address.line2.trim()].filter(Boolean).join(", ");
  const region = [address.state.trim(), address.postalCode.trim()].filter(Boolean).join(" ");
  const locality = [address.city.trim(), region].filter(Boolean).join(", ");

  return [street, locality, address.country.trim()].filter(Boolean).join("\n");
}

function normalizeShippingAddress(address: ShippingAddressFields): ShippingAddressFields {
  return {
    line1: address.line1.trim(),
    line2: address.line2.trim(),
    city: address.city.trim(),
    state: address.state.trim(),
    postalCode: address.postalCode.trim(),
    country: address.country.trim() || "US",
  };
}

function CheckoutForm({
  coopId,
  clientSecret,
  onSuccess,
}: {
  coopId: string;
  clientSecret: string;
  onSuccess: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsProcessing(true);
    setErrorMessage("");

    try {
      const { paymentIntent, error: retrieveError } = await stripe.retrievePaymentIntent(clientSecret);

      if (paymentIntent?.status === "succeeded") {
        onSuccess();
        return;
      }

      if (paymentIntent?.status === "processing") {
        setErrorMessage("Your payment is still processing. Wait a moment and check your order status before trying again.");
        return;
      }

      if (retrieveError) {
        setErrorMessage(retrieveError.message || "Could not check payment status. Please try again.");
        return;
      }

      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/c/${coopId}/checkout/success`,
        },
        redirect: "if_required",
      });

      if (error) {
        const paymentStatus = error.payment_intent?.status;
        if (paymentStatus === "succeeded") {
          onSuccess();
          return;
        }

        console.error("Stripe payment error:", error);
        setErrorMessage(error.message || "Payment failed. Please try again.");
      } else {
        onSuccess();
      }
    } catch (err) {
      console.error("Payment error:", err);
      setErrorMessage("An unexpected error occurred. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <PaymentElement />
      <Button
        type="submit"
        size="lg"
        className="w-full bg-[var(--coop-accent)] text-[var(--coop-accent-foreground)] hover:opacity-90 transition-opacity"
        disabled={!stripe || isProcessing}
      >
        {isProcessing ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Processing...
          </>
        ) : (
          "Complete Payment"
        )}
      </Button>
      {errorMessage && (
        <p className="text-sm text-red-500">{errorMessage}</p>
      )}
    </form>
  );
}

export default function CheckoutPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const coopId = params.coopId as string;
  const storeId = searchParams.get("storeId");
  const posthog = usePostHog();
  const checkoutStartedFired = useRef(false);

  const auth = useWeb3Auth();
  const { getStoreItems, clearStoreItems } = useCart();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isCreatingCheckout, setIsCreatingCheckout] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [storeInfo, setStoreInfo] = useState<{
    name: string;
    isScVerified: boolean;
    businessId: string | null;
  } | null>(null);
  const [guestEmail, setGuestEmail] = useState("");
  const [guestName, setGuestName] = useState("");
  const [shippingAddress, setShippingAddress] = useState<ShippingAddressFields>(emptyShippingAddress);
  const [needsGuestInfo, setNeedsGuestInfo] = useState(false);

  const cartItems = storeId ? getStoreItems(storeId) : [];
  const subtotal = cartItems.reduce(
    (sum, item) => sum + item.priceUSD * item.quantity,
    0
  );
  const subtotalCents = Math.round(subtotal * 100);
  const updateShippingAddress = (field: keyof ShippingAddressFields, value: string) => {
    setShippingAddress((current) => ({
      ...current,
      [field]: value,
    }));
  };

  // Fetch store details to get businessId
  const { data: storeData, isLoading: storeLoading } = api.store.getStore.useQuery(
    { storeId: storeId || "" },
    { enabled: !!storeId }
  );

  const createCheckoutMutation = api.commerce.createCheckout.useMutation();
  const createMemberCheckoutMutation = api.commerce.createMemberCheckout.useMutation();
  const { data: checkoutUser, isLoading: userStatusLoading } = api.user.getUserByWallet.useQuery(
    { walletAddress: auth.address || "", coopId },
    { enabled: auth.isAuthenticated && !!auth.address }
  );
  const isIdentityLoading = auth.isLoading || (auth.isAuthenticated && userStatusLoading);
  const isSignedInCheckout = auth.isAuthenticated && !!checkoutUser?.id;
  const previewCheckout = api.commerce.previewCheckout.useQuery(
    {
      userId: checkoutUser?.id || "",
      coopId,
      businessId: storeInfo?.businessId || "",
      listedAmountCents: subtotalCents,
      currency: "USD",
    },
    {
      enabled: isSignedInCheckout && !!storeInfo?.businessId && subtotal > 0,
    }
  );

  const previewMembershipStatus = previewCheckout.data?.membershipStatus ?? null;
  const coopStatus = previewMembershipStatus ?? checkoutUser?.membershipStatus ?? checkoutUser?.applicationStatus ?? null;
  const isActiveCoopMember = coopStatus === "ACTIVE";
  const appliesTreasuryFee = previewCheckout.data?.appliesTreasuryFee ?? false;
  const isCoopCheckout = isSignedInCheckout && (isActiveCoopMember || appliesTreasuryFee);
  const checkoutMode = isCoopCheckout
    ? "Commons member checkout"
    : auth.isAuthenticated
      ? "Signed-in checkout"
      : "Guest checkout";
  const identityTitle = auth.isLoading
    ? "Checking portal session"
    : auth.isAuthenticated
      ? isActiveCoopMember
        ? "Commons member checkout"
        : "Signed-in checkout"
      : "Guest shopper";
  const identityDescription = auth.isLoading
    ? "Looking for an active portal session."
    : auth.isAuthenticated
      ? isActiveCoopMember
        ? "This purchase will use your commons membership for checkout."
        : "This purchase will use your signed-in account without a Wealth Fund treasury fee."
      : "No portal session detected. This public purchase will check out as a guest.";
  const displayName = checkoutUser?.name || checkoutUser?.email || shortenAddress(auth.address);
  const expectedSc = previewCheckout.data?.customerReward.estimatedAmount ?? 0;
  const expectedScLabel = previewCheckout.isLoading || isIdentityLoading
    ? "Loading..."
    : `${formatScAmount(expectedSc)} SC`;
  const checkoutTreasuryFeeCents = appliesTreasuryFee
    ? previewCheckout.data?.treasuryFeeCents ?? 0
    : 0;
  const checkoutTotalCents = subtotalCents + checkoutTreasuryFeeCents;
  const checkoutTotalLabel = auth.isAuthenticated && previewCheckout.isLoading
    ? "Calculating..."
    : formatCurrencyFromCents(checkoutTotalCents);
  const checkoutTreasuryLabel = auth.isAuthenticated && previewCheckout.isLoading
    ? "Calculating..."
    : formatCurrencyFromCents(checkoutTreasuryFeeCents);
  const isCheckoutPreviewLoading = auth.isAuthenticated && previewCheckout.isLoading;
  const isCheckoutBlocked = isCreatingCheckout || isCheckoutPreviewLoading || isIdentityLoading;
  const expectedTreasuryLabel = isIdentityLoading || previewCheckout.isLoading
    ? "Loading..."
    : isCoopCheckout
      ? checkoutTreasuryLabel
      : "$0.00";
  const identityPanel = (
    <Card className="border-dashed">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">{identityTitle}</CardTitle>
            <CardDescription>{identityDescription}</CardDescription>
          </div>
          <Badge variant="outline" className="rounded-full">
            {checkoutMode}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Expected treasury fee</span>
          <span className="font-medium">{expectedTreasuryLabel}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Expected SC reward</span>
          <span className="font-medium">{auth.isAuthenticated ? expectedScLabel : "0 SC"}</span>
        </div>
        {auth.isAuthenticated ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Signed-in account</span>
              <span className="max-w-[55%] truncate text-right font-medium">
                {userStatusLoading ? "Loading..." : displayName || "Portal user"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Commons status</span>
              <Badge variant="outline" className={getStatusClasses(coopStatus)}>
                {userStatusLoading ? "Loading..." : formatStatus(coopStatus)}
              </Badge>
            </div>
          </>
        ) : (
          <div className="rounded-md border bg-muted/40 p-3 text-muted-foreground">
            <p>Guest checkout has no commons membership status.</p>
            <Link href="/" className="mt-2 inline-flex font-medium text-foreground underline underline-offset-4">
              Apply on the home page
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );

  useEffect(() => {
    if (!storeId || cartItems.length === 0) {
      setError("Invalid checkout. Please add items to your cart.");
      setLoading(false);
      return;
    }

    setError(null);

    // Wait for store data to load
    if (storeLoading) {
      return;
    }

    if (!storeData) {
      setError("Store not found.");
      setLoading(false);
      return;
    }

    if (!storeData.businessId) {
      setError("This store is not set up to accept payments yet.");
      setLoading(false);
      return;
    }

    // Set store info
    setStoreInfo({
      name: storeData.name,
      isScVerified: storeData.isScVerified,
      businessId: storeData.businessId,
    });

    // Collect contact/shipping details before either coop or guest payment.
    setNeedsGuestInfo(true);
    setLoading(false);
  }, [storeId, storeData, storeLoading, cartItems.length]);

  const orderItemsMetadata = cartItems.map((item) => ({
    productId: item.productId,
    name: item.name,
    quantity: item.quantity,
    priceUSD: item.priceUSD,
  }));

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!storeId || !storeInfo?.businessId) return;
    if (auth.isAuthenticated && !isSignedInCheckout) {
      setFormError("Still loading your signed-in account. Try again in a moment.");
      return;
    }
    if (!auth.isAuthenticated && !guestEmail) return;

    const normalizedShippingAddress = normalizeShippingAddress(shippingAddress);
    if (
      !normalizedShippingAddress.line1 ||
      !normalizedShippingAddress.city ||
      !normalizedShippingAddress.state ||
      !normalizedShippingAddress.postalCode
    ) {
      setFormError("Enter the street address, city, state, and ZIP code so the store owner knows where to send the order.");
      return;
    }
    const formattedShippingAddress = formatShippingAddress(normalizedShippingAddress);
    
    setIsCreatingCheckout(true);
    setFormError(null);

    try {
      const checkoutInput = {
        coopId,
        businessId: storeInfo.businessId,
        listedAmountCents: subtotalCents,
        currency: "USD",
        metadata: {
          items: orderItemsMetadata,
          shippingAddress: formattedShippingAddress,
        },
      };
      const result = isSignedInCheckout
        ? await createMemberCheckoutMutation.mutateAsync(checkoutInput)
        : await createCheckoutMutation.mutateAsync({
            ...checkoutInput,
            guestEmail,
            guestName: guestName || undefined,
          });

      setClientSecret(result.clientSecret);
      setNeedsGuestInfo(false);
      if (!checkoutStartedFired.current) {
        posthog.capture("checkout_started", {
          coop_id: coopId,
          store_id: storeId,
          store_name: storeInfo.name,
          is_sc_verified: storeInfo.isScVerified,
          subtotal_usd: subtotal,
          item_count: cartItems.length,
          checkout_type: isSignedInCheckout ? "authenticated" : "guest",
        });
        checkoutStartedFired.current = true;
      }
    } catch (err: any) {
      console.error("Checkout error:", err);
      setFormError(err.message || "Failed to initialize checkout");
    } finally {
      setIsCreatingCheckout(false);
    }
  };

  const handleSuccess = () => {
    if (storeId) {
      clearStoreItems(storeId);
    }
    posthog.capture("checkout_completed", {
      coop_id: coopId,
      store_id: storeId,
      store_name: storeInfo?.name,
      is_sc_verified: storeInfo?.isScVerified,
      subtotal_usd: subtotal,
      item_count: cartItems.length,
    });
    setPaymentSuccess(true);
  };

  if (!storeId) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <XCircle className="mx-auto mb-4 h-12 w-12 text-red-500" />
            <h2 className="mb-2 text-xl font-bold">Invalid Checkout</h2>
            <p className="mb-4 text-muted-foreground">
              No store selected for checkout.
            </p>
            <Button asChild>
              <Link href={`/c/${coopId}/cart`}>Return to Cart</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (paymentSuccess) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
              <CheckCircle2 className="h-8 w-8 text-green-500" />
            </div>
            <h2 className="mb-2 text-2xl font-bold">Order Placed!</h2>
            <p className="mb-4 text-muted-foreground">
              Your order has been successfully placed.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" asChild className="flex-1">
                <Link href={`/c/${coopId}/stores`}>Continue Shopping</Link>
              </Button>
              <Button asChild className="flex-1 bg-[var(--coop-accent)] text-[var(--coop-accent-foreground)] hover:opacity-90 transition-opacity">
                <Link href={`/c/${coopId}`}>Go to Home</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (needsGuestInfo) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b bg-card">
          <div className="mx-auto max-w-4xl px-4 py-4 sm:px-6">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" asChild>
                <Link href={`/c/${coopId}/cart`}>
                  <ArrowLeft className="h-5 w-5" />
                </Link>
              </Button>
              <h1 className="text-xl font-bold">{auth.isAuthenticated ? "Signed-in Checkout" : "Guest Checkout"}</h1>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-md space-y-4 px-4 py-8 sm:px-6">
          {identityPanel}
          <Card>
            <CardHeader>
              <CardTitle>Contact and shipping</CardTitle>
              <CardDescription>
                Enter where the store should send your order
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCheckout} className="space-y-4">
                {!auth.isAuthenticated && (
                  <>
                    <div>
                      <Label htmlFor="guestName">Name (Optional)</Label>
                      <Input
                        id="guestName"
                        type="text"
                        value={guestName}
                        onChange={(e) => setGuestName(e.target.value)}
                        placeholder="John Doe"
                      />
                    </div>
                    <div>
                      <Label htmlFor="guestEmail">Email *</Label>
                      <Input
                        id="guestEmail"
                        type="email"
                        value={guestEmail}
                        onChange={(e) => setGuestEmail(e.target.value)}
                        placeholder="you@example.com"
                        required
                      />
                    </div>
                  </>
                )}
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="shippingLine1">Street address *</Label>
                    <Input
                      id="shippingLine1"
                      value={shippingAddress.line1}
                      onChange={(e) => updateShippingAddress("line1", e.target.value)}
                      placeholder="123 Main Street"
                      autoComplete="shipping address-line1"
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="shippingLine2">Apartment, suite, etc.</Label>
                    <Input
                      id="shippingLine2"
                      value={shippingAddress.line2}
                      onChange={(e) => updateShippingAddress("line2", e.target.value)}
                      placeholder="Apt 4B"
                      autoComplete="shipping address-line2"
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="shippingCity">City *</Label>
                      <Input
                        id="shippingCity"
                        value={shippingAddress.city}
                        onChange={(e) => updateShippingAddress("city", e.target.value)}
                        placeholder="San Francisco"
                        autoComplete="shipping address-level2"
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="shippingState">State *</Label>
                      <Input
                        id="shippingState"
                        value={shippingAddress.state}
                        onChange={(e) => updateShippingAddress("state", e.target.value)}
                        placeholder="CA"
                        autoComplete="shipping address-level1"
                        required
                      />
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="shippingPostalCode">ZIP code *</Label>
                      <Input
                        id="shippingPostalCode"
                        value={shippingAddress.postalCode}
                        onChange={(e) => updateShippingAddress("postalCode", e.target.value)}
                        placeholder="94110"
                        autoComplete="shipping postal-code"
                        inputMode="numeric"
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="shippingCountry">Country *</Label>
                      <Input
                        id="shippingCountry"
                        value={shippingAddress.country}
                        onChange={(e) => updateShippingAddress("country", e.target.value)}
                        placeholder="US"
                        autoComplete="shipping country"
                        required
                      />
                    </div>
                  </div>
                </div>
                <div className="rounded-lg bg-muted p-4 text-sm">
                  <p className="mb-3 font-medium">Order total</p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-muted-foreground">Items</span>
                      <span className="font-medium">{formatCurrencyFromCents(subtotalCents)}</span>
                    </div>
                    {isCoopCheckout && (
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-muted-foreground">Treasury fee</span>
                        <span className="font-medium">{checkoutTreasuryLabel}</span>
                      </div>
                    )}
                  </div>
                  <Separator className="my-3" />
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-medium">Total due</span>
                    <span className="text-2xl font-bold">{checkoutTotalLabel}</span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {cartItems.length} item{cartItems.length !== 1 ? 's' : ''} from {storeInfo?.name}
                  </p>
                </div>
                <Button
                  type="submit"
                  size="lg"
                  className="w-full bg-[var(--coop-accent)] text-[var(--coop-accent-foreground)] hover:opacity-90 transition-opacity"
                  disabled={isCheckoutBlocked}
                >
                  {isCreatingCheckout ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      {auth.isAuthenticated ? "Preparing checkout..." : "Processing..."}
                    </>
                  ) : isCheckoutPreviewLoading || isIdentityLoading ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      {isIdentityLoading ? "Loading account..." : "Calculating total..."}
                    </>
                  ) : (
                    "Continue to Payment"
                  )}
                </Button>
                {formError && (
                  <p className="text-sm text-red-500 text-center">{formError}</p>
                )}
              </form>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-[var(--coop-accent)]" />
          <p className="text-muted-foreground">Initializing checkout...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <XCircle className="mx-auto mb-4 h-12 w-12 text-red-500" />
            <h2 className="mb-2 text-xl font-bold">Checkout Error</h2>
            <p className="mb-4 text-muted-foreground">{error}</p>
            <Button asChild>
              <Link href={`/c/${coopId}/cart`}>Return to Cart</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="mx-auto max-w-4xl px-4 py-4 sm:px-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link href={`/c/${coopId}/cart`}>
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <h1 className="text-xl font-bold">Checkout</h1>
          </div>
        </div>
      </header>

      {/* Checkout Content */}
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-2">
          {/* Order Summary */}
          <div className="space-y-4">
            {identityPanel}
            <Card>
              <CardHeader>
                <CardTitle>Order Summary</CardTitle>
                {storeInfo && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Store className="h-4 w-4" />
                    <span>{storeInfo.name}</span>
                    {storeInfo.isScVerified && (
                      <div className="flex items-center gap-1">
                        <BadgeCheck className="h-4 w-4 text-[var(--coop-accent)]" />
                        <span className="text-[var(--coop-accent)]">SC Verified</span>
                      </div>
                    )}
                  </div>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                {cartItems.map((item) => (
                  <div key={item.productId} className="flex justify-between">
                    <div>
                      <p className="font-medium">{item.name}</p>
                      <p className="text-sm text-muted-foreground">
                        Qty: {item.quantity}
                      </p>
                    </div>
                    <p className="font-medium">
                      ${(item.priceUSD * item.quantity).toFixed(2)}
                    </p>
                  </div>
                ))}
                <Separator />
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Items</span>
                    <span className="font-medium">{formatCurrencyFromCents(subtotalCents)}</span>
                  </div>
                  {isCoopCheckout && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Treasury fee</span>
                      <span className="font-medium">{checkoutTreasuryLabel}</span>
                    </div>
                  )}
                </div>
                <Separator />
                <div className="flex justify-between text-lg font-bold">
                  <span>Total due</span>
                  <span>{checkoutTotalLabel}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Payment Form */}
          <div>
            <Card>
              <CardHeader>
                <CardTitle>Payment Details</CardTitle>
                <CardDescription>
                  Enter your payment information to complete the purchase
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!clientSecret && (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      {auth.isAuthenticated
                        ? "Confirm shipping information before payment."
                        : "Enter your contact and shipping information before payment."}
                    </p>
                    <Button
                      type="button"
                      size="lg"
                      onClick={() => setNeedsGuestInfo(true)}
                      className="w-full bg-[var(--coop-accent)] text-[var(--coop-accent-foreground)] hover:opacity-90 transition-opacity"
                      disabled={isCheckoutBlocked}
                    >
                      {auth.isAuthenticated ? "Continue Checkout" : "Continue as Guest"}
                    </Button>
                    {formError && (
                      <p className="text-sm text-red-500">{formError}</p>
                    )}
                  </div>
                )}
                {clientSecret && (
                  <Elements
                    stripe={stripePromise}
                    options={{
                      clientSecret,
                      appearance: {
                        theme: "stripe",
                      },
                    }}
                  >
                    <CheckoutForm
                      coopId={coopId}
                      clientSecret={clientSecret}
                      onSuccess={handleSuccess}
                    />
                  </Elements>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
