import { z } from "zod";

export const DOCUMENT_TYPES = ["DNI", "CE", "PASAPORTE", "CEDULA"] as const;

export const DOCUMENT_LABELS: Record<(typeof DOCUMENT_TYPES)[number], string> = {
  DNI: "DNI",
  CE: "Carné de extranjería",
  PASAPORTE: "Pasaporte",
  CEDULA: "Cédula",
};

const DOCUMENT_RULES: Record<(typeof DOCUMENT_TYPES)[number], { re: RegExp; hint: string }> = {
  DNI: { re: /^\d{8}$/, hint: "El DNI debe tener 8 dígitos" },
  CE: { re: /^[A-Z0-9]{8,12}$/, hint: "El carné debe tener entre 8 y 12 caracteres" },
  PASAPORTE: { re: /^[A-Z0-9]{6,12}$/, hint: "El pasaporte debe tener entre 6 y 12 caracteres" },
  CEDULA: { re: /^[0-9]{6,12}$/, hint: "La cédula debe tener entre 6 y 12 dígitos" },
};

const normDoc = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase().replace(/[\s.-]/g, ""));

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

/** Valida un número según su tipo de documento. */
export function documentIssue(type: (typeof DOCUMENT_TYPES)[number], number: string | undefined) {
  const rule = DOCUMENT_RULES[type];
  return !number || !rule.re.test(number) ? rule.hint : null;
}

export const companionSchema = z.object({
  fullName: z.string().trim().min(3, "Ingresa el nombre del acompañante").max(120),
  documentType: z.enum(DOCUMENT_TYPES),
  documentNumber: normDoc,
});

const companionsList = z.array(companionSchema).max(10).default([]);

/** Revisa documentos de acompañantes: formato, distinto del titular y sin repetirse. */
function checkCompanions(
  holder: { documentType: string; documentNumber: string } | null,
  companions: z.infer<typeof companionSchema>[],
  ctx: z.RefinementCtx,
) {
  const seen = new Set<string>();
  companions.forEach((c, i) => {
    const issue = documentIssue(c.documentType, c.documentNumber);
    if (issue) ctx.addIssue({ code: "custom", path: ["companions", i, "documentNumber"], message: issue });
    else if (holder && c.documentNumber === holder.documentNumber && c.documentType === holder.documentType) {
      ctx.addIssue({ code: "custom", path: ["companions", i, "documentNumber"], message: "El acompañante no puede tener el mismo documento del titular" });
    } else if (seen.has(c.documentType + c.documentNumber)) {
      ctx.addIssue({ code: "custom", path: ["companions", i, "documentNumber"], message: "Documento repetido entre acompañantes" });
    }
    seen.add(c.documentType + c.documentNumber);
  });
}

/** Inscripción completa (titular + acompañantes). */
export const registrationSchema = z
  .object({
    eventDateId: z.string().uuid({ message: "Selecciona una fecha" }),
    fullName: z.string().trim().min(3, "Ingresa tu nombre completo").max(120),
    email: z.string().trim().toLowerCase().email("Correo no válido"),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9\s-]{7,20}$/, "Teléfono no válido"),
    documentType: z.enum(DOCUMENT_TYPES),
    documentNumber: normDoc,
    employeeCode: optionalText(40),
    company: optionalText(120),
    jobTitle: optionalText(120),
    companions: companionsList,
  })
  .superRefine((d, ctx) => {
    const issue = documentIssue(d.documentType, d.documentNumber);
    if (issue) ctx.addIssue({ code: "custom", path: ["documentNumber"], message: issue });
    checkCompanions(d, d.companions, ctx);
  });

/**
 * Confirmación del asistente que ya está en la base precargada: sus datos vienen de la base;
 * solo elige fecha, confirma contacto y registra acompañantes.
 */
export const confirmationSchema = z
  .object({
    inviteeId: z.string().uuid(),
    eventDateId: z.string().uuid({ message: "Selecciona el día en que asistirás" }),
    email: z.union([z.literal(""), z.string().trim().toLowerCase().email("Correo no válido")]).optional(),
    phone: z.union([z.literal(""), z.string().trim().regex(/^\+?[0-9\s-]{7,20}$/, "Celular no válido")]).optional(),
    companions: companionsList,
  })
  .superRefine((d, ctx) => checkCompanions(null, d.companions, ctx));

export type ConfirmationInput = z.input<typeof confirmationSchema>;

export type RegistrationInput = z.input<typeof registrationSchema>;

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Solo minúsculas, números y guiones (ej: convencion-2026)")
  .max(60);

export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color no válido");

/** Convierte "Convención Anual 2026" → "convencion-anual-2026" */
export function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function flattenErrors(error: z.ZodError) {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
