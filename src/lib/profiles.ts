/** Perfiles fijos de Eventos Below y lo que puede hacer cada uno. */
export type Profile = "ADMINISTRADOR" | "COORDINADOR" | "PROMOTOR";

export const PROFILES: Record<
  Profile,
  { label: string; summary: string; access: string; can: string[]; cannot: string[] }
> = {
  ADMINISTRADOR: {
    label: "Administrador general",
    summary: "Personal de Below Trade que configura la plataforma.",
    access: "Correo y contraseña",
    can: [
      "Crear y editar clientes",
      "Crear empleados (administradores, coordinadores y promotores) y activarlos o desactivarlos",
      "Asignar coordinadores y promotores a cada cliente",
      "Ver y gestionar todos los eventos de todos los clientes",
      "Acreditar asistentes con su cuenta",
    ],
    cannot: [],
  },
  COORDINADOR: {
    label: "Coordinador",
    summary: "Organiza los eventos de los clientes que tiene asignados.",
    access: "Correo y contraseña",
    can: [
      "Crear y configurar eventos de sus clientes: logo, color, fechas, aforo y acompañante",
      "Ver, buscar, cancelar, importar (Excel) y exportar inscripciones",
      "Seleccionar, para cada evento, promotores asignados a su cliente y retirarlos",
      "Compartir o regenerar el enlace general de acreditación del evento",
      "Acreditar asistentes con su cuenta",
    ],
    cannot: ["Crear clientes", "Crear empleados ni contraseñas", "Asignar empleados a clientes"],
  },
  PROMOTOR: {
    label: "Promotor",
    summary: "Acredita asistentes el día del evento.",
    access: "Enlace personal por evento (sin contraseña)",
    can: [
      "Escanear el QR o buscar por DNI, nombre o correo",
      "Marcar el ingreso del titular y del acompañante",
      "Cada ingreso queda registrado a su nombre",
    ],
    cannot: ["Entrar al panel de administración", "Ver eventos donde no fue seleccionado"],
  },
};

export const PROFILE_ORDER: Profile[] = ["ADMINISTRADOR", "COORDINADOR", "PROMOTOR"];

/** Perfiles que entran al panel con usuario y contraseña. */
export const hasLogin = (p: Profile) => p !== "PROMOTOR";
