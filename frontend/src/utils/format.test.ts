import { describe, it, expect } from 'vitest';
import { formatDate } from './format';

describe('formatDate', () => {
  it('formata uma data ISO válida como dd/mm, hh:mm', () => {
    expect(formatDate('2026-08-27T14:21:11.952Z')).toMatch(/^\d{2}\/\d{2}, \d{2}:\d{2}$/);
  });

  it('retorna um traço para valores ausentes', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('')).toBe('—');
  });

  it('devolve o valor bruto se não for uma data válida', () => {
    expect(formatDate('não-é-uma-data')).toBe('não-é-uma-data');
  });
});
