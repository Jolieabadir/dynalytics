/**
 * MoveForm: the four hold slots, their per-slot hold type and quality, the
 * definitions behind each "i", and that it renders as a panel rather than a
 * modal that would cover the video.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api/client', () => ({
  createMove: vi.fn(),
  createEnvironment: vi.fn(),
  createOutcome: vi.fn(),
  deleteMove: vi.fn(),
}));

import MoveForm from './MoveForm';
import useStore from '../store/useStore';

/** A config shaped like the real /api/config, definitions included. */
const CONFIG = {
  approaches: ['static', 'dynamic', 'coordination'],
  sizes: ['small', 'medium', 'large'],
  move_tags: ['dyno', 'no_hands', 'no_feet_on', 'tension'],
  wall_angles: ['slab', 'vertical', 'steep'],
  hold_types: ['jug', 'pinch', 'gaston'],
  hold_qualities: ['incut', 'sloped', 'small'],
  hold_slots: ['start_left', 'start_right', 'end', 'foot'],
  hold_sources: ['detected', 'manual'],
  results: ['success', 'fall'],
  reach_details: ['reached_controlled', 'reached_not_controlled', 'didnt_reach'],
  confidence_levels: ['low', 'med', 'high'],
  tag_types: { pumped: 'Pumped' },
  body_parts: ['left_wrist'],
  sides: ['left', 'right'],
  definitions: {
    hold_slots: {
      start_left: { description: 'The hold the left hand is on when the move begins.' },
      start_right: { description: 'The hold the right hand is on when the move begins.' },
      end: { description: 'The hold the climber is moving to.' },
      foot: { description: 'The main foothold the move is driven from.' },
    },
    hold_types: {
      jug: { description: 'A big, obvious hold the whole hand fits into.' },
      pinch: { description: 'Squeezed between the thumb and the fingers.' },
      gaston: { description: 'Pulled outward with the thumb down.' },
    },
    hold_qualities: {
      incut: { description: 'Curves back in, giving a positive lip.' },
      sloped: { description: 'Rounds away with no positive edge.' },
      small: { description: 'Little room for the fingers.' },
    },
    reach_details: {
      reached_controlled: {
        display_label: 'Reached it — in control',
        description: 'Got the hold and was immediately stable.',
      },
      reached_not_controlled: {
        display_label: 'Reached it — not in control',
        description: 'Caught it but was off balance.',
      },
      didnt_reach: {
        display_label: 'Did not reach it',
        description: 'Never made contact.',
      },
    },
    confidence_levels: {
      low: { description: 'You are unsure about the labels you just gave.' },
      med: { description: 'Reasonably sure.' },
      high: { description: 'Confident the labels describe what happened.' },
    },
  },
};

const SLOTS = ['start_left', 'start_right', 'end', 'foot'];

beforeEach(() => {
  useStore.setState({
    config: CONFIG,
    currentVideo: { id: 1, fps: 30, total_frames: 900, width: 1000, height: 1000 },
    moveStart: 100,
    moveEnd: 150,
    showMoveForm: true,
    holds: [],
    csvData: [],
    holdPickSlot: null,
    previousEnvironment: {
      wall_angle: '',
      start_left: { hold_id: null, hold_type: '', hold_quality: [] },
      start_right: { hold_id: null, hold_type: '', hold_quality: [] },
      end: { hold_id: null, hold_type: '', hold_quality: [] },
      foot: { hold_id: null, hold_type: '', hold_quality: [] },
    },
  });
});

describe('MoveForm — three-hold model', () => {
  it('renders all four hold slots', () => {
    render(<MoveForm />);
    for (const slot of SLOTS) {
      expect(screen.getByTestId(`hold-slot-${slot}`)).toBeInTheDocument();
    }
  });

  it('names the three required slots and marks foot optional', () => {
    render(<MoveForm />);
    expect(screen.getByText('Start Left')).toBeInTheDocument();
    expect(screen.getByText('Start Right')).toBeInTheDocument();
    expect(screen.getByText('End')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('hold-slot-foot')).getByText('(optional)')
    ).toBeInTheDocument();
  });

  it('gives every slot its own hold type and hold quality controls', () => {
    render(<MoveForm />);
    for (const slot of SLOTS) {
      const fieldset = screen.getByTestId(`hold-slot-${slot}`);
      // One radio per hold type, one checkbox per quality, scoped to this slot.
      expect(within(fieldset).getAllByRole('radio')).toHaveLength(CONFIG.hold_types.length);
      expect(within(fieldset).getAllByRole('checkbox')).toHaveLength(
        CONFIG.hold_qualities.length
      );
    }
  });

  it('keeps each slot independent', async () => {
    const user = userEvent.setup();
    render(<MoveForm />);

    const left = screen.getByTestId('hold-slot-start_left');
    const right = screen.getByTestId('hold-slot-start_right');

    await user.click(within(left).getByRole('radio', { name: /Jug/ }));

    expect(within(left).getByRole('radio', { name: /Jug/ })).toBeChecked();
    expect(within(right).getByRole('radio', { name: /Jug/ })).not.toBeChecked();
  });

  it('allows several qualities on one slot', async () => {
    const user = userEvent.setup();
    render(<MoveForm />);
    const left = screen.getByTestId('hold-slot-start_left');

    await user.click(within(left).getByRole('checkbox', { name: /Incut/ }));
    await user.click(within(left).getByRole('checkbox', { name: /Small/ }));

    expect(within(left).getByRole('checkbox', { name: /Incut/ })).toBeChecked();
    expect(within(left).getByRole('checkbox', { name: /Small/ })).toBeChecked();
    expect(within(left).getByRole('checkbox', { name: /Sloped/ })).not.toBeChecked();
  });

  it('gives every slot a "pick on video" control', () => {
    render(<MoveForm />);
    for (const slot of SLOTS) {
      expect(
        within(screen.getByTestId(`hold-slot-${slot}`)).getByRole('button', {
          name: 'Pick on video',
        })
      ).toBeInTheDocument();
    }
  });

  it('entering pick mode records which slot is asking', async () => {
    const user = userEvent.setup();
    render(<MoveForm />);

    const end = screen.getByTestId('hold-slot-end');
    await user.click(within(end).getByRole('button', { name: 'Pick on video' }));

    expect(useStore.getState().holdPickSlot).toMatchObject({ slot: 'end' });
  });

  it('hides the hand slots when the move is tagged No Hands', async () => {
    const user = userEvent.setup();
    render(<MoveForm />);

    await user.click(screen.getByRole('button', { name: 'No Hands' }));

    expect(screen.queryByTestId('hold-slot-start_left')).not.toBeInTheDocument();
    expect(screen.queryByTestId('hold-slot-start_right')).not.toBeInTheDocument();
    expect(screen.queryByTestId('hold-slot-end')).not.toBeInTheDocument();
    // Feet are still on the wall.
    expect(screen.getByTestId('hold-slot-foot')).toBeInTheDocument();
  });

  it('blocks save until the three required slots have a hold type', async () => {
    const user = userEvent.setup();
    render(<MoveForm />);

    await user.click(screen.getByRole('radio', { name: /Slab/ }));
    await user.click(screen.getByRole('button', { name: 'Save Move' }));

    expect(await screen.findByText(/Please choose a hold type for/)).toBeInTheDocument();
  });
});

describe('MoveForm — definitions and wording', () => {
  it('puts an "i" next to every hold type option in a slot', () => {
    render(<MoveForm />);
    const left = screen.getByTestId('hold-slot-start_left');
    const tips = within(left).getAllByRole('button', { name: /What does this mean\?/ });
    // hold types + hold qualities + the slot legend itself
    expect(tips.length).toBeGreaterThanOrEqual(
      CONFIG.hold_types.length + CONFIG.hold_qualities.length
    );
  });

  it('reveals the definition when the "i" is activated', async () => {
    const user = userEvent.setup();
    render(<MoveForm />);
    const left = screen.getByTestId('hold-slot-start_left');

    await user.click(
      within(left).getByRole('button', {
        name: /A big, obvious hold the whole hand fits into/,
      })
    );

    expect(
      within(left).getByRole('tooltip')
    ).toHaveTextContent('A big, obvious hold the whole hand fits into.');
  });

  it('uses display_label for reach outcomes, not the raw enum value', () => {
    render(<MoveForm />);
    expect(screen.getByRole('radio', { name: /Reached it — not in control/ })).toBeInTheDocument();
    // The formatted raw value must not leak through.
    expect(screen.queryByText('Reached Not Controlled')).not.toBeInTheDocument();
  });

  it('says confidence is the labeler’s, not the climber’s', () => {
    render(<MoveForm />);
    expect(
      screen.getByRole('button', { name: /How confident you are in the labels you just gave/ })
    ).toBeInTheDocument();
  });

  it('says size means the size of the movement', () => {
    render(<MoveForm />);
    expect(
      screen.getByRole('button', { name: /How big the movement is/ })
    ).toBeInTheDocument();
  });
});

describe('MoveForm — layout', () => {
  it('is a side panel, not a full-screen modal over the video', () => {
    render(<MoveForm />);
    const panel = screen.getByTestId('move-form-panel');
    expect(panel.tagName).toBe('ASIDE');
    // The old modal wrapper must be gone, or it would cover the player.
    expect(document.querySelector('.move-form-overlay')).toBeNull();
  });
});
