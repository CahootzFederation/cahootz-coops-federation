"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const CART_STORAGE_KEY = '@cahootz_web_cart';

export interface CartItem {
  productId: string;
  storeId: string;
  storeName: string;
  storeIsScVerified: boolean;
  name: string;
  imageUrl: string | null;
  priceUSD: number;
  quantity: number;
}

interface CartContextValue {
  items: CartItem[];
  isLoading: boolean;
  addItem: (product: {
    id: string;
    name: string;
    imageUrl: string | null;
    priceUSD: number;
  }, store: {
    id: string;
    name: string;
    isScVerified: boolean;
  }, quantity?: number) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  clearStoreItems: (storeId: string) => void;
  getStoreItems: (storeId: string) => CartItem[];
  getStoreIds: () => string[];
  totalItems: number;
  totalUSD: number;
}

const CartContext = createContext<CartContextValue | undefined>(undefined);

export function CartProvider({ 
  children,
  coopId,
}: { 
  children: React.ReactNode;
  coopId: string;
}) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Create coop-scoped storage key
  const storageKey = `${CART_STORAGE_KEY}_${coopId}`;

  // Load cart from localStorage on mount
  useEffect(() => {
    loadCart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coopId]);

  // Save cart to localStorage whenever items change
  useEffect(() => {
    if (!isLoading) {
      saveCart(items);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, isLoading]);

  const loadCart = () => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        setItems(parsed);
      }
    } catch (error) {
      console.error('Error loading cart:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const saveCart = (cartItems: CartItem[]) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(cartItems));
    } catch (error) {
      console.error('Error saving cart:', error);
    }
  };

  const addItem = useCallback((
    product: {
      id: string;
      name: string;
      imageUrl: string | null;
      priceUSD: number;
    },
    store: {
      id: string;
      name: string;
      isScVerified: boolean;
    },
    quantity = 1
  ) => {
    setItems((prev) => {
      const existingIndex = prev.findIndex((item) => item.productId === product.id);

      if (existingIndex >= 0) {
        // Update quantity of existing item
        const updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          quantity: updated[existingIndex].quantity + quantity,
        };
        return updated;
      }

      // Add new item
      return [...prev, {
        productId: product.id,
        storeId: store.id,
        storeName: store.name,
        storeIsScVerified: store.isScVerified,
        name: product.name,
        imageUrl: product.imageUrl,
        priceUSD: product.priceUSD,
        quantity,
      }];
    });
  }, []);

  const removeItem = useCallback((productId: string) => {
    setItems((prev) => prev.filter((item) => item.productId !== productId));
  }, []);

  const updateQuantity = useCallback((productId: string, quantity: number) => {
    if (quantity <= 0) {
      removeItem(productId);
      return;
    }

    setItems((prev) =>
      prev.map((item) =>
        item.productId === productId ? { ...item, quantity } : item
      )
    );
  }, [removeItem]);

  const clearCart = useCallback(() => {
    setItems([]);
  }, []);

  const clearStoreItems = useCallback((storeId: string) => {
    setItems((prev) => prev.filter((item) => item.storeId !== storeId));
  }, []);

  const getStoreItems = useCallback((storeId: string) => {
    return items.filter((item) => item.storeId === storeId);
  }, [items]);

  const getStoreIds = useCallback(() => {
    return [...new Set(items.map((item) => item.storeId))];
  }, [items]);

  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalUSD = items.reduce((sum, item) => sum + item.priceUSD * item.quantity, 0);

  return (
    <CartContext.Provider
      value={{
        items,
        isLoading,
        addItem,
        removeItem,
        updateQuantity,
        clearCart,
        clearStoreItems,
        getStoreItems,
        getStoreIds,
        totalItems,
        totalUSD,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (context === undefined) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
}
