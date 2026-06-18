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
export type PaymentMethod = "TELEBIRR" | "CBE";
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

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          phone: string | null;
          device_fingerprint: string | null;
          reputation_score: number;
          completed_trades: number;
          completion_rate: number;
          avg_release_seconds: number;
          is_merchant: boolean;
          is_admin: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          phone?: string | null;
          device_fingerprint?: string | null;
          reputation_score?: number;
          completed_trades?: number;
          completion_rate?: number;
          avg_release_seconds?: number;
          is_merchant?: boolean;
          is_admin?: boolean;
          created_at?: string;
        };
        Update: {
          phone?: string | null;
          device_fingerprint?: string | null;
          reputation_score?: number;
          completed_trades?: number;
          completion_rate?: number;
          avg_release_seconds?: number;
          is_merchant?: boolean;
          is_admin?: boolean;
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
        Args: { p_order: string; p_actor: string; p_fee_bps?: number };
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
    };
    CompositeTypes: Record<never, never>;
  };
};
