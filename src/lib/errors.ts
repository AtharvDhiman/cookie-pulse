// Every failure the user can see goes through here. Wallet adapters, web3.js and the Cookiebox agg
// all throw differently; the UI only ever renders a `FriendlyError`.

export interface FriendlyError {
  title: string;
  detail: string | null;
  /** Rendered as a collapsible <pre> — simulation logs only. */
  logs: string[] | null;
  action: 'retry' | 'bridge' | 'raise-slippage' | null;
}

const RAW = (e: unknown): string => {
  if (!e) return '';
  if (typeof e === 'string') return e;
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
};

/** web3.js hangs simulation logs off the error object rather than the message. */
function extractLogs(e: unknown): string[] | null {
  if (e && typeof e === 'object') {
    const logs = (e as { logs?: unknown }).logs;
    if (Array.isArray(logs) && logs.length > 0) return logs.map(String);
  }
  return null;
}

export function toFriendlyError(e: unknown): FriendlyError {
  const raw = RAW(e);
  const logs = extractLogs(e);
  const err = (
    title: string,
    detail: string | null = null,
    action: FriendlyError['action'] = null,
  ): FriendlyError => ({ title, detail, logs, action });

  // Wallet rejection — adapters use several spellings, plus the 4001 EIP-style code.
  if (/user rejected|rejected the request|WalletSignTransactionError|user denied|4001/i.test(raw)) {
    return err('Transaction cancelled in Nightly.', 'You dismissed the signature request.');
  }
  if (/WalletNotConnected|wallet not connected/i.test(raw)) {
    return err('Wallet not connected.', 'Connect Nightly and try again.');
  }

  // Fees / rent. `AccountNotFound` is what the Cookiebox agg returns when the owner holds no COOK.
  if (
    /insufficient (lamports|funds)|InsufficientFundsForRent|Attempt to debit an account but found no record|AccountNotFound|0x1$/i.test(
      raw,
    )
  ) {
    return err('Not enough COOK to pay fees.', 'Top up your wallet, then try again.', 'bridge');
  }

  // Slippage. 0x1771 = 6001 is the aggregator's "exceeds desired slippage" custom error.
  if (/0x1771|6001|slippage|ExceededSlippage|min out|MinimumOut/i.test(raw)) {
    return err(
      'Price moved more than your slippage.',
      'Try 3% slippage, or a smaller amount.',
      'raise-slippage',
    );
  }

  // Blockhash window elapsed. The transaction may STILL land — never imply it definitely failed.
  if (/TransactionExpiredBlockheightExceeded|block height exceeded|Blockhash not found|BlockhashNotFound/i.test(raw)) {
    return err(
      'Took too long to confirm.',
      'It may still land — check Cookiescan before sending again.',
      'retry',
    );
  }

  if (/simulat/i.test(raw)) {
    return err('Simulation failed.', 'The transaction would fail on-chain. Details below.');
  }

  if (/failed to fetch|networkerror|load failed|ECONNREFUSED|ETIMEDOUT|abort|timed out|502|503|504/i.test(raw)) {
    return err('Cookie Chain RPC is not responding.', 'Retrying shortly.', 'retry');
  }

  if (/no route|404/i.test(raw)) {
    return err('No route for this pair.', 'There is no pool path between these tokens yet.');
  }

  return err('Transaction failed.', raw.slice(0, 220) || null, 'retry');
}
