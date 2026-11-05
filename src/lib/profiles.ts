/** Perfiles fijos de Eventos Below y lo que puede hacer cada uno. */
export type Profile = "ADMINISTRADOR" | "COORDINADOR" | "SUPERVISOR" | "PROMOTOR";

export const PROFILES: Record<
  Profile,
  { label: string; summary: string; access: string; can: string[]; cannot: string[] }
> = {
  ADMINISTRADOR: {
    label: "Administrador general",
    summary: "Personal de Below Trade que configura la plataforma.",
    access: "Correo o DNI y contraseña",
    can: [
      "Crear clientes y sus proyectos",
      "Crear eventos en cualquier proyecto",
      "Crear usuarios de cualquier perfil y activarlos o desactivarlos",
      "Asignar coordinadores a cada cliente",
      "Ver y gestionar todos los eventos, su dashboard y su personal",
    ],
    cannot: [],
  },
  COORDINADOR: {
    label: "Coordinador",
    summary: "Organiza los eventos de los clientes que tiene asignados.",
    access: "Correo o DNI y contraseña",
    can: [
      "Crear, ver y editar eventos de sus clientes: fechas, aforo, acompañantes, branding",
      "Cargar la base de invitados (Excel) y gestionar inscripciones",
      "Agregar o quitar supervisores y promotores en cada evento",
      "Ver el dashboard: ingresos, horas pico, acompañantes y gestión del personal",
      "Acreditar asistentes",
    ],
    cannot: ["Crear clientes ni proyectos", "Crear usuarios", "Asignar coordinadores"],
  },
  SUPERVISOR: {
    label: "Supervisor del evento",
    summary: "Controla la acreditación en los eventos donde lo agregaron.",
    access: "Correo o DNI y contraseña",
    can: [
      "Ver el dashboard del evento y toda la gestión de los promotores",
      "Agregar o quitar promotores del evento",
      "Acreditar asistentes",
    ],
    cannot: ["Editar el evento", "Agregar supervisores", "Ver eventos donde no fue agregado"],
  },
  PROMOTOR: {
    label: "Promotor del evento",
    summary: "Confirma la asistencia en el ingreso.",
    access: "Correo o DNI y contraseña",
    can: [
      "Buscar por DNI o código de vendedor, o escanear el QR",
      "Confirmar el ingreso del asistente y de cada acompañante",
      "Ver la alerta si la persona ya ingresó y a qué hora",
    ],
    cannot: ["Entrar al panel de administración", "Ver eventos donde no fue agregado"],
  },
};

export const PROFILE_ORDER: Profile[] = ["ADMINISTRADOR", "COORDINADOR", "SUPERVISOR", "PROMOTOR"];

/** Todos los perfiles ingresan con usuario y contraseña. */
export const hasLogin = (_p: Profile) => true;

export const STAFF_PROFILES = ["SUPERVISOR", "PROMOTOR"] as const;
