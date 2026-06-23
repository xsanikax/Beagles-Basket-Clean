function validateImageUrl(value = "") {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "groceries.morrisons.com" || !url.pathname.startsWith("/images-v3/")) {
    throw new Error("Unsupported image URL");
  }
  return url;
}

export async function onRequestGet({ request }) {
  try {
    const url = new URL(request.url);
    const imageUrl = validateImageUrl(url.searchParams.get("url") || "");
    const response = await fetch(imageUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; BeaglesBasket/1.0)",
        referer: "https://groceries.morrisons.com/",
        accept: "image/avif,image/webp,image/png,image/jpeg,*/*",
      },
      cf: { cacheTtl: 604800, cacheEverything: true },
    });
    if (!response.ok) throw new Error(`Image returned ${response.status}`);
    return new Response(response.body, {
      status: 200,
      headers: {
        "content-type": response.headers.get("content-type") || "image/jpeg",
        "cache-control": "public, max-age=604800",
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
