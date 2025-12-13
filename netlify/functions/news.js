// netlify/functions/news.js

exports.handler = async function(event) {
  const API_KEY = process.env.GNEWS_API_KEY;
  if (!API_KEY) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "GNEWS_API_KEY no configurada" })
    };
  }
  
  try {
    const params = event.queryStringParameters || {};
    const q = (params.q || "").trim();
    const pageSize = 3;
    const lang = "es";
    const country = "ar";
    
    const CATEGORIES = ["business", "entertainment", "general", "health", "science", "sports", "technology"];
    const base = "https://gnews.io/api/v4";
    
    const endpoint = CATEGORIES.includes(q) || q === "" ? "/top-headlines" : "/search";
    const url = new URL(base + endpoint);
    
    url.searchParams.set("apikey", API_KEY);
    url.searchParams.set("lang", lang);
    url.searchParams.set("max", String(pageSize));
    
    if (endpoint === "/top-headlines") {
      url.searchParams.set("category", CATEGORIES.includes(q) ? q : "general");
      url.searchParams.set("country", country);
    } else {
      url.searchParams.set("q", q);
    }
    
    const resp = await fetch(url.toString());
    const text = await resp.text();
    
    return {
      statusCode: resp.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: text
    };
    
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Server error", details: err.message })
    };
  }
};