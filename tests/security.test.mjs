import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Usa el compilador ya instalado para ejecutar los helpers también en Node 20.
async function loadHelper(name) {
  const source = await readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  const resolved = outputText.replace('from "zod"', `from ${JSON.stringify(import.meta.resolve("zod"))}`);
  return import(`data:text/javascript;base64,${Buffer.from(resolved).toString("base64")}`);
}
const { safeNext } = await loadHelper("safe-next");
const { createRateLimiter } = await loadHelper("rate-limit");

test("login conserva rutas locales, parámetros y fragmentos", () => {
  for (const path of ["/", "/admin", "/checkin/123?fecha=1#lector"]) assert.equal(safeNext(path), path);
});

test("login rechaza destinos externos y variantes normalizadas por el navegador", () => {
  for (const path of [undefined, "https://evil.test", "//evil.test", "/\\evil.test", "/\t/evil.test", "/\n/evil.test", "///evil.test", "/admin\u0000"]) {
    assert.equal(safeNext(path), "/admin");
  }
});

test("intentos simultáneos consumen el límite antes de esperar operaciones asíncronas", async () => {
  const limiter = createRateLimiter(8, 1000);
  const results = await Promise.all(Array.from({ length: 20 }, async () => limiter.consume("user", 100)));
  assert.equal(results.filter(Boolean).length, 8);
  assert.equal(limiter.consume("other", 100), true);
});

test("la ventana no se extiende con cada intento y expira en el límite", () => {
  const limiter = createRateLimiter(2, 1000);
  assert.equal(limiter.consume("user", 100), true);
  assert.equal(limiter.consume("user", 500), true);
  assert.equal(limiter.consume("user", 1099), false);
  assert.equal(limiter.consume("user", 1100), true);
});

test("llenar la memoria no borra bloqueos y las entradas vencidas liberan espacio", () => {
  const limiter = createRateLimiter(1, 1000, 2);
  assert.equal(limiter.consume("a", 100), true);
  assert.equal(limiter.consume("b", 100), true);
  assert.equal(limiter.consume("c", 100), false);
  assert.equal(limiter.consume("a", 100), false);
  assert.equal(limiter.consume("c", 1100), true);
});

test("login correcto permite reiniciar el contador de su clave", () => {
  const limiter = createRateLimiter(1, 1000);
  assert.equal(limiter.consume("a", 100), true);
  limiter.reset("a");
  assert.equal(limiter.consume("a", 100), true);
});

test("Zod valida y normaliza inscripciones y conserva errores por campo", async () => {
  const { registrationSchema, flattenErrors } = await loadHelper("validation");
  const input = {
    eventDateId: "123e4567-e89b-42d3-a456-426614174000", fullName: "Ana Pérez",
    email: "ANA@example.com", phone: "999123456", documentType: "DNI",
    documentNumber: "12.345.678",
  };
  const valid = registrationSchema.parse(input);
  assert.equal(valid.email, "ana@example.com");
  assert.equal(valid.documentNumber, "12345678");
  assert.deepEqual(valid.companions, []);
  const invalid = registrationSchema.safeParse({ ...input, companions: [{ fullName: "Luis Pérez", documentType: "DNI", documentNumber: "12345678" }] });
  assert.equal(invalid.success, false);
  assert.match(flattenErrors(invalid.error)["companions.0.documentNumber"], /mismo documento/);
  const repeated = registrationSchema.safeParse({ ...input, companions: [
    { fullName: "Luis Pérez", documentType: "DNI", documentNumber: "87654321" },
    { fullName: "Rosa Pérez", documentType: "DNI", documentNumber: "87654321" },
  ] });
  assert.match(flattenErrors(repeated.error)["companions.1.documentNumber"], /repetido/);
  assert.equal(registrationSchema.safeParse({ ...input, email: "invalid", documentNumber: "123" }).success, false);
});

test("ExcelJS escribe y lee exportaciones con formato condicional tras actualizar uuid", async () => {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Registros");
  sheet.addRow(["Nombre", "Cupos"]);
  sheet.addRow(["Ana Pérez", 2]);
  sheet.addConditionalFormatting({ ref: "B2", rules: [{ type: "dataBar", cfvo: [{ type: "min" }, { type: "max" }], color: { argb: "FF00FF00" } }] });
  const buffer = await workbook.xlsx.writeBuffer();
  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(buffer);
  assert.equal(restored.getWorksheet("Registros").getCell("A2").value, "Ana Pérez");
  assert.equal(restored.getWorksheet("Registros").getCell("B2").value, 2);
});
