import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { useEffect } from 'react';
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

// Handle deep links for store quick payments
function handleDeepLink(url: string) {
  try {
    const parsed = Linking.parse(url);
    console.log('Deep link received:', url, parsed);

    // Handle coop://pay/r/{token} - Payment request
    if (parsed.path?.startsWith('pay/r/')) {
      const token = parsed.path.replace('pay/r/', '');
      if (token) {
        router.push({ pathname: '/(authenticated)/quick-pay', params: { token } } as any);
        return;
      }
    }

    // Handle coop://pay/s/{code} - Store code
    if (parsed.path?.startsWith('pay/s/')) {
      const code = parsed.path.replace('pay/s/', '');
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

export const unstable_settings = {
  anchor: 'index',
};

export default function RootLayout() {
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
  );
}
