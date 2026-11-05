import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
async function load(name) {
  const source = await readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}
const { logoPalette } = await load("logo-colors");
const { readableOn } = await load("format");
const pixels = (...groups) => groups.flatMap(([rgba, count]) => Array.from({ length: count }, () => rgba).flat());

test("el logo prioriza el color de marca sobre el fondo blanco y texto negro", () => {
  assert.equal(logoPalette(pixels([[255,255,255,255],80], [[0,0,0,255],40], [[220,20,40,255],20]))[0], "#dc1428");
});
test("ignora píxeles transparentes y admite logos monocromáticos", () => {
  assert.deepEqual(logoPalette(pixels([[0,255,0,0],100], [[30,30,30,255],10])), ["#1e1e1e"]);
  assert.deepEqual(logoPalette(pixels([[255,255,255,255],20])), []);
  assert.deepEqual(logoPalette([]), []);
});
test("los colores mayoritarios ordenan la paleta y los similares se agrupan", () => {
  const palette = logoPalette(pixels([[20,80,220,255],50], [[22,82,222,255],20], [[240,120,20,255],25]));
  assert.equal(palette.length, 2);
  assert.equal(palette[1], "#f07814");
});
test("el texto se adapta a tonos claros, oscuros y medios", () => {
  assert.equal(readableOn("#ffffff"), "#0f172a");
  assert.equal(readableOn("#000000"), "#ffffff");
  assert.equal(readableOn("#888888"), "#0f172a");
  assert.equal(readableOn("#ffff00"), "#0f172a");
});
