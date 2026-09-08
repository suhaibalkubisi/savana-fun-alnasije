import Image from "next/image";
import { brandAssets, type BrandKind } from "@/lib/hr/brand";

export function BrandImage({
  kind,
  alt,
  className = "",
  priority = false,
}: {
  kind: BrandKind;
  alt: string;
  className?: string;
  priority?: boolean;
}) {
  const asset = brandAssets[kind];
  const [x, y, width, height] = asset.crop;
  return (
    <span
      className={`brand-artwork ${className}`}
      style={{
        position: "relative",
        display: "block",
        overflow: "hidden",
        aspectRatio: `${width} / ${height}`,
      }}
    >
      <Image
        src={asset.src}
        alt={alt}
        width={asset.width}
        height={asset.height}
        priority={priority}
        unoptimized
        style={{
          position: "absolute",
          width: `${(asset.width / width) * 100}%`,
          maxWidth: "none",
          height: "auto",
          left: `${(-x / width) * 100}%`,
          top: `${(-y / height) * 100}%`,
        }}
      />
    </span>
  );
}
