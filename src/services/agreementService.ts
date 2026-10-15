import fs from "fs";
import path from "path";
import {
  keccak256,
  toBytes,
  verifyTypedData,
  createPublicClient,
  http,
  isAddress,
  getAddress,
} from "viem";
import { sepolia } from "viem/chains";
import { getSupabaseClient, recordBookingInSupabase } from "./supabaseClient";

export const SEPOLIA_CHAIN_ID = 11155111;
export const ESCROW_ADDRESS = (process.env.ESCROW_CONTRACT_ADDRESS ||
  "0x5CDcB7F47De1aE89A24Adb55b0876C765C437735") as `0x${string}`;

export const SERVER_PINNED_TERMS_VERSION = "1.0";
// Exact keccak256 of canonical text of src/content/legal/booking-agreement-v1.0.md
export const SERVER_PINNED_TERMS_HASH =
  "0x687e72ab87b18eb055a5d0fc6e94efc382d8828dc05bbdfa92c384f7dde331c2" as `0x${string}`;

export function getAuthoritativeTermsHash(): `0x${string}` {
  try {
    const candidates = [
      path.resolve(__dirname, "../../../DSRM/src/content/legal/booking-agreement-v1.0.md"),
      path.resolve(process.cwd(), "../DSRM/src/content/legal/booking-agreement-v1.0.md"),
      path.resolve(process.cwd(), "booking-agreement-v1.0.md"),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        return computeTermsHash(canonicalizeText(fs.readFileSync(p, "utf-8")));
      }
    }
  } catch {
    // fallback
  }
  return SERVER_PINNED_TERMS_HASH;
}

export function resolveListingParameters(listingId?: string) {
  const defaultPriceWei = "100000000000000"; // 0.0001 ETH
  const defaultOperator = (process.env.ESCROW_OPERATOR_ADDRESS ||
    "0x5CDcB7F47De1aE89A24Adb55b0876C765C437735") as `0x${string}`;

  return {
    priceWei: defaultPriceWei,
    operator: defaultOperator,
  };
}

export const BLOCKED_COUNTRIES = ["CU", "IR", "KP", "SY", "RU"] as const;

export const BOOKING_AGREEMENT_TYPES = {
  BookingAgreement: [
    { name: "bookingId", type: "bytes32" },
    { name: "buyer", type: "address" },
    { name: "operator", type: "address" },
    { name: "windowStart", type: "uint64" },
    { name: "windowEnd", type: "uint64" },
    { name: "amountWei", type: "uint256" },
    { name: "termsHash", type: "bytes32" },
    { name: "useDeclarationHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

export function canonicalizeText(raw: string): string {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n").map((line) => line.replace(/[ \t]+$/, ""));
  return lines.join("\n").trim();
}

export function computeTermsHash(canonicalText: string): `0x${string}` {
  return keccak256(toBytes(canonicalText));
}

export function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = obj as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const pairs = sortedKeys.map((key) => {
    return `${JSON.stringify(key)}:${canonicalJson(record[key])}`;
  });
  return `{${pairs.join(",")}}`;
}

export interface UseDeclarationParams {
  category: string;
  otherDescription?: string;
  targetRegion: string;
  declarationVersion: string;
}

export function computeUseDeclarationHash(params: UseDeclarationParams): `0x${string}` {
  const payload: Record<string, string> = {
    category: params.category || "",
    declarationVersion: params.declarationVersion || "1.0",
    otherDescription: params.otherDescription || "",
    targetRegion: params.targetRegion || "",
  };
  return keccak256(toBytes(canonicalJson(payload)));
}

// In-memory cache for fast nonce tracking & offline resilience
interface NonceEntry {
  nonce: bigint;
  deadline: bigint;
  issuedAt: number;
  consumed: boolean;
  termsHash: `0x${string}`;
  listingId?: string;
  windowStart?: number;
  windowEnd?: number;
  authoritativeAmountWei?: string;
  authoritativeOperator?: string;
}
const issuedNonces = new Map<string, NonceEntry>(); // key: `${buyer.toLowerCase()}_${nonce}`
const inMemoryAgreements = new Map<string, any>(); // key: bookingId

// Sepolia Public Client for on-chain receipt verification
const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(
    process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com"
  ),
});

/**
 * Validates request parameters and prepares an authoritative agreement challenge:
 * issues fresh nonce, deadline, domain, and termsHash.
 */
export async function prepareAgreement(params: {
  listingId: string;
  buyerAddress: string;
  country: string;
  termsHash: string;
  windowStart: number;
  windowEnd: number;
}) {
  const { listingId, buyerAddress, country, termsHash, windowStart, windowEnd } = params;

  if (!buyerAddress || !isAddress(buyerAddress)) {
    throw new Error("Invalid buyer Ethereum address");
  }

  // Country Sanctions Screening
  if (country && BLOCKED_COUNTRIES.includes(country.toUpperCase() as any)) {
    throw new Error("Sanctioned jurisdiction: Bookings from restricted countries are blocked");
  }

  const effectiveTermsHash = getAuthoritativeTermsHash();

  // Terms Hash validation against server authoritative pinned version
  if (termsHash.toLowerCase() !== effectiveTermsHash.toLowerCase()) {
    throw new Error(
      `Agreement version mismatch. Pinned: ${effectiveTermsHash}, provided: ${termsHash}`
    );
  }

  // Pass window check
  if (windowStart >= windowEnd) {
    throw new Error("Pass window start must be before end");
  }

  const authListing = resolveListingParameters(listingId);

  // Issue random numeric nonce
  const nonceBytes = new Uint8Array(8);
  crypto.getRandomValues(nonceBytes);
  let nonceNum = BigInt(0);
  for (let i = 0; i < 8; i++) {
    nonceNum = (nonceNum << BigInt(8)) + BigInt(nonceBytes[i]);
  }

  // Deadline: 30 minutes from now, capped by windowStart
  const nowSec = Math.floor(Date.now() / 1000);
  const defaultDeadline = nowSec + 1800; // 30 mins
  const deadlineSec = Math.min(defaultDeadline, windowStart);

  const buyerKey = `${buyerAddress.toLowerCase()}_${nonceNum.toString()}`;
  issuedNonces.set(buyerKey, {
    nonce: nonceNum,
    deadline: BigInt(deadlineSec),
    issuedAt: nowSec,
    consumed: false,
    termsHash: effectiveTermsHash,
    listingId,
    windowStart,
    windowEnd,
    authoritativeAmountWei: authListing.priceWei,
    authoritativeOperator: authListing.operator,
  });

  return {
    nonce: nonceNum.toString(),
    deadline: deadlineSec.toString(),
    termsVersion: SERVER_PINNED_TERMS_VERSION,
    termsHash: effectiveTermsHash,
    domain: {
      name: "DSRM",
      version: "1",
      chainId: SEPOLIA_CHAIN_ID,
      verifyingContract: ESCROW_ADDRESS,
    },
  };
}

/**
 * Recomputes listing parameters and verifies EIP-712 typed-data signature.
 * On success, marks nonce consumed and persists agreement.
 */
export async function verifyAgreement(payload: {
  listingId?: string;
  bookingId: string;
  buyer: string;
  operator?: string;
  windowStart?: number;
  windowEnd?: number;
  amountWei?: string;
  termsHash: string;
  termsVersion: string;
  useDeclarationHash: string;
  nonce: string;
  deadline: string;
  signature: string;
  acknowledgements: Record<string, any>;
  pii?: {
    legalName?: string;
    email?: string;
    country?: string;
    principalName?: string;
    principalAddress?: string;
  };
}) {
  const {
    listingId,
    bookingId,
    buyer,
    operator,
    windowStart,
    windowEnd,
    amountWei,
    termsHash,
    termsVersion,
    useDeclarationHash,
    nonce,
    deadline,
    signature,
    acknowledgements,
    pii,
  } = payload;

  if (!isAddress(buyer)) {
    throw new Error("Invalid buyer address");
  }

  // Check country sanctions
  if (pii?.country && BLOCKED_COUNTRIES.includes(pii.country.toUpperCase() as any)) {
    throw new Error("Sanctions violation: Comprehensively sanctioned country");
  }

  // Terms Hash check against server authoritative version
  const effectiveTermsHash = getAuthoritativeTermsHash();
  if (termsHash.toLowerCase() !== effectiveTermsHash.toLowerCase()) {
    throw new Error("Terms hash does not match current server authoritative agreement");
  }

  // Deadline check
  const nowSec = Math.floor(Date.now() / 1000);
  if (Number(deadline) <= nowSec) {
    throw new Error("Signature deadline has expired");
  }

  // Nonce replay protection
  const buyerKey = `${buyer.toLowerCase()}_${nonce}`;
  const recordedNonce = issuedNonces.get(buyerKey);
  if (recordedNonce && recordedNonce.consumed) {
    throw new Error("Nonce has already been consumed (replay prevention)");
  }

  // Recompute parameters authoritatively from listing
  const effectiveListingId = listingId || recordedNonce?.listingId;
  const authListing = resolveListingParameters(effectiveListingId);
  const authoritativeAmountWei = authListing.priceWei;
  const authoritativeOperator = (operator || authListing.operator || ESCROW_ADDRESS) as `0x${string}`;

  // If client provided an amount, enforce it matches authoritative listing price
  if (amountWei && amountWei !== authoritativeAmountWei) {
    throw new Error(
      `Amount mismatch: expected authoritative listing price of ${authoritativeAmountWei} wei, got ${amountWei}`
    );
  }

  const effectiveWindowStart = windowStart !== undefined ? windowStart : (recordedNonce?.windowStart || 0);
  const effectiveWindowEnd = windowEnd !== undefined ? windowEnd : (recordedNonce?.windowEnd || 0);

  if (effectiveWindowStart >= effectiveWindowEnd) {
    throw new Error("Invalid pass window: start time must be before end time");
  }

  // Verify EIP-712 Typed Data Cryptographically with viem
  const isValid = await verifyTypedData({
    address: buyer as `0x${string}`,
    domain: {
      name: "DSRM",
      version: "1",
      chainId: BigInt(SEPOLIA_CHAIN_ID),
      verifyingContract: ESCROW_ADDRESS,
    },
    types: BOOKING_AGREEMENT_TYPES,
    primaryType: "BookingAgreement",
    message: {
      bookingId: bookingId as `0x${string}`,
      buyer: buyer as `0x${string}`,
      operator: authoritativeOperator,
      windowStart: BigInt(effectiveWindowStart),
      windowEnd: BigInt(effectiveWindowEnd),
      amountWei: BigInt(authoritativeAmountWei),
      termsHash: termsHash as `0x${string}`,
      useDeclarationHash: useDeclarationHash as `0x${string}`,
      nonce: BigInt(nonce),
      deadline: BigInt(deadline),
    },
    signature: signature as `0x${string}`,
  });

  if (!isValid) {
    throw new Error("Cryptographic signature verification failed for buyer address");
  }

  // Mark nonce consumed
  if (recordedNonce) {
    recordedNonce.consumed = true;
  } else {
    issuedNonces.set(buyerKey, {
      nonce: BigInt(nonce),
      deadline: BigInt(deadline),
      issuedAt: nowSec,
      consumed: true,
      termsHash: termsHash as `0x${string}`,
      listingId: effectiveListingId,
      windowStart: effectiveWindowStart,
      windowEnd: effectiveWindowEnd,
      authoritativeAmountWei,
      authoritativeOperator,
    });
  }

  const agreementRow = {
    booking_id: bookingId,
    buyer: buyer.toLowerCase(),
    operator: authoritativeOperator.toLowerCase(),
    window_start: effectiveWindowStart,
    window_end: effectiveWindowEnd,
    amount_wei: authoritativeAmountWei,
    terms_version: termsVersion,
    terms_hash: termsHash,
    use_declaration_hash: useDeclarationHash,
    nonce,
    deadline,
    signature,
    acks: acknowledgements || {},
    status: "VERIFIED",
    created_at: new Date().toISOString(),
  };

  // In-memory cache
  inMemoryAgreements.set(bookingId, agreementRow);

  // Persist to Supabase if tables exist
  try {
    const sb = getSupabaseClient();
    const { data: inserted, error } = await sb
      .from("booking_agreements")
      .upsert(agreementRow, { onConflict: "booking_id" })
      .select()
      .single();

    if (error) {
      console.warn("[Backend Agreement] Supabase booking_agreements notice:", error.message);
    } else if (inserted && pii) {
      // Store isolated PII without logging PII to console
      try {
        await sb.from("agreement_pii").insert({
          agreement_id: inserted.id,
          legal_name: pii.legalName || null,
          email: pii.email || null,
          country: pii.country || null,
          principal_name: pii.principalName || null,
          principal_address: pii.principalAddress || null,
        });
      } catch (e: any) {
        console.warn("[Backend Agreement] PII store notice:", e.message);
      }
    }
  } catch (err: any) {
    console.warn("[Backend Agreement] Persistence exception:", err.message);
  }

  return {
    success: true,
    bookingId,
    status: "VERIFIED",
  };
}

/**
 * Verifies on-chain deposit receipt and activates the booking.
 */
export async function confirmAgreementDeposit(bookingId: string, txHash: string) {
  if (!txHash || !txHash.startsWith("0x")) {
    throw new Error("Invalid transaction hash format");
  }

  // Verify on-chain via public client
  let receipt: any = null;
  try {
    receipt = await publicClient.getTransactionReceipt({
      hash: txHash as `0x${string}`,
    });
  } catch (err: any) {
    throw new Error(`Failed to retrieve on-chain receipt from Sepolia: ${err.message}`);
  }

  if (!receipt || receipt.status !== "success") {
    throw new Error("Transaction has not succeeded on-chain or reverted");
  }

  if (receipt.to && receipt.to.toLowerCase() !== ESCROW_ADDRESS.toLowerCase()) {
    throw new Error(
      `Transaction recipient ${receipt.to} does not match SatelliteEscrow address ${ESCROW_ADDRESS}`
    );
  }

  // Update in-memory agreement
  const cached = inMemoryAgreements.get(bookingId);
  if (cached) {
    cached.status = "ACTIVE";
    cached.tx_hash = txHash;
  }

  // Update Supabase tables
  try {
    const sb = getSupabaseClient();
    await sb
      .from("booking_agreements")
      .update({ status: "ACTIVE", tx_hash: txHash, updated_at: new Date().toISOString() })
      .eq("booking_id", bookingId);

    // Also update / link existing bookings table
    await recordBookingInSupabase({
      id: bookingId.startsWith("0x") ? `BKG-${bookingId.slice(2, 10).toUpperCase()}` : bookingId,
      booking_id: bookingId,
      user_address: cached?.buyer || receipt.from,
      operator_address: cached?.operator || ESCROW_ADDRESS,
      satellite: "DSRM-PASS-RESERVED",
      status: "ACTIVE",
      tx_hash: txHash,
    });
  } catch (err: any) {
    console.warn("[Backend Agreement] Supabase confirm update notice:", err.message);
  }

  return {
    success: true,
    bookingId,
    txHash,
    blockNumber: Number(receipt.blockNumber),
    status: "ACTIVE",
  };
}

/**
 * Retrieves agreement details by bookingId (for resume and receipt views).
 */
export async function getAgreementByBookingId(bookingId: string) {
  const cached = inMemoryAgreements.get(bookingId);
  if (cached) {
    return cached;
  }

  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from("booking_agreements")
      .select("*")
      .eq("booking_id", bookingId)
      .maybeSingle();

    if (!error && data) {
      return data;
    }
  } catch (err: any) {
    console.warn("[Backend Agreement] Fetch notice:", err.message);
  }

  return null;
}
