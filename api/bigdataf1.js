
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const raceId = String(req.query.raceId ?? "");

  if (raceId !== "jumper" && !/^\d+$/.test(raceId)) {
    return res.status(400).json({ error: "Invalid race ID" });
  }

  try {
    const response = await fetch(
      `https://api.bigdataf1.com/api/races/${raceId}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Accept": "application/json",
          "Referer": "https://www.bigdataf1.com/"
        }
      }
    );

    const body = await response.text();

    res.setHeader("Content-Type", "application/json");
    return res.status(response.status).send(body);
  } catch (error) {
    console.error("BigDataF1 proxy error:", error);
    return res.status(502).json({ error: "BigDataF1 unavailable" });
  }
};
