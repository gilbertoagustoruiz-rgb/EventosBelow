import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Cliente con service_role: ignora RLS. Úsalo SOLO en el servidor y solo para:
 *  - leer datos públicos de eventos publicados (portal de registro)
 *  - ejecutar register_attendee
 *  - subir logos e invitar usuarios (tras verificar permisos del usuario)
 */
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
