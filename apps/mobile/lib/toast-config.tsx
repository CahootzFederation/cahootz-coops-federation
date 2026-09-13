import React from 'react';
import { BaseToast, ErrorToast, InfoToast } from 'react-native-toast-message';

/**
 * Custom toast configuration with better styling
 */
export const toastConfig = {
  success: (props: any) => (
    <BaseToast
      {...props}
      style={{
        width: '92%',
        maxWidth: 340,
        borderLeftColor: '#10b981',
        backgroundColor: '#064e3b',
      }}
      contentContainerStyle={{ paddingHorizontal: 15 }}
      text1Style={{
        fontSize: 16,
        fontWeight: '600',
        color: '#ffffff',
      }}
      text2Style={{
        fontSize: 14,
        color: '#d1fae5',
      }}
    />
  ),
  error: (props: any) => (
    <ErrorToast
      {...props}
      style={{
        width: '92%',
        maxWidth: 340,
        borderLeftColor: '#ef4444',
        backgroundColor: '#7f1d1d',
      }}
      contentContainerStyle={{ paddingHorizontal: 15 }}
      text1Style={{
        fontSize: 16,
        fontWeight: '600',
        color: '#ffffff',
      }}
      text2Style={{
        fontSize: 14,
        color: '#fecaca',
      }}
    />
  ),
  info: (props: any) => (
    <InfoToast
      {...props}
      style={{
        width: '92%',
        maxWidth: 340,
        borderLeftColor: '#3b82f6',
        backgroundColor: '#1e3a8a',
      }}
      contentContainerStyle={{ paddingHorizontal: 15 }}
      text1Style={{
        fontSize: 16,
        fontWeight: '600',
        color: '#ffffff',
      }}
      text2Style={{
        fontSize: 14,
        color: '#bfdbfe',
      }}
    />
  ),
};
