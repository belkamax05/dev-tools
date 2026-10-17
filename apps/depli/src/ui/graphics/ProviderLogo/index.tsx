import { useEffect, useState } from 'react';

import {
  bestTechnique,
  type DecodedImage,
  decodePng,
  drawImage,
  graphicsSupport,
} from '@/dev-tools/terminal-canvas';

import PixelPanel from '../PixelPanel';
import { fitImage } from './fitImage';

const files: Record<string, URL> = {
  github: new URL('./assets/github.png', import.meta.url),
  jenkins: new URL('./assets/jenkins.png', import.meta.url),
};
const cache = new Map<string, Promise<DecodedImage>>();
export const hasProviderLogo = (provider: string) =>
  provider in files && bestTechnique(graphicsSupport()).kind === 'raster';

/** Official provider artwork, bundled locally; never requires a network request at runtime. */
export const ProviderLogo = ({
  provider,
  overlayId,
  rows,
}: {
  provider: string;
  overlayId: number;
  rows: number;
}) => {
  const [image, setImage] = useState<DecodedImage>();
  useEffect(() => {
    let live = true;
    setImage(undefined);
    const file = files[provider];
    if (!file) return;
    let pending = cache.get(provider);
    if (!pending) {
      pending = Bun.file(file).bytes().then(decodePng);
      cache.set(provider, pending);
    }
    pending
      .then((decoded) => {
        if (live) setImage(decoded);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [provider]);
  if (!image || !hasProviderLogo(provider)) return null;
  return (
    <PixelPanel
      id={`provider:${provider}`}
      cols={4}
      rows={rows}
      overlayId={overlayId}
      draw={(surface) => drawImage(surface, fitImage(image, surface.width, surface.height))}
    />
  );
};

export default ProviderLogo;
