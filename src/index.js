import { PawPlacerClient } from "pawplacer-sdk";

// GET /api/pets?species=dog|cat&search=text  ->  { pets, total, hasMore }
// The PawPlacer key lives in the PAWPLACER_API_KEY secret, never in browser code.
async function pets(request, env, ctx) {
  const cache = caches.default;
  const hit = await cache.match(request);
  if (hit) return hit;

  const url = new URL(request.url);
  const species = url.searchParams.get("species") || undefined;
  const search = url.searchParams.get("search") || undefined;

  try {
    const client = new PawPlacerClient({ apiKey: env.PAWPLACER_API_KEY });
    const result = await client.pets.list({ status: "available", species, search, limit: 24 });
    const res = new Response(
      JSON.stringify({ pets: result.data, total: result.total, hasMore: result.hasMore }),
      { headers: { "content-type": "application/json", "cache-control": "public, max-age=300" } }
    );
    ctx.waitUntil(cache.put(request, res.clone()));
    return res;
  } catch (err) {
    return new Response(JSON.stringify({ error: "Animals are unavailable right now." }), {
      status: 502,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/pets" && request.method === "GET") return pets(request, env, ctx);
    return env.ASSETS.fetch(request);
  },
};
