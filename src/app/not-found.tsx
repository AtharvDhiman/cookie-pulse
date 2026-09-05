import Link from 'next/link';
import { Card } from '@/components/ui/primitives';

export default function NotFound() {
  return (
    <Card className="mx-auto mt-10 max-w-md p-6 text-center">
      <p className="text-3xl">🍪</p>
      <h2 className="mt-2 font-display text-lg font-bold tracking-tight">Page not found</h2>
      <p className="mt-1 text-sm text-muted">That route does not exist in Cookie Pulse.</p>
      <Link
        href="/"
        className="accent-gradient mt-4 inline-block rounded-xl px-4 py-2 text-sm font-semibold text-accent-ink shadow-[0_8px_22px_-10px_rgb(var(--accent-glow)/0.7)] hover:brightness-110"
      >
        Back to Overview
      </Link>
    </Card>
  );
}
