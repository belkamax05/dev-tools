/**
 * terminal-canvas — drawing pixels into a text terminal.
 *
 * Everything here is constructed from a *terminal footprint* (cols x rows) and
 * exposes the same `set(x, y, r, g, b)`, so one piece of scene code drives
 * ASCII, half-blocks, sextants, braille, and a raw RGBA buffer for the graphics
 * protocols without knowing which it is talking to.
 *
 * See README.md for the resolution ladder and the protocol gotchas.
 */
export type { CanvasFactory, PixelCanvas, PixelSurface } from './pixelCanvas.ts';

export { default as createBrailleCanvas } from './createBrailleCanvas.ts';
export type { BrailleCanvasOptions } from './createBrailleCanvas.ts';
export { default as createCellCanvas } from './createCellCanvas.ts';
export type { CellCanvasMode } from './createCellCanvas.ts';
export { default as createHalfBlockCanvas } from './createHalfBlockCanvas.ts';
export { default as createRasterCanvas } from './createRasterCanvas.ts';
export type { RasterCanvas } from './createRasterCanvas.ts';
export { default as createSextantCanvas } from './createSextantCanvas.ts';

export { default as drawImage } from './drawImage.ts';
export { default as drawLine } from './drawLine.ts';
export type { LinePoint } from './drawLine.ts';
export { default as fitFootprint } from './fitFootprint.ts';
export type { Footprint } from './fitFootprint.ts';
export { default as joinBlocks } from './joinBlocks.ts';
export type { Block } from './joinBlocks.ts';

export { default as decodePng } from './decodePng.ts';
export type { DecodedImage } from './decodePng.ts';
export { default as encodePng } from './encodePng.ts';
export { default as flattenImage } from './flattenImage.ts';
export { default as resampleImage } from './resampleImage.ts';

export { default as detectGraphicsSupport } from './detectGraphicsSupport.ts';
export {
  graphicsSupport,
  probeGraphicsSupport,
} from './probeGraphicsSupport.ts';
export type { GraphicsSupport } from './detectGraphicsSupport.ts';
export { default as encodeKittyImage } from './encodeKittyImage.ts';
export type { KittyImageOptions } from './encodeKittyImage.ts';
export { default as encodeSixelImage } from './encodeSixelImage.ts';

export { default as renderGlobeScene } from './scenes/renderGlobeScene.ts';
export type { GlobeSceneOptions } from './scenes/renderGlobeScene.ts';
export { default as renderSphereScene } from './scenes/renderSphereScene.ts';
export type { SphereSceneOptions } from './scenes/renderSphereScene.ts';

/**
 * What there is to draw, how it can be drawn, and the two of them together.
 *
 * The catalogue lives here rather than in an app because more than one draws
 * it: dygma's Debug tab and agenti's IDE logos.
 */
export {
  BALL_SUBJECT,
  GLOBE_SUBJECT,
  loadImageSubject,
} from './subjects.ts';
export type { ImageSubjectOptions, Subject } from './subjects.ts';
export {
  ALL_TECHNIQUES,
  bestTechnique,
  clearRasterArtifacts,
  findTechnique,
  isTechniqueUsable,
  RASTER_TECHNIQUES,
  TEXT_TECHNIQUES,
} from './techniques.ts';
export type {
  RasterTechnique,
  Technique,
  TechniqueKind,
  TextTechnique,
} from './techniques.ts';
export { default as renderSubjectPanel } from './renderSubjectPanel.ts';
export { default as renderTechniqueComparison } from './renderTechniqueComparison.ts';
