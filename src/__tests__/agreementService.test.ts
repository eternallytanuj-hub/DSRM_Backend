import assert from "assert";
import {
  canonicalizeText,
  computeTermsHash,
  canonicalJson,
  computeUseDeclarationHash,
  BOOKING_AGREEMENT_TYPES,
  SEPOLIA_CHAIN_ID,
  ESCROW_ADDRESS,
  SERVER_PINNED_TERMS_HASH,
} from "../services/agreementService";
import { hashTypedData } from "viem";

console.log("Running backend agreement cryptographic & hash parity tests...");

// 1. Fixed fixture string test
const rawFixture = "  Article 1. Preamble \r\n Line with spaces   \r\n\r\n";
const canonical = canonicalizeText(rawFixture);
assert.strictEqual(canonical, "Article 1. Preamble\n Line with spaces");
const fixtureHash = computeTermsHash(canonical);
assert.strictEqual(
  fixtureHash,
  "0x0eecd724be55854e53474f1da170a96a249204afc5ea665af9fc556444d77819",
  "Fixture termsHash must match expected"
);
console.log("✓ Fixture termsHash matches frontend test vector exactly");

// 2. useDeclarationHash determinism test
const p1 = {
  category: "Commercial communications",
  declarationVersion: "1.0",
  otherDescription: "",
  targetRegion: "APAC",
};
const p2 = {
  targetRegion: "APAC",
  category: "Commercial communications",
  otherDescription: "",
  declarationVersion: "1.0",
};
const h1 = computeUseDeclarationHash(p1);
const h2 = computeUseDeclarationHash(p2);
assert.strictEqual(h1, h2, "Key order independence in useDeclarationHash");
assert.strictEqual(
  h1,
  "0x81abd252c1579eba0c02e4adcaaa88f34acb2a03e4354d546fb23908f774926f",
  "useDeclarationHash must match shared vector"
);
console.log("✓ useDeclarationHash is deterministic and matches frontend test vector");

// 3. EIP-712 typed-data digest test vector
const domain = {
  name: "DSRM",
  version: "1",
  chainId: BigInt(SEPOLIA_CHAIN_ID),
  verifyingContract: "0x5CDcB7F47De1aE89A24Adb55b0876C765C437735" as `0x${string}`,
};

const message = {
  bookingId: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as `0x${string}`,
  buyer: "0xc25f9F0Ce27A2D248c43563a32cDC4886D069176" as `0x${string}`,
  operator: "0x5CDcB7F47De1aE89A24Adb55b0876C765C437735" as `0x${string}`,
  windowStart: BigInt(1700000000),
  windowEnd: BigInt(1700001800),
  amountWei: BigInt("100000000000000"),
  termsHash: SERVER_PINNED_TERMS_HASH,
  useDeclarationHash: "0x1111111111111111111111111111111111111111111111111111111111111111" as `0x${string}`,
  nonce: BigInt(42),
  deadline: BigInt(1700001000),
};

const digest = hashTypedData({
  domain,
  types: BOOKING_AGREEMENT_TYPES,
  primaryType: "BookingAgreement",
  message,
});

assert.strictEqual(
  digest,
  "0xf9d622cc00ad916e3f4941cc57a9cda59e27e9fae2659bb409c6eab368c6ed68",
  "Backend EIP-712 digest must match shared test vector"
);
console.log("✓ Backend EIP-712 typed data digest matches shared test vector exactly");

async function runAsyncTests() {
  const { prepareAgreement, getAuthoritativeTermsHash } = await import("../services/agreementService");

  // 4. Sanctions gate test
  const nowSec = Math.floor(Date.now() / 1000);
  try {
    await prepareAgreement({
      listingId: "listing-test-1",
      buyerAddress: "0xc25f9F0Ce27A2D248c43563a32cDC4886D069176",
      country: "KP",
      termsHash: getAuthoritativeTermsHash(),
      windowStart: nowSec + 3600,
      windowEnd: nowSec + 5400,
    });
    assert.fail("Should have thrown sanctions error");
  } catch (err: any) {
    assert.match(err.message, /Sanctioned jurisdiction/);
  }
  console.log("✓ Sanctioned jurisdiction correctly blocked by prepareAgreement");

  // 5. TermsHash mismatch test
  try {
    await prepareAgreement({
      listingId: "listing-test-1",
      buyerAddress: "0xc25f9F0Ce27A2D248c43563a32cDC4886D069176",
      country: "US",
      termsHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      windowStart: nowSec + 3600,
      windowEnd: nowSec + 5400,
    });
    assert.fail("Should have thrown terms mismatch error");
  } catch (err: any) {
    assert.match(err.message, /Agreement version mismatch/);
  }
  console.log("✓ TermsHash mismatch correctly rejected by prepareAgreement");

  // 6. Window order test
  try {
    await prepareAgreement({
      listingId: "listing-test-1",
      buyerAddress: "0xc25f9F0Ce27A2D248c43563a32cDC4886D069176",
      country: "US",
      termsHash: getAuthoritativeTermsHash(),
      windowStart: nowSec + 5400,
      windowEnd: nowSec + 3600,
    });
    assert.fail("Should have thrown window order error");
  } catch (err: any) {
    assert.match(err.message, /Pass window start must be before end/);
  }
  console.log("✓ Window start >= end correctly rejected by prepareAgreement");

  // 7. Success case issuance
  const prep = await prepareAgreement({
    listingId: "listing-test-1",
    buyerAddress: "0xc25f9F0Ce27A2D248c43563a32cDC4886D069176",
    country: "US",
    termsHash: getAuthoritativeTermsHash(),
    windowStart: nowSec + 3600,
    windowEnd: nowSec + 5400,
  });
  assert.ok(prep.nonce, "Nonce must be issued");
  assert.ok(prep.deadline, "Deadline must be issued");
  assert.strictEqual(prep.domain.chainId, 11155111);
  assert.strictEqual(prep.termsHash, getAuthoritativeTermsHash());
  console.log("✓ prepareAgreement successfully issued nonce and domain challenge");

  console.log("All backend agreement tests passed with 100% hash parity and security guarantees!");
}

runAsyncTests().catch((err) => {
  console.error("Test failure:", err);
  process.exit(1);
});
