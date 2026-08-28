import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dropdown } from './Dropdown';

const OPTIONS = [
  { value: 'a', label: 'Opção A' },
  { value: 'b', label: 'Opção B' },
  { value: 'c', label: 'Opção C' }
];

describe('Dropdown', () => {
  it('mostra o label da opção selecionada no gatilho, fechado por padrão', () => {
    render(<Dropdown value="b" onChange={() => {}} options={OPTIONS} ariaLabel="Teste" />);
    expect(screen.getByRole('button', { name: 'Teste' })).toHaveTextContent('Opção B');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('mostra o placeholder quando nada está selecionado', () => {
    render(<Dropdown value="" onChange={() => {}} options={OPTIONS} ariaLabel="Teste" placeholder="Escolha…" />);
    expect(screen.getByRole('button', { name: 'Teste' })).toHaveTextContent('Escolha…');
  });

  it('abre a lista ao clicar e fecha ao escolher uma opção', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Dropdown value="a" onChange={onChange} options={OPTIONS} ariaLabel="Teste" />);

    await user.click(screen.getByRole('button', { name: 'Teste' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await user.click(screen.getByRole('option', { name: 'Opção C' }));
    expect(onChange).toHaveBeenCalledWith('c');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('fecha ao clicar fora', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <Dropdown value="a" onChange={() => {}} options={OPTIONS} ariaLabel="Teste" />
        <button type="button">fora</button>
      </div>
    );
    await user.click(screen.getByRole('button', { name: 'Teste' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'fora' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('fecha com Escape', async () => {
    const user = userEvent.setup();
    render(<Dropdown value="a" onChange={() => {}} options={OPTIONS} ariaLabel="Teste" />);
    await user.click(screen.getByRole('button', { name: 'Teste' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('navega com teclado (seta baixo + Enter) e não abre quando desabilitado', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Dropdown value="a" onChange={onChange} options={OPTIONS} ariaLabel="Teste" />);

    const trigger = screen.getByRole('button', { name: 'Teste' });
    trigger.focus();
    await user.keyboard('{ArrowDown}'); // abre, destaca "a" (já selecionada)
    await user.keyboard('{ArrowDown}'); // destaca "b"
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('não abre quando desabilitado', async () => {
    const user = userEvent.setup();
    render(<Dropdown value="a" onChange={() => {}} options={OPTIONS} ariaLabel="Teste" disabled />);
    expect(screen.getByRole('button', { name: 'Teste' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Teste' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('mostra a mensagem de vazio quando não há opções', async () => {
    const user = userEvent.setup();
    render(<Dropdown value="" onChange={() => {}} options={[]} ariaLabel="Teste" emptyMessage="Nada aqui." />);
    await user.click(screen.getByRole('button', { name: 'Teste' }));
    expect(screen.getByText('Nada aqui.')).toBeInTheDocument();
  });
});
