import { Platform } from 'react-native';
import { paymentConfirmationService, PaymentConfirmationData } from './payment-confirmation-service';

// Only import on native platforms
let LocalAuthentication: typeof import('expo-local-authentication') | null = null;
if (Platform.OS !== 'web') {
  LocalAuthentication = require('expo-local-authentication');
}

export type BiometricType = 'fingerprint' | 'facial' | 'iris' | 'none';

/**
 * Check if biometric authentication is available
 */
export async function isBiometricAvailable(): Promise<boolean> {
  // Not available on web
  if (Platform.OS === 'web' || !LocalAuthentication) {
    return false;
  }

  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    return hasHardware && isEnrolled;
  } catch (error) {
    console.error('Error checking biometric availability:', error);
    return false;
  }
}

/**
 * Get the type of biometric authentication available
 */
export async function getBiometricType(): Promise<BiometricType> {
  if (Platform.OS === 'web' || !LocalAuthentication) {
    return 'none';
  }

  try {
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();

    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
      return 'facial';
    }
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
      return 'fingerprint';
    }
    if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
      return 'iris';
    }
    return 'none';
  } catch (error) {
    console.error('Error getting biometric type:', error);
    return 'none';
  }
}

/**
 * Get a user-friendly name for the biometric type
 */
export async function getBiometricName(): Promise<string> {
  const type = await getBiometricType();

  switch (type) {
    case 'facial':
      return Platform.OS === 'ios' ? 'Face ID' : 'Face Recognition';
    case 'fingerprint':
      return Platform.OS === 'ios' ? 'Touch ID' : 'Fingerprint';
    case 'iris':
      return 'Iris';
    default:
      return 'Biometrics';
  }
}

export type BiometricPaymentResult = {
  success: boolean;
  /** True when the member backed out (Cancel, or the system closed the prompt). Treat it as a no-op, not a failure. */
  cancelled?: boolean;
  /** Plain wording safe to show a member. */
  error?: string;
};

const CANCEL_ERRORS = new Set(['user_cancel', 'system_cancel', 'app_cancel']);

/**
 * Authenticate user with biometrics for payment confirmation
 * @param data - Payment amount string or full payment data with fee breakdown
 */
export async function authenticateForPayment(
  data: string | PaymentConfirmationData
): Promise<BiometricPaymentResult> {
  // Normalize input to PaymentConfirmationData
  const paymentData: PaymentConfirmationData = 
    typeof data === 'string' ? { amount: data } : data;
  
  const displayAmount = paymentData.amount;

  // On web, show a confirmation modal
  if (Platform.OS === 'web' || !LocalAuthentication) {
    try {
      const confirmed = await paymentConfirmationService.confirm(paymentData);
      if (!confirmed) {
        return { success: false, cancelled: true, error: 'Payment cancelled' };
      }
      return { success: true };
    } catch (error) {
      console.error('Payment confirmation error:', error);
      return { success: false, error: "We couldn't confirm this payment. Please try again." };
    }
  }

  try {
    const isAvailable = await isBiometricAvailable();

    if (!isAvailable) {
      // If biometrics not available, show confirmation modal as fallback
      try {
        const confirmed = await paymentConfirmationService.confirm(paymentData);
        if (!confirmed) {
          return { success: false, cancelled: true, error: 'Payment cancelled' };
        }
        return { success: true };
      } catch (error) {
        console.error('Payment confirmation error:', error);
        return { success: false, error: "We couldn't confirm this payment. Please try again." };
      }
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: `Confirm payment of ${displayAmount}`,
      fallbackLabel: 'Use Passcode',
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
    });

    if (result.success) {
      return { success: true };
    }

    // Handle specific error types
    if (CANCEL_ERRORS.has(result.error)) {
      return { success: false, cancelled: true, error: 'Authentication cancelled' };
    }

    if (result.error === 'user_fallback') {
      // User chose to use passcode - device handles this
      return { success: false, error: 'Use your phone passcode to confirm this payment.' };
    }

    if (result.error === 'lockout') {
      return {
        success: false,
        error: 'Face ID or Touch ID is locked after too many tries. Unlock your phone with your passcode, then try again.',
      };
    }

    console.error('Biometric authentication failed:', result.error);
    return { success: false, error: "We couldn't confirm it's you. Please try again." };
  } catch (error) {
    console.error('Biometric authentication error:', error);
    return {
      success: false,
      error: "We couldn't confirm it's you. Please try again.",
    };
  }
}

/**
 * Quick check if device has any form of authentication
 */
export async function hasDeviceAuthentication(): Promise<boolean> {
  if (Platform.OS === 'web' || !LocalAuthentication) {
    return false;
  }

  try {
    const securityLevel = await LocalAuthentication.getEnrolledLevelAsync();
    return securityLevel !== LocalAuthentication.SecurityLevel.NONE;
  } catch (error) {
    console.error('Error checking device authentication:', error);
    return false;
  }
}
