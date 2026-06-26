'use client';

/**
 * Landing page for Stripe Connect refresh_url.
 * Stripe redirects here if the onboarding link expires or needs to be refreshed.
 * Users are instructed to return to the app and restart the flow.
 */
export default function BusinessOnboardingRefreshPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md mx-auto text-center px-6 py-12">
        <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-8 h-8 text-amber-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Your session expired
        </h1>
        <p className="text-gray-600 mb-4">
          The payment setup link has expired. Please return to the Cahootz app and tap <strong>"Set Up Payments"</strong> again to get a fresh link.
        </p>
        <p className="text-sm text-gray-400">
          You can close this tab.
        </p>
      </div>
    </div>
  );
}
