const express = require("express");
const request = require("request");
const router = express.Router();
const API_KEY = process.env.PICWISH_API_KEY;

const createTask = (imageUrl) => {
  return new Promise((resolve, reject) => {
    request(
      {
        method: "POST",
        url: "https://techhk.aoscdn.com/api/tasks/visual/r-background",
        headers: {
          "X-API-KEY": API_KEY,
        },
        formData: {
          image_url: imageUrl,
          scene_type: 5,
        },
        json: true,
      },
      (error, response) => {
        if (error) {
          return reject(error);
        }
        if (response.body && response.body.data) {
          resolve(response.body.data.task_id);
        } else {
          reject(response.body);
        }
      }
    );
  });
};

const getTaskResult = (taskId) => {
  return new Promise((resolve, reject) => {
    request(
      {
        method: "GET",
        url: `https://techhk.aoscdn.com/api/tasks/visual/r-background/${taskId}`,
        headers: {
          "X-API-KEY": API_KEY,
        },
        json: true,
      },
      (error, response) => {
        if (error) {
          return reject(error);
        }
        if (!response.body.data) return reject(response.body);
        const { progress, state } = response.body.data;
        if (state < 0) return reject(response.body);
        if (progress >= 100) return resolve(response.body);
        reject(null);
      }
    );
  });
};

const polling = async (fn, delay = 1000, timeout = 300000) => {
  try {
    const result = await fn();
    return result;
  } catch (error) {
    if (timeout <= 0) {
      throw new Error("timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    return polling(fn, delay, timeout - delay);
  }
};

router.post("/backgroundGenerator", async (req, res) => {
  const { imageUrl } = req.body;
  try {
    const taskId = await createTask(imageUrl);
    const result = await polling(() => getTaskResult(taskId));
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || error });
  }
});

module.exports = router;
