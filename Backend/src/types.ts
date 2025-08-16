export type Region = 'US' | 'Canada' | 'Other';
export type LeadState = 'available' | 'reserved' | 'owned' | 'expired' | 'returned';
export type Heat = 'HOT' | 'WARM' | 'OK';

export interface LeadRow {
  id: number;
  cat: string;
  kw: string;
  platform: string;
  region: Region;
  fit_user: number;
  fit_competition: number;
  heat: Heat;
  source_url?: string;
  evidence_snippet?: string;
  generated_at: number; // epoch ms
  expires_at: number;   // epoch ms
  state: LeadState;
  reserved_by?: string | null; // userId
  reserved_until?: number | null; // epoch ms
  company?: string | null;
  person_handle?: string | null;
  contact_email?: string | null;
}

export interface UserRow {
  id: string; // device/user id
  email?: string | null;
  region: Region;
  fp: number;
  multipliers_json: string; // JSON
  verified_at?: number | null;
  created_at: number;
}
