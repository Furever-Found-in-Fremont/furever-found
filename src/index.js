import { PawPlacerClient } from "pawplacer-sdk";

// GET /api/pets?species=dog|cat  ->  { pets }  (only animals marked public in PawPlacer)
// The PawPlacer key lives in the PAWPLACER_API_KEY secret, never in browser code.
// Only these fields are ever sent to the public. Health notes, vet, adopter and internal data stay private.
// PawPlacer returns photo paths like "images/<id>/p/<file>.webp". PAWPLACER_IMAGE_BASE (in wrangler.toml) is the address they live under.
function photo(p, base) {
  const u = p.image_url || (p.image_urls && p.image_urls[0]);
  if (!u) return null;
  if (/^https:/.test(u)) return u;
  return base ? base.replace(/\/$/, "") + "/" + u.replace(/^\//, "") : null;
}

const pick = (p, base) => ({
  id: p.id,
  name: p.name,
  species: p.species,
  sex: p.sex,
  breed: p.breed || [],
  age_category: p.age_category,
  age_years: p.age_years,
  age_months: p.age_months,
  description: p.description || "",
  image_url: photo(p, base),
  temperaments: p.temperaments || [],
  good_with: p.good_with || [],
  bad_with: p.bad_with || [],
});

async function pets(request, env, ctx) {
  const cache = caches.default;
  const hit = await cache.match(request);
  if (hit) return hit;

  const url = new URL(request.url);
  const species = url.searchParams.get("species") || undefined;

  try {
    const client = new PawPlacerClient({ apiKey: env.PAWPLACER_API_KEY });
    const result = await client.pets.list({ status: "available", species, limit: 100 });
    const list = result.data.filter((p) => p.show_public === true && !p.is_sample).map((p) => pick(p, env.PAWPLACER_IMAGE_BASE));
    const res = new Response(JSON.stringify({ pets: list }), {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=300" },
    });
    ctx.waitUntil(cache.put(request, res.clone()));
    return res;
  } catch (err) {
    console.error("pets error", err);
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
