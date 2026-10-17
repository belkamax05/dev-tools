import { Text } from 'ink';
import { decode as decodeJpeg } from 'jpeg-js';
import { useEffect, useState } from 'react';

import { type DecodedImage, decodePng, drawImage } from '@/dev-tools/terminal-canvas';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import PixelPanel from '../PixelPanel';

const PNG = [0x89, 0x50, 0x4e, 0x47];
const JPEG = [0xff, 0xd8, 0xff];

const startsWith = (bytes: Uint8Array, signature: number[]) =>
  signature.every((byte, at) => bytes[at] === byte);

/** PNG or JPEG (what GitHub serves for an uploaded photo) as straight RGBA; else undefined. */
export const decodeAvatar = (bytes: Uint8Array): DecodedImage | undefined => {
  if (startsWith(bytes, PNG)) return decodePng(bytes);
  if (startsWith(bytes, JPEG)) {
    //? A 48px avatar needs well under 1 MB; the cap stops a hostile file from asking for more
    const image = decodeJpeg(bytes, {
      useTArray: true,
      formatAsRGBA: true,
      maxMemoryUsageInMB: 16,
    });
    return { width: image.width, height: image.height, rgba: new Uint8Array(image.data) };
  }
  return undefined;
};
const cache = new Map<string, Promise<DecodedImage | undefined>>();

/** The picture at `url`, small, decoded once per process. PNG and JPEG; anything else falls back. */
const loadAvatar = (url: string) => {
  let pending = cache.get(url);
  if (!pending) {
    const sized = `${url}${url.includes('?') ? '&' : '?'}s=48`;
    pending = fetch(sized, { signal: AbortSignal.timeout(8_000) })
      .then((response) => (response.ok ? response.arrayBuffer() : undefined))
      .then((buffer) => {
        const bytes = buffer && new Uint8Array(buffer);
        return bytes && decodeAvatar(bytes);
      })
      .catch(() => undefined);
    cache.set(url, pending);
  }
  return pending;
};

export interface AvatarProps {
  url?: string;
  /** Initials drawn while loading, or when the picture cannot be drawn. */
  initials: string;
  overlayId: number;
}

export const AVATAR_COLS = 6;
export const AVATAR_ROWS = 3;

/** Who pushed the head commit, as a picture where the terminal can show one. */
export const Avatar = ({ url, initials, overlayId }: AvatarProps) => {
  const colors = useColors();
  const [image, setImage] = useState<DecodedImage>();

  useEffect(() => {
    let live = true;
    setImage(undefined);
    if (url) loadAvatar(url).then((decoded) => live && setImage(decoded));
    return () => {
      live = false;
    };
  }, [url]);

  if (!image) {
    return (
      <Text color={colors.muted} inverse>
        {` ${initials.slice(0, 2).toUpperCase().padEnd(2)} `}
      </Text>
    );
  }
  return (
    <PixelPanel
      id={`avatar:${url}`}
      cols={AVATAR_COLS}
      rows={AVATAR_ROWS}
      overlayId={overlayId}
      draw={(surface) => drawImage(surface, image)}
    />
  );
};

export default Avatar;
