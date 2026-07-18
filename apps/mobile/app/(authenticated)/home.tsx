import React, { useEffect, useState, useCallback } from 'react';
import { ScrollView, View, RefreshControl, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowDownLeft, ArrowUpRight, Clock, Wallet, Copy, Check, Store, TrendingUp, Coins, Newspaper } from 'lucide-react-native';
import { router, useFocusEffect } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { useCoin } from '@/contexts/platform-config-context';
import { api } from '@/lib/api';
import { coopConfig } from '@/lib/coop-config';
import { resolveBrandColor, withAlpha } from '@/lib/brand-colors';
import { hasLocalWalletPrivateKey } from '@/lib/mobile-wallet';

/**
 * Format SC balance as whole integers with comma separators.
 * SC rewards are whole numbers (10 SC per $1), so no decimals needed.
 */
function formatSCBalance(raw: string): string {
  const num = parseFloat(raw);
  if (isNaN(num) || num === 0) return '0';
  return Math.floor(num).toLocaleString();
}

/**
 * Truncate wallet address for display
 */
function truncateAddress(address: string): string {
  if (!address || address.length < 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function HomeScreen() {
  const { user } = useAuth();
  const coin = useCoin();
  const config = coopConfig();
  const primaryColor = resolveBrandColor(user?.coop?.primaryColor || config.primaryColor, '#B45309');
  const accentColor = resolveBrandColor(user?.coop?.accentColor || config.accentColor, '#16A34A');
  const isDemoAccount = user?.coop?.id === 'demo';
  const [scBalance, setScBalance] = useState<string>('0');
  const [ucBalance, setUcBalance] = useState<string>('0');
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [recentTransactions, setRecentTransactions] = useState<any[]>([]);
  const [walletAddress, setWalletAddress] = useState<string | null>(user?.walletAddress || null);
  const [walletType, setWalletType] = useState<'EXTERNAL' | 'MANAGED' | null>(null);
  const [localSigningEnabled, setLocalSigningEnabled] = useState(false);
  const [isCreatingWallet, setIsCreatingWallet] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (user?.id) {
      loadData();
    }
  }, [user?.id]);

  // Refresh balances and recent transactions whenever the screen comes back into focus
  // (e.g. after returning from a store purchase or sending a payment)
  useFocusEffect(
    useCallback(() => {
      if (user?.id && !isLoading) {
        loadData();
      }
    }, [user?.id])
  );

  const loadData = async () => {
    if (!user?.id) return;

    try {
      // First get wallet info to ensure we have the latest address
      const walletResult = await api.getWalletInfo(user.id, user.walletAddress);
      let currentWalletAddress = user.walletAddress;

      // If user has a wallet but our session doesn't have it, update the address
      if (walletResult?.hasWallet && walletResult?.address) {
        setWalletAddress(walletResult.address);
        setWalletType(walletResult.walletType);
        currentWalletAddress = walletResult.address;

        const hasLocalKey = await hasLocalWalletPrivateKey(user.id, walletResult.address);
        setLocalSigningEnabled(hasLocalKey);
      } else {
        setWalletType(null);
        setLocalSigningEnabled(false);
      }

      // Fetch history, orders, and SC rewards
      try {
        const [historyResult, ordersResult, scRewardsResult] = await Promise.all([
          api.getP2PHistory(user.id, 10, 0, currentWalletAddress),
          currentWalletAddress 
            ? api.getMyOrders(currentWalletAddress, 10).catch(() => ({ orders: [] }))
            : Promise.resolve({ orders: [] }),
          api.getUserSCRewards(user.id, 10, currentWalletAddress).catch(() => ({ rewards: [] }))
        ]);

        // Merge and sort by date
        const transfers = historyResult.transfers.map((t: any) => ({ 
          ...t, 
          activityType: 'transfer' 
        }));
        
        const orders = (ordersResult?.orders || []).map((o: any) => ({ 
          ...o, 
          activityType: 'order',
          counterparty: o.store?.name || 'Store Purchase',
          amount: o.totalUSD,
          type: 'sent' // Orders are always outgoing
        }));

        const scRewards = (scRewardsResult?.rewards || []).map((r: any) => ({
          ...r,
          activityType: 'scReward',
          counterparty: r.reason === 'STORE_PURCHASE_REWARD' 
            ? `${coin.symbol} Reward from ${r.relatedStore?.name || 'Store'}`
            : r.reason === 'STORE_SALE_REWARD'
            ? `${coin.symbol} Reward - Sale`
            : `${coin.symbol} Reward`,
          amount: r.amountSC,
          type: 'received', // SC rewards are always incoming
          createdAt: r.completedAt || r.createdAt,
        }));

        const combined = [...transfers, ...orders, ...scRewards]
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 5);

        setRecentTransactions(combined);
      } catch (historyErr) {
        console.error('Error loading history:', historyErr);
        // Don't fail the whole load if history fails
      }

      // Fetch token balances (SC and UC)
      if (currentWalletAddress) {
        try {
          const tokenBalances = await api.getTokenBalances(currentWalletAddress);
          console.log('📊 Token Balances Response:', tokenBalances);
          console.log('💰 SC Balance:', tokenBalances.sc);
          console.log('💰 UC Balance:', tokenBalances.uc);
          setScBalance(tokenBalances.sc);
          setUcBalance(tokenBalances.uc);
        } catch (tokenErr) {
          console.error('Error loading token balances:', tokenErr);
        }
      }
    } catch (err) {
      console.error('Error loading data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [user?.id]);

  const handleCreateWallet = async () => {
    if (!user?.id) return;
    setIsCreatingWallet(true);
    try {
      const result = await api.createWallet(user.id);
      if (result?.address) {
        setWalletAddress(result.address);
        setWalletType('MANAGED');
        setLocalSigningEnabled(false);
      }
    } catch (error) {
      console.error('Failed to create wallet:', error);
    } finally {
      setIsCreatingWallet(false);
    }
  };

  const handleCopyAddress = async () => {
    if (!walletAddress) return;
    await Clipboard.setStringAsync(walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <ScrollView
        className="flex-1"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View className="p-6">
          {/* Welcome Header */}
          <View className="flex-row items-start justify-between mb-4">
            <View className="flex-1">
              <Text className="text-lg text-gray-600">
                Welcome back,
              </Text>
              <Text className="text-2xl font-bold text-gray-900">
                {user?.name || user?.email?.split('@')[0]}
              </Text>
            </View>

            {/* Wallet Address Badge */}
            {walletAddress ? (
              <TouchableOpacity
                onPress={handleCopyAddress}
                className="flex-row items-center rounded-full bg-gray-100 px-3 py-2"
                activeOpacity={0.7}
              >
                <Wallet size={14} color="#6b7280" />
                <Text className="ml-1.5 font-mono text-xs text-gray-600">
                  {truncateAddress(walletAddress)}
                </Text>
                {copied ? (
                  <Check size={12} color="#22c55e" style={{ marginLeft: 4 }} />
                ) : (
                  <Copy size={12} color="#9ca3af" style={{ marginLeft: 4 }} />
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={handleCreateWallet}
                disabled={isCreatingWallet}
                className="rounded-full px-4 py-2"
                style={{ backgroundColor: accentColor, opacity: isCreatingWallet ? 0.7 : 1 }}
              >
                {isCreatingWallet ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <View className="flex-row items-center">
                    <Wallet size={14} color="#fff" />
                    <Text className="ml-1.5 text-xs font-medium text-white">Create Wallet</Text>
                  </View>
                )}
              </TouchableOpacity>
            )}
          </View>

          {walletAddress && walletType === 'MANAGED' && !localSigningEnabled && (
            <View className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <View className="flex-row items-start justify-between">
                <View className="flex-1 pr-4">
                  <Text className="text-sm font-semibold text-amber-900">Enable wallet signing</Text>
                  <Text className="mt-1 text-xs leading-5 text-amber-800">
                    Store your wallet key securely on this device so the app can sign verification messages.
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => router.push('/export-wallet')}
                  className="rounded-full px-3 py-2"
                  style={{ backgroundColor: accentColor }}
                >
                  <Text className="text-xs font-semibold text-white">Enable</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Balance Card - SC */}
          <View className="mb-4 rounded-2xl overflow-hidden" style={{ shadowColor: accentColor, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6 }}>
            <LinearGradient
              colors={['#111827', accentColor, primaryColor]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ padding: 20, borderRadius: 16 }}
            >
              <View className="flex-row items-center mb-3">
                <TrendingUp size={18} color="white" />
                <Text className="text-white/90 text-xs font-medium ml-2">{coin.name}</Text>
              </View>
              {isLoading ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <Text className="text-white text-2xl font-bold">{formatSCBalance(scBalance)} {coin.symbol}</Text>
              )}
            </LinearGradient>
          </View>

          {!isDemoAccount && <TouchableOpacity
            onPress={() => router.push('/(authenticated)/submit-newsletter' as any)}
            className="mb-4 rounded-2xl border border-gray-100 bg-white p-4"
            activeOpacity={0.85}
          >
            <View className="flex-row items-center">
              <View
                className="mr-4 h-12 w-12 items-center justify-center rounded-2xl"
                style={{ backgroundColor: withAlpha(primaryColor, '1A') }}
              >
                <Newspaper size={22} color={primaryColor} />
              </View>
              <View className="flex-1">
                <Text className="text-base font-semibold text-gray-900">Submit to the Newsletter</Text>
                <Text className="mt-1 text-sm leading-5 text-gray-500">
                  Send a story or event to the co-op paper.
                </Text>
              </View>
              <Text className="text-2xl text-gray-300">›</Text>
            </View>
          </TouchableOpacity>}

          {/* Recent Activity */}
          <View className="mb-4">
            <View className="flex-row justify-between items-center mb-4">
              <Text className="text-xl font-bold text-gray-900">Recent Activity</Text>
              {recentTransactions.length > 0 && (
                <TouchableOpacity
                  onPress={() => router.push('/(authenticated)/history' as any)}
                  className="bg-gray-100 px-3 py-1.5 rounded-full"
                >
                  <Text className="text-sm font-medium" style={{ color: accentColor }}>See All</Text>
                </TouchableOpacity>
              )}
            </View>

            {isLoading ? (
              <View className="bg-white rounded-2xl p-8 items-center">
                <ActivityIndicator size="small" color="#6B7280" />
              </View>
            ) : recentTransactions.length === 0 ? (
              <View className="bg-white rounded-2xl p-8 items-center">
                <View className="w-16 h-16 rounded-full bg-gray-100 items-center justify-center mb-4">
                  <Clock size={32} color="#9CA3AF" />
                </View>
                <Text className="text-gray-700 font-medium text-lg">No transactions yet</Text>
                <Text className="text-gray-400 text-sm mt-1 text-center">Send money to someone to get started</Text>
              </View>
            ) : (
              <View className="bg-white rounded-2xl overflow-hidden">
                {recentTransactions.map((tx, index) => {
                  // Determine icon and background color based on activity type
                  const isOrder = tx.activityType === 'order';
                  const isSCReward = tx.activityType === 'scReward';
                  const isReceived = tx.type === 'received';
                  
                  const iconBgColor = isOrder || isSCReward
                    ? withAlpha(accentColor, '1A')
                    : isReceived
                      ? '#DCFCE7'
                      : '#F3F4F6';
                  
                  const icon = isOrder ? (
                    <Store size={22} color={accentColor} />
                  ) : isSCReward ? (
                    <Coins size={22} color={accentColor} />
                  ) : isReceived ? (
                    <ArrowDownLeft size={22} color="#16A34A" />
                  ) : (
                    <ArrowUpRight size={22} color="#6B7280" />
                  );

                  const content = (
                    <>
                      <View
                        className="w-12 h-12 rounded-2xl items-center justify-center mr-4"
                        style={{ backgroundColor: iconBgColor }}
                      >
                        {icon}
                      </View>
                      <View className="flex-1">
                        <Text className="text-gray-900 font-semibold">{tx.counterparty}</Text>
                        <Text className="text-gray-400 text-xs mt-0.5">
                          {new Date(tx.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </Text>
                      </View>
                      <Text
                        className={`font-bold text-lg ${isReceived && !isSCReward ? 'text-green-600' : 'text-gray-900'}`}
                        style={isSCReward ? { color: accentColor } : undefined}
                      >
                        {isSCReward 
                          ? `+${formatSCBalance(String(tx.amount))} ${coin.symbol}`
                          : `${isReceived ? '+' : '-'}$${tx.amount.toFixed(2)}`
                        }
                      </Text>
                    </>
                  );

                  // Only make orders clickable
                  if (isOrder) {
                    return (
                      <TouchableOpacity
                        key={tx.id}
                        onPress={() => router.push(`/(authenticated)/order-detail?id=${tx.id}` as any)}
                        className={`flex-row items-center p-4 ${
                          index < recentTransactions.length - 1 ? 'border-b border-gray-50' : ''
                        }`}
                        activeOpacity={0.7}
                      >
                        {content}
                      </TouchableOpacity>
                    );
                  }

                  // Transfers and SC rewards are not clickable
                  return (
                    <View
                      key={tx.id}
                      className={`flex-row items-center p-4 ${
                        index < recentTransactions.length - 1 ? 'border-b border-gray-50' : ''
                      }`}
                    >
                      {content}
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          {/* Coop Info */}
          {user?.coop && (
            <View className="bg-white rounded-2xl p-4 mb-4">
              <Text className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-1">Member of</Text>
              <Text className="text-base font-semibold text-gray-900">{user.coop.name}</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
