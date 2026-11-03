# Eventos Below

Plataforma web **multi-tenant** para registrar y acreditar asistentes a eventos corporativos: cada cliente tiene sus eventos, cada evento tiene fechas con aforo, los asistentes se inscriben en un enlace público y reciben un ticket con QR, y el día del evento los anfitriones validan el ingreso desde el celular.

**Stack:** Next.js 15 (App Router) · TypeScript · Tailwind CSS 4 · Supabase (PostgreSQL + Auth + Storage) · `html5-qrcode` · `qrcode.react` · ExcelJS · Zod · Lucide.

---

## Módulos

| Módulo | Ruta | Quién |
|---|---|---|
| Panel de administración | `/admin` | SuperAdmin y administradores del cliente |
| Portal de registro | `/evento/[slug]` | Público |
| Ticket con QR | `/evento/[slug]/ticket/[token]` | Asistente |
| Acreditación (check-in) | `/checkin/[eventId]` | Anfitriones |

### 1. Administración
- **Clientes** (`/admin/clientes`): alta de empresas cliente (solo SuperAdmin) e invitación de usuarios por correo con rol *Administrador* o *Anfitrión*.
- **Eventos**: nombre, descripción, lugar, enlace (`slug`), **logo** y **color primario** con vista previa en vivo; modo de acompañante *Sin / Opcional / Obligatorio*; publicación e inscripciones abiertas/cerradas.
- **Fechas y aforo**: varias fechas por evento con horario, etiqueta y aforo; barra de ocupación; el aforo no puede bajar por debajo de los cupos ya ocupados.
- **Registros**: búsqueda, filtro por fecha, paginación, cancelación (libera cupos).
- **Exportación** a **Excel** (hoja de registros + hoja resumen por fecha) o **CSV** (UTF-8 con BOM, protegido contra inyección de fórmulas).

### 2. Registro público
- Tarjetas de fecha con **cupos restantes actualizados cada 15 s** y al volver a la pestaña. Las fechas agotadas, o con un solo cupo cuando hay acompañante, se deshabilitan.
- Datos del titular (nombre, correo, teléfono, tipo y número de documento con validación por tipo: DNI 8 dígitos, CE, pasaporte, cédula; empresa y cargo opcionales) y del acompañante si aplica.
- La reserva del cupo es **atómica en la base de datos**: aunque dos personas envíen a la vez por el último cupo, solo una entra.
- Pantalla de éxito → **ticket con QR** descargable (PNG) e imprimible.
- **Correo de confirmación** con el QR embebido (vía Resend). Sin `RESEND_API_KEY` el envío se simula en la consola del servidor.

### 3. Acreditación
- Interfaz oscura, pensada para celular/tablet, con **selector de fecha activa** (por defecto: hoy) y contador *ingresados / inscritos*.
- **Escáner QR** con la cámara trasera, o **búsqueda predictiva** por DNI, nombre o correo (del titular o del acompañante).
- Resultado inmediato a pantalla completa, con sonido y vibración:
  - 🟢 **Registro válido** → botones *Ingresar ambos* / *Solo titular* / *Solo acompañante*.
  - 🔴 **Ya ingresó** (muestra la hora), **Fecha incorrecta** (indica la fecha real), **Cancelado**, **No encontrado**.
- El ingreso se marca con bloqueo de fila: **no hay doble ingreso** aunque dos anfitriones escaneen el mismo QR a la vez.

---

## Modelo de datos

```
tenants ─┬─< tenant_members >── auth.users ──< platform_admins
         └─< events ─< event_dates ─< registrations
                  └──────────────────────┘ (FK compuesta: la fecha pertenece al evento)
```

| Tabla | Contenido clave |
|---|---|
| `tenants` | Empresa cliente: nombre, slug, RUC, contacto |
| `platform_admins` | SuperAdmins de Below Trade |
| `tenant_members` | Usuario ↔ cliente con rol `CLIENT_ADMIN` o `HOST` |
| `events` | Branding (`logo_url`, `primary_color`), `slug` único, `companion_mode`, zona horaria, publicado/abierto |
| `event_dates` | Día, hora inicio/fin, `capacity`, `registered_count` (cupos ocupados; `CHECK registered_count <= capacity`) |
| `registrations` | Titular, acompañante, `token` único (lo que va en el QR), `seats` (1 o 2), estado `REGISTRADO / CHECKED_IN / CANCELADO`, hora de ingreso de titular y de acompañante |

Funciones SQL (toda la lógica crítica vive en la base de datos):

- `register_attendee(...)`: valida evento publicado, fecha vigente y reglas de acompañante; reserva cupos con un `UPDATE ... WHERE registered_count + seats <= capacity` e inserta el registro, todo en la misma transacción. Errores: `SOLD_OUT`, `DUPLICATE`, `EVENT_CLOSED`, `DATE_PAST`, `COMPANION_REQUIRED`…
- `check_in(registration_id, event_date_id, target)`: `SELECT ... FOR UPDATE`, verifica tenant, fecha y estado; devuelve `OK / ALREADY / WRONG_DATE / CANCELLED / NOT_FOUND`.
- `cancel_registration(id)`: cancela y devuelve los cupos.
- Vista `event_date_stats` para los contadores del check-in.

**Seguridad:** RLS en todas las tablas. Cada usuario solo ve los datos de sus clientes; los anfitriones pueden leer registros, pero solo escriben a través de `check_in`. El portal público no usa la anon key contra las tablas: el servidor lee solo campos públicos de eventos publicados. Un documento solo puede tener un registro activo por fecha (índice único parcial).

---

## Estructura

```
supabase/
  migrations/0001_init.sql    Esquema, RLS, funciones, bucket de logos
  seed.sql                    SuperAdmin + cliente y evento demo
src/
  middleware.ts               Refresca sesión, protege /admin y /checkin
  app/
    login/                    Ingreso con correo y contraseña
    admin/
      actions.ts              Server Actions: clientes, miembros, eventos, logo, fechas, cancelación
      page.tsx                Lista de eventos
      clientes/page.tsx       Clientes y equipo
      eventos/nuevo/          Crear evento
      eventos/[id]/           Fechas, registros, branding
      eventos/[id]/exportar/  GET → .xlsx / .csv
    evento/[slug]/
      page.tsx                Portal público con branding
      actions.ts              registerAttendee (Zod + RPC + correo)
      ticket/[token]/         Ticket con QR
    checkin/
      page.tsx                Elegir evento
      [eventId]/page.tsx      Consola de acreditación
      actions.ts              lookup, búsqueda, check-in, métricas
    api/
      public/events/[slug]/availability/   Cupos en vivo
      qr/[token]/                          PNG del QR (para el correo)
  components/
    registration/             registration-form, ticket-card, event-header
    checkin/                  checkin-console, qr-scanner, feedback
    admin/                    event-form, dates-manager, tenant-forms, ui
  lib/
    supabase/{server,client,admin}.ts
    auth.ts                   Viewer, roles, requireEvent()
    validation.ts             Esquemas Zod (documentos por tipo)
    email.ts                  Plantilla y envío (Resend / simulado)
    format.ts                 Fechas es-PE, color legible sobre la marca
```

---

## Puesta en marcha

1. **Crea un proyecto en Supabase** y en *SQL Editor* ejecuta `supabase/migrations/0001_init.sql`.
   (Con la CLI: `supabase link` y luego `supabase db push`.)
2. **Crea tu usuario** en *Authentication → Users* (correo + contraseña).
3. Edita el correo en `supabase/seed.sql` y ejecútalo: te convierte en SuperAdmin y crea un evento demo.
4. Configura las variables:
   ```bash
   cp .env.example .env.local   # completa URL, anon key, service role key
   npm install
   npm run dev
   ```
5. Entra a `http://localhost:3000/login`. El portal demo queda en `/evento/convencion-anual-2026`.

**Correo real:** crea una API key en [Resend](https://resend.com), verifica tu dominio y define `RESEND_API_KEY` y `EMAIL_FROM`.

**Despliegue:** Vercel con las mismas variables. `NEXT_PUBLIC_APP_URL` debe ser la URL pública (se usa en los enlaces del correo). La cámara del check-in requiere **HTTPS**.

---

## Verificación realizada

- Migración aplicada en PostgreSQL 16. Probados: duplicado, aforo agotado, acompañante que ocupa 2 cupos, fecha incorrecta, doble ingreso, aislamiento entre clientes por RLS y bloqueo de `register_attendee` para `anon`.
- **Concurrencia:** 80 registros simultáneos sobre un aforo de 50 → exactamente 50 aceptados.
- `tsc --noEmit` y `next build` sin errores.
- Flujo completo en Chrome (vía PostgREST): registro con acompañante → ticket → correo simulado → QR PNG; check-in válido → ingreso → “Ya ingresó” → “Fecha incorrecta”; exportación Excel y CSV.

## Siguientes pasos sugeridos

- Rate limiting / CAPTCHA (p. ej. Cloudflare Turnstile) en el formulario público.
- Supabase Realtime para los cupos en lugar de polling.
- Modo offline del check-in (cache local de registros del día y sincronización).
- Campos personalizados por evento y reenvío del ticket desde el panel.
