const express = require("express");
const Replicate = require("replicate");
const axios = require("axios");
const AdmZip = require("adm-zip");
const fs = require("fs");
const path = require("path");
const router = express.Router();

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// Helper function to download ZIP file and extract images
const downloadAndExtractImages = async (zipUrl, outputDir) => {
  const response = await axios({
    url: zipUrl,
    method: "GET",
    responseType: "arraybuffer",
  });

  const zipBuffer = Buffer.from(response.data);
  const zip = new AdmZip(zipBuffer);
  const zipEntries = zip.getEntries();

  // Check if the output directory exists, if not, create it
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Extract only the first 3 image files from the zip
  let imageFiles = [];
  for (let i = 0; i < zipEntries.length && imageFiles.length < 3; i++) {
    const entry = zipEntries[i];
    if (entry.entryName.match(/\.(jpg|jpeg|png|webp)$/i)) {
      const imageDir = path.join(outputDir, "images");

      // Check if the images directory exists, if not, create it
      if (!fs.existsSync(imageDir)) {
        fs.mkdirSync(imageDir, { recursive: true });
      }

      const outputPath = path.join(imageDir, entry.entryName);
      fs.writeFileSync(outputPath, entry.getData());
      imageFiles.push(outputPath);
    }
  }

  return imageFiles;
};

// Function to convert images to base64 format
const convertImagesToBase64 = (imagePaths) => {
  return imagePaths.map((imagePath) => {
    const imageData = fs.readFileSync(imagePath);
    return imageData.toString("base64");
  });
};

router.post("/", async (req, res) => {
  try {
    const {
      model,
      lora_scale,
      num_outputs,
      aspect_ratio,
      output_format,
      guidance_scale,
      output_quality,
      num_inference_steps,
      prompt,
      hf_loras,
      lora_types,
      version,
      category,
      productImages,
      productTypes,
      input_images,
    } = req.body;

    let updatedHfLoras = hf_loras || [];

    if (lora_types) {
      switch (lora_types) {
        case "1":
          updatedHfLoras.push(
            "https://replicate.delivery/yhqm/fyrjwUX3RPTHSiUcLWzIOLXymSfVRb2gDQfxKfIXSQXtelybC/trained_model.tar"
          );
          break;
        case "2":
          updatedHfLoras.push(
            "https://replicate.delivery/yhqm/J3KW8LUHNTLDLRtYI1476C1tzcVKjSjt5tXeRODFV96xmguJA/trained_model.tar"
          );
          break;
        case "3":
          updatedHfLoras.push(
            "https://replicate.delivery/yhqm/HFSA8EXLG5rkAJn7v9ETkJhybZO5mcwDXJN3sqs0J28r1O3E/trained_model.tar"
          );
          break;
        case "4":
          updatedHfLoras.push(
            "https://replicate.delivery/yhqm/lzufr9Pk1LzSFiOOscQG5AOMeKgsNSV4Zf96lhHafq28lC4NB/trained_model.tar"
          );
          break;
        default:
          break;
      }
    }

    // Get the productType label from productTypes using lora_types value
    const productTypeObj = Array.isArray(productTypes)
      ? productTypes.find((pt) => pt.value === lora_types)
      : null;
    const productType = productTypeObj ? productTypeObj.label : "jewelry";

    // Download and extract images from the ZIP file
    const zipUrl = input_images;
    const outputDir = path.join(__dirname, "temp");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const extractedImages = await downloadAndExtractImages(zipUrl, outputDir);

    // Convert extracted images to base64
    const base64Images = convertImagesToBase64(extractedImages);

    // Function to generate prompt using OpenAI API
    const generatePromptUsingChatGPT = async (productType, base64Images) => {
      const apiKey = process.env.OPENAI_API_KEY;
      const apiUrl = "https://api.openai.com/v1/chat/completions";

      // Prepare the messages for the OpenAI API
      const messages = [
        {
          role: "user",
          content: `I will share a new product image, and I’d like you to write a professional image-to-image prompt for the product. The product belongs to the ${productType} category. Provide a detailed and impressive description, covering features like the colors, design, materials used, and other unique characteristics. Refer to the product as ‘TOK’ or a similar name. The background should be pure white, as seen on e-commerce websites, with a subtle shadow beneath the product. Also, the product should have a slight 3D render effect, with highlights and reflections to enhance its details.`,
        },
        {
          role: "user",
          content: `Here are the product images in base64 format: ${base64Images.join(
            "\n"
          )}`,
        },
      ];

      try {
        const response = await axios.post(
          apiUrl,
          {
            model: "gpt-3.5-turbo", // or "gpt-4" if you have access
            messages: messages,
            max_tokens: 500,
          },
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
          }
        );

        const data = response.data;
        const generatedPrompt = data.choices[0].message.content.trim();
        return generatedPrompt;
      } catch (error) {
        console.error(
          "Error in GPT API call:",
          error.response?.data || error.message
        );
        throw error;
      }
    };

    // Generate the prompt using the extracted images
    const generatedPrompt = await generatePromptUsingChatGPT(
      productType,
      base64Images
    );

    console.log("Generated Prompt:", generatedPrompt);

    // Use the generated prompt in replicate.run
    const output = await replicate.run(version, {
      input: {
        prompt: generatedPrompt,
        hf_loras: updatedHfLoras,
        lora_scale: lora_scale || 0.8,
        num_outputs: num_outputs || 1,
        aspect_ratio: aspect_ratio || "1:1",
        output_format: output_format || "webp",
        guidance_scale: guidance_scale || 3.5,
        output_quality: output_quality || 100,
        num_inference_steps: num_inference_steps || 50,
        disable_safety_checker: true,
      },
    });

    res.json({ success: true, output });
    console.log("Output generated:", output);
  } catch (error) {
    console.error("Error running replicate model:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
