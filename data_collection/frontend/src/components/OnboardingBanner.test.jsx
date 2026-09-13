/**
 * Onboarding banners: correct copy per mode, dismissible, and the dismissal
 * lives only for the session — never in localStorage.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OnboardingBanner, { BANNER_DEFINE, BANNER_TAGGING } from './OnboardingBanner';
import useStore from '../store/useStore';

beforeEach(() => {
  useStore.setState({ dismissedBanners: {} });
  window.localStorage.clear();
});

describe('OnboardingBanner', () => {
  it('shows the define-mode instruction', () => {
    render(<OnboardingBanner id={BANNER_DEFINE} />);
    expect(
      screen.getByText('Set the start frame with [, the end frame with ], then Create Move.')
    ).toBeInTheDocument();
  });

  it('shows the tagging-mode instruction', () => {
    render(<OnboardingBanner id={BANNER_TAGGING} />);
    expect(
      screen.getByText('Use the scroll bar to find the frame, then tag it.')
    ).toBeInTheDocument();
  });

  it('disappears when dismissed', async () => {
    const user = userEvent.setup();
    render(<OnboardingBanner id={BANNER_DEFINE} />);

    await user.click(screen.getByRole('button', { name: /dismiss this tip/i }));

    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(useStore.getState().dismissedBanners[BANNER_DEFINE]).toBe(true);
  });

  it('stays dismissed across a remount within the session', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<OnboardingBanner id={BANNER_DEFINE} />);
    await user.click(screen.getByRole('button', { name: /dismiss this tip/i }));
    unmount();

    render(<OnboardingBanner id={BANNER_DEFINE} />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('dismissing one banner leaves the other showing', async () => {
    const user = userEvent.setup();
    render(
      <>
        <OnboardingBanner id={BANNER_DEFINE} />
        <OnboardingBanner id={BANNER_TAGGING} />
      </>
    );
    expect(screen.getAllByRole('note')).toHaveLength(2);

    await user.click(screen.getAllByRole('button', { name: /dismiss this tip/i })[0]);

    expect(screen.getAllByRole('note')).toHaveLength(1);
    expect(
      screen.getByText('Use the scroll bar to find the frame, then tag it.')
    ).toBeInTheDocument();
  });

  it('writes nothing to localStorage — dismissal is session-only', async () => {
    const user = userEvent.setup();
    render(<OnboardingBanner id={BANNER_DEFINE} />);
    await user.click(screen.getByRole('button', { name: /dismiss this tip/i }));

    expect(window.localStorage.length).toBe(0);
  });

  it('renders nothing for an unknown banner id', () => {
    const { container } = render(<OnboardingBanner id="not-a-banner" />);
    expect(container).toBeEmptyDOMElement();
  });
});
