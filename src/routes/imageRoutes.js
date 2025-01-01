require("dotenv").config();

const express = require("express");
const router = express.Router();
const Replicate = require("replicate");
const axios = require("axios");

const replicate = new Replicate({ token: process.env.REPLICATE_API_TOKEN });

router.post("/upscale-image", async (req, res) => {
  const { imageUrl, backgroundColor, isShadow } = req.body;

  if (!imageUrl) {
    return res.status(400).send({ error: "Image URL is required" });
  }

  try {
    // Remove '#' from the backgroundColor if present
    const cleanBackgroundColor = backgroundColor.replace("#", "");

    // PhotoRoom API params
    const photoRoomParams = {
      "background.color": cleanBackgroundColor,
      outputSize: "2000x2000",
      padding: 0.1,
      imageUrl: imageUrl,
    };

    // Only add shadow.mode if isShadow is true
    if (isShadow) {
      photoRoomParams["shadow.mode"] = "ai.hard";
    }

    const cleanBackgroundResponse = await axios({
      method: "get",
      url: `https://image-api.photoroom.com/v2/edit`,
      params: photoRoomParams,
      headers: {
        "x-api-key": "40d7b215c9330d948f0012dea8c6de4de0dcbedb",
      },
      responseType: "arraybuffer",
    });

    console.log("PhotoRoom API response:", cleanBackgroundResponse.headers);

    const imageBuffer = Buffer.from(cleanBackgroundResponse.data, "binary");
    const cleanedImageUrl = `data:image/png;base64,${imageBuffer.toString(
      "base64"
    )}`;

    const upscaleOutput = await replicate.run(
      "philz1337x/clarity-upscaler:99c3e8b7d14d698e6c5485143c3c3fdf92d3c5e80e9c8f1b76b4ad41a0325a14",
      {
        input: {
          seed: 1337,
          image: cleanedImageUrl,
          prompt:
            "smooth shiny precious metals, white flat background, focused closeup, studio photoshoot, professional light, saturated colors, perfect design, product image, perfect clean shapes, balanced soft light, luxury, closeup, product view, ultra quality, digital art, exquisite hyper details, 4k, Soft illumination, masterpiece, best quality, highres, <lora:more_details:0.5> <lora:SDXLrender_v2.0:1>",
          dynamic: 6,
          sd_model: "juggernaut_reborn.safetensors [338b85bc4f]",
          scheduler: "Euler a",
          creativity: 0.25,
          lora_links: "https://civitai.com/api/download/models/78018",
          downscaling: false,
          resemblance: 0.6,
          scale_factor: 2,
          tiling_width: 144,
          tiling_height: 160,
          negative_prompt:
            "(worst quality, low quality, normal quality:2) JuggernautNegative-neg",
          num_inference_steps: 50,
          downscaling_resolution: 768,
        },
      }
    );

    res.status(200).send({
      originalImage: cleanedImageUrl,
      upscaledImageUrl: upscaleOutput[0],
    });
  } catch (error) {
    console.error("Error during image processing:", error);
    res
      .status(500)
      .send({ error: "Failed to process image", details: error.message });
  }
});

module.exports = router;
