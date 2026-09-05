import { ButtonLink } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
import { Card } from '@/components/ui/primitives';

export default function NotFound() {
  return (
    <Card className="mx-auto mt-10 max-w-md p-6 text-center">
      <Logo size={34} className="mx-auto text-accent" />
      <h2 className="mt-2 font-display text-lg font-bold tracking-tight">Page not found</h2>
      <p className="mt-1 text-sm text-muted">That route does not exist in Cookie Pulse.</p>
      <ButtonLink href="/" className="mt-4">
        Back to Overview
      </ButtonLink>
    </Card>
  );
}
