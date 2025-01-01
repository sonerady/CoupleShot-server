const express = require("express");
const Replicate = require("replicate");
const supabase = require("../supabaseClient");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");
const axios = require("axios");

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleAIFileManager } = require("@google/generative-ai/server");

const router = express.Router();

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);
const fileManager = new GoogleAIFileManager(apiKey);

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// Function to download an image from a URL
async function downloadImage(url, filepath) {
  const writer = fs.createWriteStream(filepath);

  const response = await axios({
    url,
    method: "GET",
    responseType: "stream",
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

// Function to upload a file to Gemini
async function uploadToGemini(filePath, mimeType) {
  const uploadResult = await fileManager.uploadFile(filePath, {
    mimeType,
    displayName: path.basename(filePath),
  });
  const file = uploadResult.file;
  console.log(`Uploaded file ${file.displayName} as: ${file.name}`);
  return file;
}

// Function to generate a prompt using Google Gemini
async function generatePrompt(
  imageUrl,
  initialPrompt,
  customPrompt,
  extraPromptDetail,
  categories
) {
  const MAX_RETRIES = 20; // Define the maximum number of retries
  let attempt = 0;
  let generatedPrompt = "";

  console.log("Image URL:", imageUrl);

  // Ensure temp directory exists
  const tempDir = path.join(__dirname, "temp");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
  }

  let tempImagePath; // Declare tempImagePath here

  while (attempt < MAX_RETRIES) {
    try {
      let contentMessage = "";

      console.log("Initial Prompt:", initialPrompt);
      console.log("Custom Prompt:", customPrompt);
      console.log("Extra Prompt Detail:", extraPromptDetail);

      let environmentContext = "";
      if (customPrompt && initialPrompt) {
        environmentContext = `${initialPrompt}, ${customPrompt}`;
      } else if (customPrompt) {
        environmentContext = customPrompt;
      } else if (initialPrompt) {
        environmentContext = initialPrompt;
      }

      const rawImageString = imageUrl;
      let convertedImageUrl;

      try {
        convertedImageUrl = JSON.parse(rawImageString)[0]; // Extract the URL from JSON string
        console.log("Converted Image URL:", convertedImageUrl);
      } catch (error) {
        console.error("Error parsing image URL:", error);
        convertedImageUrl = rawImageString; // Use original string in case of error
      }

      console.log("Converted Image URL:", convertedImageUrl);

      if (categories === "on_model") {
        contentMessage = `Create a highly detailed, professional prompt describing every minute detail of the product in the provided image with absolute accuracy—its color, fabric, texture, subtle embroidery, intricate stitching, and any unique design elements—ensuring it is worn by a real-life model (no mannequins) and emphasizing how it interacts naturally with the model’s body, how the material drapes, moves, and catches the light, all captured in a refined, high-fashion editorial photography style with masterful lighting, composition, and camera angles; translate and integrate any provided environmental, model, or product details into English if needed, merge all elements into a single continuous line without headings or paragraphs. ${
          environmentContext ? `include: ${environmentContext},` : ""
        } ${extraPromptDetail ? `also include: ${extraPromptDetail}.` : ""}`;
      } else if (categories === "photoshoot") {
        contentMessage = `Create an extremely detailed, vividly descriptive, and atmospherically rich English prompt that showcases the product as the focal point of a creative AI-generated photoshoot scene without any model; portray intricate textures, colors, materials, subtle patterns, and how light and shadow play across its surface in a captivating environment that enhances the product’s unique qualities, translating any provided environmental or contextual details into English and seamlessly integrating them, along with additional product information, into a single continuous prompt line without headings or paragraphs; ${
          environmentContext ? `include: ${environmentContext},` : ""
        } ${extraPromptDetail ? `also include: ${extraPromptDetail}.` : ""}`;
      } else if (categories === "retouch") {
        contentMessage = `Create a single-line English prompt describing and enhancing the main product in the image, focusing on its intricate details, textures, and fabric quality, then refining brightness, clarity, shadows, texture, and color vibrancy on a pure white background without mentioning any other elements; seamlessly integrate any provided context or additional details into this single continuous line; ${
          environmentContext ? `include: ${environmentContext},` : ""
        } ${extraPromptDetail ? `also include: ${extraPromptDetail}.` : ""}`;
      }

      tempImagePath = path.join(tempDir, `${uuidv4()}.jpg`);

      // Download the image
      await downloadImage(convertedImageUrl, tempImagePath);

      // Upload the image to Gemini
      const uploadedFile = await uploadToGemini(tempImagePath, "image/jpeg");

      // Set up the model
      const model = genAI.getGenerativeModel({
        model: "gemini-1.5-flash",
      });

      const generationConfig = {
        temperature: 1,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
        responseMimeType: "text/plain",
      };

      // Build the history
      const history = [
        {
          role: "user",
          parts: [
            {
              fileData: {
                mimeType: "image/jpeg",
                fileUri: uploadedFile.uri,
              },
            },
            { text: contentMessage },
          ],
        },
      ];

      // Start chat session
      const chatSession = model.startChat({
        generationConfig,
        history,
      });

      // Send an empty message to get the response
      const result = await chatSession.sendMessage("");

      // Extract the response text
      generatedPrompt = result.response.text();

      console.log("Generated prompt:", generatedPrompt);
      const finalWordCount = generatedPrompt.trim().split(/\s+/).length;

      // Check if the response contains the undesired phrase
      if (
        generatedPrompt.includes("I’m sorry") ||
        generatedPrompt.includes("I'm sorry") ||
        generatedPrompt.includes("I'm unable") ||
        generatedPrompt.includes("I can't") ||
        (generatedPrompt.includes("I cannot") && finalWordCount < 100)
      ) {
        console.warn(
          `Attempt ${
            attempt + 1
          }: Received an undesired response from Gemini. Retrying...`
        );
        attempt++;
        // Optional: Add a delay before retrying
        await new Promise((resolve) => setTimeout(resolve, 1000)); // 1-second delay
        continue; // Retry the loop
      }

      // If the response is valid, break out of the loop
      break;
    } catch (error) {
      console.error("Error generating prompt:", error);
      attempt++;
      // Optional: Add a delay before retrying
      await new Promise((resolve) => setTimeout(resolve, 1000)); // 1-second delay
    } finally {
      // Clean up: delete the temp image file
      if (tempImagePath && fs.existsSync(tempImagePath)) {
        fs.unlinkSync(tempImagePath);
      }
    }
  }

  if (
    generatedPrompt.includes("I’m sorry") ||
    generatedPrompt.includes("I'm sorry") ||
    generatedPrompt.includes("I'm unable")
  ) {
    throw new Error(
      "Gemini API could not generate a valid prompt after multiple attempts."
    );
  }

  return generatedPrompt;
}

// Function to generate images using Replicate API
async function generateImagesWithReplicate(
  prompt,
  hf_loras,
  categories,
  imageRatio,
  imageFormat,
  imageCount
) {
  try {
    // Modify prompt based on category
    let modifiedPrompt = `A photo of TOK ${prompt}`;
    if (categories === "retouch") {
      modifiedPrompt += " in the middle, white background";
    }

    // Set default hf_loras based on category
    let hf_loras_default = [];
    if (categories === "on_model") {
      hf_loras_default = ["VideoAditor/Flux-Lora-Realism"];
    } else if (categories === "retouch") {
      hf_loras_default = ["gokaygokay/Flux-White-Background-LoRA"];
    }

    const filteredHfLoras = Array.isArray(hf_loras)
      ? hf_loras.filter(
          (item) => typeof item === "string" && item.trim() !== ""
        )
      : [];

    // Combine default and provided hf_loras
    const combinedHfLoras =
      filteredHfLoras.length > 0
        ? [...hf_loras_default, ...filteredHfLoras]
        : hf_loras_default;

    console.log("Combined hf_loras:", combinedHfLoras);

    const output = await replicate.run(
      "lucataco/flux-dev-multi-lora:2389224e115448d9a77c07d7d45672b3f0aa45acacf1c5bcf51857ac295e3aec",
      {
        input: {
          prompt: modifiedPrompt,
          hf_loras: combinedHfLoras,
          lora_scales: [0.85],
          num_outputs: imageCount,
          aspect_ratio: imageRatio,
          output_format: imageFormat,
          guidance_scale: 5,
          output_quality: 100,
          prompt_strength: 1,
          num_inference_steps: 50,
          disable_safety_checker: true,
        },
      }
    );

    return output;
  } catch (error) {
    console.error("Error generating images:", error);
    throw error;
  }
}

// Function to update the request status in Supabase
async function updateRequestStatus(request_id, status) {
  const { data, error } = await supabase
    .from("requests")
    .update({ status })
    .eq("request_id", request_id);

  if (error) {
    console.error(
      `Error updating request status to '${status}' for request_id ${request_id}:`,
      error
    );
    throw error;
  }

  console.log(`Request ${request_id} status updated to '${status}'.`);
}

// Function to create a new request in Supabase
async function createSupabaseRequest({
  userId,
  productId,
  product_main_image,
  imageCount,
  requests_image,
}) {
  const newUuid = uuidv4(); // Generate a new UUID

  const { data, error } = await supabase
    .from("requests")
    .insert([
      {
        user_id: userId,
        status: "pending",
        image_url: requests_image, // Assuming first image URL
        product_id: productId,
        request_id: newUuid,
        image_count: imageCount,
      },
    ])
    .select();

  if (error) {
    console.error("Supabase insert error:", error);
    throw new Error("Failed to create request in Supabase.");
  }

  console.log("Request successfully added to Supabase:", data);
  return newUuid;
}

// Main POST endpoint with request_id handling
router.post("/generatePredictions", async (req, res) => {
  const {
    prompt,
    hf_loras,
    categories,
    userId,
    productId, // This will be a varchar
    product_main_image,
    customPrompt,
    extraPromptDetail,
    imageRatio,
    imageFormat,
    imageCount,
    requests_image,
    // request_id is no longer expected from frontend
  } = req.body;

  // Basic validation
  if (!userId || !productId || !product_main_image || !imageCount) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields.",
    });
  }

  try {
    // Create a new request in Supabase and get the request_id
    const request_id = await createSupabaseRequest({
      userId,
      productId,
      product_main_image,
      imageCount,
      requests_image: requests_image,
    });

    console.log("Starting prompt generation for productId:", productId);

    // Generate the prompt
    const generatedPrompt = await generatePrompt(
      product_main_image[0],
      prompt,
      customPrompt,
      extraPromptDetail,
      categories
    );

    console.log("Generated Prompt:", generatedPrompt);

    // Fetch current imageCount for the product
    const { data: productData, error: productError } = await supabase
      .from("userproduct")
      .select("imageCount")
      .eq("product_id", productId) // product_id is varchar
      .single();

    if (productError) {
      console.error("Error fetching product data:", productError);
      // Update request status to 'failed'
      await updateRequestStatus(request_id, "failed");
      return res.status(500).json({
        success: false,
        message: "Failed to fetch product data",
        error: productError.message,
      });
    }

    // Calculate the new imageCount
    const newImageCount = (productData?.imageCount || 0) + imageCount;

    // Check if newImageCount exceeds 30
    if (newImageCount > 30) {
      const creditsToDeduct = imageCount * 5; // 5 credits per image

      // Fetch user's current credit balance
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("credit_balance")
        .eq("id", userId)
        .single();

      if (userError) {
        console.error("Error fetching user data:", userError);
        // Update request status to 'failed'
        await updateRequestStatus(request_id, "failed");
        return res.status(500).json({
          success: false,
          message: "Failed to fetch user data",
          error: userError.message,
        });
      }

      // Check if user has enough credits
      if (userData.credit_balance < creditsToDeduct) {
        // Update request status to 'failed'
        await updateRequestStatus(request_id, "failed");
        return res.status(400).json({
          success: false,
          message: "Insufficient credit balance",
        });
      }

      // Deduct credits from user's balance
      const { error: creditUpdateError } = await supabase
        .from("users")
        .update({ credit_balance: userData.credit_balance - creditsToDeduct })
        .eq("id", userId);

      if (creditUpdateError) {
        console.error("Error updating credit balance:", creditUpdateError);
        // Update request status to 'failed'
        await updateRequestStatus(request_id, "failed");
        return res.status(500).json({
          success: false,
          message: "Failed to deduct credits",
          error: creditUpdateError.message,
        });
      }

      console.log(`Deducted ${creditsToDeduct} credits from userId: ${userId}`);
    }

    // Generate images using Replicate API
    const output = await generateImagesWithReplicate(
      generatedPrompt,
      hf_loras,
      categories,
      imageRatio,
      imageFormat,
      imageCount
    );

    console.log("Generated Images:", output);

    // Insert each generated image into the 'predictions' table
    const insertPromises = output.map(async (imageUrl) => {
      const { error: insertError } = await supabase.from("predictions").insert({
        id: uuidv4(), // Generate a new UUID
        user_id: userId,
        product_id: productId, // Using varchar as intended
        prediction_image: imageUrl,
        categories,
        product_main_image,
      });

      if (insertError) {
        console.error("Insert error:", insertError);
        throw insertError;
      }
    });

    // Wait for all insert operations to complete
    await Promise.all(insertPromises);

    // Update the imageCount in the 'userproduct' table
    const { error: updateError } = await supabase
      .from("userproduct")
      .update({ imageCount: newImageCount })
      .eq("product_id", productId); // product_id is varchar

    if (updateError) {
      console.error("Error updating image count:", updateError);
      // Update request status to 'failed'
      await updateRequestStatus(request_id, "failed");
      return res.status(500).json({
        success: false,
        message: "Failed to update image count",
        error: updateError.message,
      });
    }

    // Update request status to 'succeeded'
    await updateRequestStatus(request_id, "succeeded");

    // Successful response
    res.status(200).json({
      success: true,
      message: "Predictions generated and imageCount updated successfully",
      data: output,
    });

    console.log("Response Data:", output);
  } catch (error) {
    console.error("Prediction error:", error);
    try {
      // Attempt to update request status to 'failed' if possible
      if (typeof request_id !== "undefined") {
        await updateRequestStatus(request_id, "failed");
      }
    } catch (updateStatusError) {
      console.error(
        "Failed to update request status to 'failed':",
        updateStatusError
      );
      // Optionally, you might want to handle this scenario further
    }
    res.status(500).json({
      success: false,
      message: "Prediction generation failed",
      error: error.message,
    });
  }
});

module.exports = router;
