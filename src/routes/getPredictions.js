const express = require("express");
const supabase = require("../supabaseClient");
const axios = require("axios");

const router = express.Router();

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

// Replicate'ten gelen logs içerisinden progress yüzdesini çıkaran fonksiyon
function extractProgressFromLogs(logs) {
  if (!logs || typeof logs !== "string") return 0;

  const lines = logs.split("\n").reverse();
  for (const line of lines) {
    const match = line.match(/(\d+)%\|/);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  return 0;
}

// Belirli bir prediction_id için Replicate API'sinden detayları alan fonksiyon
async function fetchPredictionDetails(predictionId) {
  try {
    const response = await axios.get(
      `https://api.replicate.com/v1/predictions/${predictionId}`,
      {
        headers: {
          Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error(
      `Error fetching prediction ${predictionId} from Replicate:`,
      error.response ? error.response.data : error.message
    );
    return null;
  }
}

router.get("/getPredictions/:userId", async (req, res) => {
  const { userId } = req.params;

  // limit parametresini al
  const limitParam = req.query.limit;
  let limit = null;

  console.log("Received limit parameter:", limitParam);

  if (limitParam !== undefined) {
    limit = parseInt(limitParam, 10);
    if (isNaN(limit) || limit <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid 'limit' parameter. It must be a positive integer.",
      });
    }

    const MAX_LIMIT = 100;
    if (limit > MAX_LIMIT) {
      return res.status(400).json({
        success: false,
        message: `The 'limit' parameter cannot exceed ${MAX_LIMIT}.`,
      });
    }
  }

  try {
    // 2 saat önceki zaman damgası
    const twoHoursAgo = new Date();
    twoHoursAgo.setHours(twoHoursAgo.getHours() - 2);

    // 2 saatten eski tüm kayıtları sil
    const { error: deleteError } = await supabase
      .from("predictions")
      .delete()
      .lt("created_at", twoHoursAgo.toISOString()); // <-- user_id filtrelemezsek tüm kullanıcılar için

    if (deleteError) {
      console.error("Delete error:", deleteError);
      return res.status(500).json({
        success: false,
        message: "Failed to delete old predictions",
      });
    }

    // Supabase sorgusu: son 24 saat, bu kısım aynen kalabilir veya isteğe göre değiştirilebilir
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    let query = supabase
      .from("predictions")
      .select(
        "id, prediction_id, categories, product_id, product_main_image, created_at"
      )
      .eq("user_id", userId)
      .gte("created_at", oneDayAgo.toISOString())
      .order("created_at", { ascending: false });

    if (limit !== null) {
      console.log(`Applying limit: ${limit}`);
      query = query.limit(limit);
    }

    const { data: predictions, error: fetchError } = await query;
    if (fetchError) {
      console.error("Fetch error:", fetchError);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch predictions",
      });
    }

    console.log(`Fetched ${predictions.length} predictions`);

    // Her bir prediction için Replicate detaylarını al
    const predictionsWithDetails = await Promise.all(
      predictions.map(async (prediction) => {
        const replicateData = await fetchPredictionDetails(
          prediction.prediction_id
        );

        if (!replicateData) {
          return {
            ...prediction,
            replicate_status: "unknown",
            replicate_output: null,
            replicate_error: null,
            progress: 0,
            image_count: 0,
            replicate_logs: "",
          };
        }

        const progress = extractProgressFromLogs(replicateData.logs);

        return {
          ...prediction,
          replicate_status: replicateData.status,
          replicate_output: replicateData.output || null,
          replicate_error: replicateData.error || null,
          progress,
          image_count: replicateData.input.num_outputs || 0,
          replicate_logs: replicateData.logs || "",
        };
      })
    );

    return res.status(200).json({
      success: true,
      data: predictionsWithDetails,
    });
  } catch (error) {
    console.error("Error fetching predictions:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching predictions",
    });
  }
});

module.exports = router;
