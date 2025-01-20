const express = require("express");
const router = express.Router();

const shotCategories = require("../utils/shot_categories.json");

function transformImageUrl(imageUrl) {
  try {
    const url = new URL(imageUrl);
    url.searchParams.append("width", "400");
    url.searchParams.append("quality", "10");
    url.searchParams.append("format", "jpeg");
    return url.toString();
  } catch (error) {
    console.error("Error transforming image URL:", error);
    return imageUrl;
  }
}

// GET /api/categories?page=1&limit=2&category=xyz
router.get("/categories", async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const category = req.query.category;

    let filteredCategories = shotCategories;

    // Eğer kategori belirtilmişse, sadece o kategoriyi döndür
    if (category && category !== "all") {
      const selectedCategory = shotCategories.find(
        (cat) => cat.category === category
      );
      filteredCategories = selectedCategory ? [selectedCategory] : [];
    }

    const totalItems = filteredCategories.length;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;

    const paginatedData = filteredCategories.slice(startIndex, endIndex);

    // Transform image URLs
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
