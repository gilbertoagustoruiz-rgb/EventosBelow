-- =====================================================================
-- 0012 · Perfil Cliente
--   Usuario de la empresa cliente: solo ve el dashboard y descarga las bases
--   de los eventos de su(s) cliente(s). Se asigna con employee_clients, igual
--   que el coordinador, pero NO entra en tenant_members (que da permisos de edición).
-- =====================================================================

alter type employee_profile add value if not exists 'CLIENTE';

-- Coherencia: un evento nuevo sin acompañantes (NONE) debe tener máximo 0
alter table events alter column max_companions set default 0;
