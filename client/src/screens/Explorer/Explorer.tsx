import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RootResponse } from '@slydr/shared';
import { getRoot } from '../../api/client';
import { useAppActions, useAppState, useExplorerRestore } from '../../state/AppStateProvider';
import { Skeleton } from '../../components';
import { EntryList } from './EntryList';
import { EntryGrid } from './EntryGrid';
import gridStyles from './EntryGrid.module.css';
import { ExplorerFooter } from './ExplorerFooter';
import { ExplorerHeader } from './ExplorerHeader';
import { ExplorerNotices } from './ExplorerNotices';
import { ExplorerScrollContext } from './ExplorerScrollContext';
import { useDirectoryListing } from './useDirectoryListing';
import { useEntryHighlight } from './useEntryHighlight';
import { useVirtualizationMode } from './virtualization';
import { VirtualEntryList } from './VirtualEntryList';
import { VirtualEntryGrid } from './VirtualEntryGrid';
import { EXPLORER_HEADING, EMPTY_FOLDER, HIDDEN_EMPTY } from './copy';
import styles from './Explorer.module.css';

let rootPromise: Promise<RootResponse> | null = null;
function cachedRoot(): Promise<RootResponse> {
  if (!rootPromise) {
    rootPromise = getRoot();
    rootPromise.catch(() => {
      rootPromise = null;
    });
  }
  return rootPromise;
}
function errorText(code: string): string {
  const messages: Record<string, string> = {
    ACCESS_DENIED: 'You do not have permission to read this folder.',
    READ_FAILED: 'This folder could not be read.',
    NOT_FOUND: 'That folder no longer exists.',
    NOT_A_DIRECTORY: 'That item is not a folder.',
    OUTSIDE_ROOT: 'That folder is outside your home folder.',
  };
  return messages[code] ?? 'Something went wrong while reading this folder.';
}
export function Explorer() {
  const state = useAppState();
  const actions = useAppActions();
  const restore = useExplorerRestore();
  const [root, setRoot] = useState<RootResponse | null>(null);
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const [restoreNotice, setRestoreNotice] = useState(false);
  const previousPath = useRef<string | null>(null);
  const listing = useDirectoryListing(state.explorer.path, state.explorer.showHidden);
  const highlight = useEntryHighlight(
    listing.data?.entries ?? [],
    listing.navigate,
    listing.data?.parentPath ?? null,
  );
  const { error, requestedPath, fallbackToRoot } = listing;
  const loadedPath = listing.data?.path;
  const virtual = useVirtualizationMode(
    listing.data?.path ?? state.explorer.path,
    listing.data?.entries.length ?? 0,
  );
  const restoredPath = restore.restoredPath;
  useEffect(() => {
    cachedRoot()
      .then(setRoot)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (
      !error ||
      restoredPath === null ||
      (requestedPath !== restoredPath && loadedPath !== restoredPath)
    )
      return;
    setRestoreNotice(true);
    restore.markRestoreResolved();
    fallbackToRoot();
  }, [error, requestedPath, loadedPath, fallbackToRoot, restore, restoredPath]);
  useEffect(() => {
    if (listing.data) {
      if (listing.data.path !== state.explorer.path) actions.navigateExplorer(listing.data.path);
      if (restoredPath !== null && listing.data.path === restoredPath)
        restore.markRestoreResolved();
    }
  }, [listing.data, state.explorer.path, actions, restore, restoredPath]);
  useLayoutEffect(() => {
    const path = listing.data?.path;
    if (
      path !== undefined &&
      previousPath.current !== null &&
      path !== previousPath.current &&
      scrollEl
    )
      scrollEl.scrollTop = 0;
    if (path !== undefined) previousPath.current = path;
  }, [listing.data?.path, scrollEl]);
  const folderName =
    listing.data?.name || (listing.data?.path === '' ? root?.name : undefined) || '';
  const empty = listing.data?.entries.length === 0 && !listing.loading && !listing.error;
  const restoreDismiss = () => setRestoreNotice(false);
  const renderBody = () => {
    if (!listing.data && listing.loading && state.explorer.viewMode === 'grid')
      return (
        <div className={gridStyles.grid} role="grid" aria-busy="true" aria-label="Folder contents">
          {Array.from({ length: 24 }, (_, i) => (
            <div className={gridStyles.skeletonTile} role="gridcell" key={i}>
              <Skeleton className={gridStyles.skeletonMedia} />
              <Skeleton className={gridStyles.skeletonName} />
            </div>
          ))}
        </div>
      );
    if (!listing.data && listing.loading)
      return (
        <div className={styles.skeletons} role="listbox" aria-busy="true">
          {Array.from({ length: 12 }, (_, i) => (
            <div className={styles.skeletonRow} key={i}>
              <Skeleton className={styles.skeletonIcon} width="22px" height="22px" />
              <Skeleton className={styles.skeletonName} width={`${42 + ((i * 13) % 43)}%`} />
            </div>
          ))}
        </div>
      );
    if (empty)
      return (
        <div className={styles.empty}>
          {EMPTY_FOLDER}
          {!state.explorer.showHidden && <span>{HIDDEN_EMPTY}</span>}
        </div>
      );
    if (!listing.data) return null;
    return state.explorer.viewMode === 'grid' ? (
      virtual ? (
        <VirtualEntryGrid
          entries={listing.data.entries}
          navigate={listing.navigate}
          parentPath={listing.data.parentPath}
          highlight={highlight}
        />
      ) : (
        <EntryGrid
          entries={listing.data.entries}
          navigate={listing.navigate}
          parentPath={listing.data.parentPath}
          highlight={highlight}
        />
      )
    ) : virtual ? (
      <VirtualEntryList
        entries={listing.data.entries}
        navigate={listing.navigate}
        parentPath={listing.data.parentPath}
        highlight={highlight}
      />
    ) : (
      <EntryList
        entries={listing.data.entries}
        navigate={listing.navigate}
        parentPath={listing.data.parentPath}
        highlight={highlight}
      />
    );
  };
  return (
    <ExplorerScrollContext.Provider value={scrollEl}>
      <main className={styles.screen}>
        <header>
          <h1 className="sr-only">{EXPLORER_HEADING}</h1>
          <ExplorerHeader
            data={listing.data}
            requestedPath={listing.requestedPath}
            root={root}
            viewMode={state.explorer.viewMode}
            showHidden={state.explorer.showHidden}
            onNavigate={listing.navigate}
            onUp={() =>
              listing.data?.parentPath !== null &&
              listing.data?.parentPath !== undefined &&
              listing.navigate(listing.data.parentPath)
            }
            onViewMode={actions.setViewMode}
            onShowHidden={actions.setShowHidden}
          />
        </header>
        {listing.loading && listing.data && <div className={styles.progress} aria-hidden="true" />}
        <ExplorerNotices
          restore={restoreNotice}
          dismissRestore={restoreDismiss}
          error={listing.error ? errorText(listing.error.code) : null}
          retry={listing.reload}
          truncated={listing.data?.truncated === true}
        />
        <div className={styles.body} data-explorer-scroll ref={(node) => setScrollEl(node)}>
          {renderBody()}
        </div>
        <ExplorerFooter
          name={folderName}
          disabled={!listing.data}
          onSelect={() =>
            listing.data && actions.selectCurrentFolder(listing.data.path, folderName)
          }
        />
      </main>
    </ExplorerScrollContext.Provider>
  );
}
