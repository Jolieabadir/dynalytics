/**
 * ThankYouModal component.
 * 
 * Shows a thank you message after user finishes contributing.
 * Reusable across different screens.
 */
import useStore from '../store/useStore';

function ThankYouModal({ show, onClose }) {
  const { setCurrentVideo, setCurrentMove, setFrameTags, setMode } = useStore();

  if (!show) return null;

  const handleFinish = () => {
    setMode('define');
    setCurrentMove(null);
    setFrameTags([]);
    setCurrentVideo(null); // Takes user back to upload screen
    if (onClose) onClose();
  };

  return (
    <div className="thank-you-overlay">
      <div className="thank-you-modal">
        <h2>🎉 Thank You!</h2>
        <p>
          Your contribution helps build better movement analysis tools for climbers everywhere.
          Every tagged frame makes the research stronger.
        </p>
        <button onClick={handleFinish}>
          Upload Another Video
        </button>
      </div>
    </div>
  );
}

export default ThankYouModal;
