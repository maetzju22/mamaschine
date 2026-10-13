import type { Config, Context } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";

type Img = { media_type: string; data: string };
type Body = {
  images?: Img[];
  machinePhoto?: boolean;
  machine?: Record<string, unknown> | null;
  detergent?: string;
  softener?: boolean;
  panic?: number;
  note?: string;
};

const MODELS = ["claude-sonnet-5-5", "claude-sonnet-4-6", "claude-haiku-5-5"];
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const PANIC = [
  "",
  "Profi. Kurz und knapp, keine Witze nötig.",
  "Hat schon mal gewaschen. Sachlich mit einem kleinen Schmunzler.",
  "Weiß, wo die Maschine steht. Klar erklären, ab und zu ein Augenzwinkern.",
  "Bisher hat Mama gewaschen. Jeden Handgriff erklären, aufmunternd, mit Humor.",
  "Totale Panik vor dem Gerät. Wie für einen Erstkontakt mit Außerirdischen erklären: jeder Knopf, jede Bewegung, beruhigend und lustig.",
];

const env = (k: string) => Netlify.env.get(k) || process.env[k];
const aiActive = () => Boolean(env("ANTHROPIC_API_KEY") || env("ANTHROPIC_BASE_URL"));

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function buildPrompt(b: Body, nLaundry: number) {
  const panic = Math.min(5, Math.max(1, Number(b.panic) || 3));
  const machineBlock = b.machinePhoto
    ? `- Bild 1: die Waschmaschine (Bedienfeld, evtl. Waschmittelfach, evtl. Typenschild). Erkenne Marke, Modell (falls lesbar), Bauart, Programme am Wahlschalter, Tasten, Waschmittelfach-Aufteilung.
- Bild 2${nLaundry > 1 ? "–" + (nLaundry + 1) : ""}: die Schmutzwäsche.`
    : `- Alle ${nLaundry} Bild(er): die Schmutzwäsche.
BEKANNTE MASCHINE (vom User gespeichert, teils manuell eingegeben, kann lückenhaft sein):
${JSON.stringify(b.machine ?? {}).slice(0, 3000)}`;

  return `Du bist "Mamaschine", ein Wäsche-Profi mit Humor für alle, die vor ihrer Waschmaschine ratlos stehen. Antworte auf Deutsch, du-Form, österreichisch-neutral.

BILDER:
${machineBlock}

WASCHMITTEL des Users: ${String(b.detergent || "Flüssigwaschmittel").slice(0, 60)}${b.softener ? ", Weichspüler vorhanden" : ", kein Weichspüler"}.
NOTIZ des Users: ${String(b.note || "").slice(0, 400) || "keine"}
ERKLÄR-LEVEL: ${PANIC[panic]}
Wasser: mittlere Härte annehmen (Wien), außer die Notiz sagt was anderes.

AUFGABE:
1. Schätze, was im Wäschehaufen ist (Farben, Material, Empfindliches) und das Gewicht in kg.
2. Teile in max. 3 Ladungen, wenn nötig (z. B. Weiß vs. dunkle Jeans, Wolle vs. Handtücher). Sonst genau 1 Ladung.
3. Pro Ladung: passendes Programm DIESER Maschine (exakte Beschriftung am Wahlschalter, falls bekannt), Temperatur, Schleuderdrehzahl, Dauer ca., sinnvolle Extras, Waschmittelmenge (ml, bei Caps Anzahl) passend zu Menge und Verschmutzung, und WO genau hinein (Fach mit Symbol oder direkt in die Trommel).
4. 5–9 Schritte, konkret für diese Maschine. Fachlich korrekt bleiben, der Humor ist Deko.
5. Ein kurzer witziger Spruch ("quip") zur Wäsche, max. 15 Wörter, liebevoll, nicht gemein.
Wenn etwas unlesbar ist: plausible Annahme treffen und in "assumptions" nennen. Wenn auf den Bildern keine Wäsche/Waschmaschine zu sehen ist, sag das freundlich in "warnings" und gib trotzdem eine allgemeine Anleitung.

Antworte NUR mit JSON, ohne Markdown:
{
 ${b.machinePhoto ? `"machine": {"brand": string, "model": string|null, "kind": "Frontlader"|"Toplader"|"Waschtrockner", "capacity_kg": number|null, "controls": string, "compartments": [{"symbol": "I"|"II"|"✿"|string, "position": "links"|"mitte"|"rechts"|"vorne"|"hinten"|string, "purpose": string}], "programs": [string]},` : ""}
 "quip": string,
 "laundry": {"summary": string, "weight_kg": number, "items": [string]},
 "loads": [{
   "name": string, "items": [string], "program": string, "temp_c": number, "spin_rpm": number, "duration_min": number|null, "extras": [string],
   "detergent": {"amount": string, "ml": number|null, "where": string, "symbol": string, "note": string},
   "softener": {"use": boolean, "amount": string|null, "where": string|null},
   "steps": [{"title": string, "detail": string}]
 }],
 "warnings": [string],
 "assumptions": [string]
}`;
}

function extractJson(text: string) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(raw);
}

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") return json({ error: "Nur POST." }, 405);
  if (!aiActive()) {
    return json({ error: "gateway_inactive", message: "Die Foto-Analyse ist auf diesem Server gerade nicht aktiv." }, 503);
  }

  let b: Body;
  try { b = await req.json(); } catch { return json({ error: "bad_request", message: "Ungültige Anfrage." }, 400); }

  const images = Array.isArray(b.images) ? b.images.slice(0, 5) : [];
  const valid = images.filter((i) => i && ALLOWED.has(i.media_type) && typeof i.data === "string" && i.data.length < 2_000_000);
  if (!valid.length) return json({ error: "no_images", message: "Ohne Foto sieht Mamaschine nichts." }, 400);
  const nLaundry = valid.length - (b.machinePhoto ? 1 : 0);
  if (nLaundry < 1) return json({ error: "no_laundry", message: "Da fehlt noch das Foto vom Wäschehaufen." }, 400);

  const client = new Anthropic();
  const content: Anthropic.ContentBlockParam[] = [
    ...valid.map((i) => ({ type: "image" as const, source: { type: "base64" as const, media_type: i.media_type as "image/jpeg", data: i.data } })),
    { type: "text", text: buildPrompt(b, nLaundry) },
  ];

  let lastErr: unknown;
  for (const model of MODELS) {
    try {
      const msg = await client.messages.create({ model, max_tokens: 3000, messages: [{ role: "user", content }] });
      const text = msg.content.map((c) => (c.type === "text" ? c.text : "")).join("");
      const data = extractJson(text);
      if (!Array.isArray(data.loads) || !data.loads.length) throw new Error("no loads");
      return json({ ok: true, model, ...data });
    } catch (e: any) {
      lastErr = e;
      const status = e?.status;
      if (status && status !== 404 && status !== 400 && status !== 529 && status !== 503) break;
    }
  }
  console.error("analyze failed", lastErr);
  return json({ error: "ai_failed", message: "Die Trommel hat sich verschluckt. Probier's nochmal." }, 502);
};

export const config: Config = {
  path: "/api/analyze",
  method: "POST",
  rateLimit: { windowLimit: 8, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
