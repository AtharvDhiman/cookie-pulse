// Enter-only route transition. The App Router remounts template.tsx on every navigation, so this
// replays per route with no bookkeeping, no presence tracking and no client JavaScript.
//
// Enter-only is the deliberate half: an exit animation would need the outgoing tree to survive the
// navigation, which the App Router does not promise, and a 240ms delay on every link is a tax paid
// hundreds of times across six routes.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="route-enter">{children}</div>;
}
