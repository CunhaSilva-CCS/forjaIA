import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SecurityTab } from './SecurityTab';
import type { AppState } from '../../hooks/useForjaApp';
import type { SecurityIssue } from '../../types/agent';

function makeState(securityIssues: SecurityIssue[]): AppState {
  return { securityIssues } as unknown as AppState;
}

describe('SecurityTab', () => {
  it('mostra mensagem de vazio quando não há achados', () => {
    render(<SecurityTab s={makeState([])} />);
    expect(screen.getByText('Nenhum problema ainda.')).toBeInTheDocument();
  });

  it('lista os achados de segurança com severidade e remediação', () => {
    const issues: SecurityIssue[] = [
      {
        id: 's1',
        title: 'SQL Injection',
        severity: 'HIGH',
        description: 'Query concatena input do usuário sem parametrizar',
        remediation: 'Usar prepared statements'
      },
      {
        id: 's2',
        title: 'Header ausente',
        severity: 'LOW',
        description: 'Sem X-Content-Type-Options',
        remediation: 'Adicionar helmet'
      }
    ];
    render(<SecurityTab s={makeState(issues)} />);

    expect(screen.getByText('SQL Injection')).toBeInTheDocument();
    expect(screen.getByText('HIGH')).toBeInTheDocument();
    expect(screen.getByText('Usar prepared statements')).toBeInTheDocument();
    expect(screen.getByText('Header ausente')).toBeInTheDocument();
    expect(screen.queryByText('Nenhum problema ainda.')).not.toBeInTheDocument();
  });
});
