import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TeamTab } from './TeamTab';
import type { AppState } from '../../hooks/useForjaApp';
import type { TeamMember } from '../../types/agent';

function makeMember(overrides: Partial<TeamMember> = {}): TeamMember {
  return { id: 'm1', name: 'Alice', role: 'qa', tokenHint: 'abcd…wxyz', active: true, ...overrides };
}

function makeState(overrides: Partial<AppState> = {}): AppState {
  return {
    teamMe: { id: 'admin', name: 'Admin', role: 'admin', isAdmin: true },
    teamInfo: { admin: { id: 'admin', name: 'Admin', role: 'admin', tokenHint: '—' }, members: [], bootstrapTokens: null, stageRoles: {} },
    teamBoard: { queued: [], awaiting: [], recent: [] },
    serviceStatus: null,
    refreshTeamBoard: vi.fn(),
    refreshTeamInfo: vi.fn(),
    createTeamMember: vi.fn().mockResolvedValue(undefined),
    deactivateTeamMember: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as unknown as AppState;
}

describe('TeamTab', () => {
  it('membro não-admin não vê o formulário de novo membro nem o botão Desativar', () => {
    const state = makeState({
      teamMe: { id: 'm1', name: 'Bob', role: 'qa', isAdmin: false },
      teamInfo: {
        admin: { id: 'admin', name: 'Admin', role: 'admin', tokenHint: '—' },
        members: [makeMember()],
        bootstrapTokens: null,
        stageRoles: {}
      }
    });
    render(<TeamTab s={state} />);
    expect(screen.queryByText('Novo membro')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desativar' })).not.toBeInTheDocument();
    expect(screen.getByText('Alice', { exact: false })).toBeInTheDocument();
  });

  it('achado real: admin vê o formulário e cria um membro chamando createTeamMember com os campos certos', async () => {
    const createTeamMember = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<TeamTab s={makeState({ createTeamMember })} />);

    await user.type(screen.getByPlaceholderText('Nome'), 'Carla');
    await user.selectOptions(screen.getByRole('combobox'), 'sre');
    await user.click(screen.getByRole('button', { name: 'Criar membro' }));

    expect(createTeamMember).toHaveBeenCalledTimes(1);
    const call = createTeamMember.mock.calls[0][0];
    expect(call.name).toBe('Carla');
    expect(call.role).toBe('sre');
    expect(typeof call.token).toBe('string');
    expect(call.token.length).toBeGreaterThan(0);
  });

  it('botão Criar membro fica desabilitado sem nome preenchido', () => {
    render(<TeamTab s={makeState()} />);
    expect(screen.getByRole('button', { name: 'Criar membro' })).toBeDisabled();
  });

  it('achado real: admin desativa um membro existente pelo id certo', async () => {
    const deactivateTeamMember = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    const state = makeState({
      deactivateTeamMember,
      teamInfo: {
        admin: { id: 'admin', name: 'Admin', role: 'admin', tokenHint: '—' },
        members: [makeMember({ id: 'member-42', name: 'Duda' })],
        bootstrapTokens: null,
        stageRoles: {}
      }
    });
    render(<TeamTab s={state} />);

    await user.click(screen.getByRole('button', { name: 'Desativar' }));
    expect(deactivateTeamMember).toHaveBeenCalledWith('member-42', 'Duda');
  });

  it('botão Gerar troca o token sugerido no formulário', async () => {
    const user = userEvent.setup();
    render(<TeamTab s={makeState()} />);
    const gerarButton = screen.getByRole('button', { name: 'Gerar' });
    const tokenInput = gerarButton.previousElementSibling as HTMLInputElement;
    const before = tokenInput.value;
    await user.click(gerarButton);
    expect(tokenInput.value).not.toBe(before);
  });

  it('mostra a fila e os gates de aprovação vindos de teamBoard', () => {
    const state = makeState({
      teamBoard: {
        queued: [{ id: 'r1', queue_position: 1, owner_name: 'Alice', prompt: 'construir X' }],
        awaiting: [{ id: 'r2', owner_name: 'Bob', prompt: 'y', config: { pendingNextStage: 'healer' } }],
        recent: []
      }
    });
    render(<TeamTab s={state} />);
    expect(screen.getByText(/#1 Alice/)).toBeInTheDocument();
    expect(screen.getByText(/Bob.*healer/)).toBeInTheDocument();
  });
});
