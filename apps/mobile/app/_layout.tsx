import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { AppMetrics, AppMetricsRoot } from 'expo-observe';
import { AppBottomNavigation } from '@/components/app-bottom-navigation';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-reanimated';
import "../global.css"
import { PortalHost } from '@rn-primitives/portal';
import Toast from 'react-native-toast-message';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { NotificationResponseHandler } from '@/components/notification-response-handler';
import { InAppAlertPopup } from '@/components/in-app-alert-popup';
import { PendingInvitationResume } from '@/components/pending-invitation-resume';
import { AnalyticsTracker } from '@/components/analytics-tracker';
import { AuthProvider, useAuth } from '@/contexts/auth-context';
import { CartProvider } from '@/contexts/cart-context';
import { PlatformConfigProvider } from '@/contexts/platform-config-context';
import { PaymentConfirmationProvider } from '@/components/payment-confirmation-provider';
import StripeWrapper from '@/components/providers/StripeWrapper';
import { toastConfig } from '@/lib/toast-config';
import * as Sentry from '@sentry/react-native';

Sentry.init({
  dsn: 'https://659be33460f9e6586e39aeb0f5b8b012@o4511715053797376.ingest.us.sentry.io/4512028976283648',

  // Adds more context data to events (IP address, cookies, user, etc.)
  // For more information, visit: https://docs.sentry.io/platforms/react-native/data-management/data-collected/
  sendDefaultPii: true,

  // Enable Logs
  enableLogs: true,

  // Configure Session Replay
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1,
  integrations: [Sentry.mobileReplayIntegration()],

  // uncomment the line below to enable Spotlight (https://spotlightjs.com)
  // spotlight: __DEV__,
});

// Handle deep links for store quick payments
function handleDeepLink(url: string) {
  try {
    const parsed = Linking.parse(url);
    console.log('Deep link received:', url, parsed);
    const path = parsed.path?.replace(/^\/+/, '') ?? '';

    if (path === 'checkout/success') {
      const transactionId = parsed.queryParams?.transactionId;
      router.replace(
        transactionId
          ? (`/(authenticated)/order-detail?id=${transactionId}` as any)
          : ('/(authenticated)/orders' as any)
      );
      return;
    }

    if (path === 'checkout/cancel') {
      return;
    }

    // Store codes are letters, digits and dashes; tokens are URL-safe ids.
    // Anything else is ignored rather than passed to the pay screen.
    const cleanToken = (value: unknown) =>
      typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
    const cleanCode = (value: unknown) =>
      typeof value === 'string' && /^[A-Za-z0-9-]{1,20}$/.test(value) ? value.toUpperCase() : null;

    // commons://pay/r/{token} - Payment request
    if (path.startsWith('pay/r/')) {
      const token = cleanToken(path.replace('pay/r/', ''));
      if (token) {
        router.push({ pathname: '/(authenticated)/quick-pay', params: { token } } as any);
        return;
      }
    }

    // commons://pay/s/{code} - Store code
    if (path.startsWith('pay/s/')) {
      const code = cleanCode(path.replace('pay/s/', ''));
      if (code) {
        router.push({ pathname: '/(authenticated)/quick-pay', params: { code } } as any);
        return;
      }
    }

    // Web URL fallback: https://app.cahootz.coop/pay?r={token} or /pay?s={code}.
    // Only for the /pay path, so an unrelated link with ?r= or ?s= can't open the pay screen.
    if (path === 'pay') {
      const token = cleanToken(parsed.queryParams?.r);
      if (token) {
        router.push({ pathname: '/(authenticated)/quick-pay', params: { token } } as any);
        return;
      }
      const code = cleanCode(parsed.queryParams?.s);
      if (code) {
        router.push({ pathname: '/(authenticated)/quick-pay', params: { code } } as any);
        return;
      }
    }
  } catch (err) {
    console.error('Error handling deep link:', err);
  }
}

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 5000,
    },
  },
});

function ObserveInteractiveMarker() {
  const { isLoading } = useAuth();
  const hasMarkedInteractive = useRef(false);

  useEffect(() => {
    if (!isLoading && !hasMarkedInteractive.current) {
      hasMarkedInteractive.current = true;
      AppMetrics.markInteractive();
    }
  }, [isLoading]);

  return null;
}

function RootLayout() {
  const colorScheme = useColorScheme();

  // Handle deep links
  useEffect(() => {
    // Handle deep links when app is already open
    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleDeepLink(url);
    });

    // Handle deep link that opened the app
    Linking.getInitialURL().then((url) => {
      if (url) {
        // Delay to ensure navigation is ready
        setTimeout(() => handleDeepLink(url), 500);
      }
    });

    return () => subscription.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StripeWrapper>
          <PlatformConfigProvider>
          <AuthProvider>
            <ObserveInteractiveMarker />
            <AnalyticsTracker />
            <NotificationResponseHandler />
            <PendingInvitationResume />
            <CartProvider>
              <PaymentConfirmationProvider>
                <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flex: 1, minHeight: 0 }}>
                      <Stack screenOptions={{ headerShown: false }} />
                    </View>
                    <AppBottomNavigation />
                    <InAppAlertPopup />
                  </View>
                  <StatusBar style="auto" />
                  <PortalHost />
                  <Toast config={toastConfig} />
                </ThemeProvider>
              </PaymentConfirmationProvider>
            </CartProvider>
          </AuthProvider>
          </PlatformConfigProvider>
        </StripeWrapper>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

export default AppMetricsRoot.wrap(Sentry.wrap(RootLayout));
