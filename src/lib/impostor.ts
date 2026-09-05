// Is this token the one the user meant?
//
// On a registry where SESA appears on 4,452 mints, a symbol is not an identifier. This module
// answers only from evidence already loaded — the registry-wide symbol count, pool membership from
// the markets cache, holders and liquidity from the registry, and whether the mint account exists at
// all — and it is careful about what that evidence supports:
//
//   - A bare collision is not an accusation. Four tokens called TEST is a naming coincidence, and
//     it earns a neutral count, nothing more.
//   - The escalation needs a comparison: another token with the same symbol that has holders, pools
//     and liquidity, while this one has none. That is a statement about which one the market uses,
//     not about anyone's intent.
//   - A mint with no on-chain account is the one hard fact here, and it is reported as exactly that.
//
// Pure — no fetching, no hooks — so it can be reasoned about and tested directly.
import type { Token } from './types';

export type ImpostorLevel = 'none' | 'collision' | 'named';

export interface ImpostorSignal {
  level: ImpostorLevel;
  /** How many registry entries share this symbol, over the whole registry. */
  symbolCount: number;
  /** The better-established token sharing the symbol, when there is one. */
  rival: { mint: string; holderCount: number; poolCount: number } | null;
  /** The chain has no account for this mint. */
  noMintAccount: boolean;
  /** Whole sentences, rendered verbatim. Empty when there is nothing to say. */
  notes: string[];
}

export interface ImpostorInputs {
  token: Token;
  /** Every registry token the client holds that shares this symbol, including `token` itself. */
  sameSymbol: Token[];
  /** Pool count per mint, from the markets cache. */
  poolCountByMint: Map<string, number>;
  /** False only when the audit resolved every other mint but not this one. */
  mintAccountExists: boolean;
}

const shortMint = (m: string) => `${m.slice(0, 4)}…${m.slice(-4)}`;

export function assessImpostor({
  token,
  sameSymbol,
  poolCountByMint,
  mintAccountExists,
}: ImpostorInputs): ImpostorSignal {
  const symbolCount = Math.max(token.symbolCount, 1);
  const notes: string[] = [];
  const noMintAccount = !mintAccountExists;

  const pools = poolCountByMint.get(token.mint) ?? 0;

  // The best-established other token wearing this symbol, by holders then pools.
  const rivals = sameSymbol
    .filter((t) => t.mint !== token.mint)
    .map((t) => ({
      mint: t.mint,
      holderCount: t.holderCount,
      poolCount: poolCountByMint.get(t.mint) ?? 0,
    }))
    .sort((a, b) => b.holderCount - a.holderCount || b.poolCount - a.poolCount);
  const rival = rivals[0] ?? null;

  if (noMintAccount) {
    notes.push('This mint has no account on chain.');
  }

  // Escalate only when a comparison actually supports it: this one is unused and another is used.
  const outclassed =
    rival !== null &&
    token.holderCount === 0 &&
    pools === 0 &&
    (rival.holderCount > 0 || rival.poolCount > 0);

  if (outclassed && rival) {
    notes.push(
      `Another ${token.symbol} (${shortMint(rival.mint)}) has ${rival.holderCount} holders and ` +
        `${rival.poolCount} ${rival.poolCount === 1 ? 'pool' : 'pools'}; this one has none.`,
    );
  } else if (symbolCount > 1) {
    // Neutral: a shared symbol on its own is a fact about naming, not about this token.
    notes.push(
      `${symbolCount.toLocaleString('en-US')} registry entries use the symbol ${token.symbol}. ` +
        'Check the mint address.',
    );
  }

  const level: ImpostorLevel =
    noMintAccount || outclassed ? 'named' : symbolCount > 1 ? 'collision' : 'none';

  return { level, symbolCount, rival, noMintAccount, notes };
}
