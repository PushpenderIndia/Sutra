// @vitest-environment happy-dom
import { businessProfile, icp } from '@sutra/domain';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import messages from '@/messages/en.json';
import { renderUi } from '@/test/render';
import { EditableCard, fieldKind } from './editable-card';
import { StatCards } from './stat-cards';
import { STATUS_TONE } from './status-badge';

afterEach(cleanup);

describe('<StatusBadge>', () => {
  it('has an English label for every status', () => {
    for (const status of Object.keys(STATUS_TONE)) expect(messages.status).toHaveProperty(status);
  });
});

describe('<StatCards>', () => {
  it('toggles a filter', async () => {
    const user = userEvent.setup();
    const picked: (string | null)[] = [];
    const items = [
      { key: 'interested', label: 'Interested', value: 3 },
      { key: 'not_now', label: 'Not now', value: 1 },
    ];
    const { rerender } = renderUi(
      <StatCards items={items} active={null} onSelect={(k) => picked.push(k)} />,
    );
    await user.click(screen.getByRole('button', { name: /Interested/ }));
    rerender(<StatCards items={items} active="interested" onSelect={(k) => picked.push(k)} />);
    const card = screen.getByRole('button', { name: /Interested/ });
    expect(card.getAttribute('aria-pressed')).toBe('true');
    await user.click(card);
    expect(picked).toEqual(['interested', null]);
  });
});

describe('<EditableCard>', () => {
  it('derives editors from the schema', () => {
    expect(fieldKind(businessProfile.shape.oneLiner)).toBe('text');
    expect(fieldKind(businessProfile.shape.name)).toBe('text');
    expect(fieldKind(businessProfile.shape.differentiators)).toBe('list');
    expect(fieldKind(icp.shape.firmographics)).toBeUndefined();
  });

  it('edits inline and saves Zod-validated values', async () => {
    const user = userEvent.setup();
    const saved: unknown[] = [];
    const schema = businessProfile.pick({ toneOfVoice: true, differentiators: true });
    renderUi(
      <EditableCard
        title="Company"
        schema={schema}
        value={{ toneOfVoice: 'Friendly', differentiators: ['Fast'] }}
        labels={{ toneOfVoice: 'Tone', differentiators: 'Differentiators' }}
        onSave={(v) => saved.push(v)}
      >
        <p>view</p>
      </EditableCard>,
    );
    await user.click(screen.getByRole('button', { name: 'Edit Company' }));
    await user.clear(screen.getByLabelText('Tone'));
    await user.type(screen.getByLabelText('Tone'), 'Casual');
    await user.type(screen.getByLabelText('Differentiators'), '{Enter}Green stock{Enter}');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(saved).toEqual([{ toneOfVoice: 'Casual', differentiators: ['Fast', 'Green stock'] }]);
    expect(screen.getByText('view')).toBeTruthy();
  });

  it('is read-only without onSave', () => {
    renderUi(
      <EditableCard
        title="Company"
        schema={businessProfile.pick({ toneOfVoice: true })}
        value={{ toneOfVoice: 'x' }}
      >
        <p>view</p>
      </EditableCard>,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});
