// ML/AI 量化模型路由 — Qlib 集成
const router = require("express").Router();
const { asyncHandler } = require("../middleware/errorHandler");
const qlib = require("../qlib-bridge");

router.get("/api/ml/status", asyncHandler(async (req, res) => {
  const status = await qlib.getStatus();
  res.json(status);
}));

router.get("/api/ml/models", asyncHandler(async (req, res) => {
  const models = await qlib.listModels();
  res.json(models);
}));

router.get("/api/ml/models/:name", asyncHandler(async (req, res) => {
  const metrics = await qlib.getModelMetrics(req.params.name);
  res.json(metrics);
}));

router.post("/api/ml/train", asyncHandler(async (req, res) => {
  const { market, modelType, modelName, trainStart, trainEnd,
          validStart, validEnd, testStart, testEnd } = req.body;
  const result = await qlib.trainModel({
    market, modelType, modelName,
    trainStart, trainEnd, validStart, validEnd, testStart, testEnd,
  });
  res.json(result);
}));

router.post("/api/ml/predict", asyncHandler(async (req, res) => {
  const { modelName, date, stocks } = req.body;
  if (!modelName) {
    return res.status(400).json({ error: "modelName is required" });
  }
  const result = await qlib.predict(modelName, { date, stocks });
  res.json(result);
}));

module.exports = router;
