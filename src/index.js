import { PawPlacerClient } from "pawplacer-sdk";
import { TEMPLATE } from "./template.js";

// ---------- helpers ----------
const APPLY_URL = "https://www.pawplacer.com/adopter/1aecc413-59e7-4495-8f5d-b2dc9b409be9";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : "");
const nameSlug = (n) =>
  String(n || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "pet";
const AGE = { young: "Young", adult: "Adult", senior: "Senior" };
const SIZE = { xSmall: "Extra small", small: "Small", medium: "Medium", large: "Large", xLarge: "Extra large" };
const ageLabel = (p) =>
  p.age_category === "youngest" ? (p.species === "cat" ? "Kitten" : p.species === "dog" ? "Puppy" : "Baby") : AGE[p.age_category] || cap(p.age_category);

// PawPlacer returns photo paths like "images/<id>/p/<file>.webp"; PAWPLACER_IMAGE_BASE (wrangler.toml) is where they live.
function photo(u, base) {
  if (!u) return null;
  if (/^https:/.test(u)) return u;
  return base ? base.replace(/\/$/, "") + "/" + u.replace(/^\//, "") : null;
}

// Only these fields are ever sent to the public. Health notes, vet, adopter and internal data stay private.
const pick = (p, base) => ({
  id: p.id,
  name: String(p.name || "").trim(),
  species: p.species,
  sex: p.sex,
  size: p.size,
  breed: p.breed || [],
  age_category: p.age_category,
  description: p.description || "",
  spayed: p.spayed === true,
  adoption_fee: p.adoption_fee || "",
  images: [...new Set([p.image_url, ...(p.image_urls || [])].filter(Boolean))].map((u) => photo(u, base)).filter(Boolean),
  temperaments: p.temperaments || [],
  good_with: p.good_with || [],
  bad_with: p.bad_with || [],
  special_needs: p.special_needs || [],
});

// Name-based slugs; animals that share a name get a short id suffix so links stay unique.
function addSlugs(list) {
  const count = {};
  list.forEach((p) => (count[nameSlug(p.name)] = (count[nameSlug(p.name)] || 0) + 1));
  list.forEach((p) => {
    const base = nameSlug(p.name);
    p.slug = count[base] > 1 ? base + "-" + p.id.slice(0, 4) : base;
  });
}

function findPet(list, raw) {
  const s = raw.toLowerCase();
  let m = list.find((p) => p.slug === s);
  if (!m) {
    const t = s.match(/^(.*)-([0-9a-f]{4})$/);
    if (t) m = list.find((p) => nameSlug(p.name) === t[1] && p.id.startsWith(t[2]));
  }
  return m;
}

async function allPets(request, env, ctx) {
  const cache = caches.default;
  const key = new Request(new URL("/__pets", request.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit.json();
  const client = new PawPlacerClient({ apiKey: env.PAWPLACER_API_KEY });
  const result = await client.pets.list({ status: "available", limit: 100 });
  const list = result.data.filter((p) => p.show_public === true && !p.is_sample).map((p) => pick(p, env.PAWPLACER_IMAGE_BASE));
  addSlugs(list);
  ctx.waitUntil(cache.put(key, new Response(JSON.stringify(list), { headers: { "content-type": "application/json", "cache-control": "public, max-age=300" } })));
  return list;
}

const page = (title, head, content, status = 200) =>
  new Response(TEMPLATE.replace("{{title}}", esc(title)).replace("{{head}}", head).replace("{{content}}", content), {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": status === 200 ? "public, max-age=300" : "no-store" },
  });

function petPage(p, origin) {
  const canon = origin + "/adopt/" + p.slug;
  const kind = p.species === "cat" ? "cat" : p.species === "dog" ? "dog" : "pet";
  const facts = [
    ["Species", cap(p.species)], ["Breed", p.breed.join(", ")], ["Sex", cap(p.sex)], ["Age", ageLabel(p)],
    ["Size", SIZE[p.size] || cap(p.size)], ["Spayed/neutered", p.spayed ? "Yes" : ""], ["Adoption fee", p.adoption_fee],
  ].filter(([, v]) => v);
  const paras = p.description.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
  const summary = p.description ? p.description.replace(/\s+/g, " ").slice(0, 200) : `${p.name} is an adoptable ${kind} at Furever Found in Fremont in Riverton, Wyoming.`;
  const list = (label, arr) => (arr.length ? `<h3>${label}</h3><ul class="chips">${arr.map((x) => `<li>${esc(cap(x))}</li>`).join("")}</ul>` : "");
  const head = [
    `<link rel="canonical" href="${esc(canon)}">`,
    `<meta name="description" content="${esc(summary)}">`,
    `<meta property="og:type" content="website"><meta property="og:site_name" content="Furever Found in Fremont">`,
    `<meta property="og:title" content="${esc("Meet " + p.name)}"><meta property="og:description" content="${esc(summary)}">`,
    `<meta property="og:url" content="${esc(canon)}">`,
    p.images[0] ? `<meta property="og:image" content="${esc(p.images[0])}"><meta name="twitter:card" content="summary_large_image">` : "",
  ].join("");
  const subject = encodeURIComponent("Adoption inquiry: " + p.name);
  const content = `<main class="wide"><p class="back"><a href="/adopt">&larr; All adoptable animals</a></p>
<div class="petpage"><div class="gallery">${p.images.map((u) => `<img src="${esc(u)}" alt="${esc(p.name)}" loading="lazy">`).join("")}</div>
<div><h1>${esc(p.name)}</h1><dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
${paras.length ? paras.map((x) => `<p>${esc(x)}</p>`).join("") : `<p>We&rsquo;re still getting to know ${esc(p.name)}. Call us to learn more.</p>`}
${list("Personality", p.temperaments)}${list("Good with", p.good_with)}${list("Not good with", p.bad_with)}${list("Special needs", p.special_needs)}
<div class="note"><strong>Interested in ${esc(p.name)}?</strong> Adoption starts with an application, and we aim to respond within 24 to 48 hours. Visits are by appointment only.<br>
<a class="btn" href="${APPLY_URL}">Apply to adopt</a><a class="btn alt" href="mailto:info@fureverfound.pet?subject=${subject}">Email us</a><a class="btn alt" href="tel:+13074143516">Call (307) 414-3516</a></div>
<p class="share"><button type="button" onclick="navigator.clipboard.writeText(location.href).then(()=>this.textContent='Link copied!')">Copy link</button>
<a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(canon)}">Share on Facebook</a></p></div></div></main>`;
  return page(`${p.name} | Adoptable ${kind} | Furever Found in Fremont`, head, content);
}

const notFound = () =>
  page("Animal not found | Furever Found in Fremont", "",
    `<main><h1>We couldn&rsquo;t find that animal</h1><p>They may have found their forever home! See who is available now.</p><p><a class="btn" href="/adopt">Meet adoptable animals</a></p></main>`, 404);

// ---------- routes ----------
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    try {
      if (pathname === "/api/pets" && request.method === "GET") {
        const species = url.searchParams.get("species");
        let list = await allPets(request, env, ctx);
        if (species) list = list.filter((p) => p.species === species);
        return new Response(JSON.stringify({ pets: list }), { headers: { "content-type": "application/json", "cache-control": "public, max-age=60" } });
      }
      if (/^\/adopt\/?$/.test(pathname) && pathname !== "/adopt") return Response.redirect(url.origin + "/adopt", 301);
      const m = pathname.match(/^\/adopt\/([^/]+)\/?$/);
      if (m && request.method === "GET") {
        const list = await allPets(request, env, ctx);
        const pet = findPet(list, decodeURIComponent(m[1]));
        if (!pet) return notFound();
        if (pathname !== "/adopt/" + pet.slug) return Response.redirect(url.origin + "/adopt/" + pet.slug, 301);
        return petPage(pet, url.origin);
      }
    } catch (err) {
      console.error("worker error", err);
      if (pathname.startsWith("/api/")) return new Response(JSON.stringify({ error: "Animals are unavailable right now." }), { status: 502, headers: { "content-type": "application/json", "cache-control": "no-store" } });
      return page("Temporarily unavailable | Furever Found in Fremont", "", `<main><h1>Animals are unavailable right now</h1><p>Please try again in a few minutes, or call us at (307) 414-3516.</p></main>`, 503);
    }
    return env.ASSETS.fetch(request);
  },
};
