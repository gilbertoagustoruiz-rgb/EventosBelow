# Eventos Below

Plataforma web **multi-tenant** para registrar y acreditar asistentes a eventos corporativos: cada cliente tiene sus eventos, cada evento tiene fechas con aforo, los asistentes se inscriben en un enlace público y reciben un ticket con QR, y el día del evento los anfitriones validan el ingreso desde el celular.

**Stack:** Next.js 15 (App Router) · TypeScript · Tailwind CSS 4 · PostgreSQL (`pg`) · login propio (scrypt + cookie firmada con `jose`) · DigitalOcean Spaces para logos · `html5-qrcode` · `qrcode.react` · ExcelJS · Zod · Lucide.

**Infraestructura:** cualquier hosting de Node + PostgreSQL. Probado para **Render** (web service + Render Postgres) y preparado para **DigitalOcean** (App Platform + Managed Database + Spaces).

---

## Perfiles y módulos

Jerarquía: **Cliente → Proyecto → Eventos**. Cada evento tiene fechas con aforo, una **base de invitados precargada** y su **personal de apoyo** (supervisores y promotores).

| Perfil | Acceso | Qué hace |
|---|---|---|
| **Administrador general** (Below Trade) | Correo o DNI y contraseña | Crea **clientes**, **proyectos**, **eventos** y **usuarios** de todos los perfiles; asigna coordinadores a cada cliente; ve todo |
| **Coordinador** | Correo o DNI y contraseña | Crea, ve y edita los eventos de sus clientes; carga la base de invitados; agrega **supervisores y promotores** a cada evento; ve el **dashboard** |
| **Supervisor del evento** | Correo o DNI y contraseña | Ve el dashboard y toda la gestión de los promotores de sus eventos; **agrega o quita promotores**; acredita |
| **Promotor del evento** | Correo o DNI y contraseña | Busca por **DNI o código de vendedor** o escanea el **QR** y confirma el ingreso; recibe la alerta si la persona ya ingresó y a qué hora |
| Apoyo con enlace general | Enlace del evento | Acredita sin usuario (queda como “Enlace general”) |
| Asistente (invitado) | Público | Escribe su **DNI o código de vendedor**, se autocompletan sus datos de la base, elige el **día** y sus acompañantes |

| Módulo | Ruta | Perfil |
|---|---|---|
| Eventos | `/admin` | Administrador (todos) · Coordinador (sus clientes) · Supervisor (sus eventos) |
| Clientes | `/admin/clientes` | Administrador |
| Proyectos | `/admin/proyectos` | Administrador |
| Empleados (usuarios) | `/admin/empleados` | Administrador |
| Coordinadores por cliente | `/admin/asignaciones` | Administrador |
| Perfiles | `/admin/perfiles` | Administrador |
| Evento: fechas, invitados, personal, inscripciones | `/admin/eventos/[id]` | Administrador · Coordinador |
| Base de invitados / carga Excel | `/admin/eventos/[id]/invitados` · `/importar` | Administrador · Coordinador |
| Dashboard del evento | `/admin/eventos/[id]/dashboard` | Administrador · Coordinador · Supervisor |
| Acreditación | `/checkin/[eventId]` | Todos los perfiles del evento |
| Acreditación general | `/acreditar/[enlace]` | Apoyo eventual (sin login) |
| Portal de confirmación | `/evento/[slug]` | Invitados |
| Ticket con QR | `/evento/[slug]/ticket/[token]` | Asistente |

**Reglas de acceso**
- Solo el administrador crea usuarios. Cada empleado recibe una **contraseña temporal** (se muestra una vez y se cambia al primer ingreso). Ingresa con su **correo o su DNI**. Para empleados antiguos sin acceso hay un botón **Crear acceso**.
- Un coordinador accede únicamente a los clientes que el administrador le asignó. Supervisores y promotores solo ven los eventos donde fueron agregados. Desactivar a un empleado le quita el acceso y lo retira del personal de sus eventos al instante.
- El coordinador agrega supervisores y promotores desde el directorio; el supervisor solo agrega o quita promotores. La bitácora de lo acreditado se conserva siempre.

### 1. Administración
- **Clientes y proyectos**: cada cliente nace con el proyecto «General»; se pueden crear más y archivarlos.
- **Eventos**: proyecto, nombre, descripción, lugar, enlace (`slug`), **logo** y **color primario** con vista previa; acompañantes *Sin / Opcional / Obligatorio* con **máximo configurable (hasta 10)**, cada uno con nombre y documento; publicación e inscripciones abiertas/cerradas.
- **Fechas y aforo**: varias fechas por evento con horario, etiqueta y aforo. Cada acompañante ocupa un cupo.
- **Base de invitados**: carga desde Excel (.xlsx, hasta 5 000 filas) con vista previa fila por fila; reconoce variantes de encabezados (`N° Documento`, `Código vendedor`, `Nombres y Apellidos`…). Si el documento ya existe, actualiza sus datos. También se agregan o quitan invitados uno a uno, y se ve quién ya confirmó su día.
- **Inscripciones**: búsqueda por nombre, correo, documento o código; acompañantes con su documento y cuántos ingresaron; cancelación (libera todos los cupos del grupo).
- **Exportación** a **Excel** (registros, resumen por fecha y **bitácora** de acreditación) o **CSV**.

### 2. Dashboard del evento
- Personas que ingresaron (titulares + acompañantes) frente a las esperadas, base de invitados y confirmados.
- **Ingresos por hora** con la **hora pico** resaltada (hora local del evento).
- Cómo llegaron: **solos**, **con 1 acompañante** o **con más de uno**.
- **Gestión por supervisor y promotor**: ingresos, personas, alertas (reingresos, otra fecha, cancelados), no encontrados y última actividad; actividad reciente con método (QR, DNI/código, nombre).
- Filtro por fecha y actualización automática cada 30 s.

### 3. Confirmación del invitado
- Solo pueden inscribirse las personas de la **base precargada**: escriben su **DNI o código de vendedor** y se muestran sus datos (documento y correo enmascarados). El correo de la base no se puede cambiar; si falta, se pide.
- Elige el **día**, con cupos actualizados cada 15 s, y registra sus acompañantes si el evento lo permite.
- Si ya estaba inscrito, **no se muestra el ticket**: se reenvía al correo registrado.
- La reserva es **atómica en la base de datos**: aunque varios envíen a la vez por los últimos cupos, nunca se supera el aforo.
- **Ticket con QR** descargable e imprimible y **correo de confirmación** (Resend; sin `RESEND_API_KEY` se simula en consola).

### 4. Acreditación
- Modo principal **DNI o código**: funciona con el documento del titular, de cualquier acompañante o con el código de vendedor. También **escáner QR** y búsqueda por nombre.
- Muestra al titular y a cada acompañante para marcar **quién ingresa**; los que faltan pueden ingresar después.
- Si se intenta registrar de nuevo: **“Esta persona ya ingresó al evento a las HH:MM”**, sin duplicar asistencia. También avisa *fecha incorrecta*, *cancelado* y *no encontrado*.
- Cada intento queda en la **bitácora** con el empleado que lo hizo; con bloqueo de fila no hay doble ingreso aunque dos promotores escaneen a la vez.

---

## Modelo de datos

```
tenants ──< projects ──< events ──< event_dates ──< registrations ──< companions
                            ├──< invitees (base precargada) ─────────┘ (invitee_id)
                            ├──< event_staff >── employees ── users
                            └──< checkin_log
employees ──< employee_clients >── tenants   (coordinadores por cliente → vista tenant_members)
```

| Tabla | Contenido clave |
|---|---|
| `users` | Correo y/o `username` (DNI), nombre, contraseña (scrypt), `is_platform_admin`, `must_change_password` |
| `tenants` / `projects` | Cliente y sus proyectos |
| `employees` | Directorio: perfil `ADMINISTRADOR / COORDINADOR / SUPERVISOR / PROMOTOR`, documento, correo, usuario, activo |
| `employee_clients` · `tenant_members` | Coordinadores por cliente (la vista da los permisos) |
| `events` | Proyecto, branding, `slug`, `companion_mode`, `max_companions`, zona horaria, publicado/abierto |
| `event_dates` | Día, horario, `capacity`, `registered_count` (`CHECK registered_count <= capacity`) |
| `invitees` | Base precargada por evento: documento, código de vendedor, nombre, correo, celular, empresa (únicos por evento) |
| `registrations` | Titular (vinculado al invitado), `token` del QR, `companions_count`, `seats` = 1 + acompañantes, estado, hora de ingreso |
| `companions` | Cada acompañante con nombre, documento y su propia hora de ingreso |
| `event_staff` | Supervisores y promotores de cada evento |
| `checkin_log` | Bitácora: resultado (`INGRESO / YA_INGRESO / FECHA_INCORRECTA / CANCELADO / NO_ENCONTRADO`), personas, método y empleado |

Funciones SQL (la lógica crítica vive en la base de datos):

- `register_attendee(fecha, invitado, …, acompañantes jsonb, p_admin)`: en modo público exige invitado de la base y toma sus datos; valida evento, fecha, máximo y obligatoriedad de acompañantes y documentos repetidos; reserva cupos con `UPDATE … WHERE registered_count + seats <= capacity`. Errores: `NOT_INVITED`, `SOLD_OUT`, `DUPLICATE`, `TOO_MANY_COMPANIONS`, `COMPANION_REQUIRED`, `COMPANION_IS_HOLDER`, `COMPANION_DUPLICATE`, `EVENT_CLOSED`, `DATE_PAST`.
- `check_in(registro, fecha, titular, acompañantes[], usuario, empleado, método)`: `SELECT … FOR UPDATE`; marca a cada persona y escribe la bitácora. Devuelve `OK / ALREADY / WRONG_DATE / CANCELLED / NOT_FOUND`.
- `cancel_registration(id)`: cancela y devuelve todos los cupos del grupo.

**Seguridad:**
- Contraseñas con scrypt; sesión en cookie `httpOnly` firmada (7 días). Cambiar la contraseña cierra las demás sesiones.
- Límites de intentos por proceso: login (8 por usuario + IP cada 15 min), búsqueda de invitado (20 por IP cada 10 min), confirmación (10 por IP cada 10 min), recuperación de ticket (1 por correo cada minuto). No sustituyen un límite compartido entre instancias ni la protección del proxy.
- El portal público nunca muestra el documento completo, el correo ni un ticket existente.
- Cada consulta del panel y del check-in filtra por los clientes o eventos del usuario (`src/lib/auth.ts`); fuera de su alcance recibe 404.
- Todas las consultas son parametrizadas.

---

## Estructura

```
.do/app.yaml                  Especificación de DigitalOcean App Platform
db/
  migrations/                 0001…0009 (esquema y funciones)
  seed-demo.sql               Cliente y evento de ejemplo (opcional)
scripts/
  migrate.mjs                 Aplica migraciones pendientes (npm run db:migrate)
  create-admin.mjs            Crea un SuperAdmin (npm run create-admin)
src/
  middleware.ts               Exige sesión en /admin, /checkin y /cuenta
  app/
    login/                    Ingreso, cierre de sesión y cambio de contraseña
    cuenta/                   Cambiar contraseña (obligatorio con contraseña temporal)
    admin/
      actions.ts              Clientes, usuarios, eventos, logo, fechas, cancelación
      page.tsx                Lista de eventos
      clientes/ proyectos/    Clientes y proyectos
      empleados/ asignaciones/ perfiles/
      eventos/nuevo/          Crear evento (elige proyecto)
      eventos/[id]/           Fechas, invitados, personal, inscripciones, branding
      eventos/[id]/invitados/ Base de invitados (alta manual) · importar/ carga Excel
      eventos/[id]/dashboard/ Indicadores, horas pico, acompañantes, gestión del personal
      eventos/[id]/exportar/  GET → .xlsx / .csv
    evento/[slug]/
      page.tsx                Portal público con branding
      actions.ts              lookupInvitee + confirmRegistration (base precargada)
      ticket/[token]/         Ticket con QR
    checkin/
      page.tsx                Elegir evento
      [eventId]/page.tsx      Consola de acreditación
      actions.ts              Validación, búsqueda, check-in, métricas
    api/
      public/events/[slug]/availability/   Cupos en vivo
      qr/[token]/                          PNG del QR (para el correo)
  components/
    registration/             registration-form, ticket-card, event-header
    checkin/                  checkin-console, qr-scanner, feedback
    admin/                    event-form, dates-manager, tenant-forms, ui
  lib/
    db.ts                     Pool de PostgreSQL (SSL de DigitalOcean)
    auth.ts                   Usuario actual, roles, requireEvent()
    session.ts / password.ts  Cookie firmada y hash scrypt
    storage.ts                Subida de logos a Spaces
    validation.ts             Esquemas Zod (documentos por tipo)
    email.ts                  Plantilla y envío (Resend / simulado)
    format.ts                 Fechas es-PE, color legible sobre la marca
```

---

## Despliegue en Render

1. Web service Node conectado a este repo (rama `main`): build `npm ci && npm run build`, start `npm start`.
   `npm start` aplica las migraciones pendientes antes de arrancar, así que no hace falta consola.
2. Variables de entorno:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | En la base de Render → **Connect** → *Internal Database URL* si la app está en la misma región; si no, *External Database URL* (el SSL se activa solo con hosts `*.render.com`) |
| `SESSION_SECRET` | Cadena aleatoria de 32+ caracteres |
| `APP_URL` | `https://<tu-servicio>.onrender.com` |
| `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD` | Crea el primer SuperAdmin si no existe ninguno; la contraseña es temporal y se pide cambiarla al entrar |

3. Logos: sin Spaces configurado se guardan en la base de datos (tabla `assets`, servidos en `/api/assets/<id>`).

**Plan gratuito:** la base de datos gratuita de Render **caduca a los 30 días** y el web service se duerme tras 15 min sin tráfico. Para un evento real, sube ambos a un plan pago antes de la fecha.

## Despliegue en DigitalOcean

Usa tres servicios de DigitalOcean: **Managed Database** (datos), **Spaces** (logos) y **App Platform** (la app). El Droplet no hace falta.

### 1. Base de datos
1. **Databases →** tu cluster PostgreSQL → **Users & Databases → Add new database** → nombre `eventos_below`.
   Así las tablas de esta app no se mezclan con las de otros proyectos del mismo cluster.
2. Las tablas las crea la app sola en cada despliegue (job `migrate`); no hace falta ejecutar SQL a mano.

### 2. Spaces (logos, opcional: sin Spaces se guardan en la base de datos)
1. **Spaces Object Storage → Create a Space**: región (ej. `nyc3`) y nombre (ej. `eventos-below`).
2. **API → Spaces Keys → Generate New Key**: guarda *Access Key* y *Secret*.

### 3. App Platform
1. **Apps → Create App → GitHub** → repo `EventosBelow`, rama `main`, *Autodeploy* activado.
2. En **Settings → App Spec → Edit**, pega el contenido de `.do/app.yaml` y reemplaza los valores `CAMBIAR`:
   - `cluster_name`: el nombre de tu cluster de base de datos.
   - `SESSION_SECRET`: una cadena aleatoria larga (por ejemplo, el resultado de `openssl rand -base64 48`).
   - `SPACES_BUCKET`, `SPACES_REGION`, `SPACES_KEY`, `SPACES_SECRET`.

   O, desde tu computadora con `doctl`: `doctl apps create --spec .do/app.yaml`.
3. En la base de datos, pestaña **Settings → Trusted sources**: agrega la app `eventos-below` (si no se agregó sola).
4. Guarda. App Platform compila, ejecuta las migraciones y publica la app en `https://eventos-below-xxxxx.ondigitalocean.app`.

### 4. Crea tu usuario SuperAdmin
En la app: **Console** (componente `web`) y ejecuta:
```bash
npm run create-admin -- tu-correo@belowtrade.pe "TuContraseñaSegura" "Tu Nombre"
```
Luego entra a `/login`. Desde **Clientes** creas las empresas cliente y sus usuarios.

**Notas:**
- Ninguna variable se fija al compilar: si cambias una clave, basta con reiniciar o redesplegar.
- La cámara del check-in requiere HTTPS, que App Platform ya incluye.
- Correo real: crea una API key en [Resend](https://resend.com), verifica tu dominio y define `RESEND_API_KEY` y `EMAIL_FROM`.

### Desarrollo local
```bash
cp .env.example .env.local     # DATABASE_URL, SESSION_SECRET, APP_URL…
npm install
npm run db:migrate
npm run create-admin -- yo@empresa.pe "ContraseñaLocal123"
psql "$DATABASE_URL" -f db/seed-demo.sql   # opcional
npm run dev
```

---

## Verificación realizada

Automática (CI en cada PR y push a `main`, con PostgreSQL 16 real):
- `npm test`: redirecciones seguras del login, límites de intentos, validación Zod (acompañantes) y exportación Excel.
- `tests/flow-db.test.mjs`: esquema; proyecto del mismo cliente; solo invitados de la base y con sus datos; máximo, obligatoriedad y documentos de acompañantes; aforo en paralelo; modo administrador; acreditación parcial, reingreso, otra fecha y bitácora; cancelación; unicidad de documento y código; coordinadores por cliente y personal por evento.
- `tests/logo-colors.test.mjs`: extracción de colores del logo.
- `npm run typecheck` y `npm run build`.

Manual en Chrome (base nueva y copia con datos previos migrada a la 0009): administrador crea cliente, proyecto y usuarios de los tres perfiles; coordinador crea el evento, carga el Excel de invitados y agrega personal; invitado confirma con su código de vendedor y dos acompañantes; promotora ingresa con DNI y acredita en dos tandas, y el tercer intento muestra la hora del ingreso; supervisor ve el dashboard, no puede editar el evento y retira a la promotora.

## Siguientes pasos sugeridos

- Rate limiting / CAPTCHA (p. ej. Cloudflare Turnstile) en el formulario público.
- Cupos en tiempo real con Server-Sent Events en lugar de polling.
- Recuperación de contraseña por correo.
- Modo offline del check-in (cache local de registros del día y sincronización).
- Campos personalizados por evento y reenvío del ticket desde el panel.
