#!/usr/bin/env bun
/**
 * digest.ts — extraction mécanique des transcripts Claude Code (.jsonl) en digests markdown.
 * Partie de la skill `session-retro` du plugin `erom-session`. Zéro dépendance hors bun.
 *
 * Usage :
 *   bun digest.ts --dir ~/.claude/projects/<slug> [--from ISO] [--to ISO] --out <dossier>
 *
 * Temps : les transcripts Claude Code horodatent en UTC (suffixe Z) ; TOUT l'affichage est
 * converti en heure locale, fuseau annoncé dans chaque sortie, DST géré par timestamp (rétro
 * 2026-07-18 : l'UTC brut décalait de 2h toutes les timelines des lecteurs face à git).
 * Les bornes --from/--to s'interprètent en heure locale ; une date seule vaut journée entière
 * (00:00:00 pour --from, 23:59:59.999 pour --to) ; un suffixe Z/offset reste accepté.
 *
 * Sortie : un digest .md par session + _index.md global, dans --out.
 * Les digests peuvent contenir des données sensibles : à écrire dans un scratchpad, jamais dans un repo.
 *
 * Format d'entrée : interne à Claude Code, non documenté (ancré sur échantillons réels du
 * 7 juillet 2026, Claude Code 2.1.198). Le parseur tolère les champs manquants et compte les
 * types de lignes inconnus sans planter.
 */

// ---------- Types ----------

export interface PromptEntry {
  ts: string | null;
  text: string;
}

export type DigestEvent =
  | { kind: "tool_error"; ts: string | null; text: string; count: number }
  | { kind: "quota_cut"; ts: string | null; text: string }
  | { kind: "permission_mode"; ts: string | null; mode: string }
  | { kind: "agent_dispatch"; ts: string | null; description: string; subagentType: string };

export interface SessionDigest {
  sessionId: string;
  file: string;
  firstTs: string | null;
  lastTs: string | null;
  version: string | null;
  gitBranches: string[];
  models: Record<string, number>;
  prompts: PromptEntry[];
  commands: string[];
  events: DigestEvent[];
  stats: {
    totalLines: number;
    userPrompts: number;
    assistantLines: number;
    toolCalls: Record<string, number>;
    outputTokens: number;
    toolErrors: number;
    quotaCuts: number;
    taskNotifications: number;
    base64Lines: number;
    base64Chars: number;
    otherTypes: Record<string, number>;
    unknownTypes: Record<string, number>;
  };
  warnings: string[];
}

// Types de lignes connus du format (au 7 juillet 2026) — tout autre type est compté "inconnu".
const KNOWN_TYPES = new Set([
  "user", "assistant", "system", "attachment", "queue-operation", "permission-mode",
  "mode", "last-prompt", "ai-title", "bridge-session", "file-history-snapshot", "summary",
]);

const NOISE_PREFIXES = [
  "<local-command-caveat>", "<local-command-stdout>", "<local-command-stderr>",
  "<system-reminder>", "<command-message>", "<command-args>",
];

// ---------- Classification du contenu user ----------

export type UserContentClass =
  | { kind: "prompt"; text: string }
  | { kind: "command"; command: string }
  | { kind: "task_notification" }
  | { kind: "noise" };

export function classifyUserContent(content: string, isMeta: boolean): UserContentClass {
  const trimmed = content.trim();
  if (trimmed === "") return { kind: "noise" };
  const cmd = trimmed.match(/<command-name>(\/[^<]+)<\/command-name>/);
  if (cmd) return { kind: "command", command: cmd[1].trim() };
  if (trimmed.startsWith("<task-notification>")) return { kind: "task_notification" };
  if (NOISE_PREFIXES.some((p) => trimmed.startsWith(p))) return { kind: "noise" };
  if (isMeta) return { kind: "noise" };
  return { kind: "prompt", text: trimmed };
}

// ---------- Helpers ----------

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && typeof (b as any).text === "string" ? (b as any).text : ""))
      .join(" ")
      .trim();
  }
  return String(content ?? "");
}

function bump(rec: Record<string, number>, key: string): void {
  rec[key] = (rec[key] ?? 0) + 1;
}

// Blobs base64 embarqués (images, pièces jointes) — rétro 2026-07-08 : une image swarm
// = 1 ligne JSONL de ~990k chars, 90 % du transcript de la session. On les compte et on les
// exclut de tout texte rendu dans un digest.
const BASE64_RUN = /[A-Za-z0-9+\/=_-]{1000,}/g;

export function stripBase64(text: string): string {
  return text.replace(BASE64_RUN, (m) => `[base64 ~${Math.round(m.length / 1024)} Ko tronqué]`);
}

export function formatDuration(firstTs: string | null, lastTs: string | null): string {
  if (!firstTs || !lastTs) return "inconnue";
  const ms = new Date(lastTs).getTime() - new Date(firstTs).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "inconnue";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${m}min`;
}

// ---------- Temps local ----------
// Conversion UTC → fuseau demandé via Intl (offset résolu par timestamp : un chantier qui
// chevauche un changement d'heure reste juste). Le paramètre zone n'est explicité que par
// les tests ; le CLI utilise le fuseau de la machine.

export const SYSTEM_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

function localParts(ts: string, zone: string): { date: string; hm: string; hms: string } | null {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("fr-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "??";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const hm = `${get("hour")}:${get("minute")}`;
  return { date, hm, hms: `${hm}:${get("second")}` };
}

export function localDay(ts: string | null, zone: string = SYSTEM_ZONE): string {
  if (!ts) return "date inconnue";
  return localParts(ts, zone)?.date ?? ts.slice(0, 10);
}

export function localHm(ts: string | null, zone: string = SYSTEM_ZONE): string {
  if (!ts) return "--:--";
  return localParts(ts, zone)?.hm ?? ts.slice(11, 16);
}

export function localDateTime(ts: string | null, zone: string = SYSTEM_ZONE): string {
  if (!ts) return "?";
  const p = localParts(ts, zone);
  return p ? `${p.date} ${p.hms}` : ts;
}

// Borne --from/--to → epoch ms. Date seule complétée en journée locale entière ;
// date-heure sans offset = heure locale (sémantique native de new Date) ; Z/offset respectés.
export function parseBoundary(arg: string | null, endOfDay: boolean): number | null {
  if (!arg) return null;
  let s = arg;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += endOfDay ? "T23:59:59.999" : "T00:00:00";
  const ms = new Date(s).getTime();
  if (Number.isNaN(ms)) throw new Error(`Borne temporelle invalide : ${arg}`);
  return ms;
}

// ---------- Parseur ----------

export function parseTranscript(lines: string[], file: string): SessionDigest {
  const d: SessionDigest = {
    sessionId: "", file, firstTs: null, lastTs: null, version: null,
    gitBranches: [], models: {}, prompts: [], commands: [], events: [],
    stats: {
      totalLines: 0, userPrompts: 0, assistantLines: 0, toolCalls: {}, outputTokens: 0,
      toolErrors: 0, quotaCuts: 0, taskNotifications: 0, base64Lines: 0, base64Chars: 0,
      otherTypes: {}, unknownTypes: {},
    },
    warnings: [],
  };
  let totalChars = 0;
  const branches = new Set<string>();
  // Dédup des erreurs d'outils par texte normalisé → on garde la 1re occurrence + compte.
  const errorIndex = new Map<string, Extract<DigestEvent, { kind: "tool_error" }>>();

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") continue;
    d.stats.totalLines++;
    totalChars += line.length;
    if (line.length >= 1000) {
      const runs = line.match(BASE64_RUN);
      if (runs) {
        d.stats.base64Lines++;
        for (const r of runs) d.stats.base64Chars += r.length;
      }
    }
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      bump(d.stats.unknownTypes, "(json invalide)");
      continue;
    }
    const ts: string | null = typeof obj.timestamp === "string" ? obj.timestamp : null;
    if (ts) {
      if (!d.firstTs || ts < d.firstTs) d.firstTs = ts;
      if (!d.lastTs || ts > d.lastTs) d.lastTs = ts;
    }
    if (!d.sessionId && typeof obj.sessionId === "string") d.sessionId = obj.sessionId;
    if (!d.version && typeof obj.version === "string") d.version = obj.version;
    if (typeof obj.gitBranch === "string" && obj.gitBranch !== "") branches.add(obj.gitBranch);

    const type: string = typeof obj.type === "string" ? obj.type : "(sans type)";
    if (!KNOWN_TYPES.has(type)) {
      bump(d.stats.unknownTypes, type);
      continue;
    }

    if (type === "user") {
      const content = obj.message?.content;
      if (typeof content === "string") {
        const cls = classifyUserContent(content, obj.isMeta === true);
        if (cls.kind === "prompt") {
          d.prompts.push({ ts, text: stripBase64(cls.text) });
          d.stats.userPrompts++;
        } else if (cls.kind === "command") {
          d.commands.push(cls.command);
        } else if (cls.kind === "task_notification") {
          d.stats.taskNotifications++;
        }
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || typeof block !== "object") continue;
          if (block.type === "tool_result" && block.is_error === true) {
            d.stats.toolErrors++;
            const text = stripBase64(toolResultText(block.content)).slice(0, 300);
            const key = text.replace(/[0-9a-f-]{8,}/gi, "#").slice(0, 160);
            const existing = errorIndex.get(key);
            if (existing) existing.count++;
            else {
              const ev = { kind: "tool_error" as const, ts, text, count: 1 };
              errorIndex.set(key, ev);
              d.events.push(ev);
            }
          } else if (block.type === "text" && typeof block.text === "string" && obj.isMeta !== true) {
            const cls = classifyUserContent(block.text, false);
            if (cls.kind === "prompt") {
              d.prompts.push({ ts, text: stripBase64(cls.text) });
              d.stats.userPrompts++;
            }
          }
        }
      }
    } else if (type === "assistant") {
      d.stats.assistantLines++;
      if (obj.isApiErrorMessage === true) {
        d.stats.quotaCuts++;
        const text = toolResultText(obj.message?.content).slice(0, 200) || "(coupure API)";
        d.events.push({ kind: "quota_cut", ts, text });
      }
      const model = obj.message?.model;
      if (typeof model === "string") bump(d.models, model);
      const usage = obj.message?.usage;
      if (usage && typeof usage.output_tokens === "number") d.stats.outputTokens += usage.output_tokens;
      const content = obj.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || typeof block !== "object" || block.type !== "tool_use") continue;
          const name = typeof block.name === "string" ? block.name : "(sans nom)";
          bump(d.stats.toolCalls, name);
          if ((name === "Agent" || name === "Task") && block.input && typeof block.input === "object") {
            d.events.push({
              kind: "agent_dispatch", ts,
              description: String(block.input.description ?? "(sans description)"),
              subagentType: String(block.input.subagent_type ?? "(défaut)"),
            });
          }
        }
      }
    } else if (type === "permission-mode") {
      // Ces lignes n'ont pas de timestamp : l'événement est ordonné par position de lecture.
      d.events.push({ kind: "permission_mode", ts, mode: String(obj.permissionMode ?? "(inconnu)") });
    } else {
      bump(d.stats.otherTypes, type);
    }
  }

  d.gitBranches = [...branches];
  const unknownCount = Object.values(d.stats.unknownTypes).reduce((a, b) => a + b, 0);
  if (d.stats.totalLines > 0 && unknownCount / d.stats.totalLines > 0.2) {
    d.warnings.push(
      `${unknownCount}/${d.stats.totalLines} lignes de type inconnu (>20%) — le format a probablement changé, vérifier digest.ts.`,
    );
  }
  if (totalChars > 0 && d.stats.base64Chars / totalChars > 0.5) {
    d.warnings.push(
      `${Math.round((d.stats.base64Chars / totalChars) * 100)}% du transcript est du base64 embarqué ` +
        `(${d.stats.base64Lines} ligne(s), ~${Math.round(d.stats.base64Chars / 1024)} Ko) — ` +
        `le volume du fichier ne reflète pas le travail réel.`,
    );
  }
  return d;
}

// ---------- Fenêtre temporelle ----------

export function inWindow(d: SessionDigest, fromMs: number | null, toMs: number | null): boolean {
  if (!d.firstTs || !d.lastTs) return false;
  const first = Date.parse(d.firstTs);
  const last = Date.parse(d.lastTs);
  if (Number.isNaN(first) || Number.isNaN(last)) return false;
  if (fromMs !== null && last < fromMs) return false;
  if (toMs !== null && first > toMs) return false;
  return true;
}

// ---------- Rendu markdown ----------

function renderEvent(ev: DigestEvent, zone: string): string {
  const when = localHm(ev.ts, zone);
  switch (ev.kind) {
    case "tool_error":
      return `- ${when} · erreur outil (×${ev.count}) : ${ev.text}`;
    case "quota_cut":
      return `- ${when} · **COUPURE QUOTA** : ${ev.text}`;
    case "permission_mode":
      return `- ${when} · permission-mode → ${ev.mode}`;
    case "agent_dispatch":
      return `- ${when} · subagent [${ev.subagentType}] : ${ev.description}`;
  }
}

function renderCounts(rec: Record<string, number>): string {
  const entries = Object.entries(rec).sort((a, b) => b[1] - a[1]);
  return entries.length === 0 ? "aucun" : entries.map(([k, v]) => `${k} ×${v}`).join(", ");
}

export function renderDigest(d: SessionDigest, zone: string = SYSTEM_ZONE): string {
  const day = localDay(d.firstTs, zone);
  const out: string[] = [
    `# Session ${d.sessionId || "(id inconnu)"} — ${day}`,
    "",
    `- Période : ${localDateTime(d.firstTs, zone)} → ${localDateTime(d.lastTs, zone)}, ` +
      `heures locales ${zone} (durée calendaire ${formatDuration(d.firstTs, d.lastTs)})`,
    `- Modèles : ${renderCounts(d.models)}`,
    `- Branche(s) git : ${d.gitBranches.join(", ") || "inconnue"} · Claude Code ${d.version ?? "?"}`,
    `- Transcript brut (deep-dive ciblé uniquement) : ${d.file}`,
    "",
    "## Stats",
    "",
    `- ${d.stats.userPrompts} prompts user · ${d.stats.assistantLines} lignes assistant · ${d.stats.outputTokens} tokens output`,
    `- Tool calls : ${renderCounts(d.stats.toolCalls)}`,
    `- ${d.stats.toolErrors} erreurs d'outils · ${d.stats.quotaCuts} coupure(s) quota · ${d.stats.taskNotifications} notification(s) de subagent`,
    `- Commandes invoquées : ${d.commands.join(", ") || "aucune"}`,
  ];
  if (d.stats.base64Chars > 0) {
    out.push(
      `- Base64 embarqué (images/pièces jointes) : ~${Math.round(d.stats.base64Chars / 1024)} Ko ` +
        `sur ${d.stats.base64Lines} ligne(s) — exclu du digest`,
    );
  }
  for (const w of d.warnings) out.push(`- ⚠️ ${w}`);
  out.push("", "## Événements", "");
  if (d.events.length === 0) out.push("Aucun événement notable.");
  else out.push(...d.events.map((e) => renderEvent(e, zone)));
  out.push("", "## Prompts user (in extenso)", "");
  if (d.prompts.length === 0) out.push("Aucun prompt tapé (session automatisée ou reprise).");
  for (const p of d.prompts) {
    const when = p.ts ? `${localDay(p.ts, zone)} ${localHm(p.ts, zone)}` : "--";
    out.push(`### [${when}]`, "", p.text, "");
  }
  return out.join("\n") + "\n";
}

export function renderIndex(digests: SessionDigest[], zone: string = SYSTEM_ZONE): string {
  const sorted = [...digests].sort((a, b) => (a.firstTs ?? "").localeCompare(b.firstTs ?? ""));
  const total = (f: (d: SessionDigest) => number) => sorted.reduce((acc, d) => acc + f(d), 0);
  const out: string[] = [
    "# Index du chantier — digests de sessions",
    "",
    `${sorted.length} sessions · ${total((d) => d.stats.userPrompts)} prompts user · ` +
      `${total((d) => d.stats.toolErrors)} erreurs d'outils · ${total((d) => d.stats.quotaCuts)} coupures quota · ` +
      `${total((d) => d.stats.outputTokens)} tokens output`,
    "",
    `Heures locales ${zone} (transcripts sources en UTC).`,
    "",
    "| Session | Début | Durée | Prompts | Erreurs | Coupures | Subagents | Tools dominants | Digest |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const d of sorted) {
    const dispatches = d.events.filter((e) => e.kind === "agent_dispatch").length;
    const topTools = Object.entries(d.stats.toolCalls).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k, v]) => `${k}(${v})`).join(" ");
    const debut = d.firstTs ? `${localDay(d.firstTs, zone)} ${localHm(d.firstTs, zone)}` : "?";
    out.push(
      `| ${d.sessionId.slice(0, 8)} | ${debut} | ` +
        `${formatDuration(d.firstTs, d.lastTs)} | ${d.stats.userPrompts} | ${d.stats.toolErrors} | ` +
        `${d.stats.quotaCuts} | ${dispatches} | ${topTools || "-"} | ${d.sessionId.slice(0, 8)}.md |`,
    );
  }
  const warned = sorted.flatMap((d) => d.warnings.map((w) => `- ${d.sessionId.slice(0, 8)} : ${w}`));
  if (warned.length > 0) out.push("", "## Avertissements", "", ...warned);
  return out.join("\n") + "\n";
}

// ---------- CLI ----------

function parseArgs(argv: string[]): { dir: string; from: string | null; to: string | null; out: string } {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  const dir = get("--dir");
  const out = get("--out");
  if (!dir || !out) {
    console.error("Usage : bun digest.ts --dir <dossier .jsonl> [--from ISO] [--to ISO] --out <dossier sortie>");
    process.exit(2);
  }
  return { dir, from: get("--from"), to: get("--to"), out };
}

async function main(): Promise<void> {
  const { dir, from, to, out } = parseArgs(process.argv.slice(2));
  const { readdirSync, mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  mkdirSync(out, { recursive: true });

  let fromMs: number | null;
  let toMs: number | null;
  try {
    fromMs = parseBoundary(from, false);
    toMs = parseBoundary(to, true);
  } catch (e) {
    console.error(String(e instanceof Error ? e.message : e));
    process.exit(2);
  }

  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();
  const kept: SessionDigest[] = [];
  let skipped = 0;
  for (const f of files) {
    const path = join(dir, f);
    const text = await Bun.file(path).text();
    const d = parseTranscript(text.split("\n"), path);
    if (!d.sessionId) d.sessionId = f.replace(/\.jsonl$/, "");
    if (!inWindow(d, fromMs, toMs)) {
      skipped++;
      continue;
    }
    kept.push(d);
    await Bun.write(join(out, `${d.sessionId.slice(0, 8)}.md`), renderDigest(d));
  }
  await Bun.write(join(out, "_index.md"), renderIndex(kept));
  console.log(`${kept.length} session(s) digérée(s), ${skipped} hors fenêtre → ${out}`);
  for (const d of kept) for (const w of d.warnings) console.warn(`⚠️  ${d.sessionId.slice(0, 8)} : ${w}`);
}

if (import.meta.main) await main();
