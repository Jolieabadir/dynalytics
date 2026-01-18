/**
 * DoneButton component.
 * 
 * Button that exports data and deletes video to save storage,
 * then triggers the thank you modal.
 */
import { useState } from 'react';
import { exportVideo } from '../api/client';
import useStore from '../store/useStore';

function DoneButton({ onComplete }) {
  const [isExporting, setIsExporting] = useState(false);
  const { currentVideo } = useStore();

  const handleDone = async () => {
    if (!currentVideo) return;
    
    setIsExporting(true);
    try {
      // Export labeled data and delete video file to save storage
      await exportVideo(currentVideo.id, true);
      
      // Call the onComplete callback (shows thank you modal)
      if (onComplete) {
        onComplete();
      }
    } catch (error) {
      console.error('Export failed:', error);
      alert('Failed to export data. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <button 
      onClick={handleDone} 
      className="done-btn"
      disabled={isExporting}
    >
      {isExporting ? 'Exporting...' : 'Done'}
    </button>
  );
}

export default DoneButton;
