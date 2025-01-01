const express = require("express");
const supabase = require("../supabaseClient"); // Supabase client'ı import ediyoruz

const router = express.Router();

// Kullanıcının ürünlerini getiren route
router.get("/userproduct/:id/:status?", async (req, res) => {
  const { id, status } = req.params; // status parametresini de alıyoruz
  console.log("caca", id, status); // status'u konsola yazdırıyoruz

  try {
    // Sorgu için temel yapı
    let query = supabase.from("userproduct").select("*").eq("user_id", id);

    // Eğer status varsa, sorguya ekliyoruz
    if (status) {
      query = query.eq("status", status);
    }

    // Belirtilen kullanıcıya ait ürünleri çekiyoruz
    const { data, error } = await query;

    console.log("dataaa", id);

    if (error) {
      console.error("Ürünler getirilirken hata oluştu:", error.message);
      return res
        .status(500)
        .json({ message: "Ürünler getirilemedi.", error: error.message });
    }

    if (!data.length) {
      return res
        .status(404)
        .json({ message: "Bu kullanıcıya ait ürün bulunamadı." });
    }

    res.status(200).json(data);
  } catch (err) {
    console.error("Sunucu hatası:", err.message);
    res.status(500).json({ message: "Sunucu hatası." });
  }
});

module.exports = router;
