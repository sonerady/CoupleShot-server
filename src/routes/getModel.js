const express = require("express");
const axios = require("axios");
const dotenv = require("dotenv");

dotenv.config();

const router = express.Router();

router.get("/:id", async (req, res) => {
  const predictionId = req.params.id;
  const replicateApiUrl = `https://api.replicate.com/v1/predictions/${predictionId}`;

  try {
    const response = await axios.get(replicateApiUrl, {
      headers: {
        Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
      },
    });
    res.json(response.data);
  } catch (error) {
    console.error("Error fetching prediction data:", error.message);
    res
      .status(500)
      .json({ error: "An error occurred while fetching the prediction data." });
  }
});

module.exports = router;
