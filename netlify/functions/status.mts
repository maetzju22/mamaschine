import type { Config } from "@netlify/functions";

export default async () => {
  const env = (k: string) => Netlify.env.get(k) || process.env[k];
  const ai = Boolean(env("ANTHROPIC_API_KEY") || env("ANTHROPIC_BASE_URL"));
  return new Response(JSON.stringify({ ai }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};

export const config: Config = { path: "/api/status" };
