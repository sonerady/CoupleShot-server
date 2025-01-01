const express = require("express");
const router = express.Router();
const axios = require("axios");

require("dotenv").config(); // .env dosyasından API token'i okumak için

router.get("/", async (req, res) => {
  try {
    const response = await axios.get("https://api.replicate.com/v1/trainings", {
      headers: {
        Authorization: `Token ${process.env.REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    // 'cancelled' durumunda olan eğitimleri filtrele
    if (response.data && response.data.results) {
      const filteredTrainings = response.data.results.filter(
        (training) => training.status !== "canceled"
      );

      // Orijinal yanıt yapısını koruyarak filtrelenmiş sonuçları döndür
      res.status(200).json({ ...response.data, results: filteredTrainings });
    } else {
      // Beklenmeyen bir yapı varsa, boş bir dizi döndür
      res.status(200).json({ results: [] });
    }

    console.log("Filtrelenmiş eğitimler gönderildi.");
  } catch (error) {
    console.error("Modeller alınamadı:", error);
    res.status(500).json({ error: "Modeller alınamadı" });
  }
});

module.exports = router;
