import Toast from 'react-native-toast-message';

interface AlertButton {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

/**
 * Cross-platform alert using toast notifications
 * Works on both native and web with a better UX than Alert.alert
 */
export const Alert = {
  alert: (
    title: string,
    message?: string,
    buttons?: AlertButton[]
  ) => {
    // Determine toast type based on context
    const isError = /error|failed|couldn['’]t|could not|didn['’]t|can['’]t|unable/i.test(title) ||
                    buttons?.some(b => b.style === 'destructive');
    
    const isSuccess = title.toLowerCase().includes('success') || 
                      title.toLowerCase().includes('complete') ||
                      title.toLowerCase().includes('placed');
    
    const type = isError ? 'error' : isSuccess ? 'success' : 'info';
    
    // Show toast
    Toast.show({
      type,
      text1: title,
      text2: message,
      // Errors stay until tapped, so slow readers don't lose them.
      visibilityTime: 5000,
      autoHide: !isError,
      topOffset: 60,
      onPress: () => {
        Toast.hide();
        // If there's a primary button (not cancel), call it
        const primaryButton = buttons?.find(b => b.style !== 'cancel');
        primaryButton?.onPress?.();
      },
    });
    
    // If there's only one button and it's not cancel, auto-call it after toast
    if (buttons?.length === 1 && buttons[0].style !== 'cancel') {
      setTimeout(() => {
        buttons[0].onPress?.();
      }, 5000);
    }
  },
};
