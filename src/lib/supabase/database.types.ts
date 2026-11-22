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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json
          entity_id: string | null
          entity_type: string | null
          id: number
          workspace_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          entity_id?: string | null
          entity_type?: string | null
          id?: never
          workspace_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          entity_id?: string | null
          entity_type?: string | null
          id?: never
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_templates: {
        Row: {
          config: Json
          created_at: string
          deleted_at: string | null
          id: string
          is_system: boolean
          key: string
          name: string
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          config: Json
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_system?: boolean
          key: string
          name: string
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          config?: Json
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_system?: boolean
          key?: string
          name?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_templates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      bills: {
        Row: {
          amount_paise: number
          created_at: string
          deleted_at: string | null
          due_date: string
          gstin: string | null
          hold_reason: string | null
          id: string
          image_path: string | null
          invoice_date: string | null
          invoice_number: string
          notes: string | null
          paid_at: string | null
          paid_paise: number
          paid_reference: string | null
          source: string
          status: string
          updated_at: string
          vendor_id: string
          workspace_id: string
        }
        Insert: {
          amount_paise: number
          created_at?: string
          deleted_at?: string | null
          due_date: string
          gstin?: string | null
          hold_reason?: string | null
          id?: string
          image_path?: string | null
          invoice_date?: string | null
          invoice_number: string
          notes?: string | null
          paid_at?: string | null
          paid_paise?: number
          paid_reference?: string | null
          source?: string
          status?: string
          updated_at?: string
          vendor_id: string
          workspace_id: string
        }
        Update: {
          amount_paise?: number
          created_at?: string
          deleted_at?: string | null
          due_date?: string
          gstin?: string | null
          hold_reason?: string | null
          id?: string
          image_path?: string | null
          invoice_date?: string | null
          invoice_number?: string
          notes?: string | null
          paid_at?: string | null
          paid_paise?: number
          paid_reference?: string | null
          source?: string
          status?: string
          updated_at?: string
          vendor_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bills_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      debit_accounts: {
        Row: {
          account_last4: string
          account_number_enc: string
          bank_name: string
          bank_template_id: string | null
          created_at: string
          deleted_at: string | null
          id: string
          ifsc: string | null
          is_default: boolean
          nickname: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          account_last4: string
          account_number_enc: string
          bank_name: string
          bank_template_id?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          ifsc?: string | null
          is_default?: boolean
          nickname: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          account_last4?: string
          account_number_enc?: string
          bank_name?: string
          bank_template_id?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          ifsc?: string | null
          is_default?: boolean
          nickname?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "debit_accounts_bank_template_id_fkey"
            columns: ["bank_template_id"]
            isOneToOne: false
            referencedRelation: "bank_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debit_accounts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_logs: {
        Row: {
          corrected_fields: string[]
          created_at: string
          duration_ms: number | null
          engine: string | null
          fields: Json
          id: string
          kind: string
          parser_version: string
          source_type: string
          workspace_id: string
        }
        Insert: {
          corrected_fields?: string[]
          created_at?: string
          duration_ms?: number | null
          engine?: string | null
          fields?: Json
          id?: string
          kind: string
          parser_version: string
          source_type: string
          workspace_id: string
        }
        Update: {
          corrected_fields?: string[]
          created_at?: string
          duration_ms?: number | null
          engine?: string | null
          fields?: Json
          id?: string
          kind?: string
          parser_version?: string
          source_type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "extraction_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      import_presets: {
        Row: {
          created_at: string
          id: string
          mapping: Json
          name: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          mapping: Json
          name: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          mapping?: Json
          name?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_presets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          id: string
          role: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_runs: {
        Row: {
          completed_at: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string | null
          debit_account_id: string | null
          deleted_at: string | null
          draft_state: Json
          id: string
          payment_count: number
          run_number: number
          status: string
          total_paise: number
          up_to_date: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          completed_at?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          debit_account_id?: string | null
          deleted_at?: string | null
          draft_state?: Json
          id?: string
          payment_count?: number
          run_number: number
          status?: string
          total_paise?: number
          up_to_date?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          completed_at?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          debit_account_id?: string | null
          deleted_at?: string | null
          draft_state?: Json
          id?: string
          payment_count?: number
          run_number?: number
          status?: string
          total_paise?: number
          up_to_date?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_runs_debit_account_id_fkey"
            columns: ["debit_account_id"]
            isOneToOne: false
            referencedRelation: "debit_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_events: {
        Row: {
          event_id: string
          id: string
          payload: Json
          provider: string
          received_at: string
          run_payment_id: string | null
        }
        Insert: {
          event_id: string
          id?: string
          payload: Json
          provider: string
          received_at?: string
          run_payment_id?: string | null
        }
        Update: {
          event_id?: string
          id?: string
          payload?: Json
          provider?: string
          received_at?: string
          run_payment_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payout_events_run_payment_id_fkey"
            columns: ["run_payment_id"]
            isOneToOne: false
            referencedRelation: "run_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_providers: {
        Row: {
          account_number: string | null
          created_at: string
          credentials_enc: string | null
          id: string
          last_checked_at: string | null
          mode: string
          provider: string
          status: string
          status_message: string | null
          updated_at: string
          uses_app_demo_keys: boolean
          workspace_id: string
        }
        Insert: {
          account_number?: string | null
          created_at?: string
          credentials_enc?: string | null
          id?: string
          last_checked_at?: string | null
          mode?: string
          provider: string
          status?: string
          status_message?: string | null
          updated_at?: string
          uses_app_demo_keys?: boolean
          workspace_id: string
        }
        Update: {
          account_number?: string | null
          created_at?: string
          credentials_enc?: string | null
          id?: string
          last_checked_at?: string | null
          mode?: string
          provider?: string
          status?: string
          status_message?: string | null
          updated_at?: string
          uses_app_demo_keys?: boolean
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payout_providers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          count: number
          key: string
          window_start: string
        }
        Insert: {
          count?: number
          key: string
          window_start: string
        }
        Update: {
          count?: number
          key?: string
          window_start?: string
        }
        Relationships: []
      }
      run_payment_bills: {
        Row: {
          amount_paise: number
          bill_id: string
          id: string
          run_payment_id: string
          workspace_id: string
        }
        Insert: {
          amount_paise: number
          bill_id: string
          id?: string
          run_payment_id: string
          workspace_id: string
        }
        Update: {
          amount_paise?: number
          bill_id?: string
          id?: string
          run_payment_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "run_payment_bills_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "run_payment_bills_run_payment_id_fkey"
            columns: ["run_payment_id"]
            isOneToOne: false
            referencedRelation: "run_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "run_payment_bills_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      run_payments: {
        Row: {
          amount_paise: number
          bank_detail_id: string | null
          created_at: string
          failure_reason: string | null
          id: string
          method: string
          payment_mode: string | null
          provider: string | null
          provider_payout_id: string | null
          provider_status: string | null
          remarks: string | null
          resolved_at: string | null
          run_id: string
          sent_at: string | null
          status: string
          updated_at: string
          utr: string | null
          vendor_id: string
          warnings: Json
          workspace_id: string
        }
        Insert: {
          amount_paise: number
          bank_detail_id?: string | null
          created_at?: string
          failure_reason?: string | null
          id?: string
          method: string
          payment_mode?: string | null
          provider?: string | null
          provider_payout_id?: string | null
          provider_status?: string | null
          remarks?: string | null
          resolved_at?: string | null
          run_id: string
          sent_at?: string | null
          status?: string
          updated_at?: string
          utr?: string | null
          vendor_id: string
          warnings?: Json
          workspace_id: string
        }
        Update: {
          amount_paise?: number
          bank_detail_id?: string | null
          created_at?: string
          failure_reason?: string | null
          id?: string
          method?: string
          payment_mode?: string | null
          provider?: string | null
          provider_payout_id?: string | null
          provider_status?: string | null
          remarks?: string | null
          resolved_at?: string | null
          run_id?: string
          sent_at?: string | null
          status?: string
          updated_at?: string
          utr?: string | null
          vendor_id?: string
          warnings?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "run_payments_bank_detail_id_fkey"
            columns: ["bank_detail_id"]
            isOneToOne: false
            referencedRelation: "vendor_bank_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "run_payments_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "payment_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "run_payments_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "run_payments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_bank_details: {
        Row: {
          account_holder_name: string | null
          account_last4: string | null
          account_number_enc: string | null
          approved_at: string | null
          bank_name: string | null
          branch: string | null
          created_at: string
          created_by: string | null
          id: string
          ifsc: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source: string
          status: string
          upi_id: string | null
          vendor_id: string
          verification: Json | null
          version: number
          workspace_id: string
        }
        Insert: {
          account_holder_name?: string | null
          account_last4?: string | null
          account_number_enc?: string | null
          approved_at?: string | null
          bank_name?: string | null
          branch?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          ifsc?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string
          status?: string
          upi_id?: string | null
          vendor_id: string
          verification?: Json | null
          version: number
          workspace_id: string
        }
        Update: {
          account_holder_name?: string | null
          account_last4?: string | null
          account_number_enc?: string | null
          approved_at?: string | null
          bank_name?: string | null
          branch?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          ifsc?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string
          status?: string
          upi_id?: string | null
          vendor_id?: string
          verification?: Json | null
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_bank_details_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_bank_details_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_requests: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          lang: string
          token_hash: string
          used_at: string | null
          vendor_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          lang?: string
          token_hash: string
          used_at?: string | null
          vendor_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          lang?: string
          token_hash?: string
          used_at?: string | null
          vendor_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_requests_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_requests_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          created_at: string
          credit_days: number
          deleted_at: string | null
          display_name: string
          email: string | null
          gstin: string | null
          id: string
          legal_name: string | null
          notes: string | null
          phone: string | null
          status: string
          updated_at: string
          verified_at: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          credit_days?: number
          deleted_at?: string | null
          display_name: string
          email?: string | null
          gstin?: string | null
          id?: string
          legal_name?: string | null
          notes?: string | null
          phone?: string | null
          status?: string
          updated_at?: string
          verified_at?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          credit_days?: number
          deleted_at?: string | null
          display_name?: string
          email?: string | null
          gstin?: string | null
          id?: string
          legal_name?: string | null
          notes?: string | null
          phone?: string | null
          status?: string
          updated_at?: string
          verified_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendors_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          address: string | null
          created_at: string
          created_by: string
          deleted_at: string | null
          demo_expires_at: string | null
          email: string | null
          gstin: string | null
          id: string
          is_demo: boolean
          legal_name: string | null
          name: string
          phone: string | null
          settings: Json
          slug: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          demo_expires_at?: string | null
          email?: string | null
          gstin?: string | null
          id?: string
          is_demo?: boolean
          legal_name?: string | null
          name: string
          phone?: string | null
          settings?: Json
          slug: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          demo_expires_at?: string | null
          email?: string | null
          gstin?: string | null
          id?: string
          is_demo?: boolean
          legal_name?: string | null
          name?: string
          phone?: string | null
          settings?: Json
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      hit_rate_limit: {
        Args: { p_key: string; p_max: number; p_window_seconds: number }
        Returns: boolean
      }
      is_workspace_member: { Args: { ws: string }; Returns: boolean }
      is_workspace_owner: { Args: { ws: string }; Returns: boolean }
      review_bank_details: {
        Args: { p_approve: boolean; p_id: string }
        Returns: undefined
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
