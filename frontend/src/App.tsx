import { useState } from 'react';
import { TokenGate } from './components/TokenGate';
import { AppHeader } from './components/AppHeader';
import { OrderPanel } from './components/OrderPanel';
import { PipelinePanel } from './components/PipelinePanel';
import { WorkspaceTabs } from './components/WorkspaceTabs';
import { DeployCard } from './components/DeployCard';
import { TestsCard } from './components/TestsCard';
import { LlmTokensCard } from './components/LlmTokensCard';
import { RulesCard } from './components/RulesCard';
import { FolderBrowserModal } from './components/FolderBrowserModal';
import { getStoredToken } from './config';
import { useForjaApp } from './hooks/useForjaApp';
import './App.css';

export default function App() {
  const [authed, setAuthed] = useState(Boolean(getStoredToken()));
  if (!authed) return <TokenGate onReady={() => setAuthed(true)} />;
  return <Dashboard />;
}

function Dashboard() {
  const s = useForjaApp();

  return (
    <div className="app-container">
      {s.toast && <div className="forge-panel toast">{s.toast}</div>}

      <AppHeader s={s} />

      <div className="dashboard-grid">
        <div className="col-left">
          <OrderPanel s={s} />
          <PipelinePanel s={s} />
        </div>

        <WorkspaceTabs s={s} />

        <div className="col-right">
          <DeployCard s={s} />
          <TestsCard s={s} />
          <LlmTokensCard s={s} />
          <RulesCard s={s} />
        </div>
      </div>

      <FolderBrowserModal s={s} />
    </div>
  );
}
