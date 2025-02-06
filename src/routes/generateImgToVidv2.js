// routes/generateImgToVid.js
const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

// Supabase client
const supabase = require("../supabaseClient");

// Replicate
const Replicate = require("replicate");
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});
const predictions = replicate.predictions;

// Gemini ile ilgili importlar
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleAIFileManager } = require("@google/generative-ai/server");
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);
const fileManager = new GoogleAIFileManager(apiKey);

/**
 * generateVideoPrompt
 *  - imageUrl: Supabase'ten aldığımız public URL
 *  - userPrompt: Kullanıcının girdiği prompt (farklı dilde olabilir)
 *
 * Bu fonksiyon, Gemini'ye resmi ve kullanıcı prompt'unu göndererek
 * bize kısa, İngilizce bir "video prompt" geri döndürür.
 */
async function generateVideoPrompt(imageUrl, userPrompt) {
  // 0) Temp klasörü hazırla
  const tempDir = path.join(__dirname, "temp");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
  }

  // 1) Resmi indir
  const tempImagePath = path.join(tempDir, `${uuidv4()}.jpg`);
  await downloadImage(imageUrl, tempImagePath);

  // 2) Gemini'ye upload
  const uploadedFile = await uploadToGemini(tempImagePath, "image/jpeg");
  fs.unlinkSync(tempImagePath); // Temp dosyasını sildik

  // 3) Prompt içeriği
  const contentMessage = `Given the user prompt: "${userPrompt}", which may be in any language, create a short, single-line English prompt describing a romantic couple video scenario. The video should capture an intimate, loving, and aesthetically pleasing couple shot. No headings, no paragraphs, no line breaks, just one continuous line in English.`;

  // 4) Gemini config
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

  // 5) Chat Session
  const chatSession = model.startChat({
    generationConfig,
    history,
  });
  const result = await chatSession.sendMessage("");
  const generatedPrompt = result.response.text();
  console.log("Generated Video Prompt:", generatedPrompt);

  return generatedPrompt;
}

// Yardımcı fonksiyonlar
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

async function uploadToGemini(filePath, mimeType) {
  const uploadResult = await fileManager.uploadFile(filePath, {
    mimeType,
    displayName: path.basename(filePath),
  });
  const file = uploadResult.file;
  console.log(`Uploaded file ${file.displayName} as: ${file.name}`);
  return file;
}

/**
 * Bu fonksiyon: Tek bir base64 string'i (veya istersen bir array'i) Supabase'e yükler ve
 * elde ettiği public URL'leri bir dizi olarak döndürür.
 */
async function uploadToSupabaseAsArray(base64String, prefix = "product_main_") {
  const urlsArray = [];

  // Tek bir string'i de dizi yapıyoruz. (Eğer birden fazla imaj yollayacaksan, parametreyi array'e çevirebilirsin.)
  const base64Items = Array.isArray(base64String)
    ? base64String
    : [base64String];

  for (const item of base64Items) {
    // Eğer base64 formatı değilse, muhtemelen URL'dir, direkt ekle
    if (!item.startsWith("data:image/")) {
      urlsArray.push(item);
      continue;
    }

    const base64Data = item.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    const fileName = `${prefix}${uuidv4()}.png`;

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("images")
      .upload(`generated/${fileName}`, buffer, {
        contentType: "image/png",
      });

    if (uploadError) {
      console.error("Supabase upload error:", uploadError);
      throw new Error(
        `Failed to upload image to Supabase: ${uploadError.message}`
      );
    }

    const { data: publicUrlData, error: publicUrlError } =
      await supabase.storage
        .from("images")
        .getPublicUrl(`generated/${fileName}`);
    if (publicUrlError) {
      console.error("Supabase publicUrl error:", publicUrlError);
      throw new Error(
        `Failed to get public URL of image: ${publicUrlError.message}`
      );
    }

    urlsArray.push(publicUrlData.publicUrl);
  }

  return urlsArray;
}

/**
 * 1) POST /api/generateImgToVid
 *
 * Bu endpoint:
 * - Kullanıcıdan gelen ürün resmi (product_main_image) ve first_frame_image base64'lerini
 *   Supabase'e yükler, oradan URL'ler alır. (Birden fazla resim geliyorsa array'e çevirir.)
 * - Gemini ile prompt oluşturur.
 * - Replicate Minimax'e istek atar, asenkron bir prediction döner.
 * - Supabase'e prediction kaydı ekler (prediction_id, user_id, vb.).
 * - 202 Accepted döner, statüyü /api/predictionStatus/:id ile sorgulayabilirsin.
 */
router.post("/generateImgToVid", async (req, res) => {
  try {
    const {
      userId,
      productId,
      product_main_image,
      imageCount,
      prompt,
      categories,
      first_frame_image,
      aspect_ratio,
    } = req.body;

    // Zorunlu alanlar
    if (
      !userId ||
      !productId ||
      !product_main_image ||
      !imageCount ||
      !prompt ||
      !first_frame_image ||
      !aspect_ratio
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields. Make sure userId, productId, product_main_image, imageCount, prompt, aspect_ratio and first_frame_image are provided.",
      });
    }

    // Check user's credit balance
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

    // Check if user has enough credits
    if (userData.credit_balance < 100) {
      return res.status(400).json({
        success: false,
        message: "Insufficient credit balance. Required: 100 credits",
      });
    }

    // Deduct credits
    const { error: creditUpdateError } = await supabase
      .from("users")
      .update({ credit_balance: userData.credit_balance - 100 })
      .eq("id", userId);

    if (creditUpdateError) {
      console.error("Error updating credit balance:", creditUpdateError);
      return res.status(500).json({
        success: false,
        message: "Failed to deduct credits",
        error: creditUpdateError.message,
      });
    }

    // 1) firstFrameUrl (Base64 -> Supabase) (tek resim)
    let firstFrameUrl = first_frame_image;
    if (firstFrameUrl.startsWith("data:image/")) {
      const uploadedFirstFrame = await uploadToSupabaseAsArray(
        first_frame_image,
        "first_frame_"
      );
      // Bu bize bir array döner. firstFrameUrl ise o array'in ilk elemanı olsun
      firstFrameUrl = uploadedFirstFrame[0];
    }

    // 2) productMainUrl (Base64 -> Supabase) => JSON array
    let productMainUrlArray = [];
    if (Array.isArray(product_main_image)) {
      // eğer array geldiyse
      for (const singleBase64 of product_main_image) {
        const uploaded = await uploadToSupabaseAsArray(
          singleBase64,
          "product_main_"
        );
        // uploaded array dönüyor, hepsini push
        productMainUrlArray.push(...uploaded);
      }
    } else {
      // tek string
      const uploaded = await uploadToSupabaseAsArray(
        product_main_image,
        "product_main_"
      );
      productMainUrlArray.push(...uploaded);
    }

    // productMainUrlJSON => ["url1","url2",...]
    const productMainUrlJSON = JSON.stringify(productMainUrlArray);

    // 3) Gemini ile prompt oluştur
    const finalPrompt = await generateVideoPrompt(firstFrameUrl, prompt);

    // 4) Replicate'e asenkron istek (Minimax)
    const prediction = await predictions.create({
      model: "kwaivgi/kling-v1.6-pro",
      input: {
        prompt: finalPrompt,
        duration: 10,
        cfg_scale: 0.5,
        start_image: firstFrameUrl,
        aspect_ratio: aspect_ratio,
        negative_prompt: "",
      },
    });

    // 5) DB'ye kaydet => product_main_image: productMainUrlJSON
    const { data: insertData, error: initialInsertError } = await supabase
      .from("predictions")
      .insert({
        id: uuidv4(),
        user_id: userId,
        product_id: productId,
        prediction_id: prediction.id, // replicate'ten gelen id
        categories: categories,
        product_main_image: productMainUrlJSON,
      });

    if (initialInsertError) {
      console.error("Initial Insert error:", initialInsertError);
      throw initialInsertError;
    }

    return res.status(202).json({
      success: true,
      message: "Prediction started. Poll with /api/predictionStatus/:id",
      predictionId: prediction.id,
      replicatePrediction: prediction,
    });
  } catch (error) {
    console.error("Video generation error:", error);
    return res.status(500).json({
      success: false,
      message: "Video generation failed",
      error: error.message,
    });
  }
});

/**
 * 2) GET /api/predictionStatus/:predictionId
 *
 * Bu endpoint:
 * - DB'den kaydı bulur.
 * - replicate.predictions.get(...) ile durumu (status, output vb.) çeker.
 * - DB'yi günceller (ancak 'status' kolonunu artık güncellemiyoruz).
 * - Sonucu front-end'e döner.
 */
router.get("/predictionStatus/:predictionId", async (req, res) => {
  try {
    const { predictionId } = req.params;
    if (!predictionId) {
      return res
        .status(400)
        .json({ success: false, message: "No ID provided" });
    }

    // DB'den kaydı al
    const { data: rows, error } = await supabase
      .from("predictions")
      .select("*")
      .eq("prediction_id", predictionId)
      .limit(1);

    if (error) {
      console.error("DB select error:", error);
      return res.status(500).json({
        success: false,
        message: "Database error",
        error: error.message,
      });
    }

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Prediction record not found",
      });
    }

    const predictionRow = rows[0];

    // replicate üzerinden güncel durumu sorgula
    const replicatePrediction = await predictions.get(predictionId);

    // Artık status'u güncellemiyoruz, sadece outputu güncelliyoruz:
    const updateData = {};

    if (replicatePrediction.status === "succeeded") {
      // Bazen replicatePrediction.output bir dizi link olabilir:
      // Tek string ise => "https://..."
      // Array ise => ["https://...", "https://..."]
      updateData.product_main_image = replicatePrediction.output
        ? JSON.stringify(replicatePrediction.output)
        : null;
    } else if (replicatePrediction.status === "failed") {
      // Başarısızsa null çekiyoruz
      updateData.product_main_image = null;
    }

    // DB'de product_main_image kolonunu güncelle
    // (status kolonu olmadığı için artık ekleme yapmıyoruz)
    const { error: updateError } = await supabase
      .from("predictions")
      .update(updateData)
      .eq("prediction_id", predictionId);

    if (updateError) {
      console.error("Update error:", updateError);
      // hata olsa bile, yine de replicatePrediction ile cevabı dönüyoruz
    }

    return res.status(200).json({
      success: true,
      // status bilgisini tabloya kaydetmiyoruz ama yine de FE'ye gönderebiliriz
      status: replicatePrediction.status,
      output: replicatePrediction.output || null,
    });
  } catch (error) {
    console.error("Prediction status error:", error);
    return res.status(500).json({
      success: false,
      message: "Error retrieving prediction status",
      error: error.message,
    });
  }
});

module.exports = router;
