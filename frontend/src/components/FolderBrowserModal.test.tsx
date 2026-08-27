import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FolderBrowserModal } from './FolderBrowserModal';
import type { AppState } from '../hooks/useForjaApp';

function makeState(overrides: Partial<AppState> = {}): AppState {
  return {
    showFolderBrowser: true,
    setShowFolderBrowser: vi.fn(),
    workspaceRoot: '/workspace',
    currentBrowserPath: '.',
    parentBrowserPath: null,
    browserDirs: [],
    browserError: null,
    browserExists: true,
    browserListingPath: '.',
    browserLoading: false,
    newFolderName: '',
    setNewFolderName: vi.fn(),
    browseTo: vi.fn(),
    createBrowserFolder: vi.fn(),
    setTargetPath: vi.fn(),
    showToast: vi.fn(),
    ...overrides
  } as unknown as AppState;
}

describe('FolderBrowserModal', () => {
  it('não renderiza nada quando showFolderBrowser é false', () => {
    const { container } = render(<FolderBrowserModal s={makeState({ showFolderBrowser: false })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renderiza como um dialog acessível quando aberto', () => {
    render(<FolderBrowserModal s={makeState()} />);
    const dialog = screen.getByRole('dialog', { name: 'Navegador do workspace' });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('fecha ao pressionar Escape', async () => {
    const setShowFolderBrowser = vi.fn();
    const user = userEvent.setup();
    render(<FolderBrowserModal s={makeState({ setShowFolderBrowser })} />);

    await user.keyboard('{Escape}');
    expect(setShowFolderBrowser).toHaveBeenCalledWith(false);
  });

  it('não fecha ao clicar dentro do painel, mas fecha ao clicar no overlay', async () => {
    const setShowFolderBrowser = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<FolderBrowserModal s={makeState({ setShowFolderBrowser })} />);

    await user.click(screen.getByRole('dialog'));
    expect(setShowFolderBrowser).not.toHaveBeenCalled();

    const overlay = container.querySelector('.modal-overlay');
    expect(overlay).not.toBeNull();
    await user.click(overlay as Element);
    expect(setShowFolderBrowser).toHaveBeenCalledWith(false);
  });

  it('lista as subpastas retornadas e navega ao clicar em uma', async () => {
    const browseTo = vi.fn();
    const user = userEvent.setup();
    render(
      <FolderBrowserModal
        s={makeState({ browserDirs: [{ name: 'projeto-a', path: 'projeto-a' }], browseTo })}
      />
    );

    await user.click(screen.getByRole('button', { name: 'projeto-a/' }));
    expect(browseTo).toHaveBeenCalledWith('projeto-a');
  });

  it('mostra o botão de criar pasta apenas quando a pasta ainda não existe', () => {
    const { rerender } = render(<FolderBrowserModal s={makeState({ browserExists: true })} />);
    expect(screen.queryByRole('button', { name: 'Criar caminho selecionado' })).not.toBeInTheDocument();

    rerender(<FolderBrowserModal s={makeState({ browserExists: false })} />);
    expect(screen.getByRole('button', { name: 'Criar caminho selecionado' })).toBeInTheDocument();
  });
});
