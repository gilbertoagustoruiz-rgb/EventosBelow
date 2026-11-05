# Eventos Below

Plataforma web **multi-tenant** para registrar y acreditar asistentes a eventos corporativos: cada cliente tiene sus eventos, cada evento tiene fechas con aforo, los asistentes se inscriben en un enlace público y reciben un ticket con QR, y el día del evento los anfitriones validan el ingreso desde el celular.

**Stack:** Next.js 15 (App Router) · TypeScript · Tailwind CSS 4 · PostgreSQL (`pg`) · login propio (scrypt + cookie firmada con `jose`) · DigitalOcean Spaces para logos · `html5-qrcode` · `qrcode.react` · ExcelJS · Zod · Lucide.

**Infraestructura:** cualquier hosting de Node + PostgreSQL. Probado para **Render** (web service + Render Postgres) y preparado para **DigitalOcean** (App Platform + Managed Database + Spaces).

---

## Módulos

| Módulo | Ruta | Quién |
|---|---|---|
| Panel de administración | `/admin` | SuperAdmin y administradores del cliente |
| Portal de registro | `/evento/[slug]` | Público |
| Ticket con QR | `/evento/[slug]/ticket/[token]` | Asistente |
| Acreditación (check-in) | `/acreditar/[enlace]` | Anfitriones, **sin login**, con el enlace secreto del evento |
| Acreditación de promotor | `/promotor/[enlace]` | Cada promotor, **sin login**, con su enlace individual y revocable |
| Acreditación con cuenta | `/checkin/[eventId]` | SuperAdmin y administradores del cliente |
| Importar inscripciones | `/admin/eventos/[id]/importar` | Administradores: carga masiva desde Excel |
| Promotores | `/admin/promotores` | Administradores: directorio de promotores por cliente |

### 1. Administración
- **Clientes** (`/admin/clientes`): alta de empresas cliente (solo SuperAdmin) y de usuarios con rol *Administrador*. Los anfitriones acreditan con el enlace secreto del evento; el rol histórico `HOST` no habilita el acceso con cuenta. Al crear un usuario se muestra una **contraseña temporal** (una sola vez) que debe cambiar en su primer ingreso; también se puede generar una nueva si la olvida.
- **Eventos**: nombre, descripción, lugar, enlace (`slug`), **logo** y **color primario** con vista previa en vivo; modo de acompañante *Sin / Opcional / Obligatorio*; publicación e inscripciones abiertas/cerradas.
- **Fechas y aforo**: varias fechas por evento con horario, etiqueta y aforo; barra de ocupación; el aforo no puede bajar por debajo de los cupos ya ocupados.
- **Registros**: búsqueda, filtro por fecha, paginación, cancelación (libera cupos).
- **Exportación** a **Excel** (hoja de registros + hoja resumen por fecha) o **CSV** (UTF-8 con BOM, protegido contra inyección de fórmulas).

- **Importación desde Excel** (.xlsx, hasta 2 000 filas): reconoce encabezados con variantes (`N° Documento`, `Nro. DNI`, `Nombres y Apellidos`, `Teléfono celular`…), muestra una vista previa fila por fila con el motivo de cada rechazo (correo inválido, DNI repetido, ya inscrito, acompañante no permitido) y guarda todo en una sola transacción. Funciona aunque el evento no esté publicado. Opcionalmente envía el ticket QR por correo a cada importado.
- **Promotores**: directorio por cliente; se asignan a eventos y cada asignación tiene su propio enlace de acreditación, que se puede retirar o regenerar. Cada ingreso queda registrado con el promotor que lo hizo, y la lista de inscripciones y la exportación muestran **“Acreditado por”** (promotor, coordinador o enlace general).

### 2. Registro público
- Tarjetas de fecha con **cupos restantes actualizados cada 15 s** y al volver a la pestaña. Las fechas agotadas, o con un solo cupo cuando hay acompañante, se deshabilitan.
- Datos del titular (nombre, correo, teléfono, tipo y número de documento con validación por tipo: DNI 8 dígitos, CE, pasaporte, cédula; empresa y cargo opcionales) y del acompañante si aplica.
- La reserva del cupo es **atómica en la base de datos**: aunque dos personas envíen a la vez por el último cupo, solo una entra.
- Pantalla de éxito → **ticket con QR** descargable (PNG) e imprimible.
- **Correo de confirmación** con el QR embebido (vía Resend). Sin `RESEND_API_KEY` el envío se simula en la consola del servidor.

### 3. Acreditación
- Cada evento tiene un **enlace secreto de acreditación** (`/acreditar/<código>`, 128 bits aleatorios) que se copia desde el panel. Quien lo abre acredita **sin usuario ni contraseña**. **Regenerar** el enlace invalida el anterior al instante. Los administradores también pueden entrar por `/checkin` con su cuenta.
- Interfaz oscura, pensada para celular/tablet, con **selector de fecha activa** (por defecto: hoy) y contador *ingresados / inscritos*.
- **Escáner QR** con la cámara trasera, o **búsqueda predictiva** por DNI, nombre o correo (del titular o del acompañante).
- Resultado inmediato a pantalla completa, con sonido y vibración:
  - 🟢 **Registro válido** → botones *Ingresar ambos* / *Solo titular* / *Solo acompañante*.
  - 🔴 **Ya ingresó** (muestra la hora), **Fecha incorrecta** (indica la fecha real), **Cancelado**, **No encontrado**.
- El ingreso se marca con bloqueo de fila: **no hay doble ingreso** aunque dos anfitriones escaneen el mismo QR a la vez.

---

## Modelo de datos

```
users ──< tenant_members >── tenants ──< events ──< event_dates ──< registrations
                                              └─────────────────────────┘ (FK compuesta: la fecha pertenece al evento)
```

| Tabla | Contenido clave |
|---|---|
| `users` | Correo, nombre, contraseña (scrypt), `is_platform_admin` (SuperAdmin), `must_change_password` |
| `tenants` | Empresa cliente: nombre, slug, RUC, contacto |
| `tenant_members` | Usuario ↔ cliente con rol `CLIENT_ADMIN` o `HOST` |
| `events` | Branding (`logo_url`, `primary_color`), `slug` único, `companion_mode`, zona horaria, publicado/abierto |
| `event_dates` | Día, hora inicio/fin, `capacity`, `registered_count` (cupos ocupados; `CHECK registered_count <= capacity`) |
| `registrations` | Titular, acompañante, `token` único (lo que va en el QR), `seats` (1 o 2), estado `REGISTRADO / CHECKED_IN / CANCELADO`, hora de ingreso de titular y de acompañante, quién lo acreditó |
| `promoters` / `event_promoters` | Directorio de promotores por cliente y su asignación a eventos, con enlace (`access_key`) revocable |
| `promoter_checkins` | Auditoría: qué promotor acreditó a quién, qué (titular/acompañante/ambos) y cuándo |
| `assets` | Logos guardados en la base cuando no hay Spaces |

Funciones SQL (la lógica crítica vive en la base de datos):

- `register_attendee(..., p_admin)`: valida evento publicado, fecha vigente y reglas de acompañante; reserva cupos con un `UPDATE ... WHERE registered_count + seats <= capacity` e inserta el registro en la misma transacción. Errores: `SOLD_OUT`, `DUPLICATE`, `EVENT_CLOSED`, `DATE_PAST`, `COMPANION_REQUIRED`… Con `p_admin = true` (importación) no exige evento publicado/abierto ni fecha futura; aforo, duplicados y reglas de acompañante se mantienen.
- `check_in(registration_id, event_date_id, target, user_id)`: `SELECT ... FOR UPDATE`; devuelve `OK / ALREADY / WRONG_DATE / CANCELLED / NOT_FOUND`.
- `cancel_registration(id)`: cancela y devuelve los cupos.
- Vista `event_date_stats` para los contadores del check-in.

**Seguridad:**
- Contraseñas con scrypt; sesión en cookie `httpOnly` firmada (7 días). Cambiar la contraseña cierra las demás sesiones.
- Límite de 8 intentos de login por correo + IP cada 15 minutos; el login correcto reinicia su contador. Recuperación de ticket: un intento por evento + correo cada minuto. Ambos controles tienen memoria acotada y son **por proceso**: no sustituyen un límite compartido entre instancias ni la protección del proxy frente a abuso distribuido.
- Cada consulta del panel y del check-in filtra por los clientes del usuario (`src/lib/auth.ts`); un usuario de otro cliente recibe 404.
- Todas las consultas son parametrizadas.
- Un documento solo puede tener un registro activo por fecha (índice único parcial).

---

## Estructura

```
.do/app.yaml                  Especificación de DigitalOcean App Platform
db/
  migrations/0001_init.sql    Esquema y funciones
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
      clientes/page.tsx       Clientes y equipo
      eventos/nuevo/          Crear evento
      eventos/[id]/           Fechas, registros, branding
      eventos/[id]/exportar/  GET → .xlsx / .csv
    evento/[slug]/
      page.tsx                Portal público con branding
      actions.ts              registerAttendee (Zod + función SQL + correo)
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
- `npm test`: redirecciones seguras del login, límites de intentos, validación Zod y exportación Excel.
- `tests/import-db.test.mjs`: esquema, importación con token QR, duplicados, aforo con conexiones concurrentes y modo administrador (evento sin publicar).
- `tests/promoters-db.test.mjs`: tablas, enlaces únicos y auditoría de promotores.
- `tests/logo-colors.test.mjs`: extracción de colores del logo.
- `npm run typecheck` y `npm run build`.

Manual en Chrome sobre una base con datos previos actualizada de la migración 0003 a la 0006:
- Registro público con acompañante → ticket QR → duplicado rechazado.
- Importación de un Excel con 6 filas en un evento sin publicar: 2 importadas con ticket por correo y 4 rechazadas con su motivo.
- Promotor: alta → asignación → acreditación desde su enlace → “Acreditado por” en el panel y en el CSV.
- Revocar con la consola abierta → “Enlace sin acceso” al seleccionar y al buscar.
- Enlace general de acreditación sin login. Enlaces inexistentes responden 404.
- Concurrencia: 80 registros simultáneos sobre un aforo de 50 → exactamente 50.

## Siguientes pasos sugeridos

- Rate limiting / CAPTCHA (p. ej. Cloudflare Turnstile) en el formulario público.
- Cupos en tiempo real con Server-Sent Events en lugar de polling.
- Recuperación de contraseña por correo.
- Modo offline del check-in (cache local de registros del día y sincronización).
- Campos personalizados por evento y reenvío del ticket desde el panel.
