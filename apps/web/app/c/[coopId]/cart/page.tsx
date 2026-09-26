"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowLeft,
  Minus,
  Plus,
  ShoppingBag,
  Store,
  Trash2,
  BadgeCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { CartItem } from "@/contexts/cart-context";
import { useCart } from "@/contexts/cart-context";
import { usePostHog } from "posthog-js/react";

function CartItemCard({
  item,
  onUpdateQuantity,
  onRemove,
}: {
  item: CartItem;
  onUpdateQuantity: (quantity: number) => void;
  onRemove: () => void;
}) {
  return (
    <Card className="mb-3">
      <CardContent className="flex gap-4 p-4">
        {/* Product Image */}
        <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-muted">
          {item.imageUrl ? (
            <Image
              src={item.imageUrl}
              alt={item.name}
              fill
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <ShoppingBag className="h-8 w-8 text-muted-foreground" />
            </div>
          )}
        </div>

        {/* Product Info */}
        <div className="flex flex-1 flex-col">
          <h3 className="font-medium line-clamp-2">{item.name}</h3>
          <p className="mt-1 text-lg font-bold text-[var(--coop-accent)]">
            ${item.priceUSD.toFixed(2)}
          </p>

          {/* Quantity Controls */}
          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-2 rounded-full bg-muted">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full"
                onClick={() => onUpdateQuantity(item.quantity - 1)}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <span className="w-8 text-center font-semibold">
                {item.quantity}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full"
                onClick={() => onUpdateQuantity(item.quantity + 1)}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="text-red-500 hover:text-red-600"
              onClick={onRemove}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StoreSection({
  storeId,
  storeName,
  isScVerified,
  items,
  coopId,
  onUpdateQuantity,
  onRemoveItem,
  onCheckout,
}: {
  storeId: string;
  storeName: string;
  isScVerified: boolean;
  items: CartItem[];
  coopId: string;
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onRemoveItem: (productId: string) => void;
  onCheckout: () => void;
}) {
  const subtotal = items.reduce(
    (sum, item) => sum + item.priceUSD * item.quantity,
    0
  );

  return (
    <div className="mb-6">
      {/* Store Header */}
      <Link
        href={`/c/${coopId}/store/${storeId}`}
        className="mb-3 flex items-center gap-2 hover:underline"
      >
        <Store className="h-4 w-4 text-muted-foreground" />
        <span className="font-semibold">{storeName}</span>
        {isScVerified && (
          <div className="flex items-center gap-1">
            <BadgeCheck className="h-4 w-4 text-[var(--coop-accent)]" />
            <span className="text-xs text-[var(--coop-accent)]">SC Verified</span>
          </div>
        )}
      </Link>

      {/* Cart Items */}
      {items.map((item) => (
        <CartItemCard
          key={item.productId}
          item={item}
          onUpdateQuantity={(qty) => onUpdateQuantity(item.productId, qty)}
          onRemove={() => onRemoveItem(item.productId)}
        />
      ))}

      {/* Subtotal & Checkout */}
      <Card className="bg-muted/30">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="text-lg font-bold">
              ${subtotal.toFixed(2)}
            </span>
          </div>
          <Button
            onClick={onCheckout}
            className="w-full bg-[var(--coop-accent)] text-[var(--coop-accent-foreground)] hover:opacity-90 transition-opacity"
            size="lg"
          >
            Checkout
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function CartPage() {
  const params = useParams();
  const router = useRouter();
  const coopId = params.coopId as string;
  const posthog = usePostHog();
  
  const {
    items,
    isLoading,
    updateQuantity,
    removeItem,
    clearCart,
    getStoreIds,
    getStoreItems,
    totalItems,
    totalUSD,
  } = useCart();

  useEffect(() => {
    if (!isLoading) {
      posthog.capture("cart_viewed", {
        coop_id: coopId,
        total_items: totalItems,
        total_usd: totalUSD,
        store_count: getStoreIds().length,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  const handleCheckout = (storeId: string) => {
    router.push(`/c/${coopId}/checkout?storeId=${storeId}`);
  };

  const handleClearCart = () => {
    if (confirm("Are you sure you want to remove all items from your cart?")) {
      clearCart();
    }
  };

  const storeIds = getStoreIds();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading cart...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="mx-auto max-w-4xl px-4 py-4 sm:px-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" asChild>
                <Link href={`/c/${coopId}`}>
                  <ArrowLeft className="h-5 w-5" />
                </Link>
              </Button>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold">Cart</h1>
                {totalItems > 0 && (
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--coop-accent)] text-xs font-bold text-white">
                    {totalItems}
                  </div>
                )}
              </div>
            </div>
            {items.length > 0 && (
              <Button
                variant="ghost"
                className="text-red-500 hover:text-red-600"
                onClick={handleClearCart}
              >
                Clear All
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Cart Content */}
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        {items.length === 0 ? (
          /* Empty Cart State */
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-muted">
              <ShoppingBag className="h-12 w-12 text-muted-foreground" />
            </div>
            <h2 className="mb-2 text-2xl font-bold">Your cart is empty</h2>
            <p className="mb-6 text-muted-foreground">
              Browse our stores and add some products to get started.
            </p>
            <Button asChild className="bg-[var(--coop-accent)] text-[var(--coop-accent-foreground)] hover:opacity-90 transition-opacity">
              <Link href={`/c/${coopId}/stores`}>Browse Stores</Link>
            </Button>
          </div>
        ) : (
          <>
            {/* Store Sections */}
            {storeIds.map((storeId) => {
              const storeItems = getStoreItems(storeId);
              const firstItem = storeItems[0];
              if (!firstItem) return null;
              return (
                <StoreSection
                  key={storeId}
                  storeId={storeId}
                  storeName={firstItem.storeName}
                  isScVerified={firstItem.storeIsScVerified}
                  items={storeItems}
                  coopId={coopId}
                  onUpdateQuantity={updateQuantity}
                  onRemoveItem={removeItem}
                  onCheckout={() => handleCheckout(storeId)}
                />
              );
            })}

            {/* Total Summary */}
            {storeIds.length > 1 && (
              <Card className="mt-2">
                <CardHeader>
                  <CardTitle className="text-base">
                    Cart Total ({totalItems} items)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Total</span>
                    <span className="text-xl font-bold">
                      ${totalUSD.toFixed(2)}
                    </span>
                  </div>
                  <Separator className="my-3" />
                  <p className="text-sm text-muted-foreground">
                    Note: You can only checkout from one store at a time.
                  </p>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  );
}
