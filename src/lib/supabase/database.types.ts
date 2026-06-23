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
  | "WITHDRAW_UNLOCK";
export type PaymentMethod =
  | "TELEBIRR"
  | "CBE"
  | "ABYSSINIA"
  | "AWASH"
  | "DASHEN";
export type DisputeStatus = "OPEN" | "UNDER_REVIEW" | "RESOLVED";
export type DisputeResolution = "FAVOUR_BUYER" | "FAVOUR_SELLER";
export type ChainDirection = "IN" | "OUT";
export type WithdrawalStatus =
  | "PENDING_APPROVAL"
  | "APPROVED"
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
          deposit_address?: string | null;
        };
        Update: {
          usdt_available?: string;
          usdt_locked?: string;
          usdt_bond?: string;
          usdt_withdraw_locked?: string;
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
          state: OrderState;
          payment_method: PaymentMethod;
          buyer_payment_name: string;
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
          liveness_path: string;
          full_name: string;
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
        };
        Relationships: [];
      };
    };
    Functions: {
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
        };
        Returns: string; // new order id
      };
      order_mark_paid: {
        Args: { p_order: string; p_actor: string };
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
      // ── identity verification (migration 0015) ──
      kyc_submit: {
        Args: {
          p_user: string;
          p_id_document: string;
          p_liveness: string;
          p_full_name: string;
        };
        Returns: string; // new submission id
      };
      kyc_approve: {
        Args: { p_id: string; p_admin: string };
        Returns: undefined;
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
