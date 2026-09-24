/**
 * Garde-fou §13 : AUCUN trading — ni live ni paper.
 * Vérifie statiquement qu'aucun fichier/route/module de trading n'existe
 * dans `src/` (hors mentions explicites d'interdiction).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

describe("hors-scope : aucun module trading", () => {
  it("aucun fichier *trade* / *swap* / *perp* / *futures* dans src/", () => {
    const files = walk(SRC).map((f) => f.toLowerCase());
    const suspects = files.filter((f) =>
      /trade|swap|perp|futures|leverage|long_short/.test(f.split("/").pop() ?? ""),
    );
    expect(suspects).toEqual([]);
  });

  it("aucune route /trade dans les routes HTTP", () => {
    const files = walk(join(SRC, "routes"));
    for (const file of files) {
      const content = readFileSync(file, "utf8").toLowerCase();
      expect(content, file).not.toMatch(/\/trade|\/swap|\/perp/);
    }
  });

  it("index.ts ne monte aucune route trading (mentions d'interdiction OK)", () => {
    const content = readFileSync(join(SRC, "index.ts"), "utf8");
    // Interdit : monter une route /trade, /swap… — autorisé : documenter l'interdiction.
    expect(content).not.toMatch(/route\(['"]\/(trade|swap|perp|futures)/);
    expect(content).not.toMatch(/\/trade\/|\/swap\//);
  });
});
