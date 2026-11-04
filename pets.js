import { PawPlacerClient } from "pawplacer-sdk";

// GET /api/pets?species=dog|cat&search=text  ->  { pets, total, hasMore }
// The PawPlacer key lives in the PAWPLACER_API_KEY secret (a read-only key), never in browser code.
export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default;
  const hit = await cache.match(request);
  if (hit) return hit;

  const url = new URL(request.url);
  const species = url.searchParams.get("species") || undefined;
  const search = url.searchParams.get("search") || undefined;

  try {
    const pawplacer = new PawPlacerClient({ apiKey: env.PAWPLACER_API_KEY });
    const result = await pawplacer.pets.list({ status: "available", species, search, limit: 24 });
    const res = new Response(
      JSON.stringify({ pets: result.data, total: result.total, hasMore: result.hasMore }),
      { headers: { "content-type": "application/json", "cache-control": "public, max-age=300" } }
    );
    waitUntil(cache.put(request, res.clone()));
    return res;
  } catch (err) {
    return new Response(JSON.stringify({ error: "Animals are unavailable right now." }), {
      status: 502,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
}
