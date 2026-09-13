/**
 * The auth gate: the app must not be reachable without a session, and the
 * screen that stands in its place has to actually sign people in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock the auth module: these tests must never reach a real Supabase project.
vi.mock('../api/auth', () => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  isAuthConfigured: vi.fn(() => true),
  getSession: vi.fn(async () => null),
  onAuthChange: vi.fn(() => () => {}),
}));

import AuthGate from './AuthGate';
import { signIn, signUp, isAuthConfigured } from '../api/auth';

beforeEach(() => {
  vi.mocked(isAuthConfigured).mockReturnValue(true);
  vi.mocked(signIn).mockResolvedValue({ access_token: 'tok' });
  vi.mocked(signUp).mockResolvedValue({ session: null, needsConfirmation: false });
});

describe('AuthGate', () => {
  it('shows the sign-in form by default', () => {
    render(<AuthGate />);
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('signs in with the email and password entered', async () => {
    const user = userEvent.setup();
    render(<AuthGate />);

    await user.type(screen.getByLabelText('Email'), 'labeler@dynalytix.test');
    await user.type(screen.getByLabelText('Password'), 'hunter2hunter2');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() =>
      expect(signIn).toHaveBeenCalledWith('labeler@dynalytix.test', 'hunter2hunter2')
    );
  });

  it('switches to sign-up and creates an account', async () => {
    const user = userEvent.setup();
    render(<AuthGate />);

    await user.click(screen.getByRole('tab', { name: 'Sign up' }));
    await user.type(screen.getByLabelText('Email'), 'new@dynalytix.test');
    await user.type(screen.getByLabelText('Password'), 'hunter2hunter2');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() =>
      expect(signUp).toHaveBeenCalledWith('new@dynalytix.test', 'hunter2hunter2')
    );
  });

  it('refuses to submit with an empty field, without calling the API', async () => {
    const user = userEvent.setup();
    render(<AuthGate />);

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByText('Enter both an email address and a password.')
    ).toBeInTheDocument();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('rejects a too-short password on sign-up before calling the API', async () => {
    const user = userEvent.setup();
    render(<AuthGate />);

    await user.click(screen.getByRole('tab', { name: 'Sign up' }));
    await user.type(screen.getByLabelText('Email'), 'new@dynalytix.test');
    await user.type(screen.getByLabelText('Password'), 'abc');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(
      await screen.findByText('Choose a password of at least 6 characters.')
    ).toBeInTheDocument();
    expect(signUp).not.toHaveBeenCalled();
  });

  it('surfaces the error message from a failed sign-in', async () => {
    vi.mocked(signIn).mockRejectedValue(
      new Error('That email and password combination was not recognised.')
    );
    const user = userEvent.setup();
    render(<AuthGate />);

    await user.type(screen.getByLabelText('Email'), 'a@b.test');
    await user.type(screen.getByLabelText('Password'), 'wrongpassword');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByText('That email and password combination was not recognised.')
    ).toBeInTheDocument();
  });

  it('tells the user when sign-up needs email confirmation', async () => {
    vi.mocked(signUp).mockResolvedValue({ session: null, needsConfirmation: true });
    const user = userEvent.setup();
    render(<AuthGate />);

    await user.click(screen.getByRole('tab', { name: 'Sign up' }));
    await user.type(screen.getByLabelText('Email'), 'new@dynalytix.test');
    await user.type(screen.getByLabelText('Password'), 'hunter2hunter2');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(
      await screen.findByText(/Check your email for a confirmation link/i)
    ).toBeInTheDocument();
  });

  it('says so, and disables the form, when auth is not configured in the build', () => {
    vi.mocked(isAuthConfigured).mockReturnValue(false);
    render(<AuthGate />);

    expect(screen.getByText(/Sign-in is not configured in this build/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  });
});
