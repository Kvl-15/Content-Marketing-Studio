// @ts-check

/** Safety limits chosen for a few-hundred-person event import. */
export const DATA_LIMITS = Object.freeze({
  maxRows: 1_000,
  maxInputBytes: 25 * 1024 * 1024,
  maxPhotoEntries: 300,
  maxPhotoEntryCompressedBytes: 8 * 1024 * 1024,
  maxPhotoEntryUncompressedBytes: 8 * 1024 * 1024,
  maxPhotoTotalUncompressedBytes: 300 * 8 * 1024 * 1024,
  maxPhotoPixels: 40_000_000,
  maxZipBytes: 300 * 1024 * 1024,
  maxZipEntries: 300,
  maxZipEntryCompressedBytes: 8 * 1024 * 1024,
  maxZipEntryUncompressedBytes: 8 * 1024 * 1024,
  maxZipUncompressedBytes: 300 * 8 * 1024 * 1024,
  maxImagePixels: 40_000_000,
  maxMasterDimension: 2_400,
  jpegQuality: 90,
  lowPhotoDpi: 200,
  defaultCropBias: 0.2,
});

/** The current renderer declares 9/8.5pt starts; this is kept configurable. */
export const DEFAULT_LONG_NAME_RULE = Object.freeze({
  targetPt: 13,
  minimumPt: 9,
  fallbackMaxCharacters: 40,
});
