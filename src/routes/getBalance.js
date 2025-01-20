const express = require("express");
const axios = require("axios");
const supabase = require("../supabaseClient"); // Supabase client
const router = express.Router();

router.get("/getBalance/:userId", async (req, res) => {
  const { userId } = req.params;
  const apiToken = process.env.REPLICATE_API_TOKEN;

  try {
    // Kullanıcının ürünlerini Supabase'den al
    const { data: userProducts, error: fetchProductsError } = await supabase
      .from("userproduct")
      .select("*")
      .eq("user_id", userId);

    if (fetchProductsError) {
      console.error("Error fetching user products:", fetchProductsError);
      return res.status(500).json({
        message: "Ürünler getirilemedi.",
        error: fetchProductsError.message,
      });
    }

    if (!userProducts || userProducts.length === 0) {
      return res
        .status(404)
        .json({ message: "Kullanıcıya ait ürün bulunamadı." });
    }

    // Tüm ürünlerin işlemlerini gerçekleştirmek için bir döngü oluştur
    for (const product of userProducts) {
      const { product_id, isPaid } = product;

      try {
        // Replicate API'ye istek at
        const response = await axios.get(
          `https://api.replicate.com/v1/trainings/${product_id}`,
          {
            headers: {
              Authorization: `Bearer ${apiToken}`,
            },
          }
        );

        if (response.status !== 200) {
          throw new Error(`API responded with status ${response.status}`);
        }

        const { status, logs, output } = response.data;

        // İlerleme yüzdesini hesapla
        function extractProgressPercentage(logs, status) {
          if (status === "succeeded") {
            return 100;
          }
          const lines = logs.split("\n").reverse();
          for (const line of lines) {
            const match = line.match(/flux_train_replicate:\s*(\d+)%/);
            if (match) {
              return parseInt(match[1], 10);
            }
          }
          return 0;
        }

        const progress_percentage = extractProgressPercentage(logs, status);

        // Train count ve kredi işlemleri
        if (status === "succeeded" && output && output.weights) {
          if (!isPaid) {
            const { data: userData, error: userFetchError } = await supabase
              .from("users")
              .select("train_count, credit_balance")
              .eq("id", userId)
              .single();

            if (userFetchError) {
              console.error("Error fetching user data:", userFetchError);
            } else {
              // Train count'u 1 artır
              const { error: updateUserError } = await supabase
                .from("users")
                .update({
                  train_count: (userData?.train_count || 0) + 1,
                })
                .eq("id", userId);

              if (updateUserError) {
                throw new Error(
                  `Error updating user train count: ${updateUserError.message}`
                );
              }

              // Ürünü güncelle
              const { error } = await supabase
                .from("userproduct")
                .update({
                  isPaid: true,
                  weights: output.weights,
                  status: "succeeded",
                })
                .eq("product_id", product_id);

              if (error) {
                throw new Error(`Supabase error: ${error.message}`);
              }
            }
          }
        } else if (status === "failed" || status === "canceled") {
          // Önce ürünü güncelle, isPaid: false yap
          const { error: productUpdateError } = await supabase
            .from("userproduct")
            .update({ isPaid: false, status })
            .eq("product_id", product_id);

          if (productUpdateError) {
            throw new Error(`Supabase error: ${productUpdateError.message}`);
          }

          // Kullanıcının mevcut kredi ve train_count bilgilerini al
          const { data: userData, error: userFetchError } = await supabase
            .from("users")
            .select("credit_balance, train_count")
            .eq("id", userId)
            .single();

          if (userFetchError) {
            console.error("Error fetching user data:", userFetchError);
          } else if (userData) {
            // 300 kredi iade et ve train_count'u 1 artır
            const newBalance = userData.credit_balance + 300;
            const newTrainCount = (userData.train_count || 0) + 1;

            const { error: updateUserError } = await supabase
              .from("users")
              .update({
                credit_balance: newBalance,
                train_count: newTrainCount,
              })
              .eq("id", userId);

            if (updateUserError) {
              throw new Error(
                `Error updating user data: ${updateUserError.message}`
              );
            }

            console.log(
              `300 kredi iade edildi, train_count artırıldı ve isPaid false yapıldı.`
            );
          }
        }
      } catch (error) {
        // console.error(`Error processing product ${product_id}:`, error.message);
      }
    }

    // Kullanıcının güncel train_count'unu al
    const { data: finalUserData, error: finalUserFetchError } = await supabase
      .from("users")
      .select("train_count")
      .eq("id", userId)
      .single();

    if (finalUserFetchError) {
      throw new Error(
        `Error fetching final user data: ${finalUserFetchError.message}`
      );
    }

    // Son train_count'u ve ürünleri döndür
    res.status(200).json({
      userId,
      train_count: finalUserData.train_count || 0,
      userProducts,
    });
  } catch (err) {
    console.error("Sunucu hatası:", err.message);
    res.status(500).json({ message: "Sunucu hatası." });
  }
});

module.exports = router;
