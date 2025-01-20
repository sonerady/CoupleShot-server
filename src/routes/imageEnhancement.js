const express = require("express");
const router = express.Router();
const Replicate = require("replicate");

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

router.post("/", async (req, res) => {
  try {
    const { imageUrl, scale = 4, faceEnhance = true } = req.body;
    console.log("1. Received request with data:", {
      imageUrl,
      scale,
      faceEnhance,
    });

    if (!imageUrl) {
      console.log("Error: No image URL provided");
      return res.status(400).json({ error: "Image URL is required" });
    }

    console.log("2. Starting Replicate API call...");
    const replicateResponse = await replicate.run(
      "daanelson/real-esrgan-a100:f94d7ed4a1f7e1ffed0d51e4089e4911609d5eeee5e874ef323d2c7562624bed",
      {
        input: {
          image: imageUrl,
          scale: scale,
          face_enhance: faceEnhance,
        },
      }
    );
    console.log("3. Replicate API response:", replicateResponse);

    const response = {
      input: imageUrl,
      output: replicateResponse,
      enhancedImageUrl: replicateResponse.output,
    };
    console.log("4. Sending response to client:", response);

    res.json(response);
  } catch (error) {
    console.error("Image enhancement error details:", {
      message: error.message,
      stack: error.stack,
      response: error.response?.data,
    });
    res.status(500).json({ error: "Failed to enhance image" });
  }
});

module.exports = router;
