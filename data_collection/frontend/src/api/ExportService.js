/**
 * ExportService - handles exporting labeled data.
 *
 * Thin re-export so the two existing call sites keep their import path. The
 * real implementations live in `client.js`, which owns the auth interceptor.
 *
 * v3 notes: export takes no query params (it no longer deletes the video as a
 * side effect), and the download is a presigned R2 URL rather than a streamed
 * body.
 */
export { exportVideo, getExportDownloadUrl, downloadExport } from './client';

import { exportVideo, getExportDownloadUrl, downloadExport } from './client';

export default { exportVideo, getExportDownloadUrl, downloadExport };
