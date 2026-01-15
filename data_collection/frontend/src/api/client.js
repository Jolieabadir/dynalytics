/**
 * API client for communicating with the backend.
 * 
 * All API calls go through this module for easy maintenance.
 */
import axios from 'axios';

const API_BASE_URL = 'http://localhost:8000';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ==================== CONFIGURATION ====================

export const getConfig = async () => {
  const response = await api.get('/api/config');
  return response.data;
};

// ==================== VIDEOS ====================

export const uploadVideo = async (file) => {
  const formData = new FormData();
  formData.append('file', file);
  
  const response = await api.post('/api/videos/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
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

// ==================== MOVES ====================

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

// ==================== FRAME TAGS ====================

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
