/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 · genre: editorial utility · macrostructure: Ecosystem Index · theme: Cahootz newsprint · contrast: pass · responsive: pass */
import type { CommonsPost } from '@/lib/api';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  RefreshControl,
  ScrollView,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  ChevronRight,
  CircleHelp,
  HandHeart,
  Megaphone,
  PackageOpen,
  Plus,
  Search,
  ShoppingBag,
  ShoppingCart,
  Store,
  Vote,
  X,
} from 'lucide-react-native';

import MarketplaceLane from '@/components/marketplace-lane';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { useCart } from '@/contexts/cart-context';
import { api, resolveCoopId } from '@/lib/api';
import { friendlyError } from '@/lib/friendly-error';

type ApiBoardLane = 'all' | 'needs' | 'offers' | 'events';
type BoardLane = 'index' | 'all' | 'needs' | 'offers' | 'events' | 'marketplace';
type CountedLane = Exclude<ApiBoardLane, 'all'>;
type BoardPostType = 'Ask' | 'Offer' | 'Update';
type BoardCommons = { id: string; name: string };
type LaneCounts = Record<CountedLane, number>;
type MarketplacePreviewProduct = {
  id: string;
  name: string;
  imageUrl?: string | null;
  priceUSD: number;
  store: { id: string; name: string };
};
type MarketplaceShop = {
  name: string;
  status?: string | null;
  application?: { status?: string | null } | null;
};

const FALLBACK_COMMONS_ID = 'cahootz';
const emptyCounts: LaneCounts = { needs: 0, offers: 0, events: 0 };

const tokens = {
  paper: '#F7F0E3',
  sheet: '#FFFDF8',
  sheetWarm: '#F0E3CD',
  ink: '#211A14',
  inkSoft: '#51473D',
  muted: '#6E6257',
  rule: '#CFC0AA',
  ruleLight: '#E4D8C6',
  orange: '#B94614',
  orangePale: '#F5DDD0',
  blue: '#315D72',
  bluePale: '#DCE8EB',
  green: '#3D684E',
  greenPale: '#DDE9DE',
  ochre: '#8A641B',
  ochrePale: '#EFE3C4',
  plum: '#654C68',
  plumPale: '#E8DEE8',
  danger: '#A1332B',
};

const laneCopy: Record<'needs' | 'offers' | 'events', { title: string; note: string }> = {
  needs: { title: 'Needs & questions', note: 'Ask for a hand, advice, a recommendation, or something hard to find.' },
  offers: { title: 'Offers', note: 'Things people have offered through ordinary Commons posts.' },
  events: { title: 'Events & gatherings', note: 'Meetings, classes, meals, workdays, and things happening nearby.' },
};

const postChoices: Array<{
  label: string;
  note: string;
  icon: typeof CircleHelp;
  tone: string;
  type?: BoardPostType;
  route?: 'event';
}> = [
  { label: 'Ask for help', note: 'A need, question, recommendation, lost item, or other request.', icon: CircleHelp, tone: tokens.orange, type: 'Ask' },
  { label: 'Offer something', note: 'Time, a skill, an item, a job, or a volunteer opening.', icon: HandHeart, tone: tokens.green, type: 'Offer' },
  { label: 'Post an update', note: 'Share an ordinary update with the Commons.', icon: Megaphone, tone: tokens.blue, type: 'Update' },
  { label: 'Create an event', note: 'Add a date, place, hosts, and RSVP details.', icon: CalendarDays, tone: tokens.plum, route: 'event' },
];

function iconForTag(tag: CommonsPost['tag']) {
  if (tag === 'Ask' || tag === 'Need') return CircleHelp;
  if (tag === 'Offer' || tag === 'Resource' || tag === 'Opportunity') return HandHeart;
  if (tag === 'Event') return CalendarDays;
  if (tag === 'Proposal' || tag === 'Vote' || tag === 'Decision') return Vote;
  return Megaphone;
}

function toneForTag(tag: CommonsPost['tag']) {
  if (tag === 'Ask' || tag === 'Need') return { ink: tokens.orange, paper: tokens.orangePale };
  if (tag === 'Offer' || tag === 'Resource' || tag === 'Opportunity') return { ink: tokens.green, paper: tokens.greenPale };
  if (tag === 'Event') return { ink: tokens.plum, paper: tokens.plumPale };
  if (tag === 'Project') return { ink: tokens.ochre, paper: tokens.ochrePale };
  return { ink: tokens.blue, paper: tokens.bluePale };
}

function normalizedLane(value?: string): BoardLane {
  if (!value) return 'index';
  return ['all', 'needs', 'offers', 'events', 'marketplace'].includes(value)
    ? (value as BoardLane)
    : 'index';
}

export default function BoardScreen() {
  const params = useLocalSearchParams<{ coopId?: string; lane?: string }>();
  const { width } = useWindowDimensions();
  const { user, sessionToken, isLoading: authLoading } = useAuth();
  const { totalItems } = useCart();
  const sessionCoopId = resolveCoopId() === 'error-no-coop-id' ? FALLBACK_COMMONS_ID : resolveCoopId();
  const [commons, setCommons] = React.useState<BoardCommons[]>([]);
  const [coopId, setCoopId] = React.useState(params.coopId || sessionCoopId);
  const [lane, setLane] = React.useState<BoardLane>(normalizedLane(params.lane));
  const [query, setQuery] = React.useState('');
  const [items, setItems] = React.useState<CommonsPost[]>([]);
  const [laneCounts, setLaneCounts] = React.useState<LaneCounts>(emptyCounts);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState('');
  const [composerOpen, setComposerOpen] = React.useState(false);
  const [postType, setPostType] = React.useState<BoardPostType | null>(null);
  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [publishing, setPublishing] = React.useState(false);
  const [marketplaceProducts, setMarketplaceProducts] = React.useState<MarketplacePreviewProduct[]>([]);
  const [marketplaceShop, setMarketplaceShop] = React.useState<MarketplaceShop | null>(null);
  const [marketplaceLoading, setMarketplaceLoading] = React.useState(true);
  const [marketplaceError, setMarketplaceError] = React.useState(false);

  React.useEffect(() => setLane(normalizedLane(params.lane)), [params.lane]);
  React.useEffect(() => {
    if (params.coopId) setCoopId(params.coopId);
  }, [params.coopId]);

  React.useEffect(() => {
    if (!sessionToken) return;
    api
      .listCommonsDirectory(sessionToken)
      .then((result) => {
        const active = result.coops
          .filter((item) => item.accessStatus === 'ACTIVE')
          .map((item) => ({ id: item.id, name: item.name || item.shortName }));
        const requestedId = params.coopId || sessionCoopId;
        const requestedName = user?.coop?.id === requestedId ? user.coop.name : requestedId === FALLBACK_COMMONS_ID ? 'Cahootz' : 'Your commons';
        const withDefault = active.some((item) => item.id === FALLBACK_COMMONS_ID)
          ? active
          : [{ id: FALLBACK_COMMONS_ID, name: user?.coop?.id === FALLBACK_COMMONS_ID ? user.coop.name : 'Cahootz' }, ...active];
        const choices = withDefault.some((item) => item.id === requestedId)
          ? withDefault
          : [{ id: requestedId, name: requestedName }, ...withDefault];
        setCommons(choices);
        setCoopId((current) => (choices.some((item) => item.id === current) || choices.length === 0 ? current : choices[0].id));
      })
      .catch((loadError) => console.error('Failed to load board commons:', loadError));
  }, [params.coopId, sessionCoopId, sessionToken, user?.coop?.id, user?.coop?.name]);

  const load = React.useCallback(async () => {
    if (!sessionToken || lane === 'marketplace') return;
    setError('');
    try {
      const apiLane: ApiBoardLane = lane === 'index' ? 'all' : lane;
      const result = await api.listBoardItems({ coopId, lane: apiLane, query: query.trim() || undefined }, sessionToken);
      setItems(result.items);
      setLaneCounts(result.laneCounts || emptyCounts);
    } catch (loadError) {
      console.error('Failed to load board:', loadError);
      setError(friendlyError(loadError, "We couldn't load the community board."));
      setItems([]);
    }
  }, [coopId, lane, query, sessionToken]);

  const loadMarketplacePreview = React.useCallback(async () => {
    if (!sessionToken) return;
    setMarketplaceError(false);
    try {
      const [productResult, shopResult] = await Promise.all([
        api.getProducts({ coopId, limit: 3 }),
        user?.walletAddress
          ? api.getMyStores(user.walletAddress).then((stores) => stores?.[0] ?? null).catch(() => null)
          : Promise.resolve(null),
      ]);
      setMarketplaceProducts((productResult?.products ?? []).slice(0, 3));
      setMarketplaceShop(shopResult);
    } catch (previewError) {
      console.error('Failed to load marketplace preview:', previewError);
      setMarketplaceProducts([]);
      setMarketplaceError(true);
    }
  }, [coopId, sessionToken, user?.walletAddress]);

  React.useEffect(() => {
    if (lane === 'marketplace') return;
    setLoading(true);
    const timer = setTimeout(() => load().finally(() => setLoading(false)), query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [lane, load, query]);

  React.useEffect(() => {
    if (lane !== 'index') return;
    setMarketplaceLoading(true);
    loadMarketplacePreview().finally(() => setMarketplaceLoading(false));
  }, [lane, loadMarketplacePreview]);

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([load(), lane === 'index' ? loadMarketplacePreview() : Promise.resolve()]);
    setRefreshing(false);
  };

  const selectLane = (next: BoardLane) => {
    setQuery('');
    setLane(next);
    router.setParams({ lane: next === 'index' ? undefined : next } as any);
  };

  const selectCommons = (nextCoopId: string) => {
    setCoopId(nextCoopId);
    router.setParams({ coopId: nextCoopId } as any);
  };

  const resetComposer = (type: BoardPostType | null = null) => {
    setPostType(type);
    setTitle('');
    setBody('');
    setComposerOpen(true);
  };

  const choosePost = (choice: (typeof postChoices)[number]) => {
    if (choice.type) {
      setPostType(choice.type);
      return;
    }
    setComposerOpen(false);
    if (choice.route === 'event') router.push({ pathname: '/[coopId]/events/create', params: { coopId } });
  };

  const publish = async () => {
    if (!sessionToken || !postType || !title.trim() || !body.trim() || publishing) return;
    setPublishing(true);
    try {
      await api.createCommonsPost(
        {
          coopId,
          title: title.trim(),
          content: body.trim(),
          tag: postType,
        },
        sessionToken,
      );
      setComposerOpen(false);
      await load();
    } catch (publishError) {
      console.error('Failed to publish board item:', publishError);
      Alert.alert("Couldn't add that to the board", friendlyError(publishError, 'Your words are still here. Please try again.'));
    } finally {
      setPublishing(false);
    }
  };

  if (!authLoading && !user) return <Redirect href={{ pathname: '/', params: { entry: 'sign-in' } } as any} />;
  if (lane === 'marketplace') return <MarketplaceLane initialCoopId={coopId} />;

  const selectedCommons = commons.find((item) => item.id === coopId)?.name || 'Your commons';
  const isIndex = lane === 'index';
  const laneDetails = lane === 'all'
    ? { title: 'All current postings', note: 'Everything members have put on the board, newest first.' }
    : !isIndex
      ? laneCopy[lane as 'needs' | 'offers' | 'events']
      : null;
  const visibleItems = isIndex && !query ? items.slice(0, 6) : items;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: tokens.paper }}>
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={tokens.orange} />}
        contentContainerStyle={{ paddingBottom: 112 }}
      >
        <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: tokens.rule }}>
          {!isIndex ? (
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to board index" onPress={() => selectLane('index')} style={{ minHeight: 44, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center' }}>
              <ArrowLeft size={17} color={tokens.inkSoft} />
              <Text style={{ marginLeft: 7, color: tokens.inkSoft, fontSize: 14, fontWeight: '700' }}>All sections</Text>
            </TouchableOpacity>
          ) : null}

          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
            <View style={{ minWidth: 0, flex: 1 }}>
              <Text style={{ color: tokens.orange, fontSize: 11, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase' }}>
                Community board · {selectedCommons}
              </Text>
              <Text accessibilityRole="header" style={{ marginTop: 4, color: tokens.ink, fontSize: isIndex ? 32 : 28, lineHeight: isIndex ? 36 : 32, fontWeight: '900', letterSpacing: -0.8 }}>
                {isIndex ? 'Find your way around' : laneDetails?.title}
              </Text>
              <Text style={{ marginTop: 5, maxWidth: 620, color: tokens.inkSoft, fontSize: 15, lineHeight: 22 }}>
                {isIndex ? 'Browse community posts and verified resources.' : laneDetails?.note}
              </Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Add to board"
              onPress={() => resetComposer()}
              style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: tokens.ink, borderRadius: 8, paddingHorizontal: 12, backgroundColor: tokens.ink }}
            >
              <Plus size={17} color={tokens.sheet} />
              <Text style={{ marginLeft: 5, color: tokens.sheet, fontSize: 13, fontWeight: '800' }}>Post</Text>
            </TouchableOpacity>
          </View>

          {commons.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 14 }} contentContainerStyle={{ gap: 8 }}>
              {commons.map((item) => {
                const selected = item.id === coopId;
                return (
                  <TouchableOpacity
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Board ${item.name}`}
                    accessibilityState={{ selected }}
                    onPress={() => selectCommons(item.id)}
                    style={{ minHeight: 44, justifyContent: 'center', borderBottomWidth: selected ? 3 : 1, borderBottomColor: selected ? tokens.orange : tokens.rule, paddingHorizontal: 10 }}
                  >
                    <Text style={{ color: selected ? tokens.ink : tokens.muted, fontSize: 13, fontWeight: selected ? '800' : '600' }}>{item.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : null}
        </View>

        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <Text style={{ marginBottom: 6, color: tokens.inkSoft, fontSize: 13, fontWeight: '800' }}>Search this board</Text>
          <View style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: tokens.rule, borderRadius: 8, backgroundColor: tokens.sheet, paddingHorizontal: 12 }}>
            <Search size={19} color={tokens.muted} />
            <TextInput
              accessibilityLabel="Search community board"
              value={query}
              onChangeText={setQuery}
              placeholder="Try “garden,” “childcare,” or “meeting”"
              placeholderTextColor={tokens.muted}
              style={{ minHeight: 46, flex: 1, paddingHorizontal: 10, color: tokens.ink, fontSize: 15 }}
            />
            {query ? (
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Clear board search" onPress={() => setQuery('')} style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}>
                <X size={17} color={tokens.muted} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {isIndex && !query ? (
          <BoardIndex
            counts={laneCounts}
            marketplaceError={marketplaceError}
            marketplaceLoading={marketplaceLoading}
            marketplaceProducts={marketplaceProducts}
            marketplaceShop={marketplaceShop}
            marketplaceTotalItems={totalItems}
            twoColumns={width >= 720}
            onSelectLane={selectLane}
            onOpenResources={() => router.push({ pathname: '/(authenticated)/commons-resources', params: { coopId } } as any)}
            onOpenCart={() => router.push('/(authenticated)/cart' as any)}
            onOpenProduct={(productId) => router.push(`/product-detail?id=${productId}` as any)}
            onOpenShop={() => router.push(marketplaceShop ? ('/my-stores' as any) : ('/apply-store' as any))}
            onQuickPost={(type) => resetComposer(type)}
            onCreateEvent={() => router.push({ pathname: '/[coopId]/events/create', params: { coopId } })}
          />
        ) : null}

        <BoardItems
          compact={isIndex && !query}
          error={error}
          items={visibleItems}
          loading={loading}
          onOpen={(item) => {
            if (item.tag === 'Event' && item.event?.id) {
              router.push({ pathname: '/[coopId]/events/[eventId]', params: { coopId, eventId: item.event.id } });
              return;
            }
            router.push({ pathname: '/[coopId]/posts/[postId]', params: { coopId, postId: item.id } });
          }}
          onRetry={() => void load()}
          onSeeAll={() => selectLane('all')}
          onStart={() => resetComposer()}
        />
      </ScrollView>

      <Composer
        body={body}
        open={composerOpen}
        postType={postType}
        publishing={publishing}
        title={title}
        onBodyChange={setBody}
        onChoose={choosePost}
        onClose={() => setComposerOpen(false)}
        onPublish={() => void publish()}
        onResetChoice={() => setPostType(null)}
        onTitleChange={setTitle}
      />
    </SafeAreaView>
  );
}
function BoardIndex({ counts, marketplaceError, marketplaceLoading, marketplaceProducts, marketplaceShop, marketplaceTotalItems, twoColumns, onSelectLane, onOpenResources, onOpenCart, onOpenProduct, onOpenShop, onQuickPost, onCreateEvent }: {
  counts: LaneCounts;
  marketplaceError: boolean;
  marketplaceLoading: boolean;
  marketplaceProducts: MarketplacePreviewProduct[];
  marketplaceShop: MarketplaceShop | null;
  marketplaceTotalItems: number;
  twoColumns: boolean;
  onSelectLane: (lane: BoardLane) => void;
  onOpenResources: () => void;
  onOpenCart: () => void;
  onOpenProduct: (productId: string) => void;
  onOpenShop: () => void;
  onQuickPost: (type: BoardPostType) => void;
  onCreateEvent: () => void;
}) {
  const groups = [
    {
      title: 'Board posts',
      rows: [
        { label: 'All board posts', note: 'Everything posted to this board', icon: Megaphone, tone: tokens.blue, action: () => onSelectLane('all') },
        { label: 'Needs & questions', note: 'Commons posts asking for help or answers', icon: CircleHelp, tone: tokens.orange, count: counts.needs, action: () => onSelectLane('needs') },
        { label: 'Offers', note: 'Commons posts offering help or resources', icon: HandHeart, tone: tokens.green, count: counts.offers, action: () => onSelectLane('offers') },
        { label: 'Events', note: 'Real events created in this Commons', icon: CalendarDays, tone: tokens.plum, count: counts.events, action: () => onSelectLane('events') },
      ],
    },
    {
      title: 'Community',
      rows: [
        { label: 'Verified resources', note: 'Resources Sage found and an admin published', icon: BookOpen, tone: tokens.ochre, action: onOpenResources },
      ],
    },
  ];

  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 24 }}>
      <View style={{ paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: tokens.rule }}>
        <Text accessibilityRole="header" style={{ color: tokens.ink, fontSize: 18, fontWeight: '900' }}>Put something up</Text>
        <View style={{ marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <QuickAction label="Ask" icon={CircleHelp} onPress={() => onQuickPost('Ask')} />
          <QuickAction label="Offer" icon={HandHeart} onPress={() => onQuickPost('Offer')} />
          <QuickAction label="Update" icon={Megaphone} onPress={() => onQuickPost('Update')} />
          <QuickAction label="Event" icon={CalendarDays} onPress={onCreateEvent} />
        </View>
      </View>

      <MarketplacePreview
        error={marketplaceError}
        loading={marketplaceLoading}
        products={marketplaceProducts}
        shop={marketplaceShop}
        totalItems={marketplaceTotalItems}
        twoColumns={twoColumns}
        onBrowse={() => onSelectLane('marketplace')}
        onOpenCart={onOpenCart}
        onOpenProduct={onOpenProduct}
        onOpenShop={onOpenShop}
      />

      <Text accessibilityRole="header" style={{ marginTop: 22, color: tokens.ink, fontSize: 18, fontWeight: '900' }}>Browse the board</Text>
      <View style={{ marginTop: 8, flexDirection: twoColumns ? 'row' : 'column', flexWrap: 'wrap', columnGap: 24 }}>
        {groups.map((group) => (
          <View key={group.title} style={{ width: twoColumns ? '48%' : '100%', marginBottom: 18 }}>
            <Text style={{ paddingVertical: 9, color: tokens.muted, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' }}>{group.title}</Text>
            <View style={{ borderTopWidth: 1, borderTopColor: tokens.rule }}>
              {group.rows.map((row) => <DirectoryRow key={row.label} {...row} />)}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function MarketplacePreview({ error, loading, products, shop, totalItems, twoColumns, onBrowse, onOpenCart, onOpenProduct, onOpenShop }: {
  error: boolean;
  loading: boolean;
  products: MarketplacePreviewProduct[];
  shop: MarketplaceShop | null;
  totalItems: number;
  twoColumns: boolean;
  onBrowse: () => void;
  onOpenCart: () => void;
  onOpenProduct: (productId: string) => void;
  onOpenShop: () => void;
}) {
  const shopStatus = !shop
    ? null
    : shop.status === 'APPROVED'
      ? 'Live and accepting orders'
      : shop.application?.status === 'APPROVED'
        ? 'Approved · finish payment setup'
        : 'Application under commons review';
  const visibleProducts = products.slice(0, twoColumns ? 3 : 2);

  return (
    <View accessibilityLabel="Marketplace preview" style={{ marginTop: 22, borderTopWidth: 3, borderTopColor: tokens.orange, borderBottomWidth: 1, borderBottomColor: tokens.rule, backgroundColor: tokens.sheetWarm, paddingHorizontal: 12, paddingTop: 14, paddingBottom: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ minWidth: 0, flex: 1 }}>
          <Text accessibilityRole="header" style={{ color: tokens.ink, fontSize: 20, lineHeight: 24, fontWeight: '900' }}>Marketplace</Text>
          <Text style={{ marginTop: 3, maxWidth: 520, color: tokens.inkSoft, fontSize: 13, lineHeight: 19 }}>Buy from community stores or open your own.</Text>
        </View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Open shopping cart" onPress={onOpenCart} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: tokens.rule, borderRadius: 8, backgroundColor: tokens.sheet, paddingHorizontal: 10 }}>
          <ShoppingCart size={18} color={tokens.ink} />
          <Text numberOfLines={1} style={{ marginLeft: 6, color: tokens.ink, fontSize: 12, fontWeight: '900' }}>Cart{totalItems ? ` · ${totalItems}` : ''}</Text>
        </TouchableOpacity>
      </View>

      {shop ? (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Manage my shop" onPress={onOpenShop} style={{ marginTop: 12, minHeight: 54, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderBottomWidth: 1, borderColor: tokens.rule, paddingVertical: 7 }}>
          <View style={{ width: 36, height: 36, marginRight: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: tokens.orangePale }}><Store size={18} color={tokens.orange} /></View>
          <View style={{ minWidth: 0, flex: 1 }}>
            <Text numberOfLines={1} style={{ color: tokens.ink, fontSize: 13, fontWeight: '900' }}>{shop.name}</Text>
            <Text numberOfLines={1} style={{ marginTop: 2, color: tokens.muted, fontSize: 11 }}>{shopStatus}</Text>
          </View>
          <ChevronRight size={17} color={tokens.muted} />
        </TouchableOpacity>
      ) : null}

      <View style={{ marginTop: 13, flexDirection: twoColumns ? 'row' : 'column', flexWrap: 'wrap', gap: 8 }}>
        {loading
          ? [0, 1].map((key) => <View key={key} style={{ width: twoColumns ? '48%' : '100%', height: 78, backgroundColor: tokens.sheet, opacity: 0.7 }} />)
          : visibleProducts.map((product) => (
              <TouchableOpacity key={product.id} accessibilityRole="button" accessibilityLabel={`View ${product.name}`} onPress={() => onOpenProduct(product.id)} style={{ width: twoColumns ? '48%' : '100%', minHeight: 78, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: tokens.rule, backgroundColor: tokens.sheet, padding: 8 }}>
                <View style={{ width: 58, height: 58, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.orangePale }}>
                  {product.imageUrl ? <Image source={{ uri: product.imageUrl }} resizeMode="cover" style={{ width: '100%', height: '100%' }} /> : <ShoppingBag size={23} color={tokens.orange} />}
                </View>
                <View style={{ minWidth: 0, flex: 1, paddingHorizontal: 10 }}>
                  <Text numberOfLines={1} style={{ color: tokens.ink, fontSize: 13, fontWeight: '900' }}>{product.name}</Text>
                  <Text numberOfLines={1} style={{ marginTop: 2, color: tokens.muted, fontSize: 11 }}>{product.store.name}</Text>
                  <Text style={{ marginTop: 5, color: tokens.orange, fontSize: 13, fontWeight: '900' }}>${product.priceUSD.toLocaleString('en-US', { maximumFractionDigits: 0 })}</Text>
                </View>
                <ChevronRight size={17} color={tokens.muted} />
              </TouchableOpacity>
            ))}
      </View>

      {!loading && error ? <Text style={{ marginTop: 12, color: tokens.danger, fontSize: 13, fontWeight: '700' }}>The shop preview couldn’t load. Open Marketplace to try again.</Text> : null}
      {!loading && !error && products.length === 0 ? <Text style={{ marginTop: 12, color: tokens.muted, fontSize: 13 }}>No products are listed in this commons yet.</Text> : null}

      <View style={{ marginTop: 14, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Browse marketplace" onPress={onBrowse} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', borderRadius: 7, backgroundColor: tokens.ink, paddingHorizontal: 13 }}>
          <ShoppingBag size={17} color={tokens.sheet} />
          <Text numberOfLines={1} style={{ marginLeft: 7, color: tokens.sheet, fontSize: 13, fontWeight: '900' }}>Browse market</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={shop ? 'Manage my shop' : 'Open a shop'} onPress={onOpenShop} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: tokens.ink, borderRadius: 7, backgroundColor: tokens.sheet, paddingHorizontal: 13 }}>
          {shop ? <Store size={17} color={tokens.ink} /> : <Plus size={17} color={tokens.ink} />}
          <Text numberOfLines={1} style={{ marginLeft: 7, color: tokens.ink, fontSize: 13, fontWeight: '900' }}>{shop ? 'Manage shop' : 'Open shop'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function QuickAction({ label, icon: Icon, onPress }: { label: string; icon: typeof CircleHelp; onPress: () => void }) {
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={label === 'Ask' ? 'Ask for help' : `Quick post ${label}`} onPress={onPress} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: tokens.rule, borderRadius: 6, backgroundColor: tokens.sheet, paddingHorizontal: 12 }}>
      <View style={{ width: 24, alignItems: 'center', justifyContent: 'center' }}><Icon size={19} strokeWidth={2.2} color={tokens.orange} /></View>
      <Text style={{ marginLeft: 7, color: tokens.ink, fontSize: 13, fontWeight: '800' }}>{label}</Text>
    </TouchableOpacity>
  );
}

function DirectoryRow({ label, note, icon: Icon, tone, count, action }: { label: string; note: string; icon: typeof CircleHelp; tone: string; count?: number; action: () => void }) {
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Open ${label}`} onPress={action} style={{ minHeight: 68, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: tokens.ruleLight, paddingVertical: 9 }}>
      <View style={{ width: 40, height: 40, marginRight: 11, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: tokens.sheetWarm }}>
        <Icon size={21} strokeWidth={2.2} color={tone} />
      </View>
      <View style={{ minWidth: 0, flex: 1, paddingRight: 8 }}>
        <Text numberOfLines={1} style={{ color: tokens.ink, fontSize: 15, fontWeight: '800' }}>{label}</Text>
        <Text numberOfLines={1} style={{ marginTop: 2, color: tokens.muted, fontSize: 12 }}>{note}</Text>
      </View>
      {typeof count === 'number' ? <Text style={{ minWidth: 24, textAlign: 'right', color: tokens.muted, fontSize: 13, fontWeight: '800' }}>{count}</Text> : null}
      <ChevronRight size={17} color={tokens.muted} style={{ marginLeft: 8 }} />
    </TouchableOpacity>
  );
}

function BoardItems({ compact, error, items, loading, onOpen, onRetry, onSeeAll, onStart }: {
  compact: boolean;
  error: string;
  items: CommonsPost[];
  loading: boolean;
  onOpen: (item: CommonsPost) => void;
  onRetry: () => void;
  onSeeAll: () => void;
  onStart: () => void;
}) {
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: compact ? 4 : 22 }}>
      {compact ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: tokens.rule, paddingBottom: 8 }}>
          <Text accessibilityRole="header" style={{ color: tokens.ink, fontSize: 18, fontWeight: '900' }}>Recently posted</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="See all board postings" onPress={onSeeAll} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: tokens.orange, fontSize: 13, fontWeight: '800' }}>See all</Text></TouchableOpacity>
        </View>
      ) : null}

      {loading ? (
        <View style={{ paddingVertical: 36 }}>
          {[0, 1, 2].map((key) => <View key={key} style={{ height: 78, marginBottom: 10, backgroundColor: tokens.sheetWarm, opacity: 0.65 }} />)}
        </View>
      ) : error ? (
        <View style={{ alignItems: 'flex-start', paddingVertical: 28 }}>
          <Text style={{ color: tokens.danger, fontSize: 15, fontWeight: '800' }}>{error}</Text>
          <TouchableOpacity accessibilityRole="button" onPress={onRetry} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: tokens.orange, fontWeight: '800' }}>Try again</Text></TouchableOpacity>
        </View>
      ) : items.length === 0 ? (
        <View style={{ alignItems: 'flex-start', borderBottomWidth: 1, borderBottomColor: tokens.rule, paddingVertical: 28 }}>
          <PackageOpen size={25} color={tokens.orange} />
          <Text style={{ marginTop: 10, color: tokens.ink, fontSize: 17, fontWeight: '900' }}>Nothing posted here yet</Text>
          <Text style={{ marginTop: 4, color: tokens.muted, fontSize: 14, lineHeight: 20 }}>Create an Ask, Offer, or Update with the same Commons posting tools used elsewhere in the app.</Text>
          <TouchableOpacity accessibilityRole="button" onPress={onStart} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: tokens.orange, fontWeight: '800' }}>Post something</Text></TouchableOpacity>
        </View>
      ) : (
        <View style={{ borderBottomWidth: 1, borderBottomColor: tokens.rule }}>
          {items.map((item) => <BoardRow key={item.id} item={item} onOpen={() => onOpen(item)} />)}
        </View>
      )}
    </View>
  );
}

function BoardRow({ item, onOpen }: { item: CommonsPost; onOpen: () => void }) {
  const Icon = iconForTag(item.tag);
  const tone = toneForTag(item.tag);
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: tokens.ruleLight, backgroundColor: tokens.sheet }}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Open ${item.title}`} onPress={onOpen} activeOpacity={0.72} style={{ paddingHorizontal: 12, paddingVertical: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <View style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: tone.paper }}>
            <Icon size={21} strokeWidth={2.2} color={tone.ink} />
          </View>
          <View style={{ minWidth: 0, flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 }}>
              <Text style={{ color: tone.ink, fontSize: 10, fontWeight: '900', letterSpacing: 0.8, textTransform: 'uppercase' }}>{item.tag}</Text>
            </View>
            <Text style={{ marginTop: 3, color: tokens.ink, fontSize: 16, lineHeight: 21, fontWeight: '900' }}>{item.title}</Text>
            <Text numberOfLines={2} style={{ marginTop: 3, color: tokens.inkSoft, fontSize: 13, lineHeight: 19 }}>{item.body}</Text>
            <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <Text numberOfLines={1} style={{ minWidth: 0, flex: 1, color: tokens.muted, fontSize: 11 }}>@{item.authorHandle || item.author} · {item.time}</Text>
              <Text style={{ color: tokens.blue, fontSize: 11, fontWeight: '800' }}>{item.replies} {item.replies === 1 ? 'reply' : 'replies'} →</Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    </View>
  );
}

function Composer({ open, postType, title, body, publishing, onClose, onChoose, onResetChoice, onTitleChange, onBodyChange, onPublish }: {
  open: boolean;
  postType: BoardPostType | null;
  title: string;
  body: string;
  publishing: boolean;
  onClose: () => void;
  onChoose: (choice: (typeof postChoices)[number]) => void;
  onResetChoice: () => void;
  onTitleChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onPublish: () => void;
}) {
  const selected = postChoices.find((choice) => choice.type === postType);
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(33, 26, 20, 0.42)' }}>
        <View style={{ maxHeight: '90%', borderTopLeftRadius: 16, borderTopRightRadius: 16, backgroundColor: tokens.sheet, paddingHorizontal: 16, paddingTop: 18, paddingBottom: 30 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <View style={{ minWidth: 0, flex: 1, paddingRight: 12 }}>
              <Text style={{ color: tokens.orange, fontSize: 11, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase' }}>Post to the board</Text>
              <Text accessibilityRole="header" style={{ marginTop: 3, color: tokens.ink, fontSize: 24, lineHeight: 29, fontWeight: '900' }}>{selected ? selected.label : 'What are you putting up?'}</Text>
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close board composer" onPress={onClose} style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}><X size={20} color={tokens.ink} /></TouchableOpacity>
          </View>

          <ScrollView style={{ marginTop: 12 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {!postType ? (
              <View style={{ borderTopWidth: 1, borderTopColor: tokens.rule }}>
                {postChoices.map((choice) => {
                  const Icon = choice.icon;
                  return (
                    <TouchableOpacity key={choice.label} accessibilityRole="button" accessibilityLabel={choice.label} onPress={() => onChoose(choice)} style={{ minHeight: 68, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: tokens.ruleLight, paddingVertical: 10 }}>
                      <View style={{ width: 40, height: 40, marginRight: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: tokens.sheetWarm }}><Icon size={21} strokeWidth={2.2} color={choice.tone} /></View>
                      <View style={{ minWidth: 0, flex: 1 }}><Text style={{ color: tokens.ink, fontSize: 15, fontWeight: '900' }}>{choice.label}</Text><Text numberOfLines={2} style={{ marginTop: 2, color: tokens.muted, fontSize: 12, lineHeight: 17 }}>{choice.note}</Text></View>
                      <ChevronRight size={17} color={tokens.muted} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : (
              <View>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Choose a different post type" onPress={onResetChoice} style={{ minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center' }}><Text style={{ color: tokens.orange, fontSize: 13, fontWeight: '800' }}>← Choose a different kind</Text></TouchableOpacity>
                <Text style={{ marginTop: 8, marginBottom: 6, color: tokens.inkSoft, fontSize: 13, fontWeight: '800' }}>Headline</Text>
                <TextInput accessibilityLabel="Board item title" value={title} onChangeText={onTitleChange} placeholder="Example: Looking for help with Saturday's cleanup" placeholderTextColor={tokens.muted} style={{ minHeight: 48, borderWidth: 1, borderColor: tokens.rule, borderRadius: 7, paddingHorizontal: 12, color: tokens.ink, fontSize: 15 }} />
                <Text style={{ marginTop: 15, marginBottom: 6, color: tokens.inkSoft, fontSize: 13, fontWeight: '800' }}>Details</Text>
                <TextInput accessibilityLabel="Board item details" value={body} onChangeText={onBodyChange} placeholder="Include the place, timing, and how someone should respond." placeholderTextColor={tokens.muted} multiline style={{ minHeight: 116, borderWidth: 1, borderColor: tokens.rule, borderRadius: 7, paddingHorizontal: 12, paddingVertical: 11, color: tokens.ink, fontSize: 15, lineHeight: 21, textAlignVertical: 'top' }} />
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Publish board item" disabled={!title.trim() || !body.trim() || publishing} onPress={onPublish} style={{ minHeight: 48, marginTop: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 7, backgroundColor: tokens.ink, opacity: !title.trim() || !body.trim() || publishing ? 0.5 : 1 }}>
                  {publishing ? <ActivityIndicator color={tokens.sheet} /> : <Text style={{ color: tokens.sheet, fontSize: 14, fontWeight: '900' }}>Publish post</Text>}
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
