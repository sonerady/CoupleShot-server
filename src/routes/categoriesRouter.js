// routes/categoriesRouter.js
const express = require("express");
const router = express.Router();

// Bu dosyayı projende nasıl import ediyorsan o şekilde ayarla.
// Örneğin: const shotCategories = require("../utils/shot_categories.json");
const shotCategories = require("../utils/shot_categories.json");

function transformImageUrl(imageUrl) {
  try {
    // Parse the URL
    const url = new URL(imageUrl);

    // Add transformation parameters
    // width=400 - Genişliği 400px'e düşür (yarıya indirdik)
    // quality=10 - JPEG kalitesini %10'a düşür (çok düşük kalite)
    // format=jpeg - JPEG formatına dönüştür
    url.searchParams.append("width", "400");
    url.searchParams.append("quality", "10");
    url.searchParams.append("format", "jpeg");

    return url.toString();
  } catch (error) {
    console.error("Error transforming image URL:", error);
    return imageUrl; // URL dönüştürme başarısız olursa orijinal URL'i döndür
  }
}

// GET /api/categories?page=1&limit=2
router.get("/categories", async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10; // her sayfada 10 kategori
    const totalItems = shotCategories.length;

    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;

    const paginatedData = shotCategories.slice(startIndex, endIndex);

    // Transform image URLs to use Supabase transformations
    const processedData = paginatedData.map((category) => ({
      ...category,
      sub_category: category.sub_category.map((subCat) => ({
        ...subCat,
        image: transformImageUrl(subCat.image),
      })),
    }));

    const hasMore = endIndex < totalItems;

    return res.status(200).json({
      success: true,
      data: processedData,
      currentPage: page,
      totalPages: Math.ceil(totalItems / limit),
      hasMore,
      totalItems,
    });
  } catch (error) {
    console.error("Error in /categories route:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

module.exports = router;
