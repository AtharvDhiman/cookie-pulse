// What the chain says about a mint, decoded from one batched `getMultipleAccounts(jsonParsed)`.
//
// Everything here is a FACT with its source, never a verdict. An open mint authority is normal for a
// liquid-staking token — bCOOK has one — and a freeze authority is a capability held by thousands of
// registry mints. The words "unsafe", "scam" and "rug" appear nowhere in this file or its copy,
// because this module cannot know intent; it can only report what the account contains.
//
// Pure: no fetching, so the decode is testable against a recorded response.
import { num, pick, str } from './normalize';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from './config';

export interface MintFacts {
  mint: string;
  /** Which token program owns the mint account. */
  program: 'spl-token' | 'token-2022' | 'unknown';
  /** An address that can still mint new supply, or null if the authority was revoked. */
  mintAuthority: string | null;
  /** An address that can freeze holders' token accounts, or null. */
  freezeAuthority: string | null;
  decimals: number | null;
  /** Token-2022 transfer fee taken on every transfer, in basis points. 0 or null = none. */
  transferFeeBps: number | null;
}

/** A mint with no account on chain at all — the registry lists it, the chain does not have it. */
export interface MissingMint {
  mint: string;
  reason: 'no-account';
}

export interface MintAudit {
  byMint: Map<string, MintFacts>;
  missing: string[];
  /** Registry values that disagree with the chain — surfaced rather than silently preferred. */
  disagreements: { mint: string; field: 'decimals' | 'freezeAuthority'; chain: string; registry: string }[];
  checked: number;
}

/** Solana's cap for `getMultipleAccounts`. 92 priced mints fit in one call; this keeps it honest. */
export const MAX_ACCOUNTS_PER_CALL = 100;

export function chunkMints(mints: string[], size = MAX_ACCOUNTS_PER_CALL): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < mints.length; i += size) out.push(mints.slice(i, i + size));
  return out;
}

function programOf(owner: string | null): MintFacts['program'] {
  if (owner === TOKEN_PROGRAM_ID) return 'spl-token';
  if (owner === TOKEN_2022_PROGRAM_ID) return 'token-2022';
  return 'unknown';
}

/**
 * Token-2022 carries a transfer fee under `extensions[].transferFeeConfig`. Two schedules exist —
 * `newerTransferFee` is the one in force once its activation epoch passes — and the newer figure is
 * what a swap today would actually pay, so it is the one reported.
 */
function transferFeeBpsOf(info: unknown): number | null {
  const extensions = pick(info, ['extensions']);
  if (!Array.isArray(extensions)) return null;
  for (const ext of extensions) {
    if (str(pick(ext, ['extension'])) !== 'transferFeeConfig') continue;
    const bps = num(pick(ext, ['state', 'newerTransferFee', 'transferFeeBasisPoints']));
    return bps ?? null;
  }
  return null;
}

/** Pure. Decodes one `value[i]` entry; null when the account does not exist. */
export function parseMintAccount(mint: string, raw: unknown): MintFacts | null {
  if (!raw) return null;
  const info = pick(raw, ['data', 'parsed', 'info']);
  if (!info) return null;
  return {
    mint,
    program: programOf(str(pick(raw, ['owner']))),
    mintAuthority: str(pick(info, ['mintAuthority'])),
    freezeAuthority: str(pick(info, ['freezeAuthority'])),
    decimals: num(pick(info, ['decimals'])),
    transferFeeBps: transferFeeBpsOf(info),
  };
}

export const hasOpenMintAuthority = (f: MintFacts): boolean => f.mintAuthority !== null;
export const hasTransferFee = (f: MintFacts): boolean =>
  f.transferFeeBps !== null && f.transferFeeBps > 0;

/** Facts as sentences. Each states what the chain holds; none of them draws a conclusion. */
export function describeMintFacts(f: MintFacts): string[] {
  const out: string[] = [];
  if (hasOpenMintAuthority(f)) {
    out.push('Mint authority active — supply can increase.');
  }
  if (f.freezeAuthority !== null) {
    out.push('Freeze authority present — the issuer can freeze token accounts.');
  }
  if (hasTransferFee(f)) {
    // Deliberately stops at "the quote does not include it". That much was measured; predicting the
    // exact shortfall was not, and would be a number this app cannot stand behind.
    out.push(
      `Token-2022 transfer fee of ${f.transferFeeBps} bps on every transfer — the router's quote does not include it.`,
    );
  }
  return out;
}
