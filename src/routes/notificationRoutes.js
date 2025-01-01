const express = require("express");
const supabase = require("../supabaseClient"); // Supabase client'ı import ediyoruz
const router = express.Router();

// Bildirimleri listeleme (kullanıcıya göre)
router.get("/notifications/:user_id", async (req, res) => {
  const { user_id } = req.params;

  try {
    // Supabase'den kullanıcının bildirimlerini alıyoruz
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user_id)
      .order("created_at", { ascending: false }); // En son eklenen bildirimi önce döner

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(200).json(data);
  } catch (err) {
    console.error("Bildirimler alınamadı:", err.message);
    res.status(500).json({ message: "Sunucu hatası" });
  }
});

// Yeni bildirim ekleme
router.post("/notifications", async (req, res) => {
  const { user_id, message } = req.body;
  console.log("idddddddd", user_id);

  if (!user_id || !message) {
    return res.status(400).json({ error: "User ID ve message gerekli." });
  }

  try {
    const { data, error } = await supabase
      .from("notifications")
      .insert([{ user_id, message }]);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(201).json({ message: "Bildirim başarıyla eklendi.", data });
  } catch (err) {
    console.error("Bildirim eklenemedi:", err.message);
    res.status(500).json({ message: "Sunucu hatası" });
  }
});

module.exports = router;
