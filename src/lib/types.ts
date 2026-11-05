export type MemberRole = "CLIENT_ADMIN" | "HOST";
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
  email: string;
  phone: string;
  document_type: DocumentType;
  document_number: string;
  company: string | null;
  job_title: string | null;
  has_companion: boolean;
  companion_full_name: string | null;
  companion_document_type: DocumentType | null;
  companion_document_number: string | null;
  seats: number;
  status: RegistrationStatus;
  holder_checked_in_at: string | null;
  companion_checked_in_at: string | null;
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
