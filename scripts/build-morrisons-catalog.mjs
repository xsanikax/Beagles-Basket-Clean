import { writeFile } from "node:fs/promises";

const SITEMAP_URL = "https://groceries.morrisons.com/sitemaps/sitemap-products-part1.xml";
const JSON_OUTPUT = new URL("../public/morrisons-catalog.json", import.meta.url);
const FUNCTION_OUTPUT = new URL("../functions/_catalog.js", import.meta.url);

function decodeHtml(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function titleFromSlug(slug = "") {
  const words = slug
    .split("-")
    .filter(Boolean)
    .map((word) => (/^\d/.test(word) ? word : word[0]?.toUpperCase() + word.slice(1)));
  return words.join(" ");
}

function parseSitemap(xml) {
  const products = [];
  const pattern = /<url>\s*<loc>([^<]+)<\/loc>\s*<image:image>\s*<image:loc>([^<]+)<\/image:loc>\s*<\/image:image>\s*<\/url>/g;
  for (const match of xml.matchAll(pattern)) {
    const url = decodeHtml(match[1]);
    const image = decodeHtml(match[2]).replace("/500x500.", "/300x300.");
    const productMatch = url.match(/\/products\/(.+)\/(\d+)(?:[/?#]|$)/);
    if (!productMatch) continue;
    products.push({
      name: titleFromSlug(productMatch[1]),
      price: null,
      size: "",
      image,
      retailerProductId: productMatch[2],
      searchTerms: [],
      productUrl: url,
      sitemapOnly: true,
    });
  }
  return products;
}

function mergeById(products) {
  const byId = new Map();
  for (const product of products) {
    if (!product.retailerProductId || byId.has(product.retailerProductId)) continue;
    byId.set(product.retailerProductId, product);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const response = await fetch(SITEMAP_URL, {
  headers: { "user-agent": "Mozilla/5.0 (compatible; BeaglesBasket/1.0; catalogue builder)" },
});
if (!response.ok) throw new Error(`Morrisons sitemap returned ${response.status}`);

const products = mergeById(parseSitemap(await response.text()));
await writeFile(JSON_OUTPUT, JSON.stringify({ generatedAt: Date.now(), count: products.length, products }));
await writeFile(
  FUNCTION_OUTPUT,
  `// Keep this tiny so Cloudflare Functions do not bundle the full static catalogue.\n// The browser caches the full sitemap-derived catalogue from /morrisons-catalog.json.\nexport const CATALOG = [];\n`,
);
console.log(`Wrote ${products.length} Morrisons products to ${JSON_OUTPUT.pathname}`);
