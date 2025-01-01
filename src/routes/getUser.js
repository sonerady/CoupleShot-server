const express = require("express");
const supabase = require("../supabaseClient"); // Supabase client'ı import ediyoruz

const router = express.Router();

// Kullanıcı bilgilerini almak için route
router.get("/user/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", id)
      .limit(1);

    if (error) {
      console.error("Veritabanı hatası:", error.message);
      return res.status(400).json({ error: error.message });
    }

    if (!data) {
      console.error("Kullanıcı bulunamadı.");
      return res.status(404).json({ message: "Kullanıcı bulunamadı" });
    }

    res.status(200).json(data);
  } catch (err) {
    console.error("Kullanıcı bilgisi alınamadı:", err.message);
    res.status(500).json({ message: "Sunucu hatası" });
  }
});

module.exports = router;
