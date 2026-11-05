-- Nuevo perfil fijo: Supervisor del evento.
-- Va en su propia migración porque PostgreSQL no permite usar un valor de enum
-- en la misma transacción en que se crea.
alter type employee_profile add value if not exists 'SUPERVISOR' before 'PROMOTOR';
