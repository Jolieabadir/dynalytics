/**
 * ThankYouModal component.
 * 
 * Just displays thank you message. Export logic handled by parent.
 */
import useStore from '../store/useStore';

function ThankYouModal({ show, onClose }) {
  const { setCurrentVideo, setCurrentMove, setFrameTags, setMode } = useStore();

  if (!show) return null;

  const handleFinish = () => {
    setMode('define');
    setCurrentMove(null);
    setFrameTags([]);
    setCurrentVideo(null);
    if (onClose) onClose();
  };

  return (
    <div className="thank-you-overlay">
      <div className="thank-you-modal">
        <h2>🎉 Thank You!</h2>
        <p>Your contribution helps build better movement analysis tools for climbers everywhere.</p>
        <p className="export-success">✅ Data exported successfully!</p>
        <button onClick={handleFinish}>Upload Another Video</button>
      </div>
    </div>
  );
}

export default ThankYouModal;
