-- Enlace secreto de acreditación por evento: /acreditar/<checkin_key>
-- Quien tenga el enlace puede hacer check-in sin iniciar sesión.
-- Regenerarlo desde el panel invalida el anterior.
alter table events
  add column checkin_key text not null unique
  default replace(gen_random_uuid()::text, '-', '');
