// routes/updateCredit.js

const express = require("express");
const supabase = require("../supabaseClient"); // Supabase client'ı içe aktarıyoruz

const router = express.Router();

// Kredi güncelleme route'u
router.post("/update-credit", async (req, res) => {
  try {
    const { user_id, credit_amount } = req.body;
    console.log("cacaa", credit_amount);

    // Kullanıcının kredi bakiyesini güncelle
    const { data, error } = await supabase
      .from("users") // Tablo adı 'users' olarak değiştirildi
      .update({ credit_balance: credit_amount })
      .eq("id", user_id); // 'id' ile kullanıcıyı bul

    if (error) {
      throw error;
    }

    res.status(200).json({ message: "Kredi başarıyla güncellendi", data });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Kredi güncellenemedi", error: error.message });
  }
});

module.exports = router;
