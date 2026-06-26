import { coopConfig } from './coop-config';

// Get API URL from environment variable or fallback to defaults
const getApiBaseUrl = () => {
  const envApiUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
  
  if (envApiUrl) {
    return envApiUrl;
  }
  
  // Fallback to default values
  return __DEV__ ? 'http://localhost:3001' : 'https://api.cahootz.coop';
};

// API configuration for Expo
export const config = {
  // API Base URL - reads from .env file or uses defaults
  API_BASE_URL: getApiBaseUrl(),
  
  // Request timeout
  REQUEST_TIMEOUT: 10000, // 10 seconds
  
  // Retry configuration
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000, // 1 second
};

/**
 * Get the current coop ID from the active coop config
 * This is dynamic and changes based on the user's active coop
 */
export function getCoopId(): string {
  return coopConfig().id;
}

// Helper function to get the correct API URL
export const getApiUrl = () => {
  const baseUrl = config.API_BASE_URL;
  
  if (__DEV__) {
    console.log(`📱 Mobile app connecting to: ${baseUrl}`);
  }
  
  return baseUrl;
};

export const getWebUrl = () => {
  return process.env.EXPO_PUBLIC_WEB_URL || (__DEV__ ? 'http://localhost:3000' : 'https://cahootz.coop');
};

// Network configuration for Expo
export const networkConfig = {
  // Enable network debugging in development
  enableNetworkLogging: __DEV__,

  // Headers for all requests (without X-Coop-Id - must be added dynamically)
  defaultHeaders: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },

  // CORS configuration (handled by the API server)
  cors: {
    origin: __DEV__ ? ['http://localhost:3000', 'http://localhost:8081'] : ['https://cahootz.coop'],
    credentials: true,
  }
};

/**
 * Get headers with the current coop ID
 * Use this instead of networkConfig.defaultHeaders for requests that need X-Coop-Id
 */
export function getHeadersWithCoopId(): Record<string, string> {
  return {
    ...networkConfig.defaultHeaders,
    'X-Coop-Id': getCoopId(),
  };
}
