import { useCallback, useState } from 'react';
import { api } from '../services/api';

/**
 * Estado e ações do modal de navegação/criação de pastas do workspace.
 * Isolado do restante do app: só depende do targetPath atual (para abrir
 * o browser já posicionado) e de showToast (para feedback de criação de pasta).
 */
export function useFolderBrowser(targetPath: string, showToast: (msg: string) => void) {
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const [currentBrowserPath, setCurrentBrowserPath] = useState('.');
  const [parentBrowserPath, setParentBrowserPath] = useState<string | null>(null);
  const [browserDirs, setBrowserDirs] = useState<{ name: string; path: string }[]>([]);
  const [browserError, setBrowserError] = useState<string | null>(null);
  const [browserExists, setBrowserExists] = useState(true);
  const [browserListingPath, setBrowserListingPath] = useState('.');
  const [newFolderName, setNewFolderName] = useState('');
  const [browserLoading, setBrowserLoading] = useState(false);

  const browseTo = useCallback(async (pathString: string) => {
    setBrowserLoading(true);
    setBrowserError(null);
    try {
      const data = await api.browse(pathString || '.');
      setCurrentBrowserPath(data.currentPath);
      setParentBrowserPath(data.parentPath);
      setBrowserDirs(data.directories || []);
      setBrowserExists(data.exists !== false);
      setBrowserListingPath(data.listingPath || data.currentPath);
    } catch (err) {
      setBrowserError(err instanceof Error ? err.message : 'Falha ao listar pasta');
    } finally {
      setBrowserLoading(false);
    }
  }, []);

  const openFolderBrowser = useCallback(() => {
    const start = targetPath?.trim() || '.';
    setShowFolderBrowser(true);
    setNewFolderName('');
    void browseTo(start);
  }, [browseTo, targetPath]);

  const createBrowserFolder = useCallback(async () => {
    const name = newFolderName.trim().replace(/^\/+|\/+$/g, '');
    if (!name) return;
    const base = currentBrowserPath === '.' ? '' : currentBrowserPath;
    const full = base ? `${base}/${name}` : name;
    setBrowserLoading(true);
    setBrowserError(null);
    try {
      const data = await api.mkdir(full);
      setNewFolderName('');
      setCurrentBrowserPath(data.currentPath);
      setParentBrowserPath(data.parentPath);
      setBrowserDirs(data.directories || []);
      setBrowserExists(true);
      setBrowserListingPath(data.currentPath);
      showToast(`Pasta criada: ${data.currentPath}`);
    } catch (err) {
      setBrowserError(err instanceof Error ? err.message : 'Falha ao criar pasta');
    } finally {
      setBrowserLoading(false);
    }
  }, [currentBrowserPath, newFolderName, showToast]);

  return {
    showFolderBrowser,
    setShowFolderBrowser,
    currentBrowserPath,
    setCurrentBrowserPath,
    parentBrowserPath,
    browserDirs,
    browserError,
    browserExists,
    browserListingPath,
    browserLoading,
    newFolderName,
    setNewFolderName,
    browseTo,
    openFolderBrowser,
    createBrowserFolder
  };
}
