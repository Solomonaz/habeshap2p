/**
 * ONE-OFF: generate fresh MAINNET Tron keys for HabeshaP2P.
 *
 * Run on YOUR OWN machine, once:
 *     node scripts/gen-mainnet-keys.cjs
 *
 * ⚠️  The output are REAL secrets that control real money. Do NOT paste them into
 *     chat, screenshots, git, or anywhere public. Copy them straight into your
 *     SERVER env (Vercel → Settings → Environment Variables), back up the mnemonic
 *     phrases OFFLINE (password manager / on paper), then clear your terminal
 *     history. Anyone who sees the private key or a mnemonic can drain the funds.
 *     Never reuse the old Nile testnet keys — they are compromised.
 */
const { TronWeb } = require("tronweb");

// The hot wallet (holds the float, signs withdrawals) and a SEPARATE mnemonic
// used to derive per-user deposit addresses. Two independent secrets.
const hot = TronWeb.createRandom();
const dep = TronWeb.createRandom();

const line = "-".repeat(70);
console.log("\n" + line);
console.log(" PASTE THESE INTO YOUR SERVER ENV (do NOT commit, do NOT share):");
console.log(line);
console.log("TRON_HOT_WALLET_ADDRESS=" + hot.address);
console.log("TRON_HOT_WALLET_PRIVATE_KEY=" + hot.privateKey.replace(/^0x/, ""));
console.log('TRON_DEPOSIT_MNEMONIC="' + dep.mnemonic.phrase + '"');
console.log("\n# also set (not secrets):");
console.log("NEXT_PUBLIC_TRON_NETWORK=mainnet");
console.log("TRON_USDT_CONTRACT=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t");
console.log("# TRON_API_KEY=<get a mainnet key from https://www.trongrid.io>");

console.log("\n" + line);
console.log(" BACK UP OFFLINE - recovers the hot wallet if the key is ever lost:");
console.log(line);
console.log("HOT WALLET recovery phrase: " + hot.mnemonic.phrase);

console.log("\n" + line);
console.log(" NEXT: fund the hot wallet with real USDT (float) + TRX (gas):");
console.log("   " + hot.address);
console.log(line + "\n");
