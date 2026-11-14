const STORE = "https://betterware.com.mx";

function cleanText(value) {
  return String(value ?? "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
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

async function getHtml(url) {
  const response = await fetch(url, {
    headers: {
      "Accept": "text/html,application/xhtml+xml",
      "User-Agent": "Mozilla/5.0 (compatible; EscanerBetterware/1.0)"
    },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) return "";
  return response.text();
}

// Betterware puede publicar el precio condicionado en la página de colección,
// mientras que el endpoint Shopify .js solo entrega el precio base.
function readCatalogOffer(html, sku, productName) {
  if (!html) return null;
  const text = cleanText(html);
  const skuAt = text.indexOf(String(sku));
  const nameAt = productName ? text.toLowerCase().indexOf(productName.toLowerCase()) : -1;
  const at = skuAt >= 0 ? skuAt : nameAt;
  const nearby = at >= 0
    ? text.slice(Math.max(0, at - 900), Math.min(text.length, at + 2200))
    : text;
  const context = nearby.toLowerCase();

  // Solo aceptar un precio de oferta cuando el propio bloque del producto
  // contiene una condición promocional reconocible.
  const conditionPatterns = [
    /ahorra al comprar\s+\d+\s+productos? de todo el cat[aá]logo/i,
    /al comprar\s+\d+\s+productos? del cat[aá]logo/i,
    /compra\s+\d+\s+productos? del cat[aá]logo/i,
    /ll[eé]vatelo?\s+a precio/i,
    /precio de oferta/i,
    /precio promocional/i,
    /h[ií]per oferta|mega oferta/i
  ];
  const conditionMatch = conditionPatterns.map(re => nearby.match(re)).find(Boolean);
  if (!conditionMatch) return null;

  const amounts = [...nearby.matchAll(/(?:\$|MXN)\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/gi)]
    .map(m => Number(m[1].replace(/,/g, "")))
    .filter(n => Number.isFinite(n) && n > 0 && n < 100000);
  const unique = [...new Set(amounts)];
  if (!unique.length) return { note: conditionMatch[0], promoPrice: null, regularPrice: null };

  // Shopify price se usa como referencia de comparación para elegir el menor
  // valor distinto encontrado en el bloque, sin inventar un monto.
  return {
    note: conditionMatch[0].trim(),
    promoPrice: Math.min(...unique),
    regularPrice: Math.max(...unique)
  };
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

      const basePrice = money(exact.price);
      const comparePrice = money(exact.compare_at_price);
      const hasStandardDiscount = comparePrice !== null && basePrice !== null && comparePrice > basePrice;
      const image = Array.isArray(product.images) && product.images.length ? product.images[0] : (product.featured_image || null);
      const canonicalUrl = new URL("/products/" + handle, STORE).toString();

      // Consultar también la ficha HTML: Betterware coloca algunas ofertas
      // condicionadas en el contenido de la página, no en variants.price.
      const productName = cleanText(product.title || candidate.title);
      const collectionSlug = String(candidate.product_type || "").trim().toLowerCase()
        .normalize("NFD").replace(/[\\u0300-\\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      let pageHtml = "";
      let offer = null;
      // La tienda puede mostrar el precio condicionado en la vista de colección,
      // no en la ficha individual. Probar primero la colección del tipo de producto.
      if (collectionSlug) {
        pageHtml = await getHtml(new URL("/collections/" + collectionSlug + "/products/" + encodeURIComponent(handle), STORE).toString());
        offer = readCatalogOffer(pageHtml, sku, productName);
      }
      if (!offer) {
        pageHtml = await getHtml(canonicalUrl);
        offer = readCatalogOffer(pageHtml, sku, productName);
      }

      let regularPrice = hasStandardDiscount ? comparePrice : basePrice;
      let promoPrice = hasStandardDiscount ? basePrice : null;
      let promoNote = "";
      let promoType = "";
      let promoConditions = "";

      if (offer) {
        promoNote = offer.note;
        promoConditions = offer.note;
        promoType = /h[ií]per oferta/i.test(offer.note) ? "Híper oferta" :
          /mega oferta/i.test(offer.note) ? "Mega oferta" : "Oferta condicionada";
        // Si la página publica dos precios en el bloque de oferta, usar el
        // menor como promocional y el mayor como regular.
        if (offer.promoPrice !== null && offer.regularPrice !== null && offer.promoPrice < offer.regularPrice) {
          promoPrice = offer.promoPrice;
          regularPrice = offer.regularPrice;
        }
      }

      return Response.json({
        sku,
        name: cleanText(product.title || candidate.title),
        description: cleanText(product.description || ""),
        regularPrice,
        promoPrice,
        promoNote,
        promoType,
        promoConditions,
        promoValidUntil: "",
        image,
        url: canonicalUrl,
        offerSource: offer ? "product-page" : "shopify-product"
      }, {
        headers: { "Cache-Control": "public, max-age=300, s-maxage=300" }
      });
    }

    return Response.json({ error: "La búsqueda encontró productos, pero ninguno tiene una variante cuyo SKU coincida exactamente con " + sku + ". No se rellenaron datos para evitar registrar un producto equivocado." }, { status: 404 });
  } catch (error) {
    return Response.json({ error: "No fue posible consultar el catálogo público de Betterware: " + (error?.message || "error desconocido") }, { status: 502 });
  }
};
