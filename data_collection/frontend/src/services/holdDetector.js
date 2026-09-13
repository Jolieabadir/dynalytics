/**
 * Automatic climbing-hold detection — YOLOv8n via onnxruntime-web.
 *
 * ⚠️ DISABLED BY DEFAULT. See the licensing note below. The manual
 * click-to-place flow in VideoPlayer is the shipped path and is complete
 * without this module.
 *
 * ---------------------------------------------------------------------------
 * TODO(detector-license): no permissively-licensed climbing-hold model exists.
 *
 * Surveyed 2026-09-13. Every published climbing-hold detector is a fine-tune of
 * Ultralytics YOLOv8, and Ultralytics YOLOv8 is itself AGPL-3.0 — so the
 * copyleft is inherited by every derivative. There is no permissive option to
 * pick:
 *
 *   jwlarocque/yolov8n-freeclimbs-detect-2  AGPL-3.0  0 downloads, 3 likes
 *       Best technical fit: single "hold" class, ships fp16 and fp32 .onnx,
 *       trained on home/spray walls. Its card notes an earlier MIT label was
 *       an error and AGPL-3.0 is binding.
 *   samolego/yolo-holds                     AGPL-3.0  .pt only
 *   ricardosreichert/holds_yolo_v8          no license declared (= all rights
 *                                           reserved), .pt only
 *
 * Bundling AGPL-3.0 weights into a web frontend would put AGPL obligations on
 * the served application — a licensing decision for the project owner, not a
 * default to take quietly. So no weights are bundled and the flag is off.
 *
 * To enable, once a model is chosen and its licence accepted:
 *   1. put the .onnx at `public/models/holds.onnx` (or set VITE_HOLD_MODEL_URL)
 *   2. set VITE_ENABLE_HOLD_DETECTION=true
 *   3. re-check INPUT_SIZE below against the model's expected input
 *
 * The decode path below is written against standard YOLOv8 output
 * ([1, 4+nc, N], xywh in input-space pixels) and is ready to run, but it has
 * NOT been validated against real detector output — there was no
 * permissively-licensed model to validate it with.
 * ---------------------------------------------------------------------------
 */

/**
 * Feature flag. Off unless the build explicitly turns it on.
 *
 * Written as a direct comparison against the literal Vite substitutes at build
 * time, so that when the flag is off Rollup can fold this to `false`, see the
 * `import('onnxruntime-web')` calls below as unreachable, and drop the runtime
 * — roughly 28 MB of wasm — out of the bundle entirely. A cleverer expression
 * here (String(...).toLowerCase()) defeats that folding and ships the whole
 * runtime to every labeler for a feature that is switched off.
 */
export const HOLD_DETECTION_ENABLED =
  import.meta.env.VITE_ENABLE_HOLD_DETECTION === 'true';

/** Where the weights live, if any. */
export const HOLD_MODEL_URL =
  import.meta.env.VITE_HOLD_MODEL_URL || '/models/holds.onnx';

/**
 * Square input the model expects.
 *
 * jwlarocque/yolov8n-freeclimbs-detect-2 wants 2560×2560, which is far too big
 * for a comfortable in-browser run; 640 is the YOLOv8 default and what a
 * re-export should target. Re-check this against whichever model is adopted.
 */
export const INPUT_SIZE = Number(import.meta.env.VITE_HOLD_MODEL_INPUT || 640);

export const SCORE_THRESHOLD = 0.35;
export const IOU_THRESHOLD = 0.45;

/** Intersection-over-union of two normalized boxes. */
export function iou(a, b) {
  const ax2 = a.bbox_x + a.bbox_w;
  const ay2 = a.bbox_y + a.bbox_h;
  const bx2 = b.bbox_x + b.bbox_w;
  const by2 = b.bbox_y + b.bbox_h;

  const interW = Math.max(0, Math.min(ax2, bx2) - Math.max(a.bbox_x, b.bbox_x));
  const interH = Math.max(0, Math.min(ay2, by2) - Math.max(a.bbox_y, b.bbox_y));
  const inter = interW * interH;
  if (inter <= 0) return 0;

  const union = a.bbox_w * a.bbox_h + b.bbox_w * b.bbox_h - inter;
  return union > 0 ? inter / union : 0;
}

/** Greedy non-maximum suppression, highest score first. */
export function nonMaxSuppression(boxes, iouThreshold = IOU_THRESHOLD) {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  const kept = [];
  for (const box of sorted) {
    if (kept.every((k) => iou(k, box) < iouThreshold)) kept.push(box);
  }
  return kept;
}

/**
 * Decode a YOLOv8 detection head into normalized boxes.
 *
 * Output is [1, 4 + numClasses, numAnchors]: four box values then one score per
 * class, per anchor. Coordinates are xywh centred, in input-space pixels, so
 * they are divided by `inputSize` to land in the 0-1 space the backend stores.
 *
 * @param {Float32Array} data - raw output tensor
 * @param {number[]} dims - tensor dims, [1, 4+nc, anchors]
 * @param {number} inputSize
 * @returns {Array<{bbox_x:number,bbox_y:number,bbox_w:number,bbox_h:number,score:number}>}
 */
export function decodeYolov8Output(data, dims, inputSize = INPUT_SIZE) {
  const [, channels, anchors] = dims;
  const numClasses = channels - 4;
  const boxes = [];

  for (let i = 0; i < anchors; i++) {
    let best = 0;
    for (let c = 0; c < numClasses; c++) {
      const score = data[(4 + c) * anchors + i];
      if (score > best) best = score;
    }
    if (best < SCORE_THRESHOLD) continue;

    const cx = data[0 * anchors + i];
    const cy = data[1 * anchors + i];
    const w = data[2 * anchors + i];
    const h = data[3 * anchors + i];

    // Centred xywh in pixels → top-left xywh normalized, clamped to frame.
    const x = (cx - w / 2) / inputSize;
    const y = (cy - h / 2) / inputSize;
    const bw = w / inputSize;
    const bh = h / inputSize;

    boxes.push({
      bbox_x: Math.max(0, Math.min(1, x)),
      bbox_y: Math.max(0, Math.min(1, y)),
      bbox_w: Math.max(0, Math.min(1, bw)),
      bbox_h: Math.max(0, Math.min(1, bh)),
      score: best,
    });
  }

  return nonMaxSuppression(boxes);
}

/** Letterbox-free resize of a video frame into an NCHW float tensor. */
function frameToTensor(source, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, size, size);

  const { data } = ctx.getImageData(0, 0, size, size);
  const pixels = size * size;
  const chw = new Float32Array(pixels * 3);

  // RGBA interleaved → planar RGB, scaled to 0-1, as YOLOv8 expects.
  for (let i = 0; i < pixels; i++) {
    chw[i] = data[i * 4] / 255;
    chw[pixels + i] = data[i * 4 + 1] / 255;
    chw[pixels * 2 + i] = data[i * 4 + 2] / 255;
  }
  return chw;
}

let sessionPromise = null;

/** Load the ONNX session once. onnxruntime-web is imported lazily so it stays
 *  out of the main bundle while detection is off. */
async function getSession() {
  if (!HOLD_DETECTION_ENABLED) throw new Error('Hold detection is disabled');
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    const ort = await import('onnxruntime-web');
    return ort.InferenceSession.create(HOLD_MODEL_URL, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
  })();
  return sessionPromise;
}

/**
 * Detect holds in one video frame.
 *
 * Returns [] rather than throwing when the flag is off or the model is
 * missing — a missing detector must never block an upload.
 *
 * @param {HTMLVideoElement|HTMLCanvasElement|ImageBitmap} frame
 * @returns {Promise<Array<{bbox_x,bbox_y,bbox_w,bbox_h,source:'detected'}>>}
 */
export async function detectHolds(frame) {
  if (!HOLD_DETECTION_ENABLED) return [];

  try {
    const ort = await import('onnxruntime-web');
    const session = await getSession();

    const input = new ort.Tensor('float32', frameToTensor(frame, INPUT_SIZE), [
      1, 3, INPUT_SIZE, INPUT_SIZE,
    ]);
    const feeds = { [session.inputNames[0]]: input };
    const output = await session.run(feeds);
    const tensor = output[session.outputNames[0]];

    return decodeYolov8Output(tensor.data, tensor.dims, INPUT_SIZE).map((b) => ({
      bbox_x: b.bbox_x,
      bbox_y: b.bbox_y,
      bbox_w: b.bbox_w,
      bbox_h: b.bbox_h,
      source: 'detected',
    }));
  } catch (err) {
    // Never block the upload flow on the detector.
    console.warn('Hold detection unavailable:', err?.message || err);
    return [];
  }
}
