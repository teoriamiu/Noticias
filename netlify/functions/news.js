// netlify/functions/news.js
// Netlify Function: GNews proxy + /tmp cache + Cache-Control header
// Requiere: process.env.GNEWS_API_KEY

const fs = require('fs');
const path = require('path');

exports.handler = async function(event) {
  const API_KEY = process.env.GNEWS_API_KEY;
  if (!API_KEY) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "GNEWS_API_KEY no configurada" })
    };
  }

  // CONFIG
  const CACHE_DIR = '/tmp/gnews_cache';
  const CACHE_TTL = 60 * 5; // segundos (5 min)
  const DEFAULT_PAGE_SIZE = 12;

  // utils cache FS
  function ensureDir() {
    try { if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR); } catch (e) {}
  }
  function cacheKey(q, pageSize) {
    return encodeURIComponent(`${q||'general'}_${pageSize}`);
  }
  function readCache(key) {
    try {
      const file = path.join(CACHE_DIR, key + '.json');
      if (!fs.existsSync(file)) return null;
      const stat = fs.statSync(file);
      const age = (Date.now() - stat.mtimeMs) / 1000;
      if (age > CACHE_TTL) { fs.unlinkSync(file); return null; }
      const txt = fs.readFileSync(file, 'utf8');
      return JSON.parse(txt);
    } catch (e) { return null; }
  }
  function writeCache(key, data) {
    try {
      ensureDir();
      const file = path.join(CACHE_DIR, key + '.json');
      fs.writeFileSync(file, JSON.stringify(data));
    } catch (e) { /* ignore */ }
  }

  try {
    const params = event.queryStringParameters || {};
    let rawQ = (params.q || "").trim();
    const pageSize = Math.min(parseInt(params.pageSize || String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE, 50);
    const country = params.country || "ar";
    // Allow overriding language via query param, default to Spanish
    const lang = params.lang || "es";

    // IDs esperados por GNews
    const CATEGORIES = ["business","entertainment","general","health","science","sports","technology"];

    // Mapa para aceptar nombres en español y mapearlos al id en inglés
    const SP_TO_ID = {
      "negocios": "business",
      "entretenimiento": "entertainment",
      "general": "general",
      "salud": "health",
      "ciencia": "science",
      "deportes": "sports",
      "tecnología": "technology",
      "tecnologia": "technology" // sin tilde
    };

    // Si user pasó una categoría en español (p. ej. 'salud'), mapear
    const rawQLower = rawQ.toLowerCase();
    if (SP_TO_ID[rawQLower]) {
      rawQ = SP_TO_ID[rawQLower];
    }

    const base = "https://gnews.io/api/v4";
    const isCategory = CATEGORIES.includes(rawQ) || rawQ === "";
    const endpoint = isCategory ? "/top-headlines" : "/search";
    const gnewsUrl = new URL(base + endpoint);

    // Build URL to GNews (request in chosen language, default 'es')
    gnewsUrl.searchParams.set("apikey", API_KEY);
    gnewsUrl.searchParams.set("lang", lang);
    gnewsUrl.searchParams.set("max", String(pageSize));

    if (isCategory) {
      gnewsUrl.searchParams.set("category", CATEGORIES.includes(rawQ) ? rawQ : "general");
      gnewsUrl.searchParams.set("country", country);
    } else {
      gnewsUrl.searchParams.set("q", rawQ || "");
    }

    // Check FS cache
    const key = cacheKey(rawQ, pageSize);
    const cached = readCache(key);
    if (cached) {
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=60"
        },
        body: JSON.stringify(cached)
      };
    }

    // Not cached -> fetch GNews
    const resp = await fetch(gnewsUrl.toString());
    const text = await resp.text();

    if (!resp.ok) {
      let details;
      try { details = JSON.parse(text); } catch (e) { details = text; }
      return {
        statusCode: resp.status,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "GNews error", status: resp.status, details })
      };
    }

    let gjson;
    try { gjson = JSON.parse(text); } catch (e) { gjson = { articles: [] }; }

    if (Array.isArray(gjson.articles)) {
      gjson.articles = gjson.articles.map(a => ({
        title: a.title,
        description: a.description,
        url: a.url,
        image: a.image,
        publishedAt: a.publishedAt,
        source: a.source
      }));
    }

    try { writeCache(key, gjson); } catch (e) { /* ignore */ }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=60"
      },
      body: JSON.stringify(gjson)
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Server error", details: err.message })
    };
  }
};