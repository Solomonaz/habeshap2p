import { createHash } from "node:crypto";

/**
 * Tron (TRC-20) address validation.
 *
 * A Tron base58 address is base58check over 25 bytes:
 *   [0]      = 0x41 network/version prefix (same on mainnet, Nile, Shasta)
 *   [1..21)  = 20-byte account hash
 *   [21..25) = 4-byte checksum = first 4 bytes of sha256(sha256(first 21 bytes))
 * and it renders to a 34-char string beginning with "T".
 *
 * We validate the FULL checksum (not just the "T…34 chars" shape) so that
 * malformed or stub-generated look-alikes are rejected before any funds are
 * held — withdrawals to a bad address would only fail later at signing time.
 *
 * Pure + dependency-free (no tronweb) so it can run in the request path, which
 * must work in TEST mode too where tronweb isn't installed.
 */

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ALPHABET_MAP = new Map<string, number>(
  [...ALPHABET].map((c, i) => [c, i]),
);

/** Decode a base58 string to bytes, or null if it contains a non-base58 char. */
function base58Decode(str: string): Uint8Array | null {
  const bytes: number[] = [0];
  for (const ch of str) {
    const value = ALPHABET_MAP.get(ch);
    if (value === undefined) return null;
    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += (bytes[j] ?? 0) * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Each leading "1" in base58 represents a leading zero byte.
  for (let k = 0; k < str.length && str[k] === "1"; k++) bytes.push(0);
  return Uint8Array.from(bytes.reverse());
}

/** True iff `address` is a structurally valid, checksum-correct Tron address. */
export function isValidTronAddress(address: unknown): address is string {
  if (typeof address !== "string") return false;
  if (address.length !== 34 || address[0] !== "T") return false;

  const decoded = base58Decode(address);
  if (!decoded || decoded.length !== 25) return false;
  if (decoded[0] !== 0x41) return false;

  const payload = decoded.subarray(0, 21);
  const checksum = decoded.subarray(21, 25);
  const hash = createHash("sha256")
    .update(createHash("sha256").update(payload).digest())
    .digest();
  for (let i = 0; i < 4; i++) {
    if (hash[i] !== checksum[i]) return false;
  }
  return true;
}
