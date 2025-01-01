// routes/registerAnonymousUser.js
const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const supabase = require("../supabaseClient"); // Halihazırda BE tarafında supabaseClient.js var

router.post("/registerAnonymousUser", async (req, res) => {
  try {
    let { userId } = req.body;
    console.log("lelei", userId);
    // Eğer istekle bir userId geldi ise bu kullanıcı zaten var mı bak
    if (userId) {
      const { data: user, error } = await supabase
        .from("users")
        .select("*")
        .eq("id", userId)
        .single();

      if (error || !user) {
        // Kayıt yoksa yeni oluştur
        userId = uuidv4();
        const { data, error: insertError } = await supabase
          .from("users")
          .insert([{ id: userId, credit_balance: 0 }]);

        if (insertError) {
          return res.status(500).json({
            message: "Kullanıcı oluşturulamadı",
            error: insertError.message,
          });
        }

        return res
          .status(200)
          .json({ message: "Yeni anonim kullanıcı oluşturuldu", userId });
      } else {
        // Kullanıcı zaten var
        return res
          .status(200)
          .json({ message: "Kullanıcı zaten mevcut", userId });
      }
    } else {
      // userId yoksa yeni userId oluştur
      userId = uuidv4();
      const { data, error } = await supabase
        .from("users")
        .insert([{ id: userId, credit_balance: 0 }]);

      if (error) {
        return res
          .status(500)
          .json({ message: "Kullanıcı oluşturulamadı", error: error.message });
      }

      return res
        .status(200)
        .json({ message: "Yeni anonim kullanıcı oluşturuldu", userId });
    }
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Sunucu hatası", error: error.message });
  }
});

module.exports = router;
