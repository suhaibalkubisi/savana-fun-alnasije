// Original user-supplied pixels. Crop rectangles affect presentation only;
// the source files remain byte-for-byte copies with their original colors.
export const brandAssets = {
  symbol: {
    src: "/brand/fanu-official-20260908.jpeg",
    width: 1536,
    height: 864,
    crop: [235, 205, 370, 430],
    format: "JPEG",
  },
  company: {
    src: "/brand/fanu-official-20260908.jpeg",
    width: 1536,
    height: 864,
    crop: [235, 205, 1070, 430],
    format: "JPEG",
  },
  savana: {
    src: "/brand/savana-official-20260908.png",
    width: 1672,
    height: 941,
    crop: [270, 350, 1110, 225],
    format: "PNG",
  },
  watermark: {
    src: "/brand/fanu-watermark-20260908.jpeg",
    width: 1254,
    height: 1254,
    crop: [230, 170, 800, 910],
    format: "JPEG",
  },
  title: {
    src: "/brand/hr-title-20260908.png",
    width: 1672,
    height: 941,
    crop: [150, 300, 1360, 335],
    format: "PNG",
  },
  header: {
    src: "/brand/report-header-20260908.png",
    width: 2172,
    height: 724,
    crop: [190, 180, 1785, 320],
    format: "PNG",
  },
} as const;
export type BrandKind = keyof typeof brandAssets;
