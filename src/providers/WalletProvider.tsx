'use client';

// Nightly is registered explicitly so it is always first in the modal, even before its Wallet
// Standard announcement lands. Wallet Standard autodetect stays on, so any other SVM wallet the
// user has installed still shows up underneath.
import { useMemo, type ReactNode } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { NightlyWalletAdapter } from '@solana/wallet-adapter-nightly';
import { RPC_URL, WS_URL } from '@/lib/config';

import '@solana/wallet-adapter-react-ui/styles.css';

export function CookieWalletProvider({ children }: { children: ReactNode }) {
  const wallets = useMemo(() => [new NightlyWalletAdapter()], []);
  const config = useMemo(
    () => ({ commitment: 'confirmed' as const, wsEndpoint: WS_URL, confirmTransactionInitialTimeout: 60_000 }),
    [],
  );

  return (
    <ConnectionProvider endpoint={RPC_URL} config={config}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
