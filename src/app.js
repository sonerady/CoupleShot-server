// app.js
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");

// Mevcut route'ların import'ları
const imageRoutes = require("./routes/imageRoutes");
const backgroundGeneratorRouter = require("./routes/backgroundGenerator");
const generateFirstShootRouter = require("./routes/generateFirstShoot");
const generatePhotoshootRouter = require("./routes/generatePhotoshoot");
const getModelRouter = require("./routes/getModel");
const listTraingsRouter = require("./routes/listModels");
const getTraining = require("./routes/getTraining");
const updateCreditRouter = require("./routes/updateCredit");
const getUserRouter = require("./routes/getUser");
const notificationRoutes = require("./routes/notificationRoutes");
const addProductRouter = require("./routes/addProduct");
const getUserProductRouter = require("./routes/getUserProduct");
const removeBgRouter = require("./routes/removeBg");
const uploadImageRouter = require("./routes/uploadImage");
const generateTrain = require("./routes/generateTrain");
const checkStatusRouter = require("./routes/checkStatus");
const getTrainRequestRouter = require("./routes/getTrainRequest");
const getRequests = require("./routes/getRequests");
const getBalance = require("./routes/getBalance");
const generatePredictionsRouter = require("./routes/generatePredictions");
const generateImgToVidRouter = require("./routes/generateImgToVid");
const getPredictionsRouter = require("./routes/getPredictions");
const registerAnonymousUserRouter = require("./routes/registerAnonymousUser");
const categoriesRouter = require("./routes/categoriesRouter");
const imageEnhancementRouter = require("./routes/imageEnhancement");
const babyGeneratorRouter = require("./routes/babyGenerator");
// RevenueCat webhook route import
const revenuecatWebhookRouter = require("./routes/revenuecatWebhook");

const app = express();

app.use(cors());
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));

// Mevcut route tanımlamaları
app.use("/api", backgroundGeneratorRouter);
app.use("/api/images", imageRoutes);
app.use("/api/generateFirstShoot", generateFirstShootRouter);
app.use("/api/generatePhotoshoot", generatePhotoshootRouter);
app.use("/api/getModel", getModelRouter);
app.use("/api/listTrainings", listTraingsRouter);
app.use("/api/getTraining", getTraining);
app.use("/api", updateCreditRouter);
app.use("/api", getUserRouter);
app.use("/api", notificationRoutes);
app.use("/api", uploadImageRouter);
app.use("/api", generateTrain);
app.use("/api/checkStatus", checkStatusRouter);
app.use("/api/imageEnhancement", imageEnhancementRouter);
app.use("/api", getTrainRequestRouter);
app.use("/api", getRequests);
app.use("/api", addProductRouter);
app.use("/api", getUserProductRouter);
app.use("/api", removeBgRouter);
app.use("/api", generatePredictionsRouter);
app.use("/api", getPredictionsRouter);
app.use("/api", getBalance);
app.use("/api", registerAnonymousUserRouter);
app.use("/api", generateImgToVidRouter);
app.use("/api", categoriesRouter);
app.use("/api/babyGenerator", babyGeneratorRouter);
// RevenueCat webhook route ekle
app.use("/revenuecat", revenuecatWebhookRouter);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
