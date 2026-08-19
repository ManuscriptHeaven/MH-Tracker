import { WifiOff } from 'lucide-react';
import { useNetworkStatus } from '../lib/pwa';

export function OfflineBanner() {
  const isOnline = useNetworkStatus();

  if (isOnline) {
    return null;
  }

  return (
    <div
      role="alert"
      className="no-print sticky top-0 z-50 flex items-center justify-center gap-2 bg-charcoal px-4 py-2 text-center text-xs font-semibold text-white shadow-md transition-all sm:text-sm"
    >
      <WifiOff className="h-4 w-4 text-warning animate-pulse" />
      <span>
        <strong>You are offline.</strong> Cached UI is available. Live updates and server actions require an active connection.
      </span>
    </div>
  );
}
