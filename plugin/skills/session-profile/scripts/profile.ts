#!/usr/bin/env bun
/**
 * session-profile — active/desactive des plugins Claude Code pour le repertoire courant,
 * via <CWD>/.claude/settings.local.json (scope `local`, gitignore globalement chez Romain).
 *
 * Verifie le 2026-08-06 sur Claude Code 2.1.223 :
 *   - enabledPlugins en scope local surcharge ~/.claude/settings.json dans les deux sens
 *   - /reload-plugins applique le changement en session (pas de redemarrage)
 *
 * Aucun plugin n'est code en dur ici : tout vient de ../profiles.json.
 */

import {
  readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync, statSync,
} from "node:fs";
import { join, dirname, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CFG_PATH = resolve(HERE, "..", "profiles.json");

type LspRule = { plugin: string; files: string[]; ext: string[]; note?: string };
type Cfg = {
  alwaysOn: string[];
  domains: Record<string, string[]>;
  lspDetect: LspRule[];
};

const cfg: Cfg = JSON.parse(readFileSync(CFG_PATH, "utf8"));

const short = (id: string): string => id.split("@")[0];

// ---------------------------------------------------------------- settings

function settingsPath(cwd: string): string {
  return join(cwd, ".claude", "settings.local.json");
}

function readSettings(cwd: string): Record<string, unknown> {
  const p = settingsPath(cwd);
  if (!existsSync(p)) return {};
  const raw = readFileSync(p, "utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `${p} est illisible (JSON invalide) : ${(e as Error).message}\n` +
      `Corrige-le a la main avant de relancer — je n'ecrase jamais un fichier que je ne sais pas relire.`,
    );
  }
}

/** Ecrit en fusionnant : les autres cles du fichier (permissions, env, hooks...) sont preservees. */
function writeSettings(cwd: string, enabled: Record<string, boolean>): string {
  const p = settingsPath(cwd);
  const dir = dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const current = readSettings(cwd);
  if (existsSync(p)) copyFileSync(p, `${p}.bak`);

  if (Object.keys(enabled).length === 0) delete current.enabledPlugins;
  else current.enabledPlugins = enabled;

  writeFileSync(p, JSON.stringify(current, null, 2) + "\n", "utf8");
  return p;
}

// ---------------------------------------------------------------- detection LSP

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "target", ".venv", "venv", "__pycache__",
  ".next", ".turbo", "vendor", ".cache", "coverage", ".claude",
]);

function scanExtensions(cwd: string, maxDepth = 2, budget = 3000): Set<string> {
  const found = new Set<string>();
  let seen = 0;
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth || seen > budget) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (seen++ > budget) return;
      if (name.startsWith(".") && name !== ".github") continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(full, depth + 1);
      } else {
        const e = extname(name).toLowerCase();
        if (e) found.add(e);
      }
    }
  };
  walk(cwd, 0);
  return found;
}

/**
 * LSP du projet. Les regles avec `files` non vide sont primaires (langage principal) :
 * un marqueur racine suffit. Les regles sans marqueur (bash, yaml) sont secondaires et
 * ne s'activent que sur presence effective de fichiers.
 */
function detectLsp(cwd: string): { plugins: string[]; why: string[] } {
  const plugins: string[] = [];
  const why: string[] = [];
  let root: Set<string>;
  try {
    root = new Set(readdirSync(cwd));
  } catch {
    root = new Set();
  }

  const primaries = cfg.lspDetect.filter((d) => d.files.length > 0);
  const secondaries = cfg.lspDetect.filter((d) => d.files.length === 0);

  for (const d of primaries) {
    const hit = d.files.find((f) => root.has(f));
    if (hit) {
      plugins.push(d.plugin);
      why.push(`${short(d.plugin)} <- ${hit}`);
    }
  }

  const exts = scanExtensions(cwd);
  if (plugins.length === 0) {
    for (const d of primaries) {
      const hit = d.ext.find((e) => exts.has(e));
      if (hit) {
        plugins.push(d.plugin);
        why.push(`${short(d.plugin)} <- fichiers ${hit}`);
      }
    }
  }
  for (const d of secondaries) {
    const hit = d.ext.find((e) => exts.has(e));
    if (hit) {
      plugins.push(d.plugin);
      why.push(`${short(d.plugin)} <- fichiers ${hit}`);
    }
  }
  return { plugins: [...new Set(plugins)], why };
}

// ---------------------------------------------------------------- resolution

/** Tous les ids connus du JSON, pour resoudre un nom court (`firecrawl`) en id complet. */
function knownIds(): string[] {
  return [...new Set([...cfg.alwaysOn, ...cfg.lspDetect.map((d) => d.plugin), ...Object.values(cfg.domains).flat()])];
}

/** `a, b c` -> [a, b, c] : virgules et espaces sont des separateurs equivalents. */
function splitNames(args: string[]): string[] {
  return args.flatMap((a) => a.split(/[,\s]+/)).map((n) => n.trim()).filter(Boolean);
}

/**
 * Un nom = un domaine, un nom court de plugin, ou un id complet `plugin@marketplace`.
 * Le domaine `lsp` n'active jamais ses 8 serveurs en bloc (vtsls et typescript-lsp
 * se marchent dessus) : il se reduit a la detection.
 */
function resolveName(name: string, cwd: string): { plugins: string[]; error?: string } {
  if (name === "lsp") return { plugins: detectLsp(cwd).plugins };
  if (cfg.domains[name]) return { plugins: [...cfg.domains[name]] };
  if (name.includes("@")) return { plugins: [name] };
  const matches = knownIds().filter((id) => short(id) === name);
  if (matches.length === 1) return { plugins: matches };
  if (matches.length > 1) return { plugins: [], error: `${name} ambigu (${matches.join(", ")}) : donne l'id complet` };
  return { plugins: [], error: `${name} inconnu` };
}

// ---------------------------------------------------------------- affichage

function renderList(): string {
  const names = Object.keys(cfg.domains).filter((n) => n !== "lsp");
  const width = Math.max(...names.map((n) => n.length)) + 2;
  const L = ["Profils"];
  for (const name of names) {
    L.push(`  ${`${name}:`.padEnd(width)} ${cfg.domains[name].map(short).join(", ")}`);
  }
  return L.join("\n");
}

function renderState(cwd: string, path: string, why: string[]): string {
  const enabled = (readSettings(cwd).enabledPlugins ?? {}) as Record<string, boolean>;
  const on = Object.keys(enabled).filter((k) => enabled[k]).sort();
  const off = Object.keys(enabled).filter((k) => !enabled[k]).sort();
  const L = [`Ecrit : ${path}`, ""];
  L.push(on.length ? `Actifs ici (${on.length}) : ${on.map(short).join(", ")}` : "Aucun plugin active ici : la session retombe sur le global.");
  if (off.length) L.push(`Coupes ici (${off.length}) : ${off.map(short).join(", ")}`);
  if (why.length) L.push(`LSP detecte : ${why.join(", ")}`);
  L.push("", ">> Lance /reload-plugins pour appliquer maintenant (pas de redemarrage requis).");
  return L.join("\n");
}

// ---------------------------------------------------------------- entree

function main() {
  const argv = process.argv.slice(2);
  let cwd = process.cwd();
  const ci = argv.indexOf("--cwd");
  if (ci !== -1) {
    cwd = resolve(argv[ci + 1] ?? ".");
    argv.splice(ci, 2);
  }
  const cmd = argv[0] ?? "list";
  const names = splitNames(argv.slice(1));

  if (cmd === "list") {
    console.log(renderList());
    return;
  }
  if (cmd !== "add" && cmd !== "rm") {
    console.error(`Commandes : list | add <noms> | rm <noms>\nOption : --cwd <chemin>\n\n${renderList()}`);
    process.exit(2);
  }
  if (!names.length) {
    console.error(`Usage : profile.ts ${cmd} <profil|plugin|plugin@marketplace> [, ...]\n\n${renderList()}`);
    process.exit(2);
  }

  const plugins = new Set<string>();
  const errors: string[] = [];
  for (const n of names) {
    const r = resolveName(n, cwd);
    if (r.error) errors.push(r.error);
    r.plugins.forEach((p) => plugins.add(p));
  }
  if (errors.length) {
    console.error(`${errors.join("\n")}\n\n${renderList()}`);
    process.exit(2);
  }

  const next = { ...((readSettings(cwd).enabledPlugins ?? {}) as Record<string, boolean>) };
  let why: string[] = [];
  if (cmd === "add") {
    // Le LSP du langage suit chaque ajout, sans rien demander.
    const det = detectLsp(cwd);
    det.plugins.forEach((p) => plugins.add(p));
    why = det.why;
    for (const p of plugins) next[p] = true;
  } else {
    for (const p of plugins) delete next[p];
  }
  console.log(renderState(cwd, writeSettings(cwd, next), why));
}

main();
