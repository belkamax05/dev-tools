import { type DecodedImage, resampleImage } from '@/dev-tools/terminal-canvas';

/** Fit artwork into the real pixel rectangle without stretching, with transparent padding. */
export const fitImage = (image: DecodedImage, width: number, height: number): DecodedImage => {
  const scale = Math.min(width / image.width, height / image.height);
  const fittedWidth = Math.max(1, Math.round(image.width * scale));
  const fittedHeight = Math.max(1, Math.round(image.height * scale));
  const fitted = resampleImage(image, fittedWidth, fittedHeight);
  const rgba = new Uint8Array(width * height * 4);
  const left = Math.floor((width - fittedWidth) / 2);
  const top = Math.floor((height - fittedHeight) / 2);
  for (let row = 0; row < fittedHeight; row++) {
    rgba.set(
      fitted.rgba.subarray(row * fittedWidth * 4, (row + 1) * fittedWidth * 4),
      ((top + row) * width + left) * 4,
    );
  }
  return { width, height, rgba };
};
