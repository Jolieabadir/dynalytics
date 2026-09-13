/**
 * API client for communicating with the backend.
 *
 * All API calls go through this module for easy maintenance.
 * Updated for three-lens schema: Environment / Strategy / Outcome
 */
import axios from 'axios';
import { authHeader, requireAccessToken } from './auth';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Every /api route except /api/health requires a Supabase bearer token.
api.interceptors.request.use(async (config) => {
  if (config.url && config.url.includes('/api/health')) return config;
  Object.assign(config.headers, await authHeader());
  return config;
});

// ==================== CONFIGURATION ====================

export const getConfig = async () => {
  const response = await api.get('/api/config');
  return response.data;
};

// ==================== VIDEOS ====================

/**
 * Register a client-processed video.
 *
 * Retried with exponential backoff: extraction can run for minutes before this
 * call, so a transient network blip here would throw away all of that work.
 * Only transport failures and 5xx are retried — a 401 or a 413 will not become
 * true on a second attempt.
 *
 * @param {{filename: string, fps: number, total_frames: number, duration_ms: number, csv_data: string}} payload
 * @param {{attempts?: number, baseDelayMs?: number, onRetry?: (attempt: number, delayMs: number, err: Error) => void, signal?: AbortSignal}} [options]
 */
export const registerVideo = async (payload, options = {}) => {
  const { attempts = 3, baseDelayMs = 1000, onRetry, signal } = options;

  // Surface a missing session before spending a retry budget on a guaranteed 401.
  await requireAccessToken();

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await api.post('/api/videos/register', payload, { signal });
      return response.data;
    } catch (err) {
      lastError = err;

      const status = err.response?.status;
      const retriable = status === undefined || status >= 500;
      if (!retriable || attempt === attempts || signal?.aborted) break;

      // 1s, 2s, 4s with jitter, so parallel clients don't retry in lockstep.
      const delay = baseDelayMs * 2 ** (attempt - 1) * (0.5 + Math.random());
      if (onRetry) onRetry(attempt, delay, err);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  const detail = lastError?.response?.data?.detail;
  throw new Error(detail || lastError?.message || 'Failed to register video');
};

/** Presigned PUT URL for uploading the original video straight to R2. */
export const getUploadUrl = async (videoId, contentType = 'video/mp4') => {
  const response = await api.post(`/api/videos/${videoId}/upload-url`, {
    content_type: contentType,
  });
  return response.data;
};

/**
 * Upload the original video to R2.
 *
 * The Content-Type must match the one the presigned URL was signed with, or R2
 * rejects the signature. Sent without credentials — the signature is the auth.
 */
export const putVideoToR2 = async (url, file, contentType = 'video/mp4') => {
  const response = await fetch(url, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': contentType },
  });
  if (!response.ok) {
    throw new Error(`Video upload failed (${response.status})`);
  }
  return response;
};

/** Record the R2 key once the direct upload has finished. */
export const confirmUpload = async (videoId, key) => {
  const response = await api.post(`/api/videos/${videoId}/confirm-upload`, { key });
  return response.data;
};

/**
 * Full original-video upload: presign → PUT to R2 → confirm.
 * Best-effort by design; the pose CSV is already saved by registerVideo.
 */
export const uploadOriginalVideo = async (videoId, file) => {
  const contentType = file.type || 'video/mp4';
  const { url, key } = await getUploadUrl(videoId, contentType);
  await putVideoToR2(url, file, contentType);
  return confirmUpload(videoId, key);
};

export const getVideos = async () => {
  const response = await api.get('/api/videos');
  return response.data;
};

export const getVideo = async (videoId) => {
  const response = await api.get(`/api/videos/${videoId}`);
  return response.data;
};

export const getVideoCSV = async (videoId) => {
  const response = await api.get(`/api/videos/${videoId}/csv`);
  return response.data;
};

/**
 * Export labeled data for a video.
 * @param {number} videoId - The video ID to export
 * @param {boolean} deleteVideo - If true, delete the video file after export
 * @returns {Promise<{path: string, video_deleted: boolean}>}
 */
export const exportVideo = async (videoId, deleteVideo = true) => {
  const response = await api.post(`/api/videos/${videoId}/export?delete_video=${deleteVideo}`);
  return response.data;
};

/**
 * Download the exported CSV file.
 * @param {number} videoId - The video ID
 */
export const downloadExport = async (videoId) => {
  const response = await api.get(`/api/videos/${videoId}/export/download`, {
    responseType: 'blob',
  });

  // Create download link
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `video_${videoId}_labeled.csv`);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};

// ==================== MOVES (Lens 2: Strategy) ====================

export const createMove = async (moveData) => {
  const response = await api.post('/api/moves', moveData);
  return response.data;
};

export const getMoves = async (videoId) => {
  const response = await api.get(`/api/videos/${videoId}/moves`);
  return response.data;
};

export const getMove = async (moveId) => {
  const response = await api.get(`/api/moves/${moveId}`);
  return response.data;
};

export const updateMove = async (moveId, moveData) => {
  const response = await api.put(`/api/moves/${moveId}`, moveData);
  return response.data;
};

export const deleteMove = async (moveId) => {
  await api.delete(`/api/moves/${moveId}`);
};

// ==================== ENVIRONMENTS (Lens 1) ====================

export const createEnvironment = async (envData) => {
  const response = await api.post('/api/environments', envData);
  return response.data;
};

export const getEnvironmentForMove = async (moveId) => {
  try {
    const response = await api.get(`/api/moves/${moveId}/environment`);
    return response.data;
  } catch (err) {
    if (err.response?.status === 404) {
      return null; // No environment yet
    }
    throw err;
  }
};

export const updateEnvironment = async (envId, envData) => {
  const response = await api.put(`/api/environments/${envId}`, envData);
  return response.data;
};

// ==================== OUTCOMES (Lens 3) ====================

export const createOutcome = async (outcomeData) => {
  const response = await api.post('/api/outcomes', outcomeData);
  return response.data;
};

export const getOutcomeForMove = async (moveId) => {
  try {
    const response = await api.get(`/api/moves/${moveId}/outcome`);
    return response.data;
  } catch (err) {
    if (err.response?.status === 404) {
      return null; // No outcome yet
    }
    throw err;
  }
};

export const updateOutcome = async (outcomeId, outcomeData) => {
  const response = await api.put(`/api/outcomes/${outcomeId}`, outcomeData);
  return response.data;
};

// ==================== FRAME TAGS (Sensation) ====================

export const createFrameTag = async (tagData) => {
  const response = await api.post('/api/frame-tags', tagData);
  return response.data;
};

export const getFrameTags = async (moveId) => {
  const response = await api.get(`/api/moves/${moveId}/frame-tags`);
  return response.data;
};

export const deleteFrameTag = async (tagId) => {
  await api.delete(`/api/frame-tags/${tagId}`);
};

export default api;
