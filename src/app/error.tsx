'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/primitives';

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Card className="mx-auto mt-10 max-w-md p-6 text-center">
      <AlertTriangle size={22} className="mx-auto text-warn" />
      <h2 className="mt-3 text-lg font-bold">Something broke on this page</h2>
      <p className="mt-1 break-words text-sm text-muted">
        {error.message || 'An unexpected error occurred.'}
      </p>
      <Button onClick={reset} className="mt-4">
        Try again
      </Button>
    </Card>
  );
}
