const express = require("express");
const supabase = require("../supabaseClient"); // Supabase client'ı
const router = express.Router();
const multer = require("multer"); // Dosya yüklemek için kullanılıyor
const upload = multer(); // Geçici olarak bellekte tutmak için

router.post("/upload", upload.array("files", 10), async (req, res) => {
  const files = req.files;

  if (!files || files.length === 0) {
    return res.status(400).json({ message: "Dosya gerekli." });
  }

  try {
    const publicUrls = [];

    for (const file of files) {
      // Dosya ismi oluşturma
      const fileName = `${Date.now()}_${file.originalname}`;

      // Dosyayı Supabase bucket'ına yüklüyoruz
      const { data, error } = await supabase.storage
        .from("images") // Bucket adınız
        .upload(fileName, file.buffer, {
          contentType: file.mimetype,
        });

      if (error) {
        throw error;
      }

      // Dosyanın herkese açık URL'sini alıyoruz
      const { data: publicUrlData, error: urlError } = await supabase.storage
        .from("images")
        .getPublicUrl(fileName);

      if (urlError) {
        throw urlError;
      }

      publicUrls.push(publicUrlData.publicUrl);
    }

    // Yüklenen URL'leri console'a yazdır
    console.log("Uploaded URLs:", publicUrls);

    // URL'leri JSON formatında döndür
    res.status(200).json(publicUrls);
  } catch (error) {
    console.error("Dosya yükleme hatası:", error);
    res
      .status(500)
      .json({ message: "Dosya yüklenemedi.", error: error.message });
  }
});

module.exports = router;
