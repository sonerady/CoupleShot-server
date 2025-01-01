const express = require("express");
const supabase = require("../supabaseClient"); // Supabase client
const router = express.Router();

// İsteğin durumu sorgulayan yeni endpoint
router.get("/checkStatus/:requestId", async (req, res) => {
  const { requestId } = req.params;

  // `userproduct` tablosundan isteğin durumunu sorgulayın
  const { data, error } = await supabase
    .from("userproduct")
    .select("status")
    .eq("product_id", requestId)
    .single();

  if (error || !data) {
    return res.status(404).json({ message: "İstek bulunamadı" });
  }

  // Durumu JSON formatında döndür
  res.status(200).json({ status: data.status });
});

module.exports = router;
