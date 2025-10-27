export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      admin_actions: {
        Row: {
          action_type: string
          admin_wallet: string
          created_at: string | null
          details: Json | null
          id: string
        }
        Insert: {
          action_type: string
          admin_wallet: string
          created_at?: string | null
          details?: Json | null
          id?: string
        }
        Update: {
          action_type?: string
          admin_wallet?: string
          created_at?: string | null
          details?: Json | null
          id?: string
        }
        Relationships: []
      }
      platform_stats: {
        Row: {
          id: string
          last_updated: string | null
          number_of_stakers: number
          total_staked: number
          vault_sol_balance: number
          weekly_reward_pool: number
        }
        Insert: {
          id?: string
          last_updated?: string | null
          number_of_stakers?: number
          total_staked?: number
          vault_sol_balance?: number
          weekly_reward_pool?: number
        }
        Update: {
          id?: string
          last_updated?: string | null
          number_of_stakers?: number
          total_staked?: number
          vault_sol_balance?: number
          weekly_reward_pool?: number
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          created_at: string
          id: string
          identifier: string
        }
        Insert: {
          created_at?: string
          id?: string
          identifier: string
        }
        Update: {
          created_at?: string
          id?: string
          identifier?: string
        }
        Relationships: []
      }
      rewards: {
        Row: {
          amount: number
          distributed_at: string | null
          distribution_date: string
          id: string
          tx_signature: string | null
          wallet_address: string
        }
        Insert: {
          amount: number
          distributed_at?: string | null
          distribution_date: string
          id?: string
          tx_signature?: string | null
          wallet_address: string
        }
        Update: {
          amount?: number
          distributed_at?: string | null
          distribution_date?: string
          id?: string
          tx_signature?: string | null
          wallet_address?: string
        }
        Relationships: []
      }
      stakers: {
        Row: {
          created_at: string | null
          id: string
          last_updated: string | null
          pending_rewards: number
          stake_locked_until: string | null
          staked_amount: number
          unstake_locked_until: string | null
          version: number
          wallet_address: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          last_updated?: string | null
          pending_rewards?: number
          stake_locked_until?: string | null
          staked_amount?: number
          unstake_locked_until?: string | null
          version?: number
          wallet_address: string
        }
        Update: {
          created_at?: string | null
          id?: string
          last_updated?: string | null
          pending_rewards?: number
          stake_locked_until?: string | null
          staked_amount?: number
          unstake_locked_until?: string | null
          version?: number
          wallet_address?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount: number
          created_at: string | null
          id: string
          status: string
          token: string
          tx_signature: string | null
          type: string
          wallet_address: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          id?: string
          status?: string
          token: string
          tx_signature?: string | null
          type: string
          wallet_address: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          id?: string
          status?: string
          token?: string
          tx_signature?: string | null
          type?: string
          wallet_address?: string
        }
        Relationships: []
      }
      webhook_logs: {
        Row: {
          created_at: string | null
          event_type: string
          id: string
          payload: Json
          processed: boolean | null
          processed_at: string | null
        }
        Insert: {
          created_at?: string | null
          event_type: string
          id?: string
          payload: Json
          processed?: boolean | null
          processed_at?: string | null
        }
        Update: {
          created_at?: string | null
          event_type?: string
          id?: string
          payload?: Json
          processed?: boolean | null
          processed_at?: string | null
        }
        Relationships: []
      }
      withdrawal_locks: {
        Row: {
          expires_at: string
          locked_at: string
          wallet_address: string
        }
        Insert: {
          expires_at?: string
          locked_at?: string
          wallet_address: string
        }
        Update: {
          expires_at?: string
          locked_at?: string
          wallet_address?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      set_stake_lock: {
        Args: { p_lock_until: string; p_wallet_address: string }
        Returns: boolean
      }
      set_unstake_lock: {
        Args: { p_lock_until: string; p_wallet_address: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
