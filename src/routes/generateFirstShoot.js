const express = require("express");
const Replicate = require("replicate");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios"); // Axios eklendi

const router = express.Router();

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

router.post("/", async (req, res) => {
  try {
    console.log(req.body);

    let { input_images, user_id, credit_amount } = req.body; // user_id ve credit_amount parametreleri eklendi

    if (!input_images) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    let repoName = uuidv4();
    repoName = repoName
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-_.]/g, "")
      .replace(/^-+|-+$/g, "");

    // Replicate API ile eğitim başlatıyoruz
    const training = await replicate.trainings.create(
      "ostris",
      "flux-dev-lora-trainer",
      "6f1e7ae9f285cfae6e12f8c18618418cfefe24b07172a17ff10a64fb23a6b772",
      {
        destination: `sonerady/${repoName}`,
        input: {
          steps: 1000,
          lora_rank: 20,
          optimizer: "adamw8bit",
          batch_size: 1,
          resolution: "512,768,1024",
          autocaption: true,
          input_images: input_images,
          trigger_word: "TOK",
          learning_rate: 0.0004,
        },
      }
    );

    // Eğitim başarılı olduktan sonra kredi düşme işlemi
    if (training.status === "succeeded") {
      // Krediden 1 düşmek için API'ye istek atılıyor
      const updatedCreditAmount = credit_amount - 1; // Mevcut krediden 1 kredi çıkarılıyor
      const updateCreditResponse = await axios.post(
        "http://localhost:3001/api/update-credit", // Kredi güncelleme API'sinin URL'si
        {
          user_id: user_id,
          credit_amount: updatedCreditAmount,
        }
      );

      console.log("Kredi güncelleme cevabı:", updateCreditResponse.data);
    }

    res.json({ message: "Training initiated successfully", training });
  } catch (error) {
    console.error("Error initiating training:", error);
    res.status(500).json({ error: "Failed to initiate training" });
  }
});

module.exports = router;
