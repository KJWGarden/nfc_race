"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function QrImage({
  value,
  size = 220,
  label,
}: {
  value: string;
  size?: number;
  label?: string;
}) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, {
      width: size * 2,
      margin: 1,
      color: { dark: "#12160f", light: "#ffffff" },
    }).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!src) {
    return (
      <div
        className="animate-pulse rounded-xl bg-paper-2"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <figure className="inline-flex flex-col items-center gap-2">
      <img
        src={src}
        alt={label ?? "QR 코드"}
        width={size}
        height={size}
        className="rounded-xl bg-white p-2 shadow-sm"
      />
      {label ? <figcaption className="text-xs text-ink/60">{label}</figcaption> : null}
    </figure>
  );
}
