const express = require("express");
const supabase = require("../supabaseClient");
const Replicate = require("replicate");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const archiver = require("archiver");
const fs = require("fs");
const os = require("os");
const axios = require("axios");
const sharp = require("sharp");
const path = require("path");

// Multer: dosya upload için
const upload = multer();
const router = express.Router();

// Replicate API client
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const predictions = replicate.predictions;

// Sunucu başlarken pending istekleri failed yapma
(async () => {
  try {
    const { data: pendingRequests, error: pendingError } = await supabase
      .from("generate_requests")
      .select("uuid, user_id, credits_deducted")
      .eq("status", "pending");

    if (pendingError) {
      console.error("Pending istekler okunurken hata oluştu:", pendingError);
    } else if (pendingRequests && pendingRequests.length > 0) {
      for (const req of pendingRequests) {
        const { error: failError } = await supabase
          .from("generate_requests")
          .update({ status: "failed" })
          .eq("uuid", req.uuid);

        if (failError) {
          console.error(
            `İstek failed yapılırken hata oluştu (uuid: ${req.uuid}):`,
            failError
          );
        } else {
          console.log(`İstek failed yapıldı (uuid: ${req.uuid})`);

          // Kredi iadesi
          if (req.credits_deducted) {
            const { data: userData, error: userError } = await supabase
              .from("users")
              .select("credit_balance")
              .eq("id", req.user_id)
              .single();

            if (userError) {
              console.error("Kullanıcı kredisi okunamadı:", userError);
            } else {
              const refundedBalance = userData.credit_balance + 100;
              const { error: refundError } = await supabase
                .from("users")
                .update({ credit_balance: refundedBalance })
                .eq("id", req.user_id);
              if (refundError) {
                console.error("Kredi iadesi başarısız:", refundError);
              } else {
                console.log(
                  "Kredi başarıyla iade edildi (pending istek için):",
                  req.user_id
                );
              }
            }
          }
        }
      }
    } else {
      console.log("Pending istek yok. Sunucu temiz başlatıldı.");
    }
  } catch (err) {
    console.error("Sunucu başlatılırken hata:", err);
  }
})();

/**
 * Bir Prediction tamamlanana kadar bekleme fonksiyonu
 */
async function waitForPredictionToComplete(
  predictionId,
  replicate,
  timeout = 60000,
  interval = 2000
) {
  const startTime = Date.now();
  console.log(`Prediction ${predictionId} bekleniyor...`);
  while (true) {
    const currentPrediction = await replicate.predictions.get(predictionId);
    console.log(
      `Prediction ${predictionId} durumu: ${currentPrediction.status}`
    );
    if (currentPrediction.status === "succeeded") {
      console.log(`Prediction ${predictionId} tamamlandı.`);
      return currentPrediction;
    } else if (
      currentPrediction.status === "failed" ||
      currentPrediction.status === "canceled"
    ) {
      throw new Error(`Prediction ${predictionId} failed or was canceled.`);
    }

    if (Date.now() - startTime > timeout) {
      throw new Error(`Prediction ${predictionId} timed out.`);
    }

    await new Promise((res) => setTimeout(res, interval));
  }
}

/**
 * Kadın (woman_X) ve Erkek (man_X) resimlerini Sharp ile yan yana birleştirme fonksiyonu.
 * Bu örnekte => 512x512 + 512x512 = 1024x512
 */
async function sharpCombine(womanBuffer, manBuffer) {
  // 1) Kadın ve erkek görsellerini 512x512 boyutuna resize et
  const resizedWoman = await sharp(womanBuffer)
    .resize({ width: 512, height: 512, fit: "cover" })
    .toBuffer();

  const resizedMan = await sharp(manBuffer)
    .resize({ width: 512, height: 512, fit: "cover" })
    .toBuffer();

  // 2) 1024x512 boyutunda bir canvas oluşturarak ikisini yan yana yerleştir
  const combined = await sharp({
    create: {
      width: 1024,
      height: 512,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([
      { input: resizedWoman, top: 0, left: 0 },
      { input: resizedMan, top: 0, left: 512 },
    ])
    .png()
    .toBuffer();

  return combined;
}

router.post("/generateTrain", upload.array("files", 50), async (req, res) => {
  const files = req.files;
  const { user_id, request_id, image_url } = req.body;

  console.log(
    `Yeni istek alındı: request_id=${request_id}, user_id=${user_id}`
  );
  // Kullanıcıya hızlıca 200 dönüyoruz, async işlem arkada yapılacak.
  res.status(200).json({ message: "İşlem başlatıldı, lütfen bekleyin..." });

  (async () => {
    let creditsDeducted = false;
    let userData;

    try {
      if (!request_id) {
        console.error("Request ID eksik, işlem sonlandırılıyor...");
        return;
      }

      if (!files || files.length === 0) {
        console.error("Dosya bulunamadı, failed durumuna geçiliyor...");
        await supabase
          .from("generate_requests")
          .update({ status: "failed" })
          .eq("uuid", request_id);
        return;
      }

      // generate_requests tablosunda bu request_id kaydı var mı?
      console.log("generate_requests kontrol ediliyor...");
      const { data: existingRequest, error: requestError } = await supabase
        .from("generate_requests")
        .select("*")
        .eq("uuid", request_id)
        .single();

      if (requestError && requestError.code !== "PGRST116") {
        console.error("generate_requests sorgusunda hata:", requestError);
        throw requestError;
      }

      if (!existingRequest) {
        console.log("Yeni generate_request kaydı oluşturuluyor...");
        const { error: insertError } = await supabase
          .from("generate_requests")
          .insert([
            {
              uuid: request_id,
              request_id: request_id,
              user_id: user_id,
              status: "pending",
              image_url: image_url,
            },
          ]);
        if (insertError) throw insertError;
      } else {
        console.log("Mevcut generate_request kaydı güncelleniyor...");
        const { error: updateError } = await supabase
          .from("generate_requests")
          .update({ status: "pending", image_url: image_url })
          .eq("uuid", request_id);

        if (updateError) throw updateError;
      }

      // Kullanıcı kredi bakiyesi
      console.log("Kullanıcı kredi bakiyesi kontrol ediliyor...");
      const { data: ud, error: userError } = await supabase
        .from("users")
        .select("credit_balance")
        .eq("id", user_id)
        .single();

      if (userError) throw userError;
      userData = ud;

      if (userData.credit_balance < 100) {
        console.error("Kredi yetersiz. failed durumuna geçiliyor...");
        await supabase
          .from("generate_requests")
          .update({ status: "failed" })
          .eq("uuid", request_id);
        return;
      }

      console.log("100 kredi düşülüyor...");
      const newCreditBalance = userData.credit_balance - 100;
      const { error: updateCreditError } = await supabase
        .from("users")
        .update({ credit_balance: newCreditBalance })
        .eq("id", user_id);
      if (updateCreditError) throw updateCreditError;

      // generate_requests tablosuna credits_deducted = true
      const { error: creditsDeductedError } = await supabase
        .from("generate_requests")
        .update({ credits_deducted: true })
        .eq("uuid", request_id);
      if (creditsDeductedError) throw creditsDeductedError;

      creditsDeducted = true;

      // Tüm dosyaları alalım (woman_1, man_2 vb.)
      // (Önce rotate fix ve boyut shrink yaparak Supabase'e yüklüyoruz.)
      const signedUrls = [];

      console.log("Resimler işleniyor ve Supabase'e yükleniyor...");
      for (const file of files) {
        // Sharp ile rotate (EXIF fix)
        const rotatedBuffer = await sharp(file.buffer).rotate().toBuffer();
        const metadata = await sharp(rotatedBuffer).metadata();

        let finalBuffer = rotatedBuffer;
        // Genişlik 2048'den büyükse yarıya çek
        if (metadata.width > 2048) {
          const halfW = Math.round(metadata.width / 2);
          const halfH = Math.round(metadata.height / 2);
          finalBuffer = await sharp(rotatedBuffer)
            .resize(halfW, halfH)
            .toBuffer();
        }

        // Benzersiz dosya adı
        const uniqueName = `${Date.now()}_${uuidv4()}_${file.originalname}`;

        // Supabase'e upload
        const { data, error } = await supabase.storage
          .from("images")
          .upload(uniqueName, finalBuffer, {
            contentType: file.mimetype,
          });
        if (error) throw error;

        const { data: publicUrlData, error: publicUrlError } =
          await supabase.storage.from("images").getPublicUrl(uniqueName);
        if (publicUrlError) throw publicUrlError;

        signedUrls.push({
          originalName: file.originalname,
          url: publicUrlData.publicUrl, // Orijinal, arka plan silinmemiş
        });
      }

      // Arka plan kaldırma (RemoveBG) => replicate
      console.log("Arka plan kaldırma işlemi başlıyor...");
      const removeBgResults = [];
      let processingFailed = false;

      for (const obj of signedUrls) {
        try {
          // replicate removeBg
          const prediction = await predictions.create({
            version:
              "4067ee2a58f6c161d434a9c077cfa012820b8e076efa2772aa171e26557da919",
            input: { image: obj.url },
          });

          const completedPrediction = await waitForPredictionToComplete(
            prediction.id,
            replicate,
            120000,
            3000
          );

          if (completedPrediction.output) {
            removeBgResults.push({
              originalName: obj.originalName,
              outputUrl: completedPrediction.output, // Arka planı kaldırılmış URL
            });
          } else {
            console.error("Çıktı alınamadı:", obj.originalName);
            removeBgResults.push({
              error: "no output",
              originalName: obj.originalName,
            });
            processingFailed = true;
          }
        } catch (error) {
          console.error("Arka plan kaldırma hatası:", error);
          removeBgResults.push({
            error: error.message,
            originalName: obj.originalName,
          });
          processingFailed = true;
        }
      }

      if (processingFailed || removeBgResults.length === 0) {
        console.error("İşlemde hata oldu, generate_requests failed...");
        await supabase
          .from("generate_requests")
          .update({ status: "failed" })
          .eq("uuid", request_id);

        // Krediyi iade et
        if (creditsDeducted) {
          console.log("Kredi iade ediliyor...");
          await supabase
            .from("users")
            .update({ credit_balance: userData.credit_balance })
            .eq("id", user_id);
        }
        return;
      }

      // --- NEW: Cover image için orijinal görselleri combine edelim ---
      console.log(
        "Cover image için arka planı silinmemiş görseller combine ediliyor..."
      );
      let coverImageUrl = image_url; // Default
      try {
        // "woman_X" olanları çek
        const womanItemsOriginal = signedUrls.filter((r) =>
          r.originalName.toLowerCase().startsWith("woman_")
        );

        // Tek bir cover örneği alalım (mesela ilk bulduğumuz "woman_X" & "man_X")
        for (const wItem of womanItemsOriginal) {
          const suffix = wItem.originalName.split("_")[1]; // woman_2.jpg => "2.jpg"
          const womanIndex = suffix.split(".")[0]; // => "2"

          // man_2 => man_{womanIndex}
          const manItem = signedUrls.find((r) =>
            r.originalName.toLowerCase().startsWith(`man_${womanIndex}.`)
          );

          if (!manItem) {
            console.log(
              `man_${womanIndex} bulunamadı, cover combine atlanıyor.`
            );
            continue;
          }

          // Orijinal resimleri indir
          const womanResponse = await axios.get(wItem.url, {
            responseType: "arraybuffer",
          });
          const manResponse = await axios.get(manItem.url, {
            responseType: "arraybuffer",
          });

          // Yan yana combine
          const coverBuf = await sharpCombine(
            womanResponse.data,
            manResponse.data
          );

          // Supabase'e yükle
          const coverFileName = `cover_${uuidv4()}.png`;
          const { error: coverUploadError } = await supabase.storage
            .from("images")
            .upload(coverFileName, coverBuf, {
              contentType: "image/png",
            });
          if (coverUploadError) {
            console.error("Cover image upload hatası:", coverUploadError);
            break;
          }

          const { data: coverPublicUrlData, error: coverPublicUrlError } =
            await supabase.storage.from("images").getPublicUrl(coverFileName);
          if (coverPublicUrlError) {
            console.error(
              "Cover image public URL hatası:",
              coverPublicUrlError
            );
            break;
          }

          coverImageUrl = coverPublicUrlData.publicUrl;
          console.log("Cover image oluşturuldu:", coverImageUrl);
          // Tek bir tanesi bize yeter, döngüden çık
          break;
        }
      } catch (coverErr) {
        console.error("Cover image oluşturulurken hata oluştu:", coverErr);
      }
      // --- NEW END ---

      // Sharp ile "woman_X" ve "man_X" resimlerini (arka planı kaldırılmış) combine edelim
      console.log(
        "Kadın ve erkek resimleri (arka planı kaldırılmış) eşleştirilip combine ediliyor..."
      );
      const combinedBuffers = [];

      const womanItems = removeBgResults.filter((r) =>
        r.originalName.toLowerCase().startsWith("woman_")
      );

      for (const wItem of womanItems) {
        const suffix = wItem.originalName.split("_")[1];
        const womanIndex = suffix.split(".")[0];

        // man_2 => man_{womanIndex}
        const manItem = removeBgResults.find((r) =>
          r.originalName.toLowerCase().startsWith(`man_${womanIndex}.`)
        );

        if (!manItem) {
          console.log(`man_${womanIndex} bulunamadı, combine atlanıyor.`);
          continue;
        }

        try {
          const womanResponse = await axios.get(wItem.outputUrl, {
            responseType: "arraybuffer",
          });
          const manResponse = await axios.get(manItem.outputUrl, {
            responseType: "arraybuffer",
          });

          const resultBuf = await sharpCombine(
            womanResponse.data,
            manResponse.data
          );

          combinedBuffers.push({
            index: womanIndex,
            buffer: resultBuf,
            womanName: wItem.originalName,
            manName: manItem.originalName,
          });
        } catch (err) {
          console.error(
            `Combine hatası (woman_${womanIndex} + man_${womanIndex}):`,
            err
          );
        }
      }

      // Şimdi .zip oluşturacağız
      console.log("Zip dosyası oluşturuluyor...");
      const processedImages = [];
      const zipFileName = `images_${Date.now()}_${uuidv4()}.zip`;
      const zipFilePath = `${os.tmpdir()}/${zipFileName}`;
      const outputStream = fs.createWriteStream(zipFilePath);
      const archive = archiver("zip", { zlib: { level: 9 } });

      archive.on("error", async (err) => {
        console.error("Zip oluşturma hatası:", err);
        await supabase
          .from("generate_requests")
          .update({ status: "failed" })
          .eq("uuid", request_id);

        if (creditsDeducted) {
          console.log("Krediler iade ediliyor...");
          const { error: refundError } = await supabase
            .from("users")
            .update({ credit_balance: userData.credit_balance })
            .eq("id", user_id);
          if (refundError) {
            console.error("Credits refund failed:", refundError);
          }
        }
      });
      archive.pipe(outputStream);

      console.log("Combine edilmiş görseller ZIP'e ekleniyor...");
      let imageIndex = 0;
      for (const item of combinedBuffers) {
        const imgFileName = `combined_${item.index}_${uuidv4()}.png`;
        archive.append(item.buffer, { name: imgFileName });

        // Supabase'e de yükleyelim
        try {
          const { error: uploadError } = await supabase.storage
            .from("images")
            .upload(imgFileName, item.buffer, {
              contentType: "image/png",
            });
          if (!uploadError) {
            const { data: publicUrlData, error: publicUrlError } =
              await supabase.storage.from("images").getPublicUrl(imgFileName);

            if (!publicUrlError) {
              processedImages.push({
                url: publicUrlData.publicUrl,
                fileName: imgFileName,
              });
            }
          }
        } catch (ex) {
          console.error("Supabase'e combined resim yüklerken hata:", ex);
        }

        imageIndex++;
      }

      // ZIP'i finalize et
      console.log("Zip finalize ediliyor...");
      archive.finalize();

      outputStream.on("close", async () => {
        console.log(`${archive.pointer()} byte'lık zip dosyası oluşturuldu.`);

        try {
          const zipBuffer = fs.readFileSync(zipFilePath);

          const { error: zipError } = await supabase.storage
            .from("zips")
            .upload(zipFileName, zipBuffer, {
              contentType: "application/zip",
            });
          if (zipError) throw zipError;

          const { data: zipUrlData, error: zipUrlError } =
            await supabase.storage.from("zips").getPublicUrl(zipFileName);
          if (zipUrlError) throw zipUrlError;

          // DB => succeeded
          console.log("generate_requests durumu succeeded yapılıyor...");
          const { error: statusUpdateError } = await supabase
            .from("generate_requests")
            .update({ status: "succeeded" })
            .eq("uuid", request_id);
          if (statusUpdateError) throw statusUpdateError;

          // Replicate model oluşturma
          console.log("Replicate model oluşturma (örnek) başlıyor...");
          try {
            const repoName = uuidv4()
              .toLowerCase()
              .replace(/\s+/g, "-")
              .replace(/[^a-z0-9-_.]/g, "")
              .replace(/^-+|-+$/g, "");

            // Model create
            const model = await replicate.models.create(
              "nodselemen",
              repoName,
              {
                visibility: "private",
                hardware: "gpu-a100-large",
              }
            );

            console.log("Model eğitimi başlatılıyor...");
            const training = await replicate.trainings.create(
              "ostris",
              "flux-dev-lora-trainer",
              "e440909d3512c31646ee2e0c7d6f6f4923224863a6a10c494606e79fb5844497",
              {
                destination: `nodselemen/${repoName}`,
                input: {
                  steps: 1000,
                  lora_rank: 20,
                  optimizer: "adamw8bit",
                  batch_size: 1,
                  resolution: "512,768,1024",
                  autocaption: true,
                  input_images: zipUrlData.publicUrl,
                  trigger_word: "TOK",
                  learning_rate: 0.0004,
                },
              }
            );

            const replicateId = training.id;

            console.log("userproduct kaydı yapılıyor...");
            // NEW: coverImageUrl'i buraya yazıyoruz
            const { error: insertError } = await supabase
              .from("userproduct")
              .insert({
                user_id,
                product_id: replicateId,
                status: "pending",
                image_urls: JSON.stringify(
                  processedImages.map((img) => img.url).slice(0, 3)
                ),
                cover_images: JSON.stringify([coverImageUrl]), // <-- NEW
                isPaid: true,
                request_id: request_id,
              });
            if (insertError) {
              console.error("userproduct insert hatası:", insertError);
            } else {
              console.log("userproduct kaydı yapıldı.");
            }

            console.log("İşlem başarıyla tamamlandı (Replicate aşaması).");
          } catch (repErr) {
            console.error("Replicate API çağrısında hata oluştu:", repErr);
            // generate_requests'i succeeded bırakabiliriz, istersen failed da yapılabilir.
          }
        } catch (error) {
          console.error("Zip sonrası işlemlerde hata:", error);
          // generate_requests'i succeeded bırakıyoruz, istersen failed da yapabilirsin.
        } finally {
          fs.unlink(zipFilePath, (err) => {
            if (err) {
              console.error("Geçici zip dosyası silinemedi:", err);
            }
          });
        }
      });
    } catch (error) {
      console.error("İşlem başarısız:", error);

      // generate_requests => failed
      await supabase
        .from("generate_requests")
        .update({ status: "failed" })
        .eq("uuid", request_id);

      // Krediyi iade et
      if (creditsDeducted && userData) {
        console.log("Krediler iade ediliyor...");
        const { error: refundError } = await supabase
          .from("users")
          .update({ credit_balance: userData.credit_balance })
          .eq("id", user_id);

        if (refundError) {
          console.error("Credits refund failed:", refundError);
        }
      }
    }
  })();
});

module.exports = router;
