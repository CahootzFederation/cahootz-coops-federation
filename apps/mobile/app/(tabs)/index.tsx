import { useState, useCallback } from "react";
import { View, TouchableOpacity, RefreshControl, ScrollView, ActivityIndicator } from "react-native";
import { useFocusEffect, router } from "expo-router";
import {
  Bell,
  Coins,
  TrendingUp,
  DollarSign,
  Wallet,
  QrCode,
  ShoppingBag,
  ShoppingCart,
  Store,
  ArrowDownLeft,
  ArrowUpRight,
  Clock
} from "lucide-react-native";

import { Text } from "@/components/ui/text";
import { useAuth } from "@/contexts/auth-context";
import { useCart } from "@/contexts/cart-context";
import { api } from "@/lib/api";

export default function HomeScreen() {
  const { user } = useAuth();
  const { totalItems } = useCart();
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState({ uc: 0, sc: 0, formatted: '$0.00' });
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [user?.id])
  );

  const loadData = async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }

    try {
      // Get wallet info and balance
      const walletInfo = await api.getWalletInfo(user.id);
      if (walletInfo?.hasWallet && walletInfo?.address) {
        const [balanceData, notificationData, tokenBalances] = await Promise.all([
          api.getUSDBalance(user.id, walletInfo.address),
          api.getUnreadNotificationCount(walletInfo.address).catch(() => ({ count: 0 })),
          api.getTokenBalances(walletInfo.address).catch(() => ({ sc: '0', uc: '0' })),
        ]);
        setBalance({
          uc: balanceData.balance || 0,
          sc: parseFloat(tokenBalances.sc) || 0,
          formatted: balanceData.formatted || '$0.00'
        });
        setUnreadNotifications(notificationData?.count || 0);

        // Fetch recent activity (transfers, orders, SC rewards)
        try {
          const [historyResult, ordersResult, scRewardsResult] = await Promise.all([
            api.getP2PHistory(user.id, 5, 0, walletInfo.address).catch(() => ({ transfers: [] })),
            api.getMyOrders(walletInfo.address, 5).catch(() => ({ orders: [] })),
            api.getUserSCRewards(user.id, 5, walletInfo.address).catch(() => ({ rewards: [] }))
          ]);

          const transfers = (historyResult.transfers || []).map((t: any) => ({ 
            ...t, 
            activityType: 'transfer' 
          }));
          
          const orders = (ordersResult?.orders || []).map((o: any) => ({ 
            ...o, 
            activityType: 'order',
            counterparty: o.store?.name || 'Store Purchase',
            amount: o.totalUSD,
            type: 'sent'
          }));

          const scRewards = (scRewardsResult?.rewards || []).map((r: any) => ({
            ...r,
            activityType: 'scReward',
            counterparty: r.reason === 'STORE_PURCHASE_REWARD' 
              ? `SC Reward from ${r.relatedStore?.name || 'Store'}`
              : r.reason === 'STORE_SALE_REWARD'
              ? `SC Reward - Sale`
              : 'SC Reward',
            amount: r.amountSC,
            type: 'received',
            createdAt: r.completedAt || r.createdAt,
          }));

          const combined = [...transfers, ...orders, ...scRewards]
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, 5);

          setRecentActivity(combined);
        } catch (activityErr) {
          console.error('Error loading activity:', activityErr);
        }
      }
    } catch (error) {
      console.error("Failed to load data:", error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const QuickActionButton = ({
    icon: Icon,
    label,
    onPress,
    color = '#B45309'
  }: {
    icon: any;
    label: string;
    onPress: () => void;
    color?: string;
  }) => (
    <TouchableOpacity
      onPress={onPress}
      className="flex-1 bg-white border border-amber-200 rounded-xl py-4 items-center justify-center"
      activeOpacity={0.7}
    >
      <Icon size={20} color={color} />
      <Text className="text-xs text-amber-700 mt-1 font-medium">{label}</Text>
    </TouchableOpacity>
  );

  return (
    <ScrollView
      className="flex-1 bg-gradient-to-br from-amber-50 to-orange-50"
      style={{ backgroundColor: '#FFFBEB' }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#B45309" />
      }
    >
      {/* Header */}
      <View className="px-4 pt-14 pb-4">
        <View className="flex-row items-center justify-between">
          <View className="flex-1">
            <Text className="text-xl font-bold text-gray-800">
              Welcome back{user?.name ? `, ${user.name.split(' ')[0]}` : ''}
            </Text>
            <Text className="text-gray-500 text-sm">Building community wealth together</Text>
          </View>
          <View className="flex-row gap-2">
            <TouchableOpacity
              className="p-2 rounded-full relative"
              onPress={() => router.push('/(authenticated)/cart')}
            >
              <ShoppingCart size={22} color="#B45309" />
              {totalItems > 0 && (
                <View className="absolute -top-1 -right-1 bg-red-500 w-5 h-5 rounded-full items-center justify-center">
                  <Text className="text-white text-xs font-bold">{totalItems > 99 ? '99+' : totalItems}</Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              className="p-2 rounded-full relative"
              onPress={() => router.push('/(authenticated)/notifications')}
            >
              <Bell size={22} color="#B45309" />
              {unreadNotifications > 0 && (
                <View className="absolute -top-1 -right-1 bg-red-500 w-5 h-5 rounded-full items-center justify-center">
                  <Text className="text-white text-xs font-bold">
                    {unreadNotifications > 99 ? '99+' : unreadNotifications}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Wallet Overview Cards */}
      <View className="px-4 flex-row gap-3">
        {/* Unity Coin Card */}
        <TouchableOpacity
          className="flex-1 rounded-2xl p-4 shadow-lg"
          style={{ backgroundColor: '#DC2626' }}
          onPress={() => router.push('/(tabs)/wallet')}
          activeOpacity={0.8}
        >
          <View className="flex-row items-center gap-2 mb-3">
            <Coins size={18} color="white" />
            <Text className="text-white text-sm font-medium">Unity Coin</Text>
          </View>
          {loading ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <>
              <Text className="text-white text-2xl font-bold mb-1">
                {balance.uc.toFixed(2)} UC
              </Text>
              <Text className="text-white/80 text-xs">
                ≈ {balance.formatted} USD
              </Text>
            </>
          )}
        </TouchableOpacity>

        {/* Cahootz Coin Card */}
        <TouchableOpacity
          className="flex-1 rounded-2xl p-4 shadow-lg"
          style={{ backgroundColor: '#B45309' }}
          onPress={() => router.push('/(tabs)/wallet')}
          activeOpacity={0.8}
        >
          <View className="flex-row items-center gap-2 mb-3">
            <TrendingUp size={18} color="white" />
            <Text className="text-white text-sm font-medium">Cahootz Coin</Text>
          </View>
          {loading ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <>
              <Text className="text-white text-2xl font-bold mb-1">
                {balance.sc.toFixed(2)} SC
              </Text>
              <Text className="text-white/80 text-xs">Rewards earned</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Quick Actions */}
      <View className="px-4 mt-4">
        <View className="flex-row gap-3">
          <QuickActionButton
            icon={DollarSign}
            label="Send"
            onPress={() => router.push('/(authenticated)/pay')}
          />
          <QuickActionButton
            icon={Wallet}
            label="Add Money"
            onPress={() => router.push('/(authenticated)/fund-wallet')}
          />
          <QuickActionButton
            icon={QrCode}
            label="QR Pay"
            onPress={() => router.push('/(authenticated)/scan-pay')}
          />
          <QuickActionButton
            icon={ShoppingBag}
            label="Shop"
            onPress={() => router.push('/(tabs)/store')}
          />
        </View>
      </View>

      {/* Community Impact */}
      <View className="mx-4 mt-6 bg-white rounded-2xl p-4 shadow-sm border border-amber-100">
        <Text className="text-gray-800 font-semibold mb-4">Community Impact</Text>
        <View className="flex-row">
          <View className="flex-1 items-center">
            <Text className="text-xl font-bold text-amber-700">$127K</Text>
            <Text className="text-xs text-gray-500">Community Fund</Text>
          </View>
          <View className="flex-1 items-center">
            <Text className="text-xl font-bold text-red-600">23</Text>
            <Text className="text-xs text-gray-500">Projects Funded</Text>
          </View>
          <View className="flex-1 items-center">
            <Text className="text-xl font-bold text-amber-700">1,247</Text>
            <Text className="text-xs text-gray-500">Members</Text>
          </View>
        </View>
      </View>

      {/* Your Financial Journey */}
      <View className="mx-4 mt-4 bg-white rounded-2xl p-4 shadow-sm border border-amber-100">
        <Text className="text-gray-800 font-semibold mb-4">Your Financial Journey</Text>
        <View className="flex-row mb-4">
          <View className="flex-1 items-center">
            <Text className="text-lg font-bold text-amber-700">$1,250</Text>
            <Text className="text-xs text-gray-500">Community Spending</Text>
          </View>
          <View className="flex-1 items-center">
            <Text className="text-lg font-bold text-red-600">$890</Text>
            <Text className="text-xs text-gray-500">Community Earnings</Text>
          </View>
        </View>
        <View className="border-t border-gray-100 pt-4">
          <View className="flex-row justify-between items-center">
            <Text className="text-sm text-gray-600">Wealth Building Total</Text>
            <Text className="font-semibold text-amber-700">$2,140</Text>
          </View>
          <View className="flex-row justify-between items-center mt-2">
            <Text className="text-sm text-gray-600">Monthly Growth</Text>
            <Text className="font-semibold text-green-600">+$178</Text>
          </View>
        </View>
      </View>

      {/* Recent Activity */}
      <View className="mx-4 mt-4 mb-8 bg-white rounded-2xl shadow-sm border border-amber-100">
        <View className="flex-row justify-between items-center p-4 pb-2">
          <Text className="text-gray-800 font-semibold">Recent Activity</Text>
          {recentActivity.length > 0 && (
            <TouchableOpacity onPress={() => router.push('/(authenticated)/history')}>
              <Text className="text-amber-700 text-sm font-medium">View All</Text>
            </TouchableOpacity>
          )}
        </View>
        {loading ? (
          <View className="items-center py-8">
            <ActivityIndicator size="small" color="#B45309" />
          </View>
        ) : recentActivity.length === 0 ? (
          <View className="items-center py-8">
            <Clock size={32} color="#9CA3AF" />
            <Text className="text-gray-400 text-sm mt-2">No recent transactions</Text>
          </View>
        ) : (
          <View>
            {recentActivity.map((tx, index) => {
              const isOrder = tx.activityType === 'order';
              const isSCReward = tx.activityType === 'scReward';
              const isReceived = tx.type === 'received';
              
              const bgColor = isOrder 
                ? 'bg-amber-100' 
                : isSCReward
                  ? 'bg-amber-100'
                : isReceived 
                  ? 'bg-green-100' 
                  : 'bg-gray-100';
              
              const icon = isOrder ? (
                <Store size={20} color="#D97706" />
              ) : isSCReward ? (
                <Coins size={20} color="#F59E0B" />
              ) : isReceived ? (
                <ArrowDownLeft size={20} color="#16A34A" />
              ) : (
                <ArrowUpRight size={20} color="#6B7280" />
              );

              return (
                <View
                  key={tx.id}
                  className={`flex-row items-center p-4 ${
                    index < recentActivity.length - 1 ? 'border-b border-gray-100' : ''
                  }`}
                >
                  <View className={`w-10 h-10 rounded-xl items-center justify-center mr-3 ${bgColor}`}>
                    {icon}
                  </View>
                  <View className="flex-1">
                    <Text className="text-gray-900 font-medium text-sm">{tx.counterparty}</Text>
                    <Text className="text-gray-400 text-xs mt-0.5">
                      {new Date(tx.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </Text>
                  </View>
                  <Text
                    className={`font-semibold ${
                      isSCReward ? 'text-amber-600' : isReceived ? 'text-green-600' : 'text-gray-900'
                    }`}
                  >
                    {isSCReward 
                      ? `+${tx.amount.toFixed(2)} SC`
                      : `${isReceived ? '+' : '-'}$${tx.amount.toFixed(2)}`
                    }
                  </Text>
                </View>
              );
            })}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
