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
      appointments: {
        Row: {
          clinician_id: string | null
          created_at: string
          created_by: string | null
          id: string
          patient_id: string
          reason: string | null
          scheduled_at: string
          service_key: string
          status: string
        }
        Insert: {
          clinician_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          patient_id: string
          reason?: string | null
          scheduled_at: string
          service_key: string
          status?: string
        }
        Update: {
          clinician_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          patient_id?: string
          reason?: string | null
          scheduled_at?: string
          service_key?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_clinician_id_fkey"
            columns: ["clinician_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_service_key_fkey"
            columns: ["service_key"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["key"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          changed_at: string
          diff: Json | null
          id: number
          record_id: string | null
          table_name: string
          user_id: string | null
        }
        Insert: {
          action: string
          changed_at?: string
          diff?: Json | null
          id?: number
          record_id?: string | null
          table_name: string
          user_id?: string | null
        }
        Update: {
          action?: string
          changed_at?: string
          diff?: Json | null
          id?: number
          record_id?: string | null
          table_name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      consultations: {
        Row: {
          chief_complaint: string | null
          clinician_id: string | null
          created_at: string
          examination: string | null
          follow_up_date: string | null
          follow_up_plan: string | null
          history: string | null
          id: string
          past_history: string | null
          patient_id: string
          service_key: string
          template_data: Json
          treatment_notes: string | null
          updated_at: string
          visit_id: string
        }
        Insert: {
          chief_complaint?: string | null
          clinician_id?: string | null
          created_at?: string
          examination?: string | null
          follow_up_date?: string | null
          follow_up_plan?: string | null
          history?: string | null
          id?: string
          past_history?: string | null
          patient_id: string
          service_key: string
          template_data?: Json
          treatment_notes?: string | null
          updated_at?: string
          visit_id: string
        }
        Update: {
          chief_complaint?: string | null
          clinician_id?: string | null
          created_at?: string
          examination?: string | null
          follow_up_date?: string | null
          follow_up_plan?: string | null
          history?: string | null
          id?: string
          past_history?: string | null
          patient_id?: string
          service_key?: string
          template_data?: Json
          treatment_notes?: string | null
          updated_at?: string
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultations_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultations_service_key_fkey"
            columns: ["service_key"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "consultations_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: true
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      diagnoses: {
        Row: {
          created_at: string
          created_by: string | null
          description: string
          diagnosis_type: string
          icd10_code: string | null
          id: string
          patient_id: string
          visit_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description: string
          diagnosis_type?: string
          icd10_code?: string | null
          id?: string
          patient_id: string
          visit_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string
          diagnosis_type?: string
          icd10_code?: string | null
          id?: string
          patient_id?: string
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "diagnoses_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diagnoses_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_request_items: {
        Row: {
          abnormal_flag: string | null
          collected_at: string | null
          collected_by: string | null
          id: string
          lab_request_id: string
          lab_test_id: string
          processed_at: string | null
          processed_by: string | null
          rejection_reason: string | null
          result_comment: string | null
          result_value: string | null
          resulted_at: string | null
          resulted_by: string | null
          specimen_id: string | null
          status: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          abnormal_flag?: string | null
          collected_at?: string | null
          collected_by?: string | null
          id?: string
          lab_request_id: string
          lab_test_id: string
          processed_at?: string | null
          processed_by?: string | null
          rejection_reason?: string | null
          result_comment?: string | null
          result_value?: string | null
          resulted_at?: string | null
          resulted_by?: string | null
          specimen_id?: string | null
          status?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          abnormal_flag?: string | null
          collected_at?: string | null
          collected_by?: string | null
          id?: string
          lab_request_id?: string
          lab_test_id?: string
          processed_at?: string | null
          processed_by?: string | null
          rejection_reason?: string | null
          result_comment?: string | null
          result_value?: string | null
          resulted_at?: string | null
          resulted_by?: string | null
          specimen_id?: string | null
          status?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lab_request_items_lab_request_id_fkey"
            columns: ["lab_request_id"]
            isOneToOne: false
            referencedRelation: "lab_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_request_items_lab_test_id_fkey"
            columns: ["lab_test_id"]
            isOneToOne: false
            referencedRelation: "lab_tests"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_requests: {
        Row: {
          clinical_notes: string | null
          created_at: string
          id: string
          patient_id: string
          priority: string
          request_number: string | null
          requested_by: string | null
          status: string
          visit_id: string
        }
        Insert: {
          clinical_notes?: string | null
          created_at?: string
          id?: string
          patient_id: string
          priority?: string
          request_number?: string | null
          requested_by?: string | null
          status?: string
          visit_id: string
        }
        Update: {
          clinical_notes?: string | null
          created_at?: string
          id?: string
          patient_id?: string
          priority?: string
          request_number?: string | null
          requested_by?: string | null
          status?: string
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lab_requests_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_requests_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_tests: {
        Row: {
          active: boolean
          code: string
          display_order: number
          id: string
          name: string
          panel: string | null
          ref_high: number | null
          ref_low: number | null
          ref_text: string | null
          result_type: string
          section: string
          specimen_type: string | null
          unit: string | null
        }
        Insert: {
          active?: boolean
          code: string
          display_order?: number
          id?: string
          name: string
          panel?: string | null
          ref_high?: number | null
          ref_low?: number | null
          ref_text?: string | null
          result_type?: string
          section: string
          specimen_type?: string | null
          unit?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          display_order?: number
          id?: string
          name?: string
          panel?: string | null
          ref_high?: number | null
          ref_low?: number | null
          ref_text?: string | null
          result_type?: string
          section?: string
          specimen_type?: string | null
          unit?: string | null
        }
        Relationships: []
      }
      patients: {
        Row: {
          address: string | null
          allergies: string | null
          created_at: string
          created_by: string | null
          date_of_birth: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          first_name: string
          id: string
          kebele: string | null
          last_name: string
          middle_name: string | null
          mrn: string | null
          phone: string | null
          sex: string
          updated_at: string
          woreda: string | null
        }
        Insert: {
          address?: string | null
          allergies?: string | null
          created_at?: string
          created_by?: string | null
          date_of_birth?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          first_name: string
          id?: string
          kebele?: string | null
          last_name: string
          middle_name?: string | null
          mrn?: string | null
          phone?: string | null
          sex: string
          updated_at?: string
          woreda?: string | null
        }
        Update: {
          address?: string | null
          allergies?: string | null
          created_at?: string
          created_by?: string | null
          date_of_birth?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          first_name?: string
          id?: string
          kebele?: string | null
          last_name?: string
          middle_name?: string | null
          mrn?: string | null
          phone?: string | null
          sex?: string
          updated_at?: string
          woreda?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active: boolean
          can_self_verify: boolean
          created_at: string
          full_name: string
          id: string
          phone: string | null
        }
        Insert: {
          active?: boolean
          can_self_verify?: boolean
          created_at?: string
          full_name?: string
          id: string
          phone?: string | null
        }
        Update: {
          active?: boolean
          can_self_verify?: boolean
          created_at?: string
          full_name?: string
          id?: string
          phone?: string | null
        }
        Relationships: []
      }
      service_categories: {
        Row: {
          active: boolean
          display_order: number
          key: string
          name: string
        }
        Insert: {
          active?: boolean
          display_order?: number
          key: string
          name: string
        }
        Update: {
          active?: boolean
          display_order?: number
          key?: string
          name?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      visits: {
        Row: {
          appointment_id: string | null
          assigned_clinician_id: string | null
          checked_in_at: string
          checked_in_by: string | null
          completed_at: string | null
          id: string
          patient_id: string
          queue_date: string
          queue_number: number | null
          reception_notes: string | null
          service_key: string
          started_at: string | null
          status: string
          visit_type: string
        }
        Insert: {
          appointment_id?: string | null
          assigned_clinician_id?: string | null
          checked_in_at?: string
          checked_in_by?: string | null
          completed_at?: string | null
          id?: string
          patient_id: string
          queue_date?: string
          queue_number?: number | null
          reception_notes?: string | null
          service_key: string
          started_at?: string | null
          status?: string
          visit_type?: string
        }
        Update: {
          appointment_id?: string | null
          assigned_clinician_id?: string | null
          checked_in_at?: string
          checked_in_by?: string | null
          completed_at?: string | null
          id?: string
          patient_id?: string
          queue_date?: string
          queue_number?: number | null
          reception_notes?: string | null
          service_key?: string
          started_at?: string | null
          status?: string
          visit_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "visits_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_assigned_clinician_id_fkey"
            columns: ["assigned_clinician_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_service_key_fkey"
            columns: ["service_key"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["key"]
          },
        ]
      }
      vital_signs: {
        Row: {
          blood_glucose: number | null
          bp_diastolic: number | null
          bp_systolic: number | null
          height_cm: number | null
          id: string
          patient_id: string
          pulse: number | null
          recorded_at: string
          recorded_by: string | null
          resp_rate: number | null
          spo2: number | null
          temperature: number | null
          visit_id: string
          weight_kg: number | null
        }
        Insert: {
          blood_glucose?: number | null
          bp_diastolic?: number | null
          bp_systolic?: number | null
          height_cm?: number | null
          id?: string
          patient_id: string
          pulse?: number | null
          recorded_at?: string
          recorded_by?: string | null
          resp_rate?: number | null
          spo2?: number | null
          temperature?: number | null
          visit_id: string
          weight_kg?: number | null
        }
        Update: {
          blood_glucose?: number | null
          bp_diastolic?: number | null
          bp_systolic?: number | null
          height_cm?: number | null
          id?: string
          patient_id?: string
          pulse?: number | null
          recorded_at?: string
          recorded_by?: string | null
          resp_rate?: number | null
          spo2?: number | null
          temperature?: number | null
          visit_id?: string
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vital_signs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vital_signs_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_exists: { Args: never; Returns: boolean }
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "receptionist" | "clinician" | "lab_tech"
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
    Enums: {
      app_role: ["admin", "receptionist", "clinician", "lab_tech"],
    },
  },
} as const
