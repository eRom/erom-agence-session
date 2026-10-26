import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  classifyUserContent,
  parseTranscript,
  inWindow,
  formatDuration,
  renderDigest,
  renderIndex,
  stripBase64,
  localDay,
  localHm,
  localDateTime,
  parseBoundary,
  type SessionDigest,
} from "../digest.ts";

const fixtureLines = readFileSync(join(import.meta.dir, "fixture.jsonl"), "utf8").split("\n");
const digest = parseTranscript(fixtureLines, "/fake/path/fixture.jsonl");

describe("classifyUserContent", () => {
  test("un prompt réel est classé prompt", () => {
    expect(classifyUserContent("Corrige le bug", false)).toEqual({ kind: "prompt", text: "Corrige le bug" });
  });
  test("une commande est extraite avec son nom", () => {
    const c = classifyUserContent("<command-name>/session-retro</command-name>\n<command-args>x</command-args>", false);
    expect(c).toEqual({ kind: "command", command: "/session-retro" });
  });
  test("caveat, stdout, system-reminder et task-notification ne sont pas des prompts", () => {
    expect(classifyUserContent("<local-command-caveat>Caveat: ...", true).kind).toBe("noise");
    expect(classifyUserContent("<local-command-stdout>ok</local-command-stdout>", false).kind).toBe("noise");
    expect(classifyUserContent("<system-reminder>hook</system-reminder>", false).kind).toBe("noise");
    expect(classifyUserContent("<task-notification>...</task-notification>", false).kind).toBe("task_notification");
  });
  test("isMeta sans balise connue reste du bruit", () => {
    expect(classifyUserContent("texte injecté par le harness", true).kind).toBe("noise");
  });
  test("le contenu vide est du bruit", () => {
    expect(classifyUserContent("   ", false).kind).toBe("noise");
  });
});

describe("parseTranscript sur la fixture", () => {
  test("identité de session et bornes temporelles", () => {
    expect(digest.sessionId).toBe("fixture-session-0001");
    expect(digest.firstTs).toBe("2026-07-05T10:00:00.000Z");
    expect(digest.lastTs).toBe("2026-07-05T10:45:00.000Z");
    expect(digest.version).toBe("2.1.198");
    expect(digest.gitBranches).toEqual(["main"]);
  });
  test("extrait les prompts réels : string ET bloc text d'array, sans le bruit", () => {
    expect(digest.prompts.map((p) => p.text)).toEqual([
      "Corrige le bug de parsing des dates dans l'import",
      "Regarde cette capture et dis-moi si le layout tient",
    ]);
    expect(digest.stats.userPrompts).toBe(2);
  });
  test("replie les commandes invoquées", () => {
    expect(digest.commands).toEqual(["/session-retro"]);
  });
  test("compte les notifications de subagents sans en faire des prompts", () => {
    expect(digest.stats.taskNotifications).toBe(1);
  });
  test("déduplique les erreurs d'outils identiques avec compte", () => {
    const errors = digest.events.filter((e) => e.kind === "tool_error");
    expect(digest.stats.toolErrors).toBe(3);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({ count: 2 });
    expect(errors[0].text).toContain("File does not exist");
    expect(errors[1]).toMatchObject({ count: 1 });
    expect(errors[1].text).toContain("Found 2 matches");
  });
  test("détecte la coupure quota", () => {
    const cuts = digest.events.filter((e) => e.kind === "quota_cut");
    expect(cuts).toHaveLength(1);
    expect(cuts[0].text).toContain("session limit");
    expect(digest.stats.quotaCuts).toBe(1);
  });
  test("trace les dispatches de subagents", () => {
    const dispatches = digest.events.filter((e) => e.kind === "agent_dispatch");
    expect(dispatches).toEqual([
      {
        kind: "agent_dispatch",
        ts: "2026-07-05T10:03:00.000Z",
        description: "Explorer le module swarm",
        subagentType: "Explore",
      },
    ]);
  });
  test("trace les changements de permission-mode (sans timestamp)", () => {
    const modes = digest.events.filter((e) => e.kind === "permission_mode");
    expect(modes).toEqual([{ kind: "permission_mode", ts: null, mode: "bypassPermissions" }]);
  });
  test("stats : tool calls, tokens, modèles, types annexes et inconnus", () => {
    expect(digest.stats.toolCalls).toEqual({ Bash: 1, Agent: 1 });
    expect(digest.stats.outputTokens).toBe(230);
    expect(digest.models).toEqual({ "claude-sonnet-5": 2 });
    expect(digest.stats.otherTypes).toEqual({ system: 1, "ai-title": 1 });
    expect(digest.stats.unknownTypes).toEqual({ "wibble-experimental": 1 });
    expect(digest.stats.totalLines).toBe(15);
  });
  test("pas d'avertissement sous le seuil de 20% d'inconnu", () => {
    expect(digest.warnings).toEqual([]);
  });
});

describe("robustesse format", () => {
  test("avertit quand plus de 20% des lignes sont de type inconnu", () => {
    const lines = [
      JSON.stringify({ type: "user", timestamp: "2026-01-01T00:00:00Z", sessionId: "s", message: { content: "hello" } }),
      JSON.stringify({ type: "mystery", timestamp: "2026-01-01T00:01:00Z" }),
    ];
    const d = parseTranscript(lines, "/x.jsonl");
    expect(d.warnings).toHaveLength(1);
    expect(d.warnings[0]).toContain("1/2");
  });
  test("le JSON invalide est compté sans planter", () => {
    const d = parseTranscript(["{pas du json", ""], "/x.jsonl");
    expect(d.stats.unknownTypes["(json invalide)"]).toBe(1);
  });
});

describe("base64 embarqué", () => {
  const blob = "A".repeat(2000);
  test("stripBase64 tronque les runs longs et laisse le texte normal intact", () => {
    expect(stripBase64(`avant ${blob} après`)).toBe("avant [base64 ~2 Ko tronqué] après");
    expect(stripBase64("texte normal, même avec un hash abc123def456")).toBe(
      "texte normal, même avec un hash abc123def456",
    );
  });
  test("un tool_result image est compté, exclu du rendu, et avertit au-delà de 50% du volume", () => {
    const lines = [
      JSON.stringify({
        type: "user", timestamp: "2026-01-01T00:00:00Z", sessionId: "s",
        message: { content: [{ type: "tool_result", content: [{ type: "image", source: { type: "base64", data: blob } }] }] },
      }),
      JSON.stringify({ type: "user", timestamp: "2026-01-01T00:01:00Z", message: { content: "prompt court" } }),
    ];
    const d = parseTranscript(lines, "/x.jsonl");
    expect(d.stats.base64Lines).toBe(1);
    expect(d.stats.base64Chars).toBeGreaterThanOrEqual(2000);
    expect(d.warnings.some((w) => w.includes("base64 embarqué"))).toBe(true);
    const md = renderDigest(d);
    expect(md).toContain("Base64 embarqué");
    expect(md).not.toContain(blob);
  });
  test("un prompt contenant un blob base64 est tronqué à l'extraction", () => {
    const lines = [
      JSON.stringify({ type: "user", timestamp: "2026-01-01T00:00:00Z", message: { content: `regarde : ${blob}` } }),
    ];
    const d = parseTranscript(lines, "/x.jsonl");
    expect(d.prompts[0].text).toBe("regarde : [base64 ~2 Ko tronqué]");
  });
  test("la fixture sans base64 reste à zéro, sans ligne de rendu dédiée", () => {
    expect(digest.stats.base64Lines).toBe(0);
    expect(digest.stats.base64Chars).toBe(0);
    expect(renderDigest(digest)).not.toContain("Base64 embarqué");
  });
});

describe("inWindow", () => {
  const mk = (first: string, last: string): SessionDigest =>
    ({ ...digest, firstTs: first, lastTs: last }) as SessionDigest;
  const at = (iso: string): number => Date.parse(iso);
  test("session entièrement avant la fenêtre : exclue", () => {
    expect(inWindow(mk("2026-06-01T00:00:00Z", "2026-06-02T00:00:00Z"), at("2026-07-01T00:00:00Z"), null)).toBe(false);
  });
  test("session entièrement après la fenêtre : exclue", () => {
    expect(inWindow(mk("2026-08-01T00:00:00Z", "2026-08-02T00:00:00Z"), null, at("2026-07-31T00:00:00Z"))).toBe(false);
  });
  test("session chevauchant la fenêtre : incluse", () => {
    expect(
      inWindow(
        mk("2026-06-30T00:00:00Z", "2026-07-02T00:00:00Z"),
        at("2026-07-01T00:00:00Z"),
        at("2026-07-31T00:00:00Z"),
      ),
    ).toBe(true);
  });
  test("sans bornes : tout est inclus (sauf session sans timestamps)", () => {
    expect(inWindow(mk("2026-06-30T00:00:00Z", "2026-07-02T00:00:00Z"), null, null)).toBe(true);
    expect(inWindow({ ...digest, firstTs: null, lastTs: null } as SessionDigest, null, null)).toBe(false);
  });
});

describe("temps local (régression rétro 2026-07-18 : UTC brut décalé de 2h face à git)", () => {
  test("conversion UTC → Europe/Paris en été (CEST, +2h)", () => {
    expect(localHm("2026-07-18T12:13:54.123Z", "Europe/Paris")).toBe("14:13");
    expect(localDateTime("2026-07-18T12:13:54.123Z", "Europe/Paris")).toBe("2026-07-18 14:13:54");
  });
  test("conversion UTC → Europe/Paris en hiver (CET, +1h) : l'offset n'est pas fixe", () => {
    expect(localHm("2026-01-15T12:13:54.123Z", "Europe/Paris")).toBe("13:13");
  });
  test("bascule de jour à la conversion : 23:30Z un 17 juillet = 01:30 le 18 à Paris", () => {
    expect(localDay("2026-07-17T23:30:00Z", "Europe/Paris")).toBe("2026-07-18");
  });
  test("timestamps null ou invalides : placeholders sans plantage", () => {
    expect(localHm(null)).toBe("--:--");
    expect(localDay(null)).toBe("date inconnue");
    expect(localDateTime(null)).toBe("?");
  });
  test("parseBoundary : une date seule couvre la journée locale entière", () => {
    expect(parseBoundary("2026-07-15", false)).toBe(new Date(2026, 6, 15, 0, 0, 0, 0).getTime());
    expect(parseBoundary("2026-07-15", true)).toBe(new Date(2026, 6, 15, 23, 59, 59, 999).getTime());
  });
  test("parseBoundary : date-heure sans offset = heure locale, Z respecté, null passe", () => {
    expect(parseBoundary("2026-07-15T08:00:00", false)).toBe(new Date(2026, 6, 15, 8, 0, 0).getTime());
    expect(parseBoundary("2026-07-15T08:00:00Z", false)).toBe(Date.parse("2026-07-15T08:00:00Z"));
    expect(parseBoundary(null, false)).toBeNull();
  });
  test("parseBoundary : borne illisible = erreur explicite", () => {
    expect(() => parseBoundary("pas-une-date", false)).toThrow("Borne temporelle invalide");
  });
});

describe("formatDuration", () => {
  test("minutes seules", () => {
    expect(formatDuration("2026-07-05T10:00:00Z", "2026-07-05T10:45:00Z")).toBe("45min");
  });
  test("heures et minutes", () => {
    expect(formatDuration("2026-07-05T10:00:00Z", "2026-07-05T12:05:00Z")).toBe("2h05");
  });
  test("bornes manquantes", () => {
    expect(formatDuration(null, "2026-07-05T10:00:00Z")).toBe("inconnue");
  });
});

describe("rendu markdown (zone explicite Europe/Paris pour un rendu déterministe)", () => {
  const md = renderDigest(digest, "Europe/Paris");
  test("le digest contient l'en-tête, les événements et les prompts", () => {
    expect(md).toContain("# Session fixture-session-0001 — 2026-07-05");
    expect(md).toContain("COUPURE QUOTA");
    expect(md).toContain("erreur outil (×2)");
    expect(md).toContain("subagent [Explore] : Explorer le module swarm");
    expect(md).toContain("Corrige le bug de parsing des dates dans l'import");
    expect(md).toContain("Commandes invoquées : /session-retro");
    expect(md).toContain("/fake/path/fixture.jsonl");
  });
  test("le digest affiche des heures locales et annonce son fuseau", () => {
    expect(md).toContain("heures locales Europe/Paris");
    expect(md).toContain("- Période : 2026-07-05 12:00:00 → 2026-07-05 12:45:00");
    expect(md).toContain("12:03 · subagent [Explore]");
  });
  test("l'index agrège, référence les digests, et annonce son fuseau", () => {
    const idx = renderIndex([digest], "Europe/Paris");
    expect(idx).toContain("1 sessions · 2 prompts user · 3 erreurs d'outils · 1 coupures quota");
    expect(idx).toContain("Heures locales Europe/Paris (transcripts sources en UTC).");
    expect(idx).toContain("| fixture- | 2026-07-05 12:00 | 45min | 2 | 3 | 1 | 1 |");
    expect(idx).toContain("fixture-.md");
  });
});
