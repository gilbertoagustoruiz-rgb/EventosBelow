export type MemberRole = "CLIENT_ADMIN" | "HOST";
export type StaffRole = "SUPERVISOR" | "PROMOTOR";
export type RegistrationStatus = "REGISTRADO" | "CHECKED_IN" | "CANCELADO";
export type CompanionMode = "NONE" | "OPTIONAL" | "REQUIRED";
export type DocumentType = "DNI" | "CE" | "PASAPORTE" | "CEDULA";

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  tax_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  is_active: boolean;
  created_at: string;
}

export interface EventRow {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  description: string | null;
  venue: string | null;
  logo_url: string | null;
  primary_color: string;
  companion_mode: CompanionMode;
  max_companions: number;
  project_id: string;
  timezone: string;
  is_published: boolean;
  registration_open: boolean;
  checkin_key: string;
  created_at: string;
}

export interface EventDate {
  id: string;
  event_id: string;
  event_day: string; // YYYY-MM-DD
  starts_at: string; // HH:MM:SS
  ends_at: string;
  label: string | null;
  capacity: number;
  registered_count: number;
}

export interface Registration {
  id: string;
  event_id: string;
  event_date_id: string;
  token: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  document_type: DocumentType;
  document_number: string;
  company: string | null;
  job_title: string | null;
  employee_code: string | null;
  invitee_id: string | null;
  companions_count: number;
  seats: number;
  status: RegistrationStatus;
  holder_checked_in_at: string | null;
  cancelled_at: string | null;
  created_at: string;
}

/** Fecha tal como la ve el portal público. */
export interface PublicDateOption {
  id: string;
  event_day: string;
  starts_at: string;
  ends_at: string;
  label: string | null;
  capacity: number;
  remaining: number;
}

export interface Companion {
  id: string;
  registration_id: string;
  position: number;
  full_name: string;
  document_type: DocumentType;
  document_number: string;
  checked_in_at: string | null;
}

export interface Project {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Invitee {
  id: string;
  event_id: string;
  document_type: DocumentType;
  document_number: string;
  employee_code: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  job_title: string | null;
}
