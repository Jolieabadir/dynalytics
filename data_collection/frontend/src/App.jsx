/**
 * Main App component.
 *
 * Boot order matters here. /api/config now requires a bearer token, so the
 * config load has to wait for a session — otherwise a signed-out user 401s and
 * sits on a loading screen with no way forward, which is exactly what the old
 * build did.
 *
 *   no session  → AuthGate
 *   session     → load config → upload or label
 */
import { useCallback, useEffect, useState } from 'react';
import useStore from './store/useStore';
import { getConfig } from './api/client';
import { exportVideo, getExportDownloadUrl } from './api/client';
import { getSession, onAuthChange, signOut } from './api/auth';
import AuthGate from './components/AuthGate';
import VideoUpload from './components/VideoUpload';
import VideoPlayer from './components/VideoPlayer';
import MovesList from './components/MovesList';
import MoveForm from './components/MoveForm';
import TaggingMode from './components/TaggingMode';
import ThankYouModal from './components/ThankYouModal';
import ProgressStrip from './components/ProgressStrip';
import OnboardingBanner, { BANNER_DEFINE } from './components/OnboardingBanner';
import './App.css';

function App() {
  const mode = useStore((s) => s.mode);
  const config = useStore((s) => s.config);
  const setConfig = useStore((s) => s.setConfig);
  const session = useStore((s) => s.session);
  const setSession = useStore((s) => s.setSession);
  const resetForSignOut = useStore((s) => s.resetForSignOut);

  const [authChecked, setAuthChecked] = useState(false);
  const [configError, setConfigError] = useState(null);

  // Read the persisted session once, then follow it.
  useEffect(() => {
    let active = true;

    getSession()
      .then((s) => {
        if (active) {
          setSession(s);
          setAuthChecked(true);
        }
      })
      .catch(() => active && setAuthChecked(true));

    const unsubscribe = onAuthChange((s) => {
      setSession(s);
      setAuthChecked(true);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [setSession]);

  // Config needs the token, so it waits for the session.
  useEffect(() => {
    if (!session) return;
    let active = true;

    getConfig()
      .then((data) => active && setConfig(data))
      .catch((error) => {
        console.error('Failed to load config:', error);
        if (active) {
          setConfigError(
            error.response?.data?.detail ||
              error.message ||
              'Could not load the labeling taxonomy from the server.'
          );
        }
      });

    return () => {
      active = false;
    };
  }, [session, setConfig]);

  const handleSignOut = useCallback(async () => {
    await signOut();
    resetForSignOut();
    setConfig(null);
  }, [resetForSignOut, setConfig]);

  if (!authChecked) {
    return (
      <div className="loading">
        <h2>Loading Dynalytix…</h2>
      </div>
    );
  }

  if (!session) return <AuthGate />;

  if (configError) {
    return (
      <div className="loading">
        <h2>Dynalytix</h2>
        <div className="error-message">
          <p><strong>Could not load configuration.</strong></p>
          <p>{configError}</p>
          <p>Check that the backend is running and reachable.</p>
        </div>
        <button className="btn-secondary" onClick={handleSignOut}>
          Sign out
        </button>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="loading">
        <h2>Loading Dynalytix…</h2>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-titles">
          <h1>Dynalytix</h1>
          <p>Climbing Movement Data Collection</p>
        </div>
        <div className="app-header-account">
          <span className="account-email">{session.user?.email}</span>
          <button type="button" className="signout-btn" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </header>

      {mode === 'define' ? <DefineMode /> : <TaggingMode />}
    </div>
  );
}

/**
 * Define Mode — video on the left, moves list and the labeling panel on the
 * right. The form is a panel rather than a modal so the video and skeleton stay
 * visible and scrubbable while labeling.
 */
function DefineMode() {
  const currentVideo = useStore((s) => s.currentVideo);
  const showMoveForm = useStore((s) => s.showMoveForm);
  const setShowMoveForm = useStore((s) => s.setShowMoveForm);
  const moveStart = useStore((s) => s.moveStart);
  const moveEnd = useStore((s) => s.moveEnd);
  const clearMoveSelection = useStore((s) => s.clearMoveSelection);

  const [showThankYou, setShowThankYou] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [exportError, setExportError] = useState(null);

  if (!currentVideo) {
    return <VideoUpload />;
  }

  /**
   * Finish & Export: run the export, then resolve the presigned download link
   * and show it. A failed link is not a failed export — the labels are saved
   * either way, and the modal says so.
   */
  const handleFinish = async () => {
    setExporting(true);
    setExportError(null);
    setDownloadUrl(null);
    try {
      await exportVideo(currentVideo.id);
      setShowThankYou(true);
      try {
        setDownloadUrl(await getExportDownloadUrl(currentVideo.id));
      } catch (linkErr) {
        console.warn('Export succeeded but the download link failed:', linkErr);
      }
    } catch (err) {
      console.error('Export failed:', err);
      setExportError(
        err.response?.data?.detail || err.message || 'The export request failed.'
      );
      setShowThankYou(true);
    } finally {
      setExporting(false);
    }
  };

  // "Save & Next Move" clears the current selection and reopens the form for
  // the next one; with the form shut it just clears, ready for [ and ].
  const handleSaveAndNext = () => {
    setShowMoveForm(false);
    clearMoveSelection();
  };

  return (
    <div className="define-mode">
      <ProgressStrip
        onSaveAndNext={handleSaveAndNext}
        onFinish={handleFinish}
        busy={exporting}
        canSaveNext={moveStart !== null || moveEnd !== null || showMoveForm}
      />

      <OnboardingBanner id={BANNER_DEFINE} />

      <div className={`main-area ${showMoveForm ? 'with-panel' : ''}`}>
        <VideoPlayer />
        <div className="side-column">
          {showMoveForm ? <MoveForm /> : <MovesList />}
        </div>
      </div>

      <ThankYouModal
        show={showThankYou}
        downloadUrl={downloadUrl}
        exportError={exportError}
        onClose={() => {
          setShowThankYou(false);
          setDownloadUrl(null);
          setExportError(null);
        }}
      />
    </div>
  );
}

export default App;
