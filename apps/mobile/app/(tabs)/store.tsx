import React from 'react';
import { ActivityIndicator, Image, RefreshControl, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { BadgeCheck, Check, ChevronRight, Minus, Plus, Search, ShoppingBag, ShoppingCart, Store } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { useCart } from '@/contexts/cart-context';
import { api, resolveCoopId } from '@/lib/api';

type ShopCommons = { id: string; name: string };
const FALLBACK_COMMONS_ID = 'cahootz';

type StoreItem = { id: string; name: string; description?: string | null; category?: string | null; imageUrl?: string | null; kind?: 'MEMBER' | 'OFFICIAL_COMMONS'; isScVerified: boolean; rating?: number | null; productCount: number; city?: string | null; state?: string | null };
type BadgeDefinition = { tier: string; rank: number; name: string; shortName: string; priceUSD: number; nominalReward: number; color: string };
type ProductItem = { id: string; name: string; description?: string | null; category?: string | null; imageUrl?: string | null; priceUSD: number; kind?: 'STANDARD' | 'FUNDING_BADGE'; fundingBadgeTier?: string | null; fundingBadge?: BadgeDefinition | null; store: { id: string; name: string; kind?: 'MEMBER' | 'OFFICIAL_COMMONS'; isScVerified: boolean } };

const colors = { paper: '#FFF9ED', ink: '#241A10', muted: '#75685A', line: '#E9DDCB', orange: '#E85D04', orangeSoft: '#FFF0E2', forest: '#245B45' };
const money = (value: number) => `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

export default function StoreScreen() {
  const params = useLocalSearchParams<{ coopId?: string }>();
  const { user, sessionToken, isLoading: authLoading } = useAuth();
  const { addItem, items: cartItems, updateQuantity, totalItems } = useCart();
  // Members can belong to several commons, and each commons has its own
  // funding shop and member stores. The session's coop is only a default.
  const sessionCoopId = resolveCoopId() === 'error-no-coop-id' ? FALLBACK_COMMONS_ID : resolveCoopId();
  const [commons, setCommons] = React.useState<ShopCommons[]>([]);
  const [coopId, setCoopId] = React.useState(params.coopId || sessionCoopId);
  const [stores, setStores] = React.useState<StoreItem[]>([]);
  const [products, setProducts] = React.useState<ProductItem[]>([]);
  const [myStore, setMyStore] = React.useState<any>(null);
  const [ownedTiers, setOwnedTiers] = React.useState<Set<string>>(new Set());
  const [mode, setMode] = React.useState<'products' | 'stores'>('products');
  const [query, setQuery] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);

  React.useEffect(() => {
    if (!sessionToken) return;
    let mounted = true;
    api.listCommonsDirectory(sessionToken)
      .then((result) => {
        if (!mounted) return;
        const active = result.coops
          .filter((item) => item.accessStatus === 'ACTIVE')
          .map((item) => ({ id: item.id, name: item.shortName || item.name }));
        setCommons(active);
        setCoopId((current) =>
          params.coopId && active.some((item) => item.id === params.coopId)
            ? params.coopId
            : active.some((item) => item.id === current) || active.length === 0
              ? current
              : active[0].id,
        );
      })
      .catch((error) => console.error('Failed to load shop commons:', error));
    return () => { mounted = false; };
  }, [params.coopId, sessionToken]);

  const load = React.useCallback(async () => {
    const [storeResult, productResult, ownerResult, badgeResult] = await Promise.all([
      api.getStores({ coopId, limit: 100 }).catch(() => ({ stores: [] })),
      api.getProducts({ coopId, limit: 100 }).catch(() => ({ products: [] })),
      user?.walletAddress ? api.getMyStore(user.walletAddress).catch(() => null) : Promise.resolve(null),
      user?.walletAddress ? api.getMyFundingBadges(user.walletAddress, coopId).catch(() => null) : Promise.resolve(null),
    ]);
    setStores(storeResult?.stores ?? []);
    setProducts(productResult?.products ?? []);
    setMyStore(ownerResult);
    setOwnedTiers(new Set((badgeResult?.badges ?? []).filter((badge: any) => badge.status === 'ACTIVE').map((badge: any) => badge.tier)));
  }, [coopId, user?.walletAddress]);

  React.useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const normalizedQuery = query.trim().toLowerCase();
  const filteredProducts = products.filter((product) => !normalizedQuery || `${product.name} ${product.description ?? ''} ${product.store.name}`.toLowerCase().includes(normalizedQuery));
  const filteredStores = stores.filter((store) => !normalizedQuery || `${store.name} ${store.description ?? ''} ${store.category ?? ''}`.toLowerCase().includes(normalizedQuery));

  const addProduct = (product: ProductItem) => addItem(
    { id: product.id, name: product.name, imageUrl: product.imageUrl ?? null, priceUSD: product.priceUSD, maxQuantity: product.kind === 'FUNDING_BADGE' ? 1 : undefined, requiresShipping: product.kind !== 'FUNDING_BADGE', exclusiveGroup: product.kind === 'FUNDING_BADGE' ? 'funding-badge' : undefined },
    { id: product.store.id, name: product.store.name, isScVerified: product.store.isScVerified },
  );

  // The marketplace is members-only (its tab is hidden when signed out);
  // a deep link here from a signed-out session goes to sign-in.
  if (!authLoading && !user) return <Redirect href={{ pathname: '/', params: { entry: 'sign-in' } } as any} />;

  if (loading) return (
    <SafeAreaView className="flex-1 items-center justify-center" style={{ backgroundColor: colors.paper }}>
      <ActivityIndicator size="large" color={colors.orange} />
      <Text className="mt-3 text-sm font-semibold" style={{ color: colors.muted }}>Opening the commons market…</Text>
    </SafeAreaView>
  );

  return (
    <SafeAreaView className="flex-1" edges={['top']} style={{ backgroundColor: colors.paper }}>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.orange} />} contentContainerStyle={{ paddingBottom: 112 }}>
        <View className="px-4 pb-3 pt-2">
          <View className="flex-row items-center justify-between">
            <View className="flex-1 pr-2">
              <Text className="text-[11px] font-black uppercase tracking-widest" style={{ color: colors.orange }}>Commons market</Text>
              <Text className="mt-0.5 text-3xl font-black" style={{ color: colors.ink }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>Shop together</Text>
            </View>
            <View className="flex-row gap-2">
              <TouchableOpacity accessibilityLabel="Shopping cart" onPress={() => router.push('/(authenticated)/cart' as any)} className="relative h-11 w-11 items-center justify-center rounded-2xl border bg-white" style={{ borderColor: colors.line }}>
                <ShoppingCart size={21} color={colors.ink} />
                {totalItems > 0 ? <View className="absolute -right-1 -top-1 min-w-[19px] items-center rounded-full px-1 py-0.5" style={{ backgroundColor: colors.orange }}><Text className="text-[10px] font-black text-white">{Math.min(totalItems, 99)}</Text></View> : null}
              </TouchableOpacity>
              <TouchableOpacity accessibilityLabel={myStore ? 'Manage my shop' : 'Open a shop'} onPress={() => router.push(myStore ? '/my-stores' as any : '/apply-store' as any)} className="h-11 flex-row items-center justify-center rounded-2xl px-3" style={{ backgroundColor: colors.ink }}>
                {myStore ? <Store size={17} color="#FFFFFF" /> : <Plus size={17} color="#FFFFFF" />}
                <Text className="ml-1.5 text-xs font-black text-white">{myStore ? 'My shop' : 'Open shop'}</Text>
              </TouchableOpacity>
            </View>
          </View>
          {myStore ? <TouchableOpacity onPress={() => router.push('/my-stores' as any)} className="mt-4 flex-row items-center rounded-2xl border bg-white p-3" style={{ borderColor: colors.line }}>
            <View className="h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: colors.orangeSoft }}><Store size={18} color={colors.orange} /></View>
            <View className="ml-3 flex-1"><Text className="text-sm font-black" style={{ color: colors.ink }}>{myStore.name}</Text><Text className="mt-0.5 text-xs font-semibold" style={{ color: colors.muted }}>{myStore.status === 'APPROVED' ? 'Live and accepting orders' : myStore.application?.status === 'APPROVED' ? 'Approved · finish payment setup' : 'Application under commons review'}</Text></View>
            <ChevronRight size={18} color={colors.muted} />
          </TouchableOpacity> : null}
          {commons.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-4" contentContainerStyle={{ gap: 8 }}>
            {commons.map((item) => {
              const selected = item.id === coopId;
              return <TouchableOpacity key={item.id} accessibilityRole="button" accessibilityLabel={`Shop ${item.name}`} accessibilityState={{ selected }} onPress={() => setCoopId(item.id)} className="rounded-full border px-4 py-2" style={{ backgroundColor: selected ? colors.ink : '#FFFFFF', borderColor: selected ? colors.ink : colors.line }}>
                <Text className="text-xs font-black" style={{ color: selected ? '#FFFFFF' : colors.ink }}>{item.name}</Text>
              </TouchableOpacity>;
            })}
          </ScrollView> : null}
        </View>

        <View className="mx-4 mt-2 flex-row items-center rounded-2xl border bg-white px-3" style={{ borderColor: colors.line }}><Search size={19} color={colors.muted} /><TextInput accessibilityLabel="Search marketplace" value={query} onChangeText={setQuery} placeholder="Search products and commons shops" placeholderTextColor="#A6998A" className="h-12 flex-1 px-3 text-sm" style={{ color: colors.ink }} /></View>
        <View className="mx-4 mt-3 flex-row rounded-2xl p-1" style={{ backgroundColor: '#EEE3D3' }}>{(['products', 'stores'] as const).map((item) => <TouchableOpacity key={item} accessibilityRole="tab" accessibilityState={{ selected: mode === item }} onPress={() => setMode(item)} className="flex-1 items-center rounded-xl py-2.5" style={{ backgroundColor: mode === item ? '#FFFFFF' : 'transparent' }}><Text className="text-xs font-black capitalize" style={{ color: mode === item ? colors.ink : colors.muted }}>{item}</Text></TouchableOpacity>)}</View>

        <View className="mt-5 px-4">
          <Text className="mb-3 text-lg font-black" style={{ color: colors.ink }}>{mode === 'products' ? 'Commons shops' : 'All shops'}</Text>
          {mode === 'products' ? filteredProducts.map((product) => <TouchableOpacity key={product.id} onPress={() => router.push(`/store-detail?id=${product.store.id}` as any)} className="mb-3 flex-row rounded-2xl border bg-white p-3" style={{ borderColor: colors.line }}>
            <View className="h-20 w-20 overflow-hidden rounded-xl" style={{ backgroundColor: colors.orangeSoft }}>{product.imageUrl ? <Image source={{ uri: product.imageUrl }} className="h-full w-full" /> : <View className="h-full w-full items-center justify-center"><ShoppingBag size={26} color={colors.orange} /></View>}</View>
            <View className="ml-3 flex-1"><Text className="font-black" style={{ color: colors.ink }} numberOfLines={1}>{product.name}</Text><Text className="mt-0.5 text-xs font-semibold" style={{ color: colors.muted }} numberOfLines={1}>{product.store.name}</Text><View className="mt-3 flex-row items-center justify-between"><Text className="text-base font-black" style={{ color: colors.orange }}>{money(product.priceUSD)}</Text><CartControl
                product={product}
                owned={!!product.fundingBadgeTier && ownedTiers.has(product.fundingBadgeTier)}
                quantityInCart={cartItems.find((item) => item.productId === product.id)?.quantity ?? 0}
                onAdd={() => addProduct(product)}
                onSetQuantity={(quantity) => updateQuantity(product.id, quantity)}
              /></View></View>
          </TouchableOpacity>) : filteredStores.map((store) => <TouchableOpacity key={store.id} accessibilityLabel={`Open ${store.name}`} onPress={() => router.push(`/store-detail?id=${store.id}` as any)} className="mb-3 flex-row items-center rounded-2xl border bg-white p-4" style={{ borderColor: colors.line }}>
            <View className="h-14 w-14 items-center justify-center overflow-hidden rounded-2xl" style={{ backgroundColor: colors.orangeSoft }}>{store.imageUrl ? <Image source={{ uri: store.imageUrl }} className="h-full w-full" /> : <Store size={24} color={colors.orange} />}</View>
            <View className="ml-3 flex-1"><View className="flex-row items-center"><Text className="font-black" style={{ color: colors.ink }} numberOfLines={1}>{store.name}</Text>{store.isScVerified ? <BadgeCheck size={15} color={colors.forest} style={{ marginLeft: 5 }} /> : null}</View><Text className="mt-1 text-xs font-semibold" style={{ color: colors.muted }}>{store.productCount} products{store.city ? ` · ${store.city}` : ''}</Text></View><ChevronRight size={18} color={colors.muted} />
          </TouchableOpacity>)}
          {(mode === 'products' ? filteredProducts : filteredStores).length === 0 ? <View className="items-center rounded-2xl border border-dashed bg-white p-8" style={{ borderColor: colors.line }}><ShoppingBag size={32} color="#B8AA98" /><Text className="mt-3 font-black" style={{ color: colors.ink }}>Nothing matched that search</Text><Text className="mt-1 text-center text-xs" style={{ color: colors.muted }}>Try a shop name, product, or category.</Text></View> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// Shows what's already in the cart right on the product row: a stepper for
// ordinary items, and an "In cart" tag (with a remove button) for
// one-per-member funding badges.
function CartControl({ product, owned, quantityInCart, onAdd, onSetQuantity }: {
  product: ProductItem;
  owned: boolean;
  quantityInCart: number;
  onAdd: () => void;
  onSetQuantity: (quantity: number) => void;
}) {
  if (owned) {
    return <View accessibilityLabel={`${product.name} owned`} className="h-9 flex-row items-center rounded-xl px-3" style={{ backgroundColor: '#E7F3ED' }}><Check size={16} color={colors.forest} /><Text className="ml-1 text-xs font-black" style={{ color: colors.forest }}>Owned</Text></View>;
  }
  if (quantityInCart === 0) {
    return <TouchableOpacity accessibilityLabel={`Add ${product.name} to cart`} onPress={onAdd} className="h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: colors.ink }}><Plus size={18} color="#FFFFFF" /></TouchableOpacity>;
  }
  if (product.kind === 'FUNDING_BADGE') {
    return <View className="flex-row items-center gap-2">
      <TouchableOpacity accessibilityLabel={`Remove ${product.name} from cart`} onPress={() => onSetQuantity(0)} className="h-9 w-9 items-center justify-center rounded-xl border" style={{ borderColor: colors.line, backgroundColor: '#FFFFFF' }}><Minus size={16} color={colors.ink} /></TouchableOpacity>
      <TouchableOpacity accessibilityLabel={`${product.name} is in your cart`} onPress={() => router.push('/(authenticated)/cart' as any)} className="h-9 flex-row items-center rounded-xl px-3" style={{ backgroundColor: colors.orangeSoft }}><ShoppingCart size={15} color={colors.orange} /><Text className="ml-1.5 text-xs font-black" style={{ color: colors.orange }}>In cart</Text></TouchableOpacity>
    </View>;
  }
  return <View className="h-9 flex-row items-center rounded-xl" style={{ backgroundColor: colors.ink }}>
    <TouchableOpacity accessibilityLabel={`Remove one ${product.name}`} onPress={() => onSetQuantity(quantityInCart - 1)} className="h-9 w-9 items-center justify-center"><Minus size={16} color="#FFFFFF" /></TouchableOpacity>
    <Text accessibilityLabel={`${quantityInCart} ${product.name} in cart`} className="min-w-[20px] text-center text-sm font-black text-white">{quantityInCart}</Text>
    <TouchableOpacity accessibilityLabel={`Add another ${product.name}`} onPress={() => onSetQuantity(quantityInCart + 1)} className="h-9 w-9 items-center justify-center"><Plus size={16} color="#FFFFFF" /></TouchableOpacity>
  </View>;
}
