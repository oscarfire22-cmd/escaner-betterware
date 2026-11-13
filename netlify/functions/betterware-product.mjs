const STORE = "https://betterware.com.mx";

function cleanText(value) {
  return String(value ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n / 100 : null;
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: {
      "Accept": "application/json, text/plain, */*",
      "User-Agent": "Mozilla/5.0 (compatible; EscanerBetterware/1.0)"
    },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error("Betterware respondió HTTP " + response.status);
  return response.json();
}

export default async (request) => {
  const url = new URL(request.url);
  const sku = (url.searchParams.get("sku") || "").trim();
  if (!sku || sku.length > 80) {
    return Response.json({ error: "Envía un SKU válido." }, { status: 400 });
  }

  try {
    const suggestUrl = new URL("/search/suggest.json", STORE);
    suggestUrl.searchParams.set("q", sku);
    suggestUrl.searchParams.set("resources[type]", "product");
    suggestUrl.searchParams.set("resources[limit]", "10");
    suggestUrl.searchParams.set("resources[options][unavailable_products]", "last");
    suggestUrl.searchParams.set("resources[options][fields]", "title,variants.sku,variants.title,vendor,product_type");

    const suggestions = await getJson(suggestUrl);
    const candidates = suggestions?.resources?.results?.products || [];
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return Response.json({ error: "No se encontró un producto para ese SKU en la búsqueda pública de Betterware." }, { status: 404 });
    }

    for (const candidate of candidates.slice(0, 10)) {
      const handle = candidate.handle || String(candidate.url || "").match(/\/products\/([^/?]+)/)?.[1];
      if (!handle) continue;

      const productUrl = new URL("/products/" + encodeURIComponent(handle) + ".js", STORE);
      const product = await getJson(productUrl);
      const variants = Array.isArray(product.variants) ? product.variants : [];
      const exact = variants.find(variant => String(variant.sku || "").trim().toLowerCase() === sku.toLowerCase());
      if (!exact) continue;

      const price = money(exact.price);
      const compare = money(exact.compare_at_price);
      const hasDiscount = compare !== null && price !== null && compare > price;
      const image = Array.isArray(product.images) && product.images.length ? product.images[0] : (product.featured_image || null);
      return Response.json({
        sku,
        name: cleanText(product.title || candidate.title),
        description: cleanText(product.description || ""),
        regularPrice: hasDiscount ? compare : price,
        promoPrice: hasDiscount ? price : null,
        promoNote: "",
        image,
        url: new URL("/products/" + handle, STORE).toString()
      }, {
        headers: { "Cache-Control": "public, max-age=300, s-maxage=300" }
      });
    }

    return Response.json({ error: "La búsqueda encontró productos, pero ninguno tiene una variante cuyo SKU coincida exactamente con " + sku + ". No se rellenaron datos para evitar registrar un producto equivocado." }, { status: 404 });
  } catch (error) {
    return Response.json({ error: "No fue posible consultar el catálogo público de Betterware: " + (error?.message || "error desconocido") }, { status: 502 });
  }
};
