/**
 * Tests for the token-safety copy rules.
 *
 *   npm run test:safety
 *
 * These guard the two things this feature could most easily get wrong: escalating a harmless naming
 * coincidence into an accusation, and stating a fee consequence that was never measured. Both
 * modules are pure, so no network is involved.
 */
import { assessImpostor } from '../src/lib/impostor';
import { describeMintFacts, parseMintAccount, chunkMints, type MintFacts } from '../src/lib/mintSafety';
import type { Token } from '../src/lib/types';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`  ${GREEN}PASS${RESET} ${label} ${DIM}${detail}${RESET}`);
  } else {
    failed++;
    console.log(`  ${RED}FAIL${RESET} ${label} ${DIM}${detail}${RESET}`);
  }
}

const token = (over: Partial<Token>): Token => ({
  mint: 'M'.repeat(44),
  name: 'Test',
  symbol: 'TEST',
  logo: null,
  decimals: 6,
  description: null,
  priceUsd: 1,
  priceNative: 1,
  change24h: null,
  volume24h: 0,
  liquidityUsd: 0,
  marketCap: 0,
  supply: 0,
  holderCount: 0,
  symbolCount: 1,
  ...over,
});

const GHOST = 'Ctgd1omtw7cWAWYh4SZXUT29dcmncBkMofm7cLrMpVa';
const REAL = 'EkPafx58mgwkEnGwo62jXhXDAdJ37Z8G8MFBRPsr9uhz';

function main(): void {
  console.log('\ntoken-safety — facts, never verdicts\n');

  console.log('impostor signal');
  {
    // Four tokens called TEST, none of them established. A coincidence, not an accusation.
    const subject = token({ symbol: 'TEST', symbolCount: 4, holderCount: 0 });
    const signal = assessImpostor({
      token: subject,
      sameSymbol: [subject, token({ mint: 'O'.repeat(44), symbol: 'TEST', symbolCount: 4 })],
      poolCountByMint: new Map(),
      mintAccountExists: true,
    });
    check(
      'a bare collision stays neutral',
      signal.level === 'collision',
      `level=${signal.level}`,
    );
    check(
      'and only reports the count',
      signal.notes.length === 1 && signal.notes[0].includes('4 registry entries'),
      signal.notes.join(' | '),
    );
  }
  {
    // The measured case: two bCOOKs, one with 59 holders and 12 pools, one with nothing and no
    // mint account at all.
    const ghost = token({ mint: GHOST, symbol: 'bCOOK', symbolCount: 2, holderCount: 0 });
    const real = token({ mint: REAL, symbol: 'bCOOK', symbolCount: 2, holderCount: 59 });
    const signal = assessImpostor({
      token: ghost,
      sameSymbol: [ghost, real],
      poolCountByMint: new Map([[REAL, 12]]),
      mintAccountExists: false,
    });
    check('the ghost bCOOK escalates', signal.level === 'named', `level=${signal.level}`);
    check(
      'it says the mint has no account on chain',
      signal.notes.some((n) => n.includes('no account on chain')),
      signal.notes[0],
    );
    check(
      'and it cites the other bCOOK by holders and pools',
      signal.notes.some((n) => n.includes('59 holders') && n.includes('12 pools')),
      signal.notes.join(' | '),
    );

    const clean = assessImpostor({
      token: real,
      sameSymbol: [ghost, real],
      poolCountByMint: new Map([[REAL, 12]]),
      mintAccountExists: true,
    });
    check(
      'the real bCOOK is not escalated',
      clean.level === 'collision',
      `level=${clean.level}`,
    );
  }

  console.log('\nmint facts');
  {
    const open: MintFacts = {
      mint: 'X',
      program: 'spl-token',
      mintAuthority: 'A'.repeat(44),
      freezeAuthority: null,
      decimals: 6,
      transferFeeBps: null,
    };
    const notes = describeMintFacts(open);
    check(
      'an open mint authority is stated as a capability',
      notes.some((n) => n === 'Mint authority active — supply can increase.'),
      notes.join(' | '),
    );

    const fee: MintFacts = { ...open, mintAuthority: null, program: 'token-2022', transferFeeBps: 100 };
    const feeNotes = describeMintFacts(fee);
    check(
      'a transfer fee names the bps and stops at the quote',
      feeNotes.some((n) => n.includes('100 bps') && n.includes("router's quote does not include it")),
      feeNotes.join(' | '),
    );
    check(
      'and never predicts a shortfall',
      !feeNotes.some((n) => /you will (lose|receive)|shortfall|less than/i.test(n)),
      'no predicted amount',
    );

    const all = [...notes, ...feeNotes].join(' ');
    check(
      'no verdict language anywhere in the copy',
      !/\b(unsafe|scam|rug|fake|malicious)\b/i.test(all),
      'facts only',
    );
  }

  console.log('\nbatching');
  check('92 priced mints fit one getMultipleAccounts call', chunkMints(new Array(92).fill('m')).length === 1, '1 chunk');
  check('101 would split into two', chunkMints(new Array(101).fill('m')).length === 2, '2 chunks');
  check(
    'a missing account parses to null rather than an empty fact',
    parseMintAccount('X', null) === null,
    'null in, null out',
  );

  console.log(`\n${failed === 0 ? GREEN : RED}${passed} passed, ${failed} failed${RESET}\n`);
  if (failed > 0) process.exit(1);
}

main();
