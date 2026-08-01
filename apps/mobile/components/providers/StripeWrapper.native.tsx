import { ReactNode } from 'react';

interface StripeWrapperProps {
  children: ReactNode;
}

export default function StripeWrapper({ children }: StripeWrapperProps) {
  return <>{children}</>;
}
