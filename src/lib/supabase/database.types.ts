/**
 * Supabase DB 型（init_shift_schema マイグレーションと対応）
 * 本番接続後は `supabase gen types typescript` で差し替え推奨。
 */

export type StaffRole = "worker" | "admin";
export type AdminPermission = "manager" | "general";
export type EmploymentStatus = "active" | "inactive";
export type ShiftPeriodStatus = "draft" | "editing" | "adjusting" | "published";
export type ConfirmedShiftStatus = "adjusting" | "unconfirmed" | "confirmed";
export type MessageAudience = "all" | "team";

export type Database = {
  public: {
    Tables: {
      departments: {
        Row: {
          id: string;
          name: string;
          is_fixed: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          is_fixed?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          is_fixed?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      staff_profiles: {
        Row: {
          id: string;
          last_name: string;
          first_name: string;
          display_given_name: boolean;
          icon_label: string;
          department_id: string | null;
          role: StaffRole;
          admin_permission: AdminPermission;
          status: EmploymentStatus;
          weekly_contract_hours: number;
          social_insurance: boolean;
          hire_date: string | null;
          contract_start_date: string | null;
          contract_end_date: string | null;
          contract_renewal_months: number;
          hourly_wage: number;
          email: string;
          google_email: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          last_name: string;
          first_name?: string;
          display_given_name?: boolean;
          icon_label?: string;
          department_id?: string | null;
          role?: StaffRole;
          admin_permission?: AdminPermission;
          status?: EmploymentStatus;
          weekly_contract_hours?: number;
          social_insurance?: boolean;
          hire_date?: string | null;
          contract_start_date?: string | null;
          contract_end_date?: string | null;
          contract_renewal_months?: number;
          hourly_wage?: number;
          email?: string;
          google_email?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          last_name?: string;
          first_name?: string;
          display_given_name?: boolean;
          icon_label?: string;
          department_id?: string | null;
          role?: StaffRole;
          admin_permission?: AdminPermission;
          status?: EmploymentStatus;
          weekly_contract_hours?: number;
          social_insurance?: boolean;
          hire_date?: string | null;
          contract_start_date?: string | null;
          contract_end_date?: string | null;
          contract_renewal_months?: number;
          hourly_wage?: number;
          email?: string;
          google_email?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "staff_profiles_department_id_fkey";
            columns: ["department_id"];
            isOneToOne: false;
            referencedRelation: "departments";
            referencedColumns: ["id"];
          },
        ];
      };
      salary_raises: {
        Row: {
          id: string;
          staff_id: string;
          effective_date: string;
          hourly_wage: number;
          note: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          staff_id: string;
          effective_date: string;
          hourly_wage: number;
          note?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          staff_id?: string;
          effective_date?: string;
          hourly_wage?: number;
          note?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "salary_raises_staff_id_fkey";
            columns: ["staff_id"];
            isOneToOne: false;
            referencedRelation: "staff_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      shift_periods: {
        Row: {
          id: string;
          adjustment_status: ShiftPeriodStatus;
          published_week_start_date: string | null;
          published_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          adjustment_status?: ShiftPeriodStatus;
          published_week_start_date?: string | null;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          adjustment_status?: ShiftPeriodStatus;
          published_week_start_date?: string | null;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      desired_shifts: {
        Row: {
          id: string;
          staff_id: string;
          period_id: string;
          work_date: string;
          start_time: string;
          end_time: string;
          break_minutes: number;
          actual_minutes: number;
          note: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          staff_id: string;
          period_id: string;
          work_date: string;
          start_time: string;
          end_time: string;
          break_minutes?: number;
          actual_minutes?: number;
          note?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          staff_id?: string;
          period_id?: string;
          work_date?: string;
          start_time?: string;
          end_time?: string;
          break_minutes?: number;
          actual_minutes?: number;
          note?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "desired_shifts_staff_id_fkey";
            columns: ["staff_id"];
            isOneToOne: false;
            referencedRelation: "staff_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "desired_shifts_period_id_fkey";
            columns: ["period_id"];
            isOneToOne: false;
            referencedRelation: "shift_periods";
            referencedColumns: ["id"];
          },
        ];
      };
      confirmed_shifts: {
        Row: {
          id: string;
          staff_id: string;
          period_id: string;
          work_date: string;
          status: ConfirmedShiftStatus;
          start_time: string;
          end_time: string;
          break_minutes: number;
          actual_minutes: number;
          note: string;
          admin_note: string;
          published_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          staff_id: string;
          period_id: string;
          work_date: string;
          status?: ConfirmedShiftStatus;
          start_time: string;
          end_time: string;
          break_minutes?: number;
          actual_minutes?: number;
          note?: string;
          admin_note?: string;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          staff_id?: string;
          period_id?: string;
          work_date?: string;
          status?: ConfirmedShiftStatus;
          start_time?: string;
          end_time?: string;
          break_minutes?: number;
          actual_minutes?: number;
          note?: string;
          admin_note?: string;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "confirmed_shifts_staff_id_fkey";
            columns: ["staff_id"];
            isOneToOne: false;
            referencedRelation: "staff_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "confirmed_shifts_period_id_fkey";
            columns: ["period_id"];
            isOneToOne: false;
            referencedRelation: "shift_periods";
            referencedColumns: ["id"];
          },
        ];
      };
      goal_block_slots: {
        Row: {
          id: string;
          work_date: string;
          block_index: number;
          slot_index: number;
          department_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          work_date: string;
          block_index: number;
          slot_index: number;
          department_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          work_date?: string;
          block_index?: number;
          slot_index?: number;
          department_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "goal_block_slots_department_id_fkey";
            columns: ["department_id"];
            isOneToOne: false;
            referencedRelation: "departments";
            referencedColumns: ["id"];
          },
        ];
      };
      required_shifts: {
        Row: {
          id: string;
          period_id: string;
          work_date: string;
          required_people: number;
          required_minutes: number;
          note: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          period_id: string;
          work_date: string;
          required_people?: number;
          required_minutes?: number;
          note?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          period_id?: string;
          work_date?: string;
          required_people?: number;
          required_minutes?: number;
          note?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "required_shifts_period_id_fkey";
            columns: ["period_id"];
            isOneToOne: false;
            referencedRelation: "shift_periods";
            referencedColumns: ["id"];
          },
        ];
      };
      home_messages: {
        Row: {
          id: string;
          body: string;
          created_by: string;
          audience: MessageAudience;
          department_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          body: string;
          created_by: string;
          audience?: MessageAudience;
          department_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          body?: string;
          created_by?: string;
          audience?: MessageAudience;
          department_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "home_messages_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "staff_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "home_messages_department_id_fkey";
            columns: ["department_id"];
            isOneToOne: false;
            referencedRelation: "departments";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      is_admin: { Args: Record<string, never>; Returns: boolean };
      is_manager: { Args: Record<string, never>; Returns: boolean };
    };
    Enums: {
      staff_role: StaffRole;
      admin_permission: AdminPermission;
      employment_status: EmploymentStatus;
      shift_period_status: ShiftPeriodStatus;
      confirmed_shift_status: ConfirmedShiftStatus;
      message_audience: MessageAudience;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
