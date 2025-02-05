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

/**
 * Sunucu başlarken, pending durumdaki istekleri failed yap.
 * Ayrıca bu isteklerde kredi düşülmüşse (credits_deducted = true),
 * user tablosundan krediyi (ve gerekirse train_count'u) geri alabiliriz.
 */
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

          // Eğer bu istek için kredi düşülmüşse iade et
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
 * Erkek (man_X) ve Kadın (woman_X) resimlerini Sharp ile yan yana birleştirme fonksiyonu.
 * Orijinal boyutları koruyarak veya en büyük resme göre ölçeklendirerek birleştirir.
 */
async function sharpCombine(manBuffer, womanBuffer) {
  // Resimlerin metadata bilgilerini al
  const manMeta = await sharp(manBuffer).metadata();
  const womanMeta = await sharp(womanBuffer).metadata();

  // En yüksek boy değerini bul
  const maxHeight = Math.max(manMeta.height, womanMeta.height);

  // Erkek ve kadın resimlerini oranlarını koruyarak yüksekliğe göre ölçekle
  const resizedMan = await sharp(manBuffer)
    .resize({ height: maxHeight, fit: "contain" })
    .toBuffer();

  const resizedWoman = await sharp(womanBuffer)
    .resize({ height: maxHeight, fit: "contain" })
    .toBuffer();

  // Ölçeklenmiş resimlerin yeni boyutlarını al
  const resizedManMeta = await sharp(resizedMan).metadata();
  const resizedWomanMeta = await sharp(resizedWoman).metadata();

  // Toplam genişlik = iki resmin genişliği
  const totalWidth = resizedManMeta.width + resizedWomanMeta.width;

  // Canvas oluştur ve resimleri yan yana yerleştir
  const combined = await sharp({
    create: {
      width: totalWidth,
      height: maxHeight,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([
      { input: resizedMan, top: 0, left: 0 },
      { input: resizedWoman, top: 0, left: resizedManMeta.width },
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
  res.status(200).json({ message: "İşlem başlatıldı, lütfen bekleyin..." });

  (async () => {
    let creditsDeducted = false;
    let userData;
    let creditAmount = 0;

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

      // Önce userproduct tablosunda kayıt var mı kontrol et
      const { data: userProducts, error: userProductError } = await supabase
        .from("userproduct")
        .select("id")
        .eq("user_id", user_id);

      if (userProductError) {
        console.error("userproduct verisi çekilemedi:", userProductError);
        throw userProductError;
      }

      // Eğer kayıt varsa 250 kredi, yoksa kredi düşülmeyecek
      creditAmount = userProducts && userProducts.length > 0 ? 100 : 0;

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

      console.log("Kullanıcı kredi bakiyesi kontrol ediliyor...");
      const { data: ud, error: userError } = await supabase
        .from("users")
        .select("credit_balance")
        .eq("id", user_id)
        .single();

      if (userError) throw userError;
      userData = ud;

      // Kredi kontrolü sadece creditAmount > 0 ise yapılacak
      if (creditAmount > 0 && userData.credit_balance < creditAmount) {
        console.error("Kredi yetersiz. failed durumuna geçiliyor...");
        await supabase
          .from("generate_requests")
          .update({ status: "failed" })
          .eq("uuid", request_id);
        return;
      }

      // Kredi düşme işlemi sadece creditAmount > 0 ise yapılacak
      if (creditAmount > 0) {
        console.log(`${creditAmount} kredi düşülüyor...`);
        const newCreditBalance = userData.credit_balance - creditAmount;
        const { error: updateCreditError } = await supabase
          .from("users")
          .update({ credit_balance: newCreditBalance })
          .eq("id", user_id);
        if (updateCreditError) throw updateCreditError;

        // Kredi düşüldüğünü generate_requests tablosuna yansıtıyoruz
        const { error: creditsDeductedError } = await supabase
          .from("generate_requests")
          .update({ credits_deducted: true })
          .eq("uuid", request_id);
        if (creditsDeductedError) throw creditsDeductedError;

        creditsDeducted = true;
      }

      // Tüm dosyaları alalım ve önce birleştirelim
      console.log("Resimler eşleştiriliyor ve birleştiriliyor...");
      const signedUrls = [];

      // Önce tüm dosyaları Supabase'e yükleyelim
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

        const uniqueName = `${Date.now()}_${uuidv4()}_${file.originalname}`;
        const { error, data } = await supabase.storage
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
          url: publicUrlData.publicUrl,
          buffer: finalBuffer,
        });
      }

      // Şimdi eşleştirme ve birleştirme yapalım
      console.log(
        "Uploaded files:",
        signedUrls.map((u) => u.originalName)
      );

      let combinedImages = [];

      // If there are exactly 2 images, combine them regardless of names
      if (signedUrls.length === 2) {
        const [firstImage, secondImage] = signedUrls;

        // Birleştirme işlemi
        const combinedBuffer = await sharpCombine(
          firstImage.buffer,
          secondImage.buffer
        );

        // Birleştirilmiş görseli Supabase'e yükle
        const combinedFileName = `combined_${uuidv4()}.png`;
        const { error: uploadError } = await supabase.storage
          .from("images")
          .upload(combinedFileName, combinedBuffer, {
            contentType: "image/png",
          });

        if (uploadError) {
          console.error("Birleştirilmiş görsel yükleme hatası:", uploadError);
        } else {
          const { data: combinedUrlData } = await supabase.storage
            .from("images")
            .getPublicUrl(combinedFileName);

          combinedImages.push({
            index: 1,
            url: combinedUrlData.publicUrl,
            fileName: combinedFileName,
          });
        }
      } else {
        // Try the original man/woman matching logic
        const manItems = signedUrls.filter((r) =>
          r.originalName.toLowerCase().startsWith("man_")
        );

        for (const manItem of manItems) {
          const suffix = manItem.originalName.split("_")[1];
          const manIndex = suffix.split(".")[0];

          const womanItem = signedUrls.find((r) =>
            r.originalName.toLowerCase().startsWith(`woman_${manIndex}.`)
          );

          if (!womanItem) {
            console.log(`woman_${manIndex} bulunamadı, combine atlanıyor.`);
            continue;
          }

          // Birleştirme işlemi
          const combinedBuffer = await sharpCombine(
            manItem.buffer,
            womanItem.buffer
          );

          // Birleştirilmiş görseli Supabase'e yükle
          const combinedFileName = `combined_${manIndex}_${uuidv4()}.png`;
          const { error: uploadError } = await supabase.storage
            .from("images")
            .upload(combinedFileName, combinedBuffer, {
              contentType: "image/png",
            });

          if (uploadError) {
            console.error("Birleştirilmiş görsel yükleme hatası:", uploadError);
            continue;
          }

          const { data: combinedUrlData } = await supabase.storage
            .from("images")
            .getPublicUrl(combinedFileName);

          combinedImages.push({
            index: manIndex,
            url: combinedUrlData.publicUrl,
            fileName: combinedFileName,
          });
        }
      }

      if (combinedImages.length === 0) {
        console.error("Hiçbir görsel birleştirilemedi. İşlem durduruluyor...");
        await supabase
          .from("generate_requests")
          .update({ status: "failed" })
          .eq("uuid", request_id);

        if (creditsDeducted) {
          console.log("Krediler iade ediliyor...");
          const { error: refundError } = await supabase
            .from("users")
            .update({ credit_balance: userData.credit_balance + creditAmount })
            .eq("id", user_id);

          if (refundError) {
            console.error("Credits refund failed:", refundError);
          } else {
            console.log(`${creditAmount} kredi iade edildi.`);
          }
        }
        return;
      }

      // Şimdi birleştirilmiş görsellerin arka planını kaldıralım
      console.log("Birleştirilmiş görsellerin arka planı kaldırılıyor...");
      console.log("combinedImages:", JSON.stringify(combinedImages, null, 2));
      const removeBgResults = [];

      for (const combined of combinedImages) {
        try {
          console.log("Arka plan kaldırma işlemi başlıyor:", combined.fileName);
          const prediction = await predictions.create({
            version:
              "4067ee2a58f6c161d434a9c077cfa012820b8e076efa2772aa171e26557da919",
            input: { image: combined.url },
          });

          const completedPrediction = await waitForPredictionToComplete(
            prediction.id,
            replicate,
            120000,
            3000
          );

          if (completedPrediction.output) {
            console.log(
              "Arka plan kaldırma başarılı:",
              completedPrediction.output
            );
            removeBgResults.push({
              index: combined.index,
              outputUrl: completedPrediction.output,
              fileName: combined.fileName,
            });
          } else {
            console.error(
              "Arka plan kaldırma çıktısı alınamadı:",
              combined.fileName
            );
          }
        } catch (error) {
          console.error("Arka plan kaldırma hatası:", error);
        }
      }

      console.log("removeBgResults:", JSON.stringify(removeBgResults, null, 2));

      // Eğer işlemde hata varsa (processingFailed)
      if (removeBgResults.length === 0) {
        console.error("İşlemde hata oldu, generate_requests failed...");
        await supabase
          .from("generate_requests")
          .update({ status: "failed" })
          .eq("uuid", request_id);

        // Eğer gerçekten kredi düşmüşse (creditsDeducted) iade et
        if (creditsDeducted) {
          console.log("Krediler iade ediliyor...");
          const { error: refundError } = await supabase
            .from("users")
            .update({ credit_balance: userData.credit_balance + creditAmount })
            .eq("id", user_id);

          if (refundError) {
            console.error("Credits refund failed:", refundError);
          } else {
            console.log(`${creditAmount} kredi iade edildi.`);
          }
        }
        return;
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

        // Krediyi iade et
        if (creditsDeducted) {
          console.log("Krediler iade ediliyor...");
          const { error: refundError } = await supabase
            .from("users")
            .update({ credit_balance: userData.credit_balance + creditAmount })
            .eq("id", user_id);

          if (refundError) {
            console.error("Credits refund failed:", refundError);
          } else {
            console.log(`${creditAmount} kredi iade edildi.`);
          }
        }
      });
      archive.pipe(outputStream);

      console.log("Birleştirilmiş görseller ZIP'e ekleniyor...");
      let imageIndex = 0;
      for (const item of removeBgResults) {
        const imgFileName = `combined_${item.index}_${uuidv4()}.png`;
        console.log("İşlenen resim:", imgFileName);

        try {
          // Önce resmi indir
          console.log("Resim indiriliyor:", item.outputUrl);
          const response = await axios.get(item.outputUrl, {
            responseType: "arraybuffer",
          });

          // İndirilen resmi buffer olarak ZIP'e ekle
          archive.append(response.data, { name: imgFileName });

          // Supabase'e de yükleyelim
          console.log("Resim Supabase'e yükleniyor...");
          const { error: uploadError } = await supabase.storage
            .from("images")
            .upload(imgFileName, response.data, {
              contentType: "image/png",
            });

          if (!uploadError) {
            const { data: publicUrlData, error: publicUrlError } =
              await supabase.storage.from("images").getPublicUrl(imgFileName);

            if (!publicUrlError) {
              console.log("Resim başarıyla yüklendi:", publicUrlData.publicUrl);
              processedImages.push({
                url: publicUrlData.publicUrl,
                fileName: imgFileName,
              });
            } else {
              console.error("Public URL alınamadı:", publicUrlError);
            }
          } else {
            console.error("Supabase yükleme hatası:", uploadError);
          }
        } catch (ex) {
          console.error(`Resim işlenirken hata oluştu (${imgFileName}):`, ex);
        }

        imageIndex++;
      }

      console.log("processedImages:", JSON.stringify(processedImages, null, 2));

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

            // Cover image işlemi
            let coverImageUrls = [];
            if (combinedImages.length > 0) {
              try {
                // İlk birleştirilmiş görseli al
                const firstCombined = combinedImages[0];
                const { data: publicUrlData } = await supabase.storage
                  .from("images")
                  .getPublicUrl(firstCombined.fileName);

                if (publicUrlData && publicUrlData.publicUrl) {
                  coverImageUrls.push(publicUrlData.publicUrl);
                }
              } catch (coverError) {
                console.error("Cover image işleminde hata:", coverError);
              }
            }

            console.log("userproduct kaydı yapılıyor...");
            console.log(
              "Kaydedilecek image_urls:",
              JSON.stringify(processedImages.map((img) => img.url).slice(0, 3))
            );
            // Cover images'i güncelliyoruz
            const { error: insertError } = await supabase
              .from("userproduct")
              .insert({
                user_id,
                product_id: replicateId,
                status: "pending",
                image_urls: JSON.stringify(
                  processedImages.map((img) => img.url).slice(0, 3)
                ),
                cover_images: JSON.stringify(
                  coverImageUrls.length > 0 ? coverImageUrls : [image_url]
                ),
                isPaid: true,
                request_id: request_id,
              });
            if (insertError) {
              console.error("userproduct insert hatası:", insertError);
            } else {
              console.log("userproduct kaydı yapıldı.");
            }

            console.log("İşlem başarıyla tamamlandı (Replicate aşaması).");

            if (
              training.status === "failed" ||
              training.status === "canceled"
            ) {
              // Krediyi iade et
              if (creditsDeducted) {
                console.log("Replicate hatası: Krediler iade ediliyor...");
                const { error: refundError } = await supabase
                  .from("users")
                  .update({
                    credit_balance: userData.credit_balance + creditAmount,
                  })
                  .eq("id", user_id);

                if (refundError) {
                  console.error("Credits refund failed:", refundError);
                } else {
                  console.log(`${creditAmount} kredi iade edildi`);
                }
              }
              throw new Error("Replicate training failed or canceled");
            }
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

      // Eğer kredi düşmüşsek iade et
      if (creditsDeducted && userData) {
        console.log("Krediler iade ediliyor...");
        const { error: refundError } = await supabase
          .from("users")
          .update({ credit_balance: userData.credit_balance + creditAmount })
          .eq("id", user_id);

        if (refundError) {
          console.error("Credits refund failed:", refundError);
        } else {
          console.log(`${creditAmount} kredi iade edildi`);
        }
      }
    }
  })();
});

module.exports = router;
