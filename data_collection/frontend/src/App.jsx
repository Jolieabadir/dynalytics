/**
 * Main App component.
 * 
 * Routes between two main views:
 * 1. Define mode - Create moves, mark boundaries
 * 2. Tagging mode - Add frame tags within a move
 */
import { useEffect, useState } from 'react';
import useStore from './store/useStore';
import { getConfig } from './api/client';
import VideoUpload from './components/VideoUpload';
import VideoPlayer from './components/VideoPlayer';
import MovesList from './components/MovesList';
import MoveForm from './components/MoveForm';
import TaggingMode from './components/TaggingMode';
import ThankYouModal from './components/ThankYouModal';
import DoneButton from './components/DoneButton';
import './App.css';

function App() {
  const { mode, config, setConfig, currentVideo } = useStore();

  // Load configuration on mount
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const configData = await getConfig();
        setConfig(configData);
      } catch (error) {
        console.error('Failed to load config:', error);
      }
    };
    loadConfig();
  }, [setConfig]);

  if (!config) {
    return (
      <div className="loading">
        <h2>Loading Dynalytics...</h2>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Dynalytics</h1>
        <p>Climbing Movement Data Collection</p>
      </header>

      {mode === 'define' ? (
        <DefineMode />
      ) : (
        <TaggingMode />
      )}
    </div>
  );
}

/**
 * Define Mode - Main view for creating moves
 */
function DefineMode() {
  const { currentVideo } = useStore();
  const [showThankYou, setShowThankYou] = useState(false);

  if (!currentVideo) {
    return <VideoUpload />;
  }

  return (
    <div className="define-mode">
      <div className="define-header">
        <DoneButton onClick={() => setShowThankYou(true)} />
      </div>
      <div className="main-area">
        <VideoPlayer />
        <MovesList />
      </div>
      <MoveForm />
      <ThankYouModal show={showThankYou} onClose={() => setShowThankYou(false)} />
    </div>
  );
}

export default App;
