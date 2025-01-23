// routes/revenuecatWebhook.js
const express = require("express");
const router = express.Router();
const supabase = require("../supabaseClient"); // supabaseClient.js dosyanın yolu

router.post("/webhook", async (req, res) => {
  try {
    const event = req.body;
    console.log("RevenueCat webhook event received:", event);

    const rcEvent = event.event;
    if (!rcEvent) {
      return res.status(400).json({ message: "Invalid event structure" });
    }

    // requestte $RCAnonymousID vs diye birşey yoksa bu kısımları kaldırıyoruz
    const {
      type,
      app_user_id,
      product_id,
      original_transaction_id,
      purchased_at_ms,
    } = rcEvent;

    // purchased_at_ms'den ISO formatında bir tarih oluşturuyoruz
    const purchase_date = purchased_at_ms
      ? new Date(purchased_at_ms).toISOString()
      : new Date().toISOString(); // güvenlik için, eğer yoksa mevcut zaman

    // Eğer gerçek yenileme event'i "RENEWAL" olarak geliyorsa
    if (type === "RENEWAL") {
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("*")
        .eq("id", app_user_id)
        .single();

      if (userError || !userData) {
        console.error("User not found:", userError);
        return res.status(404).json({ message: "User not found" });
      }

      let addedCoins = 0;
      let productTitle = "";
      let packageType = "";

      // Handle different subscription types
      if (product_id === "com.monailisa.coupleshot_500coin_weekly") {
        addedCoins = 500;
        productTitle = "500 Coin Weekly";
        packageType = "weekly_subscription";
      } else if (product_id === "com.coupleshot.1500coin_yearly") {
        addedCoins = 1500;
        productTitle = "1500 Coin Yearly";
        packageType = "yearly_subscription";
      }

      const currentBalance = userData.credit_balance || 0;
      const newBalance = currentBalance + addedCoins;

      // Bakiyeyi güncelle
      const { error: updateErr } = await supabase
        .from("users")
        .update({ credit_balance: newBalance })
        .eq("id", app_user_id);

      if (updateErr) {
        console.error("Error updating user balance:", updateErr);
        return res.status(500).json({ message: "Failed to update balance" });
      }

      // user_purchase tablosuna kayıt ekle
      const purchaseData = {
        user_id: app_user_id,
        product_id: product_id,
        product_title: productTitle,
        purchase_date: purchase_date,
        package_type: packageType,
        price: 0,
        coins_added: addedCoins,
        transaction_id: original_transaction_id,
        purchase_number: null,
      };

      const { error: insertError } = await supabase
        .from("user_purchase")
        .insert([purchaseData]);

      if (insertError) {
        console.error("Error inserting renewal data:", insertError);
        return res
          .status(500)
          .json({ message: "Failed to record renewal purchase" });
      }

      console.log("Renewal processed successfully for user:", app_user_id);
      return res.status(200).json({ message: "Renewal processed" });
    }

    // Diğer event tipleri için farklı işlemler ekleyebilirsin
    return res.status(200).json({ message: "Event handled" });
  } catch (err) {
    console.error("Error handling webhook:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
