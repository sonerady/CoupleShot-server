const express = require("express");
const supabase = require("../supabaseClient"); // Supabase client'ı import ediyoruz

const router = express.Router();

// Ürün ekleme route'u
router.post("/userproduct/add", async (req, res) => {
  const { id, product_id, status, weights, user_id } = req.body; // İlgili alanlar body'den alınır

  if (!id || !product_id || !status || !weights || !user_id) {
    return res.status(400).json({ message: "Gerekli alanlar eksik!" });
  }

  try {
    // Yeni bir ürün ekliyoruz
    const { data, error } = await supabase
      .from("userproduct")
      .insert([{ id, product_id, status, weights, user_id }]);

    if (error) {
      console.error("Ürün eklenirken hata oluştu:", error.message);
      return res
        .status(500)
        .json({ message: "Ürün eklenemedi.", error: error.message });
    }

    res.status(201).json({ message: "Ürün başarıyla eklendi!", data });
  } catch (err) {
    console.error("Sunucu hatası:", err.message);
    res.status(500).json({ message: "Sunucu hatası." });
  }
});

module.exports = router;
