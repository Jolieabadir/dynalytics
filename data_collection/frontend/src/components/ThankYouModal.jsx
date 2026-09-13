/**
 * ThankYouModal — the end of a labeling session.
 *
 * Now also the place the export lands. v3 answers the download endpoint with a
 * `307` to a presigned R2 URL, so rather than silently triggering a save this
 * shows the link: a labeler can see the export exists, click it when ready, and
 * copy it if they want to hand it on.
 *
 * The presigned URL expires, which the copy says out loud — a stale link that
 * looks fine is worse than one that admits its shelf life.
 */
import useStore from '../store/useStore';

function ThankYouModal({ show, onClose, downloadUrl, exportError }) {
  const { setCurrentVideo, setCurrentMove, setFrameTags, setMode, setHolds, setMoves } =
    useStore();

  if (!show) return null;

  const handleFinish = () => {
    setMode('define');
    setCurrentMove(null);
    setFrameTags([]);
    setCurrentVideo(null);
    setMoves([]);
    setHolds([]);
    if (onClose) onClose();
  };

  return (
    <div className="thank-you-overlay">
      <div className="thank-you-modal">
        <h2>🎉 Thank You!</h2>
        <p>
          Your contribution helps build better movement analysis tools for
          climbers everywhere.
        </p>

        {exportError ? (
          <div className="error-message">
            <p><strong>The export did not complete.</strong></p>
            <p>{exportError}</p>
            <p>Your labels are saved — the export can be retried later.</p>
          </div>
        ) : (
          <>
            <p className="export-success">✅ Data exported successfully!</p>
            {downloadUrl ? (
              <p className="export-download">
                <a href={downloadUrl} target="_blank" rel="noopener noreferrer">
                  Download the labeled CSV
                </a>
                <br />
                <small>This link is temporary and will expire in about an hour.</small>
              </p>
            ) : (
              <p className="export-download">
                <small>Preparing the download link…</small>
              </p>
            )}
          </>
        )}

        <button onClick={handleFinish}>Upload Another Video</button>
      </div>
    </div>
  );
}

export default ThankYouModal;
