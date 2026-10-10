import { Image as ImageIcon } from 'lucide-react';
import type { FsEntry } from '@slydr/shared';
import { useThumbnail } from './useThumbnail';
import styles from './Thumbnail.module.css';
export function Thumbnail({ entry }: { entry: FsEntry }) {
  const { ref, state, src, onImageLoad, onImageError } = useThumbnail(entry.path);
  return (
    <div ref={ref} className={styles.media}>
      {state === 'loaded' && src ? (
        <img
          src={src}
          alt=""
          decoding="async"
          draggable={false}
          onLoad={onImageLoad}
          onError={onImageError}
        />
      ) : (
        <ImageIcon aria-hidden="true" className={styles.icon} />
      )}
    </div>
  );
}
