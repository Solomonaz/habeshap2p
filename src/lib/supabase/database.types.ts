/**
 * Hand-written stub of the generated Supabase types, matching
 * supabase/migrations. Regenerate from your cloud project once keys are set:
 *
 *   SUPABASE_PROJECT_ID=<ref> npm run db:types
 *
 * IMPORTANT: monetary `numeric` columns are typed as `string`, not `number`.
 * supabase-js returns numeric as a string, and we keep them as strings end-to-end
 * so money math is done with an exact-decimal library — never JS floats.
 */

export type AdSide = "BUY" | "SELL";
export type AdStatus = "ACTIVE" | "PAUSED" | "CLOSED";
export type OrderState =
  | "CREATED"
  | "PAID"
  | "RELEASED"
  | "CANCELLED"
  | "DISPUTED";
export type LedgerType =
  | "LOCK"
  | "UNLOCK"
  | "RELEASE"
  | "FEE"
  | "DEPOSIT"
  | "WITHDRAW"
  | "BOND_LOCK"
  | "BOND_RELEASE"
  | "WITHDRAW_LOCK"
  | "WITHDRAW_UNLOCK"
  | "FREEZE"
  | "UNFREEZE"
  | "FORFEIT"
  | "UNFORFEIT"
  | "TRANSFER_OUT"
  | "TRANSFER_IN"
  | "REFERRAL";
export type AccountStatus = "ACTIVE" | "FROZEN" | "BANNED";
export type PaymentMethod =
  | "TELEBIRR"
  | "MPESA"
  | "CBE_BIRR"
  | "CBE"
  | "AWASH"
  | "DASHEN"
  | "ABYSSINIA"
  | "WEGAGEN"
  | "HIBRET"
  | "NIB"
  | "ZEMEN"
  | "BUNNA"
  | "OROMIA"
  | "COOP_OROMIA";
/** A SELL ad's per-method receiving account (migration 0052, ads.receiving_accounts). */
export type ReceivingAccount = {
  method: PaymentMethod;
  name: string;
  number: string;
  note: string;
};
export type DisputeStatus = "OPEN" | "UNDER_REVIEW" | "RESOLVED";
export type DisputeResolution = "FAVOUR_BUYER" | "FAVOUR_SELLER";
export type ChainDirection = "IN" | "OUT";
export type WithdrawalStatus =
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "SENDING"
  | "SENT"
  | "CONFIRMED"
  | "REJECTED"
  | "FAILED";
export type KycStatus = "UNVERIFIED" | "PENDING" | "APPROVED" | "REJECTED";

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          // Short shareable account number (migration 0046) for internal transfers.
          public_id: string;
          // Who referred this user (migration 0050), set once at signup.
          referred_by: string | null;
          full_name: string | null;
          phone: string | null;
          email: string | null;
          telegram_id: number | null;
          telegram_username: string | null;
          device_fingerprint: string | null;
          reputation_score: number;
          completed_trades: number;
          completion_rate: number;
          avg_release_seconds: number;
          is_merchant: boolean;
          is_admin: boolean;
          kyc_status: KycStatus;
          account_status: AccountStatus;
          frozen_at: string | null;
          ban_reason: string | null;
          // Presence heartbeat (migration 0042); null = never seen online.
          last_seen_at: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          phone?: string | null;
          email?: string | null;
          telegram_id?: number | null;
          telegram_username?: string | null;
          device_fingerprint?: string | null;
          reputation_score?: number;
          completed_trades?: number;
          completion_rate?: number;
          avg_release_seconds?: number;
          is_merchant?: boolean;
          is_admin?: boolean;
          kyc_status?: KycStatus;
          account_status?: AccountStatus;
          frozen_at?: string | null;
          ban_reason?: string | null;
          created_at?: string;
        };
        Update: {
          full_name?: string | null;
          phone?: string | null;
          email?: string | null;
          telegram_id?: number | null;
          telegram_username?: string | null;
          device_fingerprint?: string | null;
          reputation_score?: number;
          completed_trades?: number;
          completion_rate?: number;
          avg_release_seconds?: number;
          is_merchant?: boolean;
          is_admin?: boolean;
          kyc_status?: KycStatus;
          account_status?: AccountStatus;
          frozen_at?: string | null;
          ban_reason?: string | null;
          last_seen_at?: string | null;
        };
        Relationships: [];
      };
      wallets: {
        Row: {
          user_id: string;
          usdt_available: string;
          usdt_locked: string;
          usdt_bond: string;
          usdt_withdraw_locked: string;
          usdt_frozen: string;
          // Forfeited on a missed-release ruling (migration 0025).
          usdt_forfeited: string;
          deposit_address: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          usdt_available?: string;
          usdt_locked?: string;
          usdt_bond?: string;
          usdt_withdraw_locked?: string;
          usdt_frozen?: string;
          deposit_address?: string | null;
        };
        Update: {
          usdt_available?: string;
          usdt_locked?: string;
          usdt_bond?: string;
          usdt_withdraw_locked?: string;
          usdt_frozen?: string;
          deposit_address?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "wallets_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      ads: {
        Row: {
          id: string;
          user_id: string;
          side: AdSide;
          rate_etb: string;
          min_etb: string;
          max_etb: string;
          payment_methods: PaymentMethod[];
          status: AdStatus;
          payer_name: string | null;
          notes: string | null;
          // Receiver's payment account for SELL ads (migration 0047).
          receiving_name: string | null;
          receiving_number: string | null;
          receiving_note: string | null;
          // Per-method receiving accounts for SELL ads (migration 0052).
          receiving_accounts: ReceivingAccount[] | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          side: AdSide;
          rate_etb: string;
          min_etb: string;
          max_etb: string;
          payment_methods: PaymentMethod[];
          status?: AdStatus;
          payer_name?: string | null;
          notes?: string | null;
          receiving_name?: string | null;
          receiving_number?: string | null;
          receiving_note?: string | null;
          receiving_accounts?: ReceivingAccount[] | null;
          created_at?: string;
        };
        Update: {
          rate_etb?: string;
          min_etb?: string;
          max_etb?: string;
          payment_methods?: PaymentMethod[];
          status?: AdStatus;
          payer_name?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "ads_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      orders: {
        Row: {
          id: string;
          ad_id: string;
          buyer_id: string;
          seller_id: string;
          amount_usdt: string;
          rate_etb: string;
          amount_etb: string;
          fee_usdt: string;
          // Seller-side trade fee charged at release (migration 0049).
          seller_fee_usdt: string;
          state: OrderState;
          payment_method: PaymentMethod;
          buyer_payment_name: string;
          // Receiver's payment account snapshotted at order creation (migration 0047).
          receiving_name: string | null;
          receiving_number: string | null;
          receiving_note: string | null;
          paid_at: string | null;
          released_at: string | null;
          cancelled_at: string | null;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          ad_id: string;
          buyer_id: string;
          seller_id: string;
          amount_usdt: string;
          rate_etb: string;
          amount_etb: string;
          fee_usdt?: string;
          state?: OrderState;
          payment_method: PaymentMethod;
          buyer_payment_name: string;
          expires_at: string;
        };
        Update: {
          state?: OrderState;
          fee_usdt?: string;
          paid_at?: string | null;
          released_at?: string | null;
          cancelled_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "orders_ad_id_fkey";
            columns: ["ad_id"];
            referencedRelation: "ads";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          id: string;
          order_id: string;
          sender_id: string;
          body: string | null;
          image_url: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          sender_id: string;
          body?: string | null;
          image_url?: string | null;
          created_at?: string;
        };
        // Immutable in practice (no RLS update policy); typed empty so any
        // attempted column update is a compile error.
        Update: Record<string, never>;
        Relationships: [
          {
            foreignKeyName: "messages_order_id_fkey";
            columns: ["order_id"];
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      disputes: {
        Row: {
          id: string;
          order_id: string;
          opened_by: string;
          reason: string;
          status: DisputeStatus;
          resolution: DisputeResolution | null;
          resolved_by: string | null;
          created_at: string;
          resolved_at: string | null;
        };
        Insert: {
          id?: string;
          order_id: string;
          opened_by: string;
          reason: string;
          status?: DisputeStatus;
        };
        Update: {
          status?: DisputeStatus;
          resolution?: DisputeResolution | null;
          resolved_by?: string | null;
          resolved_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "disputes_order_id_fkey";
            columns: ["order_id"];
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      ledger_entries: {
        Row: {
          id: string;
          user_id: string;
          order_id: string | null;
          type: LedgerType;
          amount_usdt: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          order_id?: string | null;
          type: LedgerType;
          amount_usdt: string;
          created_at?: string;
        };
        // Append-only: no updates ever.
        Update: Record<string, never>;
        Relationships: [
          {
            foreignKeyName: "ledger_entries_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      chain_txs: {
        Row: {
          id: string;
          user_id: string;
          direction: ChainDirection;
          tx_hash: string;
          amount_usdt: string;
          confirmed: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          direction: ChainDirection;
          tx_hash: string;
          amount_usdt: string;
          confirmed?: boolean;
          created_at?: string;
        };
        Update: {
          confirmed?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "chain_txs_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_account: {
        // Singleton (id = true). Service-role only; never read by the client.
        Row: { id: boolean; usdt_fees: string };
        Insert: { id?: boolean; usdt_fees?: string };
        Update: { usdt_fees?: string };
        Relationships: [];
      };
      withdrawals: {
        Row: {
          id: string;
          user_id: string;
          to_address: string;
          amount_usdt: string;
          // Flat fee charged on the withdrawal (migration 0045); net sent on-chain
          // = amount_usdt − fee_usdt. The fee accrues to platform revenue.
          fee_usdt: string;
          status: WithdrawalStatus;
          tx_hash: string | null;
          reviewed_by: string | null;
          failure_reason: string | null;
          created_at: string;
          reviewed_at: string | null;
          sent_at: string | null;
          confirmed_at: string | null;
        };
        // Written only by server-side RPCs (request/approve/reject/send); no
        // client insert/update.
        Insert: {
          id?: string;
          user_id: string;
          to_address: string;
          amount_usdt: string;
          status?: WithdrawalStatus;
        };
        Update: Record<string, never>;
        Relationships: [
          {
            foreignKeyName: "withdrawals_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      admin_audit_log: {
        // Append-only privileged-action trail (migration 0013). Written only by
        // record_admin_action (service role); admins may read via RLS.
        Row: {
          id: string;
          admin_id: string;
          action: string;
          target_type: string | null;
          target_id: string | null;
          detail: string | null;
          created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_admin_id_fkey";
            columns: ["admin_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_settings: {
        // Singleton (id = true) runtime switch (migration 0018). Admins read it
        // (RLS) to render the toggle; only set_live_payments writes it. The
        // service role reads it server-side to pick the chain provider.
        Row: {
          id: boolean;
          live_payments: boolean;
          // Admin-configurable taker fee (migration 0020). fee_bps in basis
          // points (0 disables); the min/max clamp is in USDT (max null = no cap).
          fee_bps: number;
          fee_min_usdt: string;
          fee_max_usdt: string | null;
          // Admin-configurable trade limits + merchant bond (migration 0021).
          // Cap columns null = unlimited for that tier.
          min_merchant_bond: number;
          trade_limit_new: number | null;
          trade_limit_active: number | null;
          trade_limit_established: number | null;
          tier_active_trades: number;
          tier_established_trades: number;
          // Admin-configurable order payment window (migration 0022). Minutes a
          // CREATED order may sit unpaid before it is eligible for auto-cancel.
          order_ttl_minutes: number;
          // Fresh seller release window in minutes (migration 0042) — applied to
          // expires_at when a buyer marks paid, replacing the leftover payment window.
          release_window_minutes: number;
          // Flat withdrawal fee in USDT (migration 0045) — deducted from each
          // withdrawal so the user covers on-chain gas.
          withdrawal_fee_usdt: string;
          // Seller trade fee in bps + flat internal-transfer fee (migration 0049).
          seller_fee_bps: number;
          internal_transfer_fee_usdt: string;
          // Referral reward rate in bps (migration 0050) — share of the platform
          // fee credited to a referrer on their referral's trade. The reward
          // window (migration 0051) caps it to a referee's first N trades
          // (0 = unlimited).
          referral_bps: number;
          referral_max_trades: number;
          // Admin-selectable deposit-gas strategy (migrations 0029 + 0039):
          // 'staking' | 'rental' | 'burn' | 'pooled'. pooled_deposit_address is the
          // shared omnibus address override (null ⇒ use the hot-wallet address).
          sweep_strategy: string;
          pooled_deposit_address: string | null;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [
          {
            foreignKeyName: "platform_settings_updated_by_fkey";
            columns: ["updated_by"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      kyc_submissions: {
        // Identity-verification attempts (migration 0015). Written only by the
        // kyc_submit/approve/reject RPCs; users read their own, admins read all.
        Row: {
          id: string;
          user_id: string;
          id_document_path: string;
          id_document_back_path: string | null;
          liveness_path: string;
          full_name: string;
          id_number: string | null;
          status: KycStatus;
          rejection_reason: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [
          {
            foreignKeyName: "kyc_submissions_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      deposit_intents: {
        // Pooled/omnibus deposit attribution by unique amount (migration 0029).
        // Written only by the create_deposit_intent / credit_pooled_deposit RPCs;
        // users read their own to render the pooled deposit screen.
        Row: {
          id: string;
          user_id: string;
          amount_usdt: string;
          status: string; // PENDING | MATCHED | EXPIRED
          tx_hash: string | null;
          created_at: string;
          expires_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [
          {
            foreignKeyName: "deposit_intents_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        // In-app notification feed (migration 0034). Written by notify/notify_admins
        // (service role); users read their own; mark_notifications_read updates them.
        Row: {
          id: string;
          user_id: string;
          type: string;
          title: string;
          body: string | null;
          href: string | null;
          audience: string; // 'user' | 'admin'
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          user_id: string;
          type: string;
          title: string;
          body?: string | null;
          href?: string | null;
          audience?: string;
        };
        Update: Record<string, never>;
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      unmatched_deposits: {
        // Pooled deposits that matched no intent (migration 0036). Admin-only;
        // written by record/credit/ignore RPCs.
        Row: {
          id: string;
          tx_hash: string;
          to_address: string;
          amount_usdt: string;
          status: string; // PENDING | CREDITED | IGNORED
          credited_user_id: string | null;
          resolved_by: string | null;
          resolution_note: string | null;
          created_at: string;
          resolved_at: string | null;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      cron_heartbeats: {
        // Per-cron last-run stamp (migration 0044). Service-role only; written by
        // record_cron_run, read by the monitor + pre-flight page.
        Row: {
          name: string;
          last_run_at: string;
          last_ok: boolean;
          runs: number;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
    };
    Views: {
      public_profiles: {
        Row: {
          id: string;
          reputation_score: number;
          completed_trades: number;
          completion_rate: number;
          avg_release_seconds: number;
          is_merchant: boolean;
          created_at: string;
          full_name: string | null;
          is_verified: boolean;
          last_seen_at: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      notify: {
        Args: {
          p_user: string;
          p_type: string;
          p_title: string;
          p_body?: string | null;
          p_href?: string | null;
          p_audience?: string;
        };
        Returns: undefined;
      };
      notify_admins: {
        Args: {
          p_type: string;
          p_title: string;
          p_body?: string | null;
          p_href?: string | null;
        };
        Returns: undefined;
      };
      mark_notifications_read: {
        Args: { p_ids?: string[] | null };
        Returns: undefined;
      };
      record_unmatched_deposit: {
        Args: { p_tx_hash: string; p_amount: string; p_to_address: string };
        Returns: boolean; // true iff newly recorded
      };
      credit_unmatched_deposit: {
        Args: { p_admin: string; p_tx_hash: string; p_user: string };
        Returns: string; // credited amount
      };
      ignore_unmatched_deposit: {
        Args: { p_admin: string; p_tx_hash: string; p_reason?: string | null };
        Returns: undefined;
      };
      unignore_unmatched_deposit: {
        Args: { p_admin: string; p_tx_hash: string };
        Returns: undefined;
      };
      // Money amounts are passed as decimal strings to preserve exactness.
      ledger_deposit: {
        Args: { p_user: string; p_amount: string };
        Returns: undefined;
      };
      ledger_lock: {
        Args: { p_user: string; p_amount: string; p_order: string };
        Returns: undefined;
      };
      ledger_unlock: {
        Args: { p_user: string; p_amount: string; p_order: string };
        Returns: undefined;
      };
      ledger_withdraw: {
        Args: { p_user: string; p_amount: string };
        Returns: undefined;
      };
      // ── escrow orchestration (migration 0007) ──
      order_create: {
        Args: {
          p_ad: string;
          p_taker: string;
          p_amount_usdt: string;
          p_payment_method: PaymentMethod;
          p_buyer_payment_name: string;
          p_ttl_minutes?: number;
          // Receiver's account for a BUY ad (taker/seller supplies it; migration 0047).
          p_receiving_name?: string;
          p_receiving_number?: string;
          p_receiving_note?: string;
        };
        Returns: string; // new order id
      };
      order_mark_paid: {
        // Requires a buyer chat message + resets expires_at to a fresh release
        // window when flipping to PAID (migration 0042).
        Args: { p_order: string; p_actor: string };
        Returns: undefined;
      };
      set_release_window: {
        Args: { p_admin: string; p_minutes: number };
        Returns: undefined;
      };
      set_withdrawal_fee: {
        Args: { p_admin: string; p_fee: string };
        Returns: undefined;
      };
      set_seller_fee: {
        Args: { p_admin: string; p_bps: number };
        Returns: undefined;
      };
      set_internal_transfer_fee: {
        Args: { p_admin: string; p_fee: string };
        Returns: undefined;
      };
      set_referral_bps: {
        Args: { p_admin: string; p_bps: number };
        Returns: undefined;
      };
      set_referral_max_trades: {
        Args: { p_admin: string; p_n: number };
        Returns: undefined;
      };
      internal_transfer: {
        // Free off-chain USDT transfer to another user by HabeshaP2P ID
        // (migration 0046). Returns the recipient's user id.
        Args: { p_sender: string; p_recipient_id: string; p_amount: string };
        Returns: string;
      };
      touch_presence: {
        Args: { p_user: string };
        Returns: undefined;
      };
      order_release: {
        // p_fee_bps/min/max are optional overrides; when omitted the configured
        // admin fee (platform_settings, migration 0020) is read and applied.
        Args: {
          p_order: string;
          p_actor: string;
          p_fee_bps?: number;
          p_fee_min?: string;
          p_fee_max?: string;
        };
        Returns: undefined;
      };
      order_cancel: {
        Args: { p_order: string; p_actor?: string };
        Returns: undefined;
      };
      order_expire_unpaid: {
        Args: Record<string, never>;
        Returns: number; // count cancelled
      };
      // ── single-order expiry helper (migration 0023) ──
      order_expire_due: {
        Args: { p_order: string };
        Returns: boolean; // true if this call cancelled the overdue order
      };
      // ── seller freeze + temp-ban on missed release (migration 0025) ──
      order_freeze_seller: {
        Args: { p_order: string };
        Returns: boolean; // true if this call froze the seller + opened a dispute
      };
      // ── cron sweep: freeze sellers of overdue PAID orders (migration 0026) ──
      order_freeze_overdue: {
        Args: Record<string, never>;
        Returns: number; // count of sellers frozen
      };
      // ── admin appeal: reinstate a banned account (migration 0027) ──
      account_reinstate: {
        Args: { p_user: string; p_admin: string };
        Returns: string; // USDT amount returned to the seller (decimal string)
      };
      account_ban: {
        Args: { p_admin: string; p_user: string; p_reason: string };
        Returns: undefined;
      };
      account_unban: {
        Args: { p_admin: string; p_user: string };
        Returns: undefined;
      };
      // ── dispute resolution (migration 0010) ──
      order_open_dispute: {
        Args: { p_order: string; p_actor: string; p_reason: string };
        Returns: string; // new dispute id
      };
      dispute_resolve: {
        Args: {
          p_dispute: string;
          p_admin: string;
          p_resolution: DisputeResolution;
        };
        Returns: undefined;
      };
      // ── merchant bonds + trade limits (migration 0011) ──
      _trade_limit_usdt: {
        Args: { p_user: string };
        Returns: string | null; // per-order cap (decimal string) or null = unlimited
      };
      merchant_post_bond: {
        Args: { p_user: string; p_amount: string };
        Returns: undefined;
      };
      merchant_release_bond: {
        Args: { p_user: string };
        Returns: undefined;
      };
      // ── on-chain deposits + withdrawals (migration 0012) ──
      wallet_set_deposit_address: {
        Args: { p_user: string; p_address: string };
        Returns: string; // the assigned (or pre-existing) address
      };
      credit_deposit: {
        Args: { p_user: string; p_tx_hash: string; p_amount: string };
        Returns: boolean; // true if this call did the crediting
      };
      withdrawal_request: {
        Args: {
          p_user: string;
          p_to_address: string;
          p_amount: string;
          p_threshold?: string;
          p_fee?: string; // flat withdrawal fee (migration 0045)
        };
        Returns: string; // new withdrawal id
      };
      withdrawal_approve: {
        Args: { p_id: string; p_admin: string };
        Returns: undefined;
      };
      withdrawal_reject: {
        Args: { p_id: string; p_admin: string; p_reason: string };
        Returns: undefined;
      };
      withdrawal_claim_for_send: {
        Args: { p_id: string };
        Returns: boolean; // true iff this caller moved the row APPROVED → SENDING
      };
      withdrawal_mark_sent: {
        Args: { p_id: string; p_tx_hash: string };
        Returns: undefined;
      };
      withdrawal_mark_failed: {
        Args: { p_id: string; p_reason: string };
        Returns: undefined;
      };
      withdrawal_mark_confirmed: {
        Args: { p_id: string };
        Returns: undefined;
      };
      withdrawal_reconcile_sent: {
        Args: { p_id: string; p_admin: string; p_tx_hash: string };
        Returns: undefined;
      };
      withdrawal_reconcile_refund: {
        Args: { p_id: string; p_admin: string; p_reason: string };
        Returns: undefined;
      };
      withdrawal_stamp_send_tx: {
        Args: { p_id: string; p_tx_hash: string };
        Returns: undefined;
      };
      // ── identity verification (migration 0015) ──
      kyc_submit: {
        Args: {
          p_user: string;
          p_id_document: string;
          p_id_document_back: string;
          p_liveness: string;
          p_full_name: string;
        };
        Returns: string; // new submission id
      };
      kyc_approve: {
        // Admin records the ID number off the document at approval time; the SQL
        // normalises it, blocks duplicates, and stores it (migration 0041).
        Args: { p_id: string; p_admin: string; p_id_number: string };
        Returns: undefined;
      };
      kyc_id_number_taken: {
        // Read-only: is this ID number already APPROVED on another account?
        Args: { p_id_number: string; p_exclude_user: string };
        Returns: boolean;
      };
      record_cron_run: {
        Args: { p_name: string; p_ok: boolean };
        Returns: undefined;
      };
      platform_liabilities_usdt: {
        // Total USDT owed to users across all wallet buckets (exact, as text).
        Args: Record<string, never>;
        Returns: string;
      };
      kyc_reject: {
        Args: { p_id: string; p_admin: string; p_reason: string };
        Returns: undefined;
      };
      // ── admin audit log + ops stats (migration 0013) ──
      record_admin_action: {
        Args: {
          p_admin: string;
          p_action: string;
          p_target_type?: string | null;
          p_target_id?: string | null;
          p_detail?: string | null;
        };
        Returns: string; // new audit-log entry id
      };
      // ── platform settings: live-payments switch (migration 0018) ──
      set_live_payments: {
        Args: { p_admin: string; p_enabled: boolean };
        Returns: boolean; // the value now in effect
      };
      // ── admin-configurable taker fee (migration 0020) ──
      set_platform_fee: {
        Args: {
          p_admin: string;
          p_fee_bps: number;
          p_fee_min?: string;
          p_fee_max?: string | null;
        };
        Returns: number; // the bps value now in effect
      };
      // ── admin-configurable trade limits + bond (migration 0021) ──
      set_trade_policy: {
        Args: {
          p_admin: string;
          p_min_bond: string;
          p_limit_new: string | null;
          p_limit_active: string | null;
          p_limit_established: string | null;
          p_active_trades: number;
          p_established_trades: number;
        };
        Returns: undefined;
      };
      // ── admin-configurable order payment window (migration 0022) ──
      set_order_ttl: {
        Args: { p_admin: string; p_minutes: number };
        Returns: undefined;
      };
      // ── deposit-gas strategy + pooled deposits (migration 0029) ──
      set_sweep_strategy: {
        Args: {
          p_admin: string;
          p_strategy: string;
          p_pooled_address?: string | null;
        };
        Returns: undefined;
      };
      create_deposit_intent: {
        Args: { p_user: string; p_base_amount: string };
        // The new intent row (amount_usdt is the exact amount the user must send).
        Returns: {
          id: string;
          user_id: string;
          amount_usdt: string;
          status: string;
          tx_hash: string | null;
          created_at: string;
          expires_at: string;
        };
      };
      credit_pooled_deposit: {
        Args: { p_tx_hash: string; p_amount: string };
        // 'credited' (newly credited a user), 'duplicate' (already processed or
        // locked by a concurrent poll), or 'unmatched' (no intent for this amount
        // — real funds that need manual reconciliation).
        Returns: string;
      };
      // ── cron mutual-exclusion lease lock (migration 0030) ──
      try_acquire_cron_lock: {
        Args: { p_name: string; p_holder: string; p_ttl_seconds: number };
        Returns: boolean; // true iff this caller now holds the lease
      };
      release_cron_lock: {
        Args: { p_name: string; p_holder: string };
        Returns: undefined;
      };
      platform_stats: {
        Args: Record<string, never>;
        // jsonb object; all amounts are exact decimal strings, counts are numbers.
        Returns: {
          available: string;
          locked: string;
          bond: string;
          withdraw_locked: string;
          platform_fees: string;
          liabilities: string;
          total_supply: string;
          user_count: number;
          merchant_count: number;
          active_ad_count: number;
          open_order_count: number;
          open_dispute_count: number;
          pending_withdrawal_count: number;
        };
      };
    };
    Enums: {
      ad_side: AdSide;
      ad_status: AdStatus;
      order_state: OrderState;
      ledger_type: LedgerType;
      payment_method: PaymentMethod;
      dispute_status: DisputeStatus;
      dispute_resolution: DisputeResolution;
      chain_direction: ChainDirection;
      withdrawal_status: WithdrawalStatus;
      kyc_status: KycStatus;
    };
    CompositeTypes: Record<never, never>;
  };
};
