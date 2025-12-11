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
  const CONCURRENCY = 4;     // concurrencia por batch
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
    const rawQ = (params.q || "").trim();
    const pageSize = Math.min(parseInt(params.pageSize || String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE, 50);
    const country = params.country || "ar";
    const lang = params.lang || "es";

    const CATEGORIES = ["business","entertainment","general","health","science","sports","technology"];
    const base = "https://gnews.io/api/v4";
    const isCategory = CATEGORIES.includes(rawQ) || rawQ === "";
    const endpoint = isCategory ? "/top-headlines" : "/search";
    const gnewsUrl = new URL(base + endpoint);

    // Build URL to GNews (we request in 'en' for broader results; you can change to 'es')
    gnewsUrl.searchParams.set("apikey", API_KEY);
    gnewsUrl.searchParams.set("lang", "en");
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
          "Cache-Control": "public, max-age=60" // CDN caché corto
        },
        body: JSON.stringify(cached)
      };
    }

    // Not cached -> fetch GNews
    const resp = await fetch(gnewsUrl.toString());
    const text = await resp.text();

    if (!resp.ok) {
      // forward error details
      let details;
      try { details = JSON.parse(text); } catch (e) { details = text; }
      return {
        statusCode: resp.status,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "GNews error", status: resp.status, details })
      };
    }

    // parse, optionally process, then cache
    let gjson;
    try { gjson = JSON.parse(text); } catch (e) { gjson = { articles: [] }; }

    // Optionally: you could post-process articles here (trim fields, limit fields)
    // Example: strip large fields to save cache space
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

    // write cache
    try { writeCache(key, gjson); } catch (e) { /* ignore */ }

    // return success with Cache-Control for CDN
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=60" // CDN cache 60s
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