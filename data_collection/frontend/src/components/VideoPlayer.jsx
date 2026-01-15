/**
 * VideoPlayer component.
 * 
 * Plays video with frame-accurate scrubbing.
 * Allows marking move boundaries with [ and ] keys.
 */
import { useRef, useEffect, useState } from 'react';
import useStore from '../store/useStore';

function VideoPlayer() {
  const videoRef = useRef(null);
  const [duration, setDuration] = useState(0);
  
  const {
    currentVideo,
    currentFrame,
    isPlaying,
    moveStart,
    moveEnd,
    setCurrentFrame,
    setIsPlaying,
    setMoveStart,
    setMoveEnd,
    setShowMoveForm,
    clearMoveSelection,
  } = useStore();

  const fps = currentVideo?.fps || 30;

  // Update current frame as video plays
  useEffect(() => {
    if (!videoRef.current) return;

    const updateFrame = () => {
      const frame = Math.floor(videoRef.current.currentTime * fps);
      setCurrentFrame(frame);
    };

    const video = videoRef.current;
    video.addEventListener('timeupdate', updateFrame);
    
    return () => video.removeEventListener('timeupdate', updateFrame);
  }, [fps, setCurrentFrame]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e) => {
      // Ignore if typing in input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          seekToFrame(currentFrame - 1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          seekToFrame(currentFrame + 1);
          break;
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case '[':
          e.preventDefault();
          setMoveStart(currentFrame);
          break;
        case ']':
          e.preventDefault();
          setMoveEnd(currentFrame);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [currentFrame, moveStart]);

  const seekToFrame = (frame) => {
    if (!videoRef.current) return;
    const time = frame / fps;
    videoRef.current.currentTime = time;
    setCurrentFrame(frame);
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  const handleCreateMove = () => {
    if (moveStart !== null && moveEnd !== null) {
      setShowMoveForm(true);
    }
  };

  if (!currentVideo) return null;

  return (
    <div className="video-player">
      <div className="video-container">
        <video
          ref={videoRef}
          src={`http://localhost:8000/videos/${currentVideo.filename}`}
          onLoadedMetadata={handleLoadedMetadata}
        />
      </div>

      <div className="video-controls">
        <button onClick={() => seekToFrame(currentFrame - 10)}>⏮ -10</button>
        <button onClick={() => seekToFrame(currentFrame - 1)}>◀</button>
        <button onClick={togglePlay}>{isPlaying ? '⏸' : '▶'}</button>
        <button onClick={() => seekToFrame(currentFrame + 1)}>▶▶</button>
        <button onClick={() => seekToFrame(currentFrame + 10)}>+10 ⏭</button>

        <div className="frame-info">
          Frame: {currentFrame} / {currentVideo.total_frames}
          {' '}({(currentFrame / fps).toFixed(2)}s)
        </div>
      </div>

      <div className="timeline">
        <input
          type="range"
          min="0"
          max={currentVideo.total_frames}
          value={currentFrame}
          onChange={(e) => seekToFrame(parseInt(e.target.value))}
          className="timeline-slider"
        />
        {moveStart !== null && (
          <div 
            className="move-marker start"
            style={{ left: `${(moveStart / currentVideo.total_frames) * 100}%` }}
          />
        )}
        {moveEnd !== null && (
          <div 
            className="move-marker end"
            style={{ left: `${(moveEnd / currentVideo.total_frames) * 100}%` }}
          />
        )}
      </div>

      <div className="move-selection-controls">
        <button 
          onClick={() => setMoveStart(currentFrame)}
          className={moveStart !== null ? 'active' : ''}
        >
          [ Mark Start
        </button>
        <button 
          onClick={() => setMoveEnd(currentFrame)}
          disabled={moveStart === null}
        >
          ] Mark End
        </button>
        
        {moveStart !== null && moveEnd !== null && (
          <>
            <span className="selection-info">
              Selected: {moveStart} - {moveEnd} ({moveEnd - moveStart} frames)
            </span>
            <button 
              onClick={handleCreateMove}
              className="create-move-btn"
            >
              Create Move
            </button>
            <button 
              onClick={clearMoveSelection}
              className="clear-selection-btn"
            >
              Clear Selection
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default VideoPlayer;
