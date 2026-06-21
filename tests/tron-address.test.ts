import { describe, expect, it } from "vitest";
import { isValidTronAddress } from "@/lib/chain/address";

describe("isValidTronAddress", () => {
  it("accepts real, checksum-correct Tron addresses", () => {
    // Hot wallet, a derived deposit address, and the Nile faucet — all real,
    // confirmed on-chain.
    expect(isValidTronAddress("TLj5nCrdCiP3r8xqdEU8sM5qU9zayLGBeC")).toBe(true);
    expect(isValidTronAddress("TRm68doVqeiRAB5pyp723hvb2oPoXJq4Nk")).toBe(true);
    expect(isValidTronAddress("TVF2Mp9QY7FEGTnr3DBpFLobA6jguHyMvi")).toBe(true);
  });

  it("rejects look-alikes that fail the base58check checksum", () => {
    // Right shape (T + 34 chars) but a bad checksum — e.g. stub-generated.
    expect(isValidTronAddress("TikzPC2RNBEXxofdsgcMGBBpfdcpqosNki")).toBe(false);
    expect(isValidTronAddress("TjL9pZfm2fuxjs4TtnDpTV8sppz6EqYg2j")).toBe(false);
  });

  it("rejects junk, emails, and the wrong shape", () => {
    expect(isValidTronAddress("sfdgsdgfsgrge4335gg")).toBe(false);
    expect(isValidTronAddress("T234r2252r244t35464")).toBe(false);
    expect(isValidTronAddress("solomon.az1921@gmail.com")).toBe(false);
    expect(isValidTronAddress("")).toBe(false);
    // A valid address mutated by one character must fail the checksum.
    expect(isValidTronAddress("TLj5nCrdCiP3r8xqdEU8sM5qU9zayLGBeD")).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(isValidTronAddress(null)).toBe(false);
    expect(isValidTronAddress(undefined)).toBe(false);
    expect(isValidTronAddress(12345)).toBe(false);
  });
});
