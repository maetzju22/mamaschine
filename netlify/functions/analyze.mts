import type { Config, Context } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";

type Role = "machine" | "laundry" | "detergent";
type Img = { media_type: string; data: string; role?: Role };
type Body = {
  images?: Img[];
  machinePhoto?: boolean;
  machine?: Record<string, unknown> | null;
  detergent?: string;
  softener?: boolean;
  panic?: number;
  note?: string;
  items?: string[];
  amount_kg?: number;
  dirt?: string;
  knownDetergents?: string[];
};

/* Strong model first, then a fast fallback that still fits into the function's time budget. */
const ATTEMPTS = [
  { model: "claude-sonnet-5-5", timeout: 34_000 },
  { model: "claude-haiku-5-5", timeout: 18_000 },
];
const BUDGET_MS = 54_000; // stay below the platform's 60 s limit
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const PANIC = [
  "",
  "Profi. Kurz und knapp, keine Witze nötig.",
  "Hat schon mal gewaschen. Sachlich mit einem kleinen Schmunzler.",
  "Weiß, wo die Maschine steht. Klar erklären, ab und zu ein Augenzwinkern.",
  "Bisher hat jemand anderer gewaschen. Jeden Handgriff erklären, aufmunternd, mit Humor.",
  "Totale Panik vor dem Gerät. Wie für einen Erstkontakt mit Außerirdischen erklären: jeder Knopf, beruhigend und lustig.",
];

const env = (k: string) => Netlify.env.get(k) || process.env[k];
const aiActive = () => Boolean(env("ANTHROPIC_API_KEY") || env("ANTHROPIC_BASE_URL"));

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
const fail = (status: number, code: string, message: string) => json({ error: code, message }, status);

/* The answer comes back through a forced tool call, so it is always valid, complete JSON. */
const str = { type: "string" };
const num = { type: "number" };
const strArr = { type: "array", items: str };
const TOOL_SCHEMA = {
  type: "object",
  properties: {
    machine: {
      type: "object",
      description: "Nur ausfüllen, wenn ein Bild [Waschmaschine] dabei ist.",
      properties: {
        brand: str, model: str, kind: { type: "string", enum: ["Frontlader", "Toplader", "Waschtrockner"] },
        capacity_kg: num, controls: str,
        compartments: { type: "array", items: { type: "object", properties: { symbol: str, position: str, purpose: str }, required: ["symbol", "position", "purpose"] } },
        programs: strArr,
      },
      required: ["brand", "kind", "compartments", "programs"],
    },
    detergents: {
      type: "array", description: "Nur ausfüllen, wenn Bilder [Waschmittel] dabei sind.",
      items: { type: "object", properties: { name: str, type: str, form: str }, required: ["name", "type"] },
    },
    quip: { type: "string", description: "Witziger, liebevoller Spruch, max. 15 Wörter." },
    laundry: { type: "object", properties: { summary: str, weight_kg: num, items: strArr }, required: ["summary", "weight_kg"] },
    loads: {
      type: "array", minItems: 1, maxItems: 3,
      items: {
        type: "object",
        properties: {
          name: str, items: strArr, program: str, temp_c: num, spin_rpm: num, duration_min: num, extras: strArr,
          detergent: {
            type: "object",
            properties: { product: str, amount: str, ml: num, where: str, symbol: { type: "string", description: "I, II, ✿ oder Trommel" }, note: str },
            required: ["amount", "where", "symbol"],
          },
          softener: { type: "object", properties: { use: { type: "boolean" }, amount: str, where: str, reason: { type: "string", description: "Nur wenn use=false: kurzer Grund, max. 15 Wörter." } }, required: ["use"] },
          steps: { type: "array", minItems: 4, maxItems: 9, items: { type: "object", properties: { title: str, detail: str }, required: ["title", "detail"] } },
        },
        required: ["name", "program", "temp_c", "spin_rpm", "detergent", "softener", "steps"],
      },
    },
    warnings: strArr,
    assumptions: strArr,
  },
  required: ["quip", "laundry", "loads"],
};

function buildPrompt(b: Body, roles: Role[]) {
  const panic = Math.min(5, Math.max(1, Number(b.panic) || 3));
  const hasMachine = roles.includes("machine");
  const nLaundry = roles.filter((r) => r === "laundry").length;
  const hasDet = roles.includes("detergent");
  const items = Array.isArray(b.items) ? b.items.map(String).slice(0, 15) : [];

  const machineBlock = hasMachine
    ? "Das Bild [Waschmaschine] zeigt die Maschine (Bedienfeld, evtl. Waschmittelfach, evtl. Typenschild). Erkenne Marke, Modell (falls lesbar), Bauart, Programme am Wahlschalter und die Aufteilung des Waschmittelfachs."
    : `Bekannte Maschine (vom User gespeichert, kann lückenhaft sein): ${JSON.stringify(b.machine ?? {}).slice(0, 2500)}`;
  const laundryBlock = nLaundry
    ? "Die Bilder [Wäsche] zeigen den Wäschehaufen."
    : `Kein Wäschefoto. Angetippt: ${items.join(", ") || "gemischte Alltagswäsche"}. Menge ca. ${Number(b.amount_kg) || 4.5} kg, Verschmutzung: ${String(b.dirt || "normal").slice(0, 30)}.`;
  const detBlock = hasDet
    ? "Die Bilder [Waschmittel] zeigen die Waschmittel. Erkenne Produkt, Sorte und Form. Ist eine Dosiertabelle lesbar, nimm deren Werte für mittlere Wasserhärte. Wähle pro Ladung das passende Mittel und nenne es in detergent.product."
    : Array.isArray(b.knownDetergents) && b.knownDetergents.length
      ? `Waschmittel des Users (früher erkannt): ${b.knownDetergents.map(String).slice(0, 6).join(", ").slice(0, 300)}. Wähle pro Ladung das passende und nenne es in detergent.product.`
      : `Waschmittel laut User: ${String(b.detergent || "Flüssigwaschmittel").slice(0, 60)}.`;

  return `Du bist "Mamaschine", ein Wäsche-Profi mit Humor für alle, die vor ihrer Waschmaschine ratlos stehen. Deutsch, du-Form.

${machineBlock}
${laundryBlock}
${detBlock}
${b.softener
    ? "WEICHSPÜLER: Der User HAT Weichspüler zuhause, auch wenn er auf keinem Foto zu sehen ist. Plane ihn für jede Ladung ein, bei der er fachlich passt (softener.use = true, Menge in ml, Fach mit Blume ✿), und erwähne ihn auch in den Schritten. Lass ihn nur weg, wo er schadet: Handtücher, Sport- und Funktionswäsche, Outdoor/Membran, Mikrofaser, Daunen. Dann softener.use = false und in softener.reason kurz und freundlich, warum er hier nicht reinkommt. Schreib niemals, dass kein Weichspüler vorhanden ist."
    : "WEICHSPÜLER: Der User hat keinen angegeben. softener.use = false. Behaupte nicht, er sei zwingend nötig; höchstens als optionaler Tipp in softener.reason."}
Notiz: ${String(b.note || "").slice(0, 400) || "keine"}
Erklär-Level: ${PANIC[panic]}
Wasser: mittlere Härte (Wien), außer die Notiz sagt was anderes.

Aufgabe:
1. Schätze, was gewaschen wird, und das Gewicht in kg.
2. Max. 3 Ladungen, nur wenn nötig (z. B. Weiß vs. dunkle Jeans, Wolle vs. Handtücher). Sonst genau 1.
3. Pro Ladung: Programm DIESER Maschine (Beschriftung wie am Wahlschalter, falls bekannt), Temperatur, Schleudern, Dauer, Extras, Waschmittel-Menge (ml oder Anzahl Caps) und wohin (Fach-Symbol oder Trommel).
4. 5–8 Schritte pro Ladung, konkret für diese Maschine. Jedes "detail" max. 30 Wörter. Fachlich korrekt, der Humor ist Deko.
Wenn etwas unlesbar ist: plausible Annahme treffen und in assumptions nennen. Wenn ein Bild nicht zeigt, was es soll: freundlich in warnings sagen und trotzdem eine allgemeine Anleitung geben.
Gib das Ergebnis ausschließlich über das Werkzeug "anleitung" zurück.`;
}

function classify(e: any): { status: number; code: string; message: string; retry: boolean } {
  const s = e?.status;
  const name = e?.name || e?.constructor?.name || "";
  if (/Timeout/i.test(name) || /timed? ?out/i.test(String(e?.message))) return { status: 504, code: "timeout", message: "Das hat zu lange gedauert. Probier's mit weniger Fotos oder einem Foto mit weniger Drumherum.", retry: true };
  if (s === 429) return { status: 429, code: "busy", message: "Gerade waschen alle gleichzeitig. Probier's in einer Minute nochmal.", retry: true };
  if (s === 402 || s === 403) return { status: 503, code: "quota", message: "Das KI-Kontingent ist gerade aufgebraucht. „Ohne Foto“ funktioniert trotzdem.", retry: false };
  if (s === 529 || s === 503 || s === 500 || s === 502) return { status: 503, code: "overloaded", message: "Die KI ist gerade überlastet. Probier's gleich nochmal.", retry: true };
  if (s === 404) return { status: 502, code: "model", message: "Die KI ist gerade nicht erreichbar.", retry: true };
  if (s === 400 && /image/i.test(String(e?.message))) return { status: 400, code: "image", message: "Ein Foto konnte nicht gelesen werden. Nimm bitte ein anderes (JPG oder PNG).", retry: false };
  if (s === 413) return { status: 413, code: "too_large", message: "Die Fotos sind zu groß. Nimm bitte weniger oder kleinere.", retry: false };
  return { status: 502, code: "ai_failed", message: "Die Trommel hat sich verschluckt. Probier's nochmal.", retry: true };
}

export default async (req: Request, context: Context) => {
  const started = Date.now();
  if (req.method !== "POST") return fail(405, "method", "Nur POST.");
  if (!aiActive()) return fail(503, "gateway_inactive", "Die Foto-KI ist gerade nicht aktiv. „Ohne Foto“ funktioniert trotzdem.");

  let b: Body;
  try { b = await req.json(); } catch { return fail(400, "bad_request", "Die Anfrage kam kaputt an. Lade die Seite neu und probier's nochmal."); }

  const images = Array.isArray(b.images) ? b.images.slice(0, 6) : [];
  const valid = images.filter((i) => i && ALLOWED.has(i.media_type) && typeof i.data === "string" && i.data.length > 100 && i.data.length < 3_000_000);
  if (images.length && !valid.length) return fail(400, "image", "Die Fotos konnten nicht gelesen werden. Nimm bitte JPG oder PNG.");
  const roles: Role[] = valid.map((i, n) => i.role || (b.machinePhoto && n === 0 ? "machine" : "laundry"));
  const hasItems = Array.isArray(b.items) && b.items.length > 0;
  if (!roles.includes("laundry") && !hasItems) return fail(400, "no_laundry", "Da fehlt noch die Wäsche: Foto machen oder bei „Ohne Foto“ antippen.");

  const LABEL: Record<Role, string> = { machine: "[Waschmaschine]", laundry: "[Wäsche]", detergent: "[Waschmittel]" };
  const content: Anthropic.ContentBlockParam[] = [];
  valid.forEach((i, n) => {
    content.push({ type: "text", text: `Bild ${n + 1} ${LABEL[roles[n]]}` });
    content.push({ type: "image", source: { type: "base64", media_type: i.media_type as "image/jpeg", data: i.data } });
  });
  content.push({ type: "text", text: buildPrompt(b, roles) });

  const client = new Anthropic({ maxRetries: 0 });
  let last = classify(null);
  for (const a of ATTEMPTS) {
    const left = BUDGET_MS - (Date.now() - started);
    if (left < 8_000) break;
    try {
      const msg = await client.messages.create(
        {
          model: a.model,
          max_tokens: 4000,
          tools: [{ name: "anleitung", description: "Gibt die fertige Wasch-Anleitung zurück.", input_schema: TOOL_SCHEMA as Anthropic.Tool.InputSchema }],
          tool_choice: { type: "tool", name: "anleitung" },
          messages: [{ role: "user", content }],
        },
        { timeout: Math.min(a.timeout, left - 2_000) },
      );
      const tool = msg.content.find((c) => c.type === "tool_use") as Anthropic.ToolUseBlock | undefined;
      const data = tool?.input as Record<string, any> | undefined;
      if (!data || !Array.isArray(data.loads) || !data.loads.length) {
        console.warn("analyze: empty or truncated answer", a.model, msg.stop_reason);
        last = classify(null);
        continue;
      }
      if (!roles.includes("machine")) delete data.machine;
      if (!roles.includes("detergent")) delete data.detergents;
      return json({ ok: true, model: a.model, ms: Date.now() - started, ...data });
    } catch (e: any) {
      last = classify(e);
      console.error("analyze attempt failed", a.model, e?.status, e?.name, String(e?.message).slice(0, 300));
      if (!last.retry) break;
    }
  }
  return fail(last.status, last.code, last.message);
};

export const config: Config = {
  path: "/api/analyze",
  method: "POST",
  rateLimit: { windowLimit: 8, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
