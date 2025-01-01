// routes/categoriesRouter.js
const express = require("express");
const router = express.Router();

// Bu dosyayı projende nasıl import ediyorsan o şekilde ayarla.
// Örneğin: const shotCategories = require("../utils/shot_categories.json");
const shotCategories = require("../utils/shot_categories.json");

// GET /api/categories?page=1&limit=2
router.get("/categories", async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10; // her sayfada 10 kategori
    const totalItems = shotCategories.length;

    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;

    const paginatedData = shotCategories.slice(startIndex, endIndex);
    const hasMore = endIndex < totalItems;

    return res.status(200).json({
      success: true,
      data: paginatedData,
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
