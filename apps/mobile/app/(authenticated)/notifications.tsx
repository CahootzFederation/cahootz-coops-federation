import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  ArrowLeft,
  Bell,
  Package,
  ShoppingBag,
  CreditCard,
  Wallet,
  CheckCircle,
  AlertCircle,
  Gift,
  Users,
  Store,
} from 'lucide-react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, any> | null;
  read: boolean;
  createdAt: string;
}

const NOTIFICATION_ICONS: Record<string, { icon: any; color: string; bgColor: string }> = {
  ORDER_PLACED: { icon: Package, color: '#16A34A', bgColor: 'bg-green-100' },
  ORDER_RECEIVED: { icon: ShoppingBag, color: '#FF6B00', bgColor: 'bg-secondary' },
  ORDER_SHIPPED: { icon: Package, color: '#7C3AED', bgColor: 'bg-purple-100' },
  ORDER_DELIVERED: { icon: CheckCircle, color: '#16A34A', bgColor: 'bg-green-100' },
  PAYMENT_RECEIVED: { icon: Wallet, color: '#16A34A', bgColor: 'bg-green-100' },
  PAYMENT_SENT: { icon: CreditCard, color: '#2563EB', bgColor: 'bg-blue-100' },
  TRANSFER_RECEIVED: { icon: Wallet, color: '#16A34A', bgColor: 'bg-green-100' },
  TRANSFER_SENT: { icon: Wallet, color: '#FF6B00', bgColor: 'bg-secondary' },
  SC_EARNED: { icon: Gift, color: '#FF6B00', bgColor: 'bg-secondary' },
  STORE_APPROVED: { icon: Store, color: '#16A34A', bgColor: 'bg-green-100' },
  DEFAULT: { icon: Bell, color: '#6B7280', bgColor: 'bg-gray-100' },
};

function NotificationItem({
  notification,
  onPress,
}: {
  notification: Notification;
  onPress: () => void;
}) {
  const config = NOTIFICATION_ICONS[notification.type] || NOTIFICATION_ICONS.DEFAULT;
  const Icon = config.icon;
  const timeAgo = getTimeAgo(new Date(notification.createdAt));

  return (
    <TouchableOpacity
      onPress={onPress}
      className={`flex-row p-4 border-b border-gray-100 dark:border-gray-700 ${
        !notification.read ? 'bg-secondary dark:bg-amber-900/10' : 'bg-white dark:bg-gray-800'
      }`}
    >
      <View className={`w-10 h-10 rounded-full items-center justify-center ${config.bgColor}`}>
        <Icon size={20} color={config.color} />
      </View>
      <View className="flex-1 ml-3">
        <View className="flex-row items-start justify-between">
          <Text
            className={`flex-1 ${
              !notification.read
                ? 'font-semibold text-gray-900 dark:text-white'
                : 'font-medium text-gray-700 dark:text-gray-300'
            }`}
            numberOfLines={1}
          >
            {notification.title}
          </Text>
          {!notification.read && (
            <View className="w-2 h-2 rounded-full bg-primary ml-2 mt-1.5" />
          )}
        </View>
        <Text
          className="text-gray-600 dark:text-gray-400 text-sm mt-1"
          numberOfLines={2}
        >
          {notification.body}
        </Text>
        <Text className="text-gray-400 dark:text-gray-500 text-xs mt-1">
          {timeAgo}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function getTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function NotificationsScreen() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadNotifications = useCallback(async () => {
    if (!user?.walletAddress) return;

    try {
      const result = await api.getNotifications(user.walletAddress);
      setNotifications(result?.notifications || []);
    } catch (error) {
      console.error('Failed to load notifications:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadNotifications();
  };

  const handleMarkAllRead = async () => {
    if (!user?.walletAddress) return;

    try {
      await api.markAllNotificationsAsRead(user.walletAddress);
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch (error) {
      console.error('Failed to mark all as read:', error);
    }
  };

  const handleNotificationPress = async (notification: Notification) => {
    if (!user?.walletAddress) return;

    // Mark as read
    if (!notification.read) {
      try {
        await api.markNotificationAsRead(notification.id, user.walletAddress);
        setNotifications(prev =>
          prev.map(n => (n.id === notification.id ? { ...n, read: true } : n))
        );
      } catch (error) {
        console.error('Failed to mark as read:', error);
      }
    }

    // Navigate based on notification type and data
    const data = notification.data;
    if (data?.orderId) {
      router.push(`/order-detail?id=${data.orderId}`);
    } else if (data?.storeId) {
      router.push(`/store-detail?id=${data.storeId}`);
    } else if (data?.transactionId) {
      router.push('/history');
    }
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50 dark:bg-gray-900">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#FF6B00" />
          <Text className="text-gray-500 dark:text-gray-400 mt-4">Loading notifications...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50 dark:bg-gray-900" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 py-4 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <View className="flex-row items-center">
          <TouchableOpacity onPress={() => router.back()}>
            <ArrowLeft size={24} color="#374151" />
          </TouchableOpacity>
          <Text className="text-xl font-bold text-gray-900 dark:text-white ml-4">
            Notifications
          </Text>
          {unreadCount > 0 && (
            <View className="bg-primary rounded-full px-2 py-0.5 ml-2">
              <Text className="text-white text-xs font-bold">{unreadCount}</Text>
            </View>
          )}
        </View>
        {unreadCount > 0 && (
          <TouchableOpacity onPress={handleMarkAllRead}>
            <Text className="text-primary dark:text-amber-400 font-medium">
              Mark all read
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {notifications.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <View className="w-20 h-20 bg-gray-100 dark:bg-gray-800 rounded-full items-center justify-center mb-4">
            <Bell size={40} color="#9CA3AF" />
          </View>
          <Text className="text-xl font-bold text-gray-900 dark:text-white text-center mb-2">
            No notifications yet
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-center">
            You&apos;ll see order updates, payment confirmations, and more here.
          </Text>
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="#FF6B00"
            />
          }
        >
          {notifications.map((notification) => (
            <NotificationItem
              key={notification.id}
              notification={notification}
              onPress={() => handleNotificationPress(notification)}
            />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
