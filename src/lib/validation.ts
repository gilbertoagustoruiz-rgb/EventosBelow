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
    company: optionalText(120),
    jobTitle: optionalText(120),
    hasCompanion: z.boolean(),
    companionFullName: optionalText(120),
    companionDocumentType: z.enum(DOCUMENT_TYPES).optional(),
    companionDocumentNumber: normDoc.optional(),
  })
  .superRefine((d, ctx) => {
    const holderRule = DOCUMENT_RULES[d.documentType];
    if (!holderRule.re.test(d.documentNumber)) {
      ctx.addIssue({ code: "custom", path: ["documentNumber"], message: holderRule.hint });
    }
    if (!d.hasCompanion) return;

    if (!d.companionFullName || d.companionFullName.length < 3) {
      ctx.addIssue({ code: "custom", path: ["companionFullName"], message: "Ingresa el nombre del acompañante" });
    }
    if (!d.companionDocumentType) {
      ctx.addIssue({ code: "custom", path: ["companionDocumentType"], message: "Selecciona el tipo de documento" });
      return;
    }
    const rule = DOCUMENT_RULES[d.companionDocumentType];
    if (!d.companionDocumentNumber || !rule.re.test(d.companionDocumentNumber)) {
      ctx.addIssue({ code: "custom", path: ["companionDocumentNumber"], message: rule.hint });
    } else if (
      d.companionDocumentNumber === d.documentNumber &&
      d.companionDocumentType === d.documentType
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["companionDocumentNumber"],
        message: "El acompañante no puede tener tu mismo documento",
      });
    }
  });

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
