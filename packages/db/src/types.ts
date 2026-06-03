export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      agencies: {
        Row: {
          after_hours_emergency_line: string | null;
          business_hours: string | null;
          created_at: string;
          id: string;
          name: string;
          principal_email: string | null;
          status: Database["public"]["Enums"]["agency_status"];
          suburb: string | null;
          updated_at: string;
        };
        Insert: {
          after_hours_emergency_line?: string | null;
          business_hours?: string | null;
          created_at?: string;
          id?: string;
          name: string;
          principal_email?: string | null;
          status?: Database["public"]["Enums"]["agency_status"];
          suburb?: string | null;
          updated_at?: string;
        };
        Update: {
          after_hours_emergency_line?: string | null;
          business_hours?: string | null;
          created_at?: string;
          id?: string;
          name?: string;
          principal_email?: string | null;
          status?: Database["public"]["Enums"]["agency_status"];
          suburb?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      agency_config: {
        Row: {
          active_prompt_version_id: string | null;
          agency_id: string;
          approved_tradies: Json;
          house_rules: string | null;
          lean_notes: Json;
          nominated_repairer: Json | null;
          per_owner_quote_exceptions: Json;
          pm_signoff_default: string | null;
          routine_approval_threshold_cents: number;
          updated_at: string;
          voice_samples: Json;
          written_quote_threshold_cents: number;
        };
        Insert: {
          active_prompt_version_id?: string | null;
          agency_id: string;
          approved_tradies?: Json;
          house_rules?: string | null;
          lean_notes?: Json;
          nominated_repairer?: Json | null;
          per_owner_quote_exceptions?: Json;
          pm_signoff_default?: string | null;
          routine_approval_threshold_cents?: number;
          updated_at?: string;
          voice_samples?: Json;
          written_quote_threshold_cents?: number;
        };
        Update: {
          active_prompt_version_id?: string | null;
          agency_id?: string;
          approved_tradies?: Json;
          house_rules?: string | null;
          lean_notes?: Json;
          nominated_repairer?: Json | null;
          per_owner_quote_exceptions?: Json;
          pm_signoff_default?: string | null;
          routine_approval_threshold_cents?: number;
          updated_at?: string;
          voice_samples?: Json;
          written_quote_threshold_cents?: number;
        };
        Relationships: [
          {
            foreignKeyName: "agency_config_agency_id_fkey";
            columns: ["agency_id"];
            isOneToOne: true;
            referencedRelation: "agencies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fk_agency_config_prompt_version";
            columns: ["active_prompt_version_id"];
            isOneToOne: false;
            referencedRelation: "prompt_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      agency_email_state: {
        Row: {
          agency_id: string;
          last_history_id: number | null;
          mailbox_address: string;
          pubsub_subscription: string | null;
          updated_at: string;
          watch_expires_at: string | null;
        };
        Insert: {
          agency_id: string;
          last_history_id?: number | null;
          mailbox_address: string;
          pubsub_subscription?: string | null;
          updated_at?: string;
          watch_expires_at?: string | null;
        };
        Update: {
          agency_id?: string;
          last_history_id?: number | null;
          mailbox_address?: string;
          pubsub_subscription?: string | null;
          updated_at?: string;
          watch_expires_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "agency_email_state_agency_id_fkey";
            columns: ["agency_id"];
            isOneToOne: true;
            referencedRelation: "agencies";
            referencedColumns: ["id"];
          },
        ];
      };
      agency_gmail_secrets: {
        Row: {
          agency_id: string;
          created_at: string;
          updated_at: string;
          vault_secret_id: string;
        };
        Insert: {
          agency_id: string;
          created_at?: string;
          updated_at?: string;
          vault_secret_id: string;
        };
        Update: {
          agency_id?: string;
          created_at?: string;
          updated_at?: string;
          vault_secret_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agency_gmail_secrets_agency_id_fkey";
            columns: ["agency_id"];
            isOneToOne: true;
            referencedRelation: "agencies";
            referencedColumns: ["id"];
          },
        ];
      };
      agency_users: {
        Row: {
          active: boolean;
          agency_id: string;
          auth_user_id: string | null;
          created_at: string;
          email: string;
          full_name: string;
          gmail_address: string | null;
          gmail_oauth_vault_key: string | null;
          id: string;
          role: Database["public"]["Enums"]["agency_user_role"];
          signature_block: string | null;
        };
        Insert: {
          active?: boolean;
          agency_id: string;
          auth_user_id?: string | null;
          created_at?: string;
          email: string;
          full_name: string;
          gmail_address?: string | null;
          gmail_oauth_vault_key?: string | null;
          id?: string;
          role: Database["public"]["Enums"]["agency_user_role"];
          signature_block?: string | null;
        };
        Update: {
          active?: boolean;
          agency_id?: string;
          auth_user_id?: string | null;
          created_at?: string;
          email?: string;
          full_name?: string;
          gmail_address?: string | null;
          gmail_oauth_vault_key?: string | null;
          id?: string;
          role?: Database["public"]["Enums"]["agency_user_role"];
          signature_block?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "agency_users_agency_id_fkey";
            columns: ["agency_id"];
            isOneToOne: false;
            referencedRelation: "agencies";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_drafts: {
        Row: {
          agency_id: string;
          assigned_pm_id: string | null;
          bounce_detail: string | null;
          bounced_at: string | null;
          category: Database["public"]["Enums"]["draft_category"];
          category_confidence: Database["public"]["Enums"]["confidence_level"];
          created_at: string;
          do_not_send: boolean;
          draft_body: string | null;
          draft_confidence: Database["public"]["Enums"]["confidence_level"];
          draft_source: Database["public"]["Enums"]["draft_source"];
          draft_subject: string | null;
          email_message_id: string | null;
          emergency_landlord_alert: boolean;
          escalation_flag: Database["public"]["Enums"]["escalation_flag"];
          id: string;
          maintenance_job_id: string | null;
          match_confidence: Database["public"]["Enums"]["match_confidence"];
          matched_via: Database["public"]["Enums"]["match_source"] | null;
          model_used: string;
          pm_review_notes: Json;
          priority: Database["public"]["Enums"]["draft_priority"];
          prompt_version_id: string | null;
          property_id: string | null;
          raw_response: Json | null;
          recipient_email: string | null;
          recipient_name: string | null;
          safety_critical: boolean;
          sent_at: string | null;
          sent_gmail_message_id: string | null;
          sequence_run_id: string | null;
          status: Database["public"]["Enums"]["draft_status"];
          tenancy_id: string | null;
          updated_at: string;
        };
        Insert: {
          agency_id: string;
          assigned_pm_id?: string | null;
          bounce_detail?: string | null;
          bounced_at?: string | null;
          category: Database["public"]["Enums"]["draft_category"];
          category_confidence: Database["public"]["Enums"]["confidence_level"];
          created_at?: string;
          do_not_send?: boolean;
          draft_body?: string | null;
          draft_confidence: Database["public"]["Enums"]["confidence_level"];
          draft_source?: Database["public"]["Enums"]["draft_source"];
          draft_subject?: string | null;
          email_message_id?: string | null;
          emergency_landlord_alert?: boolean;
          escalation_flag?: Database["public"]["Enums"]["escalation_flag"];
          id?: string;
          maintenance_job_id?: string | null;
          match_confidence?: Database["public"]["Enums"]["match_confidence"];
          matched_via?: Database["public"]["Enums"]["match_source"] | null;
          model_used: string;
          pm_review_notes?: Json;
          priority: Database["public"]["Enums"]["draft_priority"];
          prompt_version_id?: string | null;
          property_id?: string | null;
          raw_response?: Json | null;
          recipient_email?: string | null;
          recipient_name?: string | null;
          safety_critical?: boolean;
          sent_at?: string | null;
          sent_gmail_message_id?: string | null;
          sequence_run_id?: string | null;
          status?: Database["public"]["Enums"]["draft_status"];
          tenancy_id?: string | null;
          updated_at?: string;
        };
        Update: {
          agency_id?: string;
          assigned_pm_id?: string | null;
          bounce_detail?: string | null;
          bounced_at?: string | null;
          category?: Database["public"]["Enums"]["draft_category"];
          category_confidence?: Database["public"]["Enums"]["confidence_level"];
          created_at?: string;
          do_not_send?: boolean;
          draft_body?: string | null;
          draft_confidence?: Database["public"]["Enums"]["confidence_level"];
          draft_source?: Database["public"]["Enums"]["draft_source"];
          draft_subject?: string | null;
          email_message_id?: string | null;
          emergency_landlord_alert?: boolean;
          escalation_flag?: Database["public"]["Enums"]["escalation_flag"];
          id?: string;
          maintenance_job_id?: string | null;
          match_confidence?: Database["public"]["Enums"]["match_confidence"];
          matched_via?: Database["public"]["Enums"]["match_source"] | null;
          model_used?: string;
          pm_review_notes?: Json;
          priority?: Database["public"]["Enums"]["draft_priority"];
          prompt_version_id?: string | null;
          property_id?: string | null;
          raw_response?: Json | null;
          recipient_email?: string | null;
          recipient_name?: string | null;
          safety_critical?: boolean;
          sent_at?: string | null;
          sent_gmail_message_id?: string | null;
          sequence_run_id?: string | null;
          status?: Database["public"]["Enums"]["draft_status"];
          tenancy_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_drafts_agency_id_fkey";
            columns: ["agency_id"];
            isOneToOne: false;
            referencedRelation: "agencies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_drafts_assigned_pm_id_fkey";
            columns: ["assigned_pm_id"];
            isOneToOne: false;
            referencedRelation: "agency_users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_drafts_email_message_id_fkey";
            columns: ["email_message_id"];
            isOneToOne: true;
            referencedRelation: "email_messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_drafts_maintenance_job_id_fkey";
            columns: ["maintenance_job_id"];
            isOneToOne: false;
            referencedRelation: "maintenance_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_drafts_prompt_version_id_fkey";
            columns: ["prompt_version_id"];
            isOneToOne: false;
            referencedRelation: "prompt_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_drafts_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_drafts_sequence_run_id_fkey";
            columns: ["sequence_run_id"];
            isOneToOne: false;
            referencedRelation: "sequence_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_drafts_tenancy_id_fkey";
            columns: ["tenancy_id"];
            isOneToOne: false;
            referencedRelation: "tenancies";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_log: {
        Row: {
          action: string;
          actor_id: string | null;
          actor_type: Database["public"]["Enums"]["audit_actor_type"];
          agency_id: string;
          created_at: string;
          entity_id: string | null;
          entity_type: string | null;
          id: string;
          metadata: Json;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          actor_type: Database["public"]["Enums"]["audit_actor_type"];
          agency_id: string;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          metadata?: Json;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          actor_type?: Database["public"]["Enums"]["audit_actor_type"];
          agency_id?: string;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          metadata?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "audit_log_agency_id_fkey";
            columns: ["agency_id"];
            isOneToOne: false;
            referencedRelation: "agencies";
            referencedColumns: ["id"];
          },
        ];
      };
      documents: {
        Row: {
          agency_id: string;
          content: string;
          content_type: string;
          created_at: string;
          created_by: string | null;
          fields: Json;
          form_id: string | null;
          id: string;
          property_id: string | null;
          rule_versions: string[];
          status: Database["public"]["Enums"]["document_status"];
          tenancy_id: string | null;
          title: string;
          type: Database["public"]["Enums"]["document_type"];
        };
        Insert: {
          agency_id: string;
          content: string;
          content_type?: string;
          created_at?: string;
          created_by?: string | null;
          fields?: Json;
          form_id?: string | null;
          id?: string;
          property_id?: string | null;
          rule_versions?: string[];
          status?: Database["public"]["Enums"]["document_status"];
          tenancy_id?: string | null;
          title: string;
          type: Database["public"]["Enums"]["document_type"];
        };
        Update: {
          agency_id?: string;
          content?: string;
          content_type?: string;
          created_at?: string;
          created_by?: string | null;
          fields?: Json;
          form_id?: string | null;
          id?: string;
          property_id?: string | null;
          rule_versions?: string[];
          status?: Database["public"]["Enums"]["document_status"];
          tenancy_id?: string | null;
          title?: string;
          type?: Database["public"]["Enums"]["document_type"];
        };
        Relationships: [
          {
            foreignKeyName: "documents_agency_id_fkey";
            columns: ["agency_id"];
            isOneToOne: false;
            referencedRelation: "agencies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "documents_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "agency_users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "documents_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "documents_tenancy_id_fkey";
            columns: ["tenancy_id"];
            isOneToOne: false;
            referencedRelation: "tenancies";
            referencedColumns: ["id"];
          },
        ];
      };
      draft_edits: {
        Row: {
          agency_id: string;
          draft_id: string;
          edited_at: string;
          edited_by: string;
          id: string;
          new_body: string | null;
          new_subject: string | null;
          previous_body: string | null;
          previous_subject: string | null;
        };
        Insert: {
          agency_id: string;
          draft_id: string;
          edited_at?: string;
          edited_by: string;
          id?: string;
          new_body?: string | null;
          new_subject?: string | null;
          previous_body?: string | null;
          previous_subject?: string | null;
        };
        Update: {
          agency_id?: string;
          draft_id?: string;
          edited_at?: string;
          edited_by?: string;
          id?: string;
          new_body?: string | null;
          new_subject?: string | null;
          previous_body?: string | null;
          previous_subject?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "draft_edits_agency_id_fkey";
            columns: ["agency_id"];
            isOneToOne: false;
            referencedRelation: "agencies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "draft_edits_draft_id_fkey";
            columns: ["draft_id"];
            isOneToOne: false;
            referencedRelation: "ai_drafts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "draft_edits_edited_by_fkey";
            columns: ["edited_by"];
            isOneToOne: false;
            referencedRelation: "agency_users";
            referencedColumns: ["id"];
          },
        ];
      };
      email_messages: {
        Row: {
          agency_id: string;
          attachments: Json;
          bcc_addresses: Json;
          body_html: string | null;
          body_plain: string | null;
          bounce_of_email_message_id: string | null;
          cc_addresses: Json;
          created_at: string;
          direction: Database["public"]["Enums"]["email_direction"];
          from_address: string;
          from_name: string | null;
          gmail_history_id: number | null;
          gmail_message_id: string;
          id: string;
          in_reply_to: string | null;
          is_bounce: boolean;
          message_id_header: string | null;
          received_at: string | null;
          references_headers: string[] | null;
          sent_at: string | null;
          subject: string | null;
          thread_id: string;
          to_addresses: Json;
        };
        Insert: {
          agency_id: string;
          attachments?: Json;
          bcc_addresses?: Json;
          body_html?: string | null;
          body_plain?: string | null;
          bounce_of_email_message_id?: string | null;
          cc_addresses?: Json;
          created_at?: string;
          direction: Database["public"]["Enums"]["email_direction"];
          from_address: string;
          from_name?: string | null;
          gmail_history_id?: number | null;
          gmail_message_id: string;
          id?: string;
          in_reply_to?: string | null;
          is_bounce?: boolean;
          message_id_header?: string | null;
          received_at?: string | null;
          references_headers?: string[] | null;
          sent_at?: string | null;
          subject?: string | null;
          thread_id: string;
          to_addresses?: Json;
        };
        Update: {
          agency_id?: string;
          attachments?: Json;
          bcc_addresses?: Json;
          body_html?: string | null;
          body_plain?: string | null;
          bounce_of_email_message_id?: string | null;
          cc_addresses?: Json;
          created_at?: string;
          direction?: Database["public"]["Enums"]["email_direction"];
          from_address?: string;
          from_name?: string | null;
          gmail_history_id?: number | null;
          gmail_message_id?: string;
          id?: string;
          in_reply_to?: string | null;
          is_bounce?: boolean;
          message_id_header?: string | null;
          received_at?: string | null;
          references_headers?: string[] | null;
          sent_at?: string | null;
          subject?: string | null;
          thread_id?: string;
          to_addresses?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "email_messages_agency_id_fkey";
            columns: ["agency_id"];
            isOneToOne: false;
            referencedRelation: "agencies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "email_messages_bounce_of_email_message_id_fkey";
            columns: ["bounce_of_email_message_id"];
            isOneToOne: false;
            referencedRelation: "email_messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "email_messages_thread_id_fkey";
            columns: ["thread_id"];
            isOneToOne: false;
            referencedRelation: "email_threads";
            referencedColumns: ["id"];
          },
        ];
      };
      email_threads: {
        Row: {
          agency_id: string;
          created_at: string;
          gmail_thread_id: string;
          id: string;
          last_message_at: string | null;
          participants: Json;
          property_id: string | null;
          property_match_confidence: Database["public"]["Enums"]["match_confidence"];
          subject: string | null;
        };
        Insert: {
          agency_id: string;
          created_at?: string;
          gmail_thread_id: string;
          id?: string;
          last_message_at?: string | null;
          participants?: Json;
          property_id?: string | null;
          property_match_confidence?: Database["public"]["Enums"]["match_confidence"];
          subject?: string | null;
        };
        Update: {
          agency_id?: string;
          created_at?: string;
          gmail_thread_id?: string;
          id?: string;
          last_message_at?: string | null;
          participants?: Json;
          property_id?: string | null;
          property_match_confidence?: Database["public"]["Enums"]["match_confidence"];
          subject?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "email_threads_agency_id_fkey";
            columns: ["agency_id"];
            isOneToOne: false;
            referencedRelation: "agencies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "email_threads_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
        ];
      };
      maintenance_jobs: {
        Row: {
          agency_id: string;
          approved_spend_cents: number | null;
          classification: Database["public"]["Enums"]["maintenance_classification"];
          created_at: string;
          created_by: string | null;
          id: string;
          issue: string;
          notes: string | null;
          owner_approval_state: Database["public"]["Enums"]["maintenance_owner_approval"];
          property_id: string | null;
          quotes: Json;
          scheduled_for: string | null;
          source_draft_id: string | null;
          source_email_message_id: string | null;
          state: Database["public"]["Enums"]["maintenance_job_state"];
          tenancy_id: string | null;
          trade: string | null;
          updated_at: string;
        };
        Insert: {
          agency_id: string;
          approved_spend_cents?: number | null;
          classification?: Database["public"]["Enums"]["maintenance_classification"];
          created_at?: string;
          created_by?: string | null;
          id?: string;
          issue: string;
          notes?: string | null;
          owner_approval_state?: Database["public"]["Enums"]["maintenance_owner_approval"];
          property_id?: string | null;
          quotes?: Json;
          scheduled_for?: string | null;
          source_draft_id?: string | null;
          source_email_message_id?: string | null;
          state?: Database["public"]["Enums"]["maintenance_job_state"];
          tenancy_id?: string | null;
          trade?: string | null;
          updated_at?: string;
        };
        Update: {
          agency_id?: string;
          approved_spend_cents?: number | null;
          classification?: Database["public"]["Enums"]["maintenance_classification"];
          created_at?: string;
          created_by?: string | null;
          id?: string;
          issue?: string;
          notes?: string | null;
          owner_approval_state?: Database["public"]["Enums"]["maintenance_owner_approval"];
          property_id?: string | null;
          quotes?: Json;
          scheduled_for?: string | null;
          source_draft_id?: string | null;
          source_email_message_id?: string | null;
          state?: Database["public"]["Enums"]["maintenance_job_state"];
          tenancy_id?: string | null;
          trade?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "maintenance_jobs_agency_id_fkey";
            columns: ["agency_id"];
            isOneToOne: false;
            referencedRelation: "agencies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "maintenance_jobs_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "agency_users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "maintenance_jobs_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "maintenance_jobs_source_draft_id_fkey";
            columns: ["source_draft_id"];
            isOneToOne: false;
            referencedRelation: "ai_drafts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "maintenance_jobs_source_email_message_id_fkey";
            columns: ["source_email_message_id"];
            isOneToOne: false;
            referencedRelation: "email_messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "maintenance_jobs_tenancy_id_fkey";
            columns: ["tenancy_id"];
            isOneToOne: false;
            referencedRelation: "tenancies";
            referencedColumns: ["id"];
          },
        ];
      };
      model_calls: {
        Row: {
          agency_id: string;
          created_at: string;
          draft_id: string | null;
          duration_ms: number | null;
          id: string;
          input_tokens: number | null;
          model: string;
          output_tokens: number | null;
          prompt_version_id: string | null;
          request: Json;
          response: Json;
        };
        Insert: {
          agency_id: string;
          created_at?: string;
          draft_id?: string | null;
          duration_ms?: number | null;
          id?: string;
          input_tokens?: number | null;
          model: string;
          output_tokens?: number | null;
          prompt_version_id?: string | null;
          request: Json;
          response: Json;
        };
        Update: {
          agency_id?: string;
          created_at?: string;
          draft_id?: string | null;
          duration_ms?: number | null;
          id?: string;
          input_tokens?: number | null;
          model?: string;
          output_tokens?: number | null;
          prompt_version_id?: string | null;
          request?: Json;
          response?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "model_calls_agency_id_fkey";
            columns: ["agency_id"];
            isOneToOne: false;
            referencedRelation: "agencies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "model_calls_draft_id_fkey";
            columns: ["draft_id"];
            isOneToOne: false;
            referencedRelation: "ai_drafts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "model_calls_prompt_version_id_fkey";
            columns: ["prompt_version_id"];
            isOneToOne: false;
            referencedRelation: "prompt_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      notification_log: {
        Row: {
          agency_id: string;
          body: string | null;
          channel: Database["public"]["Enums"]["notification_channel"];
          created_at: string;
          id: string;
          owner_id: string | null;
          profile_applied: Database["public"]["Enums"]["owner_notification_profile"] | null;
          property_id: string | null;
          provider_message_id: string | null;
          recipient: string;
          scheduled_for: string | null;
          sent_at: string | null;
          status: Database["public"]["Enums"]["notification_status"];
          suppression_reason: string | null;
          triggered_by_draft_id: string | null;
        };
        Insert: {
          agency_id: string;
          body?: string | null;
          channel: Database["public"]["Enums"]["notification_channel"];
          created_at?: string;
          id?: string;
          owner_id?: string | null;
          profile_applied?: Database["public"]["Enums"]["owner_notification_profile"] | null;
          property_id?: string | null;
          provider_message_id?: string | null;
          recipient: string;
          scheduled_for?: string | null;
          sent_at?: string | null;
          status: Database["public"]["Enums"]["notification_status"];
          suppression_reason?: string | null;
          triggered_by_draft_id?: string | null;
        };
        Update: {
          agency_id?: string;
          body?: string | null;
          channel?: Database["public"]["Enums"]["notification_channel"];
          created_at?: string;
          id?: string;
          owner_id?: string | null;
          profile_applied?: Database["public"]["Enums"]["owner_notification_profile"] | null;
          property_id?: string | null;
          provider_message_id?: string | null;
          recipient?: string;
          scheduled_for?: string | null;
          sent_at?: string | null;
          status?: Database["public"]["Enums"]["notification_status"];
          suppression_reason?: string | null;
          triggered_by_draft_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "notification_log_agency_id_fkey";
            columns: ["agency_id"];
            isOneToOne: false;
            referencedRelation: "agencies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notification_log_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "owners";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notification_log_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notification_log_triggered_by_draft_id_fkey";
            columns: ["triggered_by_draft_id"];
            isOneToOne: false;
            referencedRelation: "ai_drafts";
            referencedColumns: ["id"];
          },
        ];
      };
      owner_notification_preferences: {
        Row: {
          agency_id: string;
          created_at: string;
          id: string;
          notes: string | null;
          notification_channels: Json;
          owner_id: string | null;
          profile: Database["public"]["Enums"]["owner_notification_profile"];
          property_id: string | null;
        };
        Insert: {
          agency_id: string;
          created_at?: string;
          id?: string;
          notes?: string | null;
          notification_channels?: Json;
          owner_id?: string | null;
          profile?: Database["public"]["Enums"]["owner_notification_profile"];
          property_id?: string | null;
        };
        Update: {
          agency_id?: string;
          created_at?: string;
          id?: string;
          notes?: string | null;
          notification_channels?: Json;
          owner_id?: string | null;
          profile?: Database["public"]["Enums"]["owner_notification_profile"];
          property_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "owner_notification_preferences_agency_id_fkey";
            columns: ["agency_id"];
            isOneToOne: false;
            referencedRelation: "agencies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "owner_notification_preferences_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "owners";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "owner_notification_preferences_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
        ];
      };
      owners: {
        Row: {
          agency_id: string;
          archived_at: string | null;
          created_at: string;
          email: string | null;
          full_name: string;
          id: string;
          notes: string | null;
          phone: string | null;
        };
        Insert: {
          agency_id: string;
          archived_at?: string | null;
          created_at?: string;
          email?: string | null;
          full_name: string;
          id?: string;
          notes?: string | null;
          phone?: string | null;
        };
        Update: {
          agency_id?: string;
          archived_at?: string | null;
          created_at?: string;
          email?: string | null;
          full_name?: string;
          id?: string;
          notes?: string | null;
          phone?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "owners_agency_id_fkey";
            columns: ["agency_id"];
            isOneToOne: false;
            referencedRelation: "agencies";
            referencedColumns: ["id"];
          },
        ];
      };
      prompt_versions: {
        Row: {
          active_from: string;
          active_to: string | null;
          agency_id: string | null;
          content: string;
          created_at: string;
          created_by: string | null;
          id: string;
          notes: string | null;
          version: string;
        };
        Insert: {
          active_from?: string;
          active_to?: string | null;
          agency_id?: string | null;
          content: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          notes?: string | null;
          version: string;
        };
        Update: {
          active_from?: string;
          active_to?: string | null;
          agency_id?: string | null;
          content?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          notes?: string | null;
          version?: string;
        };
        Relationships: [
          {
            foreignKeyName: "prompt_versions_agency_id_fkey";
            columns: ["agency_id"];
            isOneToOne: false;
            referencedRelation: "agencies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "prompt_versions_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "agency_users";
            referencedColumns: ["id"];
          },
        ];
      };
      properties: {
        Row: {
          address_line1: string;
          address_line2: string | null;
          agency_id: string;
          archived_at: string | null;
          body_corporate_agent: string | null;
          body_corporate_managed: boolean | null;
          created_at: string;
          id: string;
          managing_pm_id: string | null;
          notes: string | null;
          owner_id: string | null;
          postcode: string | null;
          state: string;
          suburb: string | null;
        };
        Insert: {
          address_line1: string;
          address_line2?: string | null;
          agency_id: string;
          archived_at?: string | null;
          body_corporate_agent?: string | null;
          body_corporate_managed?: boolean | null;
          created_at?: string;
          id?: string;
          managing_pm_id?: string | null;
          notes?: string | null;
          owner_id?: string | null;
          postcode?: string | null;
          state?: string;
          suburb?: string | null;
        };
        Update: {
          address_line1?: string;
          address_line2?: string | null;
          agency_id?: string;
          archived_at?: string | null;
          body_corporate_agent?: string | null;
          body_corporate_managed?: boolean | null;
          created_at?: string;
          id?: string;
          managing_pm_id?: string | null;
          notes?: string | null;
          owner_id?: string | null;
          postcode?: string | null;
          state?: string;
          suburb?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "properties_agency_id_fkey";
            columns: ["agency_id"];
            isOneToOne: false;
            referencedRelation: "agencies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "properties_managing_pm_id_fkey";
            columns: ["managing_pm_id"];
            isOneToOne: false;
            referencedRelation: "agency_users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "properties_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "owners";
            referencedColumns: ["id"];
          },
        ];
      };
      regulatory_alerts: {
        Row: {
          affected_modules: string[];
          change_summary: string | null;
          client_notice_sent: boolean;
          content_hash: string;
          created_at: string;
          detected_at: string;
          effective_date: string | null;
          id: string;
          operator_review_state: Database["public"]["Enums"]["regulatory_alert_state"];
          proposed_changes: Json;
          reviewed_at: string | null;
          reviewed_by: string | null;
          source: string;
          source_url: string;
        };
        Insert: {
          affected_modules?: string[];
          change_summary?: string | null;
          client_notice_sent?: boolean;
          content_hash: string;
          created_at?: string;
          detected_at?: string;
          effective_date?: string | null;
          id?: string;
          operator_review_state?: Database["public"]["Enums"]["regulatory_alert_state"];
          proposed_changes?: Json;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          source: string;
          source_url: string;
        };
        Update: {
          affected_modules?: string[];
          change_summary?: string | null;
          client_notice_sent?: boolean;
          content_hash?: string;
          created_at?: string;
          detected_at?: string;
          effective_date?: string | null;
          id?: string;
          operator_review_state?: Database["public"]["Enums"]["regulatory_alert_state"];
          proposed_changes?: Json;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          source?: string;
          source_url?: string;
        };
        Relationships: [
          {
            foreignKeyName: "regulatory_alerts_reviewed_by_fkey";
            columns: ["reviewed_by"];
            isOneToOne: false;
            referencedRelation: "agency_users";
            referencedColumns: ["id"];
          },
        ];
      };
      regulatory_rules: {
        Row: {
          created_at: string;
          effective_from: string | null;
          effective_to: string | null;
          id: string;
          jurisdiction: string;
          key: string;
          needs_human_confirmation: boolean;
          notes: string | null;
          source_note: string;
          source_url: string | null;
          value: Json | null;
          version: string;
        };
        Insert: {
          created_at?: string;
          effective_from?: string | null;
          effective_to?: string | null;
          id?: string;
          jurisdiction?: string;
          key: string;
          needs_human_confirmation?: boolean;
          notes?: string | null;
          source_note: string;
          source_url?: string | null;
          value?: Json | null;
          version: string;
        };
        Update: {
          created_at?: string;
          effective_from?: string | null;
          effective_to?: string | null;
          id?: string;
          jurisdiction?: string;
          key?: string;
          needs_human_confirmation?: boolean;
          notes?: string | null;
          source_note?: string;
          source_url?: string | null;
          value?: Json | null;
          version?: string;
        };
        Relationships: [];
      };
      sequence_runs: {
        Row: {
          agency_id: string;
          created_at: string;
          dedupe_key: string;
          history: Json;
          id: string;
          next_action_at: string | null;
          owner_id: string | null;
          property_id: string | null;
          sequence_id: string | null;
          state: Database["public"]["Enums"]["sequence_run_state"];
          step: number;
          tenancy_id: string | null;
          type: Database["public"]["Enums"]["sequence_type"];
          updated_at: string;
        };
        Insert: {
          agency_id: string;
          created_at?: string;
          dedupe_key: string;
          history?: Json;
          id?: string;
          next_action_at?: string | null;
          owner_id?: string | null;
          property_id?: string | null;
          sequence_id?: string | null;
          state?: Database["public"]["Enums"]["sequence_run_state"];
          step?: number;
          tenancy_id?: string | null;
          type: Database["public"]["Enums"]["sequence_type"];
          updated_at?: string;
        };
        Update: {
          agency_id?: string;
          created_at?: string;
          dedupe_key?: string;
          history?: Json;
          id?: string;
          next_action_at?: string | null;
          owner_id?: string | null;
          property_id?: string | null;
          sequence_id?: string | null;
          state?: Database["public"]["Enums"]["sequence_run_state"];
          step?: number;
          tenancy_id?: string | null;
          type?: Database["public"]["Enums"]["sequence_type"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sequence_runs_agency_id_fkey";
            columns: ["agency_id"];
            isOneToOne: false;
            referencedRelation: "agencies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sequence_runs_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "owners";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sequence_runs_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sequence_runs_sequence_id_fkey";
            columns: ["sequence_id"];
            isOneToOne: false;
            referencedRelation: "sequences";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sequence_runs_tenancy_id_fkey";
            columns: ["tenancy_id"];
            isOneToOne: false;
            referencedRelation: "tenancies";
            referencedColumns: ["id"];
          },
        ];
      };
      sequences: {
        Row: {
          agency_id: string;
          config: Json;
          created_at: string;
          id: string;
          is_active: boolean;
          type: Database["public"]["Enums"]["sequence_type"];
          updated_at: string;
        };
        Insert: {
          agency_id: string;
          config?: Json;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          type: Database["public"]["Enums"]["sequence_type"];
          updated_at?: string;
        };
        Update: {
          agency_id?: string;
          config?: Json;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          type?: Database["public"]["Enums"]["sequence_type"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sequences_agency_id_fkey";
            columns: ["agency_id"];
            isOneToOne: false;
            referencedRelation: "agencies";
            referencedColumns: ["id"];
          },
        ];
      };
      tenancies: {
        Row: {
          agency_id: string;
          agreement_type: Database["public"]["Enums"]["agreement_type"] | null;
          arrears_since: string | null;
          bond_amount_cents: number | null;
          bond_rta_reference: string | null;
          created_at: string;
          end_date: string | null;
          id: string;
          last_rent_increase_date: string | null;
          last_routine_inspection_date: string | null;
          property_id: string;
          rent_amount_cents: number | null;
          rent_frequency: Database["public"]["Enums"]["rent_frequency"] | null;
          start_date: string | null;
          status: Database["public"]["Enums"]["tenancy_status"];
        };
        Insert: {
          agency_id: string;
          agreement_type?: Database["public"]["Enums"]["agreement_type"] | null;
          arrears_since?: string | null;
          bond_amount_cents?: number | null;
          bond_rta_reference?: string | null;
          created_at?: string;
          end_date?: string | null;
          id?: string;
          last_rent_increase_date?: string | null;
          last_routine_inspection_date?: string | null;
          property_id: string;
          rent_amount_cents?: number | null;
          rent_frequency?: Database["public"]["Enums"]["rent_frequency"] | null;
          start_date?: string | null;
          status?: Database["public"]["Enums"]["tenancy_status"];
        };
        Update: {
          agency_id?: string;
          agreement_type?: Database["public"]["Enums"]["agreement_type"] | null;
          arrears_since?: string | null;
          bond_amount_cents?: number | null;
          bond_rta_reference?: string | null;
          created_at?: string;
          end_date?: string | null;
          id?: string;
          last_rent_increase_date?: string | null;
          last_routine_inspection_date?: string | null;
          property_id?: string;
          rent_amount_cents?: number | null;
          rent_frequency?: Database["public"]["Enums"]["rent_frequency"] | null;
          start_date?: string | null;
          status?: Database["public"]["Enums"]["tenancy_status"];
        };
        Relationships: [
          {
            foreignKeyName: "tenancies_agency_id_fkey";
            columns: ["agency_id"];
            isOneToOne: false;
            referencedRelation: "agencies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tenancies_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
        ];
      };
      tenants: {
        Row: {
          agency_id: string;
          created_at: string;
          email: string | null;
          full_name: string;
          id: string;
          is_primary: boolean | null;
          notes: string | null;
          phone: string | null;
          tenancy_id: string | null;
        };
        Insert: {
          agency_id: string;
          created_at?: string;
          email?: string | null;
          full_name: string;
          id?: string;
          is_primary?: boolean | null;
          notes?: string | null;
          phone?: string | null;
          tenancy_id?: string | null;
        };
        Update: {
          agency_id?: string;
          created_at?: string;
          email?: string | null;
          full_name?: string;
          id?: string;
          is_primary?: boolean | null;
          notes?: string | null;
          phone?: string | null;
          tenancy_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "tenants_agency_id_fkey";
            columns: ["agency_id"];
            isOneToOne: false;
            referencedRelation: "agencies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tenants_tenancy_id_fkey";
            columns: ["tenancy_id"];
            isOneToOne: false;
            referencedRelation: "tenancies";
            referencedColumns: ["id"];
          },
        ];
      };
      weekly_digests: {
        Row: {
          acted_at: string | null;
          acted_by: string | null;
          agency_id: string;
          created_at: string;
          id: string;
          signals: Json;
          status: Database["public"]["Enums"]["weekly_digest_status"];
          suggested_directions: Json;
          week_start_date: string;
        };
        Insert: {
          acted_at?: string | null;
          acted_by?: string | null;
          agency_id: string;
          created_at?: string;
          id?: string;
          signals?: Json;
          status?: Database["public"]["Enums"]["weekly_digest_status"];
          suggested_directions?: Json;
          week_start_date: string;
        };
        Update: {
          acted_at?: string | null;
          acted_by?: string | null;
          agency_id?: string;
          created_at?: string;
          id?: string;
          signals?: Json;
          status?: Database["public"]["Enums"]["weekly_digest_status"];
          suggested_directions?: Json;
          week_start_date?: string;
        };
        Relationships: [
          {
            foreignKeyName: "weekly_digests_acted_by_fkey";
            columns: ["acted_by"];
            isOneToOne: false;
            referencedRelation: "agency_users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "weekly_digests_agency_id_fkey";
            columns: ["agency_id"];
            isOneToOne: false;
            referencedRelation: "agencies";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      delete_gmail_refresh_token: {
        Args: { p_agency_id: string };
        Returns: undefined;
      };
      get_gmail_refresh_token: {
        Args: { p_agency_id: string };
        Returns: string;
      };
      store_gmail_refresh_token: {
        Args: { p_agency_id: string; p_token: string };
        Returns: undefined;
      };
    };
    Enums: {
      agency_status: "active" | "suspended" | "archived";
      agency_user_role: "pm" | "principal" | "admin";
      agreement_type: "fixed" | "periodic";
      audit_actor_type: "user" | "system" | "ai";
      confidence_level: "HIGH" | "MEDIUM" | "LOW";
      document_status: "generated" | "sent" | "void";
      document_type:
        | "entry_notice"
        | "rent_increase_notice"
        | "notice_to_remedy_breach"
        | "notice_to_leave";
      draft_category: "MAINTENANCE" | "RENT" | "LEASE" | "COMPLAINT" | "ADMIN" | "OTHER";
      draft_priority: "STANDARD" | "PRIORITY" | "EMERGENCY_ALERT";
      draft_source: "inbound_reply" | "sequence" | "maintenance";
      draft_status: "pending" | "edited" | "sent" | "discarded" | "do_not_send";
      email_direction: "inbound" | "outbound";
      escalation_flag: "NONE" | "WELFARE" | "LEGAL" | "REPUTATIONAL" | "INCIDENT";
      maintenance_classification: "emergency" | "routine" | "other";
      maintenance_job_state:
        | "new"
        | "quoting"
        | "awaiting_owner_approval"
        | "approved"
        | "scheduling"
        | "scheduled"
        | "completed"
        | "cancelled";
      maintenance_owner_approval: "not_required" | "pending" | "approved" | "declined";
      match_confidence: "high" | "medium" | "low" | "none";
      match_source:
        | "exact_email"
        | "thread_continuity"
        | "subject_fuzzy"
        | "body_scan"
        | "fallback";
      notification_channel: "sms" | "email" | "call" | "digest";
      notification_status: "queued" | "sent" | "failed" | "suppressed";
      owner_notification_profile:
        | "immediate"
        | "business_hours"
        | "safety_critical_only"
        | "email_only"
        | "pm_proxy";
      regulatory_alert_state: "open" | "approved" | "dismissed";
      rent_frequency: "weekly" | "fortnightly" | "monthly";
      sequence_run_state:
        | "pending"
        | "active"
        | "awaiting_response"
        | "completed"
        | "cancelled"
        | "escalated";
      sequence_type: "arrears" | "lease_renewal" | "inspection" | "owner_update";
      tenancy_status: "draft" | "active" | "ending" | "ended";
      weekly_digest_status: "open" | "acted" | "dismissed";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      agency_status: ["active", "suspended", "archived"],
      agency_user_role: ["pm", "principal", "admin"],
      agreement_type: ["fixed", "periodic"],
      audit_actor_type: ["user", "system", "ai"],
      confidence_level: ["HIGH", "MEDIUM", "LOW"],
      document_status: ["generated", "sent", "void"],
      document_type: [
        "entry_notice",
        "rent_increase_notice",
        "notice_to_remedy_breach",
        "notice_to_leave",
      ],
      draft_category: ["MAINTENANCE", "RENT", "LEASE", "COMPLAINT", "ADMIN", "OTHER"],
      draft_priority: ["STANDARD", "PRIORITY", "EMERGENCY_ALERT"],
      draft_source: ["inbound_reply", "sequence", "maintenance"],
      draft_status: ["pending", "edited", "sent", "discarded", "do_not_send"],
      email_direction: ["inbound", "outbound"],
      escalation_flag: ["NONE", "WELFARE", "LEGAL", "REPUTATIONAL", "INCIDENT"],
      maintenance_classification: ["emergency", "routine", "other"],
      maintenance_job_state: [
        "new",
        "quoting",
        "awaiting_owner_approval",
        "approved",
        "scheduling",
        "scheduled",
        "completed",
        "cancelled",
      ],
      maintenance_owner_approval: ["not_required", "pending", "approved", "declined"],
      match_confidence: ["high", "medium", "low", "none"],
      match_source: ["exact_email", "thread_continuity", "subject_fuzzy", "body_scan", "fallback"],
      notification_channel: ["sms", "email", "call", "digest"],
      notification_status: ["queued", "sent", "failed", "suppressed"],
      owner_notification_profile: [
        "immediate",
        "business_hours",
        "safety_critical_only",
        "email_only",
        "pm_proxy",
      ],
      regulatory_alert_state: ["open", "approved", "dismissed"],
      rent_frequency: ["weekly", "fortnightly", "monthly"],
      sequence_run_state: [
        "pending",
        "active",
        "awaiting_response",
        "completed",
        "cancelled",
        "escalated",
      ],
      sequence_type: ["arrears", "lease_renewal", "inspection", "owner_update"],
      tenancy_status: ["draft", "active", "ending", "ended"],
      weekly_digest_status: ["open", "acted", "dismissed"],
    },
  },
} as const;
