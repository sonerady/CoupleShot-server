const express = require("express");
const axios = require("axios");
const supabase = require("../supabaseClient"); // Supabase client
const router = express.Router();

router.get("/:training_id", async (req, res) => {
  const { training_id } = req.params;
  const { user_id } = req.query; // Get user_id from query parameters
  const apiToken = process.env.REPLICATE_API_TOKEN;

  try {
    const response = await axios.get(
      `https://api.replicate.com/v1/trainings/${training_id}`,
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
        },
      }
    );

    if (response.status !== 200) {
      throw new Error(`API responded with status ${response.status}`);
    }

    const { status, logs, output, input } = response.data;

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

    const { data: productData, error: fetchError } = await supabase
      .from("userproduct")
      .select("*")
      .eq("product_id", training_id)
      .eq("user_id", user_id) // Add user_id check
      .single();

    if (fetchError) {
      console.error("Error fetching product data:", fetchError);
      return res
        .status(404)
        .json({ error: "Product not found or unauthorized" });
    }

    if (!productData) {
      console.log(
        `No product found with ID: ${training_id} for user: ${user_id}`
      );
      return res
        .status(404)
        .json({ error: "Product not found or unauthorized" });
    }

    // Training başarıyla tamamlandığında
    if (status === "succeeded" && output && output.weights) {
      // Training bilgilerini güncelle
      const { error } = await supabase
        .from("userproduct")
        .update({
          weights: output.weights,
          status: "succeeded",
        })
        .eq("product_id", training_id)
        .eq("user_id", user_id); // Add user_id check

      if (error) {
        throw new Error(`Supabase error: ${error.message}`);
      }

      // Burada input_images linkini parçalayarak dosya adını bulup silme işlemini gerçekleştirelim
      if (input && input.input_images) {
        const imageUrl = input.input_images;
        // Örnek URL: "https://xxxxx.supabase.co/storage/v1/object/public/zips/images_123456.zip"
        const fileName = imageUrl.substring(imageUrl.lastIndexOf("/") + 1);

        // Check if the zip file belongs to the user before deleting
        const { data: zipData, error: zipError } = await supabase.storage
          .from("zips")
          .list("", {
            search: fileName,
          });

        if (!zipError && zipData && zipData.length > 0) {
          const { error: removeZipError } = await supabase.storage
            .from("zips")
            .remove([fileName]);

          if (removeZipError) {
            console.error("Zip dosyası bucket'tan silinemedi:", removeZipError);
          } else {
            console.log("Zip dosyası başarıyla silindi:", fileName);
          }
        }
      }
    } else if (status === "canceled" || status === "failed") {
      const { error } = await supabase
        .from("userproduct")
        .update({ status })
        .eq("product_id", training_id)
        .eq("user_id", user_id); // Add user_id check

      if (error) {
        throw new Error(`Supabase error: ${error.message}`);
      }
    }

    res.status(200).json({ ...response.data, progress: progress_percentage });
  } catch (error) {
    console.error("Error fetching training data:", error.message);
    // FE'ye boş data gönder
    res.status(200).json({
      status: "failed",
      logs: "",
      output: {},
      progress: 0,
    });
  }
});

module.exports = router;
