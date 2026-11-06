-- =====================================================================
-- 0011 · Correo y celular opcionales en la inscripción
--   La confirmación pública solo pide DNI o código; el ticket se muestra en
--   pantalla. El correo se usa únicamente si viene en la base de invitados.
-- =====================================================================

alter table registrations alter column email drop not null;
alter table registrations alter column phone drop not null;
