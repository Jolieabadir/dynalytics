/**
 * ExportService - handles exporting labeled data
 */
import api from './client';

export const exportVideo = async (videoId) => {
  const response = await api.post(`/api/videos/${videoId}/export`);
  return response.data;
};

export default { exportVideo };
