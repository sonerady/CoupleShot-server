const express = require("express");
const router = express.Router();
const Replicate = require("replicate");

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

router.post("/", async (req, res) => {
  try {
    const {
      image,
      image2,
      steps = 25,
      width = 512,
      height = 728,
      gender = "girl",
    } = req.body;
    console.log("1. Received request with data:", {
      image,
      image2,
      steps,
      width,
      height,
      gender,
    });

    if (!image || !image2) {
      console.log("Error: Both parent images are required");
      return res.status(400).json({ error: "Both parent images are required" });
    }

    console.log("2. Starting Replicate API call...");
    const replicateResponse = await replicate.run(
      "smoosh-sh/baby-mystic:ba5ab694a9df055fa469e55eeab162cc288039da0abd8b19d956980cc3b49f6d",
      {
        input: {
          image,
          image2,
          steps,
          width,
          height,
          gender,
        },
      }
    );
    console.log("3. Replicate API response:", replicateResponse);

    const response = {
      parentImage1: image,
      parentImage2: image2,
      output: replicateResponse,
      generatedBabyImage: replicateResponse,
    };
    console.log("4. Sending response to client:", response);

    res.json(response);
  } catch (error) {
    console.error("Baby generation error details:", {
      message: error.message,
      stack: error.stack,
      response: error.response?.data,
    });
    res.status(500).json({ error: "Failed to generate baby image" });
  }
});

module.exports = router;
