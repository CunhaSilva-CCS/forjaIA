import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export interface DropdownOption {
  value: string;
  label: string;
}

interface DropdownProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[];
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  placeholder?: string;
  emptyMessage?: string;
}

/**
 * Substitui <select> nativo: a lista de opções de um <select> é renderizada pelo sistema
 * operacional, fora do alcance do CSS do app — em várias combinações de SO/navegador ela
 * ignora fonte/cor definidas e aparece grande e fora do tema. Este componente controla
 * gatilho e lista inteiramente, então ambos ficam no mesmo tamanho/tema do resto da UI.
 */
export function Dropdown({
  id,
  value,
  onChange,
  options,
  disabled,
  title,
  ariaLabel,
  placeholder = '—',
  emptyMessage = 'Nenhuma opção.'
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onDocKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocPointerDown);
    document.addEventListener('keydown', onDocKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocPointerDown);
      document.removeEventListener('keydown', onDocKeyDown);
    };
  }, [open]);

  // Destaque inicial da lista é derivado da opção selecionada — calculado no próprio evento
  // que abre o dropdown (clique/teclado), não num effect observando `open` (isso criaria um
  // re-render extra só pra sincronizar estado que já sabemos no momento da abertura).
  const openWithHighlight = () => {
    const idx = options.findIndex((o) => o.value === value);
    setHighlighted(idx >= 0 ? idx : 0);
    setOpen(true);
  };

  const commit = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openWithHighlight();
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (options[highlighted]) commit(options[highlighted].value);
    }
  };

  return (
    <div className="dd" ref={rootRef} data-open={open}>
      <button
        type="button"
        id={id}
        className="dd-trigger"
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (disabled) return;
          if (open) setOpen(false);
          else openWithHighlight();
        }}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="dd-trigger-label">{selected?.label || placeholder}</span>
        <ChevronDown size={14} className="dd-trigger-icon" />
      </button>
      {open && (
        <ul className="dd-list" role="listbox" aria-label={ariaLabel}>
          {options.length === 0 && <li className="dd-empty">{emptyMessage}</li>}
          {options.map((opt, i) => (
            <li
              key={opt.value}
              role="option"
              aria-selected={opt.value === value}
              className={`dd-option ${opt.value === value ? 'selected' : ''} ${i === highlighted ? 'highlighted' : ''}`}
              onMouseEnter={() => setHighlighted(i)}
              onClick={() => commit(opt.value)}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
