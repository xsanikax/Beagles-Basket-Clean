import { CATALOG } from "../../_catalog.js";

const MORRISONS_SEARCH = "https://groceries.morrisons.com/search?q=";
const MAX_PRODUCTS_PER_SEARCH = 160;
const MAX_SUBLOCATION_SEARCHES = 10;
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

function decodeHtml(value = "") {
  return String(value)
    .replace(/\\u002F/gi, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\[tnr]/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(value = "") {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function parseProducts(html) {
  const products = [];
  const seen = new Set();
  const pattern = /"name":"([^"]+)","price":\{"current":\{"amount":"([0-9.]+)","currency":"GBP"\}/g;
  for (const match of html.matchAll(pattern)) {
    const name = decodeHtml(match[1]);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const objectStart = html.lastIndexOf('{"productId":"', match.index);
    const nextObject = html.indexOf('{"productId":"', match.index + 1);
    const prefix = objectStart >= 0 ? html.slice(objectStart, match.index) : "";
    const suffix = html.slice(match.index, nextObject >= 0 ? nextObject : match.index + 5000);
    const imageMatch = prefix.match(/"image":\{"src":"([^"]+)"/);
    const idMatch = prefix.match(/"retailerProductId":"([^"]+)"/);
    const sizeMatch = suffix.match(/"size":\{"value":"([^"]*)"\}/);
    products.push({
      name,
      price: Number(match[2]),
      size: sizeMatch ? decodeHtml(sizeMatch[1]) : "",
      image: imageMatch ? decodeHtml(imageMatch[1]) : null,
      retailerProductId: idMatch?.[1] || null,
    });
  }
  return products;
}

function parseSublocationSearches(html) {
  const seen = new Set();
  const paths = [];
  const pattern = /href="(\/search\?q=[^"]*sublocationId=[^"]+)"/g;
  for (const match of html.matchAll(pattern)) {
    const path = decodeHtml(match[1]).replace(/&amp;/g, "&");
    if (seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
    if (paths.length >= MAX_SUBLOCATION_SEARCHES) break;
  }
  return paths;
}

const aliases = {
  vape: ["vape", "e liquid", "eliquid", "pod", "nicotine"],
  "vape juice": ["vape", "e liquid", "eliquid", "pod", "nicotine"],
  milk: ["milk", "semi skimmed", "whole milk", "oat milk"],
  bread: ["bread", "loaf", "sourdough"],
};

function productScore(query, product, index = 0) {
  const phrase = normalize(query);
  const tokens = phrase.split(" ").filter((token) => token.length > 1);
  const name = normalize(product.name);
  const coverage = tokens.filter((token) => name.includes(token)).length / Math.max(tokens.length, 1);
  const relatedTerms = aliases[phrase] || tokens;
  const related = relatedTerms.some((term) => name.includes(normalize(term)));
  const discovered = (product.searchTerms || []).some((term) => phrase.includes(normalize(term)) || relatedTerms.includes(term));
  return (name.includes(phrase) ? 35 : 0) + coverage * 24 + (related ? 8 : 0) + (discovered ? 12 : 0) - index * 0.04;
}

function rankProducts(query, products) {
  return products
    .filter((product) => product && product.name)
    .map((product, index) => ({ ...product, price: Number.isFinite(Number(product.price)) ? Number(product.price) : null, score: productScore(query, product, index) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PRODUCTS_PER_SEARCH)
    .map(({ score, searchTerms, ...product }) => product);
}

function cachedMatches(query) {
  return CATALOG
    .map((product, index) => ({ ...product, score: productScore(query, product, index) }))
    .filter((product) => product.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PRODUCTS_PER_SEARCH)
    .map(({ score, searchTerms, ...product }) => product);
}

function mergeProducts(primary, secondary) {
  const seen = new Set();
  return [...primary, ...secondary].filter((product) => {
    const key = product.retailerProductId || normalize(product.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchMorrisonsPage(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; BeaglesBasket/1.0; personal price lookup)",
      accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) throw new Error(`Morrisons returned ${response.status}`);
  return response.text();
}

async function fetchMorrisons(query) {
  const searchUrl = `${MORRISONS_SEARCH}${encodeURIComponent(query)}`;
  const html = await fetchMorrisonsPage(searchUrl);
  const products = parseProducts(html);
  const sublocationPaths = parseSublocationSearches(html);
  const sublocationPages = await Promise.allSettled(
    sublocationPaths.map((path) => fetchMorrisonsPage(new URL(path, "https://groceries.morrisons.com").toString())),
  );
  for (const page of sublocationPages) {
    if (page.status === "fulfilled") products.push(...parseProducts(page.value));
  }
  return products;
}

async function searchMorrisons(query) {
  let fresh = [];
  let stale = false;
  let liveError = null;
  try {
    fresh = await fetchMorrisons(query);
  } catch (error) {
    stale = true;
    liveError = error.message;
  }

  const products = rankProducts(query, mergeProducts(fresh, cachedMatches(query)));
  if (!products.length) throw new Error(liveError || "No matching products were returned");

  return {
    query,
    products,
    updatedAt: Date.now(),
    sourceUrl: `${MORRISONS_SEARCH}${encodeURIComponent(query)}`,
    stale,
    catalogSize: CATALOG.length,
  };
}

export async function onRequestPost({ request }) {
  try {
    const body = await request.json().catch(() => ({}));
    const unique = [...new Set((body.items || []).map(String).map((x) => x.trim()).filter(Boolean))].slice(0, 30);
    const results = [];
    for (let i = 0; i < unique.length; i += 3) {
      const batch = unique.slice(i, i + 3);
      const settled = await Promise.all(
        batch.map(async (query) => {
          try {
            return { ok: true, ...(await searchMorrisons(query)) };
          } catch (error) {
            return { ok: false, query, error: error.message };
          }
        }),
      );
      results.push(...settled);
    }
    return json({ store: "Morrisons online", results, requestedAt: Date.now() });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}
