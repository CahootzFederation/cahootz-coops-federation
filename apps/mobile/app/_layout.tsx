import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-reanimated';
import "../global.css"
import { PortalHost } from '@rn-primitives/portal';
import Toast from 'react-native-toast-message';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider } from '@/contexts/auth-context';
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

    // Handle commons://pay/r/{token} - Payment request
    if (path.startsWith('pay/r/')) {
      const token = path.replace('pay/r/', '');
      if (token) {
        router.push({ pathname: '/(authenticated)/quick-pay', params: { token } } as any);
        return;
      }
    }

    // Handle commons://pay/s/{code} - Store code
    if (path.startsWith('pay/s/')) {
      const code = path.replace('pay/s/', '');
      if (code) {
        router.push({ pathname: '/(authenticated)/quick-pay', params: { code } } as any);
        return;
      }
    }

    // Handle web URL fallback: https://app.cahootz.coop/pay?r={token}
    if (parsed.queryParams?.r) {
      router.push({ pathname: '/(authenticated)/quick-pay', params: { token: parsed.queryParams.r as string } } as any);
      return;
    }

    // Handle web URL fallback: https://app.cahootz.coop/pay?s={code}
    if (parsed.queryParams?.s) {
      router.push({ pathname: '/(authenticated)/quick-pay', params: { code: parsed.queryParams.s as string } } as any);
      return;
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

export default Sentry.wrap(function RootLayout() {
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
            <CartProvider>
              <PaymentConfirmationProvider>
                <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
                  <Stack screenOptions={{ headerShown: false }}>
                  </Stack>
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
});
