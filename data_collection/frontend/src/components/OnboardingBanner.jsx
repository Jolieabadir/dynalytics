/**
 * OnboardingBanner — the one-line "here is how this screen works" strip.
 *
 * Dismissal lives in the store and is session-only, deliberately: no
 * localStorage. A labeler who reloads has lost their video anyway, and a
 * returning reminder costs one click.
 */
import useStore from '../store/useStore';

export const BANNER_DEFINE = 'define';
export const BANNER_TAGGING = 'tagging';

const BANNER_TEXT = {
  [BANNER_DEFINE]:
    'Set the start frame with [, the end frame with ], then Create Move.',
  [BANNER_TAGGING]: 'Use the scroll bar to find the frame, then tag it.',
};

function OnboardingBanner({ id }) {
  const dismissedBanners = useStore((s) => s.dismissedBanners);
  const dismissBanner = useStore((s) => s.dismissBanner);

  const text = BANNER_TEXT[id];
  if (!text || dismissedBanners[id]) return null;

  return (
    <div className="onboarding-banner" role="note">
      <span className="onboarding-text">{text}</span>
      <button
        type="button"
        className="onboarding-dismiss"
        aria-label="Dismiss this tip"
        onClick={() => dismissBanner(id)}
      >
        ✕
      </button>
    </div>
  );
}

export default OnboardingBanner;
