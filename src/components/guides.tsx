import { HowItWorks, Steps, Callout } from "@/components/how-it-works";

/**
 * The inline "How it works" guides, one per flow. Each is a collapsible panel
 * embedded on the screen where the action happens (the trade page and the
 * dashboard's Deposit / Send / Withdraw tabs). Content is plain-language and
 * matches how the platform actually behaves.
 */

const b = (s: string) => <span className="font-medium text-ink">{s}</span>;

/** Buying & selling USDT for Birr — shown on the trade page. */
export function TradeGuide() {
  return (
    <HowItWorks title="How buying & selling USDT works">
      <p>
        Every trade is between two people — a {b("buyer")} (pays Birr, receives
        USDT) and a {b("seller")} (gives USDT, receives Birr). The seller&apos;s
        USDT is held safely in {b("escrow")} the moment an order opens, so nobody
        can run off with it mid-trade.
      </p>

      <p className="mt-3 font-medium text-ink">If you&apos;re buying USDT:</p>
      <Steps
        items={[
          <>Pick a seller&apos;s offer from the order book and tap {b("Buy")}.</>,
          <>Enter how much you want; you&apos;ll see the exact Birr to pay. Enter the {b("name on the account you'll pay from")} and open the order.</>,
          <>The seller&apos;s USDT is now locked in escrow. Wait for the seller to reply in chat, then send the Birr to the {b("Telebirr / bank account shown on the order")}.</>,
          <>Once you&apos;ve sent the Birr, tap {b("I've paid")}.</>,
          <>The seller confirms the money arrived and {b("releases")} the USDT — it lands in your balance. Done.</>,
        ]}
      />

      <p className="mt-4 font-medium text-ink">If you&apos;re selling USDT:</p>
      <Steps
        items={[
          <>The buyer opens the order and your USDT goes into escrow.</>,
          <>Chat with the buyer and share your receiving account if asked.</>,
          <>Wait until the Birr is {b("actually in your account")} — check your bank/Telebirr yourself.</>,
          <>Only then tap {b("Release")} to send the USDT to the buyer.</>,
        ]}
      />

      <Callout tone="warn">
        Never mark paid or release before the money has truly moved. Only pay from
        the exact name you entered — mismatched names get refused. If something
        goes wrong, open a {b("dispute")} and an admin reviews the chat and
        evidence. USDT is never auto-released — only the seller (or an admin
        ruling) can release it.
      </Callout>
      <p className="mt-2 text-xs text-ink-faint">
        A small platform fee applies to each trade; you see the exact amounts
        before you confirm.
      </p>
    </HowItWorks>
  );
}

/** Depositing USDT into your HabeshaP2P balance — shown on the Deposit tab. */
export function DepositGuide() {
  return (
    <HowItWorks title="How depositing USDT works">
      <p>
        Depositing brings USDT from an outside wallet or exchange into your
        HabeshaP2P balance so you can trade or send it.
      </p>
      <Steps
        items={[
          <>Enter how much you want to deposit — you&apos;ll get a {b("shared address")} and one {b("exact amount")} to send.</>,
          <>From your external wallet or exchange, send {b("USDT on the Tron (TRC-20) network")} to that address.</>,
          <>Send the {b("exact amount shown, to the last digit")} — that&apos;s how the system knows the deposit is yours and credits it automatically.</>,
          <>After the network confirms it (usually a few minutes), it appears in your balance.</>,
          <>If it hasn&apos;t shown up after confirmation, use {b("“Deposit delayed? Verify by TxHash”")} and paste your transaction ID.</>,
        ]}
      />
      <Callout tone="warn">
        Only send {b("USDT on Tron (TRC-20)")}. USDT on any other network (e.g.
        Ethereum/BEP-20) or a different token is {b("unrecoverable")}. Each request
        expires after 30 minutes — just generate a new one if it lapses.
      </Callout>
    </HowItWorks>
  );
}

/** Sending USDT to another HabeshaP2P user — shown on the Send tab. */
export function SendGuide() {
  return (
    <HowItWorks title="How sending USDT works">
      <p>
        Send moves USDT instantly from your balance to another {b("HabeshaP2P")}{" "}
        account. It happens inside the platform — no blockchain, no network fee,
        no waiting.
      </p>
      <Steps
        items={[
          <>Ask the person for their {b("HabeshaP2P ID")} (not a wallet address).</>,
          <>Enter their ID and the amount, then confirm.</>,
          <>It lands in their balance {b("immediately")}.</>,
        ]}
      />
      <Callout>
        Send is only for HabeshaP2P → HabeshaP2P. To move USDT to an {b("outside")}{" "}
        wallet or exchange, use {b("Withdraw")} instead. Double-check the ID —
        internal transfers are instant and final.
      </Callout>
    </HowItWorks>
  );
}

/** Withdrawing USDT to an external wallet — shown on the Withdraw tab. */
export function WithdrawGuide() {
  return (
    <HowItWorks title="How withdrawing USDT works">
      <p>
        Withdrawing sends USDT from your balance out to a wallet or exchange you
        control on the {b("Tron (TRC-20)")} network.
      </p>
      <Steps
        items={[
          <>Paste your {b("external")} Tron (TRC-20) address and the amount you want to send.</>,
          <>A small flat {b("network fee")} is added on top — you need amount + fee in your balance, and the {b("full amount you enter")} arrives.</>,
          <>Smaller withdrawals are sent automatically; larger ones (at or above the platform&apos;s limit) need a quick {b("admin review")} first.</>,
          <>Track it in your {b("withdrawal history")}: queued → sent → confirmed on-chain.</>,
        ]}
      />
      <Callout tone="warn">
        Use an address {b("you control on another wallet or exchange")} — never
        your HabeshaP2P deposit address, or the funds come straight back to us. To
        pay another HabeshaP2P user, use {b("Send")}, not Withdraw. On-chain
        transfers are {b("irreversible")} — check the address carefully.
      </Callout>
    </HowItWorks>
  );
}
