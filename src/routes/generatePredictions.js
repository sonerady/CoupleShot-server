/**
 * routes/generatePredictions.js
 * Sadece örnek bir düzenleme, ana mantık gösterilir.
 */

const express = require("express");
const Replicate = require("replicate");
const supabase = require("../supabaseClient");
const { v4: uuidv4 } = require("uuid");

// GOOGLE GEMINI
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleAIFileManager } = require("@google/generative-ai/server");

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);
const fileManager = new GoogleAIFileManager(apiKey);

const router = express.Router();

// Replicate
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});
const predictions = replicate.predictions;

/**
 * 1) Gemini'den ~400 kelimelik, tek satırlık prompt üretme fonksiyonu.
 */
async function generatePrompt(
  initialPrompt, // FE'den gelen "ana" prompt
  customPrompt, // Ek custom metin
  extraPromptDetail // Daha uzun text
) {
  const MAX_RETRIES = 20;
  let attempt = 0;
  let generatedPrompt = "";

  while (attempt < MAX_RETRIES) {
    try {
      // 1) frontend'den gelen prompt parçalarını birleştiriyoruz
      let environmentContext = "";
      if (customPrompt && initialPrompt) {
        environmentContext = `${initialPrompt}, ${customPrompt}`;
      } else if (customPrompt) {
        environmentContext = customPrompt;
      } else if (initialPrompt) {
        environmentContext = initialPrompt;
      }

      if (extraPromptDetail) {
        environmentContext += `, ${extraPromptDetail}`;
      }

      // 2) Gemini'den "tek satırlık ve yaklaşık 400 kelimelik" prompt istiyoruz
      // environmentContext: React’ten gelen finalPromptString
      // Bu string, "Model's hairstyle: X" veya "Model's hair color: Y" içeriyor olabilir.
      let contentMessage = `
Please generate a single-line text-to-image prompt of around 400 words 
specifically describing a couple's photograph, emphasizing it is a man and 
a woman together. The prompt should revolve around the following topic: 
"${environmentContext}". 

The prompt should not contain any line breaks, no headings, and minimal spacing. 
It must remain cohesive, relevant, and entirely suitable for an AI text-to-image model.

If the environmentContext includes "Model's hairstyle" or "Model's hair color," 
treat those as the authoritative style and color for both individuals in the couple. 
If neither "Model's hairstyle" nor "Model's hair color" is present, you may infer 
these details from any other context (such as the subCategoryData's prompt) 
or leave them as your own creative choice, but maintain consistency for a man 
and a woman couple.
`;

      // Google Gemini ayarları
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

      const history = [
        {
          role: "user",
          parts: [{ text: contentMessage }],
        },
      ];

      // 3) Boş mesajla sohbeti devam ettirip yanıtı alıyoruz
      const chatSession = model.startChat({
        generationConfig,
        history,
      });
      const result = await chatSession.sendMessage("");
      generatedPrompt = result.response.text();

      console.log("Gemini Raw Prompt:", generatedPrompt);

      // 4) "tek satır" haline getirmek için satır sonlarını/çoklu boşlukları temizliyoruz
      generatedPrompt = generatedPrompt.replace(/\r?\n|\r/g, " "); // newline'ları tek boşluğa çevir
      generatedPrompt = generatedPrompt.replace(/\s+/g, " "); // çoklu boşlukları teke indir

      // 5) İstenmeyen yanıt kontrolü
      const finalWordCount = generatedPrompt.trim().split(/\s+/).length;
      if (
        generatedPrompt.includes("I’m sorry") ||
        generatedPrompt.includes("I'm sorry") ||
        generatedPrompt.includes("I'm unable") ||
        generatedPrompt.includes("I can't") ||
        (generatedPrompt.includes("I cannot") && finalWordCount < 100)
      ) {
        console.warn(`Attempt ${attempt + 1}: Gemini ret, retrying...`);
        attempt++;
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }

      // Başarılıysa döngüden çık
      break;
    } catch (error) {
      console.error("Error generating prompt:", error);
      attempt++;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  if (
    generatedPrompt.includes("I’m sorry") ||
    generatedPrompt.includes("I'm sorry") ||
    generatedPrompt.includes("I'm unable")
  ) {
    throw new Error(
      "Gemini API could not generate a valid prompt after attempts."
    );
  }

  return generatedPrompt;
}

/**
 * 2) Replicate ile görüntü üretme fonksiyonu.
 */
async function generateImagesWithReplicate(
  prompt,
  hf_loras,
  imageRatio,
  imageFormat,
  imageCount
) {
  try {
    // İsteğe bağlı: prompt başına "TOK" ekleniyor
    const modifiedPrompt = `A photo of TOK ${prompt}`;

    console.log("moddd", modifiedPrompt);

    // Varsayılan LoRA
    let hf_loras_default = ["VideoAditor/Flux-Lora-Realism"];

    const filteredHfLoras = Array.isArray(hf_loras)
      ? hf_loras.filter(
          (item) => typeof item === "string" && item.trim() !== ""
        )
      : [];

    const combinedHfLoras =
      filteredHfLoras.length > 0
        ? [...hf_loras_default, ...filteredHfLoras]
        : hf_loras_default;

    const prediction = await predictions.create({
      version:
        "2389224e115448d9a77c07d7d45672b3f0aa45acacf1c5bcf51857ac295e3aec",
      input: {
        prompt: modifiedPrompt,
        hf_loras: combinedHfLoras,
        lora_scales: [0.9],
        num_outputs: imageCount,
        aspect_ratio: imageRatio,
        output_format: imageFormat,
        guidance_scale: 5,
        output_quality: 100,
        prompt_strength: 1,
        num_inference_steps: 50,
        disable_safety_checker: true,
      },
    });

    return prediction.id;
  } catch (error) {
    console.error("Error generating images with Replicate:", error);
    throw error;
  }
}

/**
 * 3) Asıl route
 *    Burada "kredi düşme" ve "imageCount" mantığını ekledik.
 */
router.post("/generatePredictions", async (req, res) => {
  const {
    prompt, // finalPromptString (FE)
    hf_loras,
    userId,
    productId,
    customPrompt,
    extraPromptDetail,
    imageRatio,
    imageFormat,
    imageCount,
  } = req.body;

  // Basit kontrol
  if (!userId || !productId || !imageCount) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields.",
    });
  }

  try {
    console.log("Starting prompt generation for productId:", productId);

    // 1) Gemini'ye gidecek metni oluştur
    const generatedPrompt = await generatePrompt(
      prompt,
      customPrompt,
      extraPromptDetail
    );
    console.log("Final Single-Line Prompt (~400 words):", generatedPrompt);

    // --------------------------------------------------------------------------------
    // KREDİ MANTIK BAŞLANGICI
    // 2) imageCount (ürün bazında) için Supabase'ten mevcut değerini çekiyoruz
    const { data: productData, error: productError } = await supabase
      .from("userproduct")
      .select("imageCount")
      .eq("product_id", productId)
      .maybeSingle();

    if (productError) {
      console.error("Error fetching product data:", productError);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch product data",
        error: productError.message,
      });
    }

    // 3) Yeni imageCount değerini hesapla
    const newImageCount = (productData?.imageCount || 0) + imageCount;

    // 4) Eğer yeni imageCount 30 veya daha büyükse kredilerden düşülmesi gerekiyor
    if (newImageCount >= 30) {
      // Her resim başına 5 kredi düşülsün
      const creditsToDeduct = imageCount * 5;

      // Kullanıcının mevcut kredilerini çek
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("credit_balance")
        .eq("id", userId)
        .single();

      if (userError) {
        console.error("Error fetching user data:", userError);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch user data",
          error: userError.message,
        });
      }

      // Yeterli kredi var mı?
      if (userData.credit_balance < creditsToDeduct) {
        return res.status(400).json({
          success: false,
          message: "Insufficient credit balance",
        });
      }

      // Yeterli kredisi varsa: krediyi düş
      const { error: creditUpdateError } = await supabase
        .from("users")
        .update({ credit_balance: userData.credit_balance - creditsToDeduct })
        .eq("id", userId);

      if (creditUpdateError) {
        console.error("Error updating credit balance:", creditUpdateError);
        return res.status(500).json({
          success: false,
          message: "Failed to deduct credits",
          error: creditUpdateError.message,
        });
      }

      console.log(`Deducted ${creditsToDeduct} credits from userId: ${userId}`);
    }

    // 5) Yeni imageCount değerini 'userproduct' tablosuna güncelle
    const { error: updateError } = await supabase
      .from("userproduct")
      .update({ imageCount: newImageCount })
      .eq("product_id", productId);

    if (updateError) {
      console.error("Error updating image count:", updateError);
      return res.status(500).json({
        success: false,
        message: "Failed to update image count",
        error: updateError.message,
      });
    }

    // KREDİ MANTIK BİTİŞİ
    // --------------------------------------------------------------------------------

    // 6) Replicate ile görsel üret
    const predictionId = await generateImagesWithReplicate(
      generatedPrompt,
      hf_loras,
      imageRatio,
      imageFormat,
      imageCount
    );

    console.log("Prediction ID:", predictionId);

    // 7) 'predictions' tablosuna kayıt
    const { error: initialInsertError } = await supabase
      .from("predictions")
      .insert({
        id: uuidv4(),
        user_id: userId,
        product_id: productId,
        prediction_id: predictionId,
        categories: "on_model", // Örnek sabit
      });

    if (initialInsertError) {
      console.error("Initial Insert error:", initialInsertError);
      throw initialInsertError;
    }

    console.log("Initial prediction record inserted into Supabase.");

    // 202 => "Accepted: işlem devam ediyor"
    res.status(202).json({
      success: true,
      message:
        "Prediction started with Gemini single-line prompt. Processing in background.",
      predictionId,
    });
  } catch (error) {
    console.error("Prediction error:", error);
    res.status(500).json({
      success: false,
      message: "Prediction generation failed",
      error: error.message,
    });
  }
});

module.exports = router;
