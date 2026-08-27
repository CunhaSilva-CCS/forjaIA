import { describe, it, expect } from 'vitest';
import { lineDiff } from './diff';

describe('lineDiff', () => {
  it('marca todas as linhas como iguais quando o conteúdo não muda', () => {
    const rows = lineDiff('a\nb\nc', 'a\nb\nc');
    expect(rows).toEqual([
      { type: 'same', text: 'a' },
      { type: 'same', text: 'b' },
      { type: 'same', text: 'c' }
    ]);
  });

  it('marca linha removida e adicionada quando o conteúdo muda', () => {
    const rows = lineDiff('a\nb', 'a\nc');
    expect(rows).toEqual([
      { type: 'same', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'add', text: 'c' }
    ]);
  });

  it('marca apenas adição quando o depois tem mais linhas', () => {
    const rows = lineDiff('a', 'a\nb');
    expect(rows).toEqual([
      { type: 'same', text: 'a' },
      { type: 'add', text: 'b' }
    ]);
  });

  it('marca apenas remoção quando o depois tem menos linhas', () => {
    const rows = lineDiff('a\nb', 'a');
    expect(rows).toEqual([
      { type: 'same', text: 'a' },
      { type: 'del', text: 'b' }
    ]);
  });

  it('lida com strings vazias/undefined sem lançar', () => {
    expect(lineDiff('', '')).toEqual([{ type: 'same', text: '' }]);
    expect(lineDiff(undefined as unknown as string, undefined as unknown as string)).toEqual([
      { type: 'same', text: '' }
    ]);
  });
});
